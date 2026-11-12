/**
 * Mission transfer planning: Lambert arcs, Hohmann transfers,
 * bi-elliptic transfers and patched-conic gravity assists.
 *
 * This is a planning/visualisation model. It does not replace a full
 * n-body mission design, finite-burn optimiser or operational navigation
 * system. All distances are km; velocities are km/s; gravitational
 * parameters are km^3/s^2.
 */
import { propagateTwoBody } from './earth-route-core.mjs';
import { planetPositionKm } from './solar-system-core.mjs';

export const MU_SUN_KM3_S2 = 1.32712440018e11;
export const AU_KM = 149597870.7;
export const SPEED_OF_LIGHT_KM_S = 299792.458;

/**
 * Calculate Einstein special relativity effects (Lorentz factor and time dilation).
 * @param {number} velocityKmS Spacecraft velocity in km/s (or array of velocities for integration).
 * @param {number} durationSeconds Classical time of flight in seconds.
 * @param {Array<number>} [velocityProfileKmS] Optional array of velocities along trajectory for accurate integration.
 * @returns {{velocityKmS: number, gamma: number, deltaTSeconds: number, deltaTMs: number}}
 */
export function calculateRelativisticEffects(velocityKmS, durationSeconds, velocityProfileKmS = null) {
  const c = SPEED_OF_LIGHT_KM_S;

  if (velocityProfileKmS && velocityProfileKmS.length > 1) {
    // Integrate time dilation over trajectory using trapezoidal rule
    const dt = durationSeconds / (velocityProfileKmS.length - 1);
    let totalDeltaT = 0;
    let maxGamma = 1;

    for (let i = 0; i < velocityProfileKmS.length; i++) {
      const v = Math.min(Math.abs(velocityProfileKmS[i]), c * 0.999999);
      const beta2 = (v * v) / (c * c);
      const gamma = 1.0 / Math.sqrt(Math.max(1e-15, 1.0 - beta2));
      const instantDeltaT = dt * (1.0 - (1.0 / gamma));

      // Trapezoidal weighting
      const weight = (i === 0 || i === velocityProfileKmS.length - 1) ? 0.5 : 1.0;
      totalDeltaT += instantDeltaT * weight;
      maxGamma = Math.max(maxGamma, gamma);
    }

    return {
      velocityKmS: velocityKmS,
      gamma: maxGamma,
      deltaTSeconds: totalDeltaT,
      deltaTMs: totalDeltaT * 1000
    };
  }

  // Fallback: constant velocity approximation
  const v = Math.min(Math.abs(velocityKmS), c * 0.999999);
  const beta2 = (v * v) / (c * c);
  const gamma = 1.0 / Math.sqrt(Math.max(1e-15, 1.0 - beta2));
  const deltaTSeconds = durationSeconds * (1.0 - (1.0 / gamma));
  return {
    velocityKmS: v,
    gamma,
    deltaTSeconds,
    deltaTMs: deltaTSeconds * 1000
  };
}

const add = (a, b) => a.map((value, index) => value + b[index]);
const sub = (a, b) => a.map((value, index) => value - b[index]);
const mul = (a, scale) => a.map((value) => value * scale);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [
  a.at(1) * b.at(2) - a.at(2) * b.at(1),
  a.at(2) * b.at(0) - a.at(0) * b.at(2),
  a.at(0) * b.at(1) - a.at(1) * b.at(0)
];
const mag = (vector) => Math.hypot(vector.at(0), vector.at(1), vector.at(2));
const unit = (vector) => {
  const length = mag(vector);
  return length > 0 ? vector.map((value) => value / length) : [1, 0, 0];
};
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function stumpff(z) {
  if (Math.abs(z) < 1e-6) {
    return { C: 0.5 - z / 24 + z * z / 720, S: 1 / 6 - z / 120 + z * z / 5040 };
  }
  if (z > 0) {
    const root = Math.sqrt(z);
    return { C: (1 - Math.cos(root)) / z, S: (root - Math.sin(root)) / (root * root * root) };
  }
  const root = Math.sqrt(-z);
  if (root > 150) throw new Error('Lambert geometry is outside the numerical range.');
  return {
    C: (Math.cosh(root) - 1) / -z,
    S: (Math.sinh(root) - root) / (root * root * root)
  };
}

function sampleTrajectory(positionKm, velocityKmS, seconds, mu, samples = 180) {
  const points = new Array();
  const count = Math.max(2, samples);
  for (let index = 0; index <= count; index++) {
    points.push(propagateTwoBody(positionKm, velocityKmS, (seconds * index) / count, mu));
  }
  return points;
}

function pathLengthKm(points) {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += mag(sub(points[index], points[index - 1]));
  }
  return total;
}

/**
 * Universal-variable Lambert solution.
 *
 * @param {Array<number>} departureKm Heliocentric departure position.
 * @param {Array<number>} arrivalKm Heliocentric arrival position.
 * @param {number} seconds Positive time of flight.
 * @param {number} [mu] Gravitational parameter.
 * @param {boolean} [prograde] Motion direction about the +Z axis.
 * @returns {{v1:Array<number>,v2:Array<number>,transferSeconds:number,pathKm:Array<Array<number>>}}
 */
export function lambertTransfer(
  departureKm,
  arrivalKm,
  seconds,
  mu = MU_SUN_KM3_S2,
  prograde = true
) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Lambert transfer time must be positive.');
  }
  const r1 = mag(departureKm);
  const r2 = mag(arrivalKm);
  if (!(r1 > 0) || !(r2 > 0)) {
    throw new Error('Lambert endpoints must have non-zero radius.');
  }

  const cosine = clamp(dot(departureKm, arrivalKm) / (r1 * r2), -1, 1);
  const normalZ = cross(departureKm, arrivalKm)[2];
  const direction = prograde ? (normalZ >= 0 ? 1 : -1) : (normalZ >= 0 ? -1 : 1);
  const sine = direction * Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const denominator = 1 - cosine;
  if (denominator <= 1e-12) {
    throw new Error('Lambert transfer geometry is nearly 180 degrees; choose another epoch or duration.');
  }
  const A = sine * Math.sqrt((r1 * r2) / denominator);
  if (!Number.isFinite(A) || Math.abs(A) < 1e-8) {
    throw new Error('Lambert transfer geometry is singular.');
  }

  const timeFor = (z) => {
    const { C, S } = stumpff(z);
    if (!(C > 1e-12)) return null;
    const y = r1 + r2 + (A * (z * S - 1)) / Math.sqrt(C);
    if (!(y > 0)) return null;
    const time = ((y / C) ** 1.5 * S + A * Math.sqrt(y)) / Math.sqrt(mu);
    return Number.isFinite(time) ? { time, y } : null;
  };

  let lower = null;
  let upper = null;
  const minimumZ = -4 * Math.PI * Math.PI;
  const maximumZ = 4 * Math.PI * Math.PI;
  const intervals = 1600;
  let previous = null;
  for (let index = 0; index <= intervals; index++) {
    const z = minimumZ + ((maximumZ - minimumZ) * index) / intervals;
    const value = timeFor(z);
    if (!value) {
      previous = null;
      continue;
    }
    if (previous && ((previous.time < seconds && value.time > seconds) ||
        (previous.time > seconds && value.time < seconds))) {
      lower = { z: previous.z, ...previous.value };
      upper = { z, ...value };
      break;
    }
    previous = { z, ...value };
  }
  if (!lower || !upper) {
    throw new Error('No Lambert solution for this departure, arrival and flight time.');
  }

  let z = 0;
  let solution = null;
  for (let iteration = 0; iteration < 100; iteration++) {
    z = (lower.z + upper.z) / 2;
    const value = timeFor(z);
    if (!value) {
      lower = { z, ...lower };
      continue;
    }
    solution = { z, ...value };
    if (value.time > seconds) upper = { z, ...value };
    else lower = { z, ...value };
  }
  if (!solution) throw new Error('Lambert iteration did not converge.');

  const f = 1 - solution.y / r1;
  const g = A * Math.sqrt(solution.y / mu);
  const gDot = 1 - solution.y / r2;
  if (Math.abs(g) < 1e-9) throw new Error('Lambert transfer is singular.');

  const departureVelocity = mul(sub(arrivalKm, mul(departureKm, f)), 1 / g);
  const arrivalVelocity = mul(sub(mul(arrivalKm, gDot), departureKm), 1 / g);
  const pathKm = sampleTrajectory(departureKm, departureVelocity, seconds, mu, 180);

  // Calculate semi-major axis from departure conditions using vis-viva
  const v1Mag = mag(departureVelocity);
  const semiMajorAxisKm = 1 / (2 / r1 - (v1Mag * v1Mag) / mu);

  // Build velocity profile using vis-viva equation
  const velocityProfileKmS = pathKm.map(point => {
    const r = mag(point);
    return Math.sqrt(Math.max(0, mu * (2 / r - 1 / semiMajorAxisKm)));
  });

  return {
    v1: departureVelocity,
    v2: arrivalVelocity,
    transferSeconds: seconds,
    maxVelocityKmS: Math.max(...velocityProfileKmS),
    velocityProfileKmS,
    pathKm,
    pathLengthKm: pathLengthKm(pathKm)
  };
}

function conicHalfPath(radiusStartKm, radiusEndKm, thetaStart, thetaEnd, samples = 120) {
  const semiMajor = (radiusStartKm + radiusEndKm) / 2;
  const eccentricity = Math.abs(radiusEndKm - radiusStartKm) / (radiusStartKm + radiusEndKm);
  const semiLatus = semiMajor * (1 - eccentricity * eccentricity);
  const points = new Array();
  const count = Math.max(2, samples);
  for (let index = 0; index <= count; index++) {
    const theta = thetaStart + ((thetaEnd - thetaStart) * index) / count;
    const radius = semiLatus / (1 + eccentricity * Math.cos(theta));
    points.push([radius * Math.cos(theta), radius * Math.sin(theta), 0]);
  }
  return points;
}

/**
 * Ideal coplanar Hohmann transfer between circular heliocentric orbits.
 */
export function hohmannTransfer(radiusStartKm, radiusEndKm, mu = MU_SUN_KM3_S2) {
  if (!(radiusStartKm > 0) || !(radiusEndKm > 0)) {
    throw new Error('Hohmann orbit radii must be positive.');
  }
  if (Math.abs(radiusEndKm - radiusStartKm) < 1) {
    throw new Error('Hohmann transfer needs two different circular orbit radii.');
  }

  const semiMajor = (radiusStartKm + radiusEndKm) / 2;
  const circularStart = Math.sqrt(mu / radiusStartKm);
  const circularEnd = Math.sqrt(mu / radiusEndKm);
  const transferStart = Math.sqrt(mu * (2 / radiusStartKm - 1 / semiMajor));
  const transferEnd = Math.sqrt(mu * (2 / radiusEndKm - 1 / semiMajor));
  const deltaVStart = Math.abs(transferStart - circularStart);
  const deltaVEnd = Math.abs(circularEnd - transferEnd);
  const transferSeconds = Math.PI * Math.sqrt((semiMajor ** 3) / mu);
  const pathKm = radiusEndKm > radiusStartKm
    ? conicHalfPath(radiusStartKm, radiusEndKm, 0, Math.PI)
    : conicHalfPath(radiusStartKm, radiusEndKm, Math.PI, 2 * Math.PI);

  // Build velocity profile using vis-viva equation
  const velocityProfileKmS = pathKm.map(point => {
    const r = mag(point);
    return Math.sqrt(Math.max(0, mu * (2 / r - 1 / semiMajor)));
  });

  return {
    type: 'hohmann',
    transferSeconds,
    semiMajorAxisKm: semiMajor,
    deltaVKmS: [deltaVStart, deltaVEnd],
    totalDeltaVKmS: deltaVStart + deltaVEnd,
    maxVelocityKmS: Math.max(...velocityProfileKmS),
    velocityProfileKmS,
    pathKm,
    pathLengthKm: pathLengthKm(pathKm)
  };
}

/**
 * Ideal coplanar bi-elliptic transfer. The intermediate apoapsis must lie
 * beyond both circular orbit radii.
 */
export function biEllipticTransfer(
  radiusStartKm,
  radiusEndKm,
  intermediateApoapsisKm,
  mu = MU_SUN_KM3_S2
) {
  if (!(radiusStartKm > 0) || !(radiusEndKm > 0) || !(intermediateApoapsisKm > 0)) {
    throw new Error('Bi-elliptic radii must be positive.');
  }
  const maximum = Math.max(radiusStartKm, radiusEndKm);
  if (intermediateApoapsisKm <= maximum * 1.000001) {
    throw new Error('Bi-elliptic apoapsis must exceed both circular orbit radii.');
  }

  const firstSemiMajor = (radiusStartKm + intermediateApoapsisKm) / 2;
  const secondSemiMajor = (intermediateApoapsisKm + radiusEndKm) / 2;
  const circularStart = Math.sqrt(mu / radiusStartKm);
  const circularEnd = Math.sqrt(mu / radiusEndKm);
  const firstPeriapsis = Math.sqrt(mu * (2 / radiusStartKm - 1 / firstSemiMajor));
  const firstApoapsis = Math.sqrt(mu * (2 / intermediateApoapsisKm - 1 / firstSemiMajor));
  const secondApoapsis = Math.sqrt(mu * (2 / intermediateApoapsisKm - 1 / secondSemiMajor));
  const secondPeriapsis = Math.sqrt(mu * (2 / radiusEndKm - 1 / secondSemiMajor));
  const deltaVStart = Math.abs(firstPeriapsis - circularStart);
  const deltaVIntermediate = Math.abs(secondApoapsis - firstApoapsis);
  const deltaVEnd = Math.abs(circularEnd - secondPeriapsis);
  const transferSeconds = Math.PI * (
    Math.sqrt((firstSemiMajor ** 3) / mu) +
    Math.sqrt((secondSemiMajor ** 3) / mu)
  );
  const pathKm = [
    ...conicHalfPath(radiusStartKm, intermediateApoapsisKm, 0, Math.PI),
    ...conicHalfPath(intermediateApoapsisKm, radiusEndKm, Math.PI, 2 * Math.PI).slice(1)
  ];

  // Build velocity profile using vis-viva equation for both elliptical segments
  const firstSegmentLength = conicHalfPath(radiusStartKm, intermediateApoapsisKm, 0, Math.PI).length;
  const velocityProfileKmS = pathKm.map((point, index) => {
    const r = mag(point);
    // First segment uses firstSemiMajor, second segment uses secondSemiMajor
    const semiMajor = index < firstSegmentLength ? firstSemiMajor : secondSemiMajor;
    return Math.sqrt(Math.max(0, mu * (2 / r - 1 / semiMajor)));
  });

  return {
    type: 'bielliptic',
    transferSeconds,
    intermediateApoapsisKm,
    deltaVKmS: [deltaVStart, deltaVIntermediate, deltaVEnd],
    totalDeltaVKmS: deltaVStart + deltaVIntermediate + deltaVEnd,
    maxVelocityKmS: Math.max(...velocityProfileKmS),
    velocityProfileKmS,
    pathKm,
    pathLengthKm: pathLengthKm(pathKm)
  };
}

function planetVelocityKmS(planetId, epoch) {
  const stepSeconds = 3600;
  const before = planetPositionKm(planetId, new Date(Date.parse(epoch) - stepSeconds * 1000).toISOString());
  const after = planetPositionKm(planetId, new Date(Date.parse(epoch) + stepSeconds * 1000).toISOString());
  return mul(sub(after, before), 1 / (2 * stepSeconds));
}

function rotateTowards(vector, target, angle) {
  const a = unit(vector);
  const b = unit(target);
  const axis = unit(cross(a, b));
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotated = add(
    mul(a, cosine),
    add(mul(cross(axis, a), sine), mul(axis, dot(axis, a) * (1 - cosine)))
  );
  return mul(rotated, mag(vector));
}

function missionDeltaV(positionKm, velocityKmS, mu = MU_SUN_KM3_S2) {
  const radius = mag(positionKm);
  const speed = mag(velocityKmS);
  const radial = dot(unit(positionKm), velocityKmS);
  const tangential = Math.sqrt(Math.max(0, speed * speed - radial * radial));
  const circular = Math.sqrt(mu / radius);
  return Math.hypot(radial, tangential - circular);
}

const FLYBY_BODIES = {
  venus: { radiusKm: 6051.8, muKm3S2: 324858.592 },
  earth: { radiusKm: 6378.137, muKm3S2: 398600.4418 },
  mars: { radiusKm: 3396.2, muKm3S2: 42828.375 },
  jupiter: { radiusKm: 71492, muKm3S2: 1.26686534e8 },
  saturn: { radiusKm: 60268, muKm3S2: 3.7931187e7 },
  uranus: { radiusKm: 25559, muKm3S2: 5.793939e6 },
  neptune: { radiusKm: 24764, muKm3S2: 6.836529e6 }
};

/**
 * Patched-conic Lambert + gravity-assist plan.
 *
 * The model uses two Lambert legs and compares the required incoming/outgoing
 * hyperbolic excess velocity at the flyby body. A purely ballistic assist is
 * reported when the required turn is below the periapsis-limited maximum;
 * otherwise the residual is expressed as a flyby manoeuvre.
 */
export function swingByTransfer(options) {
  const {
    originId,
    destinationId,
    flybyId,
    departureEpoch,
    arrivalEpoch,
    flybyFraction = 0.5
  } = options;
  const body = FLYBY_BODIES[flybyId];
  if (!body) throw new Error('Selected body cannot provide a usable flyby.');
  if (flybyId === originId || flybyId === destinationId) {
    throw new Error('Flyby body must differ from origin and destination.');
  }
  const fraction = clamp(Number(flybyFraction) || 0.5, 0.05, 0.95);
  const departureTime = Date.parse(departureEpoch);
  const arrivalTime = Date.parse(arrivalEpoch);
  if (!Number.isFinite(departureTime) || !Number.isFinite(arrivalTime) || arrivalTime <= departureTime) {
    throw new Error('Arrival must be later than departure.');
  }
  const totalSeconds = (arrivalTime - departureTime) / 1000;
  const encounterTime = departureTime + totalSeconds * fraction * 1000;
  const encounterEpoch = new Date(encounterTime).toISOString();

  const departurePosition = planetPositionKm(originId, departureEpoch);
  const flybyPosition = planetPositionKm(flybyId, encounterEpoch);
  const arrivalPosition = planetPositionKm(destinationId, arrivalEpoch);
  const firstSeconds = totalSeconds * fraction;
  const secondSeconds = totalSeconds * (1 - fraction);

  const inbound = lambertTransfer(departurePosition, flybyPosition, firstSeconds, MU_SUN_KM3_S2, true);
  const outbound = lambertTransfer(flybyPosition, arrivalPosition, secondSeconds, MU_SUN_KM3_S2, true);
  const planetVelocity = planetVelocityKmS(flybyId, encounterEpoch);
  const incomingExcess = sub(inbound.v2, planetVelocity);
  const requiredExcess = sub(outbound.v1, planetVelocity);

  const incomingSpeed = mag(incomingExcess);
  const requiredSpeed = mag(requiredExcess);
  const turnAngle = Math.acos(clamp(dot(unit(incomingExcess), unit(requiredExcess)), -1, 1));
  const periapsisKm = body.radiusKm + 300;
  const maximumTurn = 2 * Math.asin(
    clamp(1 / (1 + (periapsisKm * incomingSpeed * incomingSpeed) / body.muKm3S2), 0, 1)
  );
  const ballistic = turnAngle <= maximumTurn + 1e-12;
  const appliedTurn = ballistic ? turnAngle : maximumTurn;
  const rotatedExcess = rotateTowards(incomingExcess, requiredExcess, appliedTurn);
  const flybyDeltaV = mag(sub(requiredExcess, rotatedExcess));
  const outgoingHelioVelocity = add(planetVelocity, requiredExcess);
  const pathKm = [
    ...inbound.pathKm,
    ...sampleTrajectory(flybyPosition, outgoingHelioVelocity, secondSeconds, MU_SUN_KM3_S2, 180).slice(1)
  ];

  // Build velocity profile for relativistic integration
  const velocityProfileKmS = [];
  const inboundSpeeds = inbound.pathKm.map((_, i) => {
    if (i === 0) return mag(inbound.v1);
    if (i === inbound.pathKm.length - 1) return mag(inbound.v2);
    // Interpolate velocity along trajectory (simplified)
    const fraction = i / (inbound.pathKm.length - 1);
    return mag(inbound.v1) * (1 - fraction) + mag(inbound.v2) * fraction;
  });
  velocityProfileKmS.push(...inboundSpeeds);

  // Add periapsis velocity during flyby
  const periapsisVelocity = Math.sqrt(incomingSpeed * incomingSpeed + 2 * body.muKm3S2 / periapsisKm);
  velocityProfileKmS.push(periapsisVelocity);

  const outboundSpeeds = outbound.pathKm.map((_, i) => {
    if (i === 0) return mag(outbound.v1);
    if (i === outbound.pathKm.length - 1) return mag(outbound.v2);
    const fraction = i / (outbound.pathKm.length - 1);
    return mag(outbound.v1) * (1 - fraction) + mag(outbound.v2) * fraction;
  });
  velocityProfileKmS.push(...outboundSpeeds);

  return {
    type: 'swingby',
    transferSeconds: totalSeconds,
    departureDeltaVKmS: missionDeltaV(departurePosition, inbound.v1),
    arrivalDeltaVKmS: missionDeltaV(arrivalPosition, outbound.v2),
    flybyDeltaVKmS: flybyDeltaV,
    totalDeltaVKmS: missionDeltaV(departurePosition, inbound.v1) +
      flybyDeltaV +
      missionDeltaV(arrivalPosition, outbound.v2),
    incomingExcessKmS: incomingSpeed,
    requiredExcessKmS: requiredSpeed,
    turnAngleRad: turnAngle,
    maximumTurnRad: maximumTurn,
    ballisticFlyby: ballistic && flybyDeltaV < 1e-6,
    encounterEpoch,
    maxVelocityKmS: Math.sqrt(
      incomingSpeed * incomingSpeed + 2 * body.muKm3S2 / periapsisKm
    ),
    velocityProfileKmS,
    pathKm,
    pathLengthKm: pathLengthKm(pathKm)
  };
}
