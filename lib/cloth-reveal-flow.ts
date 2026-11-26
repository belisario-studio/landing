// The controller of the reveal: WHEN things happen. The view (cloth-reveal.ts) draws and moves what is on screen;
// this decides when it is loaded, when the reveal starts by itself, what the scroll does while it runs and how it
// goes back. cloth-stage.ts owns the loop and the input and hands them over while a reveal is on.
//
// Phases: "off" (the page as it was: falling, settled, idle loop) -> "lifting" (the baked lift plays, the moon fades
// under it, the egg grows) -> "reveal" (the cloth is gone; the egg cracks and the rooster drops out) -> "final" (the
// rooster stands: on the site this is where the router navigates) -> "returning" (the lift played backwards: the cloth
// comes back down over the moon exactly where it was) -> "off".
//
// What is built when: nothing before the cloth has touched the moon and the idle is baked. Then the reveal's view is
// downloaded and prepared (the egg and the rooster) and the lift is baked, side by side.
//
// Scroll rules (see scroll()):
//  * off: the scroll is the page's own. At its end, with the cloth settled in the idle, everything ready, no finger
//    held and the scroll away from the end since the last reveal (armed), the reveal starts by itself after
//    REVEAL.autoDelay seconds.
//  * lifting / reveal / final: downward is ignored; upward (wheel, touch, ArrowUp / PageUp / Home) or Escape aborts into
//    the return, wherever the animation is.
//  * returning: it cannot be interrupted; the upward scroll that comes in meanwhile is kept and handed back when the
//    cloth is on the moon (onBack), so the scroll goes on upward from the end with no jump. Downward takes it back.
//  * after a reveal the next one needs the scroll to leave the end and come back.
// With reduced motion nothing is animated: the reveal and the return are worked out at once and only the result is drawn.
import type { LiftResult } from "./cloth-bake"
import { REVEAL } from "./cloth-config"
import type { ClothReveal } from "./cloth-reveal"
import type { ClothScene } from "./cloth-scene"
import { smoothstep } from "./cloth-scroll"

export interface RevealFlowOptions {
  scene: () => ClothScene | null
  /** Bakes the lift from where the fall ended (needs the idle to be in). Returns what cancels it. */
  bakeLift: (done: (lift: LiftResult) => void, failed: () => void) => () => void
  /** Draws the scene as the page has it now: the settled pose with the idle's current sway before a reveal, the reveal's frame during one. */
  draw: () => void
  /** A reveal has just started from the settled cloth: stop the idle and the snap. */
  onStart: () => void
  /** The cloth is back on the moon. `pending` is the upward scroll, in pixels, that came in during the return. */
  onBack: (pending: number) => void
}

/** What the stage tells the flow about the page, every frame while no reveal is on. */
export interface RevealWatch {
  /** The cloth has touched the moon. */
  touched: boolean
  /** The idle loop is baked. */
  idleReady: boolean
  /** The scroll is at its end and the cloth is settled: the idle plays. */
  atEnd: boolean
  /** A finger is held on the page. */
  held: boolean
}

export interface RevealFlow {
  /** A reveal is on: the stage hands its frames to step() and its input to scroll() / back(). */
  readonly active: boolean
  watch: (dt: number, page: RevealWatch) => void
  /** One frame of a reveal. `redraw`: something outside it asks for a draw. Returns whether the next frame is needed. */
  step: (dt: number, redraw: boolean) => boolean
  /** Scroll input (pixels, negative is up) while a reveal is on. */
  scroll: (delta: number) => void
  /** Starts the return, if a reveal is on and not already going back. */
  back: () => void
  /** Leaves a reveal at once and keeps what was loaded (the scene went away, the context was lost, the cloth goes down). */
  cancel: () => void
  /** cancel() and forgets everything loaded and baked (a new build or a new scene). */
  reset: () => void
  dispose: () => void
}

type Phase = "off" | "lifting" | "reveal" | "final" | "returning"

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

export function createRevealFlow({ scene, bakeLift, draw, onStart, onBack }: RevealFlowOptions): RevealFlow {
  // ---------- Loading ----------
  let generation = 0 // a load or a bake of an older one is ignored
  let loading: "none" | "loading" | "failed" = "none"
  let reveal: ClothReveal | null = null
  let lift: LiftResult | null = null
  let cancelLift = () => {}
  let armed = true
  let settle = 0

  const load = () => {
    const target = scene()
    if (!target) return
    loading = "loading"
    const id = generation
    const fail = () => {
      if (id === generation) loading = "failed" // the page stays as it was
    }
    target
      .loadReveal()
      .then((view) => {
        if (id !== generation) return undefined
        view.onEggDone = () => {
          eggDone = true
        }
        reveal = view
        return view.prepare()
      })
      .catch(fail)
    cancelLift = bakeLift((result) => {
      if (id === generation) lift = result
    }, fail)
  }

  // ---------- The reveal ----------
  let phase: Phase = "off"
  let T = 0 // seconds since the lift started (stays at the lift's end after it)
  let dispW = 1 // how much of the idle's sway is left on the cloth
  let clothShown = false
  let eggStarted = false
  let eggDone = false
  let stillDrawn = false // the final state is on screen and nothing moves

  const duration = () => lift?.duration ?? 0
  const playEgg = (view: ClothReveal) => {
    if (eggStarted) return
    eggStarted = true
    view.playEgg()
  }

  const start = (view: ClothReveal) => {
    draw() // the settled pose, with the idle's sway as it is now: the view remembers it
    if (!view.enter()) return
    onStart()
    armed = false
    settle = 0
    T = 0
    dispW = 1
    clothShown = true
    eggStarted = false
    eggDone = false
    stillDrawn = false
    pending = 0
    if (!reducedMotion()) {
      phase = "lifting"
      return
    }
    view.jumpToFinal()
    enterFinal()
    draw()
  }
  const enterFinal = () => {
    phase = "final"
    // >>> THE SITE NAVIGATES HERE: router.push('/chicken-rescue')
    // Until then the final state is just the rooster standing in the scene, with no UI at all. Scrolling up (or
    // Escape) brings the cloth back; on the site the browser's back button would do it.
  }

  const stepForward = (view: ClothReveal, dt: number) => {
    view.update(dt)
    const length = duration()
    if (phase === "lifting") {
      T += dt
      dispW = 1 - smoothstep(0, REVEAL.idleFade, T)
      view.setMoonAlpha(1 - smoothstep(0, REVEAL.moonFade, T))
      view.setEggGrow(T)
      view.setGoals({ light: 1 })
      if (T >= length * 0.3) view.setGoals({ camera: 1 })
      if (T >= view.uncoverTime) playEgg(view)
      if (T < length) {
        view.showLiftFrame(T, dispW)
      } else {
        view.hideCloth()
        clothShown = false
        T = length
        phase = "reveal"
      }
    } else if (phase === "reveal") {
      playEgg(view)
      if (eggDone) enterFinal()
    }
    view.setGoals({ final: view.eggDropped ? 1 : 0 })
  }

  // ---------- The way back ----------
  // The lift played backwards from wherever it is (all of it when the reveal is over, a part when it was cut short);
  // the egg and the rooster shrink away under it, the moon comes back, the camera and the lights ease to the page's.
  let rT = 0
  let retFrom = 0
  let retDelay = 0
  let moonFrom = 0
  let pending = 0

  const back = () => {
    const view = reveal
    if (!view || phase === "off" || phase === "returning") return
    const lifting = phase === "lifting"
    retFrom = lifting ? Math.min(T, duration()) : duration()
    retDelay = lifting ? 0 : REVEAL.back * 0.3 // from the final state the egg goes first, then the cloth comes
    moonFrom = lifting ? 1 - smoothstep(0, REVEAL.moonFade, T) : 0
    phase = "returning"
    rT = 0
    stillDrawn = false
    if (reducedMotion()) finishBack(view)
  }

  const finishBack = (view: ClothReveal) => {
    view.leave()
    const kept = pending
    phase = "off"
    pending = 0
    onBack(kept)
    draw() // the settled pose, exactly
  }

  const stepBack = (view: ClothReveal, dt: number) => {
    rT += dt
    view.update(dt)
    const s = smoothstep(0, REVEAL.back * 0.5, rT)
    view.setEggGrow(T, 1 - s)
    view.setMoonAlpha(moonFrom + (1 - moonFrom) * s)
    dispW = Math.max(dispW - dt / REVEAL.idleFade, 0)
    const q = clamp((rT - retDelay) / Math.max(retFrom * REVEAL.back, 0.05), 0, 1)
    if (q > 0) clothShown = true
    if (clothShown) view.showLiftFrame(retFrom * (1 - smoothstep(0, 1, q)), dispW)
    view.setGoals({ camera: 0, final: 0, light: 0 })
    if (q >= 1 && view.levels.camera <= 0.001) {
      finishBack(view)
      return
    }
    draw()
  }

  const step = (dt: number, redraw: boolean) => {
    const view = reveal
    if (!view || phase === "off") return false
    if (phase === "returning") {
      stepBack(view, dt)
      return true
    }
    stepForward(view, dt)
    const { camera, final, light } = view.levels
    const still = phase === "final" && eggDone && camera > 0.999 && final > 0.999 && light > 0.999
    // The final state is a still picture: once it is drawn the loop may stop until something asks for a frame.
    if (still && stillDrawn && !redraw) return false
    draw()
    stillDrawn = still
    return !still
  }

  const scroll = (delta: number) => {
    if (phase === "off") return
    if (phase === "returning") {
      pending = Math.max(pending - delta, 0) // up (negative) adds to it, down takes it back
      return
    }
    if (delta >= 0) return
    pending = -delta
    back()
  }

  // ---------- Every frame, while no reveal is on ----------
  const watch = (dt: number, page: RevealWatch) => {
    if (phase !== "off") return
    if (loading === "none" && page.touched && page.idleReady) load()
    if (reveal && lift && !reveal.hasLift) reveal.setLift(lift)
    // The scroll left the end: the next arrival there may start a reveal.
    if (!page.atEnd) {
      armed = true
      settle = 0
      return
    }
    if (!armed || page.held || !reveal || !reveal.ready || !reveal.hasLift) {
      settle = 0
      return
    }
    settle += dt
    if (settle > REVEAL.autoDelay) start(reveal)
  }

  const cancel = () => {
    if (phase === "off") return
    reveal?.leave()
    phase = "off"
    pending = 0
  }
  const reset = () => {
    cancel()
    generation++
    cancelLift()
    cancelLift = () => {}
    loading = "none"
    reveal = null
    lift = null
    armed = true
    settle = 0
  }

  return {
    get active() {
      return phase !== "off"
    },
    watch,
    step,
    scroll,
    back,
    cancel,
    reset,
    dispose: reset,
  }
}
