/**
 * Landing-site selection, curation, comparison and illumination/window metrics.
 *
 * Pure, Node-safe module (no DOM, no WebGL, no network). It builds on the
 * geometry helpers exported by terrain-core.mjs (lightingAndContact) and the
 * per-frame Moon-fixed Sun/Earth directions produced by the ephemeris layer
 * ({ moon_eci_km, sun_moon_fixed, earth_moon_fixed, utc }).
 *
 * Coordinate convention: selenographic latitude/longitude in DEGREES.
 * East longitude is positive. This is NOT Earth WGS84.
 *
 * @module landing-sites-core
 */

import { lightingAndContact, makeHorizonProfile } from './terrain-core.mjs';

const RAD = Math.PI / 180;

/**
 * @typedef {Object} LandingSite
 * @property {string} id            stable slug
 * @property {string} name          human label
 * @property {string} program       e.g. 'Apollo', 'Luna', 'Chang'e', 'CLPS', 'Artemis'
 * @property {string} country       operator nation / agency
 * @property {number} lat           selenographic latitude, deg N
 * @property {number} lon           selenographic longitude, deg E
 * @property {number|null} year     mission year (null for candidate sites)
 * @property {'landed'|'candidate'} status
 * @property {string} [note]
 */

/** @type {LandingSite[]} */
export const LANDING_SITES = Object.freeze([
  // --- Apollo (NASA, USA) -------------------------------------------------
  { id: 'apollo11', name: 'Apollo 11 — Tranquility Base', program: 'Apollo', country: 'USA (NASA)', lat: 0.6741, lon: 23.4729, year: 1969, status: 'landed', note: 'First crewed landing, Sea of Tranquility.' },
  { id: 'apollo12', name: 'Apollo 12 — Ocean of Storms', program: 'Apollo', country: 'USA (NASA)', lat: -3.0128, lon: -23.4219, year: 1969, status: 'landed', note: 'Precision landing near Surveyor 3.' },
  { id: 'apollo14', name: 'Apollo 14 — Fra Mauro', program: 'Apollo', country: 'USA (NASA)', lat: -3.6453, lon: -17.4718, year: 1971, status: 'landed' },
  { id: 'apollo15', name: 'Apollo 15 — Hadley–Apennine', program: 'Apollo', country: 'USA (NASA)', lat: 26.1322, lon: 3.6339, year: 1971, status: 'landed', note: 'First Lunar Roving Vehicle mission.' },
  { id: 'apollo16', name: 'Apollo 16 — Descartes Highlands', program: 'Apollo', country: 'USA (NASA)', lat: -8.9734, lon: 15.4986, year: 1972, status: 'landed' },
  { id: 'apollo17', name: 'Apollo 17 — Taurus–Littrow', program: 'Apollo', country: 'USA (NASA)', lat: 20.1908, lon: 30.7717, year: 1972, status: 'landed', note: 'Last crewed landing; geologist on board.' },

  // --- Luna (Soviet Union / Russia) --------------------------------------
  { id: 'luna9', name: 'Luna 9', program: 'Luna', country: 'USSR', lat: 7.13, lon: -64.37, year: 1966, status: 'landed', note: 'First soft landing on the Moon.' },
  { id: 'luna16', name: 'Luna 16', program: 'Luna', country: 'USSR', lat: -0.5137, lon: 56.3638, year: 1970, status: 'landed', note: 'First robotic sample return.' },
  { id: 'luna17', name: 'Luna 17 / Lunokhod 1', program: 'Luna', country: 'USSR', lat: 38.2378, lon: -35.0017, year: 1970, status: 'landed', note: 'First robotic rover.' },
  { id: 'luna24', name: 'Luna 24', program: 'Luna', country: 'USSR', lat: 12.7142, lon: 62.2129, year: 1976, status: 'landed', note: 'Sample return, Mare Crisium.' },
  { id: 'luna25', name: 'Luna 25 (crash site)', program: 'Luna', country: 'Russia (Roscosmos)', lat: -69.545, lon: 43.544, year: 2023, status: 'landed', note: 'Impacted the surface; target was near the south pole.' },

  // --- Chang'e (China / CNSA) -------------------------------------------
  { id: 'change3', name: "Chang'e 3 / Yutu", program: "Chang'e", country: 'China (CNSA)', lat: 44.1214, lon: -19.5116, year: 2013, status: 'landed', note: 'First Chinese soft landing.' },
  { id: 'change4', name: "Chang'e 4 / Yutu-2", program: "Chang'e", country: 'China (CNSA)', lat: -45.4446, lon: 177.5991, year: 2019, status: 'landed', note: 'First far-side landing (Von Kármán crater).' },
  { id: 'change5', name: "Chang'e 5", program: "Chang'e", country: 'China (CNSA)', lat: 43.0576, lon: -51.9161, year: 2020, status: 'landed', note: 'Sample return, Mons Rümker.' },
  { id: 'change6', name: "Chang'e 6", program: "Chang'e", country: 'China (CNSA)', lat: -41.6385, lon: 170.115, year: 2024, status: 'landed', note: 'First far-side sample return, Apollo basin.' },

  // --- CLPS / commercial (NASA-funded) ----------------------------------
  { id: 'im1', name: 'IM-1 Odysseus (Intuitive Machines)', program: 'CLPS', country: 'USA (commercial)', lat: 80.13, lon: 1.44, year: 2024, status: 'landed', note: 'First commercial soft landing, near south pole.' },
  { id: 'firefly1', name: 'Blue Ghost Mission 1 (Firefly)', program: 'CLPS', country: 'USA (commercial)', lat: 18.56, lon: 61.81, year: 2025, status: 'landed', note: 'Mare Crisium, CLPS delivery.' },

  // --- Artemis candidate regions (NASA) ---------------------------------
  { id: 'artemis_sp', name: 'Artemis — South Pole region', program: 'Artemis', country: 'USA (NASA)', lat: -89.0, lon: 0.0, year: null, status: 'candidate', note: 'Permanently shadowed regions + near-continuous sunlight ridges.' },
  { id: 'artemis_connect', name: 'Artemis — Connecting Ridge', program: 'Artemis', country: 'USA (NASA)', lat: -89.45, lon: -137.0, year: null, status: 'candidate', note: 'Candidate for high illumination + Earth visibility.' },
  { id: 'artemis_shackleton', name: 'Artemis — Shackleton rim', program: 'Artemis', country: 'USA (NASA)', lat: -89.9, lon: 0.0, year: null, status: 'candidate', note: 'Rim near permanently shadowed Shackleton crater.' },

  // --- ISRO (India) ------------------------------------------------------
  { id: 'chandrayaan3', name: 'Chandrayaan-3 / Vikram', program: 'Chandrayaan', country: 'India (ISRO)', lat: -69.373, lon: 32.319, year: 2023, status: 'landed', note: 'First landing near the south pole.' }
]);

/** Look up a curated site by id. @param {string} id @returns {LandingSite|null} */
export function getSite(id) {
  if (!id) return null;
  return LANDING_SITES.find((s) => s.id === id) || null;
}

/**
 * Validate and normalise free-form coordinates.
 * @param {number} lat
 * @param {number} lon
 * @returns {{lat:number, lon:number, valid:boolean, error?:string}}
 */
export function normaliseCoordinates(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { lat: 0, lon: 0, valid: false, error: 'Latitude and longitude must be finite numbers.' };
  }
  if (Math.abs(la) > 90) {
    return { lat: la, lon: lo, valid: false, error: 'Latitude must be between -90 and 90 degrees.' };
  }
  // Wrap longitude into [-180, 180).
  let wrapped = ((lo + 180) % 360 + 360) % 360 - 180;
  return { lat: la, lon: wrapped, valid: true };
}

/**
 * Compute illumination and Earth-visibility metrics for one site at one frame.
 * Wraps terrain-core lightingAndContact and adds human-facing derived fields.
 *
 * @param {LandingSite|{lat:number,lon:number}} site
 * @param {object} frame   ephemeris frame with sun_moon_fixed, earth_moon_fixed
 * @param {object|null} [dem]     elevation model (optional; improves horizon)
 * @param {object|null} [profile] horizon profile (optional; else computed)
 * @param {number} [minEarthElevation=10]
 * @returns {object} metrics
 */
export function siteMetrics(site, frame, dem = null, profile = null, minEarthElevation = 10) {
  const { lat, lon } = site;
  const prof = profile || (dem ? makeHorizonProfile(dem, lat, lon, 5) : null);
  let m;
  try {
    m = lightingAndContact(frame, lat, lon, dem, prof, minEarthElevation, false);
  } catch (err) {
    // A degenerate frame (e.g. a zero-length direction vector) must not crash
    // the caller: return a neutral "unknown" metric set instead.
    return {
      lat, lon,
      sunElevationDeg: 0, sunAzimuthDeg: 0, sunHorizonClearanceDeg: 0,
      earthElevationDeg: 0, earthAzimuthDeg: 0, earthHorizonClearanceDeg: 0,
      sunlit: false, earthVisible: false, siteElevKm: 0, valid: false,
      sunPowerFraction: 0, error: err && err.message ? err.message : 'frame error'
    };
  }
  return {
    lat, lon,
    sunElevationDeg: round2(m.s),
    sunAzimuthDeg: round2(m.sunAz),
    sunHorizonClearanceDeg: round2(m.sclear),
    earthElevationDeg: round2(m.e),
    earthAzimuthDeg: round2(m.earthAz),
    earthHorizonClearanceDeg: round2(m.eclear),
    sunlit: !!m.sunlit,
    earthVisible: !!m.earthVisible,
    siteElevKm: round4(m.siteElevKm),
    valid: !!m.valid,
    sunPowerFraction: sunPowerFraction(m.s)
  };
}

/**
 * Relative solar power as a fraction of an unobstructed overhead Sun.
 * Uses cos(zenith) clamped to [0,1]; below the horizon → 0.
 * @param {number} sunElevationDeg
 * @returns {number} 0..1
 */
export function sunPowerFraction(sunElevationDeg) {
  const el = Math.max(0, Math.min(90, Number(sunElevationDeg) || 0));
  return round4(Math.cos((90 - el) * RAD));
}

/**
 * Scan a time series of frames for one site and return illumination windows.
 * @param {LandingSite|{lat:number,lon:number}} site
 * @param {object[]} frames  ordered ephemeris frames (each has utc)
 * @param {object|null} [dem]
 * @param {number} [minEarthElevation=10]
 * @returns {{samples:object[], sunWindows:Array, earthWindows:Array, firstSunset:number|null, firstEarthset:number|null}}
 */
export function siteTimeSeries(site, frames, dem = null, minEarthElevation = 10) {
  const { lat, lon } = site;
  const profile = dem ? makeHorizonProfile(dem, lat, lon, 5) : null;
  const samples = frames.map((f) => {
    const m = siteMetrics(site, f, dem, profile, minEarthElevation);
    m.utc = f.utc;
    return m;
  });

  const sunWindows = extractWindows(samples, (s) => s.sunlit);
  const earthWindows = extractWindows(samples, (s) => s.earthVisible);

  // Time until the next transition from the first frame (ms), if any.
  const firstSunset = msToFirstTransition(samples, (s) => s.sunlit);
  const firstEarthset = msToFirstTransition(samples, (s) => s.earthVisible);

  return { samples, sunWindows, earthWindows, firstSunset, firstEarthset };
}

/**
 * Compare several sites at one frame and rank by viability.
 * Viability prioritises sunlight and Earth visibility, then higher Sun angle.
 * @param {Array<LandingSite|{lat:number,lon:number}>} sites
 * @param {object} frame
 * @param {object|null} [dem]
 * @param {number} [minEarthElevation=10]
 * @returns {Array<object>} ranked metrics with `rank` and `score`
 */
export function compareSites(sites, frame, dem = null, minEarthElevation = 10) {
  const results = sites.map((site) => {
    const metrics = siteMetrics(site, frame, dem, null, minEarthElevation);
    const score = (metrics.sunlit ? 2 : 0)
      + (metrics.earthVisible ? 2 : 0)
      + metrics.sunPowerFraction
      + Math.max(0, metrics.earthHorizonClearanceDeg) / 90;
    return { site, metrics, score: round4(score) };
  });
  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => { r.rank = i + 1; });
  return results;
}

/**
 * Pick the contiguous windows where predicate is true.
 * @param {object[]} samples
 * @param {(s:object)=>boolean} predicate
 * @returns {Array<{startUtc:any,endUtc:any,count:number,durationMs:number}>}
 */
export function extractWindows(samples, predicate) {
  const windows = [];
  let open = null;
  for (let i = 0; i < samples.length; i++) {
    const on = !!predicate(samples[i]);
    if (on && !open) open = { startUtc: samples[i].utc, startIndex: i };
    if (!on && open) {
      const prev = samples[i - 1];
      open.endUtc = prev.utc;
      open.count = i - open.startIndex;
      open.durationMs = toMs(open.endUtc) - toMs(open.startUtc);
      windows.push(open);
      open = null;
    }
  }
  if (open) {
    const last = samples[samples.length - 1];
    open.endUtc = last.utc;
    open.count = samples.length - open.startIndex;
    open.durationMs = toMs(open.endUtc) - toMs(open.startUtc);
    windows.push(open);
  }
  return windows;
}

/**
 * Milliseconds from the first sample until predicate first becomes false.
 * @param {object[]} samples
 * @param {(s:object)=>boolean} predicate
 * @returns {number|null}
 */
export function msToFirstTransition(samples, predicate) {
  if (!samples.length) return null;
  const initial = !!predicate(samples[0]);
  for (let i = 1; i < samples.length; i++) {
    if (!!predicate(samples[i]) !== initial) {
      return toMs(samples[i].utc) - toMs(samples[0].utc);
    }
  }
  return null;
}

function toMs(utc) {
  if (utc instanceof Date) return utc.getTime();
  if (typeof utc === 'number') return utc;
  const t = Date.parse(String(utc));
  return Number.isFinite(t) ? t : 0;
}

function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function round4(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }

/** Public API surface. */
export const LandingSites = {
  LANDING_SITES,
  getSite,
  normaliseCoordinates,
  siteMetrics,
  sunPowerFraction,
  siteTimeSeries,
  compareSites,
  extractWindows,
  msToFirstTransition
};

if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.LandingSites = LandingSites;
}

export default LandingSites;
