// The WebGL side of the scroll-driven cloth: the cloth textured with the starfield's
// canvas, and the moon it lands on. One renderer for the life of the page, drawn only
// when asked. Everything on screen is a pure function of what draw() is given.
import * as THREE from "three"
import type { ClothIdle, ClothTimeline } from "./cloth-bake"
import { CAM_D, FOV_DEG, FRAME_DT, LOOK, MESH, MOON, MOON_MAPS, SPHERE_R, TITLE, TITLE_GRADIENT } from "./cloth-config"
import { smoothstep } from "./cloth-scroll"
import { CLOTH_LIGHTS, CLOTH_PARS, CLOTH_UNTONE, MOON_FRAGMENT, MOON_VERTEX } from "./cloth-shaders"
import { moonPoseToday } from "./moon-ephemeris"

export interface ClothSceneOptions {
  /** The starfield's canvas: the cloth's texture. */
  source: HTMLCanvasElement
  /** The page's black: the clear colour, and what the moon adds behind itself. */
  background: string
  /** The title, whose place on screen is where its light comes from. */
  title: () => HTMLElement | null
  onContextChange: (lost: boolean) => void
}

export interface ClothScene {
  canvas: HTMLCanvasElement
  /** Builds the scene for a timeline on a stage of this size (CSS pixels). Settles once the moon's maps are in. */
  setTimeline: (timeline: ClothTimeline, width: number, height: number) => Promise<void>
  setIdle: (idle: ClothIdle | null) => void
  /** A change of the viewport that keeps the scene as it was built (see background-stage). */
  resizeView: (width: number, height: number) => void
  /** Takes the starfield's current picture as the cloth's texture. */
  refreshTexture: () => void
  setVisible: (visible: boolean) => void
  /**
   * Draws the fall at `seconds`, plus `idleWeight` of the idle loop at `idleSeconds`.
   * At 0 seconds it is the flat rest pose: the starfield's picture, pixel for pixel.
   */
  draw: (seconds: number, idleSeconds: number, idleWeight: number, titleScale: number) => void
  /** Whether the title has moved on screen since the last draw (its light follows it). */
  titleMoved: () => boolean
  dispose: () => void
}

type MapSize = keyof typeof MOON_MAPS
interface MoonMaps {
  albedo: THREE.Texture
  relief: THREE.Texture
}

const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)

/** Throws when WebGL is not available. */
export function createClothScene({ source, background, title, onContextChange }: ClothSceneOptions): ClothScene {
  const renderer = new THREE.WebGLRenderer({ antialias: false })
  const canvas = renderer.domElement
  // Shown and hidden, never removed: the swap with the starfield is a visibility toggle.
  canvas.style.cssText = "display:block;width:100%;height:100%;visibility:hidden"
  renderer.setClearColor(background, 1)
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = LOOK.exposure
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 10)
  const cameraTarget = new THREE.Vector3()

  // ---------- Lights ----------
  // RULE: the flat rest pose must stay the page, bit for bit. So at rest the cloth is
  // drawn with `restMaterial` (the texture straight through, no light, no tone curve), and
  // on the lit material everything that could change that picture is scaled by a fade
  // that is 0 at rest and 1 after the first LOOK.fade of the scroll.
  // The base light. A Lambert surface returns albedo × ambient / π, so π returns the
  // texture unchanged.
  const ambient = new THREE.AmbientLight(0xffffff, Math.PI)
  // A warm light exactly from the side: it adds nothing to the flat cloth, so it needs no fade.
  const fill = new THREE.DirectionalLight(LOOK.fill.color, LOOK.fill.intensity * LOOK.general)
  fill.position.set(LOOK.fill.from[0], LOOK.fill.from[1], LOOK.fill.from[2])
  // The sun that lights the moon (see placeMoon) also tints the cloth.
  const sun = new THREE.DirectionalLight(LOOK.sun.color, 0)
  let sunFromFront = true
  scene.add(ambient, fill, sun)

  const uniforms = {
    uFade: { value: 0 },
    uFibre: { value: new THREE.Color(0xffffff).multiplyScalar(LOOK.fibre) },
    uRim: { value: LOOK.rim.intensity * LOOK.general },
    uRimPower: { value: 0.6 / (LOOK.rim.width * LOOK.rim.width) }, // wide rim = low power
    uRimColor: { value: new THREE.Color(LOOK.rim.color) },
    // Glossier cloth, tighter streak.
    uTitleShine: { value: Math.min(2 / Math.pow(Math.max(LOOK.roughness, 0.05), 3), 600) },
    uTitleSpec: { value: 0.6 * (1 - LOOK.roughness) },
    uTitle: { value: 0 },
    uTitleA: { value: new THREE.Vector3() },
    uTitleB: { value: new THREE.Vector3(1, 0, 0) },
    uTitleReach: { value: 1 },
    uTitleMix: { value: LOOK.title.mix },
    uTitleGrad: { value: TITLE_GRADIENT.map((c) => new THREE.Color(c)) },
  }

  // ---------- Cloth ----------
  let texture: THREE.CanvasTexture | null = null
  const restMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false })
  const clothMaterial = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    roughness: LOOK.roughness,
    metalness: 0,
  })
  clothMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + CLOTH_PARS)
      .replace("#include <map_fragment>", "#include <map_fragment>\n" + CLOTH_UNTONE)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + CLOTH_LIGHTS)
  }
  let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.Material> | null = null

  // At rest the cloth is the page, texel for pixel. Linear filtering there would let a
  // hundredth of a pixel of drift bleed each star into its dark neighbours (the blend
  // happens in linear light), so the rest pose samples the nearest texel instead.
  let restFilter: boolean | null = null
  const setRestFilter = (atRest: boolean) => {
    if (!texture || restFilter === atRest) return
    restFilter = atRest
    texture.magFilter = texture.minFilter = atRest ? THREE.NearestFilter : THREE.LinearFilter
    texture.needsUpdate = true
  }

  // ---------- Moon ----------
  const moonMaterial = new THREE.ShaderMaterial({
    uniforms: {
      albedo_map: { value: null as THREE.Texture | null },
      height_map: { value: null as THREE.Texture | null },
      texel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      relief: { value: MOON.relief },
      sun_direction: { value: new THREE.Vector3(0, 0, 1) },
      eye_direction: { value: new THREE.Vector3(0, 0, 1) },
      earth_light: { value: new THREE.Color(0, 0, 0) },
      sky: { value: new THREE.Color(background) },
      uFade: uniforms.uFade,
      uTitle: uniforms.uTitle,
      uTitleA: uniforms.uTitleA,
      uTitleB: uniforms.uTitleB,
      uTitleReach: uniforms.uTitleReach,
      uTitleMix: uniforms.uTitleMix,
      uTitleGrad: uniforms.uTitleGrad,
    },
    vertexShader: MOON_VERTEX,
    fragmentShader: MOON_FRAGMENT,
    transparent: true, // only for the one-pixel soft limb; it still writes depth
    toneMapped: false, // it applies its own curve
  })
  let moon: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null

  // The moon's two maps: mipmaps with trilinear filtering (three's default) and the most
  // anisotropic filtering the GPU offers, so the limb, seen at a grazing angle, stays as
  // sharp as the centre. Longitude wraps; the poles do not.
  const loader = new THREE.TextureLoader()
  const loadMap = async (url: string, srgb: boolean) => {
    const map = await loader.loadAsync(url)
    map.wrapS = THREE.RepeatWrapping
    map.anisotropy = renderer.capabilities.getMaxAnisotropy()
    if (srgb) map.colorSpace = THREE.SRGBColorSpace // the height map stays linear
    return map
  }
  const moonMaps = new Map<MapSize, Promise<MoonMaps>>()
  const loadMoonMaps = (size: MapSize) => {
    let maps = moonMaps.get(size)
    if (!maps) {
      const [albedo, relief] = [loadMap(MOON_MAPS[size].albedo, true), loadMap(MOON_MAPS[size].relief, false)]
      maps = Promise.all([albedo, relief]).then(([a, r]) => ({ albedo: a, relief: r }))
      // A failed download is tried again the next time the maps are asked for.
      maps.catch(() => moonMaps.delete(size))
      moonMaps.set(size, maps)
    }
    return maps
  }

  let timeline: ClothTimeline | null = null
  let idle: ClothIdle | null = null
  let stageHeight = 1
  let pixelRatio = 1
  let disposed = false

  /** Where the camera ends, in scene units. */
  const lastEye = (tl: ClothTimeline) => {
    const last = (tl.frameCount - 1) * 6
    return new THREE.Vector3(tl.camera[last], tl.camera[last + 1], tl.camera[last + 2]).multiplyScalar(stageHeight)
  }

  // The moon's sphere: the map's centre (the near side's middle) on +Z and its north on
  // +Y. lookAt turns +Z to the eye (the camera of the last frame, where the moon is
  // framed) with +Y up on screen; then, in that frame, the face is turned so the point
  // the libration names is the one in front, and rolled so the pole points where it
  // should. The sun's direction comes from the same pose: the phase angle away from the
  // eye, towards the lit edge. Phase, terminator and face cannot disagree.
  const placeMoon = (tl: ClothTimeline, sphere: THREE.Mesh) => {
    const rad = Math.PI / 180
    const pose = moonPoseToday(Date.now())
    const eye = lastEye(tl)
    const turn = new THREE.Quaternion()
    sphere.lookAt(eye)
    sphere.quaternion
      .multiply(turn.setFromAxisAngle(AXIS_Z, pose.spin * rad))
      .multiply(turn.setFromAxisAngle(AXIS_X, pose.libLat * rad))
      .multiply(turn.setFromAxisAngle(AXIS_Y, -pose.libLon * rad))
    eye.sub(sphere.position).normalize()
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(eye, -eye.y)
    if (up.lengthSq() < 0.000001) up.set(0, 0, -1)
    up.normalize()
    const right = new THREE.Vector3().crossVectors(up, eye)
    const limb = up.multiplyScalar(Math.cos(pose.limb * rad)).addScaledVector(right, -Math.sin(pose.limb * rad))
    const sunFrom = eye
      .clone()
      .multiplyScalar(Math.cos(pose.phase * rad))
      .addScaledVector(limb, Math.sin(pose.phase * rad))
    sun.position.copy(sunFrom)
    sunFromFront = sunFrom.z > 0
    const U = moonMaterial.uniforms
    U.sun_direction.value.copy(sunFrom)
    U.eye_direction.value.copy(eye)
    // The Earth seen from the Moon is as full as the Moon is new.
    U.earth_light.value.setRGB(...(MOON.earthshineTint as [number, number, number]))
    U.earth_light.value.multiplyScalar(MOON.earthshine * (1 - pose.fraction))
  }

  // The disc's diameter on screen once the moon is framed, in device pixels.
  const moonDiameterPx = (tl: ClothTimeline, sphere: THREE.Mesh) => {
    const d = lastEye(tl).distanceTo(sphere.position)
    const r = SPHERE_R * stageHeight
    return 2 * (r / Math.sqrt(d * d - r * r)) * CAM_D * stageHeight * pixelRatio
  }

  const setTimeline = async (tl: ClothTimeline, width: number, height: number) => {
    timeline = tl
    idle = null
    stageHeight = height
    // Phones get a lower cap.
    pixelRatio = Math.min(window.devicePixelRatio || 1, width < 768 ? 1.5 : 2)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.far = CAM_D * height * 12
    camera.updateProjectionMatrix()

    // The cloth's texture is the starfield's own canvas: one upload when the cloth goes
    // up, no copy. A new texture only when the stage is built again.
    texture?.dispose()
    texture = new THREE.CanvasTexture(source)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    restFilter = null
    restMaterial.map = clothMaterial.map = texture
    restMaterial.needsUpdate = clothMaterial.needsUpdate = true
    uniforms.uTitleReach.value = LOOK.title.reach * height

    // Frames are stored in stage heights; the scene is in CSS pixels.
    if (mesh) {
      scene.remove(mesh)
      mesh.geometry.dispose()
    }
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, MESH.segX, MESH.segY), restMaterial)
    mesh.frustumCulled = false
    scene.add(mesh)

    if (moon) {
      scene.remove(moon)
      moon.geometry.dispose()
    }
    // moon.tscn's SphereMesh: 96 x 48. three lays the map's centre (the near side) on +X;
    // turned onto +Z, the side lookAt points at the eye.
    const moonGeometry = new THREE.SphereGeometry(SPHERE_R * height, 96, 48)
    moonGeometry.rotateY(-Math.PI / 2)
    moon = new THREE.Mesh(moonGeometry, moonMaterial)
    moon.position.set(tl.planet.x * height, tl.planet.y * height, tl.planet.z * height)
    placeMoon(tl, moon)
    scene.add(moon)

    const size: MapSize = moonDiameterPx(tl, moon) * Math.PI > MOON.sharpAbove ? "2k" : "1k"
    const maps = await loadMoonMaps(size)
    if (disposed || timeline !== tl) return
    const U = moonMaterial.uniforms
    U.albedo_map.value = maps.albedo
    U.height_map.value = maps.relief
    // The relief is the height's change across one texel each way, times `relief`, on the
    // game's 1024-wide map. On a bigger map a texel spans less ground, so the same slope
    // reads as a smaller step: the gain is scaled to keep the craters as steep as the game's.
    U.texel.value.set(1 / MOON_MAPS[size].width, 1 / MOON_MAPS[size].height)
    U.relief.value = MOON.relief * (MOON_MAPS[size].width / 1024)
  }

  const resizeView = (width: number, height: number) => {
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  // The title's rectangle on screen, as a line across its middle, put in the scene at
  // TITLE.depth of the way from the eye to the page's rest plane: in front of the cloth.
  const ndcA = new THREE.Vector3()
  const ndcB = new THREE.Vector3()
  const forward = new THREE.Vector3()
  let titleKey = ""
  let titleShown = 1
  const titleRectKey = (r: DOMRect) =>
    `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`
  const placeTitleLight = () => {
    const el = title()
    if (!el) {
      titleShown = 0
      return
    }
    const r = el.getBoundingClientRect()
    const s = canvas.getBoundingClientRect()
    titleKey = titleRectKey(r)
    // As the title leaves through the top, its light goes with it.
    const inView = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top)
    titleShown = Math.min(Math.max(inView / Math.max(r.height, 1), 0), 1)
    const y = 1 - ((r.top + r.height / 2 - s.top) / s.height) * 2
    ndcA.set(((r.left - s.left) / s.width) * 2 - 1, y, 0.5)
    ndcB.set(((r.right - s.left) / s.width) * 2 - 1, y, 0.5)
    camera.updateMatrixWorld()
    camera.getWorldDirection(forward)
    const depth = TITLE.depth * CAM_D * stageHeight
    for (const [ndc, target] of [
      [ndcA, uniforms.uTitleA.value],
      [ndcB, uniforms.uTitleB.value],
    ]) {
      ndc.unproject(camera).sub(camera.position)
      target.copy(camera.position).addScaledVector(ndc, depth / ndc.dot(forward))
    }
  }

  const draw = (seconds: number, idleSeconds: number, idleWeight: number, titleScale: number) => {
    const tl = timeline
    if (!tl || !mesh) return
    const H = stageHeight
    const last = tl.frameCount - 1
    const f = Math.min(Math.max(seconds / FRAME_DT, 0), last)
    const atRest = f === 0
    setRestFilter(atRest)
    // The starfield's canvas has one pixel per CSS pixel. The rest pose is drawn the same,
    // so on a dense screen the browser scales both alike and the swap stays exact.
    const ratio = atRest ? 1 : pixelRatio
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio)

    const i0 = Math.min(Math.floor(f), last)
    const i1 = Math.min(i0 + 1, last)
    const t = f - i0
    const { frames, stride } = tl
    const position = mesh.geometry.attributes.position
    const arr = position.array as Float32Array
    const a = i0 * stride
    const b = i1 * stride
    for (let i = 0; i < stride; i++) arr[i] = (frames[a + i] + (frames[b + i] - frames[a + i]) * t) * H
    const sway = idle
    if (sway && idleWeight > 0) {
      // What is shown is the scroll's frame plus (idle pose - settled pose) × the weight.
      // The intro's first frame is the settled pose itself, so going in adds nothing.
      const g = idleSeconds / sway.dt
      const j = Math.floor(g)
      const s = g - j
      const at = (k: number): [Float32Array, number] =>
        k < sway.introCount ? [sway.intro, k * stride] : [sway.loop, ((k - sway.introCount) % sway.loopCount) * stride]
      const [fa, oa] = at(j)
      const [fb, ob] = at(j + 1)
      const settled = last * stride
      const k = idleWeight * H
      for (let i = 0; i < stride; i++) {
        arr[i] += (fa[oa + i] + (fb[ob + i] - fa[oa + i]) * s - frames[settled + i]) * k
      }
    }
    position.needsUpdate = true
    mesh.geometry.computeVertexNormals()

    const ca = i0 * 6
    const cb = i1 * 6
    const cam = (j: number) => (tl.camera[ca + j] + (tl.camera[cb + j] - tl.camera[ca + j]) * t) * H
    camera.position.set(cam(0), cam(1), cam(2))
    cameraTarget.set(cam(3), cam(4), cam(5))
    camera.lookAt(cameraTarget)

    const fade = atRest ? 0 : smoothstep(0, LOOK.fade, tl.scroll[Math.min(Math.round(f), last)])
    uniforms.uFade.value = fade
    ambient.intensity = Math.PI * (1 + (LOOK.baseFall - 1) * fade)
    // From the front the sun would reach the flat cloth, so it comes in with the fade.
    sun.intensity = LOOK.sun.intensity * LOOK.general * (sunFromFront ? fade : 1)
    mesh.material = atRest ? restMaterial : clothMaterial
    placeTitleLight()
    uniforms.uTitle.value = LOOK.title.intensity * LOOK.general * titleScale * titleShown

    renderer.render(scene, camera)
  }

  const titleMoved = () => {
    const el = title()
    return el !== null && titleRectKey(el.getBoundingClientRect()) !== titleKey
  }

  const handleContextLost = (e: Event) => {
    // Lets the browser restore the context; three then builds its resources again.
    e.preventDefault()
    onContextChange(true)
  }
  const handleContextRestored = () => {
    // three starts its restored context from a black clear colour.
    renderer.setClearColor(background, 1)
    onContextChange(false)
  }
  canvas.addEventListener("webglcontextlost", handleContextLost)
  canvas.addEventListener("webglcontextrestored", handleContextRestored)

  return {
    canvas,
    setTimeline,
    setIdle: (next) => {
      idle = next
    },
    resizeView,
    refreshTexture: () => {
      if (texture) texture.needsUpdate = true
    },
    setVisible: (visible) => {
      canvas.style.visibility = visible ? "visible" : "hidden"
    },
    draw,
    titleMoved,
    dispose: () => {
      disposed = true
      canvas.removeEventListener("webglcontextlost", handleContextLost)
      canvas.removeEventListener("webglcontextrestored", handleContextRestored)
      mesh?.geometry.dispose()
      moon?.geometry.dispose()
      texture?.dispose()
      restMaterial.dispose()
      clothMaterial.dispose()
      moonMaterial.dispose()
      for (const maps of moonMaps.values()) {
        maps.then(
          (m) => {
            m.albedo.dispose()
            m.relief.dispose()
          },
          () => {},
        )
      }
      renderer.dispose()
      // Frees the context now instead of at some later garbage collection: browsers only
      // allow a handful at once, and every visit to the page makes one.
      renderer.forceContextLoss()
    },
  }
}
