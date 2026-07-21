"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

interface ClothOverlayProps {
  sourceCanvas: HTMLCanvasElement
  progressRef: { current: number }
  onFirstFrame?: () => void
  onContextLost?: () => void
}

const FOV_DEG = 50
// Bake parameters. The whole cloth drop is simulated once per viewport size with a
// fixed timestep and stored as keyframes; scroll then scrubs the recorded timeline,
// so playback has no live physics, no elasticity, and is exactly reversible.
const BAKE_DT = 1 / 60
const BAKE_STEPS = 340
const RECORD_EVERY = 3
const CONSTRAINT_ITERATIONS = 6
const DAMPING = 0.982
const GUIDE_STEPS = 100
const GUIDE_LAG = 0.32
const TIP_ANGLE = (80 * Math.PI) / 180
const CONTACT_TANGENT_KEEP = 0.35
const TAIL_TRIM_EPSILON = 0.8

// --- Procedural planet ---------------------------------------------------
// A different world on every page load: the seed and palette are rolled once per
// module evaluation, so the sphere is a stable planet within a session but a reload
// produces a new one. Self-contained shader (fbm continents, ice caps, day/night
// terminator, atmospheric rim) so it does not depend on the scene lights.
const PLANET_SEED = Math.random() * 100

const PLANET_PALETTE = (() => {
  const oceanHue = Math.random()
  const landHue = (oceanHue + 0.25 + Math.random() * 0.4) % 1
  const ocean = new THREE.Color().setHSL(oceanHue, 0.6, 0.4)
  const land = new THREE.Color().setHSL(landHue, 0.5, 0.5)
  const land2 = new THREE.Color().setHSL((landHue + 0.08) % 1, 0.45, 0.32)
  const ice = new THREE.Color().setHSL((oceanHue + 0.5) % 1, 0.12, 0.92)
  const atmosphere = new THREE.Color().setHSL(oceanHue, 0.8, 0.6)
  return { ocean, land, land2, ice, atmosphere }
})()

const PLANET_VERTEX = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vLocalPos = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const PLANET_FRAGMENT = /* glsl */ `
  uniform float uSeed;
  uniform vec3 uOcean;
  uniform vec3 uLand;
  uniform vec3 uLand2;
  uniform vec3 uIce;
  uniform vec3 uAtmo;
  uniform vec3 uLightDir;
  varying vec3 vLocalPos;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0.0,0.0,0.0)), hash(i + vec3(1.0,0.0,0.0)), f.x),
                   mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x), f.y),
               mix(mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x),
                   mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 sp = normalize(vLocalPos);
    vec3 np = sp * 2.2 + uSeed;
    float continents = fbm(np);
    float detail = fbm(np * 3.4 + continents);
    float elevation = continents * 0.72 + detail * 0.28;

    float sea = 0.5;
    vec3 color;
    if (elevation < sea) {
      float d = smoothstep(0.15, sea, elevation);
      color = mix(uOcean * 0.45, uOcean, d);
    } else {
      float t = smoothstep(sea, 0.78, elevation);
      color = mix(uLand, uLand2, t);
    }

    float lat = abs(sp.y);
    float caps = smoothstep(0.68, 0.86, lat + fbm(np * 4.0) * 0.12);
    color = mix(color, uIce, caps);

    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uLightDir);
    float diff = max(dot(N, L), 0.0);
    float ambient = 0.22;
    color *= ambient + diff * 1.15;

    vec3 V = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    color += uAtmo * fres * 0.55;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const layoutFor = (width: number, height: number) => {
  const isMobile = width < 768
  const sphereRadius = height * 0.22
  return {
    segX: isMobile ? 24 : 40,
    segY: isMobile ? 18 : 30,
    dprCap: isMobile ? 1.5 : 2,
    sphereRadius,
    // Low enough that the sheet has real air below the guide's release point —
    // see pivotEndY in bakeClothFrames — to swing through to horizontal and sag
    // before it ever touches the surface, instead of tipping straight onto it.
    sphereCenterY: -height * 0.55,
    // Entirely behind the z=0 rest plane so the opaque flat sheet hides it on the
    // swap-in frame; the sheet tips backward over it as it falls.
    sphereCenterZ: -(sphereRadius + height * 0.03),
  }
}

// The bake is pure geometry — it never touches the snapshot texture — so it runs
// once per viewport size and is reused across every scroll trigger. The texture
// of the moment is applied on top of the shared keyframes at mount.
function bakeClothFrames(width: number, height: number): Float32Array[] {
  const { segX, segY, sphereRadius, sphereCenterY, sphereCenterZ } = layoutFor(width, height)
  const surfaceRadius = sphereRadius + 5

  // Borrow PlaneGeometry's vertex layout so the baked frames line up index-for-index
  // with the mesh the playback writes into.
  const restGeometry = new THREE.PlaneGeometry(width, height, segX, segY)
  const restAttr = restGeometry.attributes.position as THREE.BufferAttribute
  const vertexCount = restAttr.count
  const restX = new Float32Array(vertexCount)
  const restY = new Float32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    restX[i] = restAttr.getX(i)
    restY[i] = restAttr.getY(i)
  }
  restGeometry.dispose()

  const cols = segX + 1
  const rows = segY + 1
  // Structural + shear + bending constraints. Shear matters here: the sheet tumbles
  // freely (nothing is pinned), and without diagonals it skews while rotating.
  // Bending constraints (i to i+2 along a row/column) resist sharp folding — without
  // them the sheet has zero flexion stiffness and collapses into knife-edge folds
  // that pass through each other as they land on the sphere. They use the same rest
  // distance / solver as everything else, just spanning one vertex further.
  const constraints: { a: number; b: number; rest: number }[] = []
  const link = (a: number, b: number) => {
    constraints.push({ a, b, rest: Math.hypot(restX[a] - restX[b], restY[a] - restY[b]) })
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (c < cols - 1) link(i, i + 1)
      if (r < rows - 1) link(i, i + cols)
      if (c < cols - 1 && r < rows - 1) link(i, i + cols + 1)
      if (c > 0 && r < rows - 1) link(i, i + cols - 1)
      if (c < cols - 2) link(i, i + 2)
      if (r < rows - 2) link(i, i + cols * 2)
    }
  }

  const posX = Float32Array.from(restX)
  const posY = Float32Array.from(restY)
  const posZ = new Float32Array(vertexCount)
  const prevX = Float32Array.from(restX)
  const prevY = Float32Array.from(restY)
  const prevZ = new Float32Array(vertexCount)

  const gravity = height * 1.4
  const g = gravity * BAKE_DT * BAKE_DT
  // Where the sheet's center hovers when the guided tip-over releases it. This
  // sits well above the (now lowered) sphere — height * 0.35 of clearance — so
  // the free-fall phase has room to carry the sheet the rest of the way to a
  // horizontal attitude, with gravity sag and flutter, before contact begins.
  const pivotEndY = sphereCenterY + sphereRadius + height * 0.35
  const pivotEndZ = sphereCenterZ

  const collide = () => {
    for (let i = 0; i < vertexCount; i++) {
      const dx = posX[i]
      const dy = posY[i] - sphereCenterY
      const dz = posZ[i] - sphereCenterZ
      const dist = Math.hypot(dx, dy, dz)
      if (dist === 0 || dist >= surfaceRadius) continue
      const nx = dx / dist
      const ny = dy / dist
      const nz = dz / dist
      const newX = nx * surfaceRadius
      const newY = sphereCenterY + ny * surfaceRadius
      const newZ = sphereCenterZ + nz * surfaceRadius
      let vx = newX - prevX[i]
      let vy = newY - prevY[i]
      let vz = newZ - prevZ[i]
      const radialVel = vx * nx + vy * ny + vz * nz
      if (radialVel < 0) {
        vx -= nx * radialVel
        vy -= ny * radialVel
        vz -= nz * radialVel
      }
      // High tangential friction so the sheet settles on the sphere instead of
      // sliding off during the long tail of the bake.
      posX[i] = newX
      posY[i] = newY
      posZ[i] = newZ
      prevX[i] = newX - vx * CONTACT_TANGENT_KEEP
      prevY[i] = newY - vy * CONTACT_TANGENT_KEEP
      prevZ[i] = newZ - vz * CONTACT_TANGENT_KEEP
    }
  }

  const frames: Float32Array[] = []
  const record = () => {
    const f = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i++) {
      f[i * 3] = posX[i]
      f[i * 3 + 1] = posY[i]
      f[i * 3 + 2] = posZ[i]
    }
    frames.push(f)
  }

  record()

  for (let step = 0; step < BAKE_STEPS; step++) {
    for (let i = 0; i < vertexCount; i++) {
      const vx = (posX[i] - prevX[i]) * DAMPING
      const vy = (posY[i] - prevY[i]) * DAMPING
      const vz = (posZ[i] - prevZ[i]) * DAMPING
      const nx = posX[i] + vx
      const ny = posY[i] + vy - g
      const nz = posZ[i] + vz
      prevX[i] = posX[i]
      prevY[i] = posY[i]
      prevZ[i] = posZ[i]
      posX[i] = nx
      posY[i] = ny
      posZ[i] = nz
    }

    // Guided release: rather than dragging the whole sheet through one rigid
    // rotating pose (which reads as a turning plate), the tip-over target sweeps
    // down the sheet as a wave — each row starts peeling toward the horizontal
    // pose GUIDE_LAG after the rows above it, so mid-release the sheet is bent
    // like fabric letting go from the top. Rows the wave hasn't reached are held
    // near their rest pose (still "attached"), and the pull is weak enough that
    // gravity and the constraints add sag and flutter on top of the target path.
    if (step < GUIDE_STEPS) {
      const tG = step / GUIDE_STEPS
      const fade = 1 - smoothstep(0.7, 1, tG)
      const strength = 0.12 * fade
      const holdStrength = 0.08 * fade
      for (let i = 0; i < vertexCount; i++) {
        const rowFrac = (height / 2 - restY[i]) / height
        const tEff = Math.min(Math.max((tG - GUIDE_LAG * rowFrac) / (1 - GUIDE_LAG), 0), 1)
        if (tEff <= 0) {
          posX[i] += (restX[i] - posX[i]) * holdStrength
          posY[i] += (restY[i] - posY[i]) * holdStrength
          posZ[i] += (0 - posZ[i]) * holdStrength
          continue
        }
        const e = easeInOutCubic(tEff)
        const theta = TIP_ANGLE * e
        const ripple =
          Math.sin((restX[i] / width) * Math.PI * 3 + tG * 7) * height * 0.007 * Math.sin(Math.PI * tEff)
        const ty = pivotEndY * e + restY[i] * Math.cos(theta)
        const tz = pivotEndZ * e - restY[i] * Math.sin(theta) + ripple
        posX[i] += (restX[i] - posX[i]) * strength
        posY[i] += (ty - posY[i]) * strength
        posZ[i] += (tz - posZ[i]) * strength
      }
    }

    for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
      for (const { a, b, rest } of constraints) {
        const dx = posX[b] - posX[a]
        const dy = posY[b] - posY[a]
        const dz = posZ[b] - posZ[a]
        const dist = Math.hypot(dx, dy, dz) || 0.0001
        const diff = ((dist - rest) / dist) * 0.5
        posX[a] += dx * diff
        posY[a] += dy * diff
        posZ[a] += dz * diff
        posX[b] -= dx * diff
        posY[b] -= dy * diff
        posZ[b] -= dz * diff
      }
      collide()
    }

    if ((step + 1) % RECORD_EVERY === 0) record()
  }

  // Trim motionless trailing frames so the scroll range maps onto actual motion.
  let lastMoving = frames.length - 1
  while (lastMoving > 1) {
    const a = frames[lastMoving]
    const b = frames[lastMoving - 1]
    let maxDelta = 0
    for (let i = 0; i < a.length; i += 3) {
      const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])
      if (d > maxDelta) maxDelta = d
    }
    if (maxDelta > TAIL_TRIM_EPSILON) break
    lastMoving--
  }
  return frames.slice(0, lastMoving + 1)
}

const bakeCache = new Map<string, Float32Array[]>()

function getBakedClothFrames(width: number, height: number): Float32Array[] {
  const key = `${width}x${height}`
  const cached = bakeCache.get(key)
  if (cached) return cached
  const frames = bakeClothFrames(width, height)
  if (bakeCache.size >= 3) {
    bakeCache.delete(bakeCache.keys().next().value as string)
  }
  bakeCache.set(key, frames)
  return frames
}

// Called from the idle-time preload so the one-off simulation cost is paid long
// before the first scroll, off the interaction path.
export function prebakeCloth() {
  if (typeof window === "undefined") return
  getBakedClothFrames(window.innerWidth, window.innerHeight)
}

export default function ClothOverlay({
  sourceCanvas,
  progressRef,
  onFirstFrame,
  onContextLost,
}: ClothOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let width = window.innerWidth
    let height = window.innerHeight
    const { segX, segY, dprCap, sphereRadius, sphereCenterY, sphereCenterZ } = layoutFor(width, height)

    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))
    renderer.setSize(width, height)
    renderer.setClearColor(0x0a0a0a, 1)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    let camDist = height / 2 / Math.tan((FOV_DEG * Math.PI) / 180 / 2)
    const camera = new THREE.PerspectiveCamera(FOV_DEG, width / height, 0.1, camDist * 6)
    camera.position.set(0, 0, camDist)
    camera.lookAt(0, 0, 0)

    const texture = new THREE.CanvasTexture(sourceCanvas)
    texture.colorSpace = THREE.SRGBColorSpace

    const geometry = new THREE.PlaneGeometry(width, height, segX, segY)
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const posAttr = geometry.attributes.position as THREE.BufferAttribute
    const vertexCount = posAttr.count

    const sphereCenter = new THREE.Vector3(0, sphereCenterY, sphereCenterZ)

    const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 32, 24)
    const sphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSeed: { value: PLANET_SEED },
        uOcean: { value: PLANET_PALETTE.ocean },
        uLand: { value: PLANET_PALETTE.land },
        uLand2: { value: PLANET_PALETTE.land2 },
        uIce: { value: PLANET_PALETTE.ice },
        uAtmo: { value: PLANET_PALETTE.atmosphere },
        uLightDir: { value: new THREE.Vector3(1, 1, 0.4).normalize() },
      },
      vertexShader: PLANET_VERTEX,
      fragmentShader: PLANET_FRAGMENT,
    })
    const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial)
    sphereMesh.position.copy(sphereCenter)
    scene.add(sphereMesh)

    const ambientLight = new THREE.AmbientLight(0xffffff, 1)
    // Z=0 keeps this light's contribution exactly zero on the flat rest normal (0,0,1) —
    // the swap-in frame stays lit by ambient alone (intensity 1 = texture unchanged), matching
    // the frozen snapshot exactly. It only lights the surface once the cloth deforms off-axis.
    const dirLight = new THREE.DirectionalLight(0xffffff, 3)
    dirLight.position.set(1, 1, 0)
    scene.add(ambientLight, dirLight)

    const frames = getBakedClothFrames(width, height)
    const lastFrame = frames.length - 1

    const applyFrame = (f: number) => {
      const i0 = Math.min(Math.floor(f), lastFrame)
      const i1 = Math.min(i0 + 1, lastFrame)
      const t = f - i0
      const fa = frames[i0]
      const fb = frames[i1]
      for (let i = 0; i < vertexCount; i++) {
        const j = i * 3
        posAttr.setXYZ(
          i,
          fa[j] + (fb[j] - fa[j]) * t,
          fa[j + 1] + (fb[j + 1] - fa[j + 1]) * t,
          fa[j + 2] + (fb[j + 2] - fa[j + 2]) * t,
        )
      }
      posAttr.needsUpdate = true
      geometry.computeVertexNormals()
    }

    const cameraTarget = new THREE.Vector3()
    const updateCamera = (progress: number) => {
      // Frontal at progress 0 (exact snapshot parity), drifting up and pitching
      // down as the sheet falls so the horizontal drape reads instead of being
      // seen edge-on.
      // The lowered sphere sits well below the text plane, so besides drifting up
      // and pitching down, the camera also pulls back as progress advances —
      // otherwise the sphere would be cropped out of frame at full drape.
      const e = smoothstep(0.08, 0.75, progress)
      camera.position.set(0, e * height * 0.55, camDist * (1 + 0.3 * e))
      cameraTarget.set(0, -e * height * 0.5, e * sphereCenter.z * 0.5)
      camera.lookAt(cameraTarget)
    }

    let animationId = 0
    let frameCount = 0
    let lastProgress = -1
    let needsRender = false

    const animate = () => {
      const progress = Math.min(Math.max(progressRef.current ?? 0, 0), 1)

      if (frameCount === 0) {
        // Force the exact rest pose on the very first frame regardless of progress,
        // so the swap from the frozen 2D canvas is pixel-identical.
        applyFrame(0)
        updateCamera(0)
        renderer.render(scene, camera)
        frameCount++
        onFirstFrame?.()
        animationId = requestAnimationFrame(animate)
        return
      }

      // Everything on screen is a pure function of progress, so skip all work
      // (including rendering) while it is unchanged.
      if (progress !== lastProgress || needsRender) {
        lastProgress = progress
        needsRender = false
        applyFrame(progress * lastFrame)
        updateCamera(progress)
        renderer.render(scene, camera)
      }

      frameCount++
      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)

    const handleResize = () => {
      const newWidth = window.innerWidth
      const newHeight = window.innerHeight
      renderer.setSize(newWidth, newHeight)
      camera.aspect = newWidth / newHeight
      camDist = newHeight / 2 / Math.tan((FOV_DEG * Math.PI) / 180 / 2)
      camera.updateProjectionMatrix()
      // No mesh.scale hack: the baked drape is real 3D world-space geometry, so a
      // non-uniform x/y stretch squashes it and desyncs the (unscaled) planet. A
      // real width change instead remounts the overlay from the orchestrator, which
      // re-derives geometry/sphere/camera for the new size.
      needsRender = true
    }
    window.addEventListener("resize", handleResize)

    const handleContextLost = (e: Event) => {
      e.preventDefault()
      onContextLost?.()
    }
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener("resize", handleResize)
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      texture.dispose()
      sphereGeometry.dispose()
      sphereMaterial.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceCanvas])

  return <div ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}
