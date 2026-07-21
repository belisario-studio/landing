// Cloth "bake": the heavy per-viewport simulation. Pure geometry, no three import,
// so it can run inside a Web Worker off the main thread. The whole cloth drop is
// simulated once per viewport size with a fixed timestep and stored as keyframes;
// scroll then scrubs the recorded timeline, so playback has no live physics, no
// elasticity, and is exactly reversible.
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

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export const layoutFor = (width: number, height: number) => {
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
export function bakeClothFrames(width: number, height: number): Float32Array[] {
  const { segX, segY, sphereRadius, sphereCenterY, sphereCenterZ } = layoutFor(width, height)
  const surfaceRadius = sphereRadius + 5

  // Analytic grid matching PlaneGeometry's row-major vertex order and positions,
  // so the baked frames line up index-for-index with the mesh playback writes into.
  const cols = segX + 1
  const rows = segY + 1
  const vertexCount = cols * rows
  const restX = new Float32Array(vertexCount)
  const restY = new Float32Array(vertexCount)
  const segW = width / segX
  const segH = height / segY
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = iy * cols + ix
      restX[i] = -width / 2 + ix * segW
      restY[i] = height / 2 - iy * segH
    }
  }

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

export function getBakedClothFrames(width: number, height: number): Float32Array[] {
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

// Stores worker-baked frames into the cache under the viewport key, so a later
// mount-time getBakedClothFrames hits the cache instead of re-baking on the main
// thread. Same eviction rule as getBakedClothFrames.
export function setBakedClothFrames(width: number, height: number, frames: Float32Array[]) {
  const key = `${width}x${height}`
  if (bakeCache.has(key)) {
    bakeCache.set(key, frames)
    return
  }
  if (bakeCache.size >= 3) {
    bakeCache.delete(bakeCache.keys().next().value as string)
  }
  bakeCache.set(key, frames)
}
