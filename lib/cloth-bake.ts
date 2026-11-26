// Cloth "bake": the heavy per-aspect simulation. Pure geometry, no three import, so it
// runs inside a Web Worker off the main thread. The whole fall is simulated once with a
// fixed timestep and stored as keyframes; scroll then scrubs the recorded timeline, so
// playback has no live physics and is exactly reversible. Units: stage height = 1.
import { CAM_D, CONTACT_GAP, FOV_DEG, FRAME_DT, IDLE, MESH, PHYSICS as P, RECORD_EVERY, SPHERE_R, SUB_DT } from "./cloth-config"
import { cameraPath, centroidOf, scrollMap, smoothstep } from "./cloth-scroll"

const ITERATIONS = 5
const MAX_TIME = 8
const FREE_TIME = 5
// Per recorded frame, in heights: below these for QUIET_FRAMES, the sheet lies still.
const QUIET_RMS = 0.0008
const QUIET_CENTROID = 0.0002
const QUIET_FRAMES = 30
const DRAPED_WITHIN = 0.02
const FLAT_WAIT = 45 // recorded frames

export interface ClothPlanet {
  x: number
  y: number
  z: number
  /** Height of the sheet's middle at its first touch. */
  contactY: number
}

/** Everything playback needs, in transferable buffers. */
export interface ClothTimeline {
  aspect: number
  frameCount: number
  /** Floats per frame: 3 per vertex, row-major like PlaneGeometry. */
  stride: number
  frames: Float32Array
  /** Scroll progress (0..1) of every frame. */
  scroll: Float32Array
  /** Camera of every frame: position and target, 6 floats. */
  camera: Float32Array
  planet: ClothPlanet
  /** Frame of the first touch. */
  contact: number
  /** Frame from which the sheet is draped: the scroll range ends here. */
  hold: number
}

export interface ClothIdle {
  /** The breeze building up from the settled pose, then the loop: `stride` floats per frame. */
  intro: Float32Array
  introCount: number
  loop: Float32Array
  loopCount: number
  /** Seconds between two frames. */
  dt: number
}

/** Positions and previous positions of every vertex: where a run ended. */
export interface SimState {
  px: Float64Array
  py: Float64Array
  pz: Float64Array
  qx: Float64Array
  qy: Float64Array
  qz: Float64Array
}

interface Sphere {
  x: number
  y: number
  z: number
}
interface PlanetCandidate extends Sphere {
  tall: number
}
interface IdleRun {
  state: SimState
  period: number
  t0: number
}
/** Where the hand is, t seconds into the lift, and how closed the pinch is (1: as grabbed, LIFT.pinch: closed). */
interface Grip {
  x: number
  y: number
  z: number
  pinch: number
}
/** What the lift adds to a run (see liftJob). */
interface LiftRun {
  state: SimState
  /** 1 for the vertices in the pinch. */
  held: Uint8Array
  /** Hops over the grid from the pinch. */
  depth: Int32Array
  /** Offsets of the pinched vertices from the apex vertex, as grabbed. */
  ox: Float64Array
  oy: Float64Array
  oz: Float64Array
  handle: (t: number) => Grip
  egg: number
  iterations: number
  nearDepth: number
  nearPasses: number
  t0: number
}
interface Run {
  frames: Float32Array[]
  /** Index of the first frame recorded after the first touch; -1 if it never touched. */
  contact: number
  state: SimState
}

// One simulation run. planet = null: free fall, nothing to land on.
// idle: carry on from the state another run ended in, with every pin gone and the idle
// breeze in place of the gust.
// lift (only liftJob passes it): carry on from a state as well, with no pins, no wind and
// the fall's own damping, while the vertices in lift.held follow lift.handle(t) (a pinch
// being pulled away) and the thing under the sheet grows from the moon's sphere into an
// egg (eggStretch). Without it nothing below does anything it did not do before.
function simulate(
  aspect: number,
  planet: Sphere | null,
  maxTime: number,
  stop: ((frames: Float32Array[], contact: number) => boolean) | null,
  idle: IdleRun | null,
  lift: LiftRun | null = null,
): Run {
  const cols = MESH.segX + 1
  const rows = MESH.segY + 1
  const n = cols * rows
  const rx = new Float32Array(n)
  const ry = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rx[r * cols + c] = -aspect / 2 + (c / MESH.segX) * aspect
      ry[r * cols + c] = 0.5 - r / MESH.segY
    }
  }
  // Structural + shear + bending constraints. Bending ones (i to i+2 along a row or
  // column) are softer: they are what keeps the sheet from collapsing into knife folds.
  const cA: number[] = []
  const cB: number[] = []
  const cR: number[] = []
  const cK: number[] = []
  const link = (i: number, j: number, k: number) => {
    cA.push(i)
    cB.push(j)
    cR.push(Math.hypot(rx[i] - rx[j], ry[i] - ry[j]))
    cK.push(k)
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (c < cols - 1) link(i, i + 1, 1)
      if (r < rows - 1) link(i, i + cols, 1)
      if (c < cols - 1 && r < rows - 1) link(i, i + cols + 1, 1)
      if (c > 0 && r < rows - 1) link(i, i + cols - 1, 1)
      if (c < cols - 2) link(i, i + 2, P.bend)
      if (r < rows - 2) link(i, i + cols * 2, P.bend)
    }
  }
  // Lift only: the links are taken in order of their distance from the pinch (outwards), so that one
  // sweep carries the pull down every chain of links the way a hanging weight needs it.
  if (lift) {
    const depth = lift.depth
    const dist = (k: number) => Math.min(depth[cA[k]], depth[cB[k]])
    const ord = Array.from(cA.keys()).sort((u, v) => dist(u) - dist(v) || u - v)
    const a1 = ord.map((k) => cA[k])
    const b1 = ord.map((k) => cB[k])
    const r1 = ord.map((k) => cR[k])
    const k1 = ord.map((k) => cK[k])
    for (let k = 0; k < ord.length; k++) {
      cA[k] = a1[k]
      cB[k] = b1[k]
      cR[k] = r1[k]
      cK[k] = k1[k]
    }
  }
  const nc = cA.length
  // Lift: the links within nearDepth of the pinch carry the whole sheet's weight, so they get extra passes.
  let near = 0
  if (lift) while (near < nc && Math.min(lift.depth[cA[near]], lift.depth[cB[near]]) <= lift.nearDepth) near++
  const passes = lift ? 1 + lift.nearPasses : 1
  const px = Float64Array.from(rx)
  const py = Float64Array.from(ry)
  const pz = new Float64Array(n)
  const qx = Float64Array.from(rx)
  const qy = Float64Array.from(ry)
  const qz = new Float64Array(n)
  const ax = new Float64Array(n)
  const ay = new Float64Array(n)
  const az = new Float64Array(n)
  // The ONLY pins of the whole bake: the top row, each until its release time, the two
  // ends first and the centre last.
  const relAt = new Float32Array(cols)
  for (let c = 0; c < cols; c++) {
    const u = c / MESH.segX
    relAt[c] = P.tRel * (P.rel0 + P.relSpan * (1 - Math.abs(u * 2 - 1)))
  }
  if (idle) {
    relAt.fill(-1)
    px.set(idle.state.px)
    py.set(idle.state.py)
    pz.set(idle.state.pz)
    qx.set(idle.state.qx)
    qy.set(idle.state.qy)
    qz.set(idle.state.qz)
  }
  if (lift) {
    relAt.fill(-1)
    px.set(lift.state.px)
    py.set(lift.state.py)
    pz.set(lift.state.pz)
    qx.set(lift.state.qx)
    qy.set(lift.state.qy)
    qz.set(lift.state.qz)
  }
  const held = lift ? lift.held : null
  const iterations = lift ? lift.iterations : ITERATIONS
  const recordEvery = idle ? IDLE.every : RECORD_EVERY
  const R = SPHERE_R + CONTACT_GAP
  const keep = 1 - P.friction
  const stick = (0.6 * P.friction * SUB_DT) ** 2
  const sx = planet ? planet.x : 0
  const sy = planet ? planet.y : 0
  const sz = planet ? planet.z : 0
  const triArea0 = (aspect / MESH.segX) * (1 / MESH.segY)
  const dt2 = SUB_DT * SUB_DT
  const frames: Float32Array[] = []
  const record = () => {
    const f = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      f[i * 3] = px[i]
      f[i * 3 + 1] = py[i]
      f[i * 3 + 2] = pz[i]
    }
    frames.push(f)
  }
  record()

  const aero = (i0: number, i1: number, i2: number, wz: number, wx: number) => {
    const e1x = px[i1] - px[i0], e1y = py[i1] - py[i0], e1z = pz[i1] - pz[i0]
    const e2x = px[i2] - px[i0], e2y = py[i2] - py[i0], e2z = pz[i2] - pz[i0]
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
    const len2 = nx * nx + ny * ny + nz * nz
    if (len2 < 1e-14) return
    const vx = (px[i0] + px[i1] + px[i2] - qx[i0] - qx[i1] - qx[i2]) / (3 * SUB_DT)
    const vy = (py[i0] + py[i1] + py[i2] - qy[i0] - qy[i1] - qy[i2]) / (3 * SUB_DT)
    const vz = (pz[i0] + pz[i1] + pz[i2] - qz[i0] - qz[i1] - qz[i2]) / (3 * SUB_DT)
    // Force along the face normal, proportional to the air speed through the face:
    // the same term is the gust's push and the parachute drag of the fall.
    const s = (P.drag * ((wx - vx) * nx + (0 - vy) * ny + (wz - vz) * nz)) / (Math.sqrt(len2) * triArea0 * 6)
    const fx = nx * s, fy = ny * s, fz = nz * s
    ax[i0] += fx
    ay[i0] += fy
    az[i0] += fz
    ax[i1] += fx
    ay[i1] += fy
    az[i1] += fz
    ax[i2] += fx
    ay[i2] += fy
    az[i2] += fz
  }

  // Lift only. The egg: the moon's sphere with its upper half stretched upwards by ky. A vertex
  // inside it is put back on its surface along the sphere's own radius (in the unstretched space)
  // and keeps part of its sliding speed. No static grip here: the sheet is being dragged off, not resting.
  const pushOutOfEgg = (egg: number, held: Uint8Array, t: number) => {
    const ky = eggStretch(egg, t)
    for (let i = 0; i < n; i++) {
      if (held[i] === 1) continue
      const dx = px[i] - sx, up = py[i] - sy, k = up > 0 ? ky : 1, dy = up / k, dz = pz[i] - sz
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d >= R || d === 0) continue
      const ux = dx / d, uy = dy / d, uz = dz / d
      const tx = sx + ux * R, ty = sy + uy * R * k, tz = sz + uz * R
      // The egg's normal there.
      const gl = Math.sqrt(ux * ux + (uy / k) * (uy / k) + uz * uz)
      const nx = ux / gl, ny = uy / k / gl, nz = uz / gl
      let vx = tx - qx[i], vy = ty - qy[i], vz = tz - qz[i]
      const vr = vx * nx + vy * ny + vz * nz
      vx -= nx * vr
      vy -= ny * vr
      vz -= nz * vr
      px[i] = tx
      py[i] = ty
      pz[i] = tz
      qx[i] = tx - vx * keep
      qy[i] = ty - vy * keep
      qz[i] = tz - vz * keep
    }
  }

  let contactT = idle ? 0 : -1 // the idle starts in contact; its damping is the settled one throughout
  let contact = -1
  const steps = Math.round(maxTime / SUB_DT)
  for (let step = 0; step < steps; step++) {
    const t = idle ? idle.t0 + step * SUB_DT : lift ? lift.t0 + step * SUB_DT : step * SUB_DT
    // A gust away from the camera that builds while the curtain still hangs and dies once it is loose.
    const W = lift ? 0 : P.wind * smoothstep(P.gustOn[0], P.gustOn[1], t) * (1 - smoothstep(P.gustOff[0], P.gustOff[1], t))
    const grip = lift ? lift.handle(t + SUB_DT) : null
    const damp = lift
      ? LIFT.damp
      : idle
      ? P.dampContact
      : contactT < 0
        ? P.damp
        : P.damp + (P.dampContact - P.damp) * smoothstep(contactT, contactT + P.dampRamp, t)
    ax.fill(0)
    ay.fill(0)
    az.fill(0)
    if (idle) {
      // The idle breeze: the same air term, with a small wind that swings back and forth
      // once per period (plus a weaker swing at twice the rate), its phase running across
      // the sheet so one hem is going while another is coming. It averages to nothing, so
      // it pushes the sheet nowhere. It builds up over the first IDLE.intro seconds.
      const A = IDLE.strength * smoothstep(0, IDLE.intro, t)
      const ph = (2 * Math.PI * (t - IDLE.intro)) / idle.period
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i = r * cols + c, x = rx[i], y = ry[i]
          const wz = A * (Math.sin(ph + 2.4 * x + 1.3 * y) + 0.5 * Math.sin(2 * ph - 3.1 * x + 2.2 * y + 1))
          const wx = 0.6 * A * Math.sin(ph + 1.7 + 1.5 * x - 2 * y)
          aero(i, i + cols, i + 1, wz, wx)
          aero(i + 1, i + cols, i + cols + 1, wz, wx)
        }
      }
    } else {
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i = r * cols + c
          // Mirror-symmetric in x, so the gust itself never pushes the sheet sideways.
          const gust = 1 + 0.25 * Math.cos(3.1 * rx[i]) * Math.sin(2.2 * ry[i] + 1.7 * t + 1)
          // The lower part of the sheet is always pushed back harder than the upper part,
          // which is what tips it over while it falls.
          const w = -W * gust * smoothstep(P.shearTop, P.shearBot, (py[i] + py[i + cols + 1]) * 0.5)
          aero(i, i + cols, i + 1, w, 0)
          aero(i + 1, i + cols, i + cols + 1, w, 0)
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (i < cols && t < relAt[i]) {
        px[i] = qx[i] = rx[i]
        py[i] = qy[i] = ry[i]
        pz[i] = qz[i] = 0
        continue
      }
      if (lift && grip && held && held[i] === 1) {
        // In the pinch: it goes where the hand goes.
        qx[i] = px[i]
        qy[i] = py[i]
        qz[i] = pz[i]
        px[i] = grip.x + lift.ox[i] * grip.pinch
        py[i] = grip.y + lift.oy[i] * grip.pinch
        pz[i] = grip.z + lift.oz[i] * grip.pinch
        continue
      }
      const nx = px[i] + (px[i] - qx[i]) * damp + ax[i] * dt2
      const ny = py[i] + (py[i] - qy[i]) * damp + (ay[i] - P.gravity) * dt2
      const nz = pz[i] + (pz[i] - qz[i]) * damp + az[i] * dt2
      qx[i] = px[i]
      qy[i] = py[i]
      qz[i] = pz[i]
      px[i] = nx
      py[i] = ny
      pz[i] = nz
    }
    for (let it = 0; it < iterations; it++) {
      for (let pass = 0; pass < passes; pass++) {
        for (let k = 0, end = pass === 0 ? nc : near; k < end; k++) {
          const i = cA[k], j = cB[k]
          const wi = (i < cols && t < relAt[i]) || (held !== null && held[i] === 1) ? 0 : 1
          const wj = (j < cols && t < relAt[j]) || (held !== null && held[j] === 1) ? 0 : 1
          const ws = wi + wj
          if (ws === 0) continue
          const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i]
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
          const s = (((d - cR[k]) / d) * cK[k]) / ws
          px[i] += dx * s * wi
          py[i] += dy * s * wi
          pz[i] += dz * s * wi
          px[j] -= dx * s * wj
          py[j] -= dy * s * wj
          pz[j] -= dz * s * wj
        }
      }
      if (lift && held) {
        pushOutOfEgg(lift.egg, held, t)
        continue
      }
      if (!planet) continue
      for (let i = 0; i < n; i++) {
        if (i < cols && t < relAt[i]) continue
        const dx = px[i] - sx, dy = py[i] - sy, dz = pz[i] - sz
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d >= R || d === 0) continue
        if (contactT < 0) {
          contactT = t
          contact = frames.length
        }
        const nx = dx / d, ny = dy / d, nz = dz / d
        const tx = sx + nx * R, ty = sy + ny * R, tz = sz + nz * R
        let vx = tx - qx[i], vy = ty - qy[i], vz = tz - qz[i]
        const vr = vx * nx + vy * ny + vz * nz
        // contact kills the radial speed
        vx -= nx * vr
        vy -= ny * vr
        vz -= nz * vr
        // Static friction: a contact that crept less than the grip distance this step
        // goes back to where it was on the surface. Faster contact slides and loses speed.
        if (vx * vx + vy * vy + vz * vz < stick) {
          const ex = qx[i] - sx, ey = qy[i] - sy, ez = qz[i] - sz
          const e = R / (Math.sqrt(ex * ex + ey * ey + ez * ez) || 1)
          px[i] = qx[i] = sx + ex * e
          py[i] = qy[i] = sy + ey * e
          pz[i] = qz[i] = sz + ez * e
          continue
        }
        px[i] = tx
        py[i] = ty
        pz[i] = tz
        qx[i] = tx - vx * keep
        qy[i] = ty - vy * keep
        qz[i] = tz - vz * keep
      }
    }
    if ((step + 1) % recordEvery !== 0) continue
    record()
    if (stop && stop(frames, contact)) break
  }
  return { frames, contact, state: { px, py, pz, qx, qy, qz } }
}

// Signed clearance between the sphere and the bottom plane of the resting camera's
// view (the plane through the eye and the page's bottom edge). > 0: wholly off-screen.
const belowViewport = (pl: Sphere) => (-CAM_D * pl.y - 0.5 * (CAM_D - pl.z)) / Math.hypot(CAM_D, 0.5) - SPHERE_R

// A sphere tucked right under the middle of the sheet as it is in frame f.
function planetUnder(f: Float32Array): PlanetCandidate {
  const c = centroidOf(f)
  let low = Infinity, top = -Infinity, bottom = Infinity
  for (let i = 0; i < f.length; i += 3) {
    if (f[i + 1] > top) top = f[i + 1]
    if (f[i + 1] < bottom) bottom = f[i + 1]
    const dx = f[i] - c[0], dz = f[i + 2] - c[2]
    if (dx * dx + dz * dz < 0.02 && f[i + 1] < low) low = f[i + 1]
  }
  if (low === Infinity) low = c[1]
  return { x: c[0], y: low - SPHERE_R - CONTACT_GAP - P.lead, z: c[2], tall: top - bottom }
}

const pack = (frames: Float32Array[]) => {
  const stride = frames[0].length
  const out = new Float32Array(frames.length * stride)
  for (let k = 0; k < frames.length; k++) out.set(frames[k], k * stride)
  return out
}

/** The fall for a stage of this aspect (width / height), and the state it ends in. */
export function bakeCloth(aspect: number): { timeline: ClothTimeline; state: SimState } {
  const first = Math.ceil(P.tRel / FRAME_DT)
  // First fall, with no planet. Candidates are the frames at which a sphere tucked under
  // the middle of the sheet is wholly below the page. The planet is the first of them
  // at which the sheet has tipped over (it is lying flat: not tall); if it never gets that
  // flat within FLAT_WAIT, the flattest of that stretch.
  let found: PlanetCandidate | null = null
  let firstBelow = -1
  simulate(aspect, null, FREE_TIME, (fr) => {
    const k = fr.length - 1
    if (k < first) return false
    const cand = planetUnder(fr[k])
    if (belowViewport(cand) <= P.clearance) {
      if (!found) found = cand
      return false
    }
    if (firstBelow < 0) {
      firstBelow = k
      found = cand
    }
    if (!found || cand.tall < found.tall) found = cand
    return found.tall < P.flat || k - firstBelow >= FLAT_WAIT
  }, null)
  const sphere: Sphere = found ?? { x: 0, y: -2, z: 0 }
  // Second fall, with the planet. The timeline ends once the sheet has lain still for a while.
  let quiet = 0
  const run = simulate(aspect, sphere, MAX_TIME, (fr, touched) => {
    const k = fr.length - 1
    if (touched < 0 || k < touched + 20) return false
    const f = fr[k], g = fr[k - 1], c = centroidOf(f), d = centroidOf(g)
    let m = 0
    for (let i = 0; i < f.length; i++) m += (f[i] - g[i]) * (f[i] - g[i])
    const still =
      Math.sqrt(m / (f.length / 3)) < QUIET_RMS && Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]) < QUIET_CENTROID
    quiet = still ? quiet + 1 : 0
    return quiet >= QUIET_FRAMES
  }, null)
  const { frames } = run
  const contact = run.contact < 0 ? frames.length - 1 : run.contact
  // "Draped": from here on the sheet's middle stays within DRAPED_WITHIN of where it ends.
  // The scroll range ends here; what is left is the last sway of the hanging sides.
  const end = centroidOf(frames[frames.length - 1])
  let hold = frames.length - 1
  while (hold > contact) {
    const c = centroidOf(frames[hold - 1])
    if (Math.hypot(c[0] - end[0], c[1] - end[1], c[2] - end[2]) > DRAPED_WITHIN) break
    hold--
  }
  const planet: ClothPlanet = { x: sphere.x, y: sphere.y, z: sphere.z, contactY: centroidOf(frames[contact])[1] }
  const scroll = scrollMap(frames, contact, hold)
  const timeline: ClothTimeline = {
    aspect,
    frameCount: frames.length,
    stride: frames[0].length,
    frames: pack(frames),
    scroll,
    camera: cameraPath(scroll, planet),
    planet,
    contact,
    hold,
  }
  return { timeline, state: run.state }
}

// ---------- The idle: what the sheet does once it has settled, as a loop ----------
// The same simulation carries on from the state the bake ended in (same sheet, same moon,
// same friction, no pins), with the idle breeze. It is recorded every IDLE.every steps:
//   intro: the first IDLE.intro seconds, the breeze building up from nothing;
//   then IDLE.warm periods nobody sees, for the motion to become the same every period;
//   then two periods, F and G. The sheet never repeats itself to the last digit, so the
//   loop is G fading into F: L[k] = G[k] (1 - k/M) + F[k] (k/M). It starts as G starts,
//   which is how F ends, so the frame after L's last is L's first, in place and in speed.
// The intro is faded the same way into the loop's frames of the same moment of the
// breeze, so it leaves the settled sheet exactly as the bake left it and arrives exactly
// on L[0].
// It is worked out a little at a time (step(), IDLE_CHUNK steps of simulation per piece,
// each piece starting from the state the one before ended in), so the main-thread
// fallback can do it between frames instead of stopping for it. The pieces are always
// the same, so the result does not depend on how the work was spread.
const IDLE_DT = SUB_DT * IDLE.every
const IDLE_CHUNK = IDLE.every * 2

export function idleJob(aspect: number, planet: ClothPlanet, from: SimState) {
  const M = Math.max(Math.round(IDLE.period / IDLE_DT), 8)
  const Mi = Math.round(IDLE.intro / IDLE_DT)
  const period = M * IDLE_DT
  const need = Mi + (IDLE.warm + 2) * M
  const raw: Float32Array[] = []
  let state = from
  let steps = 0
  let result: ClothIdle | null = null
  return {
    /** Works for about budgetMs (one piece at least); returns the idle once it is whole. */
    step(budgetMs: number): ClothIdle | null {
      const t0 = performance.now()
      while (!result && raw.length < need) {
        const piece = simulate(aspect, planet, IDLE_CHUNK * SUB_DT, null, { state, period, t0: steps * SUB_DT })
        state = piece.state
        steps += IDLE_CHUNK
        for (let k = raw.length ? 1 : 0; k < piece.frames.length; k++) raw.push(piece.frames[k])
        if (performance.now() - t0 >= budgetMs) break
      }
      if (!result && raw.length >= need) result = closeIdle(raw, M, Mi)
      return result
    },
  }
}

function closeIdle(raw: Float32Array[], M: number, Mi: number): ClothIdle {
  const F = Mi + IDLE.warm * M
  const G = F + M
  const n = raw[0].length
  const mix = (a: Float32Array, b: Float32Array, s: number) => {
    const f = new Float32Array(n)
    for (let i = 0; i < n; i++) f[i] = a[i] + (b[i] - a[i]) * s
    return f
  }
  const loop: Float32Array[] = []
  const intro: Float32Array[] = []
  for (let k = 0; k < M; k++) loop.push(mix(raw[G + k], raw[F + k], k / M))
  for (let k = 0; k < Mi; k++) intro.push(mix(raw[k], loop[(((k - Mi) % M) + M) % M], smoothstep(0, 1, k / Mi)))
  return { intro: pack(intro), introCount: Mi, loop: pack(loop), loopCount: M, dt: IDLE_DT }
}

// ---------- The lift: the sheet picked up by a pinch and pulled off the moon ----------
// The same simulation again (same sheet, constraints, gravity, air and contact with a sphere), carried
// on from the state the bake ended in: the settled pose, the last frame of the timeline. The page shows
// the idle's displacement from that pose faded out over the first 0.3 s, so nothing jumps whichever
// frame of the idle loop the click came in. All numbers are in stage heights.
//
// The pinch: the vertices nearest the grab point (default: the top of the moon) follow a hand that starts
// from rest, speeds up smoothly to LIFT.speed (heights per second) over LIFT.ramp seconds and keeps
// pulling up (a little aside and away from the viewer, LIFT.lean) until every vertex is above the view.
// The hand closes (the pinch's offsets shrink to LIFT.pinch) while it starts. The rest of the sheet follows
// through its own constraints, gravity and air, sliding off the moon. What it slides off is the moon's
// sphere growing into the egg (see simulate), so it is never drawn through it; with egg = 0 nothing grows.
// The page plays frame k = clamp(T / dt) with linear interpolation; both bakes share the camera.
const LIFT_EVERY = RECORD_EVERY
export const LIFT_DT = SUB_DT * LIFT_EVERY
const LIFT_CHUNK = LIFT_EVERY * 4

export const LIFT = {
  speed: 0.85,
  ramp: 0.8,
  grab: 0.07,
  pinch: 0.45,
  pinchTime: 0.3,
  lean: [0.08, 1, -0.05] as [number, number, number],
  damp: 0.985,
  iterations: 10,
  nearDepth: 7,
  nearPasses: 6,
  eggFrom: 0.04,
  eggTo: 0.5,
  clear: 0.04,
  maxTime: 4.5,
}

/** Overrides of LIFT, and where to grab. */
export interface LiftOptions extends Partial<typeof LIFT> {
  /** [dx, dz] from the top of the moon of the point the pinch is taken at. Default [0, 0]: the highest vertex. */
  at?: [number, number]
}

export interface LiftResult {
  /** `stride` floats per frame, like the timeline's. frames[0] is the settled pose; frame k is at k * dt seconds. */
  frames: Float32Array[]
  /** Seconds between two frames (LIFT_DT). */
  dt: number
  duration: number
  /** Index of the pinch's centre vertex. */
  apex: number
  egg: number
  /** How many vertices are held by the hand. */
  held: number
  /** Indices of the held vertices. */
  grabbed: Uint16Array
  /** The last frame has the whole sheet above the top edge of the resting camera's view; false if LIFT.maxTime ran out first. */
  cleared: boolean
  /** Milliseconds of work. */
  ms: number
}

/** How much taller than the moon's sphere the egg's upper half is, t seconds into the lift (egg: its final extra height, 0.35 = 35 % taller). */
export const eggStretch = (egg: number, t: number) => 1 + egg * smoothstep(LIFT.eggFrom, LIFT.eggTo, t)

// Distance the hand has travelled t seconds in: its speed rises as smootherstep over `ramp`, then stays.
const handTravel = (v: number, ramp: number, t: number) => {
  if (t <= 0) return 0
  if (t >= ramp) return v * (t - ramp * 0.5)
  const u = t / ramp
  return v * ramp * (u ** 6 - 3 * u ** 5 + 2.5 * u ** 4)
}

/**
 * The lift for a stage of this aspect, from `state` (the bake's, the one idleJob starts from too: it is only read).
 * It is worked out a little at a time, like idleJob, so a Worker can stay responsive between pieces.
 */
export function liftJob(aspect: number, planet: ClothPlanet, from: SimState, egg: number, opts?: LiftOptions) {
  const o = { ...LIFT, ...(opts || {}) }
  const cols = MESH.segX + 1
  const rows = MESH.segY + 1
  const n = cols * rows
  const R = SPHERE_R + CONTACT_GAP
  // The pinch: the vertex on the moon nearest the grab point (o.at = [dx, dz] from the moon's top, default
  // [0, 0]: the highest one), and the small patch around it.
  const at = o.at || [0, 0]
  let apex = -1
  let any = 0
  let best = Infinity
  for (let i = 0; i < n; i++) {
    if (from.py[i] > from.py[any]) any = i
    const d = Math.hypot(from.px[i] - planet.x, from.py[i] - planet.y, from.pz[i] - planet.z)
    if (d > R + 0.01) continue
    // The nearest to the point, higher wins ties.
    const cost = Math.hypot(from.px[i] - planet.x - at[0], from.pz[i] - planet.z - at[1]) - 0.02 * (from.py[i] - planet.y)
    if (cost < best) {
      best = cost
      apex = i
    }
  }
  if (apex < 0) apex = any
  const held = new Uint8Array(n)
  const ox = new Float64Array(n)
  const oy = new Float64Array(n)
  const oz = new Float64Array(n)
  const ac = apex % cols
  const ar = (apex - ac) / cols
  const depth = new Int32Array(n).fill(1 << 20)
  const queue: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (Math.hypot(((c - ac) / MESH.segX) * aspect, (r - ar) / MESH.segY) > o.grab) continue
      held[i] = 1
      depth[i] = 0
      queue.push(i)
      ox[i] = from.px[i] - from.px[apex]
      oy[i] = from.py[i] - from.py[apex]
      oz[i] = from.pz[i] - from.pz[apex]
    }
  }
  // Hops from the pinch over the grid (breadth first; each vertex is in the queue once).
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]
    const c = i % cols
    const r = (i - c) / cols
    for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1]) {
      if (j < 0 || depth[j] <= depth[i] + 1) continue
      depth[j] = depth[i] + 1
      queue.push(j)
    }
  }
  const x0 = from.px[apex]
  const y0 = from.py[apex]
  const z0 = from.pz[apex]
  const ll = Math.hypot(...o.lean)
  const handle = (t: number): Grip => {
    const s = handTravel(o.speed, o.ramp, t)
    // The pinch also rides the top of the egg as it grows, so the egg never comes up through it.
    const rise = (y0 - planet.y) * (eggStretch(egg, t) - 1)
    return {
      x: x0 + (o.lean[0] / ll) * s,
      y: y0 + rise + (o.lean[1] / ll) * s,
      z: z0 + (o.lean[2] / ll) * s,
      pinch: 1 - (1 - o.pinch) * smoothstep(0, o.pinchTime, t),
    }
  }
  // The top edge of the view at the end of the scroll, as a plane through the eye.
  const cam = cameraPath(Float32Array.of(1), planet)
  const fx = cam[3] - cam[0], fy = cam[4] - cam[1], fz = cam[5] - cam[2]
  const fl = Math.hypot(fx, fy, fz)
  const f = [fx / fl, fy / fl, fz / fl]
  const rl = Math.hypot(f[2], f[0])
  const right = [-f[2] / rl, 0, f[0] / rl]
  const up = [
    right[1] * f[2] - right[2] * f[1],
    right[2] * f[0] - right[0] * f[2],
    right[0] * f[1] - right[1] * f[0],
  ]
  const half = (FOV_DEG * Math.PI) / 360
  const top = [0, 1, 2].map((a) => up[a] * Math.cos(half) - f[a] * Math.sin(half))
  const gone = (fr: Float32Array) => {
    for (let i = 0; i < fr.length; i += 3) {
      if ((fr[i] - cam[0]) * top[0] + (fr[i + 1] - cam[1]) * top[1] + (fr[i + 2] - cam[2]) * top[2] < o.clear) return false
    }
    return true
  }
  const frames: Float32Array[] = []
  const maxFrames = Math.round(o.maxTime / LIFT_DT)
  const estimate = 0.6 * maxFrames
  let state = from
  let steps = 0
  let ms = 0
  let result: LiftResult | null = null
  return {
    /** How far along it is, 0..0.99 (a guess: the end depends on the sheet). */
    get progress() {
      return Math.min(frames.length / estimate, 0.99)
    },
    /** Works for about budgetMs (one piece at least); returns the lift once it is whole. */
    step(budgetMs: number): LiftResult | null {
      const t0 = performance.now()
      while (!result) {
        const piece = simulate(aspect, planet, LIFT_CHUNK * SUB_DT, null, null, {
          state, held, depth, ox, oy, oz, handle, egg,
          iterations: o.iterations,
          nearDepth: o.nearDepth,
          nearPasses: o.nearPasses,
          t0: steps * SUB_DT,
        })
        state = piece.state
        steps += LIFT_CHUNK
        let done = false
        for (let k = frames.length ? 1 : 0; k < piece.frames.length && !done; k++) {
          frames.push(piece.frames[k])
          done = gone(piece.frames[k]) || frames.length > maxFrames
        }
        if (done) {
          result = {
            frames,
            dt: LIFT_DT,
            duration: (frames.length - 1) * LIFT_DT,
            apex,
            egg,
            held: held.reduce((s, v) => s + v, 0),
            grabbed: Uint16Array.from(queue.filter((i) => held[i] === 1)),
            cleared: frames.length <= maxFrames,
            ms: 0,
          }
        }
        if (performance.now() - t0 >= budgetMs) break
      }
      ms += performance.now() - t0
      if (result) result.ms = ms
      return result
    },
  }
}

export type LiftJob = ReturnType<typeof liftJob>
