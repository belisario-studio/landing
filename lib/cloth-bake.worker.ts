import { bakeCloth, idleJob, type ClothIdle, type ClothTimeline } from "./cloth-bake"

export type BakeMessage = { type: "timeline"; timeline: ClothTimeline } | { type: "idle"; idle: ClothIdle }

// The fall first, so the scroll can open as soon as it is ready; then the idle loop, which
// is only needed once the cloth has landed. Frames are transferred, not copied.
self.onmessage = (e: MessageEvent<{ aspect: number }>) => {
  const post = (message: BakeMessage, buffers: Float32Array[]) =>
    (self as unknown as Worker).postMessage(
      message,
      buffers.map((b) => b.buffer as ArrayBuffer),
    )
  const { aspect } = e.data
  const { timeline, state } = bakeCloth(aspect)
  post({ type: "timeline", timeline }, [timeline.frames, timeline.scroll, timeline.camera])
  const idle = idleJob(aspect, timeline.planet, state).step(Infinity)
  if (idle) post({ type: "idle", idle }, [idle.intro, idle.loop])
}
