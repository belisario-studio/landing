// The egg of the "Chicken Rescue" reveal: it wobbles, cracks, bursts, and the studio game's
// rooster drops out of it onto a floor of warm light. A port of the prototype's nav_egg.js.
//
// The egg is made once, at create time, of pre-fractured shell pieces that fit together like the
// unbroken egg. Everything that moves is driven from update(dt) by a fixed-step integrator, so the
// same sequence of update() calls always gives the same frames. No timers, nothing allocated per
// frame. Importing this file touches no DOM; createRevealEgg() draws its small textures on canvases.
//
// Space: the group's origin is the egg's centre, +Y up, the viewer looks along -Z. All lengths are
// in the units of `radius` (the egg's widest half-width). There is no floor in the page, so the
// reveal makes one: an invisible plane `landingHeight` radii under the egg's bottom, marked by a
// faint pool of warm light and the rooster's soft shadow. The shell pieces and the rooster fall
// onto it.
import * as THREE from "three"

/** The game's egg (game/scenes/egg.tscn, mesh "easter_egg"): its profile, proportions and material. */
export const GAME_EGG = {
  /** Height / width (the widest radius is 1, the height 2 * aspect). */
  aspect: 1.3875,
  /** The widest ring, as a fraction of the height from the bottom. */
  widestAt: 0.402,
  /** Albedo (a flat #cccccc) and roughness of the game's StandardMaterial3D. */
  albedo: 0xcccccc,
  roughness: 0.5,
  // r[k] is the radius, in units of the widest radius, at u = -cos(PI k / 48), with u = -1 the
  // blunt bottom and u = 1 the tip (normalised height).
  r: [
    0, 0.0622, 0.1244, 0.2006, 0.2862, 0.3609, 0.4309, 0.498, 0.5629, 0.6246, 0.6835, 0.7383, 0.7887, 0.8344, 0.8737, 0.9073,
    0.9359, 0.9595, 0.9768, 0.9886, 0.9964, 0.9997, 0.997, 0.9912, 0.9819, 0.9675, 0.9506, 0.9301, 0.906, 0.88, 0.8497, 0.8175,
    0.7828, 0.7453, 0.7063, 0.6638, 0.6204, 0.5752, 0.5288, 0.4816, 0.4319, 0.3799, 0.3287, 0.2712, 0.2063, 0.1419, 0.0947,
    0.0474, 0,
  ],
} as const

export interface RevealEggParams {
  /** Egg height / egg width. Ignored while `stretch` > 0 (then it is (1 + stretch) / 2). */
  aspect: number
  /**
   * > 0: the page's egg, a sphere of radius R whose upper half is `stretch` times taller (the cloth
   * lift's collider). The shape is then exactly that. 0: the game's egg.
   */
  stretch: number
  /** s: the beat of knocking from inside (the cracks start halfway through it). */
  wobbleTime: number
  /** s: the cracks spreading, until the shell is covered by them. */
  crackTime: number
  /** Shell pieces (>= 4). */
  pieceCount: number
  /** Radii / s^2. */
  gravity: number
  /** The rooster's final height / the egg's height; it pops out smaller and grows to it. */
  roosterScale: number
  /** The rooster's size at the burst, as a fraction of the final one. */
  roosterPop: number
  /** Radii from the egg's bottom down to the floor the rooster lands on. */
  landingHeight: number
  /** Shell thickness, in radii. */
  thickness: number
  /** Opacity of the pool of light on the floor (0 = none). */
  floorGlow: number
  /** Radii: pieces bounce back from an invisible wall this far from the axis. */
  arena: number
  seed: number
}

export const REVEAL_EGG_DEFAULTS: Readonly<RevealEggParams> = {
  aspect: GAME_EGG.aspect,
  stretch: 0,
  wobbleTime: 0.55,
  crackTime: 0.6,
  pieceCount: 9,
  gravity: 14,
  roosterScale: 0.5,
  roosterPop: 0.55,
  landingHeight: 1.0,
  thickness: 0.05,
  floorGlow: 0.2,
  arena: 3.3,
  seed: 7,
}

export interface RevealEggOptions {
  /** The egg's widest half-width, the unit of every length. Default 1. */
  radius?: number
  params?: Partial<RevealEggParams>
}

/**
 * whole: standing still, until play(); cracking: wobble and cracks, until the burst; open: the
 * rooster is falling; dropped: it has touched the floor; done: everything is at rest.
 */
export type RevealEggPhase = "whole" | "cracking" | "open" | "dropped" | "done"

export interface RevealEggExtent {
  radius: number
  halfHeight: number
  /** y of the floor, in the group's space. */
  floorY: number
  roosterHeight: number
  roosterHalfWidth: number
  arena: number
  topOfFlight: number
  /** s after play() at which the shell bursts. */
  breakTime: number
  params: RevealEggParams
}

export interface RevealEggMaterials {
  outer: THREE.MeshStandardMaterial
  inner: THREE.MeshStandardMaterial
  crack: THREE.MeshBasicMaterial
}

export interface RevealEgg {
  /** Add this to the scene. Origin: the egg's centre. */
  group: THREE.Group
  materials: RevealEggMaterials
  readonly phase: RevealEggPhase
  /** Called once, from update(), when the phase becomes "done". */
  onDone: (() => void) | null
  stats: { triangles: number; drawCalls: number; pieces: number }
  /** The egg's radius at height y (group space). 0 outside the egg. */
  profile: (y: number) => number
  /** The rooster that drops out (from buildRooster(): height 1, feet at y = 0). Its materials are tinted once. */
  setRooster: (obj: THREE.Object3D | null) => void
  /** Back to the whole egg, standing still. */
  reset: () => void
  /** Starts the wobble (only from "whole"). */
  play: () => void
  /** Advances by dt seconds (clamped to 0.25) in fixed 1/120 s steps. */
  update: (dt: number) => void
  /** Changes parameters and resets; the pieces are rebuilt when the shape changes. */
  setParams: (params: Partial<RevealEggParams>) => void
  extent: () => RevealEggExtent
  /** Frees the geometry, materials and textures it made (not the rooster's) and removes the group. */
  dispose: () => void
}

type V3 = [number, number, number]

const SORT_AT = 0.8 // s after the burst: the shells have landed; the ones in the rooster's way start to shrink away
const SHRINK_TIME = 0.35
const ROO_Z = 0.1 // radii: where the rooster ends, toward the viewer from the egg's axis
const STEP = 1 / 120 // the integrator's fixed step
const SEG = 36 // segments around the egg
const RINGS = 26 // rings from bottom to top
const CONTACTS = 14 // collision points per piece
const SW = 20 // floats per piece in the state array
const KNOCKS = [0.06, 0.5, 0.82]
const SHAPE_KEYS: ReadonlyArray<keyof RevealEggParams> = ["aspect", "stretch", "pieceCount", "thickness", "seed"]

// ---------- small helpers (build time only, except smooth) ----------
function mulberry(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash3(x: number, y: number, z: number, s: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(s, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// smooth value noise in [0,1]
function noise3(x: number, y: number, z: number, s: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash3(ix, iy, iz, s), hash3(ix + 1, iy, iz, s), ux), l(hash3(ix, iy + 1, iz, s), hash3(ix + 1, iy + 1, iz, s), ux), uy),
    l(l(hash3(ix, iy, iz + 1, s), hash3(ix + 1, iy, iz + 1, s), ux), l(hash3(ix, iy + 1, iz + 1, s), hash3(ix + 1, iy + 1, iz + 1, s), ux), uy),
    uz,
  )
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

function radialTexture(stops: ReadonlyArray<readonly [number, string]>) {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  if (!g) throw new Error("reveal-egg: no 2D canvas")
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const s of stops) gr.addColorStop(s[0], s[1])
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface Piece {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material[]>
  geometry: THREE.BufferGeometry
  /** Normalised front position at which each crack ribbon shows, ascending. */
  keys: Float32Array
  cx: number
  cy: number
  cz: number
  /** CONTACTS collision points (local), xyz. */
  cp: Float32Array
  invM: number
  invI: number
  /** Ribbons shown now. */
  cnt: number
}

/** The rooster's rigid state: position, velocity, squash spring, tumble. */
interface Rooster {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  s: number
  sv: number
  ax: number
  ay: number
  az: number
  avx: number
  avy: number
  avz: number
  stretch: number
}

export function createRevealEgg(opts: RevealEggOptions = {}): RevealEgg {
  const R = opts.radius || 1
  const P: RevealEggParams = { ...REVEAL_EGG_DEFAULTS, ...opts.params }

  const group = new THREE.Group()
  group.name = "RevealEgg"
  // tilt pivots the egg a little under its centre (the wobble); body holds the pieces, unrotated once it breaks
  const tilt = new THREE.Group()
  const body = new THREE.Group()
  tilt.add(body)
  group.add(tilt)

  // ----- materials (shared by all pieces) -----
  // The game's shell is one flat colour (albedo #cccccc, no speckles), roughness 0.5, no metal. The page maps the colour with
  // AgX, which turns a plain light grey into a cold white under the warm key light: the albedo is multiplied toward a warm
  // off-white, so that what reaches the screen is the same plain egg as the game's, lit by the page's lights.
  const matOuter = new THREE.MeshStandardMaterial({
    color: GAME_EGG.albedo,
    roughness: GAME_EGG.roughness,
    metalness: 0,
    emissive: new THREE.Color(1.0, 0.55, 0.2),
    emissiveIntensity: 0,
  })
  matOuter.color.multiply(new THREE.Color(1.0, 0.93, 0.8))
  const matInner = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 })
  matInner.color.setRGB(1.0, 0.93, 0.8)
  const matCrack = new THREE.MeshBasicMaterial({
    color: 0x2b1d12,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  })
  const crackDark = new THREE.Color(0x2b1d12)
  const crackGlow = new THREE.Color(0xffc56a)
  const materials: THREE.Material[] = [matOuter, matInner, matCrack]

  // ----- extras: flash, floor light, rooster shadow -----
  const burstTex = radialTexture([
    [0, "rgba(255,236,190,1)"],
    [0.25, "rgba(255,200,120,0.55)"],
    [1, "rgba(255,170,80,0)"],
  ])
  const burst = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: burstTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 0,
    }),
  )
  burst.visible = false
  burst.renderOrder = 10
  group.add(burst)

  const glowTex = radialTexture([
    [0, "rgba(255,190,110,1)"],
    [0.45, "rgba(255,170,90,0.35)"],
    [1, "rgba(255,150,70,0)"],
  ])
  const floorGlowMaterial = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    opacity: 0,
  })
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorGlowMaterial)
  floorGlow.rotation.x = -Math.PI / 2
  floorGlow.renderOrder = 1
  floorGlow.visible = false
  group.add(floorGlow)

  const shadowTex = radialTexture([
    [0, "rgba(0,0,0,1)"],
    [0.5, "rgba(0,0,0,0.55)"],
    [1, "rgba(0,0,0,0)"],
  ])
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 })
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterial)
  shadow.rotation.x = -Math.PI / 2
  shadow.renderOrder = 2
  shadow.visible = false
  group.add(shadow)

  const rRoot = new THREE.Group() // feet at its origin: position, tumble, squash
  rRoot.rotation.order = "YXZ"
  rRoot.visible = false
  const rScale = new THREE.Group() // the rooster's size
  rRoot.add(rScale)
  group.add(rRoot)
  let roosterObj: THREE.Object3D | null = null

  // ----- state -----
  let H = 0
  let floorY = 0
  let tCrack0 = 0
  let tBreak = 0
  let pieces: Piece[] = []
  let nPieces = 0
  let pshrink = new Float64Array(0) // per piece: 0 = drawn whole, 1 = shrunk away (the ones that would end in the rooster's way)
  let sorted = false // the keep / shrink choice has been made
  let S = new Float64Array(0) // per-piece rigid body state: p(3) q(4) v(3) w(3) sleep timer, asleep
  let t = 0
  let acc = 0
  let released = false
  let doneFired = false
  let landed = false // the rooster has touched the floor once
  let rooHeld = false // the rooster at rest on the floor
  // wobble springs: tilt about x and z, squash, hop
  let wx = 0
  let wz = 0
  let wvx = 0
  let wvz = 0
  let sq = 0
  let sqv = 0
  let hop = 0
  let hopv = 0
  let shiver = 0
  let crackF = 0
  let knockDone = 0
  const ro: Rooster = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, sv: 0, ax: 0, ay: 0, az: 0, avx: 0, avy: 0, avz: 0, stretch: 0 }

  let phase: RevealEggPhase = "whole"
  const stats = { triangles: 0, drawCalls: 0, pieces: 0 }

  // ----- profile -----
  // the game egg's radius at normalised height u (-1 bottom .. 1 tip): linear in the angle, the table's own sampling
  function modelRadius(u: number) {
    const r = GAME_EGG.r
    const n = r.length - 1
    const f = (Math.acos(-Math.max(-1, Math.min(1, u))) / Math.PI) * n
    const i = Math.min(Math.floor(f), n - 1)
    return r[i] + (r[i + 1] - r[i]) * (f - i)
  }
  function profile(y: number) {
    if (P.stretch > 0) {
      // lower half a sphere, upper half the same sphere stretched upwards
      const d = y - (R - H)
      const k = P.stretch
      if (d <= -R || d >= k * R) return 0
      const q = d < 0 ? d / R : d / (k * R)
      return R * Math.sqrt(Math.max(0, 1 - q * q))
    }
    const u = y / H
    if (u <= -1 || u >= 1) return 0
    return R * modelRadius(u)
  }
  const halfHeight = () => (P.stretch > 0 ? (1 + P.stretch) / 2 : P.aspect) * R

  // ======================================================================================
  // build(): the shell pieces. Called by create and by setParams when the shape changes.
  // ======================================================================================
  function disposePieces() {
    for (const p of pieces) {
      body.remove(p.mesh)
      p.geometry.dispose()
    }
    pieces = []
    nPieces = 0
  }

  function build() {
    disposePieces()
    H = halfHeight()
    const th = P.thickness * R

    // --- the surface grid (seam vertices duplicated for the uv, topology uses wrapped ids) ---
    const NV = (SEG + 1) * (RINGS + 1)
    const gp = new Float32Array(NV * 3)
    const gn = new Float32Array(NV * 3)
    const guv = new Float32Array(NV * 2)
    const tOf = (j: number) => (Math.PI * j) / RINGS
    const radAt = (tt: number) => profile(-H * Math.cos(tt))
    for (let j = 0; j <= RINGS; j++) {
      const tt = tOf(j)
      const y = -H * Math.cos(tt)
      const r = radAt(tt)
      // outward normal in the (r, y) plane: (dy/dt, -dr/dt)
      const e = 1e-3
      const drdt = (radAt(Math.min(tt + e, Math.PI)) - radAt(Math.max(tt - e, 0))) / (Math.min(tt + e, Math.PI) - Math.max(tt - e, 0))
      const dydt = H * Math.sin(tt)
      let nr = dydt
      let ny = -drdt
      const nl = Math.hypot(nr, ny) || 1
      nr /= nl
      ny /= nl
      if (j === 0) {
        nr = 0
        ny = -1
      }
      if (j === RINGS) {
        nr = 0
        ny = 1
      }
      for (let i = 0; i <= SEG; i++) {
        const k = j * (SEG + 1) + i
        const a = ((i % SEG) / SEG) * Math.PI * 2
        gp[k * 3] = r * Math.cos(a)
        gp[k * 3 + 1] = y
        gp[k * 3 + 2] = r * Math.sin(a)
        gn[k * 3] = nr * Math.cos(a)
        gn[k * 3 + 1] = ny
        gn[k * 3 + 2] = nr * Math.sin(a)
        guv[k * 2] = i / SEG
        guv[k * 2 + 1] = j / RINGS
      }
    }
    const wid = (i: number, j: number) => (j === 0 ? 0 : j === RINGS ? 1 : 2 + (j - 1) * SEG + (i % SEG))
    // --- triangles: grid indices (va, vb, vc) and wrapped ids ---
    const tv: number[] = []
    const tw: number[] = []
    const pushTri = (a: [number, number], b: [number, number], c: [number, number]) => {
      const wa = wid(a[0], a[1])
      const wb = wid(b[0], b[1])
      const wc = wid(c[0], c[1])
      if (wa === wb || wb === wc || wa === wc) return // collapsed at a pole
      const ia = a[1] * (SEG + 1) + a[0]
      const ib = b[1] * (SEG + 1) + b[0]
      const ic = c[1] * (SEG + 1) + c[0]
      // wind counter-clockwise seen from outside
      const ux = gp[ib * 3] - gp[ia * 3]
      const uy = gp[ib * 3 + 1] - gp[ia * 3 + 1]
      const uz = gp[ib * 3 + 2] - gp[ia * 3 + 2]
      const vx = gp[ic * 3] - gp[ia * 3]
      const vy = gp[ic * 3 + 1] - gp[ia * 3 + 1]
      const vz = gp[ic * 3 + 2] - gp[ia * 3 + 2]
      const cx = uy * vz - uz * vy
      const cy = uz * vx - ux * vz
      const cz = ux * vy - uy * vx
      const d =
        cx * (gn[ia * 3] + gn[ib * 3] + gn[ic * 3]) +
        cy * (gn[ia * 3 + 1] + gn[ib * 3 + 1] + gn[ic * 3 + 1]) +
        cz * (gn[ia * 3 + 2] + gn[ib * 3 + 2] + gn[ic * 3 + 2])
      if (d >= 0) {
        tv.push(ia, ib, ic)
        tw.push(wa, wb, wc)
      } else {
        tv.push(ia, ic, ib)
        tw.push(wa, wc, wb)
      }
    }
    for (let j = 0; j < RINGS; j++) {
      for (let i = 0; i < SEG; i++) {
        pushTri([i, j], [i + 1, j], [i + 1, j + 1])
        pushTri([i, j], [i + 1, j + 1], [i, j + 1])
      }
    }
    const NT = tw.length / 3

    // --- edge adjacency over wrapped ids ---
    const edgeKey = (a: number, b: number) => (a < b ? a * 100003 + b : b * 100003 + a)
    const edgeTris = new Map<number, number[]>()
    for (let k = 0; k < NT; k++) {
      for (let e = 0; e < 3; e++) {
        const key = edgeKey(tw[k * 3 + e], tw[k * 3 + ((e + 1) % 3)])
        const l = edgeTris.get(key)
        if (l) l.push(k)
        else edgeTris.set(key, [k])
      }
    }
    const neighbour = (k: number, e: number) => {
      const l = edgeTris.get(edgeKey(tw[k * 3 + e], tw[k * 3 + ((e + 1) % 3)]))
      if (!l) return -1
      return l[0] === k ? (l.length > 1 ? l[1] : -1) : l[0]
    }

    // --- which piece each triangle belongs to: a noisy Voronoi of seeds on the shell ---
    const N = Math.max(4, Math.round(P.pieceCount))
    const seeds: V3[] = []
    const addSeed = (u: number, phi: number) => {
      const y = H * u
      const r = profile(y)
      seeds.push([r * Math.cos(phi), y, r * Math.sin(phi)])
    }
    addSeed(0.88, 0.4)
    addSeed(-0.88, 1.2)
    const rest = N - 2
    const nA = Math.ceil(rest * 0.45)
    const nB = rest - nA
    for (let i = 0; i < nA; i++) addSeed(0.36, 0.25 + (6.2832 * i) / nA)
    for (let i = 0; i < nB; i++) addSeed(-0.34, 0.95 + (6.2832 * (i + 0.5)) / nB)
    const owner = new Int16Array(NT)
    for (let k = 0; k < NT; k++) {
      let cx = 0
      let cy = 0
      let cz = 0
      for (let e = 0; e < 3; e++) {
        const v = tv[k * 3 + e]
        cx += gp[v * 3]
        cy += gp[v * 3 + 1]
        cz += gp[v * 3 + 2]
      }
      cx /= 3
      cy /= 3
      cz /= 3
      let best = 0
      let bd = 1e9
      for (let s = 0; s < N; s++) {
        const d = Math.hypot(cx - seeds[s][0], cy - seeds[s][1], cz - seeds[s][2])
        const f =
          1 +
          0.34 * (noise3((cx / R) * 3.6 + s * 5.1, (cy / R) * 3.6, (cz / R) * 3.6 - s * 2.3, 11) * 2 - 1) +
          0.16 * (noise3((cx / R) * 9 + s * 3.7, (cy / R) * 9, (cz / R) * 9, 23) * 2 - 1)
        if (d * f < bd) {
          bd = d * f
          best = s
        }
      }
      owner[k] = best
    }
    // islands: a piece's disconnected scraps below a few triangles go to the neighbouring piece they touch most
    const comp = new Int32Array(NT).fill(-1)
    let nComp = 0
    const stack: number[] = []
    for (let k = 0; k < NT; k++) {
      if (comp[k] >= 0) continue
      comp[k] = nComp
      stack.length = 0
      stack.push(k)
      const members: number[] = []
      while (stack.length) {
        const q = stack.pop() as number
        members.push(q)
        for (let e = 0; e < 3; e++) {
          const m = neighbour(q, e)
          if (m >= 0 && comp[m] < 0 && owner[m] === owner[k]) {
            comp[m] = nComp
            stack.push(m)
          }
        }
      }
      if (members.length < 14) {
        const votes = new Map<number, number>()
        for (const q of members) {
          for (let e = 0; e < 3; e++) {
            const m = neighbour(q, e)
            if (m >= 0 && owner[m] !== owner[k]) votes.set(owner[m], (votes.get(owner[m]) || 0) + 1)
          }
        }
        let bestO = -1
        let bv = 0
        votes.forEach((v, o) => {
          if (v > bv) {
            bv = v
            bestO = o
          }
        })
        if (bestO >= 0) for (const q of members) owner[q] = bestO
      }
      nComp++
    }

    // --- crack timing: cracks run out from two origins; key = distance (smaller appears first) ---
    const origin = (u: number, phi: number, delay: number): [number, number, number, number] => {
      const y = H * u
      const r = profile(y)
      return [r * Math.cos(phi), y, r * Math.sin(phi), delay * R]
    }
    const origins = [origin(0.3, 1.05, 0), origin(-0.38, 2.25, 0.45)]

    // --- per piece geometry ---
    const list: number[][] = []
    for (let s = 0; s < N; s++) list.push([])
    for (let k = 0; k < NT; k++) list[owner[k]].push(k)
    let maxKey = 1e-6
    const built: Piece[] = []
    for (let s = 0; s < N; s++) {
      const tris = list[s]
      if (!tris.length) continue
      // boundary edges (k, e) toward another piece
      const bEdges: Array<[number, number]> = []
      for (const k of tris) {
        for (let e = 0; e < 3; e++) {
          const m = neighbour(k, e)
          if (m >= 0 && owner[m] === s) continue
          bEdges.push([k, e])
        }
      }
      // centroid (mean of the triangle corners) and area
      let cx = 0
      let cy = 0
      let cz = 0
      let area = 0
      for (const k of tris) {
        for (let e = 0; e < 3; e++) {
          const v = tv[k * 3 + e]
          cx += gp[v * 3]
          cy += gp[v * 3 + 1]
          cz += gp[v * 3 + 2]
        }
      }
      cx /= tris.length * 3
      cy /= tris.length * 3
      cz /= tris.length * 3
      const T = tris.length
      const E = bEdges.length
      const nv = 6 * T + 12 * E
      const pos = new Float32Array(nv * 3)
      const nor = new Float32Array(nv * 3)
      const uv = new Float32Array(nv * 2)
      const col = new Float32Array(nv * 3).fill(1)
      let o = 0 // vertex write cursor
      const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number) => {
        pos[o * 3] = x - cx
        pos[o * 3 + 1] = y - cy
        pos[o * 3 + 2] = z - cz
        nor[o * 3] = nx
        nor[o * 3 + 1] = ny
        nor[o * 3 + 2] = nz
        uv[o * 2] = u
        uv[o * 2 + 1] = v
        col[o * 3] = r
        col[o * 3 + 1] = g
        col[o * 3 + 2] = b
        o++
      }
      // thickness varies a little over the shell, so the rims are not even
      const thick = (x: number, y: number, z: number) => th * (0.7 + 0.6 * noise3((x / R) * 5, (y / R) * 5, (z / R) * 5, 5))
      // 1) outer surface
      for (const k of tris) {
        for (let e = 0; e < 3; e++) {
          const v = tv[k * 3 + e]
          put(gp[v * 3], gp[v * 3 + 1], gp[v * 3 + 2], gn[v * 3], gn[v * 3 + 1], gn[v * 3 + 2], guv[v * 2], guv[v * 2 + 1], 1, 1, 1)
        }
        // seam fix: a triangle that wraps the uv seam keeps all u within one side
        const b0 = o - 3
        const u0 = uv[b0 * 2]
        const u1 = uv[(b0 + 1) * 2]
        const u2 = uv[(b0 + 2) * 2]
        const mx = Math.max(u0, u1, u2)
        const mn = Math.min(u0, u1, u2)
        if (mx - mn > 0.5) for (let q = 0; q < 3; q++) if (uv[(b0 + q) * 2] < 0.5) uv[(b0 + q) * 2] += 1
      }
      const outerCount = o
      // 2) inner surface: pushed in along the normal, wound the other way, pale
      const ic = [0.74, 0.74, 0.74]
      for (const k of tris) {
        const vs = [tv[k * 3], tv[k * 3 + 2], tv[k * 3 + 1]]
        for (let e = 0; e < 3; e++) {
          const v = vs[e]
          const x = gp[v * 3]
          const y = gp[v * 3 + 1]
          const z = gp[v * 3 + 2]
          const d = thick(x, y, z)
          put(x - gn[v * 3] * d, y - gn[v * 3 + 1] * d, z - gn[v * 3 + 2] * d, -gn[v * 3], -gn[v * 3 + 1], -gn[v * 3 + 2], 0, 0, ic[0], ic[1], ic[2])
        }
      }
      // 3) the broken edge: a wall from the outer to the inner surface, chalky white
      const wc = [0.8, 0.8, 0.8]
      for (const be of bEdges) {
        const k = be[0]
        const e = be[1]
        const va = tv[k * 3 + e]
        const vb = tv[k * 3 + ((e + 1) % 3)]
        const ax = gp[va * 3]
        const ay = gp[va * 3 + 1]
        const az = gp[va * 3 + 2]
        const bx = gp[vb * 3]
        const by = gp[vb * 3 + 1]
        const bz = gp[vb * 3 + 2]
        const na = [gn[va * 3], gn[va * 3 + 1], gn[va * 3 + 2]]
        const nb = [gn[vb * 3], gn[vb * 3 + 1], gn[vb * 3 + 2]]
        const da = thick(ax, ay, az)
        const db = thick(bx, by, bz)
        const ex = bx - ax
        const ey = by - ay
        const ez = bz - az
        const fnx = na[0] + nb[0]
        const fny = na[1] + nb[1]
        const fnz = na[2] + nb[2]
        // outward from the piece = e x n
        let wxn = ey * fnz - ez * fny
        let wyn = ez * fnx - ex * fnz
        let wzn = ex * fny - ey * fnx
        const wl = Math.hypot(wxn, wyn, wzn) || 1
        wxn /= wl
        wyn /= wl
        wzn /= wl
        const A: V3 = [ax, ay, az]
        const B: V3 = [bx, by, bz]
        const A2: V3 = [ax - na[0] * da, ay - na[1] * da, az - na[2] * da]
        const B2: V3 = [bx - nb[0] * db, by - nb[1] * db, bz - nb[2] * db]
        // two triangles A,B,B2 and A,B2,A2: the wall faces e x n when wound counter-clockwise seen from it
        const emit = (p: V3, q: V3, r: V3) => {
          const ux = q[0] - p[0]
          const uy = q[1] - p[1]
          const uz = q[2] - p[2]
          const vx = r[0] - p[0]
          const vy = r[1] - p[1]
          const vz = r[2] - p[2]
          const dd = (uy * vz - uz * vy) * wxn + (uz * vx - ux * vz) * wyn + (ux * vy - uy * vx) * wzn
          const tri = dd >= 0 ? [p, q, r] : [p, r, q]
          for (const v of tri) put(v[0], v[1], v[2], wxn, wyn, wzn, 0, 0, wc[0], wc[1], wc[2])
        }
        emit(A, B, B2)
        emit(A, B2, A2)
      }
      const innerEnd = o
      // 4) crack ribbons along the same edges, set a little way into the piece
      interface Ribbon {
        key: number
        A: V3
        B: V3
        A2: V3
        B2: V3
        n: V3
      }
      const ribbons: Ribbon[] = []
      const rw = 0.022 * R
      const lift = 0.006 * R
      for (const be of bEdges) {
        const k = be[0]
        const e = be[1]
        const va = tv[k * 3 + e]
        const vb = tv[k * 3 + ((e + 1) % 3)]
        const vc = tv[k * 3 + ((e + 2) % 3)]
        const a = [gp[va * 3], gp[va * 3 + 1], gp[va * 3 + 2]]
        const b = [gp[vb * 3], gp[vb * 3 + 1], gp[vb * 3 + 2]]
        const c = [gp[vc * 3], gp[vc * 3 + 1], gp[vc * 3 + 2]]
        const ex = b[0] - a[0]
        const ey = b[1] - a[1]
        const ez = b[2] - a[2]
        const el = Math.hypot(ex, ey, ez) || 1
        const exn = ex / el
        const eyn = ey / el
        const ezn = ez / el
        // direction in the triangle's plane, perpendicular to the edge, toward the third corner
        let dx = c[0] - a[0]
        let dy = c[1] - a[1]
        let dz = c[2] - a[2]
        const dp = dx * exn + dy * eyn + dz * ezn
        dx -= dp * exn
        dy -= dp * eyn
        dz -= dp * ezn
        const dl = Math.hypot(dx, dy, dz) || 1
        dx /= dl
        dy /= dl
        dz /= dl
        const nA = [gn[va * 3], gn[va * 3 + 1], gn[va * 3 + 2]]
        const nB = [gn[vb * 3], gn[vb * 3 + 1], gn[vb * 3 + 2]]
        const A: V3 = [a[0] + nA[0] * lift, a[1] + nA[1] * lift, a[2] + nA[2] * lift]
        const B: V3 = [b[0] + nB[0] * lift, b[1] + nB[1] * lift, b[2] + nB[2] * lift]
        const A2: V3 = [A[0] + dx * rw, A[1] + dy * rw, A[2] + dz * rw]
        const B2: V3 = [B[0] + dx * rw, B[1] + dy * rw, B[2] + dz * rw]
        const mx = (a[0] + b[0]) / 2
        const my = (a[1] + b[1]) / 2
        const mz = (a[2] + b[2]) / 2
        let key = 1e9
        for (const og of origins) key = Math.min(key, Math.hypot(mx - og[0], my - og[1], mz - og[2]) + og[3])
        key += 0.12 * R * noise3((mx / R) * 6, (my / R) * 6, (mz / R) * 6, 91)
        maxKey = Math.max(maxKey, key)
        ribbons.push({ key, A, B, A2, B2, n: [nA[0] + nB[0], nA[1] + nB[1], nA[2] + nB[2]] })
      }
      ribbons.sort((p, q) => p.key - q.key)
      const keys = new Float32Array(ribbons.length)
      ribbons.forEach((rb, idx) => {
        keys[idx] = rb.key
        const emit = (p: V3, q: V3, r: V3) => {
          const ux = q[0] - p[0]
          const uy = q[1] - p[1]
          const uz = q[2] - p[2]
          const vx = r[0] - p[0]
          const vy = r[1] - p[1]
          const vz = r[2] - p[2]
          const dd = (uy * vz - uz * vy) * rb.n[0] + (uz * vx - ux * vz) * rb.n[1] + (ux * vy - uy * vx) * rb.n[2]
          const tri = dd >= 0 ? [p, q, r] : [p, r, q]
          for (const v of tri) put(v[0], v[1], v[2], 0, 1, 0, 0, 0, 1, 1, 1)
        }
        emit(rb.A, rb.B, rb.B2)
        emit(rb.A, rb.B2, rb.A2)
      })
      // trim: ribbons count may be fewer vertices than reserved (never more)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, o * 3), 3))
      geo.setAttribute("normal", new THREE.BufferAttribute(nor.subarray(0, o * 3), 3))
      geo.setAttribute("uv", new THREE.BufferAttribute(uv.subarray(0, o * 2), 2))
      geo.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, o * 3), 3))
      geo.addGroup(0, outerCount, 0)
      geo.addGroup(outerCount, innerEnd - outerCount, 1)
      geo.addGroup(innerEnd, o - innerEnd, 2)
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4 * R)
      const mesh = new THREE.Mesh(geo, materials)
      mesh.frustumCulled = false
      mesh.position.set(cx, cy, cz)
      body.add(mesh)

      // collision points: farthest-point sampling over the piece's outer vertices
      const pts: V3[] = []
      const seen = new Set<number>()
      for (const k of tris) {
        for (let e = 0; e < 3; e++) {
          const v = tv[k * 3 + e]
          const id = tw[k * 3 + e]
          if (seen.has(id)) continue
          seen.add(id)
          pts.push([gp[v * 3] - cx, gp[v * 3 + 1] - cy, gp[v * 3 + 2] - cz])
        }
      }
      const chosen: number[] = []
      let far = 0
      let fd = -1
      pts.forEach((p, idx) => {
        const d = Math.hypot(p[0], p[1], p[2])
        if (d > fd) {
          fd = d
          far = idx
        }
      })
      chosen.push(far)
      const mind = pts.map((p) => Math.hypot(p[0] - pts[far][0], p[1] - pts[far][1], p[2] - pts[far][2]))
      while (chosen.length < Math.min(CONTACTS, pts.length)) {
        let bi = 0
        let bdv = -1
        mind.forEach((d, idx) => {
          if (d > bdv) {
            bdv = d
            bi = idx
          }
        })
        chosen.push(bi)
        for (let idx = 0; idx < pts.length; idx++) {
          mind[idx] = Math.min(mind[idx], Math.hypot(pts[idx][0] - pts[bi][0], pts[idx][1] - pts[bi][1], pts[idx][2] - pts[bi][2]))
        }
      }
      const cp = new Float32Array(CONTACTS * 3)
      chosen.forEach((idx, q) => {
        cp[q * 3] = pts[idx][0]
        cp[q * 3 + 1] = pts[idx][1]
        cp[q * 3 + 2] = pts[idx][2]
      })
      let rg = 0
      for (const p of pts) rg += p[0] * p[0] + p[1] * p[1] + p[2] * p[2]
      rg = Math.sqrt(rg / pts.length)
      // area, for the mass
      for (const k of tris) {
        const a = tv[k * 3] * 3
        const b = tv[k * 3 + 1] * 3
        const c = tv[k * 3 + 2] * 3
        const ux = gp[b] - gp[a]
        const uy = gp[b + 1] - gp[a + 1]
        const uz = gp[b + 2] - gp[a + 2]
        const vx = gp[c] - gp[a]
        const vy = gp[c + 1] - gp[a + 1]
        const vz = gp[c + 2] - gp[a + 2]
        area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
      }
      const mass = area / (R * R)
      built.push({ mesh, geometry: geo, keys, cx, cy, cz, cp, invM: 1 / mass, invI: 1 / (mass * rg * rg * 0.9), cnt: 0 })
    }
    for (const p of built) for (let i = 0; i < p.keys.length; i++) p.keys[i] /= maxKey
    pieces = built
    nPieces = built.length
    S = new Float64Array(nPieces * SW)
    pshrink = new Float64Array(nPieces)
    // stats
    let tri = 0
    for (const p of pieces) tri += p.geometry.attributes.position.count / 3
    stats.triangles = tri
    stats.drawCalls = nPieces * 3
    stats.pieces = nPieces
    launchPlan()
  }

  // ----- the burst: where each piece is thrown (seeded: the same every time) -----
  let plan = new Float32Array(0) // nPieces * 6: vx, vy, vz, wx, wy, wz
  function launchPlan() {
    const rnd = mulberry(P.seed * 7919 + 5)
    plan = new Float32Array(nPieces * 6)
    pieces.forEach((p, i) => {
      // The shells fly to the two sides, away from the middle where the rooster lands and the page's title and button are;
      // the pieces on the viewer's side do not fly at the lens, and the ones that start in the middle go to alternate sides.
      const hl = Math.hypot(p.cx, p.cz)
      let dx = Math.abs(p.cx) < 0.25 * R ? (i % 2 ? 1 : -1) : Math.sign(p.cx)
      let dz = hl < 0.2 * R ? -0.5 : (0.45 * p.cz) / hl
      if (dz > 0) dz *= 0.1
      const dl = Math.hypot(dx, dz) || 1
      dx /= dl
      dz /= dl
      const u = p.cy / H
      let hs = (1.9 + rnd() * 0.9) * R
      let vy = (1.1 + 2.6 * Math.max(u, -0.1) + rnd() * 1.1) * R
      if (u > 0.7) {
        // the cap pops up
        vy = (4.2 + rnd() * 0.8) * R
        hs = (0.5 + rnd() * 0.5) * R
      }
      if (u < -0.7) {
        // the bottom drops out and aside
        vy = -0.4 * R
        hs = (1.5 + rnd() * 0.4) * R
      }
      if (u <= 0.7 && u > -0.7 && u < 0) hs *= 1.25
      const sp = 6 + rnd() * 6
      plan[i * 6] = dx * hs
      plan[i * 6 + 1] = vy
      plan[i * 6 + 2] = dz * hs
      // tumble about the horizontal axis across the flight direction, so the piece turns outward
      plan[i * 6 + 3] = dz * sp * (rnd() < 0.5 ? 1 : 0.7)
      plan[i * 6 + 4] = (rnd() - 0.5) * 6
      plan[i * 6 + 5] = -dx * sp * (rnd() < 0.5 ? 1 : 0.7)
    })
  }

  // ======================================================================================
  // simulation
  // ======================================================================================
  function derive() {
    H = halfHeight()
    floorY = -H - P.landingHeight * R
    tCrack0 = P.wobbleTime * KNOCKS[1]
    tBreak = Math.max(P.wobbleTime, tCrack0 + P.crackTime) + 0.1
  }

  function resetState() {
    t = 0
    acc = 0
    released = false
    doneFired = false
    landed = false
    rooHeld = false
    sorted = false
    wx = wz = wvx = wvz = sq = sqv = hop = hopv = shiver = crackF = 0
    knockDone = 0
    for (let i = 0; i < nPieces; i++) {
      const b = i * SW
      const p = pieces[i]
      S.fill(0, b, b + SW)
      pshrink[i] = 0
      S[b] = p.cx
      S[b + 1] = p.cy
      S[b + 2] = p.cz
      S[b + 6] = 1
      p.cnt = 0
    }
    phase = "whole"
  }

  function knock(i: number) {
    // an impulse from inside: the egg is hit toward one side, and hops a little
    const sgn = i === 1 ? -1 : 1
    const k = 1.7 + 0.8 * i
    wvz += sgn * k * 1.0
    wvx += (i === 2 ? -1 : 1) * k * 0.55
    sqv += -0.5 * (1 + i * 0.4)
    hopv += (0.5 + 0.2 * i) * R
  }

  function releasePieces() {
    released = true
    for (let i = 0; i < nPieces; i++) {
      const b = i * SW
      S[b + 7] = plan[i * 6]
      S[b + 8] = plan[i * 6 + 1]
      S[b + 9] = plan[i * 6 + 2]
      S[b + 10] = plan[i * 6 + 3]
      S[b + 11] = plan[i * 6 + 4]
      S[b + 12] = plan[i * 6 + 5]
    }
    // the rooster: squashed from being curled up, pops out and falls; it starts turned aside and tipped
    ro.x = 0
    ro.z = 0.05 * R
    ro.y = -H * 0.8
    ro.vx = 0.12 * R
    ro.vy = 1.7 * R
    ro.vz = 0.9 * R
    ro.s = -0.2
    ro.sv = 3.2
    ro.stretch = 0
    ro.ax = -0.35
    ro.ay = 0.8
    ro.az = 0.25
    ro.avx = 0.4
    ro.avy = -2.0
    ro.avz = -0.8
    rRoot.visible = !!roosterObj
    shadow.visible = true
    burst.visible = true
    phase = "open"
  }

  // rigid pieces: one fixed step
  function stepPieces(h: number) {
    const g = P.gravity * R
    const floor = floorY
    const mu = 0.55
    const arena = P.arena * R
    for (let i = 0; i < nPieces; i++) {
      const b = i * SW
      if (S[b + 14] > 0) continue // asleep
      let px = S[b]
      let py = S[b + 1]
      let pz = S[b + 2]
      let qx = S[b + 3]
      let qy = S[b + 4]
      let qz = S[b + 5]
      let qw = S[b + 6]
      let vx = S[b + 7]
      let vy = S[b + 8]
      let vz = S[b + 9]
      let ox = S[b + 10]
      let oy = S[b + 11]
      let oz = S[b + 12]
      const p = pieces[i]
      const invM = p.invM
      const invI = p.invI
      const cp = p.cp
      vy -= g * h
      px += vx * h
      py += vy * h
      pz += vz * h
      // q += 0.5 h (w, 0) q
      const hh = 0.5 * h
      const dqx = ox * qw + oy * qz - oz * qy
      const dqy = oy * qw + oz * qx - ox * qz
      const dqz = oz * qw + ox * qy - oy * qx
      const dqw = -(ox * qx + oy * qy + oz * qz)
      qx += hh * dqx
      qy += hh * dqy
      qz += hh * dqz
      qw += hh * dqw
      const ql = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
      qx *= ql
      qy *= ql
      qz *= ql
      qw *= ql
      // rotation matrix
      const xx = qx * qx
      const yy = qy * qy
      const zz = qz * qz
      const xy = qx * qy
      const xz = qx * qz
      const yz = qy * qz
      const wxq = qw * qx
      const wyq = qw * qy
      const wzq = qw * qz
      const m00 = 1 - 2 * (yy + zz)
      const m01 = 2 * (xy - wzq)
      const m02 = 2 * (xz + wyq)
      const m10 = 2 * (xy + wzq)
      const m11 = 1 - 2 * (xx + zz)
      const m12 = 2 * (yz - wxq)
      const m20 = 2 * (xz - wyq)
      const m21 = 2 * (yz + wxq)
      const m22 = 1 - 2 * (xx + yy)
      let touching = false
      for (let pass = 0; pass < 2; pass++) {
        let deepest = 0
        for (let k = 0; k < CONTACTS; k++) {
          const lx = cp[k * 3]
          const ly = cp[k * 3 + 1]
          const lz = cp[k * 3 + 2]
          const rx = m00 * lx + m01 * ly + m02 * lz
          const ry = m10 * lx + m11 * ly + m12 * lz
          const rz = m20 * lx + m21 * ly + m22 * lz
          const pen = floor - (py + ry)
          if (pen <= 0) continue
          touching = true
          if (pen > deepest) deepest = pen
          const vcy = vy + (oz * rx - ox * rz)
          if (vcy >= 0) continue
          const eff = invM + (rx * rx + rz * rz) * invI
          const e = -vcy > 1.6 * R ? 0.34 : 0
          const jn = (-(1 + e) * vcy) / eff
          vy += jn * invM
          ox += invI * (-rz * jn)
          oz += invI * (rx * jn)
          // friction
          const vcx = vx + (oy * rz - oz * ry)
          const vcz = vz + (ox * ry - oy * rx)
          const sp = Math.hypot(vcx, vcz)
          if (sp < 1e-6) continue
          const tx = vcx / sp
          const tz = vcz / sp
          const rt = rx * tx + rz * tz
          const effT = invM + (rx * rx + ry * ry + rz * rz - rt * rt) * invI
          const jt = Math.min(mu * jn, sp / effT)
          const jx = -jt * tx
          const jz = -jt * tz
          vx += jx * invM
          vz += jz * invM
          ox += invI * (ry * jz)
          oy += invI * (rz * jx - rx * jz)
          oz += invI * (-ry * jx)
        }
        py += deepest
      }
      if (touching) {
        // rolling resistance
        const d = 1 - 2.6 * h
        ox *= d
        oy *= d
        oz *= d
        vx *= 1 - 0.9 * h
        vz *= 1 - 0.9 * h
      }
      // invisible wall around the scene
      const dist = Math.hypot(px, pz)
      if (dist > arena) {
        const nx = px / dist
        const nz = pz / dist
        const vr = vx * nx + vz * nz
        if (vr > 0) {
          vx -= 1.6 * vr * nx
          vz -= 1.6 * vr * nz
        }
      }
      // sleep
      const slow = vx * vx + vy * vy + vz * vz < 0.05 * R * R && ox * ox + oy * oy + oz * oz < 2.0
      if (touching && slow) S[b + 13] += h
      else S[b + 13] = 0
      if (S[b + 13] > 0.18) {
        vx = vy = vz = ox = oy = oz = 0
        S[b + 14] = 1
      }
      S[b] = px
      S[b + 1] = py
      S[b + 2] = pz
      S[b + 3] = qx
      S[b + 4] = qy
      S[b + 5] = qz
      S[b + 6] = qw
      S[b + 7] = vx
      S[b + 8] = vy
      S[b + 9] = vz
      S[b + 10] = ox
      S[b + 11] = oy
      S[b + 12] = oz
    }
  }

  // The shells that lie beside the rooster stay; the ones on or in front of it (in front of the title and button on the page) shrink away.
  function sortPieces() {
    sorted = true
    const limit = P.arena * R * 1.15
    // narrow page: the arena is small, so a few shells may lie partly behind the wings
    const keepX = Math.min(0.62 * P.roosterScale * 2 * H + 0.6 * R, 0.7 * P.arena * R)
    for (let i = 0; i < nPieces; i++) {
      const x = Math.abs(S[i * SW])
      const z = S[i * SW + 2]
      if (x < keepX || x > limit || z > 0.9 * R) pshrink[i] = 1e-6
    }
  }

  // the rooster: ballistic fall, tumble that rights itself, squash and stretch on a spring
  function stepRooster(h: number) {
    const g = P.gravity * R
    ro.vy -= g * h
    ro.x += ro.vx * h
    ro.y += ro.vy * h
    ro.z += ro.vz * h
    // squash spring (volume-keeping scale is applied in the pose)
    const w = 19
    const z = 0.3
    ro.sv += (-w * w * ro.s - 2 * z * w * ro.sv) * h
    ro.s += ro.sv * h
    // the tumble settles to upright, facing +Z (the viewer)
    const k = 120
    const c = 14.5
    ro.avx += (-k * ro.ax - c * ro.avx) * h
    ro.ax += ro.avx * h
    ro.avy += (-k * ro.ay - c * ro.avy) * h
    ro.ay += ro.avy * h
    ro.avz += (-k * ro.az - c * ro.avz) * h
    ro.az += ro.avz * h
    const fy = floorY
    if (ro.y <= fy && ro.vy < 0) {
      const vi = -ro.vy
      ro.y = fy
      if (!landed) {
        landed = true
        if (phase === "open") phase = "dropped"
      }
      // the landing: compress the spring in proportion to the impact, then a small bounce
      // (only a real impact: resting on the floor, gravity makes this branch run every step)
      if (vi > 1.1 * R) {
        ro.sv -= (0.82 * vi) / R
        ro.vx *= 0.35
        ro.vz *= 0.35
        ro.avx += 0.4 * (ro.ax > 0 ? -1 : 1)
        ro.avz += 0.4 * (ro.az > 0 ? -1 : 1)
        ro.vy = vi * 0.27
      } else {
        ro.vy = 0
        rooHeld = true
      }
    }
    if (landed) {
      // it ends in the middle of the floor, facing the viewer
      ro.vx += (-60 * ro.x - 11 * ro.vx) * h
      ro.vz += (-60 * (ro.z - ROO_Z * R) - 11 * ro.vz) * h
    }
    if (rooHeld) {
      ro.vx *= 1 - 6 * h
      ro.vz *= 1 - 6 * h
    }
    ro.stretch = Math.min((Math.abs(ro.vy) / R) * 0.021, 0.17) * (ro.y > fy + 1e-6 ? 1 : 0)
  }

  // the rooster stands: its tumble has died away
  const upright = () =>
    Math.abs(ro.ax) + Math.abs(ro.ay) + Math.abs(ro.az) < 0.03 && Math.abs(ro.avx) + Math.abs(ro.avy) + Math.abs(ro.avz) < 0.3

  function stepAll(h: number) {
    t += h
    // wobble springs (egg tilt about x, z; squash; hop)
    while (knockDone < 3 && t >= P.wobbleTime * KNOCKS[knockDone]) {
      knock(knockDone)
      knockDone++
    }
    const w = 21
    const z = 0.13
    wvx += (-w * w * wx - 2 * z * w * wvx) * h
    wx += wvx * h
    wvz += (-w * w * wz - 2 * z * w * wvz) * h
    wz += wvz * h
    sqv += (-30 * 30 * sq - 2 * 0.15 * 30 * sqv) * h
    sq += sqv * h
    hopv += (-26 * 26 * hop - 2 * 0.2 * 26 * hopv) * h
    hop += hopv * h
    // crack front: a tick, a pause, then it runs
    const tau = Math.min(Math.max((t - tCrack0) / P.crackTime, 0), 1)
    crackF = tau <= 0 ? 0 : 0.07 * smooth(0, 0.18, tau) + 0.93 * Math.pow(smooth(0.2, 1, tau), 1.6)
    if (tau > 0 && tau < 1) crackF = Math.max(crackF, 0.001)
    shiver = smooth(tCrack0, tBreak, t)
    if (!released && t >= tBreak) releasePieces()
    if (!released) return
    stepPieces(h)
    stepRooster(h)
    if (phase === "done") return
    const tt = t - tBreak
    if (!sorted && tt >= SORT_AT) sortPieces()
    for (let i = 0; i < nPieces; i++) if (pshrink[i] > 0) pshrink[i] = Math.min(pshrink[i] + h / SHRINK_TIME, 1)
    // done: the rooster stands still and the shells that stay have come to rest or been shrunk away
    const settled = rooHeld && Math.abs(ro.s) < 0.03 && Math.abs(ro.sv) < 0.4 && tt > SORT_AT + SHRINK_TIME && upright()
    if (settled || tt > 2.4) {
      for (let i = 0; i < nPieces; i++) {
        const b = i * SW
        S[b + 14] = 1
        S[b + 7] = S[b + 8] = S[b + 9] = S[b + 10] = S[b + 11] = S[b + 12] = 0
        if (pshrink[i] > 0) pshrink[i] = 1
      }
      phase = "done"
    }
  }

  // The rooster pops out smaller than it ends and swells to its size with a little overshoot.
  function roosterGrow() {
    if (!released) return 1
    const tt = t - tBreak
    return 1 - (1 - P.roosterPop) * Math.exp(-7 * tt) * Math.cos(8 * tt)
  }
  function placeRooster() {
    if (!roosterObj) return
    const hr = P.roosterScale * 2 * H * roosterGrow()
    rScale.scale.set(hr, hr, hr)
  }

  // ----- writing the state into the scene graph (once per update) -----
  function applyPose() {
    const calm = 1 - smooth(tBreak - 0.2, tBreak, t) // the wobble dies away before the burst
    const pivotY = -0.3 * H
    if (!released) {
      const sv = 1 + sq * 0.12 * calm
      tilt.rotation.set(wx * calm, 0, wz * calm)
      tilt.scale.set(1 / Math.sqrt(sv), sv, 1 / Math.sqrt(sv))
      // a shiver once the shell is nearly through: tiny, fast, growing
      const sh = shiver * shiver * 0.014 * R * calm
      tilt.position.set(Math.sin(t * 83) * sh, pivotY + hop * calm + Math.sin(t * 71 + 1) * sh, Math.cos(t * 67) * sh * 0.6)
      body.position.y = -pivotY
    } else {
      tilt.rotation.set(0, 0, 0)
      tilt.scale.set(1, 1, 1)
      tilt.position.set(0, pivotY, 0)
      body.position.y = -pivotY
    }
    // glow from inside as it cracks
    const f = crackF
    matOuter.emissiveIntensity = released ? 0 : 0.45 * f * f
    matCrack.color.copy(crackDark).lerp(crackGlow, smooth(0.3, 1, f))
    // cracks: reveal the ribbons whose key the front has passed
    const show = !released && f > 0
    matCrack.visible = show
    for (let i = 0; i < nPieces; i++) {
      const p = pieces[i]
      const b = i * SW
      const keys = p.keys
      if (show) {
        let c = p.cnt
        while (c < keys.length && keys[c] <= f) c++
        while (c > 0 && keys[c - 1] > f) c--
        p.cnt = c
        p.geometry.groups[2].count = c * 6
      }
      p.mesh.position.set(S[b], S[b + 1], S[b + 2])
      p.mesh.quaternion.set(S[b + 3], S[b + 4], S[b + 5], S[b + 6])
      const sc = 1 - smooth(0, 1, pshrink[i])
      p.mesh.scale.set(sc, sc, sc)
      p.mesh.visible = sc > 0.01
    }
    // the floor's pool of light: comes on with the glow in the cracks
    const gl = P.floorGlow * smooth(tCrack0, tBreak + 0.35, t)
    floorGlow.visible = gl > 0.001
    floorGlowMaterial.opacity = gl
    floorGlow.position.set(0, floorY + 0.004 * R, 0.2 * R)
    floorGlow.scale.set(6.2 * R, 6.2 * R, 1)
    // the flash at the burst
    if (released) {
      const tt = t - tBreak
      const a = 0.75 * Math.exp(-tt * 8) * smooth(0, 0.02, tt)
      burst.material.opacity = a
      burst.visible = a > 0.01
      const sc = (2.2 + tt * 9) * R
      burst.scale.set(sc, sc, 1)
    } else burst.visible = false
    // rooster
    if (released && roosterObj) {
      const sy = Math.max(0.35, 1 + ro.s + ro.stretch)
      const sxz = 1 / Math.sqrt(sy)
      rRoot.position.set(ro.x, ro.y, ro.z)
      rRoot.rotation.set(ro.ax, ro.ay, ro.az)
      rRoot.scale.set(sxz, sy, sxz)
      placeRooster()
      const hgt = Math.max(ro.y - floorY, 0) / R
      shadow.position.set(ro.x, floorY + 0.008 * R, ro.z)
      const ss = (0.95 + 0.3 * Math.min(hgt, 2)) * R * 1.3
      shadow.scale.set(ss, ss, 1)
      shadowMaterial.opacity = 0.55 * (1 - smooth(0, 3.2, hgt)) * smooth(0, 0.3, t - tBreak)
    } else shadow.visible = false
  }

  // ======================================================================================
  // API
  // ======================================================================================
  // The page's AgX curve clips the model's flat colours (a white body at 0.9 under the reveal lights, a pure red comb that
  // turns orange): the body is dimmed and warmed so its shading shows, the comb deepened so it stays red. Once per object.
  const TUNE: ReadonlyArray<readonly [number, number, number] | undefined> = [
    [0.8, 0.7, 0.55], // body
    [0.62, 0.5, 0.5], // comb
    undefined, // beak
    undefined, // legs
    [0.7, 0.7, 0.7], // eye
  ]
  function tuneRooster(obj: THREE.Object3D) {
    if (obj.userData.tuned) return
    obj.userData.tuned = true
    obj.traverse((m) => {
      if (!(m instanceof THREE.Mesh) || !Array.isArray(m.material)) return
      m.material.forEach((mt: THREE.Material, i: number) => {
        const f = TUNE[i]
        if (!f || !(mt instanceof THREE.MeshStandardMaterial)) return
        mt.color.r *= f[0]
        mt.color.g *= f[1]
        mt.color.b *= f[2]
      })
    })
  }

  const api: RevealEgg = {
    group,
    materials: { outer: matOuter, inner: matInner, crack: matCrack },
    get phase() {
      return phase
    },
    onDone: null,
    stats,
    profile,
    setRooster(obj) {
      if (roosterObj) rScale.remove(roosterObj)
      roosterObj = obj || null
      if (roosterObj) {
        tuneRooster(roosterObj)
        rScale.add(roosterObj)
      }
      placeRooster()
      rRoot.visible = released && !!roosterObj
    },
    reset() {
      resetState()
      rRoot.visible = false
      shadow.visible = false
      burst.visible = false
      floorGlow.visible = false
      matCrack.visible = false
      for (const p of pieces) p.geometry.groups[2].count = 0
      applyPose()
    },
    play() {
      if (phase !== "whole") return
      phase = "cracking"
    },
    update(dt) {
      if (phase === "whole" || phase === "done") return
      acc += Math.min(dt, 0.25)
      while (acc >= STEP) {
        acc -= STEP
        stepAll(STEP)
        // stepAll may end the run (TS narrows `phase` to the value it had above)
        if ((phase as RevealEggPhase) === "done") {
          acc = 0
          break
        }
      }
      applyPose()
      if ((phase as RevealEggPhase) === "done" && !doneFired) {
        doneFired = true
        if (typeof api.onDone === "function") api.onDone()
      }
    },
    setParams(p) {
      let rebuild = false
      for (const k of Object.keys(p) as Array<keyof RevealEggParams>) {
        if (SHAPE_KEYS.indexOf(k) >= 0 && P[k] !== p[k]) rebuild = true
        if (p[k] !== undefined) P[k] = p[k] as number
      }
      derive()
      if (rebuild) build()
      placeRooster()
      api.reset()
    },
    dispose() {
      disposePieces()
      burstTex.dispose()
      glowTex.dispose()
      shadowTex.dispose()
      for (const m of materials) m.dispose()
      burst.material.dispose()
      floorGlowMaterial.dispose()
      floorGlow.geometry.dispose()
      shadowMaterial.dispose()
      shadow.geometry.dispose()
      if (group.parent) group.parent.remove(group)
    },
    // where the reveal happens, in the group's own space (for framing the camera and for colliders)
    extent() {
      return {
        radius: R,
        halfHeight: H,
        floorY,
        roosterHeight: P.roosterScale * 2 * H,
        roosterHalfWidth: 0.6 * P.roosterScale * 2 * H,
        arena: P.arena * R,
        topOfFlight: H + 1.0 * R,
        breakTime: tBreak,
        params: P,
      }
    },
  }

  derive()
  build()
  api.reset()
  placeRooster()
  return api
}
