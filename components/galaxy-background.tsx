"use client"

import { useEffect, useRef, useState } from "react"

interface Point {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
  color: string
}

const BACKGROUND = "#0a0a0a"
const TRAIL_FADE = "rgba(10, 10, 10, 0.1)"

export interface GalaxyHandle {
  canvas: HTMLCanvasElement
  /** The colour the canvas rests on: the page's black, or what the tone curve makes of it. */
  readonly background: string
  /** Stops the background from following mouse/touch rotation input. */
  setFrozen: (frozen: boolean) => void
  /** Stops the render loop (the canvas keeps its last painted frame) or lets it go on from that frame. */
  setPaused: (paused: boolean) => void
}

interface GalaxyBackgroundProps {
  /**
   * Paints every colour (stars, background, trail fade) through this first: "#rrggbb" in
   * and out. It is the cloth's tone curve, so that the canvas can be the cloth's texture
   * and trade places with it unnoticed. Null is the site's plain starfield.
   */
  tone?: ((hex: string) => string) | null
  /** Called with the handle once the canvas exists, and with null when it goes away. */
  onReady?: (handle: GalaxyHandle | null) => void
}

export default function GalaxyBackground({ tone = null, onReady }: GalaxyBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointsRef = useRef<Point[]>([])
  const rotationRef = useRef({ x: 0, y: 0 })
  const targetRotationRef = useRef({ x: 0, y: 0 })
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const lastPositionRef = useRef({ x: 0, y: 0 })
  const frozenRef = useRef(false)
  const pausedRef = useRef(false)
  const runningRef = useRef(false)
  // The first frame starts from an opaque background.
  const wipeNextFrameRef = useRef(true)
  // What the starfield paints with: null is the site's own colours.
  const paintRef = useRef<Map<string, string> | null>(null)
  const backgroundRef = useRef(BACKGROUND)
  const trailFadeRef = useRef(TRAIL_FADE)

  // Generate realistic star colors based on stellar classification
  const getStarColor = (): string => {
    const rand = Math.random()

    // Realistic distribution: most stars are M-type (red), fewer are blue
    if (rand < 0.76) {
      // M-type (Red dwarf) - most common ~76%
      const colors = ["#ffb56c", "#ff9e6e", "#ffa65d", "#ffaa70"]
      return colors[Math.floor(Math.random() * colors.length)]
    } else if (rand < 0.88) {
      // K-type (Orange) - ~12%
      const colors = ["#ffd2a1", "#ffcc6f", "#ffbe7f", "#ffc894"]
      return colors[Math.floor(Math.random() * colors.length)]
    } else if (rand < 0.96) {
      // G-type (Yellow, like our Sun) - ~8%
      const colors = ["#ffeddb", "#ffeedd", "#fff4ea", "#fff0e0"]
      return colors[Math.floor(Math.random() * colors.length)]
    } else if (rand < 0.99) {
      // F-type (Yellow-white) - ~3%
      const colors = ["#fff4e8", "#fff8f0", "#fffaf4", "#ffffff"]
      return colors[Math.floor(Math.random() * colors.length)]
    } else if (rand < 0.996) {
      // A-type (White) - ~0.6%
      const colors = ["#f8f7ff", "#ffffff", "#fefeff"]
      return colors[Math.floor(Math.random() * colors.length)]
    } else if (rand < 0.999) {
      // B-type (Blue-white) - ~0.3%
      const colors = ["#cad7ff", "#d5e0ff", "#dae5ff"]
      return colors[Math.floor(Math.random() * colors.length)]
    } else {
      // O-type (Blue, very hot) - ~0.1%
      const colors = ["#9bb0ff", "#aabfff", "#a5b8ff"]
      return colors[Math.floor(Math.random() * colors.length)]
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resizeCanvas = () => {
      // While paused the canvas is the cloth's texture: it keeps its size and its picture
      // until the cloth hands the page back.
      if (pausedRef.current) return
      // Tone-mapped, a canvas that changes size starts over from an opaque black: its
      // alpha would otherwise creep up from nothing, and the cloth is textured with it.
      const resized = canvas.width !== window.innerWidth || canvas.height !== window.innerHeight
      if (paintRef.current && !resized) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      if (paintRef.current) wipeNextFrameRef.current = true
    }
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    const points: Point[] = []
    const largePointCount = 150
    const smallPointCount = 3000

    for (let i = 0; i < largePointCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * 800 + 100
      const height = (Math.random() - 0.5) * 600

      points.push({
        x: Math.cos(angle) * radius,
        y: height,
        z: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        vz: 0,
        size: Math.random() * 1.2 + 0.8,
        color: getStarColor(),
      })
    }

    for (let i = 0; i < smallPointCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * 1200 + 50
      const height = (Math.random() - 0.5) * 800

      points.push({
        x: Math.cos(angle) * radius,
        y: height,
        z: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        vz: 0,
        size: Math.random() * 0.4 + 0.1,
        color: getStarColor(),
      })
    }

    pointsRef.current = points

    // Desktop: mousemove (sin drag)
    const handleMouseMove = (e: MouseEvent) => {
      if (frozenRef.current) return

      const x = (e.clientX / window.innerWidth) * 2 - 1
      const y = -(e.clientY / window.innerHeight) * 2 + 1

      targetRotationRef.current = {
        x: y * 0.5,
        y: x * 0.5,
      }
      setMousePos({ x: e.clientX, y: e.clientY })
    }

    // Mobile: touch drag
    const updateRotationDrag = (clientX: number, clientY: number) => {
      if (!isDraggingRef.current || frozenRef.current) return

      const deltaX = clientX - lastPositionRef.current.x
      const deltaY = clientY - lastPositionRef.current.y

      targetRotationRef.current = {
        x: targetRotationRef.current.x - deltaY * 0.005,
        y: targetRotationRef.current.y + deltaX * 0.005,
      }

      lastPositionRef.current = { x: clientX, y: clientY }
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        isDraggingRef.current = true
        lastPositionRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        updateRotationDrag(e.touches[0].clientX, e.touches[0].clientY)
      }
    }

    const handleTouchEnd = () => {
      isDraggingRef.current = false
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("touchstart", handleTouchStart)
    window.addEventListener("touchmove", handleTouchMove)
    window.addEventListener("touchend", handleTouchEnd)

    const createVoronoiShader = () => {
      const imageData = ctx.createImageData(canvas.width, canvas.height)
      const data = imageData.data

      // Simple voronoi-like cellular pattern
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 // R
        data[i + 1] = 255 // G
        data[i + 2] = 255 // B
        data[i + 3] = 255 // A
      }
      return imageData
    }

    let animationId: number
    let time = 0
    let unmounted = false

    const animate = () => {
      if (pausedRef.current || unmounted) {
        runningRef.current = false
        return
      }
      runningRef.current = true

      if (wipeNextFrameRef.current) {
        wipeNextFrameRef.current = false
        ctx.fillStyle = backgroundRef.current
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      } else {
        ctx.fillStyle = trailFadeRef.current
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      rotationRef.current.x += (targetRotationRef.current.x - rotationRef.current.x) * 0.05
      rotationRef.current.y += (targetRotationRef.current.y - rotationRef.current.y) * 0.05

      const cosX = Math.cos(rotationRef.current.x)
      const sinX = Math.sin(rotationRef.current.x)
      const cosY = Math.cos(rotationRef.current.y)
      const sinY = Math.sin(rotationRef.current.y)

      const projectedPoints: Array<{
        x: number
        y: number
        z: number
        size: number
        color: string
      }> = []

      pointsRef.current.forEach((point) => {
        const y = point.y * cosX - point.z * sinX
        let z = point.y * sinX + point.z * cosX

        const x = point.x * cosY + z * sinY
        z = -point.x * sinY + z * cosY

        const scale = 500 / (z + 500)
        const projX = canvas.width / 2 + x * scale
        const projY = canvas.height / 2 + y * scale

        projectedPoints.push({
          x: projX,
          y: projY,
          z: z,
          size: point.size * scale,
          color: point.color,
        })
      })

      projectedPoints.sort((a, b) => a.z - b.z)

      projectedPoints.forEach((point) => {
        if (
          point.x > -50 &&
          point.x < canvas.width + 50 &&
          point.y > -50 &&
          point.y < canvas.height + 50 &&
          point.size > 0
        ) {
          ctx.fillStyle = paintRef.current?.get(point.color) ?? point.color
          ctx.beginPath()
          ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2)
          ctx.fill()
        }
      })

      time += 0.01
      animationId = requestAnimationFrame(animate)
    }

    animate()

    onReady?.({
      canvas,
      get background() {
        return backgroundRef.current
      },
      setFrozen: (frozen) => {
        frozenRef.current = frozen
      },
      // Resuming carries on from the very frame it stopped on, which is the picture the
      // flat cloth was showing, so nothing blinks.
      setPaused: (paused) => {
        pausedRef.current = paused
        if (paused || runningRef.current) return
        resizeCanvas()
        animate()
      },
    })

    return () => {
      unmounted = true
      onReady?.(null)
      window.removeEventListener("resize", resizeCanvas)
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("touchstart", handleTouchStart)
      window.removeEventListener("touchmove", handleTouchMove)
      window.removeEventListener("touchend", handleTouchEnd)
      cancelAnimationFrame(animationId)
      runningRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Declared after the effect above, so the stars exist by the time this runs.
  const wasTonedRef = useRef(false)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || (!tone && !wasTonedRef.current)) return
    wasTonedRef.current = tone !== null
    if (tone) {
      const paint = new Map<string, string>()
      for (const point of pointsRef.current) {
        if (!paint.has(point.color)) paint.set(point.color, tone(point.color))
      }
      paintRef.current = paint
      const black = tone(BACKGROUND)
      const channel = (i: number) => parseInt(black.slice(i, i + 2), 16)
      trailFadeRef.current = `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, 0.1)`
      backgroundRef.current = restingBlack(black, trailFadeRef.current)
    } else {
      paintRef.current = null
      trailFadeRef.current = TRAIL_FADE
      backgroundRef.current = BACKGROUND
    }
    // The canvas starts over in the new colours.
    canvas.style.background = backgroundRef.current
    wipeNextFrameRef.current = true
  }, [tone])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ background: BACKGROUND }} />
}

// The trail fade is an 8-bit blend, and where it comes to rest is not always the colour
// it fades to (it can stop a few levels short, or sink below). That resting colour is
// found by doing it: it is the black the tone-mapped canvas starts from, and the one the
// page and the cloth's scene take.
function restingBlack(background: string, trailFade: string): string {
  const probe = document.createElement("canvas")
  probe.width = probe.height = 4
  const g = probe.getContext("2d", { willReadFrequently: true })
  if (!g) return background
  g.fillStyle = background
  g.fillRect(0, 0, 4, 4)
  g.fillStyle = trailFade
  for (let i = 0; i < 120; i++) g.fillRect(0, 0, 4, 4)
  const [r, g8, b] = g.getImageData(1, 1, 1, 1).data
  return "#" + [r, g8, b].map((v) => v.toString(16).padStart(2, "0")).join("")
}
