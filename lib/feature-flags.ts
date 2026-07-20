"use client"

import { useEffect, useState } from "react"

const STORAGE_PREFIX = "ff_"

export type FeatureFlag = "newsletter_signup"

function readFlag(flag: FeatureFlag): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(`${STORAGE_PREFIX}${flag}`) === "true"
}

/**
 * Reads a feature flag from localStorage (key: `ff_<flag>`, value: "true").
 * No UI to toggle it — set it by hand via devtools/localStorage.
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    setEnabled(readFlag(flag))

    const onStorage = (e: StorageEvent) => {
      if (e.key === `${STORAGE_PREFIX}${flag}`) setEnabled(readFlag(flag))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [flag])

  return enabled
}
