/**
 * MISSION PLANNING & SCIENCE MODULE
 * =================================
 *
 * This module provides the core data model, architecture plan, source requirements,
 * integration roadmap, and scientific accuracy recommendations for the
 * Lunar Link Planner mission planning subsystem.
 *
 * It integrates with existing modules:
 * - landing-sites-core.mjs: Site validation, illumination/visibility metrics
 * - mission-transfer-core.mjs: Hohmann, bi-elliptic, Lambert, swingby transfers
 * - terrain-core.mjs: LOLA horizon profiles, lighting and contact calculations
 */

import { LANDING_SITES, siteMetrics, siteTimeSeries, compareSites, normaliseCoordinates } from './landing-sites-core.mjs';
import { hohmannTransfer, biEllipticTransfer, lambertTransfer, swingByTransfer, calculateRelativisticEffects } from './mission-transfer-core.mjs';
import { lightingAndContact, makeHorizonProfile } from './terrain-core.mjs';

// ============================================================================
// 1. DATA MODEL
// ============================================================================
/**
 * @typedef {Object} MissionSite
 * @property {string} id - Unique identifier (e.g., 'apollo11', 'im1')
 * @property {string} name - Human-readable name
 * @property {string} agency - Space agency or commercial entity
 * @property {string} program - Program name (e.g., 'Apollo', 'CLPS', 'Chang\'e')
 * @property {string} country - Operator nation / agency
 * @property {'crewed'|'rover'|'lander'|'sample_return'|'candidate'} type - Mission type
 * @property {'landed'|'candidate'} status - Current status
 * @property {number} latitude - Selenographic latitude in degrees (-90 to 90)
 * @property {number} longitude - Selenographic longitude in degrees (-180 to 180, East positive)
 * @property {number|null} year - Year of mission (null for candidates)
 * @property {string} [site_name] - Specific geological feature name
 * @property {string} [notes] - Additional context
 */

/**
 * @typedef {Object} TimelineEvent
 * @property {number} timestamp - Unix timestamp in milliseconds
 * @property {'sunset'|'sunrise'|'earthset'|'earthrise'|'comms_start'|'comms_end'} type - Event type
 * @property {number} solarElevationDeg - Solar elevation at event start
 * @property {number} earthElevationDeg - Earth elevation at event start
 */

/**
 * @typedef {Object} PowerMetric
 * @property {number} timestamp - Unix timestamp in milliseconds
 * @property {number} solarElevationDeg - Sun elevation above local horizon
 * @property {boolean} sunlit - True if solar elevation > 0 and no local horizon occlusion
 * @property {number} powerFraction - Relative solar power (0.0 to 1.0)
 * @property {number} estimatedBatteryPercent - Estimated battery state of charge (0-100)
 */

/**
 * @typedef {Object} CommunicationWindow
 * @property {number} startTimestamp - Unix timestamp in milliseconds
 * @property {number} endTimestamp - Unix timestamp in milliseconds
 * @property {number} durationMs - Duration in milliseconds
 * @property {number} minEarthElevationDeg - Minimum Earth elevation during window
 * @property {number} maxEarthElevationDeg - Maximum Earth elevation during window
 */

/**
 * @typedef {Object} TransferPlan
 * @property {'hohmann'|'bielliptic'|'lambert'|'swingby'} type - Transfer type
 * @property {number} departureEpoch - Unix timestamp of departure
 * @property {number} arrivalEpoch - Unix timestamp of arrival
 * @property {number} totalDeltaVKmS - Total delta-V required in km/s
 * @property {number} durationDays - Transfer duration in days
 * @property {Object} relativisticCorrection - Special relativity time dilation assessment
 * @property {number} relativisticCorrection.deltaTMs - Time difference in milliseconds
 * @property {number} relativisticCorrection.gamma - Lorentz factor
 * @property {boolean} relativisticCorrection.isSignificant - True if deltaT > 1ms
 */

// ============================================================================
// 2. ARCHITECTURE PLAN
// ============================================================================
/**
 * ARCHITECTURE OVERVIEW:
 * The mission planning subsystem is designed as a pure, side-effect-free core
 * that consumes ephemeris data and terrain models to produce actionable metrics.
 *
 * Layers:
 * 1. Data Layer: `static/data/lunar-sites.json` (curated sites), `static/data/cities-500.json` (Earth departure points).
 * 2. Ephemeris Layer: `solar-system-core.mjs` (approximate positions), `terrain-core.mjs` (LOLA horizon profiles).
 * 3. Computation Layer: This module, `mission-transfer-core.mjs` (Lambert/Hohmann), `landing-sites-core.mjs` (illumination/visibility).
 * 4. Presentation Layer: `ui-core.mjs`, `route-visualizer.mjs`, `hohmann-diagram.mjs` (renders timelines and transfer diagrams).
 *
 * State Management:
 * - Uses a centralized reactive store for timeline slider state.
 * - Timeline animation is driven by `requestAnimationFrame`, interpolating the UTC date and querying the Computation Layer at each step.
 */

// ============================================================================
// 3. SOURCE REQUIREMENTS
// ============================================================================
/**
 * EXTERNAL DATA SOURCES & DEPENDENCIES:
 * - LOLA (Lunar Orbiter Laser Altimeter): 16-bit height rasters for local horizon and slope calculation.
 *   Source: NASA CGI Moon Kit / GSFC SVS.
 * - JPL Horizons: High-precision ephemerides for Sun/Earth azimuth/elevation at specific lunar coordinates.
 *   Source: ssd.jpl.nasa.gov/horizons/ (proxied via `serve.py`).
 * - JPL Approximate Planetary Elements: For long-range date jumps (1800-2999).
 *   Source: ssd.jpl.nasa.gov/planets/approx_pos.html
 * - OpenStreetMap / Nominatim: For Earth city coordinate resolution (typo-tolerant search).
 *
 * INTERNAL DEPENDENCIES:
 * - `./landing-sites-core.mjs`: Site validation, normalisation, and basic illumination metrics.
 * - `./mission-transfer-core.mjs`: Hohmann, bi-elliptic, Lambert, and patched-conic calculations, including relativistic effects.
 * - `./terrain-core.mjs`: `lightingAndContact` and `makeHorizonProfile` for accurate sunset/earthset prediction.
 */

// ============================================================================
// 4. INTEGRATION ROADMAP
// ============================================================================
/**
 * PHASE 1: Data Consolidation (Current)
 * - [x] Create `static/data/lunar-sites.json` with Apollo, Luna, CNSA, Chandrayaan, CLPS (Firefly, Intuitive Machines, ispace).
 * - [x] Define comprehensive JSDoc data models for sites, timelines, power, and transfers.
 *
 * PHASE 2: Core Computation Wiring
 * - [x] Wire `siteTimeSeries` from `landing-sites-core.mjs` to generate `TimelineEvent` and `PowerMetric` arrays for a given date range.
 * - [x] Integrate `calculateRelativisticEffects` from `mission-transfer-core.mjs` into the `TransferPlan` generator.
 *
 * PHASE 3: UI & Visualization
 * - [ ] Implement timeline animation controls in `ui-core.mjs` (play/pause, speed multiplier).
 * - [ ] Render communication windows and power metrics as overlay charts in `index.html`.
 * - [ ] Replace `hohmann-diagram.mjs` stub with a Canvas/SVG renderer for transfer orbits.
 *
 * PHASE 4: Validation & Testing
 * - [x] Add unit tests in `tests/mission-planning.test.mjs` for coordinate normalisation and relativity thresholds.
 * - [x] Add integration tests in `tests/mission-data-consistency.test.mjs` for data consistency.
 * - [ ] Run browser integration tests via `browsertest/` to verify LOLA horizon occlusion matches JPL Horizons preview within acceptable tolerance.
 */

// ============================================================================
// 5. SCIENTIFIC ACCURACY RECOMMENDATIONS
// ============================================================================
/**
 * 1. RELATIVITY CORRECTIONS:
 *    - Special Relativity (Time Dilation): For lunar transfers (v ~ 10.9 km/s), gamma is ~1.0000000006.
 *      Over a 3-day transfer (259,200s), deltaT is ~0.15 milliseconds.
 *      RECOMMENDATION: Flag as "negligible for operational planning, included for scientific completeness".
 *      Only becomes significant (>1ms) for high-energy solar system transfers (e.g., Jupiter flybys at >40 km/s).
 *    - General Relativity (Gravitational Time Dilation): Lunar surface gravity is weak.
 *      RECOMMENDATION: Omit from UI unless specifically requested for deep-space navigation pedagogy.
 *
 * 2. LOLA HORIZON & ILLUMINATION:
 *    - LOLA data is referenced to a mean sphere/ellipsoid. Local slopes >15 degrees can cause significant
 *      deviations from flat-horizon sunrise/sunset times, especially near the poles.
 *    - RECOMMENDATION: Always use `makeHorizonProfile` with at least 5-degree radial sampling for sites
 *      with latitude > 80 degrees (e.g., Artemis candidates, IM-1 Odysseus).
 *
 * 3. JPL HORIZONS VS PREVIEW:
 *    - The "PREVIEW" mode uses simplified periodic models. It is explicitly marked as non-authoritative.
 *    - RECOMMENDATION: Enforce a UI warning that "Communication windows and exact sunset times require
 *      'Load precise NASA ephemerides' for dates within the validated DE440/DE441 range (1550-2650 AD)."
 *
 * 4. COORDINATE FRAMES:
 *    - All lunar coordinates MUST be Mean Earth/Polar Axis (ME) frame. East longitude is positive.
 *    - RECOMMENDATION: Validate all custom coordinate inputs via `normaliseCoordinates` to wrap longitudes
 *      into [-180, 180] and reject invalid latitudes.
 */

// ============================================================================
// 6. EXPORTED UTILITY FUNCTIONS
// ============================================================================

/**
 * Asynchronously loads the curated lunar sites from the JSON file.
 * @returns {Promise<MissionSite[]>}
 */
export async function loadLunarSites() {
  const response = await fetch('/static/data/lunar-sites.json');
  if (!response.ok) {
    throw new Error(`Failed to load lunar sites: ${response.status}`);
  }
  const data = await response.json();
  return data.sites;
}

/**
 * Normalises custom coordinates to the ME frame.
 * Delegates to landing-sites-core.mjs for consistency.
 * @param {number} lat
 * @param {number} lon
 * @returns {{lat: number, lon: number, valid: boolean, error?: string}}
 */
export function validateCustomCoordinates(lat, lon) {
  return normaliseCoordinates(lat, lon);
}

/**
 * Assesses if relativistic corrections are scientifically significant for a given transfer.
 * Delegates to mission-transfer-core.mjs for accurate calculation.
 * @param {number} maxVelocityKmS - Maximum velocity during transfer
 * @param {number} durationSeconds - Total transfer duration in seconds
 * @returns {{isSignificant: boolean, deltaTMs: number, gamma: number, recommendation: string}}
 */
export function assessRelativitySignificance(maxVelocityKmS, durationSeconds) {
  const relativityResult = calculateRelativisticEffects(maxVelocityKmS, durationSeconds);
  const deltaTMs = relativityResult.deltaTMs;

  const isSignificant = deltaTMs > 1.0; // > 1 millisecond
  const recommendation = isSignificant
    ? 'Relativistic time dilation is significant. Include in navigation logs.'
    : 'Relativistic time dilation is negligible (< 1ms) for this profile. Safe to omit from primary UI.';

  return {
    isSignificant,
    deltaTMs: Math.round(deltaTMs * 1000) / 1000,
    gamma: relativityResult.gamma,
    recommendation
  };
}

/**
 * Generates a comprehensive timeline of events for a given site and date range.
 * Uses landing-sites-core.mjs for accurate illumination and visibility calculations.
 *
 * @param {Object} site - Site object with lat/lon
 * @param {Array<Object>} frames - Array of ephemeris frames from solar-system-core.mjs
 * @param {Object|null} [dem] - Optional DEM for horizon occlusion
 * @param {number} [minEarthElevation=10] - Minimum Earth elevation for communication
 * @returns {{
 *   timelineEvents: Array<TimelineEvent>,
 *   powerMetrics: Array<PowerMetric>,
 *   communicationWindows: Array<CommunicationWindow>,
 *   sunWindows: Array,
 *   earthWindows: Array
 * }}
 */
export function generateComprehensiveTimeline(site, frames, dem = null, minEarthElevation = 10) {
  // Use landing-sites-core.mjs for accurate calculations
  const timeSeries = siteTimeSeries(site, frames, dem, minEarthElevation);

  // Generate timeline events (sunset, sunrise, earthset, earthrise)
  const timelineEvents = [];
  let prevSunlit = null;
  let prevEarthVisible = null;

  for (const sample of timeSeries.samples) {
    const currentSunlit = sample.sunlit;
    const currentEarthVisible = sample.earthVisible;

    // Detect sunset/sunrise transitions
    if (prevSunlit !== null && prevSunlit !== currentSunlit) {
      timelineEvents.push({
        timestamp: sample.utc instanceof Date ? sample.utc.getTime() : Date.parse(sample.utc),
        type: currentSunlit ? 'sunrise' : 'sunset',
        solarElevationDeg: sample.sunElevationDeg,
        earthElevationDeg: sample.earthElevationDeg
      });
    }

    // Detect earthset/earthrise transitions
    if (prevEarthVisible !== null && prevEarthVisible !== currentEarthVisible) {
      timelineEvents.push({
        timestamp: sample.utc instanceof Date ? sample.utc.getTime() : Date.parse(sample.utc),
        type: currentEarthVisible ? 'earthrise' : 'earthset',
        solarElevationDeg: sample.sunElevationDeg,
        earthElevationDeg: sample.earthElevationDeg
      });
    }

    prevSunlit = currentSunlit;
    prevEarthVisible = currentEarthVisible;
  }

  // Generate power metrics
  const powerMetrics = timeSeries.samples.map(sample => ({
    timestamp: sample.utc instanceof Date ? sample.utc.getTime() : Date.parse(sample.utc),
    solarElevationDeg: sample.sunElevationDeg,
    sunlit: sample.sunlit,
    powerFraction: sample.sunPowerFraction,
    estimatedBatteryPercent: estimateBatteryPercent(sample.sunPowerFraction, sample.sunlit)
  }));

  // Generate communication windows from earthWindows
  const communicationWindows = timeSeries.earthWindows.map(window => ({
    startTimestamp: window.startUtc instanceof Date ? window.startUtc.getTime() : Date.parse(window.startUtc),
    endTimestamp: window.endUtc instanceof Date ? window.endUtc.getTime() : Date.parse(window.endUtc),
    durationMs: window.durationMs,
    minEarthElevationDeg: 0, // Would need to calculate from samples
    maxEarthElevationDeg: 90  // Would need to calculate from samples
  }));

  return {
    timelineEvents,
    powerMetrics,
    communicationWindows,
    sunWindows: timeSeries.sunWindows,
    earthWindows: timeSeries.earthWindows
  };
}

/**
 * Estimates battery percentage based on solar power and consumption model.
 * Simplified model: battery charges when sunlit, discharges when not.
 *
 * @param {number} powerFraction - Current solar power fraction (0-1)
 * @param {boolean} sunlit - Whether the site is currently sunlit
 * @param {number} [currentPercent=50] - Current battery percentage
 * @returns {number} Estimated battery percentage (0-100)
 */
function estimateBatteryPercent(powerFraction, sunlit, currentPercent = 50) {
  // Simplified model: charge rate 2%/hour when sunlit, discharge rate 5%/hour when not
  // This is a placeholder; real implementation would track state over time
  if (sunlit) {
    return Math.min(100, currentPercent + powerFraction * 2);
  } else {
    return Math.max(0, currentPercent - 5);
  }
}

/**
 * Generates a Hohmann transfer plan with relativistic correction assessment.
 * Integrates with mission-transfer-core.mjs.
 *
 * @param {number} radiusStartKm - Starting orbit radius in km
 * @param {number} radiusEndKm - Target orbit radius in km
 * @param {number} [mu] - Gravitational parameter (default: Sun)
 * @returns {TransferPlan}
 */
export function generateHohmannTransferPlan(radiusStartKm, radiusEndKm, mu) {
  const transfer = hohmannTransfer(radiusStartKm, radiusEndKm, mu);
  const relativity = assessRelativitySignificance(transfer.maxVelocityKmS, transfer.transferSeconds);

  return {
    type: 'hohmann',
    departureEpoch: Date.now(),
    arrivalEpoch: Date.now() + transfer.transferSeconds * 1000,
    totalDeltaVKmS: transfer.totalDeltaVKmS,
    durationDays: transfer.transferSeconds / 86400,
    relativisticCorrection: relativity,
    transferDetails: transfer
  };
}

/**
 * Compares multiple landing sites for viability at a given time.
 * Integrates with landing-sites-core.mjs.
 *
 * @param {Array<Object>} sites - Array of site objects
 * @param {Object} frame - Ephemeris frame
 * @param {Object|null} [dem] - Optional DEM
 * @param {number} [minEarthElevation=10] - Minimum Earth elevation
 * @returns {Array<Object>} Ranked sites with metrics
 */
export function compareLandingSites(sites, frame, dem = null, minEarthElevation = 10) {
  return compareSites(sites, frame, dem, minEarthElevation);
}

/**
 * Preview generator for timeline tests.
 */
export function generateTimelinePreview(site, startEpoch, endEpoch, stepHours = 1) {
  // Generate mock or real timeline event array for testing
  const events = [];
  let current = startEpoch;
  while (current <= endEpoch) {
    events.push({
      timestamp: current,
      type: 'sunrise',
      solarElevationDeg: 10.0,
      earthElevationDeg: 45.0
    });
    current += stepHours * 3600 * 1000;
  }
  return events;
}

// Export for browser global access if needed
if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.MissionPlanning = {
    loadLunarSites,
    validateCustomCoordinates,
    assessRelativitySignificance,
    generateComprehensiveTimeline,
    generateHohmannTransferPlan,
    compareLandingSites,
    LANDING_SITES
  };
}

export default {
  loadLunarSites,
  validateCustomCoordinates,
  assessRelativitySignificance,
  generateComprehensiveTimeline,
  generateHohmannTransferPlan,
  compareLandingSites,
  LANDING_SITES
};
