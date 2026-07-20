"use client"

import { useEffect, useState } from "react"

const STORAGE_PREFIX = "ff_"

export type FeatureFlag = "newsletter_signup" | "fabric_scroll_background"

function readFlag(flag: FeatureFlag): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(`${STORAGE_PREFIX}${flag}`) === "true"
}

function ensureFlag(flag: FeatureFlag): boolean {
  if (typeof window === "undefined") return false
  const key = `${STORAGE_PREFIX}${flag}`
  if (window.localStorage.getItem(key) === null) {
    window.localStorage.setItem(key, "false")
    return false
  }
  return readFlag(flag)
}

/**
 * Reads a feature flag from localStorage (key: `ff_<flag>`, value: "true").
 * Creates the key with "false" the first time it's read, so it shows up in
 * devtools ready to flip by hand — no UI to toggle it.
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    setEnabled(ensureFlag(flag))

    const onStorage = (e: StorageEvent) => {
      if (e.key === `${STORAGE_PREFIX}${flag}`) setEnabled(readFlag(flag))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [flag])

  return enabled
}
