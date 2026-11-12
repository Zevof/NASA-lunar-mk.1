// Terrain & Displacement Engine – Lunar Link Planner.
// NASA LOLA height-map reader (legacy) + generic planet heightmap loader,
// sphere displacement (optionally via a self-contained Blob-URL Web Worker),
// bump-map builder, procedural crater field and a deterministic value-noise
// fallback for offline / failed-fetch scenarios.
//
// CGI Moon Kit reference: https://svs.gsfc.nasa.gov/4720/
// Unsigned 16-bit LOLA DEM values store an offset of +20000 half-meters above
// the mean lunar sphere R=1737.4 km: height_km=(value-20000)/2000.
//
// Notes on portability:
// - Only `nav-core.mjs` is imported at module top-level (pure math, Node-safe).
// - Three.js is referenced lazily inside functions that need it so this module
//   can be imported in Node for unit tests without pulling a DOM/WebGL bundle.
// - All public APIs attach to `window.LLP.Terrain` when a `window` exists.

import {MOON_R_KM, RAD, normal, tangentFrame, dot, mag, sub, add, mul, unit, clamp} from './nav-core.mjs';

// ---------------------------------------------------------------------------
// Internal small helpers
// ---------------------------------------------------------------------------

/** Clamp to [0,1]. @param {number} x */
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;

/** True when running in a browser-like environment. */
const hasDOM = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Shared Three.js reference.
 *
 * The host app may load Three.js either as a classic global (window.THREE) or
 * as an ES module with an import map (no window.THREE global). To avoid a
 * SECOND Three.js instance (which would break instanceof across module
 * boundaries), callers SHOULD inject their loaded namespace once:
 *
 *   import * as THREE from 'three';
 *   LLP.Terrain.setThree(THREE);
 *
 * getSharedThree() returns the injected namespace, else window.THREE, else null.
 */
let injectedThree = null;

/**
 * Inject the app's Three.js namespace so this module reuses the SAME instance.
 * @param {object} THREE - the `import * as THREE` namespace.
 */
export function setThree(THREE){ injectedThree = THREE || null; }

/**
 * Resolve the shared Three.js namespace (injected first, then window.THREE).
 * @returns {object|null}
 */
function getSharedThree(){
  if(injectedThree)return injectedThree;
  if(hasDOM() && window.THREE)return window.THREE;
  return null;
}

/** Attach an export map onto window.LLP.Terrain when possible. */
function attachToGlobal(api){
  if(!hasDOM())return;
  window.LLP = window.LLP || {};
  window.LLP.Terrain = Object.assign({}, window.LLP.Terrain, api);
}

// ---------------------------------------------------------------------------
// Deterministic value-noise fallback
// ---------------------------------------------------------------------------

/** 32-bit integer hash (Thomas Wang / Murmur-style finalizer). Deterministic. */
function hash3i(x, y, seed){
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295; // 0..1
}

/** Smooth interpolation weight (smoothstep). @param {number} t */
const fade = (t) => t * t * (3 - 2 * t);

/**
 * Bilinear value-noise in [0,1] on an infinite lattice.
 * @param {number} x @param {number} y @param {number} [seed=0]
 * @returns {number} 0..1
 */
export function valueNoise2D(x, y, seed = 0){
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash3i(xi, yi, seed);
  const b = hash3i(xi + 1, yi, seed);
  const c = hash3i(xi, yi + 1, seed);
  const d = hash3i(xi + 1, yi + 1, seed);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return clamp01(top + (bottom - top) * v);
}

/**
 * Fractal Brownian motion built on valueNoise2D. Deterministic per seed.
 * @param {number} x @param {number} y
 * @param {object} [opts]
 * @param {number} [opts.octaves=5] @param {number} [opts.lacunarity=2]
 * @param {number} [opts.gain=0.5] @param {number} [opts.seed=0]
 * @returns {number} 0..1
 */
export function fbm2D(x, y, {octaves = 5, lacunarity = 2, gain = 0.5, seed = 0} = {}){
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for(let o = 0; o < octaves; o++){
    sum += amp * valueNoise2D(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return norm > 0 ? clamp01(sum / norm) : 0;
}

// Cache the last procedural heightmap so buildDisplacement/buildBump can reuse it.
const PROC_CACHE = new Map();
const HM_CACHE = new Map(); // url -> Float32Array {data,width,height}
const BUMP_CACHE = new Map(); // url -> {canvas, texturePromise?}

/** Max heightmap texture size (equirectangular 2:1). */
const MAX_HM_W = 2048, MAX_HM_H = 1024;

/**
 * Generate a deterministic procedural heightmap (value-noise fBm) with soft
 * low-frequency continents and higher-frequency roughness.
 * @param {object} [spec]
 * @param {number} [spec.noiseSeed=1]
 * @param {number} [spec.noiseScale=4]
 * @param {number} [width=1024] @param {number} [height=512]
 * @returns {Float32Array} length width*height, normalized 0..1 (row-major).
 */
export function generateProceduralHeightmap(spec = {}, width = 1024, height = 512){
  const seed = Number.isFinite(spec.noiseSeed) ? spec.noiseSeed : 1;
  const scale = Number.isFinite(spec.noiseScale) ? spec.noiseScale : 4;
  const key = `${seed}|${scale}|${width}x${height}`;
  if(PROC_CACHE.has(key))return PROC_CACHE.get(key);
  const out = new Float32Array(width * height);
  for(let y = 0; y < height; y++){
    // Map v to latitude so poles are not degenerate; avoids seam pinch.
    const lat = (0.5 - (y + 0.5) / height) * Math.PI; // +pi/2 north .. -pi/2 south
    const cy = Math.cos(lat), sy = Math.sin(lat);
    for(let x = 0; x < width; x++){
      const lon = ((x + 0.5) / width) * 2 * Math.PI;
      const px = cy * Math.cos(lon), py = cy * Math.sin(lon), pz = sy;
      // Sample fBm on the unit sphere (3D-ish via projecting three 2D slices).
      const n = fbm2D(px * scale + 11.3, py * scale + pz * scale * 0.7 - 4.1,
        {octaves: 6, lacunarity: 2.03, gain: 0.52, seed});
      out[y * width + x] = clamp01(n);
    }
  }
  PROC_CACHE.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Heightmap loader (Image -> normalized Float32Array)
// ---------------------------------------------------------------------------

/**
 * Load an image element from a URL with crossOrigin='anonymous'.
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`heightmap image failed to load: ${url}`));
    img.src = url;
  });
}

/** Read pixels of an image/canvas into ImageData at a bounded size. */
function imageToImageData(img, maxW = MAX_HM_W, maxH = MAX_HM_H){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if(!(iw > 0) || !(ih > 0))throw new Error('heightmap image has no dimensions');
  // Preserve aspect, clamp to max bounds.
  let w = iw, h = ih;
  const s = Math.min(maxW / iw, maxH / ih, 1);
  w = Math.max(1, Math.round(iw * s));
  h = Math.max(1, Math.round(ih * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  if(!ctx)throw new Error('2D canvas context unavailable for heightmap');
  ctx.drawImage(img, 0, 0, w, h);
  return {data: ctx.getImageData(0, 0, w, h).data, width: w, height: h};
}

/**
 * Normalize raw RGBA bytes to a 0..1 grayscale Float32Array (Rec.709 luma).
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} width @param {number} height
 * @returns {Float32Array}
 */
export function normalizeLuminance(rgba, width, height){
  const out = new Float32Array(width * height);
  for(let i = 0, p = 0; i < out.length; i++, p += 4){
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    out[i] = clamp01((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  }
  return out;
}

/**
 * Load a normalized 0..1 heightmap from spec.heightmapUrl.
 * Falls back to deterministic procedural noise when fetch/decode fails or when
 * no DOM is available (e.g. Node unit tests).
 * @param {object} spec - PlanetSpec with {heightmapUrl, noiseSeed?, noiseScale?}.
 * @returns {Promise<Float32Array>} row-major, length = width*height (2048x1024 max).
 */
export async function loadHeightmap(spec){
  const fallback = () => {
    const arr = generateProceduralHeightmap(spec || {}, MAX_HM_W / 2, MAX_HM_H / 2);
    return arr;
  };
  if(!spec || typeof spec.heightmapUrl !== 'string' || !hasDOM())return fallback();
  if(HM_CACHE.has(spec.heightmapUrl))return HM_CACHE.get(spec.heightmapUrl);
  try{
    const img = await loadImage(spec.heightmapUrl);
    const {data, width, height} = imageToImageData(img);
    const arr = normalizeLuminance(data, width, height);
    HM_CACHE.set(spec.heightmapUrl, arr);
    return arr;
  }catch(err){
    // eslint-disable-next-line no-console
    console.warn('[Terrain] heightmap load failed, using procedural fallback:', err && err.message);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Heightmap sampling on a sphere
// ---------------------------------------------------------------------------

/**
 * Sample a row-major heightmap at spherical UV derived from a unit direction.
 * u = 0.5 + atan2(z,x)/(2pi), v = 0.5 - asin(y)/pi  (Three.js SphereGeometry UV).
 * Bilinear, wraps in u, clamps in v.
 * @param {Float32Array} hm @param {number} w @param {number} h
 * @param {number} nx @param {number} ny @param {number} nz
 * @returns {number} 0..1
 */
export function sampleHeightmapSphere(hm, w, h, nx, ny, nz){
  if(!hm || !(w > 0) || !(h > 0))return 0;
  let u = 0.5 + Math.atan2(nz, nx) / (2 * Math.PI);
  u -= Math.floor(u); // wrap [0,1)
  const v = clamp01(0.5 - Math.asin(clamp(ny, -1, 1)) / Math.PI);
  const fx = u * w - 0.5, fy = v * h - 0.5;
  const x0 = Math.floor(fx), y0 = clamp(Math.floor(fy), 0, h - 1);
  const tx = fx - x0, ty = clamp(fy - y0, 0, 1);
  const wx0 = ((x0 % w) + w) % w, wx1 = (wx0 + 1) % w;
  const y1 = Math.min(h - 1, y0 + 1);
  const a = hm[y0 * w + wx0], b = hm[y0 * w + wx1];
  const c = hm[y1 * w + wx0], d = hm[y1 * w + wx1];
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return clamp01(top + (bottom - top) * ty);
}

// ---------------------------------------------------------------------------
// Worker (Blob-URL, self-contained) for displacement
// ---------------------------------------------------------------------------

const WORKER_SRC = `
self.onmessage = function(ev){
  const d = ev.data;
  const pos = new Float32Array(d.positions);
  const nor = new Float32Array(d.normals);
  const hm  = new Float32Array(d.heightmap);
  const w = d.hmWidth, h = d.hmHeight, maxD = d.maxDisplacement, n = d.vertexCount;
  const twoPi = 2 * Math.PI;
  for(let i = 0; i < n; i++){
    const o = i * 3;
    let nx = nor[o], ny = nor[o + 1], nz = nor[o + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let u = 0.5 + Math.atan2(nz, nx) / twoPi; u -= Math.floor(u);
    let v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
    if(v < 0) v = 0; else if(v > 1) v = 1;
    const fx = u * w - 0.5, fy = v * h - 0.5;
    const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
    const tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0));
    const wx0 = ((x0 % w) + w) % w, wx1 = (wx0 + 1) % w;
    const y1 = Math.min(h - 1, y0 + 1);
    const a = hm[y0 * w + wx0], b = hm[y0 * w + wx1];
    const c = hm[y1 * w + wx0], e = hm[y1 * w + wx1];
    const height = (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty;
    const disp = height * maxD;
    pos[o]     = nx * disp;
    pos[o + 1] = ny * disp;
    pos[o + 2] = nz * disp;
  }
  self.postMessage({positions: pos.buffer, vertexCount: n}, [pos.buffer]);
};
`;

let workerURL = null;
function getWorkerURL(){
  if(workerURL)return workerURL;
  try{
    workerURL = URL.createObjectURL(new Blob([WORKER_SRC], {type: 'text/javascript'}));
  }catch(e){ workerURL = null; }
  return workerURL;
}

/** Synchronous CPU displacement (fallback and Node-testable path). */
function displaceSync(positions, normals, hm, w, h, maxDisplacement, vertexCount){
  const twoPi = 2 * Math.PI;
  for(let i = 0; i < vertexCount; i++){
    const o = i * 3;
    let nx = normals[o], ny = normals[o + 1], nz = normals[o + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let u = 0.5 + Math.atan2(nz, nx) / twoPi; u -= Math.floor(u);
    let v = 0.5 - Math.asin(clamp(ny, -1, 1)) / Math.PI;
    const fx = u * w - 0.5, fy = v * h - 0.5;
    const x0 = Math.floor(fx), y0 = clamp(Math.floor(fy), 0, h - 1);
    const tx = fx - x0, ty = clamp(fy - y0, 0, 1);
    const wx0 = ((x0 % w) + w) % w, wx1 = (wx0 + 1) % w;
    const y1 = Math.min(h - 1, y0 + 1);
    const a = hm[y0 * w + wx0], b = hm[y0 * w + wx1];
    const c = hm[y1 * w + wx0], e = hm[y1 * w + wx1];
    const height = clamp01((a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty);
    const disp = height * maxDisplacement;
    positions[o] = nx * disp;
    positions[o + 1] = ny * disp;
    positions[o + 2] = nz * disp;
  }
}

/**
 * Recompute smooth vertex normals on a BufferGeometry-like object.
 * Uses Three.js when available; otherwise performs area-weighted accumulation
 * directly on the position attribute (works on the test stubs).
 * @param {object} geometry - has attributes.position (itemSize 3).
 */
export function computeNormals(geometry){
  if(!geometry || !geometry.attributes || !geometry.attributes.position) return;
  const THREE = getSharedThree();
  if(THREE && THREE.BufferGeometry &&
     geometry instanceof THREE.BufferGeometry && typeof geometry.computeVertexNormals === 'function'){
    geometry.computeVertexNormals();
    return;
  }
  const pos = geometry.attributes.position;
  const arr = pos.array;
  const n = pos.count;
  const nor = new Float32Array(n * 3);
  const index = geometry.index ? geometry.index.array : null;
  const triCount = index ? index.length / 3 : Math.floor(n / 3);
  for(let t = 0; t < triCount; t++){
    let i0, i1, i2;
    if(index){ i0 = index[t*3]; i1 = index[t*3+1]; i2 = index[t*3+2]; }
    else { i0 = t*3; i1 = t*3+1; i2 = t*3+2; }
    const o0=i0*3,o1=i1*3,o2=i2*3;
    const e1x=arr[o1]-arr[o0], e1y=arr[o1+1]-arr[o0+1], e1z=arr[o1+2]-arr[o0+2];
    const e2x=arr[o2]-arr[o0], e2y=arr[o2+1]-arr[o0+1], e2z=arr[o2+2]-arr[o0+2];
    // cross(e1,e2)
    const cxv = e1y*e2z - e1z*e2y;
    const cyv = e1z*e2x - e1x*e2z;
    const czv = e1x*e2y - e1y*e2x;
    nor[o0]+=cxv; nor[o0+1]+=cyv; nor[o0+2]+=czv;
    nor[o1]+=cxv; nor[o1+1]+=cyv; nor[o1+2]+=czv;
    nor[o2]+=cxv; nor[o2+1]+=cyv; nor[o2+2]+=czv;
  }
  for(let i = 0; i < n; i++){
    const o=i*3;
    const l = Math.hypot(nor[o], nor[o+1], nor[o+2]);
    if(l > 1e-12){ nor[o]/=l; nor[o+1]/=l; nor[o+2]/=l; }
    else { nor[o]=0; nor[o+1]=1; nor[o+2]=0; }
  }
  if(geometry.attributes.normal && geometry.attributes.normal.array){
    geometry.attributes.normal.array.set(nor);
    geometry.attributes.normal.needsUpdate = true;
  } else if(typeof geometry.setAttribute === 'function'){
    geometry.setAttribute('normal', {array: nor, itemSize: 3, count: n, needsUpdate: true});
  }
  // else: geometry is a bare stub without setAttribute and no normal attribute;
  // nothing safe to mutate, so leave it untouched (no throw).
}

/**
 * Displace a sphere geometry along its vertex normals using a heightmap.
 * Always recomputes normals afterwards.
 *
 * RETURN TYPE (documented deviation from a purely synchronous signature):
 * - In a browser with Worker support this returns a PROMISE that resolves to
 *   the geometry (displacement runs on a Blob-URL worker, non-blocking).
 * - Without Worker support (or in Node) it returns the geometry SYNCHRONOUSLY.
 * Callers should `await` the result; awaiting a non-Promise is safe, so
 * `const g = await buildDisplacement(...)` works in both environments.
 *
 * @param {object} geometry - THREE.SphereGeometry or a compatible stub.
 * @param {Float32Array} heightmap - normalized 0..1, row-major.
 * @param {number} hmWidth @param {number} hmHeight
 * @param {number} maxDisplacement - max radial offset (scene units).
 * @returns {object|Promise<object>} the same geometry (mutated), or a Promise
 *   resolving to it when the worker path is used.
 */
export function buildDisplacement(geometry, heightmap, hmWidth, hmHeight, maxDisplacement){
  if(!geometry || !geometry.attributes || !geometry.attributes.position) return geometry;
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if(!nor || !nor.array || nor.array.length !== pos.array.length){
    computeNormals(geometry);
  }
  const nrm = geometry.attributes.normal;
  const vertexCount = pos.count;
  const positions = pos.array;
  const normals = nrm.array;
  const hm = heightmap instanceof Float32Array ? heightmap : Float32Array.from(heightmap || []);

  const finish = () => {
    pos.needsUpdate = true;
    computeNormals(geometry);
    if(typeof geometry.computeBoundingSphere === 'function') geometry.computeBoundingSphere();
    return geometry;
  };

  const canWorker = hasDOM() && typeof Worker !== 'undefined' && getWorkerURL();
  if(canWorker){
    try{
      return new Promise((resolve, reject) => {
        let worker;
        try{ worker = new Worker(getWorkerURL()); }
        catch(e){ displaceSync(positions, normals, hm, hmWidth, hmHeight, maxDisplacement, vertexCount); return resolve(finish()); }
        worker.onmessage = (ev) => {
          const buf = new Float32Array(ev.data.positions);
          positions.set(buf);
          try{ worker.terminate(); }catch(e){}
          resolve(finish());
        };
        worker.onerror = (err) => {
          try{ worker.terminate(); }catch(e){}
          displaceSync(positions, normals, hm, hmWidth, hmHeight, maxDisplacement, vertexCount);
          resolve(finish());
        };
        // Copy buffers so the transfer does not detach the geometry's arrays.
        const posCopy = new Float32Array(positions);
        const norCopy = new Float32Array(normals);
        const hmCopy = new Float32Array(hm);
        worker.postMessage({
          positions: posCopy.buffer, normals: norCopy.buffer, heightmap: hmCopy.buffer,
          hmWidth, hmHeight, maxDisplacement, vertexCount
        }, [posCopy.buffer, norCopy.buffer, hmCopy.buffer]);
      });
    }catch(e){ /* fall through to sync */ }
  }
  displaceSync(positions, normals, hm, hmWidth, hmHeight, maxDisplacement, vertexCount);
  return finish();
}

// ---------------------------------------------------------------------------
// Bump map
// ---------------------------------------------------------------------------

/**
 * Build a THREE.Texture suitable for MeshStandardMaterial.bumpMap from
 * spec.heightmapUrl. Falls back to a procedural canvas texture if the fetch
 * fails. Resolves to null only when Three.js is unavailable.
 * @param {object} spec
 * @returns {Promise<object>} THREE.Texture
 */
export async function buildBump(spec){
  const THREE = getSharedThree();
  if(!THREE || !THREE.Texture) return null;
  const url = spec && spec.heightmapUrl;
  const bumpScale = Number.isFinite(spec && spec.bumpScale) ? spec.bumpScale : 1;
  if(url){
    try{
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      const tex = await loader.loadAsync(url);
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 8;
      tex.bumpScale = bumpScale;
      tex.needsUpdate = true;
      BUMP_CACHE.set(url, tex);
      return tex;
    }catch(err){
      // eslint-disable-next-line no-console
      console.warn('[Terrain] bump texture load failed, using procedural bump:', err && err.message);
    }
  }
  // Procedural fallback: grayscale canvas from noise heightmap.
  const hm = generateProceduralHeightmap(spec || {}, 1024, 512);
  const w = 1024, h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for(let i = 0, p = 0; i < hm.length; i++, p += 4){
    const v = Math.round(clamp01(hm[i]) * 255);
    img.data[p] = img.data[p+1] = img.data[p+2] = v; img.data[p+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.bumpScale = bumpScale;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Crater field
// ---------------------------------------------------------------------------

/** Relative crater density per body family (0..1). */
const CRATER_DENSITY = {
  moon: 1.0, luna: 1.0,
  mercury: 0.95,
  mars: 0.8,
  venus: 0.2,
  earth: 0.15,
  io: 0.05, europa: 0.1, ganymede: 0.5, callisto: 0.9, titan: 0.05,
  // Gas giants have no solid surface -> no craters.
  jupiter: 0, saturn: 0, uranus: 0, neptune: 0
};

/**
 * Look up the crater density weight for a PlanetSpec.
 * @param {object} spec
 * @returns {number} 0..1
 */
export function craterDensityFor(spec){
  if(!spec)return 0.5;
  const id = String(spec.id || spec.name || '').toLowerCase();
  for(const key of Object.keys(CRATER_DENSITY)){
    if(id.includes(key))return CRATER_DENSITY[key];
  }
  return 0.5;
}

/** Deterministic PRNG (mulberry32). @param {number} seed */
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural crater field: random points on the sphere (uniform great-circle
 * sampling) with a power-law size distribution, scaled by the body's crater
 * density. Gas giants return an empty group (no solid surface).
 * @param {object} spec - PlanetSpec (id/name used for density).
 * @param {number} [count=500]
 * @returns {object} THREE.Points | THREE.Group (empty group for gas giants).
 */
export function buildCraterField(spec, count = 500){
  const THREE = getSharedThree();
  const density = craterDensityFor(spec);
  const radius = Number.isFinite(spec && spec.radiusKm) ? spec.radiusKm : 1;
  const rng = mulberry32(Number.isFinite(spec && spec.noiseSeed) ? spec.noiseSeed : 1337);
  const n = Math.max(0, Math.floor(count * density));

  const positions = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  // Power-law size distribution: s = sMin * (1-u)^(-1/(alpha-1)), alpha ~ 2.6.
  const sMin = radius * 0.004, alpha = 2.6;
  // Cap the power-law tail so a single outlier cannot dwarf the field:
  // largest crater <= ~6% of the body radius (dominant-basin scale).
  const sMax = radius * 0.06;
  for(let i = 0; i < n; i++){
    // Uniform on sphere via Marsaglia / z = 1-2u.
    const z = 1 - 2 * rng();
    const theta = 2 * Math.PI * rng();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const dir = [r * Math.cos(theta), z, r * Math.sin(theta)];
    const size = Math.min(sMax, sMin * Math.pow(1 - rng(), -1 / (alpha - 1)));
    const surf = radius * (1 + 0.002 * rng());
    positions[i*3] = dir[0] * surf;
    positions[i*3+1] = dir[1] * surf;
    positions[i*3+2] = dir[2] * surf;
    sizes[i] = size;
  }

  if(THREE && THREE.Points && THREE.BufferGeometry){
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      size: radius * 0.006, sizeAttenuation: true, color: 0x888888,
      transparent: true, opacity: 0.55, depthWrite: false
    });
    const points = new THREE.Points(geo, mat);
    points.userData = {count: n, density, sizes};
    return points;
  }
  // DOM-less fallback object (mirrors the fields tests need).
  return {type: 'Points', userData: {count: n, density, sizes},
    geometry: {attributes: {position: {array: positions, itemSize: 3, count: n}}}};
}

/**
 * Peak-to-trough elevation amplitude per body in KILOMETRES.
 * Values are NASA-derived topography extents (highest peak minus deepest
 * basin):
 *  Moon     — ~10.7 km  (Mons Malapert, highest point + South Pole–Aitken basin)
 *  Mercury  — ~10.0 km  (Caloris rim vs. Rachmaninoff)
 *  Earth    — ~19.8 km  (Everest +8.85, Challenger Deep −10.99)
 *  Mars     — ~21.2 km  (Olympus Mons ~21 km above datum)
 *  Venus    — ~13.0 km  (Maxwell Montes vs. lowlands)
 *  Icy moons— ~5.0 km   (generic)
 * Gas giants have no solid surface and use a 0.005-unit visual bump only.
 */
export const MAX_ELEVATION_KM = Object.freeze({
  moon: 10.7, mercury: 10.0, earth: 19.8, mars: 21.2, venus: 13.0,
  io: 5.0, europa: 5.0, ganymede: 5.0, callisto: 5.0, titan: 5.0
});

/**
 * Max radial displacement (scene units) for a PlanetSpec.
 *
 * For rocky/icy bodies this is the body's real elevation amplitude in km
 * divided by 1,000 (true-scale 1 scene unit = 1,000 km), clamped to at least
 * radiusKm*0.0008 so very small bodies still show relief; the caller then
 * multiplies by any exaggeration slider. Gas giants use a fixed 0.005.
 * @param {object} spec
 * @returns {number} max displacement in scene units at exaggeration 1.
 */
export function maxDisplacementFor(spec){
  if(!spec || !Number.isFinite(spec.radiusKm))return 0;
  const id = String(spec.id || spec.name || '').toLowerCase();
  // Gas giants: zero crater density == no solid surface -> fixed small value.
  if(craterDensityFor(spec) === 0)return 0.005;
  let elevKm = 0;
  for(const key of Object.keys(MAX_ELEVATION_KM)){
    if(id.includes(key)){elevKm = MAX_ELEVATION_KM[key];break;}
  }
  if(elevKm <= 0)elevKm = spec.radiusKm * 0.001; // fallback: 0.1 % of radius
  // 1 scene unit = 1,000 km at true scale. Do NOT impose a floor here: at
  // true scale the physical elevation amplitude already yields sub-unit
  // displacement (Moon 0.0107, Mars 0.0212). The exaggeration slider in the
  // UI is what makes relief visible; the engine stays scale-accurate.
  return elevKm / 1000;
}

/** Clear all internal caches (heightmaps, procedural, bump textures). */
export function disposeTerrainCache(){
  HM_CACHE.clear();
  PROC_CACHE.clear();
  for(const tex of BUMP_CACHE.values()){
    try{ if(tex && typeof tex.dispose === 'function') tex.dispose(); }catch(e){}
  }
  BUMP_CACHE.clear();
}

// ---------------------------------------------------------------------------
// Legacy LOLA DEM support (used by app.js and moon-surface-core.mjs).
// Kept intact for backward compatibility with the existing Lunar surface tools.
// ---------------------------------------------------------------------------

export function parseLolaTiff(buffer) {
  const dv=new DataView(buffer);
  if(dv.byteLength<16)throw Error('NASA DEM file is too small');
  const endian=String.fromCharCode(dv.getUint8(0),dv.getUint8(1));
  if(endian!=='II'&&endian!=='MM')throw Error('Not a TIFF height map');
  const little=endian==='II';
  const u16=(p)=>dv.getUint16(p,little),u32=(p)=>dv.getUint32(p,little);
  if(u16(2)!==42)throw Error('Unsupported BigTIFF or invalid TIFF file');
  const entry=u32(4);if(entry<8||entry+2>dv.byteLength)throw Error('Invalid TIFF directory');
  const tagCount=u16(entry),tags=new Map();
  const sizes={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
  for(let i=0;i<tagCount;i++){
    const base=entry+2+i*12;if(base+12>dv.byteLength)throw Error('Truncated TIFF tags');
    const tag=u16(base),type=u16(base+2),count=u32(base+4),sz=sizes[type];
    if(!sz||!count||count>10_000_000)continue;
    const address=count*sz<=4?base+8:u32(base+8);
    if(address+count*sz>dv.byteLength)throw Error('Malformed TIFF tag offset');
    const values=[];
    for(let n=0;n<Math.min(count,100000);n++){
      const p=address+n*sz;
      values.push(type===3?u16(p):type===4?u32(p):type===1?dv.getUint8(p):NaN);
    }
    tags.set(tag,values);
  }
  const one=(id,fallback=null)=>tags.get(id)?.[0]??fallback;
  const width=one(256),height=one(257),bits=one(258),compression=one(259,1),channels=one(277,1);
  const stripOffsets=tags.get(273)||[],stripCounts=tags.get(279)||[],rowsPerStrip=one(278,height);
  const sampleFormat=one(339,1);
  if(!(width>0&&height>0&&width*height<=100_000_000))throw Error('DEM dimensions unsupported');
  if(bits!==16||compression!==1||channels!==1||sampleFormat!==1)throw Error('Expected uncompressed 16-bit unsigned one-channel TIFF');
  if(!stripOffsets.length||!rowsPerStrip)throw Error('Missing TIFF raster strips');
  const data=new Uint16Array(width*height);
  for(let s=0;s<stripOffsets.length;s++){
    const row=s*rowsPerStrip,rows=Math.min(rowsPerStrip,height-row);
    if(rows<=0)break;
    const byteCount=rows*width*2,offset=stripOffsets[s];
    if(offset+byteCount>dv.byteLength||(stripCounts[s]??byteCount)<byteCount)throw Error('Truncated raster strip');
    for(let k=0;k<rows*width;k++)data[row*width+k]=u16(offset+k*2);
  }
  return {width,height,data,source:'NASA LRO / LOLA',metersPerUnit:.5};
}

export function sampleHeightKm(dem,latitude,longitude){
  if(!dem)return 0;
  const xx=((longitude+180)/360*dem.width-.5),yy=(90-latitude)/180*dem.height-.5;
  const xx0=Math.floor(xx),yy0=Math.floor(clamp(yy,0,dem.height-1));
  const fx=xx-xx0,fy=clamp(yy-yy0,0,1);
  const x0=((xx0%dem.width)+dem.width)%dem.width,x1=(x0+1)%dem.width;
  const y0=Math.min(dem.height-1,Math.max(0,yy0)),y1=Math.min(dem.height-1,y0+1);
  const v=(y,x)=>dem.data[y*dem.width+x];
  const a=v(y0,x0)*(1-fx)+v(y0,x1)*fx;
  const b=v(y1,x0)*(1-fx)+v(y1,x1)*fx;
  return ((a*(1-fy)+b*fy)-20000)/2000;
}

export function surfacePointKm(dem,lat,lon,visualExaggeration=1){
  const radius=MOON_R_KM+sampleHeightKm(dem,lat,lon)*visualExaggeration;
  return mul(normal(lat,lon),radius);
}

export function targetAzEl(lat,lon,directionFromCenter,rangeKm=1.496e8,siteHeightKm=0){
  const basis=tangentFrame(lat,lon);
  const target=sub(mul(unit(directionFromCenter),rangeKm),mul(basis.up,MOON_R_KM+siteHeightKm));
  const d=unit(target);
  const az=(Math.atan2(dot(d,basis.east),dot(d,basis.north))/RAD+360)%360;
  const el=Math.asin(clamp(dot(d,basis.up),-1,1))/RAD;
  return {az,el};
}

export function localHorizonElevation(dem,lat,lon,az,maxKm=250,samples=180){
  if(!dem)return 0;
  const basis=tangentFrame(lat,lon),azr=az*RAD;
  const horizontal=add(mul(basis.north,Math.cos(azr)),mul(basis.east,Math.sin(azr)));
  const siteRadius=MOON_R_KM+sampleHeightKm(dem,lat,lon);
  const start=mul(basis.up,siteRadius);
  let maxAngle=0;
  for(let j=1;j<=samples;j++){
    const t=j/samples,d=0.12+maxKm*t*t,rad=d/MOON_R_KM;
    const dir=add(mul(basis.up,Math.cos(rad)),mul(horizontal,Math.sin(rad)));
    const pLat=Math.asin(clamp(dir[2],-1,1))/RAD,pLon=Math.atan2(dir[1],dir[0])/RAD;
    const surface=mul(dir,MOON_R_KM+sampleHeightKm(dem,pLat,pLon));
    const toward=sub(surface,start),up=dot(toward,basis.up);
    const horizontalDist=Math.sqrt(Math.max(0,dot(toward,toward)-up*up));
    const angle=Math.atan2(up,horizontalDist)/RAD;
    if(angle>maxAngle)maxAngle=angle;
  }
  return maxAngle;
}

export function makeHorizonProfile(dem,lat,lon,stepDeg=5){
  const bins=Math.round(360/stepDeg),vals=[];
  for(let i=0;i<bins;i++)vals.push(localHorizonElevation(dem,lat,lon,i*360/bins));
  return {stepDeg:360/bins,vals};
}

export function horizonAt(profile,az){
  if(!profile)return 0;
  const u=(((az%360)+360)%360)/profile.stepDeg,i=Math.floor(u),frac=u-i;
  return profile.vals[i%profile.vals.length]*(1-frac)+profile.vals[(i+1)%profile.vals.length]*frac;
}

export function lightingAndContact(frame,lat,lon,dem=null,profile=null,minEarthElevation=10,requireSun=false){
  const siteElevKm=sampleHeightKm(dem,lat,lon);
  const range=Math.hypot(...frame.moon_eci_km);
  const e=targetAzEl(lat,lon,frame.earth_moon_fixed,range,siteElevKm);
  const s=targetAzEl(lat,lon,frame.sun_moon_fixed,1.496e8,siteElevKm);
  const eh=horizonAt(profile,e.az),sh=horizonAt(profile,s.az);
  const eclear=e.el-eh,sclear=s.el-sh;
  const earthVisible=eclear>=0,sunlit=sclear>0;
  const valid=eclear>=minEarthElevation&&(!requireSun||sunlit);
  return {e:e.el,s:s.el,eh,sh,eclear,sclear,earthAz:e.az,sunAz:s.az,earthVisible,sunlit,valid,siteElevKm,
    score:valid?eclear-(range-384400)/400000:-Infinity};
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

export const Terrain = {
  loadHeightmap,
  buildDisplacement,
  computeNormals,
  buildBump,
  buildCraterField,
  disposeTerrainCache,
  setThree,
  // helpers (also exported for advanced use / testing)
  generateProceduralHeightmap,
  sampleHeightmapSphere,
  normalizeLuminance,
  craterDensityFor,
  maxDisplacementFor,
  valueNoise2D,
  fbm2D
};

attachToGlobal(Terrain);

export default Terrain;
