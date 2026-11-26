"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import GalaxyBackground, { type GalaxyHandle } from "@/components/galaxy-background"
import type { ClothScene } from "@/lib/cloth-scene"
import type { TitlePose } from "@/lib/cloth-scroll"
import type { ClothStage } from "@/lib/cloth-stage"

// Everything behind the flag is loaded on demand: three.js and the scene with the
// overlay, the controller on its own (it is small, and the starfield waits for its tone).
const ClothOverlay = dynamic(() => import("@/components/cloth-overlay"), { ssr: false })
type ClothStageModule = typeof import("@/lib/cloth-stage")

interface BackgroundStageProps {
  fabricEnabled: boolean
  /** The title's heading: its height sets how far it travels, and its place lights the cloth. */
  titleRef: RefObject<HTMLElement | null>
  /** Where the scroll puts the title. */
  onTitlePose?: (pose: TitlePose) => void
}

/**
 * The page's background: the starfield and, behind the `fabric_scroll_background` flag,
 * the cloth it turns into when the page is scrolled (see lib/cloth-stage.ts).
 */
export default function BackgroundStage({ fabricEnabled, titleRef, onTitlePose }: BackgroundStageProps) {
  // The effect is wanted: the flag, no request for reduced motion, and a browser that can draw it.
  const [motionAllowed, setMotionAllowed] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const wanted = motionAllowed && !unsupported
  const [stageModule, setStageModule] = useState<ClothStageModule | null>(null)
  const active = wanted && stageModule !== null
  const [galaxy, setGalaxy] = useState<GalaxyHandle | null>(null)
  // The tone-mapped black of the starfield, once it is known: the overlay waits for it.
  const [black, setBlack] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const stageRef = useRef<ClothStage | null>(null)
  const sceneRef = useRef<ClothScene | null>(null)
  const onTitlePoseRef = useRef(onTitlePose)
  onTitlePoseRef.current = onTitlePose

  useEffect(() => {
    if (!fabricEnabled) return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setMotionAllowed(!query.matches)
    update()
    query.addEventListener("change", update)
    return () => {
      query.removeEventListener("change", update)
      setMotionAllowed(false)
    }
  }, [fabricEnabled])

  useEffect(() => {
    if (!wanted || stageModule) return
    let cancelled = false
    import("@/lib/cloth-stage").then(
      (loaded) => {
        if (!cancelled) setStageModule(loaded)
      },
      () => {
        if (!cancelled) setUnsupported(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [wanted, stageModule])

  useEffect(() => {
    if (!active || !galaxy || !stageModule) return
    // The starfield's own effect has run by now: it is painting in the mapped colours.
    setBlack(galaxy.background)
    const stage = stageModule.startClothStage({
      galaxy,
      title: () => titleRef.current,
      onTitlePose: (pose) => onTitlePoseRef.current?.(pose),
      onLoading: setLoading,
      onUnsupported: () => setUnsupported(true),
    })
    stageRef.current = stage
    stage.setScene(sceneRef.current)
    return () => {
      stageRef.current = null
      stage.dispose()
      setBlack(null)
      setLoading(false)
    }
  }, [active, galaxy, stageModule, titleRef])

  const handleScene = useCallback((scene: ClothScene | null) => {
    sceneRef.current = scene
    stageRef.current?.setScene(scene)
  }, [])
  const handleUnavailable = useCallback(() => setUnsupported(true), [])
  const handleContextChange = useCallback((lost: boolean) => stageRef.current?.setContextLost(lost), [])

  return (
    <>
      <GalaxyBackground tone={active ? stageModule.starfieldTone : null} onReady={setGalaxy} />
      {active && galaxy && black && (
        <ClothOverlay
          sourceCanvas={galaxy.canvas}
          background={black}
          titleRef={titleRef}
          onScene={handleScene}
          onUnavailable={handleUnavailable}
          onContextChange={handleContextChange}
        />
      )}
      {loading && (
        <div
          className="fixed top-4 right-4 z-50 h-6 w-6 rounded-full border-2 border-white/25 border-t-white/90 animate-spin"
          aria-label="Loading"
        />
      )}
    </>
  )
}
