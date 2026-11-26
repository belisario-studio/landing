import { OBSERVER } from "./cloth-config"

// ---------- The Moon as seen from a place on Earth, at an instant ----------
// Low-precision series from Jean Meeus, "Astronomical Algorithms": the Sun (ch. 25), the
// Moon's main periodic terms (ch. 47), sidereal time (ch. 12), parallax to the observer
// (ch. 11/40), illuminated fraction and bright limb (ch. 48), optical librations and the
// position angle of the axis (ch. 53, physical librations left out), parallactic angle
// (ch. 14). Good to a few hundredths of a degree in position, a few tenths in libration.
// Angles in degrees. lat north-positive, lon east-positive.
interface MoonSight {
  /** Lit share of the disc, 0..1. */
  fraction: number
  /** Sun-Moon-observer angle: 0 full, 180 new. */
  phaseAngle: number
  /** Where the middle of the lit edge points, from celestial north, eastward. */
  limb: number
  /** Position angle of the Moon's axis. */
  axis: number
  libLon: number
  libLat: number
  /** From the zenith's direction to celestial north. */
  parallactic: number
  hourAngle: number
}

function moonSeenFrom(lat: number, lon: number, unixMs: number): MoonSight {
  const rad = Math.PI / 180, sin = (d: number) => Math.sin(d * rad), cos = (d: number) => Math.cos(d * rad), norm = (d: number) => ((d % 360) + 360) % 360
  // + delta T, about 69 s these years
  const jd = unixMs / 86400000 + 2440587.5 + 69.2 / 86400, T = (jd - 2451545) / 36525
  const eps = 23.439291 - 0.0130042 * T
  // Sun
  const Ms = norm(357.52911 + 35999.05029 * T), L0 = norm(280.46646 + 36000.76983 * T)
  const C = (1.914602 - 0.004817 * T) * sin(Ms) + 0.019993 * sin(2 * Ms) + 0.000289 * sin(3 * Ms)
  const sunLon = L0 + C, e = 0.016708634 - 0.000042037 * T
  const sunR = (1.000001018 * (1 - e * e)) / (1 + e * cos(Ms + C)) * 149597870.7 // km
  // Moon
  const Lp = 218.3164477 + 481267.88123421 * T, D = 297.8501921 + 445267.1114034 * T, M = 357.5291092 + 35999.0502909 * T
  const Mp = 134.9633964 + 477198.8675055 * T, F = 93.272095 + 483202.0175233 * T, Om = 125.0445479 - 1934.1362891 * T
  const lon_ = Lp + 6.288774 * sin(Mp) + 1.274027 * sin(2 * D - Mp) + 0.658314 * sin(2 * D) + 0.213618 * sin(2 * Mp) - 0.185116 * sin(M) - 0.114332 * sin(2 * F)
    + 0.058793 * sin(2 * D - 2 * Mp) + 0.057066 * sin(2 * D - M - Mp) + 0.053322 * sin(2 * D + Mp) + 0.045758 * sin(2 * D - M) - 0.040923 * sin(M - Mp)
    - 0.03472 * sin(D) - 0.030383 * sin(M + Mp) + 0.015327 * sin(2 * D - 2 * F) - 0.012528 * sin(Mp + 2 * F) + 0.01098 * sin(Mp - 2 * F)
    + 0.010675 * sin(4 * D - Mp) + 0.010034 * sin(3 * Mp) + 0.008548 * sin(4 * D - 2 * Mp)
  const lat_ = 5.128122 * sin(F) + 0.280602 * sin(Mp + F) + 0.277693 * sin(Mp - F) + 0.173237 * sin(2 * D - F) + 0.055413 * sin(2 * D - Mp + F)
    + 0.046271 * sin(2 * D - Mp - F) + 0.032573 * sin(2 * D + F) + 0.017198 * sin(2 * Mp + F) + 0.009266 * sin(2 * D + Mp - F) + 0.008822 * sin(2 * Mp - F)
  const dist = 385000.56 - 20905.355 * cos(Mp) - 3699.111 * cos(2 * D - Mp) - 2955.968 * cos(2 * D) - 569.925 * cos(2 * Mp) + 48.888 * cos(M) - 3.149 * cos(2 * F)
    + 246.158 * cos(2 * D - 2 * Mp) - 152.138 * cos(2 * D - M - Mp) - 170.733 * cos(2 * D + Mp) - 204.586 * cos(2 * D - M) - 129.62 * cos(M - Mp) + 108.743 * cos(D)
  const toEq = (l: number, b: number) => [Math.atan2(sin(l) * cos(eps) - Math.tan(b * rad) * sin(eps), cos(l)) / rad, Math.asin(sin(b) * cos(eps) + cos(b) * sin(eps) * sin(l)) / rad]
  const [sunRa, sunDec] = toEq(sunLon, 0)
  let [ra, dec] = toEq(lon_, lat_), d = dist
  const gmst = norm(280.46061837 + 360.98564736629 * (jd - 69.2 / 86400 - 2451545) + 0.000387933 * T * T)
  const lst = gmst + lon
  {
    // To the observer: subtract the observer's place from the Moon's, both from the Earth's centre.
    const u = Math.atan(0.99664719 * Math.tan(lat * rad)), rc = Math.cos(u) * 6378.14, rs = 0.99664719 * Math.sin(u) * 6378.14
    const x = d * cos(dec) * cos(ra) - rc * cos(lst), y = d * cos(dec) * sin(ra) - rc * sin(lst), z = d * sin(dec) - rs
    d = Math.hypot(x, y, z)
    ra = Math.atan2(y, x) / rad
    dec = Math.asin(z / d) / rad
  }
  // Phase: elongation, phase angle, illuminated fraction, bright limb (from celestial north, eastward)
  const cosPsi = sin(sunDec) * sin(dec) + cos(sunDec) * cos(dec) * cos(sunRa - ra), psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)))
  const phaseAngle = Math.atan2(sunR * Math.sin(psi), d - sunR * cosPsi) / rad
  const limb = norm(Math.atan2(cos(sunDec) * sin(sunRa - ra), sin(sunDec) * cos(dec) - cos(sunDec) * sin(dec) * cos(sunRa - ra)) / rad)
  // Libration and axis, from the ecliptic place the observer sees
  const b_ = Math.asin(sin(dec) * cos(eps) - cos(dec) * sin(eps) * sin(ra)) / rad, l_ = Math.atan2(sin(ra) * cos(eps) + Math.tan(dec * rad) * sin(eps), cos(ra)) / rad
  const I = 1.54242, W = l_ - Om
  const A = Math.atan2(sin(W) * cos(b_) * cos(I) - sin(b_) * sin(I), cos(W) * cos(b_)) / rad
  let libLon = norm(A - F)
  if (libLon > 180) libLon -= 360
  const libLat = Math.asin(-sin(W) * cos(b_) * sin(I) - sin(b_) * cos(I)) / rad
  const X = sin(I) * sin(Om), Y = sin(I) * cos(Om) * cos(eps) - cos(I) * sin(eps), w = Math.atan2(X, Y) / rad
  const axis = Math.asin(Math.max(-1, Math.min(1, (Math.hypot(X, Y) * cos(ra - w)) / cos(libLat)))) / rad
  // The observer's sky: hour angle, and the angle from the zenith's direction to celestial north
  const H = lst - ra
  const parallactic = Math.atan2(sin(H), Math.tan(lat * rad) * cos(dec) - sin(dec) * cos(H)) / rad
  const hourAngle = norm(H + 180) - 180
  return { fraction: (1 + cos(phaseAngle)) / 2, phaseAngle, limb, axis, libLon, libLat, parallactic, hourAngle }
}

// The Moon's upper transit (hour angle 0: its highest point of the day) nearest to an
// instant. The hour angle grows about 347.8 degrees a day (the sky's turn less the Moon's
// own motion), so a few Newton steps from the instant land on the transit; the hour
// angle taken in (-180, 180] makes it the nearest one.
function moonTransitNear(lat: number, lon: number, unixMs: number): number {
  let t = unixMs
  for (let i = 0; i < 6; i++) t -= (moonSeenFrom(lat, lon, t).hourAngle / 347.8) * 86400000
  return t
}
// The transit of a civil day: the one nearest to that day's local noon. Transits come
// every 24 h 50 min, so this is the day's own transit when it has one and, on the day
// a month that has none, the nearest (just before midnight of the day before, or just
// after the next midnight). utcOffsetHours: -3 for Buenos Aires, which has no summer time.
function moonTransitOfDay(lat: number, lon: number, isoDate: string, utcOffsetHours: number): number {
  const [y, m, d] = isoDate.split("-").map(Number)
  return moonTransitNear(lat, lon, Date.UTC(y, m - 1, d, 12) - utcOffsetHours * 3600000)
}

export interface MoonPose {
  /** Sun-Moon-observer angle (0 full, 180 new). */
  phase: number
  /** Where the middle of the lit edge points. */
  limb: number
  /** Where the Moon's north pole points. */
  spin: number
  /** The point of the Moon's surface that faces the observer. */
  libLon: number
  libLat: number
  fraction: number
}

// What is needed to draw the Moon as the observer of cloth-config sees it at its upper
// transit of today's local date, all angles in degrees. On the disc, angles are measured
// from "up" (the zenith's side) turning left (counter-clockwise). The ephemeris gives the
// lit edge and the pole from celestial north; the parallactic angle is where the zenith
// is from celestial north. At the transit it is 180 from Buenos Aires (the Moon passes
// north of the zenith: celestial north is down, and the Moon is upside down next to a
// northern-hemisphere picture).
export function moonPoseToday(nowMs: number): MoonPose {
  const { lat, lon, utcOffsetHours } = OBSERVER
  const today = new Date(nowMs + utcOffsetHours * 3600000).toISOString().slice(0, 10)
  const m = moonSeenFrom(lat, lon, moonTransitOfDay(lat, lon, today, utcOffsetHours))
  const turn = (d: number) => ((d % 360) + 360) % 360
  return {
    phase: m.phaseAngle,
    limb: turn(m.limb - m.parallactic),
    spin: turn(m.axis - m.parallactic),
    libLon: m.libLon,
    libLat: m.libLat,
    fraction: m.fraction,
  }
}
