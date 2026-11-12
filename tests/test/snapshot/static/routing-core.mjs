/**
 * Routing and Path Planning Engine for Lunar Link Planner.
 */
import { EarthRoute, EARTH_RADIUS_KM, EARTH_MU_KM3_S2, MOON_RADIUS_KM } from './earth-route-core.mjs';

export const AU_KM_VAL = 149_597_870.7;
const MU_SUN_KM3_S2 = 1.32712440018e11;

const DEFAULT_PLANETS = {
  mercury: { name: 'Mercury', semiMajorAxisAu: 0.387, periodDays: 88.0 },
  venus: { name: 'Venus', semiMajorAxisAu: 0.723, periodDays: 224.7 },
  earth: { name: 'Earth', semiMajorAxisAu: 1.0, periodDays: 365.25 },
  mars: { name: 'Mars', semiMajorAxisAu: 1.524, periodDays: 687.0 },
  jupiter: { name: 'Jupiter', semiMajorAxisAu: 5.204, periodDays: 4332.6 },
  saturn: { name: 'Saturn', semiMajorAxisAu: 9.582, periodDays: 10759.2 },
  uranus: { name: 'Uranus', semiMajorAxisAu: 19.201, periodDays: 30685.4 },
  neptune: { name: 'Neptune', semiMajorAxisAu: 30.047, periodDays: 60189.0 }
};

function getPlanetData(bodyId) {
  const id = String(bodyId).toLowerCase();
  if (typeof window !== 'undefined' && window.LLP) {
    if (window.LLP.Planets && typeof window.LLP.Planets.get === 'function') {
      try { const p = window.LLP.Planets.get(id); if (p) return p; } catch (e) {}
    }
    if (window.LLP.DataSources && window.LLP.DataSources.PLANET_DATA) {
      const p = window.LLP.DataSources.PLANET_DATA[id];
      if (p) return p;
    }
  }
  return DEFAULT_PLANETS[id] || { name: bodyId, semiMajorAxisAu: 1.0, periodDays: 365.25 };
}

export function getHohmannTransfer(aAu1, aAu2) {
  const a1 = aAu1 * AU_KM_VAL;
  const a2 = aAu2 * AU_KM_VAL;
  const a_t = (a1 + a2) / 2;
  const mu = MU_SUN_KM3_S2;

  const v1 = Math.sqrt(mu / a1);
  const vp = Math.sqrt(mu * (2 / a1 - 1 / a_t));
  const dv1 = Math.abs(vp - v1);

  const v_ap = Math.sqrt(mu * (2 / a2 - 1 / a_t));
  const v2 = Math.sqrt(mu / a2);
  const dv2 = Math.abs(v2 - v_ap);

  const t_sec = Math.PI * Math.sqrt((a_t ** 3) / mu);
  const transferTimeDays = t_sec / 86400;
  const targetPeriodDays = 2 * Math.PI * Math.sqrt((a2 ** 3) / mu) / 86400;
  const phaseAngleDeg = 180 - 360 * (transferTimeDays / targetPeriodDays);

  return { deltaV1: dv1, deltaV2: dv2, transferTimeDays, phaseAngleDeg };
}

export function getPorkchop(fromBodyId, toBodyId, year = 2026) {
  const fromP = getPlanetData(fromBodyId);
  const toP = getPlanetData(toBodyId);
  const baseHohmann = getHohmannTransfer(fromP.semiMajorAxisAu, toP.semiMajorAxisAu);
  const results = [];
  const numDeps = 100, numArrs = 100, nominalT = baseHohmann.transferTimeDays;

  for (let i = 0; i < numDeps; i++) {
    const departDay = Math.round((i / (numDeps - 1)) * 365);
    for (let j = 0; j < numArrs; j++) {
      const arriveDay = departDay + Math.max(10, Math.round((j / (numArrs - 1)) * 730));
      const tofDays = arriveDay - departDay;
      if (tofDays <= 0) continue;
      const tofDiff = Math.abs(tofDays - nominalT);
      const penalty = tofDiff * 0.01;
      const dv1 = baseHohmann.deltaV1 + penalty * 0.5;
      const dv2 = baseHohmann.deltaV2 + penalty * 0.5;
      const deltaV = Math.sqrt(dv1 * dv1 + dv2 * dv2);
      results.push({ departDay, arriveDay, deltaV });
    }
  }
  results.sort((a, b) => a.deltaV - b.deltaV);
  return results.slice(0, 20);
}

export function cityRoute(fromCityId, toCityId) {
  const res = EarthRoute.dijkstra(fromCityId, toCityId);
  if (!res) {
    return { segments: [], totalKm: 0, deltaV: 0, eta: 0, notes: [`No route found between ${fromCityId} and ${toCityId}`] };
  }
  const segments = [];
  for (let i = 0; i < res.path.length - 1; i++) {
    segments.push({
      from: res.path[i],
      to: res.path[i + 1],
      type: 'city',
      km: res.km / (res.path.length - 1),
      days: (res.km / (res.path.length - 1)) / 800 / 24
    });
  }
  return {
    segments,
    totalKm: res.km,
    deltaV: 0.5,
    eta: res.km / 800 / 24,
    notes: [`Earth city route via Dijkstra nodes: ${res.path.join(' -> ')}`]
  };
}

export function moonRoute(from, to) {
  const lat1 = from.lat, lon1 = from.lon;
  const lat2 = to.lat, lon2 = to.lon;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  let km = MOON_RADIUS_KM * c;

  let multiplier = 1.0;
  if (typeof window !== 'undefined' && window.LLP && window.LLP.MoonSurface && typeof window.LLP.MoonSurface.craterAt === 'function') {
    try {
      const crater = window.LLP.MoonSurface.craterAt(lat2, lon2);
      if (crater && crater.diameterKm && crater.diameterKm > 30) multiplier = 1.5;
    } catch (e) {}
  } else {
    if (globalThis.MoonSurface && typeof globalThis.MoonSurface.craterAt === 'function') {
      try {
        const crater = globalThis.MoonSurface.craterAt(lat2, lon2);
        if (crater && crater.diameterKm && crater.diameterKm > 30) multiplier = 1.5;
      } catch (e) {}
    }
  }

  const effectiveKm = km * multiplier;
  return {
    segments: [{ from: { lat: lat1, lon: lon1 }, to: { lat: lat2, lon: lon2 }, type: 'surface', km: effectiveKm, days: effectiveKm / 500 / 24 }],
    totalKm: effectiveKm,
    deltaV: 0.1,
    eta: effectiveKm / 500 / 24,
    notes: multiplier > 1.0 ? ['Terrain multiplier applied due to crater > 30km'] : []
  };
}

export function planInterplanetary(fromBodyId, toBodyId, launchEpochMs = Date.now()) {
  const fromP = getPlanetData(fromBodyId);
  const toP = getPlanetData(toBodyId);
  const hohmann = getHohmannTransfer(fromP.semiMajorAxisAu, toP.semiMajorAxisAu);
  const segments = [
    { from: fromBodyId, to: 'orbit', type: 'launch', km: 200, days: 0.1 },
    { from: fromBodyId, to: toBodyId, type: 'transfer', km: hohmann.transferTimeDays * 2e6, days: hohmann.transferTimeDays },
    { from: 'orbit', to: toBodyId, type: 'insertion', km: 500, days: 0.2 }
  ];
  const totalKm = segments.reduce((acc, s) => acc + s.km, 0);
  const totalDays = segments.reduce((acc, s) => acc + s.days, 0);
  return {
    segments,
    totalKm,
    deltaV: hohmann.deltaV1 + hohmann.deltaV2,
    eta: totalDays,
    notes: [`Interplanetary transfer from ${fromP.name} to ${toP.name} via Hohmann approximation.`]
  };
}

export function buildRoute(from, to) {
  const fromBody = from.bodyId || 'earth';
  const toBody = to.bodyId || 'earth';
  if (fromBody.toLowerCase() === toBody.toLowerCase()) {
    if (fromBody.toLowerCase() === 'earth') {
      const city1 = from.cityId || (from.lat !== undefined ? EarthRoute.nearestCity(from.lat, from.lon).id : 'ksc');
      const city2 = to.cityId || (to.lat !== undefined ? EarthRoute.nearestCity(to.lat, to.lon).id : 'kourou');
      if (city1 === city2) return { segments: [], totalKm: 0, deltaV: 0, eta: 0, notes: ['Same location round-trip'] };
      return cityRoute(city1, city2);
    } else if (fromBody.toLowerCase() === 'moon') {
      const pt1 = { lat: from.lat || 0, lon: from.lon || 0 };
      const pt2 = { lat: to.lat || 0, lon: to.lon || 0 };
      if (pt1.lat === pt2.lat && pt1.lon === pt2.lon) return { segments: [], totalKm: 0, deltaV: 0, eta: 0, notes: ['Same lunar location'] };
      return moonRoute(pt1, pt2);
    }
  }
  return planInterplanetary(fromBody, toBody);
}

export const Routing = {
  buildRoute,
  planInterplanetary,
  getHohmannTransfer,
  getPorkchop,
  cityRoute,
  moonRoute
};

if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.Routing = Routing;
}
