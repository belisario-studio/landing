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
const GRAVITY = 900
const DAMPING = 0.985
const CONSTRAINT_ITERATIONS = 3
const MAX_DT = 1 / 30
const SETTLE_EPSILON = 1.5
const SETTLE_TIMEOUT_MS = 600
const SPHERE_Z_PROGRESS_SPAN = 0.4
const SPHERE_Z_MAX_STEP_FACTOR = 0.12

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

    const camera = new THREE.PerspectiveCamera(FOV_DEG, width / height, 0.1, 10000)
    let camDist = height / 2 / Math.tan((FOV_DEG * Math.PI) / 180 / 2)
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
    let maxY = -Infinity
    for (let i = 0; i < vertexCount; i++) {
      const y = posAttr.getY(i)
      restX[i] = posAttr.getX(i)
      restY[i] = y
      if (y > maxY) maxY = y
    }

    const pinned = new Uint8Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
      if (restY[i] > maxY - 0.001) pinned[i] = 1
    }

    const posX = new Float32Array(vertexCount)
    const posY = new Float32Array(vertexCount)
    const posZ = new Float32Array(vertexCount)
    const prevX = new Float32Array(vertexCount)
    const prevY = new Float32Array(vertexCount)
    const prevZ = new Float32Array(vertexCount)

    for (let i = 0; i < vertexCount; i++) {
      posX[i] = restX[i]
      posY[i] = restY[i]
      prevX[i] = restX[i]
      prevY[i] = restY[i]
    }

    const cols = segX + 1
    const rows = segY + 1
    const constraints: { a: number; b: number; rest: number }[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        if (c < cols - 1) {
          const j = i + 1
          constraints.push({ a: i, b: j, rest: Math.hypot(restX[i] - restX[j], restY[i] - restY[j]) })
        }
        if (r < rows - 1) {
          const j = i + cols
          constraints.push({ a: i, b: j, rest: Math.hypot(restX[i] - restX[j], restY[i] - restY[j]) })
        }
      }
    }

    const fallDistance = height * 0.55
    const sphereRadius = height * 0.18
    const surfaceRadius = sphereRadius + 5
    // The sphere drives its own Z through the rest plane (z=0) as progress advances, from
    // fully behind (hidden behind the opaque cloth) to poking through the front. The cloth
    // never chases a Z target itself — collision alone displaces it, so there's no timing
    // window to miss: contact is geometrically guaranteed wherever the sphere and mesh overlap.
    const sphereZStart = -sphereRadius * 1.15
    const sphereZEnd = sphereRadius * 0.4
    const sphereCenter = new THREE.Vector3(0, -height * 0.28, sphereZStart)
    let sphereZ = sphereZStart

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

    const applyPinnedTargets = (progress: number) => {
      const offsetY = -fallDistance * progress
      for (let i = 0; i < vertexCount; i++) {
        if (!pinned[i]) continue
        posX[i] = restX[i]
        posY[i] = restY[i] + offsetY
        posZ[i] = 0
        prevX[i] = posX[i]
        prevY[i] = posY[i]
        prevZ[i] = posZ[i]
      }
    }

    const resetToRest = () => {
      for (let i = 0; i < vertexCount; i++) {
        posX[i] = restX[i]
        posY[i] = restY[i]
        posZ[i] = 0
        prevX[i] = restX[i]
        prevY[i] = restY[i]
        prevZ[i] = 0
      }
    }

    const writeToGeometry = () => {
      for (let i = 0; i < vertexCount; i++) {
        posAttr.setXYZ(i, posX[i], posY[i], posZ[i])
      }
      posAttr.needsUpdate = true
      geometry.computeVertexNormals()
    }

    const stepSphereCollision = () => {
      for (let i = 0; i < vertexCount; i++) {
        if (pinned[i]) continue
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
        posX[i] = newX
        posY[i] = newY
        posZ[i] = newZ
        prevX[i] = newX - vx
        prevY[i] = newY - vy
        prevZ[i] = newZ - vz
      }
    }

    const stepConstraints = () => {
      for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
        for (const { a, b, rest } of constraints) {
          const dx = posX[b] - posX[a]
          const dy = posY[b] - posY[a]
          const dz = posZ[b] - posZ[a]
          const dist = Math.hypot(dx, dy, dz) || 0.0001
          const diff = (dist - rest) / dist
          const pinnedA = pinned[a]
          const pinnedB = pinned[b]
          if (pinnedA && pinnedB) continue
          if (pinnedA) {
            posX[b] -= dx * diff
            posY[b] -= dy * diff
            posZ[b] -= dz * diff
          } else if (pinnedB) {
            posX[a] += dx * diff
            posY[a] += dy * diff
            posZ[a] += dz * diff
          } else {
            posX[a] += dx * diff * 0.5
            posY[a] += dy * diff * 0.5
            posZ[a] += dz * diff * 0.5
            posX[b] -= dx * diff * 0.5
            posY[b] -= dy * diff * 0.5
            posZ[b] -= dz * diff * 0.5
          }
        }
        stepSphereCollision()
      }
    }

    const integrate = (dt: number) => {
      const g = GRAVITY * dt * dt
      for (let i = 0; i < vertexCount; i++) {
        if (pinned[i]) continue
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
    }

    const maxDisplacementFromRest = () => {
      let max = 0
      for (let i = 0; i < vertexCount; i++) {
        const dx = posX[i] - restX[i]
        const dy = posY[i] - restY[i]
        const dz = posZ[i]
        const d = Math.hypot(dx, dy, dz)
        if (d > max) max = d
      }
      return max
    }

    const advanceSphere = (progress: number) => {
      const target = sphereZStart + (sphereZEnd - sphereZStart) * Math.min(1, progress / SPHERE_Z_PROGRESS_SPAN)
      const maxStep = sphereRadius * SPHERE_Z_MAX_STEP_FACTOR
      const diff = target - sphereZ
      sphereZ += Math.max(-maxStep, Math.min(maxStep, diff))
      sphereCenter.z = sphereZ
      sphereMesh.position.z = sphereZ
    }

    let animationId = 0
    let frameCount = 0
    let lastTime = performance.now()
    let zeroSince: number | null = null
    let settledFired = false

    const animate = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, MAX_DT)
      lastTime = now

      const progress = Math.min(Math.max(progressRef.current ?? 0, 0), 1)

      if (frameCount === 0) {
        sphereZ = sphereZStart
        sphereCenter.z = sphereZ
        sphereMesh.position.z = sphereZ
        resetToRest()
        writeToGeometry()
        renderer.render(scene, camera)
        frameCount++
        onFirstFrame?.()
        animationId = requestAnimationFrame(animate)
        return
      }

      applyPinnedTargets(progress)
      advanceSphere(progress)
      integrate(dt)
      stepConstraints()

      if (progress === 0) {
        if (zeroSince === null) zeroSince = now
        if (!settledFired) {
          const elapsed = now - zeroSince
          const settled = maxDisplacementFromRest() < SETTLE_EPSILON
          if (settled || elapsed > SETTLE_TIMEOUT_MS) {
            if (!settled) resetToRest()
            settledFired = true
            onSettled?.()
          }
        }
      } else {
        zeroSince = null
        settledFired = false
      }

      writeToGeometry()
      renderer.render(scene, camera)
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
      camera.position.z = camDist
      camera.updateProjectionMatrix()
      mesh.scale.set(newWidth / width, newHeight / height, 1)
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
