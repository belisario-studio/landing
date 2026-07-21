"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"
import GalaxyBackground from "@/components/galaxy-background"
import { getBakedClothFrames, setBakedClothFrames } from "@/lib/cloth-bake"

const ClothOverlay = dynamic(() => import("@/components/cloth-overlay"), { ssr: false })

const DEBUG_GRID = false

// Hysteresis band for the scroll trigger: this much accumulated wheel travel is
// needed to start the cloth, and once it is back at rest, the same extra travel
// upward is needed to release it and resume the starfield rotation — so
// imprecise scrolls near the boundary never flicker the effect on or off.
const SCROLL_ACTIVATION_MARGIN = 100

// When the user stops scrolling mid-drape, the progress snaps to the nearest end:
// below the threshold it returns to 0 (releasing back to the live starfield), at or
// above it completes to a full drape. SNAP_STOP_MS is how long the scroll must be
// idle before the snap arms.
const SNAP_THRESHOLD = 0.5
const SNAP_STOP_MS = 160

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function drawDebugGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const step = 40
  ctx.strokeStyle = "rgba(0, 255, 140, 0.5)"
  ctx.lineWidth = 1
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
}

interface BackgroundStageProps {
  fabricEnabled: boolean
  onProgress?: (progress: number) => void
}

export default function BackgroundStage({ fabricEnabled, onProgress }: BackgroundStageProps) {
  const [frozen, setFrozen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [clothMounted, setClothMounted] = useState(false)
  const [snapshotToken, setSnapshotToken] = useState(0)
  const [bakeReady, setBakeReady] = useState(false)

  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const progressRef = useRef(0)
  const scrollAccumRef = useRef(0)
  const pendingDownRef = useRef(0)
  const clothActiveRef = useRef(false)
  const bakeReadyRef = useRef(false)
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapRafRef = useRef<number | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  // Bumped on a real width (aspect) change to remount the overlay so it re-derives
  // geometry/sphere/camera from fresh dimensions instead of being stretched in place.
  const [resizeToken, setResizeToken] = useState(0)
  const scrollPxForFullRef = useRef(0)
  const lastWidthRef = useRef(0)

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    liveCanvasRef.current = canvas
  }, [])

  useEffect(() => {
    if (!fabricEnabled) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    scrollPxForFullRef.current = window.innerHeight * 1.3
    lastWidthRef.current = window.innerWidth

    const triggerCloth = () => {
      const live = liveCanvasRef.current
      if (!live || live.width === 0 || live.height === 0) return
      let snap = snapshotCanvasRef.current
      if (!snap) {
        snap = document.createElement("canvas")
        snapshotCanvasRef.current = snap
      }
      snap.width = live.width
      snap.height = live.height
      const ctx = snap.getContext("2d")
      if (ctx) {
        ctx.drawImage(live, 0, 0)
        if (DEBUG_GRID) drawDebugGrid(ctx, snap.width, snap.height)
      }

      clothActiveRef.current = true
      setFrozen(true)
      setClothMounted(true)
      setSnapshotToken((v) => v + 1)
    }

    const cancelSnap = () => {
      if (snapTimerRef.current) {
        clearTimeout(snapTimerRef.current)
        snapTimerRef.current = null
      }
      if (snapRafRef.current !== null) {
        cancelAnimationFrame(snapRafRef.current)
        snapRafRef.current = null
      }
    }

    // Once scrolling stops mid-drape, ease the accumulated scroll to the nearest
    // end so the drape never sits frozen half-way: below the threshold it rewinds
    // to 0 (and releases to the live starfield), otherwise it completes to full.
    const runSnap = () => {
      snapTimerRef.current = null
      const full = scrollPxForFullRef.current
      const p = progressRef.current
      const target = p >= SNAP_THRESHOLD ? full : 0
      const from = scrollAccumRef.current
      const start = performance.now()
      const duration = 300
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1)
        const e = easeInOutCubic(t)
        scrollAccumRef.current = from + (target - from) * e
        progressRef.current = Math.max(scrollAccumRef.current, 0) / full
        onProgressRef.current?.(progressRef.current)
        if (t < 1) {
          snapRafRef.current = requestAnimationFrame(tick)
          return
        }
        snapRafRef.current = null
        if (target === 0) {
          reset()
        } else {
          scrollAccumRef.current = full
        }
      }
      snapRafRef.current = requestAnimationFrame(tick)
    }

    const applyDelta = (rawDelta: number) => {
      if (!bakeReadyRef.current) return
      cancelSnap()
      if (!clothActiveRef.current) {
        pendingDownRef.current = Math.max(pendingDownRef.current + rawDelta, 0)
        if (pendingDownRef.current < SCROLL_ACTIVATION_MARGIN) return
        pendingDownRef.current = 0
        triggerCloth()
        scrollAccumRef.current = 0
        progressRef.current = 0
        onProgressRef.current?.(0)
        return
      }
      // Below zero the cloth is already visually at rest; the accumulator keeps
      // counting into the release margin instead of clamping, and only crossing
      // it hands the background back to the live rotation.
      scrollAccumRef.current = Math.min(scrollAccumRef.current + rawDelta, scrollPxForFullRef.current)
      if (scrollAccumRef.current <= -SCROLL_ACTIVATION_MARGIN) {
        reset()
        return
      }
      progressRef.current = Math.max(scrollAccumRef.current, 0) / scrollPxForFullRef.current
      onProgressRef.current?.(progressRef.current)
      // Cloth is active and not releasing: (re)arm the stop timer so a pause snaps
      // to the nearest end.
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
      snapTimerRef.current = setTimeout(runSnap, SNAP_STOP_MS)
    }

    const normalizeWheelDelta = (e: WheelEvent) => {
      if (e.deltaMode === 1) return e.deltaY * 16
      if (e.deltaMode === 2) return e.deltaY * window.innerHeight
      return e.deltaY
    }

    const handleWheel = (e: WheelEvent) => {
      applyDelta(normalizeWheelDelta(e))
    }

    let lastTouchY: number | null = null
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? null
    }
    const handleTouchMove = (e: TouchEvent) => {
      if (lastTouchY === null || e.touches.length === 0) return
      const y = e.touches[0].clientY
      applyDelta(lastTouchY - y)
      lastTouchY = y
    }
    const handleTouchEnd = () => {
      lastTouchY = null
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        scrollPxForFullRef.current = window.innerHeight * 1.3
        const w = window.innerWidth
        // Only a width (aspect) change needs a rebuild; pure height changes are
        // almost always the mobile URL bar and must not disturb the active drape.
        if (w !== lastWidthRef.current) {
          lastWidthRef.current = w
          if (clothActiveRef.current) setResizeToken((v) => v + 1)
        }
      }, 200)
    }

    window.addEventListener("wheel", handleWheel, { passive: true })
    window.addEventListener("touchstart", handleTouchStart, { passive: true })
    window.addEventListener("touchmove", handleTouchMove, { passive: true })
    window.addEventListener("touchend", handleTouchEnd, { passive: true })
    window.addEventListener("resize", handleResize, { passive: true })

    return () => {
      window.removeEventListener("wheel", handleWheel)
      window.removeEventListener("touchstart", handleTouchStart)
      window.removeEventListener("touchmove", handleTouchMove)
      window.removeEventListener("touchend", handleTouchEnd)
      window.removeEventListener("resize", handleResize)
      if (resizeTimer) clearTimeout(resizeTimer)
      cancelSnap()
    }
  }, [fabricEnabled])

  useEffect(() => {
    if (!fabricEnabled) return
    // Run the heavy per-viewport bake in a Web Worker so the main thread stays free
    // (the loading spinner can spin) and the scroll gate only opens once frames are
    // cached. The worker populates the same cache the overlay reads at mount.
    const markReady = () => {
      bakeReadyRef.current = true
      setBakeReady(true)
    }

    let worker: Worker | null = null
    if (typeof Worker !== "undefined") {
      worker = new Worker(new URL("./cloth-bake.worker.ts", import.meta.url))
      worker.onmessage = (e: MessageEvent<{ width: number; height: number; frames: Float32Array[] }>) => {
        setBakedClothFrames(e.data.width, e.data.height, e.data.frames)
        markReady()
      }
      worker.onerror = () => {
        // Worker failed to load/run: fall back to a synchronous main-thread bake.
        getBakedClothFrames(window.innerWidth, window.innerHeight)
        markReady()
      }
      worker.postMessage({ width: window.innerWidth, height: window.innerHeight })
    } else {
      getBakedClothFrames(window.innerWidth, window.innerHeight)
      markReady()
    }

    return () => {
      worker?.terminate()
    }
  }, [fabricEnabled])

  const handleFirstFrame = useCallback(() => {
    setPaused(true)
  }, [])

  const reset = useCallback(() => {
    if (snapTimerRef.current) {
      clearTimeout(snapTimerRef.current)
      snapTimerRef.current = null
    }
    if (snapRafRef.current !== null) {
      cancelAnimationFrame(snapRafRef.current)
      snapRafRef.current = null
    }
    clothActiveRef.current = false
    scrollAccumRef.current = 0
    pendingDownRef.current = 0
    progressRef.current = 0
    onProgressRef.current?.(0)
    setPaused(false)
    setFrozen(false)
    setClothMounted(false)
  }, [])

  return (
    <>
      <GalaxyBackground frozen={frozen} paused={paused} onCanvasReady={handleCanvasReady} />
      {fabricEnabled && clothMounted && snapshotCanvasRef.current && (
        <ClothOverlay
          key={`${snapshotToken}:${resizeToken}`}
          sourceCanvas={snapshotCanvasRef.current}
          progressRef={progressRef}
          onFirstFrame={handleFirstFrame}
          onContextLost={reset}
        />
      )}
      {fabricEnabled && !bakeReady && (
        <div
          className="fixed top-4 right-4 z-50 h-6 w-6 rounded-full border-2 border-white/25 border-t-white/90 animate-spin"
          aria-label="Loading"
        />
      )}
    </>
  )
}
