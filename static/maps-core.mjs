/**
 * 2D "Google-Maps"-style map API for every planetary body.
 *
 * Pure mathematics + body metadata. No real map tiles, no network, no DOM.
 * Node-safe: the only dynamic import (planets-core) is wrapped in try/catch so
 * this module never crashes a Node test harness when planet data is absent.
 *
 * Public API (window.LLP.Maps in the browser):
 *   Maps.project(lat, lon, opts)          -> {x, y}
 *   Maps.unproject(x, y, opts)            -> {lat, lon}
 *   Maps.makeGrid(step, opts?)            -> {lines: [...]}
 *   Maps.bodyMapConfig(bodyId)            -> Promise<{textureUrl, widthDeg, heightDeg, ...}>
 *
 * Supported projections:
 *   'equirect' - simple plate carree, lon/lat linearly mapped to x/y.
 *   'mercator' - Web Mercator (EPSG:3857 style), latitudes clamped to ~85.05 deg.
 *
 * Coordinates: x grows right (west -> east), y grows DOWN (north -> south) to
 * match screen/image space. Longitude domain is -180..180, latitude -90..90.
 *
 * @module maps-core
 */

/** Default virtual canvas size in pixels for the whole world. */
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

/** Web Mercator latitude limit in degrees (where y maps to +/-H/2). */
const MAX_MERCATOR_LAT_DEG = 85.0511287798066;

/** Full global map extent in degrees (equirectangular whole-surface map). */
const GLOBAL_MAP_WIDTH_DEG = 360;
const GLOBAL_MAP_HEIGHT_DEG = 180;

function toRadians(deg) {
  return deg * Math.PI / 180;
}

function toDegrees(rad) {
  return rad * 180 / Math.PI;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Validate and normalise projection options.
 * @param {object} opts
 * @returns {{width:number,height:number,projection:'equirect'|'mercator'}}
 */
function normaliseOptions(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const width = Number(o.width ?? DEFAULT_WIDTH);
  const height = Number(o.height ?? DEFAULT_HEIGHT);
  if (!Number.isFinite(width) || width <= 0) {
    throw new TypeError('width must be a positive finite number.');
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypeError('height must be a positive finite number.');
  }
  const projection = String(o.projection || 'equirect').toLowerCase();
  if (projection !== 'equirect' && projection !== 'mercator') {
    throw new TypeError(`Unknown projection: ${o.projection}. Use 'equirect' or 'mercator'.`);
  }
  return { width, height, projection };
}

/**
 * Project geographic coordinates to 2D pixel space.
 *
 * @param {number} lat Latitude in degrees (-90..90).
 * @param {number} lon Longitude in degrees (-180..180).
 * @param {{width?:number,height?:number,projection?:'equirect'|'mercator'}} [opts]
 * @returns {{x:number,y:number}} Pixel coordinates; y points down.
 */
export function project(lat, lon, opts = {}) {
  const { width, height, projection } = normaliseOptions(opts);
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    throw new TypeError('lat and lon must be finite numbers.');
  }

  // Horizontal axis is identical for both projections (linear longitude).
  const x = (lonNum + 180) / 360 * width;

  if (projection === 'mercator') {
    // Web Mercator: clamp latitude so the tangent never blows up at the poles.
    const clampedLat = clamp(latNum, -MAX_MERCATOR_LAT_DEG, MAX_MERCATOR_LAT_DEG);
    const phi = toRadians(clampedLat);
    const mercN = Math.log(Math.tan(Math.PI / 4 + phi / 2));
    // mercN/pi is +1 at MAX_LAT and -1 at -MAX_LAT; invert for downward y.
    const y = (1 - mercN / Math.PI) / 2 * height;
    return { x, y };
  }

  // Equirectangular: latitude mapped linearly, north up.
  const y = (90 - latNum) / 180 * height;
  return { x, y };
}

/**
 * Inverse of project(). Convert pixel coordinates back to geographic degrees.
 *
 * @param {number} x Pixel x (0..width).
 * @param {number} y Pixel y (0..height).
 * @param {{width?:number,height?:number,projection?:'equirect'|'mercator'}} [opts]
 * @returns {{lat:number,lon:number}} Geographic coordinates in degrees.
 */
export function unproject(x, y, opts = {}) {
  const { width, height, projection } = normaliseOptions(opts);
  const xNum = Number(x);
  const yNum = Number(y);
  if (!Number.isFinite(xNum) || !Number.isFinite(yNum)) {
    throw new TypeError('x and y must be finite numbers.');
  }

  // Inverse of the shared horizontal mapping.
  const lon = xNum / width * 360 - 180;

  if (projection === 'mercator') {
    const mercN = (1 - (yNum / height) * 2) * Math.PI;
    const lat = toDegrees(2 * Math.atan(Math.exp(mercN)) - Math.PI / 2);
    return { lat, lon };
  }

  const lat = 90 - (yNum / height) * 180;
  return { lat, lon };
}

/**
 * Build graticule (grid) line geometry for a map of the given size.
 *
 * Each line is sampled as a list of geographic points so a renderer can simply
 * project them. Meridians run north-south (constant lon), parallels west-east
 * (constant lat).
 *
 * @param {number} step Spacing between lines in degrees (> 0, typically 15/30/45).
 * @param {{width?:number,height?:number,projection?:'equirect'|'mercator',samples?:number}} [opts]
 * @returns {{step:number,projection:string,lines:Array<object>}} Grid description.
 */
export function makeGrid(step, opts = {}) {
  const size = Number(step);
  if (!Number.isFinite(size) || size <= 0) {
    throw new TypeError('step must be a positive finite number of degrees.');
  }
  const { width, height, projection } = normaliseOptions(opts);
  const samples = Number.isFinite(opts.samples) ? Math.max(2, Math.floor(opts.samples)) : 64;

  const lines = [];

  // Meridians: constant longitude, latitude swept from -90 to +90.
  for (let lon = -180; lon <= 180 + 1e-9; lon += size) {
    const points = [];
    for (let i = 0; i < samples; i++) {
      const lat = -90 + (180 * i) / (samples - 1);
      points.push({ lat, lon: clamp(lon, -180, 180) });
    }
    lines.push({ kind: 'meridian', value: clamp(lon, -180, 180), points });
  }

  // Parallels: constant latitude, longitude swept from -180 to +180.
  // For Mercator, skip parallels beyond the visible latitude clamp.
  const latLimit = projection === 'mercator' ? MAX_MERCATOR_LAT_DEG : 90;
  for (let lat = -90; lat <= 90 + 1e-9; lat += size) {
    const clampedLat = clamp(lat, -latLimit, latLimit);
    const points = [];
    for (let i = 0; i < samples; i++) {
      const lon = -180 + (360 * i) / (samples - 1);
      points.push({ lat: clampedLat, lon });
    }
    lines.push({ kind: 'parallel', value: clampedLat, points });
  }

  return { step: size, projection, width, height, lines };
}

/**
 * Local, offline texture map for bodies. Mirrors the browser-loadable assets in
 * planet-data-sources.mjs LOCAL_TEXTURES so this module stays self-contained and
 * works even when planet data cannot be imported (e.g. bare Node test run).
 * Every path below is served from /static and verified to exist on disk.
 * @type {Record<string,string>}
 */
const FALLBACK_BODY_TEXTURES = {
  sun: '/textures/sun.jpg',
  mercury: '/textures/mercury.jpg',
  venus: '/textures/venus_surface.jpg',
  earth: '/textures/earth_daymap.jpg',
  moon: '/textures/moon_nasa.jpg',
  mars: '/textures/mars.jpg',
  jupiter: '/textures/jupiter.jpg',
  saturn: '/textures/saturn.jpg',
  uranus: '/textures/uranus.jpg',
  neptune: '/textures/neptune.jpg'
};

/** Bodies with a real measured solid surface (not a cloud-deck schematic). */
const SOLID_SURFACE_BODIES = new Set([
  'mercury', 'venus', 'earth', 'moon', 'mars', 'pluto'
]);

/**
 * Describe a 2D map for a planetary body.
 *
 * Attempts to enrich the result from planets-core (name, radiusKm, textureUrl,
 * textureSource) via a guarded dynamic import; falls back to the local table so
 * the call never throws in Node or offline contexts.
 *
 * widthDeg/heightDeg describe the angular extent of the generated whole-surface
 * map (360 x 180 for the global equirectangular chart). They are constants for
 * a full-body map; radiusKm is returned so callers can scale zoom levels.
 *
 * @param {string} bodyId Lowercase body identifier ('earth', 'mars', ...).
 * @returns {Promise<object>} Map configuration for the body.
 */
export async function bodyMapConfig(bodyId) {
  const id = String(bodyId || '').toLowerCase().trim();
  if (!id) {
    throw new TypeError('bodyId must be a non-empty string.');
  }

  // Start from the offline fallback, then try to refine from planets-core.
  let name = id.charAt(0).toUpperCase() + id.slice(1);
  let textureUrl = FALLBACK_BODY_TEXTURES[id] || null;
  let radiusKm = null;
  let source = 'maps-core fallback table';

  try {
    // Guarded dynamic import keeps this module Node-safe: if planets-core or
    // its data sources fail to load, we keep the fallback values above.
    const mod = await import('./planets-core.mjs');
    if (mod && typeof mod.loadAll === 'function') {
      await mod.loadAll();
    }
    const spec = mod && typeof mod.get === 'function' ? mod.get(id) : null;
    if (spec) {
      name = spec.name || name;
      radiusKm = Number.isFinite(spec.radiusKm) ? spec.radiusKm : radiusKm;
      // Prefer the canonical textureUrl from planet data when present.
      if (spec.textureUrl) {
        textureUrl = spec.textureUrl;
        source = 'planets-core';
      } else if (textureUrl) {
        source = 'planets-core (texture fell back to local table)';
      }
    } else if (textureUrl) {
      source = 'body not in planets-core; using local table';
    }
  } catch (error) {
    // planets-core unavailable (offline Node test): silently keep fallback.
    source = `planets-core unavailable (${(error && error.message) || 'import failed'}); using local table`;
  }

  return {
    bodyId: id,
    name,
    // Angular extent of the full-body equirectangular map.
    widthDeg: GLOBAL_MAP_WIDTH_DEG,
    heightDeg: GLOBAL_MAP_HEIGHT_DEG,
    // Default projection for a whole-body 2D chart.
    projection: 'equirect',
    textureUrl,
    radiusKm,
    hasSolidSurface: SOLID_SURFACE_BODIES.has(id),
    source
  };
}

/**
 * Convenience: project a list of geographic points to pixel space at once.
 * Useful for drawing a route path (from route-core) onto a 2D map.
 *
 * @param {Array<{lat:number,lon:number}>} points Geographic points.
 * @param {{width?:number,height?:number,projection?:string}} [opts]
 * @returns {Array<{x:number,y:number}>} Projected pixel points.
 */
export function projectPath(points, opts = {}) {
  if (!Array.isArray(points)) {
    throw new TypeError('points must be an array of {lat, lon} objects.');
  }
  // Validate options once up front so every point shares the same mapping.
  normaliseOptions(opts);
  return points.map((point) => project(point.lat, point.lon, opts));
}

const Maps = {
  project,
  unproject,
  makeGrid,
  bodyMapConfig,
  projectPath,
  MAX_MERCATOR_LAT_DEG
};

if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.Maps = Maps;
}

export default Maps;
