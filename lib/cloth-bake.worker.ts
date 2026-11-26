import { bakeClothFrames } from "../lib/cloth-bake"

self.onmessage = (e: MessageEvent<{ width: number; height: number }>) => {
  const { width, height } = e.data
  const frames = bakeClothFrames(width, height)
  ;(self as unknown as Worker).postMessage({ width, height, frames }, frames.map((f) => f.buffer))
}
