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

export default function GalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointsRef = useRef<Point[]>([])
  const rotationRef = useRef({ x: 0, y: 0 })
  const targetRotationRef = useRef({ x: 0, y: 0 })
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const lastPositionRef = useRef({ x: 0, y: 0 })

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
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
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
      if (!isDraggingRef.current) return

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

    const animate = () => {
      ctx.fillStyle = "rgba(10, 10, 10, 0.1)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

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
          ctx.fillStyle = point.color
          ctx.beginPath()
          ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2)
          ctx.fill()
        }
      })

      time += 0.01
      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("touchstart", handleTouchStart)
      window.removeEventListener("touchmove", handleTouchMove)
      window.removeEventListener("touchend", handleTouchEnd)
      cancelAnimationFrame(animationId)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ background: "#0a0a0a" }} />
}
