/**
 * Planets registry for the Lunar Link Planner.
 *
 * Re-exports the canonical PLANET_DATA from planet-data-sources.mjs and
 * provides the exact public API expected by the renderer, UI and routing
 * modules: list(), get(id), PLANETS array sorted by heliocentric distance.
 *
 * All UI text is English. Module is Node-safe (no DOM, no WebGL).
 *
 * @module planets-core
 */

let PLANETS = [];
let _loaded = false;

/**
 * Load the canonical planet dataset. Idempotent – repeated calls are safe.
 * Falls back to a three-body stub if planet-data-sources.mjs is unavailable
 * so the renderer never has to crash.
 * @returns {Promise<Array>}
 */
export async function loadAll(){
  if(_loaded) return PLANETS;
  try{
    const mod = await import('./planet-data-sources.mjs');
    const data = mod.PLANET_DATA || mod.default || [];
    PLANETS = data.slice().sort((a,b) => (a.semiMajorAxisKm || 0) - (b.semiMajorAxisKm || 0));
  }catch(err){
    console.warn('[planets-core] planet data unavailable:', err && err.message);
    PLANETS = [
      { id:'sun', name:'Sun', radiusKm:695700, semiMajorAxisKm:0, orbitalPeriodDays:null, axialTiltDeg:7.25, rotationPeriodHours:609.12, textureUrl:'', heightmapUrl:null, bumpScale:0, atmosphereColor:'#fff3b0', atmosphereOpacity:0, moons:[], rings:null, colorPalette:['#fff3b0','#ffb934','#ec6f16'] },
      { id:'earth', name:'Earth', radiusKm:6371, semiMajorAxisKm:1.495978707e8, orbitalPeriodDays:365.256, axialTiltDeg:23.44, rotationPeriodHours:23.934, textureUrl:'', heightmapUrl:null, bumpScale:0.02, atmosphereColor:'#7ec0ff', atmosphereOpacity:0.9, moons:[], rings:null, colorPalette:['#2e6fb5','#7ec0ff','#ffffff'] },
      { id:'moon', name:'Moon', radiusKm:1737.4, semiMajorAxisKm:3.844e5, orbitalPeriodDays:27.32, axialTiltDeg:6.68, rotationPeriodHours:655.7, textureUrl:'', heightmapUrl:null, bumpScale:0.03, atmosphereColor:'#888', atmosphereOpacity:0, moons:[], rings:null, colorPalette:['#cccccc','#888888','#444444'] }
    ];
  }
  _loaded = true;
  return PLANETS;
}

/** @returns {Array} currently loaded planet specs (may be empty before loadAll()). */
export function list(){ return PLANETS.slice(); }

/**
 * Look up a body by id.
 * Returns the body spec itself, which carries textureUrl and heightmapUrl at
 * the top level (plus radiusKm, semiMajorAxisKm, moons, rings, ...). Existing
 * callers that read any other spec field keep working unchanged.
 * @param {string} id
 * @returns {object|null} The full body spec, or null if unknown.
 */
export function get(id){
  if(!id) return null;
  return PLANETS.find(p => p.id === id) || null;
}

/**
 * Ordered list of the seven classical + gas + ice giants + Moon/Sun.
 * Populated lazily – call loadAll() first.
 */
export { PLANETS };

/**
 * Unified Solar Lighting bridge.
 *
 * Returns ONE shared Sun-to-group unit direction for the Earth-Moon pair so
 * their day/night terminators and cast shadows align exactly in the renderer.
 * Delegates to sunlight-core.mjs so the geometry lives in exactly one place.
 *
 * @param {{x:number,y:number,z:number}} sun
 * @param {{x:number,y:number,z:number}} earth
 * @param {{x:number,y:number,z:number}} moon
 * @returns {Promise<{x:number,y:number,z:number}>} shared unit vector
 */
export async function sharedEarthMoonSunDirection(sun, earth, moon) {
  const core = await import('./sunlight-core.mjs');
  return core.unifiedEarthMoonSunDirection(sun, earth, moon);
}

/**
 * Synchronous variant for render loops that already imported sunlight-core.
 * Accepts an injected implementation to avoid a top-level static import and
 * keep this module Node-safe / lazy-loading.
 *
 * @param {{x:number,y:number,z:number}} sun
 * @param {{x:number,y:number,z:number}} earth
 * @param {{x:number,y:number,z:number}} moon
 * @param {{unifiedSunLightingVector:Function}} impl
 * @returns {{x:number,y:number,z:number}}
 */
export function sharedEarthMoonSunDirectionSync(sun, earth, moon, impl) {
  if (!impl || typeof impl.unifiedSunLightingVector !== 'function') {
    // Degenerate fallback: direction from Sun to the Moon position so callers
    // never crash if they forget to pass the implementation.
    const dx = (moon ? moon.x : 0) - sun.x;
    const dy = (moon ? moon.y : 0) - sun.y;
    const dz = (moon ? moon.z : 0) - sun.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }
  return impl.unifiedSunLightingVector(sun, [earth, moon]);
}

const Planets = { PLANETS, loadAll, list, get, sharedEarthMoonSunDirection, sharedEarthMoonSunDirectionSync };
if(typeof window !== 'undefined'){
  window.LLP = window.LLP || {};
  window.LLP.Planets = Planets;
  // Propagate the sorted array once data is loaded.
  Object.defineProperty(window.LLP.Planets, 'PLANETS', { get: () => PLANETS, enumerable: true, configurable: true });
}

export default Planets;
