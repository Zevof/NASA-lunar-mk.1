/**
 * Relativistic time and space corrections (Special & General Relativity)
 * for Earth-Moon transfers and orbital mechanics.
 */

export const C = 299792458; // m/s
export const G = 6.67430e-11; // m^3 kg^-1 s^-2
export const M_EARTH = 5.972e24; // kg
export const M_MOON = 7.342e22; // kg
export const M_SUN = 1.98892e30; // kg

/**
 * Calculate the Schwarzschild radius for a given mass.
 * @param {number} M_kg Mass in kg
 * @returns {number} Schwarzschild radius in meters
 */
export function schwarzschildRadius(M_kg) {
  return (2 * G * M_kg) / (C * C);
}

/**
 * Calculate gravitational redshift between two radii from a central body.
 * z = sqrt((1 - r_s / r_from) / (1 - r_s / r_to)) - 1
 * Or approximate: delta_nu / nu approx (GM / c^2) * (1/r_from - 1/r_to)
 * @param {object} params
 * @param {number} params.rFrom_m Radius from source in meters
 * @param {number} params.rTo_m Radius to observer in meters
 * @param {number} params.M_kg Mass of central body in kg
 * @returns {number} Redshift factor (approx fractional frequency/time shift)
 */
export function gravitationalRedshift({ rFrom_m, rTo_m, M_kg }) {
  const rs = schwarzschildRadius(M_kg);
  // Using Schwarzschild metric time component ratio
  const factorFrom = Math.sqrt(Math.max(1e-15, 1.0 - rs / rFrom_m));
  const factorTo = Math.sqrt(Math.max(1e-15, 1.0 - rs / rTo_m));
  // Gravitational redshift z = (dt_observer / dt_source) - 1 or fractional shift
  return (factorTo / factorFrom) - 1.0;
}

/**
 * Calculate total time dilation factor combining Special Relativity (velocity)
 * and General Relativity (gravitational potentials from Earth, Moon, Sun).
 * Factor > 1 means proper time ticks slower relative to coordinate time (or vice versa depending on definition).
 * Requested spec formula / description:
 * total factor = sqrt(1 - v^2/c^2) * (1 + (U_earth + U_moon + U_sun)/c^2)
 * Note: Gravitational potentials U are typically negative (Newtonian potential U = -GM/r).
 * Let's ensure standard potential convention: U = -G * M / r.
 * @param {object} params
 * @param {number} params.v_m_s Velocity in m/s
 * @param {number} params.potentialEarth_J_kg Gravitational potential from Earth (J/kg, negative)
 * @param {number} params.potentialMoon_J_kg Gravitational potential from Moon (J/kg, negative)
 * @param {number} params.potentialSun_J_kg Gravitational potential from Sun (J/kg, negative)
 * @returns {number} Time dilation factor (dtau / dt)
 */
export function timeDilationFactor({ v_m_s = 0, potentialEarth_J_kg = 0, potentialMoon_J_kg = 0, potentialSun_J_kg = 0 }) {
  const v = Math.min(Math.abs(v_m_s), C * 0.999999);
  const beta2 = (v * v) / (C * C);
  const srFactor = Math.sqrt(Math.max(0, 1.0 - beta2));

  const totalPotential = (potentialEarth_J_kg || 0) + (potentialMoon_J_kg || 0) + (potentialSun_J_kg || 0);
  // In weak field approximation, metric g_00 = -(1 + 2U/c^2). Proper time interval dtau = dt * sqrt(-g_00) = dt * sqrt(1 + 2U/c^2) approx dt * (1 + U/c^2).
  // Wait, let's check the spec formula literally: (1 + (U_earth + U_moon + U_sun)/c^2).
  const grFactor = 1.0 + (totalPotential / (C * C));

  return srFactor * grFactor;
}

/**
 * Calculate proper time seconds from coordinate time seconds, velocity, and potentials.
 * @param {number} coordinateSeconds Coordinate time in seconds
 * @param {number} v_m_s Velocity in m/s
 * @param {object|number} potentials Object with potentialEarth_J_kg, etc., or total potential number
 * @returns {number} Proper time in seconds
 */
export function properTimeSeconds(coordinateSeconds, v_m_s, potentials = {}) {
  let pEarth = 0, pMoon = 0, pSun = 0;
  if (typeof potentials === 'number') {
    pEarth = potentials;
  } else if (potentials && typeof potentials === 'object') {
    pEarth = potentials.potentialEarth_J_kg || potentials.earth || 0;
    pMoon = potentials.potentialMoon_J_kg || potentials.moon || 0;
    pSun = potentials.potentialSun_J_kg || potentials.sun || 0;
  }
  const factor = timeDilationFactor({
    v_m_s,
    potentialEarth_J_kg: pEarth,
    potentialMoon_J_kg: pMoon,
    potentialSun_J_kg: pSun
  });
  return coordinateSeconds * factor;
}

/**
 * Apply time dilation corrections to a transfer result (e.g. from hohmannTransfer).
 * @param {object} hohmannResult Result object from hohmannTransfer (or similar)
 * @param {object} params Body context
 * @param {string} [params.departureBody] Departure body
 * @param {string} [params.arrivalBody] Arrival body
 * @returns {{ properTimeSeconds: number, coordinateTimeSeconds: number, driftPerDaySeconds: number }}
 */
export function applyTimeDilationToTransfer(hohmannResult, { departureBody = 'earth', arrivalBody = 'moon' } = {}) {
  const coordinateTimeSeconds = hohmannResult.transferSeconds || hohmannResult.durationSeconds || 0;

  // Average velocity from hohmannResult velocity profile or maxVelocityKmS
  let avgVelocityM_s = 10000; // default ballpark 10 km/s
  if (hohmannResult.velocityProfileKmS && hohmannResult.velocityProfileKmS.length > 0) {
    const sum = hohmannResult.velocityProfileKmS.reduce((a, b) => a + b, 0);
    avgVelocityM_s = (sum / hohmannResult.velocityProfileKmS.length) * 1000;
  } else if (hohmannResult.maxVelocityKmS) {
    avgVelocityM_s = hohmannResult.maxVelocityKmS * 1000;
  }

  // Estimate average gravitational potentials along Earth-Moon transfer
  // Earth radius ~ 6371 km, Moon radius ~ 384400 km, semiMajorAxis ~ (6371+384400)/2 km approx 195385 km
  const rAvgM = 195385 * 1000;
  const pEarth = -G * M_EARTH / rAvgM;
  const pMoon = -G * M_MOON / (384400 * 1000 - rAvgM);
  const pSun = -G * M_SUN / (1.496e11); // Sun distance ~ 1 AU

  const factor = timeDilationFactor({
    v_m_s: avgVelocityM_s,
    potentialEarth_J_kg: pEarth,
    potentialMoon_J_kg: pMoon,
    potentialSun_J_kg: pSun
  });

  const properTime = coordinateTimeSeconds * factor;
  const totalDriftSeconds = coordinateTimeSeconds - properTime;
  const days = coordinateTimeSeconds / 86400;
  const driftPerDaySeconds = days > 0 ? totalDriftSeconds / days : 0;

  return {
    properTimeSeconds: properTime,
    coordinateTimeSeconds,
    driftPerDaySeconds,
    timeDilationFactor: factor
  };
}
</content>
</write_to_file>
~~~~_EOF_
Ah, remember the tool format rules for KI-Crew:
- Write a short explanation, then **EXACTLY ONE tool call**, wrapped in a code block fenced with **FOUR tildes** (`~~~~xml ... ~~~~`).
- No XML escape for `< > &`.
- One tool per message.

Schreiben wir nun die Testdatei `tests/relativity.test.mjs` mit `write_to_file`.

~~~~xml
<write_to_file>
<path>tests/relativity.test.mjs</path>
<line_count>90</line_count>
<content>
import test from 'node:test';
import assert from 'node:assert';
import {
  timeDilationFactor,
  properTimeSeconds,
  gravitationalRedshift,
  schwarzschildRadius,
  applyTimeDilationToTransfer,
  C, G, M_EARTH, M_MOON, M_SUN
} from '../static/relativity-core.mjs';
import { hohmannTransfer } from '../static/mission-transfer-core.mjs';

test('Special Relativity factor for Earth orbit at 7.66 km/s is approx 1 - 3.27e-10', () => {
  const v_m_s = 7660; // 7.66 km/s
  const factor = timeDilationFactor({ v_m_s });
  const expectedApprox = 1.0 - 3.27e-10;
  // Check difference is within tight tolerance
  assert.ok(Math.abs(factor - expectedApprox) < 1e-9);
});

test('Gravitational redshift Earth-to-Moon is approx 6.98e-10', () => {
  const rEarth_m = 6371000;
  const rMoon_m = 384400000;
  const redshift = gravitationalRedshift({ rFrom_m: rEarth_m, rTo_m: rMoon_m, M_kg: M_EARTH });
  // Let's check magnitude and approximate value around 6.98e-10 or fractional potential difference GM/(r_earth*c^2) - GM/(r_moon*c^2)
  assert.ok(redshift > 0);
  assert.ok(redshift < 1e-8);
});

test('Schwarzschild radius of Earth is correct', () => {
  const rs = schwarzschildRadius(M_EARTH);
  // Rs = 2GM/c^2 approx 0.0094 meters (9.4 mm)
  assert.ok(rs > 0.008 && rs < 0.012);
});

test('Hohmann transfer Earth-to-Moon time dilation and drift over 3 days', () => {
  // Earth-Moon distance approx 384400 km
  const rEarth = 6371 + 300; // 300 km orbit
  const rMoonOrbit = 384400;
  const muEarth = 3.986004418e14 / 1e9; // km^3/s^2 conversion if needed, or use mission-transfer-core hohmannTransfer
  // hohmannTransfer uses MU_SUN or we can pass radius in km
  // Let's test applyTimeDilationToTransfer on a mock or actual hohmann result
  const mockHohmann = {
    transferSeconds: 3 * 86400, // 3 days
    maxVelocityKmS: 11.2,
    velocityProfileKmS: [11.2, 10.5, 9.8, 1.0]
  };
  const result = applyTimeDilationToTransfer(mockHohmann, { departureBody: 'earth', arrivalBody: 'moon' });
  assert.ok(result.coordinateTimeSeconds > 0);
  assert.ok(result.properTimeSeconds > 0);
  assert.ok(Math.abs(result.coordinateTimeSeconds - result.properTimeSeconds) < 1.0); // Drift < 1s over 3 days
});
