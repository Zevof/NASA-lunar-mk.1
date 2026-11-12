/**
 * Scale and units engine for the solar-system view.
 *
 * Overview orbit compression (positive km):
 *   20 + 30 * log10(1 + km / 100,000,000)
 * Overview body-radius compression (positive radiusKm):
 *   max(0.3, 0.3 + 1.2 * cbrt(radiusKm / 6,371))
 * True scale for both distances and radii:
 *   km / 1,000
 *
 * The legacy Moon-fixed planner uses its own KM_TO_VIEW conversion; its
 * string-based bodyRadius overload and scenePositions remain unchanged.
 */
export const AU_KM = 149_597_870.7;
export const R_EARTH_KM = 6371;
export const SCENE_UNITS_PER_KM_TRUE = 1 / 1000;

export const MOON_RADIUS_KM = 1737.4;
export const EARTH_RADIUS_KM = 6371.0;
export const SUN_RADIUS_KM = 695700.0;
export const KM_TO_VIEW = 2.5 / MOON_RADIUS_KM;
export const BODY_RADII = Object.freeze({
  moon: MOON_RADIUS_KM,
  earth: EARTH_RADIUS_KM,
  sun: SUN_RADIUS_KM,
});
export const DIAGRAM_RADII = Object.freeze({
  moon: 2.5,
  earth: 2.05,
  sun: 2.65,
});
export const DIAGRAM_DISTANCES = Object.freeze({
  earth: 8.5,
  sun: 14.8,
});

const OVERVIEW_DISTANCE_OFFSET = 20;
const OVERVIEW_DISTANCE_FACTOR = 30;
const OVERVIEW_DISTANCE_DIVISOR_KM = 100_000_000;
const OVERVIEW_MIN_BODY_RADIUS = 0.3;
const OVERVIEW_RADIUS_FACTOR = 1.2;
const AU_DISPLAY_THRESHOLD = 0.1;

// True scale is now the default; 'overview' is opt-in for the compressed
// diagram view. This matches the real-world request "everything has to be
// scale accurate" — the UI defaults to the physical mode.
let currentMode = 'true';

/**
 * Convert a physical distance in km to the true-scale scene representation.
 * At true scale, exactly 1 scene unit equals 1,000 km.
 * @param {number} km
 * @returns {number}
 */
export function toTrueUnits(km) {
  return km * SCENE_UNITS_PER_KM_TRUE;
}

/**
 * Convert a physical distance in km to scene units for the selected mode.
 * In overview mode, nonzero absolute distances use
 *   20 + 30 * log10(1 + abs(km) / 100,000,000).
 * Zero stays at the origin and negative coordinates retain their sign.
 * In true mode the conversion is exactly km / 1,000.
 * @param {number} km
 * @returns {number}
 */
export function toSceneUnits(km) {
  if (currentMode === 'true') {
    return toTrueUnits(km);
  }
  if (km === 0) {
    return 0;
  }
  const distance = OVERVIEW_DISTANCE_OFFSET
    + OVERVIEW_DISTANCE_FACTOR * Math.log10(1 + Math.abs(km) / OVERVIEW_DISTANCE_DIVISOR_KM);
  return Math.sign(km) * distance;
}

/**
 * Select the solar-system scale mode.
 * @param {'overview'|'true'} nextMode
 * @returns {'overview'|'true'} The active mode
 * @throws {RangeError} On unsupported modes
 */
export function setMode(nextMode) {
  if (nextMode !== 'overview' && nextMode !== 'true') {
    throw new RangeError(`Unsupported scale mode: ${nextMode}`);
  }
  currentMode = nextMode;
  return currentMode;
}

/**
 * Return the active solar-system scale mode.
 * @returns {'overview'|'true'}
 */
export function getMode() {
  return currentMode;
}

/**
 * Return a body's radius in scene units.
 *
 * PlanetSpec input ({radiusKm}) follows the selected mode. In overview mode
 * the compressed radius is max(0.3, 0.3 + 1.2 * cbrt(radiusKm / 6371))
 * for positive radii, with zero clamped to 0.3 for visibility. In true mode
 * the radius is exactly radiusKm / 1,000.
 *
 * Legacy input (bodyName, legacyMode) preserves the original Moon-fixed
 * planner's scaling, including KM_TO_VIEW and diagram radii.
 *
 * @param {{radiusKm: number}|'moon'|'earth'|'sun'} spec
 * @param {'true'|'diagram'} [legacyMode]
 * @returns {number}
 */
export function bodyRadius(spec, legacyMode) {
  if (typeof spec === 'string') {
    return legacyMode === 'true'
      ? BODY_RADII[spec] * KM_TO_VIEW
      : DIAGRAM_RADII[spec];
  }
  const radiusKm = spec.radiusKm;
  if (currentMode === 'true') {
    return toTrueUnits(radiusKm);
  }
  return Math.max(
    OVERVIEW_MIN_BODY_RADIUS,
    OVERVIEW_MIN_BODY_RADIUS + OVERVIEW_RADIUS_FACTOR * Math.cbrt(Math.max(0, radiusKm) / R_EARTH_KM),
  );
}

/**
 * Return the scaled orbital semi-major axis of a PlanetSpec.
 * Objects at the origin remain at the origin in overview mode.
 * @param {{semiMajorAxisKm: number}} spec
 * @returns {number}
 */
export function orbitRadius(spec) {
  return toSceneUnits(spec.semiMajorAxisKm);
}

/**
 * Format a physical distance independently of browser locale and scale mode.
 * Below 0.1 AU use grouped integer km; from 0.1 AU use 3 decimal places.
 * @param {number} km
 * @returns {string}
 */
export function formatDistance(km) {
  if (Math.abs(km) >= AU_DISPLAY_THRESHOLD * AU_KM) {
    return `${(km / AU_KM).toFixed(3)} AU`;
  }
  return `${formatGroupedInteger(km)} km`;
}

/**
 * Format a physical radius in km and Earth-radius units.
 * @param {number} km
 * @returns {string}
 */
export function formatRadius(km) {
  return `${formatGroupedInteger(km)} km (${(km / R_EARTH_KM).toFixed(2)} R⊕)`;
}

/**
 * Group an integer with ASCII comma separators in all JavaScript locales.
 * @param {number} value
 * @returns {string}
 */
function formatGroupedInteger(value) {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** @param {number[]} v */
export function magnitude(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

/** @param {number[]} v */
export function unit(v) {
  const length = magnitude(v);
  return length > 0 ? v.map((value) => value / length) : [1, 0, 0];
}

/** @param {number[]} a @param {number[]} b */
export function difference(a, b) {
  return a.map((value, index) => value - b[index]);
}

/**
 * Legacy Moon-fixed rendering positions (Earth/Sun seen from a Moon-centred
 * frame); deliberately retains KM_TO_VIEW so the existing Moon-surface tools
 * keep working.
 *
 * IMPORTANT: The Moon is NOT a child of Earth in the solar-system scene. Use
 * `getBodyPosition('moon', phase)` for a true heliocentric position — that API
 * returns the Moon ~384.4 scene units from Earth at true scale, physically
 * correct rather than glued to Earth.
 *
 * @param {object} frame
 * @param {'true'|'diagram'} mode
 */
export function scenePositions(frame, mode) {
  const earthDirection = unit(frame.earth_moon_fixed);
  const sunDirection = unit(frame.sun_moon_fixed);
  const moonEarthKm = magnitude(frame.moon_eci_km);
  const moonSunKm = magnitude(difference(frame.sun_eci_km, frame.moon_eci_km));
  const earth = mode === 'true' ? moonEarthKm * KM_TO_VIEW : DIAGRAM_DISTANCES.earth;
  const sun = mode === 'true' ? moonSunKm * KM_TO_VIEW : DIAGRAM_DISTANCES.sun;
  return {
    earth: earthDirection.map((value) => value * earth),
    sun: sunDirection.map((value) => value * sun),
    earthKm: moonEarthKm,
    sunKm: moonSunKm,
  };
}

// ---------------------------------------------------------------------------
// True-scale body positioning (Solar System view)
// ---------------------------------------------------------------------------

/** Moon mean orbital radius around Earth (NASA fact sheet). */
export const MOON_ORBIT_RADIUS_KM = 384400;

/** All eight planets + Sun + Moon semi-major axes in km (NASA/JPL). */
export const BODY_SEMI_MAJOR_AXIS_KM = Object.freeze({
  sun: 0,
  mercury: 57_909_050,
  venus: 108_208_000,
  earth: 149_597_870.7,
  moon: MOON_ORBIT_RADIUS_KM, // relative to Earth, not the Sun
  mars: 227_936_640,
  jupiter: 778_412_020,
  saturn: 1_433_449_370,
  uranus: 2_872_463_140,
  neptune: 4_495_060_000,
});

/**
 * True-scale heliocentric (or Earth-centred for the Moon) position of a body in
 * scene units, given an optional orbital phase angle in radians.
 *
 * At true scale 1 scene unit = 1,000 km, so the Moon's centre ends up ~384.4
 * units from Earth and Earth is ~149,598 units from the Sun — physically
 * accurate, never clamped. The Moon is explicitly NOT a child of Earth in the
 * scene graph; callers position it using this function.
 *
 * @param {string} bodyId
 * @param {number} [phaseRad=0] orbital phase (0 = +X axis)
 * @returns {{x:number,y:number,z:number,parentId:string|null,radiusUnits:number}}
 */
export function getBodyPosition(bodyId, phaseRad = 0) {
  const id = String(bodyId || '').toLowerCase();
  const axisKm = BODY_SEMI_MAJOR_AXIS_KM[id];
  if (!Number.isFinite(axisKm)) {
    return { x: 0, y: 0, z: 0, parentId: null, radiusUnits: 0 };
  }
  const parentId = id === 'moon' ? 'earth' : (id === 'sun' ? null : 'sun');
  const radiusUnits = toTrueUnits(axisKm);
  // Slightly inclined orbit for visual separation (real inclination ~1-7°).
  const inclination = id === 'moon' ? 5.14 * Math.PI / 180 : 0;
  const x = Math.cos(phaseRad) * radiusUnits;
  const z = Math.sin(phaseRad) * radiusUnits * Math.cos(inclination);
  const y = Math.sin(phaseRad) * radiusUnits * Math.sin(inclination);
  return { x, y, z, parentId, radiusUnits };
}

/** @param {number} value */
export function heightFromEarthImageByte(value) {
  // NASA Visible Earth CMG Lee encoding, sea level 141/255.
  return (value - 141) * (10.994 + 8.848) / 255;
}

/** @param {string} value */
export function normalizeCity(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** @param {string} a @param {string} b */
export function editDistance(a, b) {
  a = normalizeCity(a);
  b = normalizeCity(b);
  const n = a.length;
  const m = b.length;
  const rows = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) rows[i][0] = i;
  for (let j = 0; j <= m; j++) rows[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[n][m];
}

/** @param {string} query @param {{name: string}[]} cities */
export function fuzzyCityPresets(query, cities) {
  const normalized = normalizeCity(query).split(' ')[0];
  if (normalized.length < 3) return [];
  const maximum = normalized.length <= 5 ? 1 : normalized.length <= 10 ? 2 : 3;
  return cities.map((city) => {
    const first = normalizeCity(city.name).split(' ')[0];
    const distance = first.startsWith(normalized) ? 0 : editDistance(normalized, first);
    return { city, distance };
  }).filter((entry) => entry.distance <= maximum)
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => ({ ...entry.city, approximate: entry.distance > 0 }));
}

export const Scale = {
  AU_KM,
  R_EARTH_KM,
  SCENE_UNITS_PER_KM_TRUE,
  toSceneUnits,
  toTrueUnits,
  setMode,
  getMode,
  bodyRadius,
  orbitRadius,
  formatDistance,
  formatRadius,
  get mode() {
    return getMode();
  },
  set mode(nextMode) {
    setMode(nextMode);
  },
};

if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.Scale = Scale;
}
