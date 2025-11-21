"use client"

import { useRef, useEffect, useState } from "react"
import Link from "next/link"
import Navigation from "@/components/navigation"
import GalaxyBackground from "@/components/galaxy-background"

export default function Home() {
  const textRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const lastPositionRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const filterSvg = `
      <svg style="display: none;">
      <defs>
        <filter id="bubbleInflate">
          <feTurbulence 
            type="fractalNoise" 
            baseFrequency="0.015" 
            numOctaves="2" 
            result="noise" 
            seed="12" />

          <feDisplacementMap 
            in="SourceGraphic" 
            in2="noise" 
            scale="25" 
            xChannelSelector="R" 
            yChannelSelector="G" 
            result="distortedGraphic"/>

          <feSpecularLighting 
            in="noise" 
            surfaceScale="5" 
            specularConstant="1" 
            specularExponent="20" 
            lightingColor="#ffffff" 
            result="specularLight">
            <fePointLight x="-5000" y="-10000" z="20000"/>
          </feSpecularLighting>

          <feComposite 
            in="specularLight" 
            in2="distortedGraphic" 
            operator="in" 
            result="specularLightClipped"/>

          <feComposite 
            in="specularLightClipped" 
            in2="distortedGraphic" 
            operator="arithmetic" 
            k1="0" k2="1" k3="1" k4="0"/>
          
        </filter>
      </defs>
    </svg>
    `

    const div = document.createElement("div")
    div.innerHTML = filterSvg
    document.body.appendChild(div)

    return () => {
      document.body.removeChild(div)
    }
  }, [])

  useEffect(() => {
    // Desktop: mousemove (sin drag)
    const handleMouseMove = (e: MouseEvent) => {
      if (!textRef.current) return

      const rect = textRef.current.getBoundingClientRect()
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const rotateY = ((mouseX - centerX) / centerX) * 15
      const rotateX = ((centerY - mouseY) / centerY) * 15

      setTilt({ x: rotateX, y: rotateY })
    }

    // Mobile: touch drag
    const updateTiltDrag = (clientX: number, clientY: number) => {
      if (!isDraggingRef.current || !textRef.current) return

      const rect = textRef.current.getBoundingClientRect()
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const mouseX = clientX - rect.left
      const mouseY = clientY - rect.top

      const rotateY = ((mouseX - centerX) / centerX) * 15
      const rotateX = ((centerY - mouseY) / centerY) * 15

      setTilt({ x: rotateX, y: rotateY })
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        isDraggingRef.current = true
        lastPositionRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        updateTiltDrag(e.touches[0].clientX, e.touches[0].clientY)
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        updateTiltDrag(e.touches[0].clientX, e.touches[0].clientY)
      }
    }

    const handleTouchEnd = () => {
      isDraggingRef.current = false
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("touchstart", handleTouchStart)
    window.addEventListener("touchmove", handleTouchMove)
    window.addEventListener("touchend", handleTouchEnd)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("touchstart", handleTouchStart)
      window.removeEventListener("touchmove", handleTouchMove)
      window.removeEventListener("touchend", handleTouchEnd)
    }
  }, [])

  return (
    <>
      <Navigation />
      <main className="relative w-full h-svh overflow-hidden">
        <GalaxyBackground />

        <div
          ref={textRef}
          className="relative z-10 h-svh flex flex-col items-center justify-center px-4 select-none"
          style={{
            perspective: "1200px",
          }}
        >
          <div
            style={{
              transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
              transition: "transform 0.1s ease-out",
              transformStyle: "preserve-3d",
            }}
          >
            <div className="text-center space-y-8">
              <div className="space-y-4">
                <h1
                  className="text-7xl md:text-9xl lg:text-[9rem] font-bold text-balance tracking-tight"
                  style={{
                    background: "linear-gradient(135deg, #9bb0ff, #cad7ff, #f8f7ff, #fff4e8, #ffeddb, #ffd2a1, #ffb56c)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  𝐁<span className="text-5xl md:text-7xl lg:text-[7.5rem]">elisario</span> ⊙ 𝐒<span className="text-5xl md:text-7xl lg:text-[7.5rem]">tudio</span>
                </h1>
              </div>

              <div className="flex gap-6 justify-center flex-wrap pt-8 absolute md:relative opacity-0 pointer-events-none">
                <Link
                  href="/careers"
                  className="px-8 py-3 border border-foreground text-foreground bg-background hover:bg-foreground hover:text-background transition-all duration-200"
                  style={{
                    filter: "url(#lensDistortion)",
                  }}
                >
                  Join Our Team
                </Link>
                <Link
                  href="/contact"
                  className="px-8 py-3 bg-foreground text-background hover:opacity-90 transition-all duration-200"
                  style={{
                    filter: "url(#lensDistortion)",
                  }}
                >
                  Get In Touch
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
