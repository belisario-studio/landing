"use client"

import { useEffect, useState } from "react"

const STORAGE_PREFIX = "ff_"
const CHANGE_EVENT = "ff:change"

export type FeatureFlag = "newsletter_signup" | "fabric_scroll_background"

export interface FeatureFlagDef {
  key: FeatureFlag
  label: string
}

export const FEATURE_FLAGS: FeatureFlagDef[] = [
  { key: "newsletter_signup", label: "Newsletter signup" },
  { key: "fabric_scroll_background", label: "Fabric scroll background" },
]

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
    const onChange = () => setEnabled(readFlag(flag))
    window.addEventListener("storage", onStorage)
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(CHANGE_EVENT, onChange)
    }
  }, [flag])

  return enabled
}

/**
 * Writes a feature flag to localStorage and notifies same-tab listeners.
 * The native `storage` event does not fire in the document that called
 * `setItem`, so a custom event is dispatched to keep the page reactive.
 */
export function setFeatureFlag(flag: FeatureFlag, value: boolean): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(`${STORAGE_PREFIX}${flag}`, value ? "true" : "false")
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { flag } }))
}

/**
 * Reads every registered feature flag, materializing any unset keys via
 * `ensureFlag`. Returns an SSR-safe all-`false` record when `window` is
 * undefined.
 */
export function readAllFlags(): Record<FeatureFlag, boolean> {
  const result = {} as Record<FeatureFlag, boolean>
  for (const { key } of FEATURE_FLAGS) {
    result[key] = typeof window === "undefined" ? false : ensureFlag(key)
  }
  return result
}

/**
 * Returns the current record of all feature flags plus a setter, reactive to
 * both cross-tab `storage` events and same-tab `CHANGE_EVENT` events.
 */
export function useFeatureFlags(): {
  flags: Record<FeatureFlag, boolean>
  setFlag: (flag: FeatureFlag, value: boolean) => void
} {
  const [flags, setFlags] = useState<Record<FeatureFlag, boolean>>(() => {
    const result = {} as Record<FeatureFlag, boolean>
    for (const { key } of FEATURE_FLAGS) result[key] = false
    return result
  })

  useEffect(() => {
    setFlags(readAllFlags())

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(STORAGE_PREFIX)) setFlags(readAllFlags())
    }
    const onChange = () => setFlags(readAllFlags())
    window.addEventListener("storage", onStorage)
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(CHANGE_EVENT, onChange)
    }
  }, [])

  const setFlag = (flag: FeatureFlag, value: boolean) => {
    setFeatureFlag(flag, value)
    setFlags(readAllFlags())
  }

  return { flags, setFlag }
}
