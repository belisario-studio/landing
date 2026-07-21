"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { layoutFor, smoothstep, getBakedClothFrames } from "@/lib/cloth-bake"

interface ClothOverlayProps {
  sourceCanvas: HTMLCanvasElement
  progressRef: { current: number }
  onFirstFrame?: () => void
  onContextLost?: () => void
}

const FOV_DEG = 50

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
