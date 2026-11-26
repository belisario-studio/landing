// The scene's side of the reveal: the settled cloth is lifted by the baked frames, the moon under it is swapped for an
// egg while it is hidden, the egg cracks and the rooster drops out. This file draws and moves what the scene shows;
// WHEN things happen (states, scroll rules, worker requests, the order of calls) belongs to the controller, which
// drives it with the methods below and then asks the scene to draw.
//
// Created lazily by the scene (ClothScene.loadReveal) once the cloth has landed; this module, the egg and the rooster
// are only downloaded then, and nothing is built before prepare().
//
// What the scene does with it, when `engaged` (between enter() and leave()), inside ClothScene.draw:
//  * the cloth's frame is not written: the cloth is whatever showLiftFrame() wrote last (or hidden);
//  * the camera is the end of the scroll's plus the reveal's offsets (applyCamera);
//  * the existing lights are re-aimed, tinted and dimmed (applyLights).
// Not engaged, draw() is exactly what it was without this file.
import * as THREE from "three"
import { eggStretch, LIFT } from "./cloth-bake"
import type { ClothPlanet, ClothTimeline, LiftResult } from "./cloth-bake"
import {
  CONTACT_GAP,
  FINAL_FRAME,
  REVEAL,
  REVEAL_FRAME,
  REVEAL_LIGHTS,
  revealEggAmount,
  SPHERE_R,
} from "./cloth-config"
import { smoothstep } from "./cloth-scroll"
import { createRevealEgg, type RevealEgg, type RevealEggPhase } from "./reveal-egg"
import { buildRooster, disposeRooster } from "./reveal-rooster"

export interface ClothRevealDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  cameraTarget: THREE.Vector3
  timeline: () => ClothTimeline | null
  /** The stage's height in CSS pixels: frames are in stage heights, the scene in pixels. */
  stageHeight: () => number
  mesh: () => THREE.Mesh<THREE.PlaneGeometry, THREE.Material> | null
  moon: () => THREE.Mesh | null
  moonMaterial: THREE.ShaderMaterial
  /** The scene's lights: `key` is the moon's sun light. */
  lights: { ambient: THREE.AmbientLight; key: THREE.DirectionalLight; fill: THREE.DirectionalLight }
}

/** Where the eased channels are heading: 0 = the page's, 1 = the reveal's. */
export interface RevealGoals {
  /** The camera's offset to the reveal framing (the egg, the floor and the shells' flight on the page's centre). */
  camera: number
  /** From the reveal framing to the final one (the rooster is the whole page). */
  final: number
  /** The reveal's lights over the cloth's. */
  light: number
}

export interface ClothReveal {
  /** The egg and the rooster are built. */
  readonly ready: boolean
  /** A lift is set. */
  readonly hasLift: boolean
  /** Between enter() and leave(): the scene draws the reveal's camera and lights and leaves the cloth to it. */
  readonly engaged: boolean
  /** Seconds into the lift at which no vertex touches the egg any more (0 without a lift). From then on playEgg() is safe. */
  readonly uncoverTime: number
  /** "none" until prepared. */
  readonly eggPhase: RevealEggPhase | "none"
  /** The rooster has touched the floor (the controller may ask for the final framing). */
  readonly eggDropped: boolean
  /** The eased channels' current values. */
  readonly levels: Readonly<RevealGoals>
  /** Called once from update() when the egg's run ends (the rooster stands). */
  onEggDone: (() => void) | null

  /** Builds the egg and the rooster, one step a frame, once; later calls return the same promise. Rejects if the rooster cannot be fetched (the next call tries again). */
  prepare: () => Promise<void>
  /** The baked lift; null forgets it. Works out uncoverTime. */
  setLift: (result: LiftResult | null) => void
  /** Re-reads REVEAL.eggAspect and REVEAL.roosterScale into the egg (the lift must be baked again for eggAspect). */
  retune: () => void

  /**
   * Starts a reveal from the settled cloth: needs ready and a lift (false otherwise, nothing changes). Call it right
   * after a draw of the settled pose: what is on the cloth now beyond that pose (the idle's sway) is remembered and
   * faded out by showLiftFrame's `idleWeight`. Puts the whole egg under the moon, fits the camera.
   */
  enter: () => boolean
  /** Back to the page's own rendering at once: cloth shown, moon at 1, egg gone, lights and channels at 0, the egg reset. Keeps the lift. */
  leave: () => void
  /** leave() and forget the lift (a new timeline; the scene calls this itself). */
  resetAll: () => void

  /** Where the camera / final framing / lights are heading (only the ones given). Eased by update(). */
  setGoals: (goals: Partial<RevealGoals>) => void
  /** Moves the eased channels to their goals now (reduced motion). */
  snapGoals: () => void

  /**
   * Shows the lift at `time` seconds (clamped to the lift) with `idleWeight` (1..0) of the idle's displacement left:
   * writes the cloth's positions, recomputes its normals, makes it visible. The scene must then draw.
   */
  showLiftFrame: (time: number, idleWeight: number) => void
  hideCloth: () => void
  /** The moon's alpha, 1 = as ever; the moon is not drawn at all below 0.002. */
  setMoonAlpha: (alpha: number) => void
  /**
   * The egg's size and place for `time` seconds into the lift: the lower half is the moon's sphere, the upper half
   * grows with the lift's collider (full from LIFT.eggTo). `scale` (1..0) shrinks it away; 0 hides it.
   */
  setEggGrow: (time: number, scale?: number) => void
  /** Starts the egg's wobble (only from "whole"). */
  playEgg: () => void
  /** Advances the egg (once played) and the eased channels, by dt seconds. */
  update: (dt: number) => void
  /** Reduced motion: the finished reveal in one go: cloth gone, moon gone, egg grown, the egg played out to its end, channels at their goals (all 1). */
  jumpToFinal: () => void

  /** The view got another size (the scene's camera aspect changed): the framing is fitted again. */
  resize: () => void
  /** The framing, for tests and tuning. */
  framing: () => { shift: THREE.Vector3; dolly: number; shiftFinal: THREE.Vector3; dollyFinal: number; halfWidth: number }
  /** The egg, for tests and tuning (null until prepared). */
  egg: () => RevealEgg | null
  dispose: () => void

  // ----- for ClothScene.draw only -----
  /** Sets the camera and its target: the end of the scroll's plus the offsets. */
  applyCamera: () => void
  /** Re-aims, tints and dims the scene's lights by the light channel. Call after the scene set its own intensities. */
  applyLights: () => void
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

/** 0° azimuth is from the eye's side (+z), 90° from the right (+x); elevation up from the horizon. */
const dirVector = (az: number, el: number, into: THREE.Vector3) => {
  const a = (az * Math.PI) / 180
  const e = (el * Math.PI) / 180
  const v = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)].map((c) => (Math.abs(c) < 1e-9 ? 0 : c))
  return into.set(v[0], v[1], v[2])
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

interface LightBase {
  color: THREE.Color
  position: THREE.Vector3
  intensity: number
}

export function createClothReveal(deps: ClothRevealDeps): ClothReveal {
  const { renderer, camera, cameraTarget, moonMaterial, lights } = deps

  let egg: RevealEgg | null = null
  let rooster: THREE.Group | null = null
  let preparing: Promise<void> | null = null
  let ready = false
  let disposed = false

  let lift: LiftResult | null = null
  let uncover = 0
  let engaged = false
  let playing = false
  let eggDone = false
  /** The idle's displacement from the settled pose when the reveal started. */
  let disp: Float32Array | null = null

  const levels: RevealGoals = { camera: 0, final: 0, light: 0 }
  const goals: RevealGoals = { camera: 0, final: 0, light: 0 }
  const shift = new THREE.Vector3()
  const shiftFinal = new THREE.Vector3()
  let dolly = 0
  let dollyFinal = 0
  let halfWidth = 1

  const onDone = { current: null as (() => void) | null }

  // ---------- Building ----------
  const eggAmount = revealEggAmount
  const prepareSteps = async () => {
    // One step a frame, so the page keeps moving: the egg (its shell pieces, its textures), then the rooster.
    await nextFrame()
    if (disposed) return
    if (!egg) {
      egg = createRevealEgg({
        radius: 1,
        params: { stretch: 1 + eggAmount(), roosterScale: REVEAL.roosterScale, arena: 2.2, landingHeight: 0.7 },
      })
      egg.group.visible = false
      egg.materials.outer.color.multiplyScalar(REVEAL.eggTone)
      egg.onDone = () => {
        eggDone = true
        onDone.current?.()
      }
      deps.scene.add(egg.group)
    }
    await nextFrame()
    if (disposed) return
    if (!rooster) {
      const built = await buildRooster()
      if (disposed) {
        disposeRooster(built)
        return
      }
      rooster = built
      egg.setRooster(rooster)
    }
    await nextFrame()
    if (disposed) return
    // Compile the egg's programs now instead of in the middle of the reveal's first frame. The group is shown only for
    // the moment the traversal takes; no frame is drawn in between.
    const compiling = egg.group
    compiling.visible = true
    const done = renderer.compileAsync(deps.scene, camera).catch(() => {})
    compiling.visible = false
    await done
    ready = !disposed
  }
  const prepare = () => {
    if (preparing) return preparing
    const run = prepareSteps()
    preparing = run
    run.catch(() => {
      if (preparing === run) preparing = null
    })
    return run
  }

  // ---------- The lift ----------
  /** The first moment from which no vertex is inside (or touching) the growing egg any more: the egg is uncovered. */
  const uncoverTimeOf = (r: LiftResult, planet: ClothPlanet) => {
    const rc = SPHERE_R + CONTACT_GAP
    let lastHit = -1
    for (let k = 0; k < r.frames.length; k++) {
      const f = r.frames[k]
      const ky = eggStretch(r.egg, k * r.dt)
      for (let i = 0; i < f.length; i += 3) {
        const up = f[i + 1] - planet.y
        const d = Math.hypot(f[i] - planet.x, up / (up > 0 ? ky : 1), f[i + 2] - planet.z)
        if (d < rc * 1.08) {
          lastHit = k
          break
        }
      }
    }
    return (lastHit + 1) * r.dt
  }
  const setLift = (result: LiftResult | null) => {
    lift = result
    const tl = deps.timeline()
    uncover = result && tl ? uncoverTimeOf(result, tl.planet) : 0
  }

  const showLiftFrame = (time: number, idleWeight: number) => {
    const mesh = deps.mesh()
    const L = lift
    if (!mesh || !L) return
    const H = deps.stageHeight()
    const position = mesh.geometry.attributes.position
    const arr = position.array as Float32Array
    const f = clamp(time / L.dt, 0, L.frames.length - 1)
    const i0 = Math.floor(f)
    const i1 = Math.min(i0 + 1, L.frames.length - 1)
    const s = f - i0
    const fa = L.frames[i0]
    const fb = L.frames[i1]
    if (idleWeight > 0 && disp && disp.length === arr.length) {
      for (let i = 0; i < arr.length; i++) arr[i] = (fa[i] + (fb[i] - fa[i]) * s) * H + disp[i] * idleWeight
    } else {
      for (let i = 0; i < arr.length; i++) arr[i] = (fa[i] + (fb[i] - fa[i]) * s) * H
    }
    position.needsUpdate = true
    mesh.geometry.computeVertexNormals()
    mesh.visible = true
  }
  const hideCloth = () => {
    const mesh = deps.mesh()
    if (mesh) mesh.visible = false
  }

  // ---------- Moon and egg ----------
  const setMoonAlpha = (alpha: number) => {
    moonMaterial.uniforms.moon_alpha.value = alpha
    const moon = deps.moon()
    if (moon) moon.visible = alpha > 0.002
  }
  const setEggGrow = (time: number, scale = 1) => {
    const e = egg
    const tl = deps.timeline()
    if (!e || !tl) return
    const H = deps.stageHeight()
    const k = 1 + eggAmount()
    const R = SPHERE_R * H * REVEAL.eggSize
    // How much of the full egg's height the lift's collider has now.
    const g = time >= LIFT.eggTo ? 1 : (1 + eggStretch(eggAmount(), time)) / (1 + k)
    e.group.scale.set(R * scale, R * g * scale, R * scale)
    e.group.position.set(tl.planet.x * H, (tl.planet.y - SPHERE_R) * H + R * ((1 + k) / 2) * g, tl.planet.z * H)
    e.group.visible = scale > 0
  }
  const playEgg = () => {
    if (!egg || !engaged || playing) return
    playing = true
    egg.play()
  }

  // ---------- Framing ----------
  // The camera of the end of the scroll, in scene units.
  const endCamera = (pos: THREE.Vector3, target: THREE.Vector3) => {
    const tl = deps.timeline()
    if (!tl) return false
    const H = deps.stageHeight()
    const a = (tl.frameCount - 1) * 6
    pos.set(tl.camera[a] * H, tl.camera[a + 1] * H, tl.camera[a + 2] * H)
    target.set(tl.camera[a + 3] * H, tl.camera[a + 4] * H, tl.camera[a + 5] * H)
    return true
  }
  // A camera of its own for the fit, so the scene's is not disturbed.
  const fitCamera = new THREE.PerspectiveCamera()
  const camBase = new THREE.Vector3()
  const camTarget = new THREE.Vector3()
  const baseTarget = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const camUp = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const pTop = new THREE.Vector3()
  const pBot = new THREE.Vector3()

  // Moves the end camera up/down and in/out so that the vertical span a..b lands between NDC y = wantTop and -wantBot.
  const fit = (a: THREE.Vector3, b: THREE.Vector3, wantTop: number, wantBot: number, maxIn: number, tanHalf: number) => {
    let up = 0
    let dollyBy = 0
    const depth0 = mid.copy(a).add(b).multiplyScalar(0.5).sub(camBase).dot(dir)
    for (let it = 0; it < 6; it++) {
      fitCamera.position.copy(camBase).addScaledVector(camUp, up).addScaledVector(dir, dollyBy)
      camTarget.copy(baseTarget).addScaledVector(camUp, up).addScaledVector(dir, dollyBy)
      fitCamera.lookAt(camTarget)
      fitCamera.updateMatrixWorld()
      const yt = tmp.copy(a).project(fitCamera).y
      const yb = tmp.copy(b).project(fitCamera).y
      const depth = mid.copy(a).add(b).multiplyScalar(0.5).sub(fitCamera.position).dot(dir)
      dollyBy += depth * (1 - clamp((yt - yb) / (wantTop + wantBot), 0.5, 2))
      up += ((yt + yb) / 2 - (wantTop - wantBot) / 2) * depth * tanHalf
    }
    return [up, clamp(dollyBy, -0.5 * depth0, maxIn * depth0)] as const
  }

  /**
   * Where the camera goes for the egg: the reveal's middle (egg, floor and the shells' flight) on the centre of the page
   * and, if there is room, a little closer; and the final state's, where the rooster is the whole page. Computed from the
   * camera of the end of the scroll and the view's aspect, so again after a resize.
   */
  const computeFraming = () => {
    const e = egg
    const tl = deps.timeline()
    if (!e || !tl || !endCamera(camBase, camTarget)) return
    const H = deps.stageHeight()
    fitCamera.fov = camera.fov
    fitCamera.aspect = camera.aspect
    fitCamera.near = camera.near
    fitCamera.far = camera.far
    fitCamera.updateProjectionMatrix()
    const ex = e.extent()
    const R = SPHERE_R * H * REVEAL.eggSize
    const k = 1 + revealEggAmount()
    const cy = (tl.planet.y - SPHERE_R) * H + R * ((1 + k) / 2)
    const px = tl.planet.x * H
    const pz = tl.planet.z * H
    // The reveal spans from the floor (and the shells that land on it) to where the cap's shell flies.
    pTop.set(px, cy + (ex.topOfFlight + 0.8) * R, pz)
    pBot.set(px, cy + (ex.floorY - 0.2) * R, pz)
    dir.copy(camTarget).sub(camBase).normalize()
    baseTarget.copy(camTarget)
    fitCamera.position.copy(camBase)
    fitCamera.lookAt(camTarget)
    fitCamera.updateMatrixWorld()
    camUp.setFromMatrixColumn(fitCamera.matrixWorld, 1)
    const tanHalf = Math.tan((fitCamera.fov * Math.PI) / 360)
    // 1) the reveal: the egg, the floor and the flight of the cap
    let [up, dollyBy] = fit(pTop, pBot, REVEAL_FRAME.top, REVEAL_FRAME.bottom, 0.45, tanHalf)
    shift.copy(camUp).multiplyScalar(up)
    dolly = dollyBy
    // 2) the final state: the rooster is the whole page, centred
    const floor = pBot.clone()
    floor.y = cy + ex.floorY * R
    const top = floor.clone()
    top.y += ex.roosterHeight * R
    ;[up, dollyBy] = fit(top, floor, FINAL_FRAME.top, FINAL_FRAME.bottom, 0.8, tanHalf)
    shiftFinal.copy(camUp).multiplyScalar(up)
    dollyFinal = dollyBy
    // Shells fly sideways: keep them inside the page, at the rooster's distance from the final camera (the narrower
    // view). 0.62 of the half width: on a narrow page the shells still land inside the frame.
    fitCamera.position.copy(camBase).add(shiftFinal).addScaledVector(dir, dollyFinal)
    const dist = floor.sub(fitCamera.position).dot(dir)
    halfWidth = (dist * tanHalf * fitCamera.aspect) / R
    const arena = clamp(halfWidth * 0.62, 1.5, 3.3)
    // setParams resets the egg: only while it stands whole.
    if (e.phase === "whole" && Math.abs(ex.params.arena - arena) > 0.01) e.setParams({ arena })
  }

  const applyCamera = () => {
    if (!endCamera(camera.position, cameraTarget)) return
    const k = smoothstep(0, 1, levels.camera) * REVEAL.camMove
    if (k > 0) {
      const d = smoothstep(0, 1, levels.final)
      const dl = dolly + (dollyFinal - dolly) * d
      dir.copy(cameraTarget).sub(camera.position).normalize()
      for (const p of [camera.position, cameraTarget]) {
        p.addScaledVector(shift, k * (1 - d)).addScaledVector(shiftFinal, k * d).addScaledVector(dir, dl * k)
      }
    }
    camera.lookAt(cameraTarget)
  }

  // ---------- Lights ----------
  const keyBase: LightBase = { color: new THREE.Color(), position: new THREE.Vector3(), intensity: 0 }
  const fillBase: LightBase = { color: new THREE.Color(), position: new THREE.Vector3(), intensity: 0 }
  const tint = new THREE.Color()
  const aim = new THREE.Vector3()
  let lightsTouched = false
  const captureLights = () => {
    for (const [light, base] of [
      [lights.key, keyBase],
      [lights.fill, fillBase],
    ] as const) {
      base.color.copy(light.color)
      base.position.copy(light.position)
      base.intensity = light.intensity
    }
  }
  const restoreLights = () => {
    if (!lightsTouched) return
    lightsTouched = false
    lights.ambient.color.set(0xffffff)
    for (const [light, base] of [
      [lights.key, keyBase],
      [lights.fill, fillBase],
    ] as const) {
      light.color.copy(base.color)
      light.position.copy(base.position)
      light.intensity = base.intensity
    }
  }
  const applyLights = () => {
    const k = smoothstep(0, 1, levels.light)
    if (k <= 0) {
      restoreLights()
      return
    }
    lightsTouched = true
    const A = REVEAL_LIGHTS.ambient
    lights.ambient.intensity *= 1 - (1 - A.scale) * k
    lights.ambient.color.set(0xffffff).lerp(tint.set(A.color), k)
    const sets = [
      [lights.key, keyBase, REVEAL_LIGHTS.key, lights.key.intensity],
      [lights.fill, fillBase, REVEAL_LIGHTS.fill, fillBase.intensity],
    ] as const
    for (const [light, base, d, current] of sets) {
      light.color.copy(base.color).lerp(tint.set(d.color), k)
      light.position.lerpVectors(base.position, dirVector(d.az, d.el, aim), k)
      light.intensity = current + (d.intensity - current) * k
    }
  }

  // ---------- States ----------
  const settleLevel = (name: keyof RevealGoals, dt: number, [rise, fall]: [number, number]) => {
    levels[name] += clamp(goals[name] - levels[name], -dt / fall, dt / rise)
  }
  const update = (dt: number) => {
    if (!engaged) return
    if (playing) egg?.update(dt)
    settleLevel("camera", dt, REVEAL.ease.camera)
    settleLevel("final", dt, REVEAL.ease.final)
    settleLevel("light", dt, REVEAL.ease.light)
  }
  const setGoals = (g: Partial<RevealGoals>) => {
    Object.assign(goals, g)
  }
  const snapGoals = () => {
    Object.assign(levels, goals)
  }

  const enter = () => {
    const e = egg
    const mesh = deps.mesh()
    const tl = deps.timeline()
    if (!ready || !e || !lift || !mesh || !tl) return false
    if (engaged) leave()
    // The idle's displacement from the settled pose, at this very moment.
    const arr = mesh.geometry.attributes.position.array as Float32Array
    const H = deps.stageHeight()
    const rest = (tl.frameCount - 1) * tl.stride
    if (!disp || disp.length !== arr.length) disp = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) disp[i] = arr[i] - tl.frames[rest + i] * H
    captureLights()
    engaged = true
    playing = false
    eggDone = false
    levels.camera = levels.final = levels.light = 0
    goals.camera = goals.final = goals.light = 0
    e.reset()
    e.group.visible = true
    setEggGrow(0)
    computeFraming()
    return true
  }

  const leave = () => {
    const wasEngaged = engaged
    engaged = false
    playing = false
    eggDone = false
    levels.camera = levels.final = levels.light = 0
    goals.camera = goals.final = goals.light = 0
    restoreLights()
    setMoonAlpha(1)
    const mesh = deps.mesh()
    if (mesh) mesh.visible = true
    if (!egg) return
    if (wasEngaged || egg.group.visible) {
      egg.reset()
      egg.group.visible = false
    }
  }
  const resetAll = () => {
    leave()
    lift = null
    uncover = 0
  }

  const jumpToFinal = () => {
    const e = egg
    if (!engaged || !e) return
    hideCloth()
    setMoonAlpha(0)
    setEggGrow(LIFT.eggTo)
    playEgg()
    for (let i = 0; i < 1500 && !eggDone; i++) e.update(1 / 30)
    goals.camera = goals.final = goals.light = 1
    snapGoals()
  }

  const retune = () => {
    egg?.setParams({ stretch: 1 + eggAmount(), roosterScale: REVEAL.roosterScale })
  }

  const resize = () => {
    if (egg && deps.timeline()) computeFraming()
  }

  const dispose = () => {
    disposed = true
    leave()
    if (egg) {
      egg.dispose()
      egg = null
    }
    if (rooster) {
      disposeRooster(rooster)
      rooster = null
    }
    ready = false
  }

  return {
    get ready() {
      return ready
    },
    get hasLift() {
      return lift !== null
    },
    get engaged() {
      return engaged
    },
    get uncoverTime() {
      return uncover
    },
    get eggPhase() {
      return egg ? egg.phase : "none"
    },
    get eggDropped() {
      return !!egg && playing && (egg.phase === "dropped" || egg.phase === "done")
    },
    get levels() {
      return levels
    },
    get onEggDone() {
      return onDone.current
    },
    set onEggDone(fn) {
      onDone.current = fn
    },
    prepare,
    setLift,
    retune,
    enter,
    leave,
    resetAll,
    setGoals,
    snapGoals,
    showLiftFrame,
    hideCloth,
    setMoonAlpha,
    setEggGrow,
    playEgg,
    update,
    jumpToFinal,
    resize,
    framing: () => ({ shift, dolly, shiftFinal, dollyFinal, halfWidth }),
    egg: () => egg,
    dispose,
    applyCamera,
    applyLights,
  }
}
