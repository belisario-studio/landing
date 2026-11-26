import {
  bakeCloth,
  idleJob,
  liftJob,
  type ClothIdle,
  type ClothPlanet,
  type ClothTimeline,
  type LiftOptions,
  type LiftResult,
  type SimState,
} from "./cloth-bake"

export type BakeMessage = { type: "timeline"; timeline: ClothTimeline } | { type: "idle"; idle: ClothIdle }

/** Page to worker: bake the fall and the idle for a stage of this aspect (width / height). */
export interface BakeRequest {
  aspect: number
}
/**
 * Page to worker: bake the lift from the settled pose, once the timeline and the idle are in.
 * `planet` is the timeline's, `state` the end state of the bake (structured-cloned: do not transfer it); both
 * default to those of the last bake this worker made, which is what the page wants (the state never leaves
 * the worker). `egg` is how much taller than the moon's sphere the egg's upper half is (0: the plain moon,
 * 0.35: 35 % taller).
 */
export interface LiftRequest {
  type: "lift"
  id: number
  aspect: number
  planet?: ClothPlanet
  state?: SimState
  egg: number
  opts?: LiftOptions
}
/** Page to worker: stop working on this lift (no further message for it). */
export interface LiftCancel {
  type: "lift-cancel"
  id: number
}
export type WorkerRequest = BakeRequest | LiftRequest | LiftCancel

export type LiftMessage =
  | { type: "lift-progress"; id: number; progress: number }
  // Every result.frames[k].buffer is transferred.
  | { type: "lift-done"; id: number; result: LiftResult }
  | { type: "lift-error"; id: number; message: string }
export type WorkerMessage = BakeMessage | LiftMessage

const post = (message: WorkerMessage, buffers: Float32Array[] = []) =>
  (self as unknown as Worker).postMessage(
    message,
    buffers.map((b) => b.buffer as ArrayBuffer),
  )

const cancelled = new Set<number>()
// Where the last bake ended: the lift starts from it.
let lastBake: { planet: ClothPlanet; state: SimState } | null = null
// How long a piece of the lift works before the worker looks at its messages again, and how often it reports.
const LIFT_SLICE_MS = 25
const LIFT_PROGRESS_MS = 50

function runLift(m: LiftRequest) {
  try {
    const planet = m.planet ?? lastBake?.planet
    const state = m.state ?? lastBake?.state
    if (!planet || !state) throw new Error("no bake to lift from")
    const job = liftJob(m.aspect, planet, state, m.egg, m.opts)
    let last = 0
    const tick = () => {
      if (cancelled.delete(m.id)) return
      const result = job.step(LIFT_SLICE_MS)
      if (result) {
        post({ type: "lift-done", id: m.id, result }, result.frames)
        return
      }
      const now = Date.now()
      if (now - last > LIFT_PROGRESS_MS) {
        last = now
        post({ type: "lift-progress", id: m.id, progress: job.progress })
      }
      // Yield, so a "lift-cancel" can be handled between pieces.
      setTimeout(tick, 0)
    }
    tick()
  } catch (err) {
    post({ type: "lift-error", id: m.id, message: String((err as Error)?.message ?? err) })
  }
}

// The fall first, so the scroll can open as soon as it is ready; then the idle loop, which
// is only needed once the cloth has landed. Frames are transferred, not copied.
// A "lift" request is handled in pieces of LIFT_SLICE_MS, so a "lift-cancel" gets through.
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data
  if ("type" in m && m.type === "lift-cancel") {
    cancelled.add(m.id)
    return
  }
  if ("type" in m && m.type === "lift") {
    runLift(m)
    return
  }
  const { aspect } = m as BakeRequest
  const { timeline, state } = bakeCloth(aspect)
  lastBake = { planet: timeline.planet, state }
  post({ type: "timeline", timeline }, [timeline.frames, timeline.scroll, timeline.camera])
  const idle = idleJob(aspect, timeline.planet, state).step(Infinity)
  if (idle) post({ type: "idle", idle }, [idle.intro, idle.loop])
}
