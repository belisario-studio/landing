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
}

export default function GalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointsRef = useRef<Point[]>([])
  const rotationRef = useRef({ x: 0, y: 0 })
  const targetRotationRef = useRef({ x: 0, y: 0 })
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

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
      })
    }

    pointsRef.current = points

    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1
      const y = -(e.clientY / window.innerHeight) * 2 + 1

      targetRotationRef.current = {
        x: y * 0.5,
        y: x * 0.5,
      }
      setMousePos({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener("mousemove", handleMouseMove)

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
        })
      })

      projectedPoints.sort((a, b) => a.z - b.z)

      ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
      projectedPoints.forEach((point) => {
        if (
          point.x > -50 &&
          point.x < canvas.width + 50 &&
          point.y > -50 &&
          point.y < canvas.height + 50 &&
          point.size > 0
        ) {
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
      cancelAnimationFrame(animationId)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ background: "#0a0a0a" }} />
}
