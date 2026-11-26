// Cloth "bake": the heavy per-aspect simulation. Pure geometry, no three import, so it
// runs inside a Web Worker off the main thread. The whole fall is simulated once with a
// fixed timestep and stored as keyframes; scroll then scrubs the recorded timeline, so
// playback has no live physics and is exactly reversible. Units: stage height = 1.
import { CAM_D, CONTACT_GAP, FRAME_DT, IDLE, MESH, PHYSICS as P, RECORD_EVERY, SPHERE_R, SUB_DT } from "./cloth-config"
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
interface Run {
  frames: Float32Array[]
  /** Index of the first frame recorded after the first touch; -1 if it never touched. */
  contact: number
  state: SimState
}

// One simulation run. planet = null: free fall, nothing to land on.
// idle: carry on from the state another run ended in, with every pin gone and the idle
// breeze in place of the gust.
function simulate(
  aspect: number,
  planet: Sphere | null,
  maxTime: number,
  stop: ((frames: Float32Array[], contact: number) => boolean) | null,
  idle: IdleRun | null,
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
  const nc = cA.length
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

  let contactT = idle ? 0 : -1 // the idle starts in contact; its damping is the settled one throughout
  let contact = -1
  const steps = Math.round(maxTime / SUB_DT)
  for (let step = 0; step < steps; step++) {
    const t = idle ? idle.t0 + step * SUB_DT : step * SUB_DT
    // A gust away from the camera that builds while the curtain still hangs and dies once it is loose.
    const W = P.wind * smoothstep(P.gustOn[0], P.gustOn[1], t) * (1 - smoothstep(P.gustOff[0], P.gustOff[1], t))
    const damp = idle
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
    for (let it = 0; it < ITERATIONS; it++) {
      for (let k = 0; k < nc; k++) {
        const i = cA[k], j = cB[k]
        const wi = i < cols && t < relAt[i] ? 0 : 1
        const wj = j < cols && t < relAt[j] ? 0 : 1
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
