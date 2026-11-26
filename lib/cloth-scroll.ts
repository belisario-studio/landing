// After the bake: how scroll, camera and title follow the recorded fall. Nothing here
// touches the frames. Pure arithmetic, shared by the worker and the page.
import { CAM_D, CAM_END, FRAME_DT, LAND_AT, SCROLL_LAG, TITLE } from "./cloth-config"
import type { ClothPlanet, ClothTimeline } from "./cloth-bake"

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

export const centroidOf = (f: Float32Array): [number, number, number] => {
  let x = 0, y = 0, z = 0
  const n = f.length / 3
  for (let i = 0; i < f.length; i += 3) {
    x += f[i]
    y += f[i + 1]
    z += f[i + 2]
  }
  return [x / n, y / n, z / n]
}

// Scroll progress (0..1) of every recorded frame. Up to the first touch (LAND_AT of the
// range) it mixes plain time with how far the sheet has dropped: all drop, and the view
// (which goes with the scroll) moves exactly as the sheet falls; the more plain time, the
// more the sheet, slow at first as anything that falls, is left behind and then catches
// up. From the touch to "draped" it is linear in time; what is left plays by itself at
// scroll = 1.
export function scrollMap(frames: Float32Array[], contact: number, hold: number): Float32Array {
  const n = frames.length
  const u = new Float32Array(n)
  const share = Math.min(0.1 + 0.55 * SCROLL_LAG, 1)
  const drops = new Float32Array(n)
  let drop = 0
  for (let k = 0; k <= contact; k++) {
    drop = Math.max(drop, -centroidOf(frames[k])[1])
    drops[k] = drop
  }
  const total = Math.max(drops[contact], 1e-6)
  for (let k = 0; k < n; k++) {
    if (k <= contact) u[k] = LAND_AT * (share * (k / Math.max(contact, 1)) + (1 - share) * (drops[k] / total))
    else if (k < hold) u[k] = LAND_AT + (1 - LAND_AT) * ((k - contact) / (hold - contact))
    else u[k] = 1
  }
  return u
}

// The camera is the page being scrolled: its height depends only on the scroll progress.
// It goes down from the page at rest to the framing of the moon. At the scroll position
// of the first touch it is CAM_END.ahead * lag below where the sheet's middle is at that
// moment (never past the final framing), and on the way there it runs ahead of a plain
// linear travel by CAM_END.early * lag at most; after the touch it eases to a stop.
function cameraHeight(u: number, planet: ClothPlanet): number {
  const yEnd = planet.y + CAM_END.targetY + CAM_END.rise
  const yTouch = Math.max(Math.min(planet.contactY - CAM_END.ahead * SCROLL_LAG, -0.05), yEnd)
  const bow = Math.min(CAM_END.early * SCROLL_LAG, 1) // <= 1 keeps it monotonic
  if (u <= LAND_AT) {
    const s = u / LAND_AT
    return yTouch * (s + bow * s * (1 - s))
  }
  // Cubic from the touch to the end: keeps the speed it arrives with, stops at the end.
  const w = 1 - LAND_AT, s = (u - LAND_AT) / w, dy = yEnd - yTouch
  const m = Math.max(((yTouch * (1 - bow)) / LAND_AT) * w, 3 * dy) // both negative; capped so it never turns back
  return yTouch + m * s + (3 * dy - 2 * m) * s * s + (m - 2 * dy) * s * s * s
}

/** Camera of every frame: [px, py, pz, tx, ty, tz] in heights. It pitches down only late, so the drape reads at the end. */
export function cameraPath(scroll: Float32Array, planet: ClothPlanet): Float32Array {
  const out = new Float32Array(scroll.length * 6)
  const dist = CAM_D * (1 + CAM_END.back)
  for (let k = 0; k < scroll.length; k++) {
    const u = scroll[k], s = smoothstep(0, 1, u)
    const x = planet.x * s
    const y = cameraHeight(u, planet)
    const z = CAM_D + (planet.z + dist - CAM_D) * s
    const pitch = Math.atan2(CAM_END.rise, dist) * smoothstep(CAM_END.pitchFrom, 1, u)
    out.set([x, y, z, x, y - Math.sin(pitch), z - Math.cos(pitch)], k * 6)
  }
  return out
}

/** Seconds of the whole timeline, the last sway included. */
export const durationOf = (tl: ClothTimeline) => (tl.frameCount - 1) * FRAME_DT

/** Scroll progress -> seconds, within [0, the moment the sheet is draped]. */
export function timeFor(tl: ClothTimeline, u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return tl.hold * FRAME_DT
  let lo = 0, hi = tl.hold
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (tl.scroll[mid] <= u) lo = mid
    else hi = mid
  }
  const span = tl.scroll[hi] - tl.scroll[lo]
  return (lo + (span > 0 ? (u - tl.scroll[lo]) / span : 0)) * FRAME_DT
}

/** Seconds -> scroll progress. */
export function scrollFor(tl: ClothTimeline, seconds: number): number {
  const last = tl.frameCount - 1
  const f = Math.min(Math.max(seconds / FRAME_DT, 0), last)
  const i = Math.min(Math.floor(f), last), j = Math.min(i + 1, last)
  return tl.scroll[i] + (tl.scroll[j] - tl.scroll[i]) * (f - i)
}

export interface TitlePose {
  /** Pixels, negative is up. */
  y: number
  scale: number
}
export const TITLE_AT_REST: TitlePose = { y: 0, scale: 1 }

// The title rises and shrinks toward 0.3 as the scroll progresses, translateY(-p·30% of
// the stage) scale(1 - 0.7p). At `stop` (the scroll position of TITLE.anchor seconds of
// the fall) it stops shrinking and leaves through the top of the stage, to be wholly out
// by TITLE.out. Both handovers are smooth: the shrinking dies away over TITLE.soft either
// side of the stop (ending at exactly the size the plain formula gives at the stop), and
// the climb starts at the speed the title already had.
export function titlePose(tl: ClothTimeline, progress: number, stageHeight: number, titleHeight: number): TitlePose {
  const p0 = Math.round(scrollFor(tl, TITLE.anchor) * 100) / 100
  const p1 = Math.max(TITLE.out, p0 + 0.05)
  const a = p0 - TITLE.soft
  const x = Math.min(Math.max(progress - a, 0), 2 * TITLE.soft)
  const scale = 1 - 0.7 * Math.min(progress, a) - 0.7 * (x - (x * x) / (4 * TITLE.soft))
  if (progress <= p0) return { y: -progress * 0.3 * stageHeight, scale }
  // Out = its bottom edge above the stage's top, with room for the mouse tilt.
  const out = stageHeight / 2 + titleHeight * (1 - 0.7 * p0) * 0.75 + 0.05 * stageHeight
  const y0 = -p0 * 0.3 * stageHeight, v0 = -0.3 * stageHeight * (p1 - p0)
  const q = Math.min((progress - p0) / (p1 - p0), 1)
  return { y: y0 + v0 * q + (-out - y0 - v0) * q * q, scale }
}
