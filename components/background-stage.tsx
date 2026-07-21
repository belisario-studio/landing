"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"
import GalaxyBackground from "@/components/galaxy-background"

const ClothOverlay = dynamic(() => import("@/components/cloth-overlay"), { ssr: false })

const DEBUG_GRID = false

// Hysteresis band for the scroll trigger: this much accumulated wheel travel is
// needed to start the cloth, and once it is back at rest, the same extra travel
// upward is needed to release it and resume the starfield rotation — so
// imprecise scrolls near the boundary never flicker the effect on or off.
const SCROLL_ACTIVATION_MARGIN = 100

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
}

export default function BackgroundStage({ fabricEnabled }: BackgroundStageProps) {
  const [frozen, setFrozen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [clothMounted, setClothMounted] = useState(false)
  const [snapshotToken, setSnapshotToken] = useState(0)

  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const progressRef = useRef(0)
  const scrollAccumRef = useRef(0)
  const pendingDownRef = useRef(0)
  const clothActiveRef = useRef(false)

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    liveCanvasRef.current = canvas
  }, [])

  useEffect(() => {
    if (!fabricEnabled) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const scrollPxForFull = window.innerHeight * 1.3

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

    const applyDelta = (rawDelta: number) => {
      if (!clothActiveRef.current) {
        pendingDownRef.current = Math.max(pendingDownRef.current + rawDelta, 0)
        if (pendingDownRef.current < SCROLL_ACTIVATION_MARGIN) return
        pendingDownRef.current = 0
        triggerCloth()
        scrollAccumRef.current = 0
        progressRef.current = 0
        return
      }
      // Below zero the cloth is already visually at rest; the accumulator keeps
      // counting into the release margin instead of clamping, and only crossing
      // it hands the background back to the live rotation.
      scrollAccumRef.current = Math.min(scrollAccumRef.current + rawDelta, scrollPxForFull)
      if (scrollAccumRef.current <= -SCROLL_ACTIVATION_MARGIN) {
        reset()
        return
      }
      progressRef.current = Math.max(scrollAccumRef.current, 0) / scrollPxForFull
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

    window.addEventListener("wheel", handleWheel, { passive: true })
    window.addEventListener("touchstart", handleTouchStart, { passive: true })
    window.addEventListener("touchmove", handleTouchMove, { passive: true })
    window.addEventListener("touchend", handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener("wheel", handleWheel)
      window.removeEventListener("touchstart", handleTouchStart)
      window.removeEventListener("touchmove", handleTouchMove)
      window.removeEventListener("touchend", handleTouchEnd)
    }
  }, [fabricEnabled])

  useEffect(() => {
    if (!fabricEnabled) return
    // Loads three + the overlay chunk and runs the geometry bake ahead of time, so
    // the first scroll only has to snapshot the canvas and apply it as a texture.
    const preload = () => {
      import("@/components/cloth-overlay").then((m) => m.prebakeCloth()).catch(() => {})
    }
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(preload)
    } else {
      setTimeout(preload, 1500)
    }
  }, [fabricEnabled])

  const handleFirstFrame = useCallback(() => {
    setPaused(true)
  }, [])

  const reset = useCallback(() => {
    clothActiveRef.current = false
    scrollAccumRef.current = 0
    pendingDownRef.current = 0
    progressRef.current = 0
    setPaused(false)
    setFrozen(false)
    setClothMounted(false)
  }, [])

  return (
    <>
      <GalaxyBackground frozen={frozen} paused={paused} onCanvasReady={handleCanvasReady} />
      {fabricEnabled && clothMounted && snapshotCanvasRef.current && (
        <ClothOverlay
          key={snapshotToken}
          sourceCanvas={snapshotCanvasRef.current}
          progressRef={progressRef}
          onFirstFrame={handleFirstFrame}
          onContextLost={reset}
        />
      )}
    </>
  )
}
