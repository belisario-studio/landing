// GLSL of the cloth scene: the moon's material, and what is added to three's own
// material for the cloth.
import { AGX, mat3Inverse } from "./tone-map"
import { MOON } from "./cloth-config"

const float = (v: number) => {
  const s = v.toPrecision(12)
  return s.includes(".") || s.includes("e") ? s : s + ".0"
}
const mat3 = (name: string, m: number[]) => `const mat3 ${name} = mat3(${m.map(float).join(", ")});`
const vec3 = (v: number[]) => `vec3(${v.map(float).join(", ")})`

// The title as a line of light carrying its gradient, from uTitleA (left end) to uTitleB
// (right end). Shared by the cloth and the moon.
const TITLE_LIGHT = /* glsl */ `
  uniform float uFade;
  uniform float uTitle;
  uniform vec3 uTitleA;
  uniform vec3 uTitleB;
  uniform float uTitleReach;
  uniform float uTitleMix;
  uniform vec3 uTitleGrad[7];
  vec3 titleGradient(float s) {
    float x = s * 6.0;
    vec3 c = uTitleGrad[0];
    for (int i = 1; i < 7; i++) c = mix(c, uTitleGrad[i], clamp(x - float(i - 1), 0.0, 1.0));
    return mix(vec3(1.0), c, uTitleMix);
  }
`

// ---------- The cloth: patches for MeshStandardMaterial's fragment shader ----------

// AgX backwards. The starfield's canvas is drawn already tone-mapped (see
// galaxy-background.tsx), and it is the cloth's texture: before the cloth is lit, its
// texture colour is taken back to what the curve would have been given, so that lighting
// and then mapping it gives the canvas' own colour again where nothing but the base light
// reaches, and the mapped look everywhere else. three puts the curve's own functions
// (agxDefaultContrastApprox, toneMappingExposure) ahead of a tone-mapped material's shader.
export const CLOTH_PARS = /* glsl */ `
  ${mat3("AGX_INSET_INV", mat3Inverse(AGX.inset))}
  ${mat3("AGX_OUTSET_INV", mat3Inverse(AGX.outset))}
  ${mat3("REC2020_TO_SRGB_INV", mat3Inverse(AGX.toSrgb))}
  ${mat3("SRGB_TO_REC2020_INV", mat3Inverse(AGX.to2020))}
  vec3 clothUntone(vec3 d) {
    // The contrast curve is a sixth-degree polynomial that only rises on [0, 1]; it is
    // undone by halving the interval 18 times, the three channels at once.
    vec3 y = AGX_OUTSET_INV * pow(max(REC2020_TO_SRGB_INV * d, 0.0), vec3(1.0 / 2.2)), lo = vec3(0.0), hi = vec3(1.0);
    for (int i = 0; i < 18; i++) {
      vec3 mid = 0.5 * (lo + hi), up = step(agxDefaultContrastApprox(mid), y);
      lo = mix(lo, mid, up);
      hi = mix(mid, hi, up);
    }
    vec3 c = AGX_INSET_INV * exp2(0.5 * (lo + hi) * ${float(AGX.maxEv - AGX.minEv)} - ${float(-AGX.minEv)}) / max(toneMappingExposure, 0.0001);
    return max(SRGB_TO_REC2020_INV * c, 0.0);
  }
  uniform vec3 uFibre;
  uniform float uRim;
  uniform float uRimPower;
  uniform vec3 uRimColor;
  uniform float uTitleShine;
  uniform float uTitleSpec;
  ${TITLE_LIGHT}
`

export const CLOTH_UNTONE = /* glsl */ `
  diffuseColor.rgb = clothUntone(diffuseColor.rgb);
`

// Added to the emissive light, all scaled by uFade (0 at rest, 1 once the scroll is under way):
//  - rim: a sheen that grows as the surface turns edge-on to the eye;
//  - title: the title's light, with a soft streak on the glossy cloth.
// The cloth's own colour is almost black, so the diffuse part acts on a faint "fibre"
// colour (uFibre) plus the texture, not on the texture alone.
export const CLOTH_LIGHTS = /* glsl */ `
  if (uFade > 0.0) {
    vec3 cN = normalize(normal); // already turned toward the eye on the back side
    vec3 cV = normalize(vViewPosition);
    vec3 cBase = diffuseColor.rgb + uFibre;
    vec3 extra = uRimColor * (uRim * pow(1.0 - abs(dot(cN, cV)), uRimPower));
    if (uTitle > 0.0) {
      // The nearest point of the line to this bit of cloth lights it, in that point's colour.
      vec3 tA = (viewMatrix * vec4(uTitleA, 1.0)).xyz, tAB = (viewMatrix * vec4(uTitleB, 1.0)).xyz - tA, tP = -vViewPosition;
      float tS = clamp(dot(tP - tA, tAB) / dot(tAB, tAB), 0.0, 1.0);
      vec3 tL = tA + tAB * tS - tP;
      float tDist = length(tL);
      tL /= tDist;
      float tRel = tDist / uTitleReach;
      float tFall = 1.0 / (1.0 + tRel * tRel);
      extra += titleGradient(tS) * cBase * (uTitle * tFall * max(dot(cN, tL), 0.0));
      // The streak: where the mirrored line of sight passes nearest the line.
      vec3 tR = reflect(-cV, cN);
      float tSr = clamp(dot(tP + tR * tDist - tA, tAB) / dot(tAB, tAB), 0.0, 1.0);
      vec3 tLr = normalize(tA + tAB * tSr - tP);
      extra += titleGradient(tSr) * (uTitle * tFall * uTitleSpec * pow(max(dot(tLr, tR), 0.0), uTitleShine) * step(0.0, dot(cN, tLr)));
    }
    totalEmissiveRadiance += extra * uFade;
  }
`

// ---------- The moon of Chicken Rescue ----------
// game/assets/environment/moon/moon.gdshader's fragment() and light() in one pass, with
// moon.tscn's overrides (rim_base 0, rim_on_dark 0) folded in. Godot's V runs down the
// image and three's runs up, so every V offset has its sign turned.

export const MOON_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vAxis;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    // The sphere's axis (its poles are on Y), the same for every vertex. The tangent is
    // worked out per pixel from it: per vertex, as normalize(cross(axis, normal)), it is
    // normalize(0) at the two poles, which a GPU may answer with NaN, and the NaN then
    // spreads over every triangle that touches the pole: a black cap.
    vAxis = normalMatrix * vec3(0.0, 1.0, 0.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

export const MOON_FRAGMENT = /* glsl */ `
  uniform sampler2D albedo_map;
  uniform sampler2D height_map;
  uniform vec2 texel;
  uniform float relief;
  uniform vec3 sun_direction;
  uniform vec3 eye_direction;
  uniform vec3 earth_light;
  uniform vec3 sky;
  uniform float moon_alpha; // 1 always, except while the reveal's egg takes the moon's place
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vAxis;
  varying vec3 vView;
  ${TITLE_LIGHT}

  const float bump_ratio = ${float(MOON.bumpRatio)};
  const float bump_ratio_fine = ${float(MOON.bumpRatioFine)};
  const vec3 rim_gain = ${vec3(MOON.rimGain)};
  const float rim_exponent = ${float(MOON.rimExponent)};
  const float moon_exposure = ${float(MOON.exposure)};

  vec2 bump_offset(vec2 uv, vec2 view_tangent, float height, float ratio) {
    return uv + vec2(view_tangent.x, -view_tangent.y) * (height - 0.5) * ratio;
  }

  vec3 relief_normal(vec2 uv) {
    float left = texture2D(height_map, uv - vec2(texel.x, 0.0)).r;
    float right = texture2D(height_map, uv + vec2(texel.x, 0.0)).r;
    float up = texture2D(height_map, uv + vec2(0.0, texel.y)).r;
    float down = texture2D(height_map, uv - vec2(0.0, texel.y)).r;
    return normalize(vec3((left - right) * relief, (down - up) * relief, 1.0));
  }

  void main() {
    vec3 NORMAL = normalize(vNormal);
    // Along increasing U (Godot's TANGENT): across the axis and the normal. pole is the
    // square of the sine of the angle to the nearest pole; right at a pole there is no
    // such direction, and any one across the normal will do.
    vec3 across = cross(normalize(vAxis), NORMAL);
    float pole = dot(across, across);
    vec3 spare = cross(NORMAL, abs(NORMAL.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0));
    vec3 TANGENT = pole > 1e-7 ? across * inversesqrt(pole) : normalize(spare);
    vec3 BINORMAL = cross(NORMAL, TANGENT);
    vec3 VIEW = normalize(vView);

    // fragment()
    vec2 view_tangent = vec2(dot(VIEW, TANGENT), dot(VIEW, BINORMAL));
    float height = texture2D(height_map, vUv).r;
    vec3 colour = texture2D(albedo_map, bump_offset(vUv, view_tangent, height * height, bump_ratio)).rgb;
    vec3 colour_fine = texture2D(albedo_map, bump_offset(vUv, view_tangent, height, bump_ratio_fine)).rgb;
    vec3 n = relief_normal(vUv);
    // Within 2 degrees of a pole the map's columns all meet and "east" turns all the way
    // round in a few pixels: the relief is faded out there instead of being pointed anywhere.
    n = normalize(vec3(n.xy * smoothstep(0.0, 0.0012, pole), n.z));
    vec3 mapped = normalize(TANGENT * n.x + BINORMAL * n.y + NORMAL * n.z);
    float facing = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
    vec3 rim_glow = (colour + colour_fine) * colour_fine * pow(1.0 - facing, rim_exponent) * rim_gain;
    vec3 sun_view = normalize((viewMatrix * vec4(sun_direction, 0.0)).xyz);

    // light(): Lambert from the phase's direction, and the rim where that light reaches.
    float lit = clamp(dot(mapped, sun_view), 0.0, 1.0);
    // Not in the game, whose moon never has the sun behind it: the relief's slopes can face
    // a sun that is below their own horizon. Up to about 7 degrees past the terminator that
    // is right (rims catch the low sun); further on, the round moon itself is in the way.
    // On the lit half this is exactly 1.
    lit *= smoothstep(-0.12, 0.0, dot(NORMAL, sun_view));
    vec3 color = colour * lit;
    color += rim_glow * smoothstep(0.0, 0.3, lit);
    // Not in the game: earthshine ("luz cenicienta"), the Earth's own light on the whole
    // near side. It comes from where the observer is.
    color += colour * earth_light * clamp(dot(mapped, normalize((viewMatrix * vec4(eye_direction, 0.0)).xyz)), 0.0, 1.0);
    // The moon takes the title's light too (diffuse only).
    if (uTitle > 0.0 && uFade > 0.0) {
      vec3 tA = (viewMatrix * vec4(uTitleA, 1.0)).xyz, tAB = (viewMatrix * vec4(uTitleB, 1.0)).xyz - tA, tP = -vView;
      float tS = clamp(dot(tP - tA, tAB) / dot(tAB, tAB), 0.0, 1.0);
      vec3 tL = tA + tAB * tS - tP;
      float tDist = length(tL), tRel = tDist / uTitleReach;
      color += colour * titleGradient(tS) * (uTitle * uFade * max(dot(mapped, tL / tDist), 0.0) / (1.0 + tRel * tRel));
    }

    // blend_add in the game: the moon is added onto the sky behind it. Here it is drawn
    // opaque, so the cloth and it hide each other, with the page's background added in
    // (after the moon's own tone curve, linear with its own exposure, so its dark side
    // stays the colour of the page).
    // The renderer has no antialiasing, which leaves the limb in steps. Instead of
    // multisampling the whole scene, the last pixel of the disc fades out: how fast the
    // surface turns away from the eye, per pixel, gives the width of that pixel.
    float limb = clamp(facing / max(fwidth(facing), 1e-5), 0.0, 1.0);
    gl_FragColor = vec4(clamp(color * moon_exposure, 0.0, 1.0) + sky, limb * moon_alpha);
    #include <colorspace_fragment>
  }
`
