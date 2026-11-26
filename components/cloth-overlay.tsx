"use client"

import { useEffect, useRef, type RefObject } from "react"
import { createClothScene, type ClothScene } from "@/lib/cloth-scene"

interface ClothOverlayProps {
  /** The starfield's canvas: the cloth is textured with it. */
  sourceCanvas: HTMLCanvasElement
  /** The page's black. */
  background: string
  titleRef: RefObject<HTMLElement | null>
  /** The scene once it exists, and null when it goes away. */
  onScene: (scene: ClothScene | null) => void
  /** WebGL is not available: the page stays the starfield. */
  onUnavailable: () => void
  onContextChange: (lost: boolean) => void
}

/**
 * The WebGL layer of the scroll-driven cloth. The scene is created ahead of the first
 * scroll and stays for the life of the page, hidden: background-stage shows and hides it
 * and tells it what to draw. Loaded with a dynamic import, so three.js is only downloaded
 * when the effect is on.
 */
export default function ClothOverlay({
  sourceCanvas,
  background,
  titleRef,
  onScene,
  onUnavailable,
  onContextChange,
}: ClothOverlayProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onScene, onUnavailable, onContextChange })
  callbacks.current = { onScene, onUnavailable, onContextChange }

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    let scene: ClothScene
    try {
      scene = createClothScene({
        source: sourceCanvas,
        background,
        title: () => titleRef.current,
        onContextChange: (lost) => callbacks.current.onContextChange(lost),
      })
    } catch {
      callbacks.current.onUnavailable()
      return
    }
    layer.appendChild(scene.canvas)
    callbacks.current.onScene(scene)
    return () => {
      callbacks.current.onScene(null)
      scene.dispose()
      scene.canvas.remove()
    }
  }, [sourceCanvas, background, titleRef])

  return <div ref={layerRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}
