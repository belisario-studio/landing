// Every constant of the scroll-driven cloth (the `fabric_scroll_background` flag), in one
// place. Lengths are in stage heights (the viewport's height = 1) unless a name says
// otherwise, so the whole effect scales with the viewport.

// ---------- View ----------
export const FOV_DEG = 50
/** Distance at which a plane one stage height tall fills the view: the page at rest. */
export const CAM_D = 0.5 / Math.tan((FOV_DEG * Math.PI) / 360)

// ---------- Bake ----------
export const MESH = { segX: 40, segY: 30 }
export const SUB_DT = 1 / 120
export const RECORD_EVERY = 2
/** Seconds between two recorded frames of the fall. */
export const FRAME_DT = SUB_DT * RECORD_EVERY
export const SPHERE_R = 0.22
export const CONTACT_GAP = 0.012

export const PHYSICS = {
  gravity: 4.5, // stage heights per s²
  drag: 4, // air resistance: higher falls slower and more open
  wind: 3.5, // the gust that lays the sheet flat while it falls
  bend: 0.12, // stiffness against folding: 1 is card, low is silk
  friction: 0.75, // against the moon
  // The top pins let go one after another, from the two ends to the centre, inside
  // [rel0, rel0 + relSpan] * tRel seconds.
  tRel: 0.4,
  rel0: 0.05,
  relSpan: 0.9,
  // The gust builds while the curtain still hangs and dies once it is loose (seconds).
  gustOn: [0, 0.3],
  gustOff: [0.6, 1.0],
  // It is a layer of moving air near the bottom of the page: nothing at shearTop, full
  // strength from shearBot down.
  shearTop: 0,
  shearBot: -0.6,
  damp: 0.995,
  dampContact: 0.975,
  dampRamp: 0.3, // seconds from the first touch to the settled damping
  lead: 0.05, // gap left between the sheet and the moon when the moon is placed
  flat: 0.7, // the sheet counts as lying flat when it is less tall than this
  clearance: 0.5, // how far below the resting view the moon must be
}

// ---------- Idle: the loop the settled sheet sways in ----------
export const IDLE = {
  strength: 0.08, // the breeze
  period: 5, // seconds per cycle
  every: 6, // sub-steps per recorded frame: 20 frames a second
  intro: 2, // seconds for the breeze to build up from nothing
  warm: 1, // cycles nobody sees, for the motion to become the same every cycle
  fade: 0.5, // seconds to hand the sheet back to the scroll
}

// ---------- Scroll and camera ----------
/** Stage heights of wheel/touch travel for the whole range. */
export const SCROLL_HEIGHTS = 2.2
/** Share of the scroll range at which the sheet first touches the moon. */
export const LAND_AT = 0.75
/** How far the view gets ahead of the sheet: 0 keeps pace, more shows the moon sooner. */
export const SCROLL_LAG = 1
export const CAM_END = { targetY: -0.12, rise: 0.42, back: 0.38, pitchFrom: 0.7, ahead: 0.2, early: 0.45 }
/** Seconds: the shown time eases toward the scroll's. */
export const EASE_TAU = 0.11
/** Going home, the last half frame of easing is skipped: the cloth is flat by then. */
export const RELEASE_BELOW_S = 0.008
// A scroll left resting within the first seconds of the fall goes back to rest: the
// starfield is a frozen picture while the cloth is up, so a page left a hair into the
// scroll would look broken. Past that zone the cloth stays where the scroll left it.
export const SNAP = { zone: 1.1, stopMs: 160, backSpeed: 2.5 }

// ---------- Title ----------
export const TITLE = {
  anchor: 0.87, // seconds of the fall at which the title stops shrinking
  out: 0.58, // share of the scroll at which it has left through the top
  soft: 0.03, // the shrinking dies away over this much scroll either side of the stop
  depth: 0.55, // its light sits this far from the eye to the page's rest plane
}
export const TITLE_GRADIENT = ["#9bb0ff", "#cad7ff", "#f8f7ff", "#fff4e8", "#ffeddb", "#ffd2a1", "#ffb56c"]

// ---------- Look: the owner's pick ("Satén con borde") ----------
// `general` scales every light but the base one. Intensities are three's.
export const LOOK = {
  general: 0.05,
  fade: 0.04, // share of the scroll over which everything but the base light comes in
  baseFall: 1.02, // the base light once the cloth is away from rest (1 = the page's own)
  exposure: 1.5, // AgX, on the cloth and on the starfield
  fill: { color: "#ffb56c", intensity: 20.03, from: [-1, 0.25, 0] },
  rim: { color: "#cfe0ff", intensity: 0.7, width: 0.4 },
  title: { intensity: 0.5, reach: 0.56, mix: 1 },
  // The sun that lights the moon also tints the cloth.
  sun: { color: "#3c14ff", intensity: 30 },
  roughness: 0.05,
  fibre: 0.06, // a faint white the lights act on besides the (almost black) texture
}

// ---------- Moon ----------
// The moon of Chicken Rescue (moon.gdshader's uniforms, with moon.tscn's two overrides
// rim_base 0 and rim_on_dark 0 folded into the shader).
export const MOON = {
  bumpRatio: 0.004,
  bumpRatioFine: 0.001,
  relief: 12,
  rimGain: [2.708333, 5.0, 4.932692],
  rimExponent: 7,
  exposure: 2.5, // its own linear tone curve, whatever the cloth uses
  earthshine: 0.15,
  earthshineTint: [0.72, 0.84, 1.0],
  // The 2K maps are worth their bytes only when the disc is drawn big: its diameter in
  // device pixels times π (the texels the 1K map would be stretched over) above this.
  sharpAbove: 1100,
}
export const MOON_MAPS = {
  "1k": { albedo: "/moon/moon_albedo_1k.jpg", relief: "/moon/moon_height_1k.jpg", width: 1024, height: 512 },
  "2k": { albedo: "/moon/moon_albedo_2k.webp", relief: "/moon/moon_height_2k.webp", width: 2048, height: 1024 },
}
/** The moon is shown as seen from here, at its upper transit of today's local date. */
export const OBSERVER = { lat: -34.6037, lon: -58.3816, utcOffsetHours: -3 } // Buenos Aires, no summer time

// ---------- Reveal: the lift, the egg and the rooster (see cloth-reveal.ts) ----------
// The prototype's NAV block. The lift keys (liftSpeed, grabX, grabZ, eggAspect) are read when the lift is baked
// (revealLiftOptions, revealEggAmount), so changing one means baking again; roosterScale and eggAspect also go to
// the egg (ClothReveal.retune()); the rest are read as they are used.
export interface RevealConfig {
  /** Stage heights per second the hand rises at (the lift bake's LIFT.speed). */
  liftSpeed: number
  /** [dx, dz] from the top of the moon, in stage heights, of the point the hand takes the cloth at. */
  grabX: number
  grabZ: number
  /** The game's egg: height / width. The lift's collider (upper half 2 * eggAspect - 2 taller than the moon's sphere) and the egg share it. */
  eggAspect: number
  /** The egg's widest radius, as a multiple of the moon's. */
  eggSize: number
  /** The rooster's final height / the egg's height. */
  roosterScale: number
  /** Multiplies the shell's colour. AgX's shoulder flattens a bright egg to a white blob; 0.65 gives the game's warm light grey with its shading (measured against the reference render). */
  eggTone: number
  /** Seconds the settled cloth waits at the end of the scroll before the reveal starts by itself (the controller's). */
  autoDelay: number
  /** How much of the reveal's camera offsets is used: 0 keeps the page's own camera, 1 is the fitted framing. */
  camMove: number
  /** Return speed: the lift played backwards takes `back` times its own length (the controller's). */
  back: number
  // The prototype's literals, here so that the controller and the view agree on them.
  /** Seconds in which the idle's displacement from the settled pose fades out at the start of the lift. */
  idleFade: number
  /** Seconds in which the moon fades out under the cloth at the start of the lift. */
  moonFade: number
  /** Seconds the camera takes to go from the page's to the reveal framing (rise) and back (fall); the same for the final framing and the lights. */
  ease: { camera: [rise: number, fall: number]; final: [number, number]; light: [number, number] }
}
export const REVEAL: RevealConfig = {
  liftSpeed: 0.85,
  grabX: 0,
  grabZ: 0,
  eggAspect: 1.3875,
  eggSize: 1,
  roosterScale: 1.25,
  eggTone: 0.65,
  autoDelay: 0.6,
  camMove: 1,
  back: 0.9,
  idleFade: 0.3,
  moonFade: 0.35,
  ease: { camera: [1.4, 1.2], final: [0.9, 0.5], light: [0.9, 0.8] },
}
/** How much taller than the moon's sphere the egg's upper half is, at its full size (the lift bake's `egg`). */
export const revealEggAmount = () => 2 * REVEAL.eggAspect - 2
/** The options liftJob takes, from the tunables. */
export const revealLiftOptions = () => ({ speed: REVEAL.liftSpeed, at: [REVEAL.grabX, REVEAL.grabZ] as [number, number] })

/**
 * Where the rooster stands in the final state, in NDC y of the stage: its comb at +top, its feet at -bottom, so it is
 * centred (measured on the pixels, not the model: asking for 0.47 / 0.345 puts them at about +-0.44).
 */
export const FINAL_FRAME = { top: 0.47, bottom: 0.345 }
/** The reveal framing: the egg, the floor and the flight of the cap's shell between NDC y = +top and -bottom. */
export const REVEAL_FRAME = { top: 0.8, bottom: 0.56 }

/**
 * The reveal's lights. The cloth's own lights are tuned for the cloth, so while the reveal is on the scene's existing
 * ones are re-aimed, tinted and dimmed (no light is added: that would recompile the cloth's shader). `key` is the
 * moon's sun light, `fill` the warm side light. AgX turns anything bright into pink-white, so these are low: the egg
 * and the rooster come out a warm cream and a soft white with shading, not clipped.
 */
export const REVEAL_LIGHTS = {
  key: { color: "#ffcf94", intensity: 1.3, az: -35, el: 38 },
  fill: { color: "#ffb070", intensity: 0.4, az: 70, el: 12 },
  ambient: { color: "#ffe2c4", scale: 0.45 },
}
