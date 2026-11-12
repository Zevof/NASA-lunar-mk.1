/**
 * Intuitive city-to-city and planet-to-planet routing for Lunar Link Planner.
 *
 * Public browser API:
 *   window.LLP.Routing.planRoute(from, to)          async!
 *   window.LLP.Routing.getActiveRoute()
 *   window.LLP.Routing.setActiveRoute(route)
 *   window.LLP.Routing.findCity(query)              best single match
 *   window.LLP.Routing.searchCities(query, limit)   ranked, typo-tolerant list
 *   window.LLP.Routing.PLANET_OPTIONS               [{id,name}, ...]
 *   window.LLP.Routing.loadCityOptions()
 *
 * Route input:
 *   { type:'city', lat, lon, name }
 *   { type:'planet', id, name }
 *
 * Route output:
 *   {
 *     distanceKm, durationHours, isValid, type,
 *     path: [{lat,lon}] | [{planetId,x,y,z}],
 *     waypoints: [], error?
 *   }
 */

import {
  biEllipticTransfer,
  calculateRelativisticEffects,
  hohmannTransfer,
  lambertTransfer,
  swingByTransfer
} from './mission-transfer-core.mjs';
import { planetPositionKm } from './solar-system-core.mjs';

const EARTH_RADIUS_KM = 6371.0088;
const MU_SUN_KM3_S2 = 1.32712440018e11;
const MU_EARTH_KM3_S2 = 398600.4418;
const MOON_ORBIT_RADIUS_KM = 384400;
const MOON_TRANSFER_DAYS = 3.05; // Approximate Apollo-style Earth to Moon coast.
const AU_KM = 149597870.7;
const MAX_CITY_WAYPOINTS = 20;
const DEFAULT_TRAVEL_SPEED_KMH = 100;

let activeRoute = null;
let citiesCache = null;
let citiesLoadPromise = null;

const FALLBACK_PLANETS = {
  sun: { id: 'sun', name: 'Sun', semiMajorAxisKm: 0 },
  mercury: { id: 'mercury', name: 'Mercury', semiMajorAxisKm: 0.38709893 * AU_KM },
  venus: { id: 'venus', name: 'Venus', semiMajorAxisKm: 0.72333199 * AU_KM },
  earth: { id: 'earth', name: 'Earth', semiMajorAxisKm: 1.495978707e8 },
  moon: { id: 'moon', name: 'Moon', semiMajorAxisKm: 3.844e5 },
  mars: { id: 'mars', name: 'Mars', semiMajorAxisKm: 1.52366231 * AU_KM },
  jupiter: { id: 'jupiter', name: 'Jupiter', semiMajorAxisKm: 5.20336301 * AU_KM },
  saturn: { id: 'saturn', name: 'Saturn', semiMajorAxisKm: 9.53707032 * AU_KM },
  uranus: { id: 'uranus', name: 'Uranus', semiMajorAxisKm: 19.19126393 * AU_KM },
  neptune: { id: 'neptune', name: 'Neptune', semiMajorAxisKm: 30.06896348 * AU_KM }
};

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

function normalizeDegrees(value) {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lon2 - lon1);

  const a = Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * centralAngle;
}

function greatCirclePoint(lat1, lon1, lat2, lon2, fraction) {
  const phi1 = toRadians(lat1);
  const lambda1 = toRadians(lon1);
  const phi2 = toRadians(lat2);
  const lambda2 = toRadians(lon2);

  const dLambda = lambda2 - lambda1;
  const cosPhi1 = Math.cos(phi1);
  const cosPhi2 = Math.cos(phi2);
  const sinPhi1 = Math.sin(phi1);
  const sinPhi2 = Math.sin(phi2);

  const x = cosPhi1 * sinPhi2 - sinPhi1 * cosPhi2 * Math.cos(dLambda);
  const y = cosPhi2 * Math.sin(dLambda);
  const z = sinPhi1 * sinPhi2 + cosPhi1 * cosPhi2 * Math.cos(dLambda);

  const centralAngle = Math.atan2(Math.hypot(x, y), z);
  if (!Number.isFinite(centralAngle) || centralAngle === 0) {
    return { lat: lat1, lon: lon1 };
  }

  const sinTotal = Math.sin(centralAngle);
  const a = Math.sin((1 - fraction) * centralAngle) / sinTotal;
  const b = Math.sin(fraction * centralAngle) / sinTotal;

  const x3 = a * cosPhi1 * Math.cos(lambda1) + b * cosPhi2 * Math.cos(lambda2);
  const y3 = a * cosPhi1 * Math.sin(lambda1) + b * cosPhi2 * Math.sin(lambda2);
  const z3 = a * sinPhi1 + b * sinPhi2;

  const lat = toDegrees(Math.atan2(z3, Math.hypot(x3, y3)));
  const lon = toDegrees(Math.atan2(y3, x3));
  return { lat, lon: normalizeDegrees(lon) };
}

async function loadCities() {
  if (citiesCache) return citiesCache;
  if (citiesLoadPromise) return citiesLoadPromise;

  citiesLoadPromise = (async () => {
    try {
      let payload;
      try {
        const response = await fetch('data/cities-500.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payload = await response.json();
      } catch (browserFetchError) {
        if (typeof process === 'undefined' || !process.versions?.node) {
          throw browserFetchError;
        }
        const { readFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        const here = new URL('.', import.meta.url);
        const filePath = fileURLToPath(new URL('data/cities-500.json', here));
        payload = JSON.parse(await readFile(filePath, 'utf8'));
      }
      const cities = Array.isArray(payload) ? payload : payload.cities;
      citiesCache = Array.isArray(cities) ? cities.filter(city =>
        city && typeof city.lat === 'number' && typeof city.lon === 'number'
      ) : [];
    } catch (error) {
      console.warn('[route-core] City data unavailable:', error && error.message);
      citiesCache = [];
    }
    return citiesCache;
  })();

  return citiesLoadPromise;
}

/**
 * Optimal-string-alignment Damerau-Levenshtein distance (with transpositions).
 * Powers typo-tolerant city search: "Munic" -> "Munich", "Brlin" -> "Berlin".
 */
function damerauLevenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

/**
 * Score a city name against a query. Higher is better.
 *   100 exact · 80 startsWith · 60 includes · 40 - 5*dist fuzzy · -1 no match
 */
function scoreCityMatch(cityName, query) {
  const n = String(cityName || '').toLowerCase();
  const q = String(query || '').trim().toLowerCase();
  if (!q || !n) return -1;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  const dist = damerauLevenshtein(n, q);
  const maxDist = Math.max(1, Math.floor(Math.min(n.length, q.length) * 0.4));
  if (dist <= maxDist) return Math.max(1, 40 - dist * 5);
  return -1;
}

async function findCityByName(name) {
  const results = await searchCitiesByName(name, 1);
  return results[0] || null;
}

async function searchCitiesByName(query, limit = 8) {
  const cities = await loadCities();
  const q = String(query || '').trim();
  if (!q) return [];
  const scored = [];
  for (const city of cities) {
    const name = String(city.name || '');
    if (!name) continue;
    const score = scoreCityMatch(name, q);
    if (score > 0) scored.push({ city, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = Number(a.city.population) || 0;
    const pb = Number(b.city.population) || 0;
    if (pb !== pa) return pb - pa;
    return String(a.city.name).localeCompare(String(b.city.name));
  });
  return scored.slice(0, Math.max(1, limit)).map((entry) => entry.city);
}

function getPlanet(id) {
  const wanted = String(id || '').toLowerCase();
  if (typeof window !== 'undefined' && window.LLP && window.LLP.Planets) {
    try {
      const planet = window.LLP.Planets.get(wanted);
      if (planet) return planet;
    } catch (error) {
      console.warn('[route-core] Planet lookup failed:', error && error.message);
    }
  }
  return FALLBACK_PLANETS[wanted] || null;
}

function hohmannTransferKm(a1Km, a2Km) {
  if (!(a1Km > 0) || !(a2Km > 0)) {
    return { distanceKm: 0, durationHours: 0, transferRadiusKm: 0 };
  }

  const transferRadiusKm = (a1Km + a2Km) / 2;
  const durationSeconds = Math.PI * Math.sqrt((transferRadiusKm ** 3) / MU_SUN_KM3_S2);
  return {
    distanceKm: Math.PI * transferRadiusKm,
    durationHours: durationSeconds / 3600,
    transferRadiusKm
  };
}

function transferRoute(fromPlanet, toPlanet, options = {}) {
  const transferType = String(options.transferType || 'hohmann').toLowerCase();
  const waypoints = [fromPlanet.id, toPlanet.id];
  let transfer;
  let departureEpoch = null;
  let arrivalEpoch = null;

  if (transferType === 'hohmann') {
    transfer = hohmannTransfer(fromPlanet.semiMajorAxisKm, toPlanet.semiMajorAxisKm);
  } else if (transferType === 'bielliptic') {
    const intermediateApoapsisKm = Number(options.biellipticRadiusAu) * 149597870.7;
    transfer = biEllipticTransfer(
      fromPlanet.semiMajorAxisKm,
      toPlanet.semiMajorAxisKm,
      intermediateApoapsisKm
    );
  } else if (transferType === 'lambert' || transferType === 'swingby') {
    departureEpoch = options.departureEpoch || new Date().toISOString();
    const timeOfFlightDays = Number(options.timeOfFlightDays);
    if (!Number.isFinite(timeOfFlightDays) || timeOfFlightDays <= 0) {
      throw new Error('Enter a positive Lambert flight time in days.');
    }
    arrivalEpoch = new Date(Date.parse(departureEpoch) + timeOfFlightDays * 86400000).toISOString();

    if (transferType === 'lambert') {
      const departurePosition = planetPositionKm(fromPlanet.id, departureEpoch);
      const arrivalPosition = planetPositionKm(toPlanet.id, arrivalEpoch);
      transfer = lambertTransfer(departurePosition, arrivalPosition, timeOfFlightDays * 86400);
    } else {
      const flybyId = String(options.flybyId || '').toLowerCase();
      if (!flybyId) throw new Error('Choose a flyby body for the swing-by manoeuvre.');
      waypoints.splice(1, 0, flybyId);
      transfer = swingByTransfer({
        originId: fromPlanet.id,
        destinationId: toPlanet.id,
        flybyId,
        departureEpoch,
        arrivalEpoch,
        flybyFraction: options.flybyFraction
      });
    }
  } else {
    throw new Error('Unknown transfer type.');
  }

  return {
    distanceKm: transfer.pathLengthKm,
    durationHours: transfer.transferSeconds / 3600,
    path: [],
    pathKm: transfer.pathKm,
    waypoints,
    transferType,
    transfer: {
      type: transferType,
      deltaVKmS: transfer.deltaVKmS || null,
      totalDeltaVKmS: transfer.totalDeltaVKmS || null,
      departureDeltaVKmS: transfer.departureDeltaVKmS || null,
      arrivalDeltaVKmS: transfer.arrivalDeltaVKmS || null,
      flybyDeltaVKmS: transfer.flybyDeltaVKmS || null,
      semiMajorAxisKm: transfer.semiMajorAxisKm || null,
      intermediateApoapsisKm: transfer.intermediateApoapsisKm || null,
      incomingExcessKmS: transfer.incomingExcessKmS || null,
      requiredExcessKmS: transfer.requiredExcessKmS || null,
      turnAngleRad: transfer.turnAngleRad || null,
      maximumTurnRad: transfer.maximumTurnRad || null,
      ballisticFlyby: transfer.ballisticFlyby || false,
      departureEpoch,
      arrivalEpoch,
      encounterEpoch: transfer.encounterEpoch || null,
      relativisticCorrection: calculateRelativisticEffects(
        transfer.maxVelocityKmS || 0,
        transfer.transferSeconds || 0,
        transfer.velocityProfileKmS || null
      )
    }
  };
}

function invalidRoute(message) {
  return {
    distanceKm: 0,
    durationHours: 0,
    path: [],
    waypoints: [],
    isValid: false,
    error: message
  };
}

/**
 * Plan a direct city-to-city great-circle route or a simplified planet-to-planet
 * Hohmann transfer. Always returns a Promise; callers MUST await it before
 * reading `.isValid`.
 *
 * @param {object} from Route origin.
 * @param {object} to Route destination.
 * @returns {Promise<object>} Route result.
 */
export async function planRoute(from, to, options = {}) {
  if (!from || !to) return invalidRoute('Start and destination are required.');

  const fromType = String(from.type || '').toLowerCase();
  const toType = String(to.type || '').toLowerCase();

  if (fromType === 'city' && toType === 'city') {
    const lat1 = Number(from.lat);
    const lon1 = Number(from.lon);
    const lat2 = Number(to.lat);
    const lon2 = Number(to.lon);

    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
      return invalidRoute('City coordinates must be numeric.');
    }
    if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
      return invalidRoute('Latitude must be between -90 and 90 degrees.');
    }

    const distanceKm = haversineKm(lat1, lon1, lat2, lon2);
    // Konsistent mit Planetenrouten: ein Start-/Ziel identischer Punkt ist
    // keine sinnvolle Route (verhindert "0 km, isValid:true").
    if (distanceKm < 0.001) {
      return invalidRoute('Start and destination are the same point.');
    }
    const path = [{ lat: lat1, lon: normalizeDegrees(lon1) }];

    const pointCount = Math.max(2, Math.min(MAX_CITY_WAYPOINTS, 20));
    const segments = pointCount - 1;
    for (let index = 1; index < segments; index++) {
      const fraction = index / segments;
      const point = greatCirclePoint(lat1, lon1, lat2, lon2, fraction);
      path.push({ lat: point.lat, lon: point.lon });
    }

    path.push({ lat: lat2, lon: normalizeDegrees(lon2) });

    const route = {
      distanceKm,
      durationHours: distanceKm / DEFAULT_TRAVEL_SPEED_KMH,
      path,
      waypoints: [String(from.name || 'Start'), String(to.name || 'Destination')],
      isValid: true,
      type: 'city'
    };
    setActiveRoute(route);
    return route;
  }

  if (fromType === 'planet' && toType === 'planet') {
    const fromPlanet = getPlanet(from.id);
    const toPlanet = getPlanet(to.id);

    if (!fromPlanet || !toPlanet) {
      return invalidRoute('Unknown planet selected.');
    }
    if (fromPlanet.id === toPlanet.id) {
      return invalidRoute('Origin and destination planets must differ.');
    }
    if (fromPlanet.id === 'sun' || toPlanet.id === 'sun') {
      return invalidRoute('Hohmann transfers require planetary orbits.');
    }

    // Earth to Moon (or back) is geocentric: a heliocentric Hohmann transfer
    // would produce a nonsensical multi-month figure for a 384,400 km trip.
    const isEarthMoon = (fromPlanet.id === 'earth' && toPlanet.id === 'moon') ||
      (fromPlanet.id === 'moon' && toPlanet.id === 'earth');
    if (isEarthMoon) {
      // Patched-conic approximation: an Earth-centered Hohmann arc connects a
      // 200 km LEO parking orbit with a 100 km lunar parking orbit. The lunar
      // capture/departure burn uses the Moon's gravity; Earth burns use Earth's.
      const earthMu = 398600.4418;
      const moonMu = 4902.800066;
      const earthParkingRadiusKm = 6378.137 + 200;
      const moonParkingRadiusKm = 1737.4 + 100;
      const transferSemiMajorAxisKm = (earthParkingRadiusKm + MOON_ORBIT_RADIUS_KM) / 2;

      const transferSeconds = Math.PI * Math.sqrt(
        (transferSemiMajorAxisKm ** 3) / earthMu
      );
      const earthPerigeeSpeedKms = Math.sqrt(
        earthMu * (2 / earthParkingRadiusKm - 1 / transferSemiMajorAxisKm)
      );
      const earthCircularSpeedKms = Math.sqrt(earthMu / earthParkingRadiusKm);
      const earthBurnKms = earthPerigeeSpeedKms - earthCircularSpeedKms;

      const transferArrivalSpeedKms = Math.sqrt(
        earthMu * (2 / MOON_ORBIT_RADIUS_KM - 1 / transferSemiMajorAxisKm)
      );
      const moonOrbitalSpeedKms = Math.sqrt(earthMu / MOON_ORBIT_RADIUS_KM);

      // Vector hyperbolic excess at the Moon. In this simplified, coplanar
      // patched-conic model both velocities are tangential at the transfer
      // apogee, so the vector difference reduces to the scalar difference.
      // A full ephemeris/Lambert solution would use the actual Moon velocity.
      const transferArrivalVelocityKms = { x: 0, y: transferArrivalSpeedKms };
      const moonVelocityKms = { x: 0, y: moonOrbitalSpeedKms };
      const moonHyperbolicExcessKms = Math.hypot(
        transferArrivalVelocityKms.x - moonVelocityKms.x,
        transferArrivalVelocityKms.y - moonVelocityKms.y
      );
      const moonPeriapsisSpeedKms = Math.sqrt(
        (moonHyperbolicExcessKms ** 2) + (2 * moonMu / moonParkingRadiusKm)
      );
      const moonCircularSpeedKms = Math.sqrt(moonMu / moonParkingRadiusKm);
      const moonBurnKms = moonPeriapsisSpeedKms - moonCircularSpeedKms;

      const isEarthToMoon = fromPlanet.id === 'earth';
      const maneuvers = isEarthToMoon
        ? [
            { label: 'Trans-lunar injection', deltaVKms: earthBurnKms },
            { label: 'Lunar orbit capture', deltaVKms: moonBurnKms }
          ]
        : [
            { label: 'Lunar departure injection', deltaVKms: moonBurnKms },
            { label: 'Earth orbit capture', deltaVKms: earthBurnKms }
          ];
      const deltaVKms = maneuvers.reduce((total, maneuver) => total + maneuver.deltaVKms, 0);

      const route = {
        distanceKm: MOON_ORBIT_RADIUS_KM,
        durationHours: transferSeconds / 3600,
        deltaVKms,
        transferType: 'hohmann-geocentric',
        transfer: {
          totalDeltaVKmS: deltaVKms,
          type: 'hohmann-geocentric',
          maneuvers,
          transferSeconds,
          relativisticCorrection: calculateRelativisticEffects(
            earthPerigeeSpeedKms,
            transferSeconds
          )
        },
        path: [
          { planetId: fromPlanet.id, x: 0, y: 0, z: 0 },
          { planetId: toPlanet.id, x: MOON_ORBIT_RADIUS_KM, y: 0, z: 0 }
        ],
        waypoints: [fromPlanet.id, toPlanet.id],
        isValid: true,
        type: 'planet'
      };
      setActiveRoute(route);
      return route;
    }

    if (fromPlanet.id === 'moon' || toPlanet.id === 'moon') {
      return invalidRoute('Only Earth to Moon transfers are supported for the Moon.');
    }

    const route = transferRoute(fromPlanet, toPlanet, options);
    route.isValid = true;
    route.type = 'planet';
    setActiveRoute(route);
    return route;
  }

  return invalidRoute('Start and destination must both be cities or both be planets.');
}

export function getActiveRoute() {
  return activeRoute;
}

export function setActiveRoute(route) {
  activeRoute = route || null;
  return activeRoute;
}

export async function findCity(query) {
  return findCityByName(query);
}

/**
 * Ranked, typo-tolerant city search for autocomplete dropdowns.
 * @param {string} query Free-text city name (may contain typos).
 * @param {number} [limit=8] Maximum number of suggestions.
 * @returns {Promise<Array<object>>} City objects ordered best-first.
 */
export async function searchCities(query, limit = 8) {
  return searchCitiesByName(query, limit);
}

/** Ordered planet list for dropdowns (id + display name). */
export const PLANET_OPTIONS = [
  { id: 'sun', name: 'Sun' },
  { id: 'mercury', name: 'Mercury' },
  { id: 'venus', name: 'Venus' },
  { id: 'earth', name: 'Earth' },
  { id: 'moon', name: 'Moon' },
  { id: 'mars', name: 'Mars' },
  { id: 'jupiter', name: 'Jupiter' },
  { id: 'saturn', name: 'Saturn' },
  { id: 'uranus', name: 'Uranus' },
  { id: 'neptune', name: 'Neptune' }
];

export async function loadCityOptions() {
  return loadCities();
}

const Routing = {
  planRoute,
  getActiveRoute,
  setActiveRoute,
  findCity,
  searchCities,
  PLANET_OPTIONS,
  loadCityOptions
};

if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.Routing = Routing;
}

export default Routing;
