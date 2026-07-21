"use client"

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { FlaskConical } from "lucide-react"

import { FEATURE_FLAGS, useFeatureFlags } from "@/lib/feature-flags"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "ff_button_pos"
const BUTTON_SIZE = 44
const MARGIN = 16
const DRAG_THRESHOLD = 5

interface Position {
  x: number
  y: number
}

function clampPosition(pos: Position): Position {
  if (typeof window === "undefined") return pos
  const maxX = Math.max(0, window.innerWidth - BUTTON_SIZE)
  const maxY = Math.max(0, window.innerHeight - BUTTON_SIZE)
  return {
    x: Math.min(Math.max(pos.x, 0), maxX),
    y: Math.min(Math.max(pos.y, 0), maxY),
  }
}

function defaultPosition(): Position {
  if (typeof window === "undefined") return { x: 0, y: 0 }
  return {
    x: window.innerWidth - BUTTON_SIZE - MARGIN,
    y: window.innerHeight - BUTTON_SIZE - MARGIN,
  }
}

function loadPosition(): Position {
  if (typeof window === "undefined") return { x: 0, y: 0 }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
        return clampPosition(parsed)
      }
    }
  } catch {
    // ignore malformed storage
  }
  return clampPosition(defaultPosition())
}

export default function FeatureFlagsButton() {
  const [mounted, setMounted] = useState(false)
  const [hasQueryParam, setHasQueryParam] = useState(false)
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const { flags, setFlag } = useFeatureFlags()

  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    moved: boolean
  } | null>(null)

  useEffect(() => {
    setMounted(true)
    setPosition(loadPosition())
    setHasQueryParam(new URLSearchParams(window.location.search).has("ff"))
  }, [])

  // Keep the button within the viewport on resize.
  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => clampPosition(prev))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return
      }
      setIsOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false)
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [isOpen])

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return
    buttonRef.current?.setPointerCapture(e.pointerId)
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - position.x,
      offsetY: e.clientY - position.y,
      moved: false,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      drag.moved = true
    }

    if (drag.moved) {
      const next = clampPosition({
        x: e.clientX - drag.offsetX,
        y: e.clientY - drag.offsetY,
      })
      setPosition(next)
    }
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== e.pointerId) return

    buttonRef.current?.releasePointerCapture(e.pointerId)
    setIsDragging(false)

    if (drag.moved) {
      setPosition((prev) => {
        const clamped = clampPosition(prev)
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped))
        } catch {
          // ignore storage errors (e.g. private browsing quota)
        }
        return clamped
      })
    } else {
      setIsOpen((open) => !open)
    }

    dragState.current = null
  }

  const anyEnabled = Object.values(flags).some(Boolean)

  if (!mounted) return null
  // Hidden when every flag is off and there's no ?ff param — but stay visible
  // while the panel is open so turning the last flag off doesn't strand the
  // user with no way to turn it back on.
  if (!anyEnabled && !hasQueryParam && !isOpen) return null

  // Open the panel above the button unless there isn't room, in which case
  // open it below.
  const openUpward = position.y > (typeof window !== "undefined" ? window.innerHeight : 0) / 2
  const openRightward = position.x < (typeof window !== "undefined" ? window.innerWidth : 0) / 2

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Feature flags"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          touchAction: "none",
        }}
        className={cn(
          "z-50 flex items-center justify-center rounded-full border border-[#2a2a2a] bg-[#121212] text-foreground shadow-lg transition-colors hover:bg-[#1a1a1a]",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <FlaskConical className="size-5" />
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            left: openRightward ? position.x : undefined,
            right: openRightward
              ? undefined
              : typeof window !== "undefined"
                ? window.innerWidth - (position.x + BUTTON_SIZE)
                : undefined,
            top: openUpward ? undefined : position.y + BUTTON_SIZE + 8,
            bottom: openUpward
              ? typeof window !== "undefined"
                ? window.innerHeight - position.y + 8
                : undefined
              : undefined,
          }}
          className="z-50 w-64 max-h-80 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#121212] p-3 shadow-xl"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Feature flags
          </p>
          <div className="flex flex-col gap-3">
            {FEATURE_FLAGS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{label}</span>
                <Switch
                  checked={flags[key]}
                  onCheckedChange={(checked) => setFlag(key, checked)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
