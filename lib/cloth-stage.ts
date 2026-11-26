// The scroll-driven cloth's controller: everything behind the `fabric_scroll_background`
// flag that is not drawing. It bakes the fall for the viewport's shape, turns wheel and
// touch travel into a place on that timeline, and tells the WebGL scene what to draw.
// The page is one viewport and never scrolls. At rest it is the live 2D starfield; the
// moment the scroll leaves zero the starfield freezes and the cloth, textured with that
// very canvas, takes its place. Loaded on demand, so it costs nothing with the flag off.
import type { GalaxyHandle } from "@/components/galaxy-background"
import type { ClothIdle, ClothTimeline } from "./cloth-bake"
import type { BakeMessage } from "./cloth-bake.worker"
import { EASE_TAU, FRAME_DT, IDLE, LOOK, RELEASE_BELOW_S, SCROLL_HEIGHTS, SNAP } from "./cloth-config"
import type { ClothScene } from "./cloth-scene"
import { durationOf, scrollFor, smoothstep, timeFor, TITLE_AT_REST, titlePose, type TitlePose } from "./cloth-scroll"
import { agxRgb, hexToRgb, rgbToHex } from "./tone-map"

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

/** A colour of the starfield, as the cloth's tone curve leaves it on screen. */
export const starfieldTone = (hex: string) => rgbToHex(agxRgb(LOOK.exposure, hexToRgb(hex)))

// Runs the heavy per-aspect bake in a Web Worker so the main thread stays free (the
// loading spinner can spin). Without workers, or if the worker fails to load, it runs on
// the main thread: the fall blocks it once, the idle loop is worked out in slices.
// Returns what cancels it.
function startBake(
  aspect: number,
  onTimeline: (timeline: ClothTimeline) => void,
  onIdle: (idle: ClothIdle) => void,
): () => void {
  let cancelled = false
  let delivered = false
  let worker: Worker | null = null
  let timer = 0

  const bakeOnMainThread = async () => {
    const { bakeCloth, idleJob } = await import("./cloth-bake")
    if (cancelled) return
    const { timeline, state } = bakeCloth(aspect)
    onTimeline(timeline)
    const job = idleJob(aspect, timeline.planet, state)
    const slice = () => {
      if (cancelled) return
      const idle = job.step(6)
      if (idle) onIdle(idle)
      else timer = window.setTimeout(slice, 16)
    }
    slice()
  }

  if (typeof Worker === "undefined") {
    void bakeOnMainThread()
  } else {
    worker = new Worker(new URL("./cloth-bake.worker.ts", import.meta.url))
    worker.onmessage = (e: MessageEvent<BakeMessage>) => {
      delivered = true
      if (e.data.type === "timeline") onTimeline(e.data.timeline)
      else onIdle(e.data.idle)
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      if (!delivered && !cancelled) void bakeOnMainThread()
    }
    worker.postMessage({ aspect })
  }

  return () => {
    cancelled = true
    worker?.terminate()
    clearTimeout(timer)
  }
}

export interface ClothStageOptions {
  /** The starfield, already painting with starfieldTone. */
  galaxy: GalaxyHandle
  /** The title's heading: its height sets how far it travels. */
  title: () => HTMLElement | null
  /** Where the scroll puts the title. */
  onTitlePose: (pose: TitlePose) => void
  /** Whether the fall is still being worked out: scroll is ignored until it is not. */
  onLoading: (loading: boolean) => void
  /** The effect cannot be shown: the page stays the starfield. */
  onUnsupported: () => void
}

export interface ClothStage {
  /** The WebGL scene, once it exists, and null when it goes away. */
  setScene: (scene: ClothScene | null) => void
  setContextLost: (lost: boolean) => void
  dispose: () => void
}

export function startClothStage({ galaxy, title, onTitlePose, onLoading, onUnsupported }: ClothStageOptions): ClothStage {
  // One black for everything that is the page's background while the effect is on.
  document.documentElement.style.setProperty("--background", galaxy.background)

  let scene: ClothScene | null = null
  // ---------- Build: bake for the stage's shape, then hand the scene its timeline ----------
  let width = 0
  let height = 0
  let scrollFull = 1
  let timeline: ClothTimeline | null = null
  let idle: ClothIdle | null = null
  let build = 0
  let builtFor = -1 // the build the scene was last given
  let sceneReady = false
  let contextLost = false
  let cancelBake = () => {}
  const playable = () => sceneReady && !contextLost

  const giveSceneItsTimeline = () => {
    const target = scene
    const tl = timeline
    if (!target || !tl || builtFor === build) return
    const id = (builtFor = build)
    target.setTimeline(tl, width, height).then(
      () => {
        if (id !== build || scene !== target) return
        target.setIdle(idle)
        sceneReady = true
        onLoading(false)
      },
      // The moon's maps did not arrive: the page stays the starfield.
      () => {
        if (id === build) onUnsupported()
      },
    )
  }
  const rebuild = () => {
    width = window.innerWidth
    height = window.innerHeight
    scrollFull = height * SCROLL_HEIGHTS
    build++
    sceneReady = false
    timeline = null
    idle = null
    onLoading(true)
    cancelBake()
    cancelBake = startBake(
      width / height,
      (tl) => {
        timeline = tl
        giveSceneItsTimeline()
      },
      (loop) => {
        idle = loop
        if (sceneReady) scene?.setIdle(loop)
      },
    )
  }
  const stale = () => window.innerWidth !== width || window.innerHeight !== height

  // ---------- Playback ----------
  // The scroll is a target; the shown time eases toward it. The bake gives the scroll
  // progress of every frame: the fall up to the first touch follows the sheet's drop,
  // the draping takes the rest, and what is left after "draped" plays by itself once
  // the scroll is at its end. Then the idle loop keeps the cloth swaying.
  let clothUp = false
  let accum = 0 // pixels of scroll travel
  let t = 0 // seconds of the timeline being shown
  let shownT = -1
  let dirty = false
  let pose = TITLE_AT_REST
  let raf = 0
  let last = 0

  // The idle plays in real time, and only while the scroll is at its end and the last
  // sway has played out. idleT is its clock (the intro first, then the loop, round and
  // round); idleGain says how much of it is shown: 1 while it plays, and when the scroll
  // leaves the end it goes to 0 over IDLE.fade seconds with the clock still running, so
  // the cloth is handed back to the scroll from wherever the loop was, without a jump.
  let idleT = 0
  let idleGain = 0
  let shownIdle = ""
  const stepIdle = (dt: number, atEnd: boolean) => {
    if (document.hidden) return
    const want = atEnd && idle !== null
    if (!want && idleGain === 0) return
    if (want && idleGain === 0) {
      // From rest: the intro starts on the settled pose, and is already moving.
      idleT = dt
      idleGain = 1
      return
    }
    idleT += dt
    idleGain = clamp(idleGain + (want ? dt : -dt) / IDLE.fade, 0, 1)
  }

  let snapping = false
  let snapTimer = 0
  let touchHeld = false
  const cancelSnap = () => {
    snapping = false
    clearTimeout(snapTimer)
  }
  const startSnap = () => {
    if (!clothUp || touchHeld || !timeline) return
    const u = accum / scrollFull
    if (u <= 0 || timeFor(timeline, Math.min(u, 1)) > SNAP.zone) return
    snapping = true
    schedule()
  }
  const armSnap = () => {
    clearTimeout(snapTimer)
    snapTimer = window.setTimeout(startSnap, SNAP.stopMs)
  }
  // The snap moves the scroll TARGET back, SNAP.backSpeed timeline seconds per second,
  // and the shown time keeps easing toward it. Any new scroll input cancels it.
  const stepSnap = (tl: ClothTimeline, dt: number) => {
    const next = timeFor(tl, clamp(accum / scrollFull, 0, 1)) - dt * SNAP.backSpeed
    if (next <= 0) {
      accum = 0
      snapping = false
      return
    }
    accum = scrollFor(tl, next) * scrollFull
  }

  // Going in: stop the starfield on the frame it is showing, hand that very canvas to
  // the cloth as its texture and show the WebGL layer with the flat cloth already
  // drawn, all before the browser paints again.
  const raise = (layer: ClothScene) => {
    const live = galaxy.canvas
    if (live.width !== width || live.height !== height) return false
    galaxy.setFrozen(true)
    galaxy.setPaused(true)
    layer.refreshTexture()
    layer.draw(0, 0, 0, 1)
    layer.setVisible(true)
    clothUp = true
    return true
  }
  // Coming back: hide the WebGL layer and let the starfield go on from its frozen frame.
  // While frozen it ignored the mouse, so it eases on from the orientation it had.
  const lower = () => {
    cancelSnap()
    clothUp = false
    accum = 0
    t = 0
    shownT = -1
    idleT = 0
    idleGain = 0
    pose = TITLE_AT_REST
    onTitlePose(pose)
    scene?.setVisible(false)
    galaxy.setPaused(false)
    galaxy.setFrozen(false)
  }
  const reset = () => {
    lower()
    // A viewport that changed while the cloth was up is taken in now.
    if (stale()) rebuild()
  }

  const frame = (now: number) => {
    raf = 0
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    const tl = timeline
    if (!scene || !tl || !playable()) return
    if (snapping) stepSnap(tl, dt)
    const u = clamp(accum / scrollFull, 0, 1)
    const target = timeFor(tl, u)
    if (!clothUp) {
      // The frame the cloth goes up on is the rest pose itself, so the swap is exact.
      if (target > 0 && raise(scene)) schedule()
      else accum = 0
      return
    }
    const duration = durationOf(tl)
    if (u >= 1 && t >= tl.hold * FRAME_DT - 0.02) {
      t = Math.min(t + dt, duration) // the scroll is done: the last sway plays out
    } else {
      t += (target - t) * (1 - Math.exp(-dt / EASE_TAU))
      if (Math.abs(target - t) < 1e-4 || (target === 0 && t < RELEASE_BELOW_S)) t = target
      // Back at the top with nothing asked for: hand the page back to the live starfield.
      if (target === 0 && t === 0) {
        reset()
        return
      }
    }
    stepIdle(dt, u >= 1 && t >= duration)
    const idleKey = idleGain + "|" + idleT
    // The title's light follows the title: when the mouse tilts it or its move eases, draw again.
    if (dirty || Math.abs(t - shownT) > 1e-6 || idleKey !== shownIdle || scene.titleMoved()) {
      scene.draw(t, idleT, smoothstep(0, 1, idleGain), pose.scale)
      pose = titlePose(tl, scrollFor(tl, t), height, title()?.offsetHeight ?? 0)
      onTitlePose(pose)
      shownT = t
      shownIdle = idleKey
      dirty = false
    }
    schedule()
  }
  // The loop only runs while the cloth is up or on its way up.
  const schedule = () => {
    if (raf) return
    raf = requestAnimationFrame(frame)
  }
  const wake = () => {
    if (!raf) last = performance.now()
    schedule()
  }

  // ---------- Input ----------
  const applyDelta = (delta: number) => {
    if (!playable()) return
    cancelSnap()
    accum = clamp(accum + delta, 0, scrollFull)
    armSnap()
    wake()
  }
  const handleWheel = (e: WheelEvent) => {
    if (e.deltaMode === 1) applyDelta(e.deltaY * 16)
    else if (e.deltaMode === 2) applyDelta(e.deltaY * window.innerHeight)
    else applyDelta(e.deltaY)
  }
  let lastTouchY: number | null = null
  const handleTouchStart = (e: TouchEvent) => {
    lastTouchY = e.touches[0]?.clientY ?? null
    touchHeld = true
    cancelSnap()
  }
  const handleTouchMove = (e: TouchEvent) => {
    if (lastTouchY === null || e.touches.length === 0) return
    const y = e.touches[0].clientY
    applyDelta(lastTouchY - y)
    lastTouchY = y
  }
  // A finger resting on the page holds it where it is; the snap waits for it to lift.
  const handleTouchEnd = () => {
    lastTouchY = null
    if (!touchHeld) return
    touchHeld = false
    armSnap()
  }

  let resizeTimer = 0
  const handleResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      if (!stale()) return
      if (!clothUp) {
        rebuild()
        return
      }
      // With the cloth up, a pure height change is almost always the mobile URL bar and
      // must not disturb the drape: the view is refitted and the scene kept until the
      // cloth is back at rest. A width change starts over.
      if (window.innerWidth !== width) {
        reset()
        return
      }
      scene?.resizeView(window.innerWidth, window.innerHeight)
      dirty = true
    }, 200)
  }

  rebuild()
  window.addEventListener("wheel", handleWheel, { passive: true })
  window.addEventListener("touchstart", handleTouchStart, { passive: true })
  window.addEventListener("touchmove", handleTouchMove, { passive: true })
  window.addEventListener("touchend", handleTouchEnd, { passive: true })
  window.addEventListener("touchcancel", handleTouchEnd, { passive: true })
  window.addEventListener("resize", handleResize, { passive: true })

  return {
    setScene: (next) => {
      scene = next
      // A scene that went away takes the cloth down with it.
      if (!scene && clothUp) reset()
      builtFor = -1
      sceneReady = false
      giveSceneItsTimeline()
    },
    setContextLost: (lost) => {
      contextLost = lost
      if (lost && clothUp) reset()
    },
    dispose: () => {
      window.removeEventListener("wheel", handleWheel)
      window.removeEventListener("touchstart", handleTouchStart)
      window.removeEventListener("touchmove", handleTouchMove)
      window.removeEventListener("touchend", handleTouchEnd)
      window.removeEventListener("touchcancel", handleTouchEnd)
      window.removeEventListener("resize", handleResize)
      clearTimeout(resizeTimer)
      cancelAnimationFrame(raf)
      cancelBake()
      build++ // whatever the scene is still loading no longer counts
      if (clothUp) lower()
      cancelSnap()
      document.documentElement.style.removeProperty("--background")
    },
  }
}
