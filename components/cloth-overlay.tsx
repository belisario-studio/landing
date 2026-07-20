"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

interface ClothOverlayProps {
  sourceCanvas: HTMLCanvasElement
  progressRef: { current: number }
  onFirstFrame?: () => void
  onSettled?: () => void
  onContextLost?: () => void
}

const FOV_DEG = 50
// Bake parameters. The whole cloth drop is simulated once at mount with a fixed
// timestep and stored as keyframes; scroll then scrubs the recorded timeline, so
// playback has no live physics, no elasticity, and is exactly reversible.
const BAKE_DT = 1 / 60
const BAKE_STEPS = 340
const RECORD_EVERY = 3
const CONSTRAINT_ITERATIONS = 4
const DAMPING = 0.982
const GUIDE_STEPS = 84
const TIP_ANGLE = (80 * Math.PI) / 180
const CONTACT_TANGENT_KEEP = 0.35
const TAIL_TRIM_EPSILON = 0.8
const SETTLE_DELAY_MS = 250

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export default function ClothOverlay({
  sourceCanvas,
  progressRef,
  onFirstFrame,
  onSettled,
  onContextLost,
}: ClothOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isMobile = window.innerWidth < 768
    const segX = isMobile ? 24 : 40
    const segY = isMobile ? 18 : 30
    const dprCap = isMobile ? 1.5 : 2

    let width = window.innerWidth
    let height = window.innerHeight

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

    const restX = new Float32Array(vertexCount)
    const restY = new Float32Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
      restX[i] = posAttr.getX(i)
      restY[i] = posAttr.getY(i)
    }

    const cols = segX + 1
    const rows = segY + 1
    // Structural + shear constraints. Shear matters here: the sheet tumbles freely
    // (nothing is pinned), and without diagonals it skews while rotating.
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
      }
    }

    const sphereRadius = height * 0.22
    // Entirely behind the z=0 rest plane so the opaque flat sheet hides it on the
    // swap-in frame; the sheet tips backward over it as it falls.
    const sphereCenter = new THREE.Vector3(0, -height * 0.3, -(sphereRadius + height * 0.03))
    const surfaceRadius = sphereRadius + 5

    const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 32, 24)
    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x8891a3,
      roughness: 0.6,
      metalness: 0.1,
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

    const bake = (): Float32Array[] => {
      const posX = Float32Array.from(restX)
      const posY = Float32Array.from(restY)
      const posZ = new Float32Array(vertexCount)
      const prevX = Float32Array.from(restX)
      const prevY = Float32Array.from(restY)
      const prevZ = new Float32Array(vertexCount)

      const gravity = height * 1.4
      const g = gravity * BAKE_DT * BAKE_DT
      // Where the sheet's center hovers when the guided tip-over releases it: just
      // above the sphere, so the free-fall phase drops it straight into the drape.
      const pivotEndY = sphereCenter.y + sphereRadius + height * 0.06
      const pivotEndZ = sphereCenter.z

      const collide = () => {
        for (let i = 0; i < vertexCount; i++) {
          const dx = posX[i] - sphereCenter.x
          const dy = posY[i] - sphereCenter.y
          const dz = posZ[i] - sphereCenter.z
          const dist = Math.hypot(dx, dy, dz)
          if (dist === 0 || dist >= surfaceRadius) continue
          const nx = dx / dist
          const ny = dy / dist
          const nz = dz / dist
          const newX = sphereCenter.x + nx * surfaceRadius
          const newY = sphereCenter.y + ny * surfaceRadius
          const newZ = sphereCenter.z + nz * surfaceRadius
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

        // Kinematic guide: for the first stretch of the bake the sheet is pulled
        // toward a rigid pose rotating about its horizontal center axis (top edge
        // tipping backward) while the pivot glides down to just above the sphere.
        // The pull fades out near the end of the window, handing the nearly
        // horizontal sheet to gravity — this guarantees the tip-over happens
        // without hand-tuning torque forces, while constraints keep it cloth-like.
        if (step < GUIDE_STEPS) {
          const tG = step / GUIDE_STEPS
          const e = easeInOutCubic(tG)
          const theta = TIP_ANGLE * e
          const cosT = Math.cos(theta)
          const sinT = Math.sin(theta)
          const pivotY = pivotEndY * e
          const pivotZ = pivotEndZ * e
          const strength = 0.22 * (1 - smoothstep(0.7, 1, tG))
          for (let i = 0; i < vertexCount; i++) {
            const ty = pivotY + restY[i] * cosT
            const tz = pivotZ - restY[i] * sinT
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

    const frames = bake()
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
      const e = smoothstep(0.08, 0.75, progress)
      camera.position.set(0, e * height * 0.45, camDist * (1 - 0.1 * e))
      cameraTarget.set(0, -e * height * 0.22, e * sphereCenter.z * 0.5)
      camera.lookAt(cameraTarget)
    }

    let animationId = 0
    let frameCount = 0
    let lastProgress = -1
    let needsRender = false
    let zeroSince: number | null = null
    let settledFired = false

    const animate = (now: number) => {
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

      if (progress === 0) {
        if (zeroSince === null) zeroSince = now
        if (!settledFired && now - zeroSince > SETTLE_DELAY_MS) {
          settledFired = true
          onSettled?.()
        }
      } else {
        zeroSince = null
        settledFired = false
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
      mesh.scale.set(newWidth / width, newHeight / height, 1)
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
