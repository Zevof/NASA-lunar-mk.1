/**
 * Solar-light geometry shared by the 3D scene and automated tests.
 *
 * The Sun is extremely distant compared with the Earth-Moon system, so its
 * incident rays are effectively parallel at both bodies. This module expresses
 * that geometry without depending on Three.js.
 *
 * Unified Solar Lighting
 * ----------------------
 * Two bodies that orbit each other closely (Earth and Moon) must be lit by
 * ONE identical Sun direction, otherwise their day/night terminators and
 * cast shadows disagree by a tiny angle and "align" incorrectly in the render.
 * The helpers below expose that single shared direction:
 *
 *   unifiedSunDirectionFromPositions(sun, body)  single body (canonical)
 *   unifiedSunLightingVector(sun, bodies)        one shared vector for a group
 *   parallelSunlightDirection(v)                 normalise / validate a vector
 */

const EPSILON_LENGTH_SQUARED = 1e-12;
const FALLBACK_DIRECTION = Object.freeze({ x: -1, y: 0, z: 0 });

/**
 * Sun-to-body unit direction for a single body.
 *
 * This is the canonical primitive used everywhere. For a body far from the
 * Sun it is (almost) identical to the shared group vector below; for closely
 * orbiting pairs prefer unifiedSunLightingVector().
 *
 * @param {{x:number,y:number,z:number}} sun
 * @param {{x:number,y:number,z:number}} body
 * @returns {{x:number,y:number,z:number}} unit vector from Sun to body
 */
export function sunlightDirectionFromPositions(sun, body) {
  const dx = body.x - sun.x;
  const dy = body.y - sun.y;
  const dz = body.z - sun.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;

  if (!Number.isFinite(lengthSquared) || lengthSquared < EPSILON_LENGTH_SQUARED) {
    return { x: FALLBACK_DIRECTION.x, y: FALLBACK_DIRECTION.y, z: FALLBACK_DIRECTION.z };
  }

  const length = Math.sqrt(lengthSquared);
  return { x: dx / length, y: dy / length, z: dz / length };
}

/**
 * Canonical single-body Sun direction.
 *
 * Semantically identical to sunlightDirectionFromPositions(); kept as an
 * explicit name so call sites document that they use the unified model.
 *
 * @param {{x:number,y:number,z:number}} sun
 * @param {{x:number,y:number,z:number}} body
 * @returns {{x:number,y:number,z:number}} unit vector from Sun to body
 */
export function unifiedSunDirectionFromPositions(sun, body) {
  return sunlightDirectionFromPositions(sun, body);
}

/**
 * Normalise (and validate) a direction vector. Returns the fallback direction
 * when the input is missing, not finite or degenerate.
 *
 * @param {{x:number,y:number,z:number}} v
 * @returns {{x:number,y:number,z:number}} unit vector
 */
export function parallelSunlightDirection(v) {
  if (!v) {
    return { x: FALLBACK_DIRECTION.x, y: FALLBACK_DIRECTION.y, z: FALLBACK_DIRECTION.z };
  }
  const lengthSquared = v.x * v.x + v.y * v.y + v.z * v.z;
  if (!Number.isFinite(lengthSquared) || lengthSquared < EPSILON_LENGTH_SQUARED) {
    return { x: FALLBACK_DIRECTION.x, y: FALLBACK_DIRECTION.y, z: FALLBACK_DIRECTION.z };
  }
  const length = Math.sqrt(lengthSquared);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * ONE shared Sun direction for a group of bodies (e.g. Earth + Moon).
 *
 * The bodies are reduced to their barycentre (plain arithmetic mean of all
 * positions), and the direction is computed Sun -> barycentre. Every body in
 * the group is lit from this identical vector, so their terminators and cast
 * shadows are guaranteed to align exactly — physically correct for a very
 * distant Sun and visually robust for Earth/Moon scenes.
 *
 * @param {{x:number,y:number,z:number}} sun
 * @param {Array<{x:number,y:number,z:number}>} bodies non-empty array
 * @returns {{x:number,y:number,z:number}} unit vector from Sun to group centre
 */
export function unifiedSunLightingVector(sun, bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) {
    return { x: FALLBACK_DIRECTION.x, y: FALLBACK_DIRECTION.y, z: FALLBACK_DIRECTION.z };
  }

  let cx = 0;
  let cy = 0;
  let cz = 0;
  let count = 0;
  for (const body of bodies) {
    if (!body) continue;
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y) || !Number.isFinite(body.z)) continue;
    cx += body.x;
    cy += body.y;
    cz += body.z;
    count += 1;
  }

  if (count === 0) {
    return { x: FALLBACK_DIRECTION.x, y: FALLBACK_DIRECTION.y, z: FALLBACK_DIRECTION.z };
  }

  const centre = { x: cx / count, y: cy / count, z: cz / count };
  return sunlightDirectionFromPositions(sun, centre);
}

/**
 * Convenience wrapper: shared Sun direction specifically for the Earth-Moon
 * pair. Kept explicit so call sites cannot accidentally compute two different
 * per-body directions and let the shadows drift apart.
 *
 * @param {{x:number,y:number,z:number}} sun
 * @param {{x:number,y:number,z:number}} earth
 * @param {{x:number,y:number,z:number}} moon
 * @returns {{x:number,y:number,z:number}} shared unit vector
 */
export function unifiedEarthMoonSunDirection(sun, earth, moon) {
  return unifiedSunLightingVector(sun, [earth, moon]);
}

/**
 * Batch helper that returns one per-body direction in input order.
 *
 * NOTE: each body gets its own direction. Use unifiedSunLightingVector() if
 * the group must share exactly one direction (Earth/Moon shadow alignment).
 *
 * @param {{x:number,y:number,z:number}} sun
 * @param {Array<{x:number,y:number,z:number}>} bodies
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function sunlightDirectionsForBodies(sun, bodies) {
  return bodies.map((body) => sunlightDirectionFromPositions(sun, body));
}
