// three's AgX tone curve in JS (tonemapping_pars_fragment, colorspace_pars_fragment):
// same arithmetic, same constants, same order. With the cloth on, the 2D starfield is
// painted with colours that already went through it, so the WebGL cloth, which is
// textured with that canvas and mapped by the same curve, can take its place unnoticed.
// Matrices are written as three writes them (column by column).

type Vec3 = [number, number, number]
type Mat3 = [number, number, number, number, number, number, number, number, number]

export const AGX = {
  toSrgb: [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187] as Mat3,
  to2020: [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956] as Mat3,
  inset: [
    0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591,
    0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859,
  ] as Mat3,
  outset: [
    1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272,
    -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
  ] as Mat3,
  minEv: -12.47393,
  maxEv: 4.026069,
}

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
]
const map = (v: Vec3, f: (x: number) => number): Vec3 => [f(v[0]), f(v[1]), f(v[2])]
const sat = (x: number) => Math.min(Math.max(x, 0), 1)

export const mat3Inverse = (m: Mat3): Mat3 => {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    A / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ]
}

const contrast = (x: number) => {
  const x2 = x * x
  const x4 = x2 * x2
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232
}
// three's sRGBTransferEOTF and the shader's sRGBTransferOETF
const srgbToLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4))
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : Math.pow(c, 0.41666) * 1.055 - 0.055)

/** An sRGB colour as [r, g, b] in 0..255 -> the same, as AgX at `exposure` leaves it on screen. */
export const agxRgb = (exposure: number, rgb: Vec3): Vec3 => {
  const linear = map(rgb, (v) => srgbToLinear(v / 255))
  let v = mul(AGX.inset, map(mul(AGX.to2020, linear), (x) => x * exposure))
  v = map(v, (x) => contrast(sat((Math.log2(Math.max(x, 1e-10)) - AGX.minEv) / (AGX.maxEv - AGX.minEv))))
  v = mul(AGX.toSrgb, map(mul(AGX.outset, v), (x) => Math.pow(Math.max(0, x), 2.2)))
  return map(v, (x) => Math.round(sat(linearToSrgb(sat(x))) * 255))
}

export const hexToRgb = (hex: string): Vec3 => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
export const rgbToHex = (rgb: ArrayLike<number>) =>
  "#" + [rgb[0], rgb[1], rgb[2]].map((v) => v.toString(16).padStart(2, "0")).join("")
