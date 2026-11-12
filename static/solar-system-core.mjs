/**
 * Solar System renderer for the Lunar Link Planner.
 *
 * Three.js scene graph that renders the Sun, the eight planets (plus Pluto),
 * the major named moons, planetary rings, atmospheric rim glow, a starfield
 * with a soft galactic band, orbital trails, a reference grid and projected
 * HTML labels. Three.js is loaded lazily from a CDN (unpkg with a jsDelivr
 * fallback) so this module stays import-safe in Node for unit tests.
 *
 * IMPORTANT - import map required. OrbitControls.js imports the bare module
 * specifier 'three', which only resolves when the host page publishes an
 * import map. Add this before loading any module script:
 *
 *   <script type="importmap">{"imports":{
 *     "three":"https://unpkg.com/three@0.160.0/build/three.module.js",
 *     "three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}
 *   </script>
 *
 * Rendering notes and limits (NASA tone):
 * - Body positions use JPL low-precision Keplerian elements (valid approx.
 *   3000 BC - 3000 AD) when the shared Scale API is unavailable. Positions
 *   are illustrative and never used for launch, landing or link budgets.
 * - Planet radii and orbital distances follow the selected Scale mode
 *   (true km scaling or a compressed overview). Overview is NOT to scale.
 * - Textures are third-party albedo maps, not measured elevation. Placeholder
 *   palette colours are shown until a texture finishes loading.
 * - Rocky-body displacement applies only when a browser-ready heightmap URL is
 *   present in the body spec; GeoTIFF DEM sources are not decoded here.
 *
 * @module solar-system-core
 */

// ---------------------------------------------------------------------------
// Legacy constants retained for backward compatibility (tests and other modules).
// ---------------------------------------------------------------------------

/** Astronomical unit in kilometres (IAU 2012 definition). */
export const AU_KM = 149597870.7;

/** Eight planets with physical equatorial radii in kilometres. */
export const SOLAR_BODIES = Object.freeze([
  { id: 'mercury', name: 'Mercury', radiusKm: 2439.7, kind: 'rock', color: '#a7a49c' },
  { id: 'venus', name: 'Venus', radiusKm: 6051.8, kind: 'cloud', color: '#e8c694' },
  { id: 'earth', name: 'Earth', radiusKm: 6371.0, kind: 'earth', color: '#429bdb' },
  { id: 'mars', name: 'Mars', radiusKm: 3389.5, kind: 'rock', color: '#cf784f' },
  { id: 'jupiter', name: 'Jupiter', radiusKm: 69911, kind: 'gas', color: '#cba181' },
  { id: 'saturn', name: 'Saturn', radiusKm: 58232, kind: 'gas', color: '#dfc58f' },
  { id: 'uranus', name: 'Uranus', radiusKm: 25362, kind: 'ice', color: '#a4dddd' },
  { id: 'neptune', name: 'Neptune', radiusKm: 24622, kind: 'ice', color: '#4c77de' }
]);

/**
 * Mean sidereal spin periods and axial tilts (NASA fact sheet approximations).
 * Negative hours denote retrograde rotation. Prime meridian and precession
 * are not modelled; angles illustrate accumulated axial rotation only.
 */
export const ROTATION_MODELS = Object.freeze({
  mercury: { hours: 1407.6, tiltDeg: 0.034 },
  venus: { hours: -5832.5, tiltDeg: 177.36 },
  earth: { hours: 23.9344696, tiltDeg: 23.44 },
  mars: { hours: 24.622962, tiltDeg: 25.19 },
  jupiter: { hours: 9.925, tiltDeg: 3.13 },
  saturn: { hours: 10.656, tiltDeg: 26.73 },
  uranus: { hours: -17.24, tiltDeg: 97.77 },
  neptune: { hours: 16.11, tiltDeg: 28.32 },
  sun: { hours: 609.12, tiltDeg: 7.25 },
  moon: { hours: 655.728, tiltDeg: 6.68 },
  pluto: { hours: -153.3, tiltDeg: 122.53 }
});

/** Mean orbital periods in days (NASA fact sheet). */
export const ORBIT_PERIOD_DAYS = Object.freeze({
  mercury: 87.969, venus: 224.701, earth: 365.256, mars: 686.980,
  jupiter: 4332.589, saturn: 10759.22, uranus: 30688.5, neptune: 60182,
  pluto: 90560
});

// ---------------------------------------------------------------------------
// Pure helpers (Node-testable, never touch THREE or the DOM)
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Rotation increment in radians for one simulation step.
 * Sign follows the rotation period, so retrograde bodies spin backwards.
 * @param {number} rotationPeriodHours Signed sidereal rotation period.
 * @param {number} dtSec Simulation delta time in seconds (clamped by caller).
 * @returns {number} Delta angle in radians.
 */
export function computeOrbitRotation(rotationPeriodHours, dtSec) {
  const period = Number(rotationPeriodHours);
  const dt = Number(dtSec);
  if (!Number.isFinite(period) || !Number.isFinite(dt) || period === 0) return 0;
  return (TAU / period) / 3600 * dt;
}

/**
 * Level-of-detail selector for a sphere mesh.
 * Uses the near (high-poly) mesh when the camera is within 4 body radii.
 * @param {number} cameraDist Distance from camera to body centre.
 * @param {number} radius Body radius in world units.
 * @returns {'near'|'far'} LOD bucket.
 */
export function pickLOD(cameraDist, radius) {
  const r = Number(radius);
  if (!Number.isFinite(cameraDist) || !Number.isFinite(r) || r <= 0) return 'far';
  return cameraDist < 4 * r ? 'near' : 'far';
}

/**
 * Parse a #rrggbb string into a [r,g,b] triple with components in 0..1.
 * @param {string} hex Colour string ('#ff0000', 'ff0000', short '#f00').
 * @returns {[number, number, number]} Components in 0..1, [0,0,0] when invalid.
 */
export function hexToColor3(hex) {
  if (typeof hex !== 'string') return [0, 0, 0];
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const int = parseInt(h, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

/** Cubic in-out easing used by the focus camera tween. @param {number} t */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// JPL low-precision heliocentric elements (orbit lines / fallbacks)
// ---------------------------------------------------------------------------

/** [a,e,I,L,peri,node] at J2000 plus linear rates per Julian century. */
const ELEMENTS = {
  mercury: [[0.38709843, 0.20563661, 7.00559432, 252.25166724, 77.45771895, 48.33961819], [0, 0.00002123, -0.00590158, 149472.67486623, 0.15940013, -0.12214182]],
  venus: [[0.72332102, 0.00676399, 3.39777545, 181.97970850, 131.76755713, 76.67261496], [-0.00000026, -0.00005107, 0.00043494, 58517.81560260, 0.05679648, -0.27274174]],
  earth: [[1.00000018, 0.01673163, -0.00054346, 100.46691572, 102.93005885, -5.11260389], [-0.00000003, -0.00003661, -0.01337178, 35999.37306329, 0.31795260, -0.24123856]],
  mars: [[1.52371243, 0.09336511, 1.85181869, -4.56813164, -23.91744784, 49.71320984], [0.00000097, 0.00009149, -0.00724757, 19140.29934243, 0.45223625, -0.26852431]],
  jupiter: [[5.20248019, 0.04853590, 1.29861416, 34.33479152, 14.27495244, 100.29282654], [-0.00002864, 0.00018026, -0.00322699, 3034.90371757, 0.18199196, 0.13024619]],
  saturn: [[9.54149883, 0.05550825, 2.49424102, 50.07571329, 92.86136063, 113.63998702], [-0.00003065, -0.00032044, 0.00873201, 1222.11494724, 0.41892419, -0.25015002]],
  uranus: [[19.18797948, 0.04685740, 0.77298127, 314.20276625, 172.43404441, 73.96250215], [-0.00020455, -0.00001550, -0.00180155, 428.49512595, 0.09266985, -0.00180155]],
  neptune: [[30.06952752, 0.00895439, 1.77005520, 304.22289287, 46.68158724, 131.78635853], [0.00006447, 0.00000818, 0.00022400, 218.46515314, 0.01009938, -0.00606302]],
  // Dwarf planet Pluto: JPL approximate elements (Standish). Pluto has a high
  // inclination and eccentricity; the linear rates are illustrative over 1800–2200.
  pluto: [[39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684], [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482]]
};
const EXTRA = {
  jupiter: [-0.00012452, 0.06064060, -0.35635438, 38.35125],
  saturn: [0.00025899, -0.13434469, 0.87320147, 38.35125],
  uranus: [0.00058331, -0.97731848, 0.17689245, 7.67025],
  neptune: [-0.00041348, 0.68346318, -0.10162547, 7.67025]
};

/** Convert a UTC input to a Julian Date. @param {number|string} epoch */
export function julianDate(epoch) {
  const t = typeof epoch === 'number' ? epoch : Date.parse(epoch);
  if (!Number.isFinite(t)) throw new Error('Invalid UTC epoch');
  return t / 86400000 + 2440587.5;
}

/**
 * Approximate heliocentric equatorial position of a planet in kilometres.
 * JPL low-precision elements; NOT for mission navigation.
 * @param {string} id Planet identifier.
 * @param {number|string} epoch UTC epoch.
 * @returns {number[]} [x,y,z] kilometres, mean equatorial J2000.
 */
export function planetPositionKm(id, epoch) {
  const item = ELEMENTS[id];
  if (!item) throw new Error('Unknown planet ' + id);
  const jd = julianDate(epoch);
  if (jd < 625674.5 || jd > 2816787.5) {
    throw new Error('JPL low-precision elements are valid only approximately 3000 BC to 3000 AD');
  }
  const T = (jd - 2451545) / 36525;
  const [a, e, I, L, peri, node] = item[0].map((v, i) => v + item[1][i] * T);
  const [b, c, s, f] = EXTRA[id] || [0, 0, 0, 0];
  let M = ((L - peri + b * T * T + c * Math.cos(f * T * DEG) + s * Math.sin(f * T * DEG) + 180) % 360 + 360) % 360 - 180;
  M *= DEG;
  let E = M;
  for (let k = 0; k < 20; k++) {
    const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  const x = a * (Math.cos(E) - e);
  const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const o = (peri - node) * DEG, inc = I * DEG, n = node * DEG;
  const co = Math.cos(o), so = Math.sin(o), ci = Math.cos(inc), si = Math.sin(inc);
  const cn = Math.cos(n), sn = Math.sin(n);
  const xe = (co * cn - so * sn * ci) * x + (-so * cn - co * sn * ci) * y;
  const ye = (co * sn + so * cn * ci) * x + (-so * sn + co * cn * ci) * y;
  const ze = so * si * x + co * si * y;
  const eps = 23.43928 * DEG;
  return [xe * AU_KM, (ye * Math.cos(eps) - ze * Math.sin(eps)) * AU_KM, (ye * Math.sin(eps) + ze * Math.cos(eps)) * AU_KM];
}

/** Display-only radial compression of an AU distance (overview mode). */
export function displayDistanceAU(au) {
  return 15.5 * Math.sqrt(Math.max(0, au));
}

/**
 * Scale an equatorial km vector for display: linear in true mode, radially
 * compressed from the Sun in overview mode. Never used for physics.
 * @param {number[]} eqKm @param {string} mode @param {number} kmToView
 * @returns {number[]}
 */
export function displayPlanetVector(eqKm, mode, kmToView) {
  const d = Math.hypot(eqKm[0], eqKm[1], eqKm[2]);
  if (!(d > 0)) return [0, 0, 0];
  const scale = mode === 'true' ? kmToView : displayDistanceAU(d / AU_KM) / d;
  return eqKm.map((v) => v * scale);
}

/** Two-pixel click tolerance test. @param {number} dx @param {number} dy */
export function pickIsClick(dx, dy, thresholdPx = 2) {
  return Math.hypot(dx, dy) <= thresholdPx;
}

/**
 * Wrap a longitude in degrees to [-180, 180].
 * @param {number} lon Longitude in degrees.
 * @returns {number} Wrapped longitude.
 */
export function wrapLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

// ---------------------------------------------------------------------------
// Shared catalogue / moon table
// ---------------------------------------------------------------------------

/**
 * Named moons rendered as children of their parent planet.
 *
 * `textureUrl` is filled in from MOON_DATA (planet-data-sources.mjs) at
 * runtime: our Luna gets the high-resolution NASA map, every other moon either
 * a low-resolution map or a plain colour sphere, so weak hardware stays
 * comfortable. `_mergeMoonTextures()` merges that catalogue below.
 */
const MOON_SPECS = [
  { id: 'moon', name: 'Moon', parent: 'earth', radiusKm: 1737.5, orbitRadiusKm: 384400, periodDays: 27.3217, color: '#99958e' },
  { id: 'phobos', name: 'Phobos', parent: 'mars', radiusKm: 11.3, orbitRadiusKm: 9376, periodDays: 0.31891, color: '#8b8378' },
  { id: 'deimos', name: 'Deimos', parent: 'mars', radiusKm: 6.2, orbitRadiusKm: 23463, periodDays: 1.26244, color: '#9a9286' },
  { id: 'io', name: 'Io', parent: 'jupiter', radiusKm: 1821.6, orbitRadiusKm: 421700, periodDays: 1.769, color: '#d9c27a' },
  { id: 'europa', name: 'Europa', parent: 'jupiter', radiusKm: 1560.8, orbitRadiusKm: 671034, periodDays: 3.551, color: '#cbb89a' },
  { id: 'ganymede', name: 'Ganymede', parent: 'jupiter', radiusKm: 2634.1, orbitRadiusKm: 1070412, periodDays: 7.155, color: '#a89a86' },
  { id: 'callisto', name: 'Callisto', parent: 'jupiter', radiusKm: 2410.3, orbitRadiusKm: 1882709, periodDays: 16.689, color: '#7d7468' },
  { id: 'titan', name: 'Titan', parent: 'saturn', radiusKm: 2574.7, orbitRadiusKm: 1221870, periodDays: 15.945, color: '#d8a85c' },
  { id: 'enceladus', name: 'Enceladus', parent: 'saturn', radiusKm: 252.1, orbitRadiusKm: 238020, periodDays: 1.370, color: '#e8ecef' },
  { id: 'mimas', name: 'Mimas', parent: 'saturn', radiusKm: 198.2, orbitRadiusKm: 185539, periodDays: 0.942, color: '#b9b6ae' },
  { id: 'rhea', name: 'Rhea', parent: 'saturn', radiusKm: 763.8, orbitRadiusKm: 527108, periodDays: 4.518, color: '#c2beb4' },
  { id: 'iapetus', name: 'Iapetus', parent: 'saturn', radiusKm: 734.5, orbitRadiusKm: 3560820, periodDays: 79.32, color: '#8f887c' },
  { id: 'miranda', name: 'Miranda', parent: 'uranus', radiusKm: 235.8, orbitRadiusKm: 129390, periodDays: 1.413, color: '#b9c4c6' },
  { id: 'ariel', name: 'Ariel', parent: 'uranus', radiusKm: 578.9, orbitRadiusKm: 190900, periodDays: 2.520, color: '#c7d0d1' },
  { id: 'umbriel', name: 'Umbriel', parent: 'uranus', radiusKm: 584.7, orbitRadiusKm: 266000, periodDays: 4.144, color: '#7f8b8d' },
  { id: 'titania', name: 'Titania', parent: 'uranus', radiusKm: 788.4, orbitRadiusKm: 436300, periodDays: 8.706, color: '#a9b4b6' },
  { id: 'oberon', name: 'Oberon', parent: 'uranus', radiusKm: 761.4, orbitRadiusKm: 583500, periodDays: 13.463, color: '#98a3a5' },
  { id: 'triton', name: 'Triton', parent: 'neptune', radiusKm: 1353.4, orbitRadiusKm: 354759, periodDays: -5.877, color: '#c9d6dc' },
  { id: 'charon', name: 'Charon', parent: 'pluto', radiusKm: 606, orbitRadiusKm: 19591, periodDays: 6.387, color: '#9a948c' }
];

/**
 * Merge the official moon catalogue from planet-data-sources.mjs into
 * MOON_SPECS so each moon carries its real textureUrl (Luna high-res, the rest
 * low-res or null). Kept defensive: if the catalogue is unavailable the static
 * table above still works.
 */
function mergeMoonTextures() {
  try {
    const ds = (typeof window !== 'undefined' && window.LLP && window.LLP.DataSources) || null;
    const data = ds && Array.isArray(ds.MOON_DATA) ? ds.MOON_DATA : null;
    if (!data) return;
    const byId = new Map(data.map((m) => [m.id, m]));
    for (const spec of MOON_SPECS) {
      const hit = byId.get(spec.id);
      if (hit) {
        spec.textureUrl = hit.textureUrl || null;
        spec.heightmapUrl = hit.heightmapUrl || null;
        if (hit.radiusKm) spec.radiusKm = hit.radiusKm;
        if (hit.orbitRadiusKm) spec.orbitRadiusKm = hit.orbitRadiusKm;
      }
    }
    // Add catalogue moons that are not in the static table yet (Nereid,
    // Proteus, Nix, Hydra, Kerberos, Styx, …). Low-res or colour only.
    const known = new Set(MOON_SPECS.map((m) => m.id));
    for (const m of data) {
      if (known.has(m.id)) continue;
      if (!m.parent || !MOON_SPECS.some((s) => s.parent === m.parent)) continue;
      MOON_SPECS.push({
        id: m.id, name: m.name || m.id, parent: m.parent,
        radiusKm: m.radiusKm || 5, orbitRadiusKm: m.orbitRadiusKm || 50000,
        periodDays: m.periodDays || 1, color: m.color || '#9a9a9a',
        textureUrl: m.textureUrl || null, heightmapUrl: m.heightmapUrl || null
      });
    }
  } catch (e) { /* keep the static table */ }
}
// NOTE: mergeMoonTextures() runs again right before the moons are built, so a
// late-arriving DataSources module is still picked up regardless of import
// order. The first call above covers the common case where the catalogue is
// already published.
mergeMoonTextures();

/** Rocky bodies eligible for near-LOD displacement. */
const DISPLACEMENT_BODIES = new Set(['earth', 'moon', 'mars', 'mercury']);

/** Bodies that receive a procedural cloud shell. */
const CLOUD_BODIES = new Set(['earth', 'venus']);

/** Bodies that receive rings (spec: Saturn, Uranus, Neptune). */
const RING_BODIES = new Set(['saturn', 'uranus', 'neptune']);

/** Bodies that receive an atmospheric rim shell. */
const ATMO_BODIES = new Set(['venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);

export { MOON_SPECS, DISPLACEMENT_BODIES, CLOUD_BODIES, RING_BODIES, ATMO_BODIES };

// ---------------------------------------------------------------------------
// Renderer (lazy THREE)
// ---------------------------------------------------------------------------

let THREE = null; // lazy, set by loadThree()
let OrbitControls = null;

/**
 * Load Three.js from a CDN with a jsDelivr fallback.
 * @returns {Promise<object>} The THREE namespace.
 */
async function loadThree() {
  if (THREE) return THREE;
  const modules = [
    ['https://unpkg.com/three@0.160.0/build/three.module.js', 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js'],
    ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js']
  ];
  let lastErr = null;
  for (const [threeUrl, controlsUrl] of modules) {
    try {
      THREE = await import(threeUrl);
      const c = await import(controlsUrl);
      OrbitControls = c.OrbitControls;
      return THREE;
    } catch (err) {
      lastErr = err;
      THREE = null;
      OrbitControls = null;
    }
  }
  throw new Error('Rendering engine offline - check network connection (' + (lastErr && lastErr.message) + ')');
}

/** True in a browser-like environment. */
function hasDOM() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** Safe access to window.LLP. @returns {object} */
function llp() {
  return (hasDOM() && window.LLP) || {};
}

/** Safe UI toast (English, NASA tone). @param {string} msg */
function toast(msg) {
  try {
    const ui = llp().UI;
    if (ui && typeof ui.showToast === 'function') {
      ui.showToast(msg);
      return;
    }
  } catch (e) { /* ignore */ }
  // eslint-disable-next-line no-console
  console.warn('[Renderer] ' + msg);
}

/**
 * Build a radial-gradient canvas texture for the Sun glow sprite.
 * @param {object} T THREE namespace.
 * @param {number} [size=256] Texture resolution.
 * @returns {object} THREE.CanvasTexture.
 */
function makeGlowTexture(T, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,240,1)');
  g.addColorStop(0.18, 'rgba(255,236,170,0.95)');
  g.addColorStop(0.42, 'rgba(255,190,80,0.35)');
  g.addColorStop(1.0, 'rgba(255,150,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

/**
 * Build a ring alpha map (canvas) with tapered bands and a Cassini-like gap.
 * @param {object} T THREE namespace.
 * @param {number} [size=512] Texture width.
 * @returns {object} THREE.CanvasTexture.
 */
function makeRingAlphaTexture(T, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = 4;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < size; x++) {
    const u = x / size;
    let a = 0.55 + 0.45 * Math.sin(u * 37.0) * Math.sin(u * 11.0 + 1.3);
    if (u > 0.62 && u < 0.67) a *= 0.08;
    a *= Math.min(1, u / 0.08) * Math.min(1, (1 - u) / 0.12);
    a = Math.max(0, Math.min(1, a));
    const v = Math.round(a * 255);
    ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    ctx.fillRect(x, 0, 1, 4);
  }
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.NoColorSpace;
  tex.wrapS = T.ClampToEdgeWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  return tex;
}

/** Atmospheric rim-glow vertex shader (Fresnel on view-space normal). */
const ATMOSPHERE_VERT = `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vViewDir = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

/** Atmospheric rim-glow fragment shader (additive, sun-lit term). */
const ATMOSPHERE_FRAG = `
uniform vec3 color;
uniform float opacity;
uniform vec3 sunDir;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vViewDir);
  float f = pow(1.0 - dot(n, v), 3.0);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 s = normalize(sunDir);
  vec3 halfv = normalize(s + viewDir);
  float lit = 0.25 + 0.75 * max(dot(n, halfv), 0.0);
  gl_FragColor = vec4(color * f * opacity * lit, f * opacity);
}
`;

/**
 * Solar System renderer. All state lives on the instance.
 */
class SolarSystemRenderer {
  /** Create an inert renderer; call init() before build(). */
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.canvas = null;
    this.labelHost = null;
    this.bodies = new Map();
    this.moons = [];
    this.starfield = null;
    this.sunGroup = null;
    this.sunLight = null;
    this.orbitGroup = null;
    this.gridHelper = null;
    this.craterMeshes = [];
    this.atmoMeshes = [];
    this.cloudMeshes = [];
    this.ringMeshes = [];
    this.running = false;
    this.frameId = 0;
    this.lastFrameTime = 0;
    this.lastLodCheck = 0;
    this.lastScaleMode = null;
    this.focusAnim = null;
    this._currentBodyId = 'sun';
    this.disposed = false;
    this.helpers = { computeOrbitRotation, pickLOD, hexToColor3 };
    this._onResize = null;
    this._onContextLost = null;
    this._resizeObserver = null;
  }

  /** @returns {object|null} window.LLP.Scale */
  get scale() { return llp().Scale || null; }

  /** @returns {object|null} window.LLP.Layers */
  get layers() { return llp().Layers || null; }

  /** @returns {object[]} Planet specs from Planets or DataSources. */
  get planetSpecs() {
    const p = llp().Planets;
    if (p && Array.isArray(p.PLANETS) && p.PLANETS.length) return p.PLANETS;
    const d = llp().DataSources;
    if (d && Array.isArray(d.PLANET_DATA)) return d.PLANET_DATA;
    return [];
  }

  /** @returns {string} Active scale mode ('true' | 'diagram'). */
  scaleMode() {
    const s = this.scale;
    try {
      if (s && typeof s.getMode === 'function') {
        const m = s.getMode();
        if (m) return m;
      }
    } catch (e) { /* fall through */ }
    return this.lastScaleMode || 'diagram';
  }

  /** Body radius in world units, preferring the shared Scale API. */
  bodyRadius(id, fallbackRadiusKm) {
    const s = this.scale;
    try {
      if (s && typeof s.bodyRadius === 'function') {
        const r = s.bodyRadius(id);
        if (Number.isFinite(r) && r > 0) return r;
      }
    } catch (e) { /* fall through */ }
    return this._compressedRadius(fallbackRadiusKm);
  }

  /** Orbital radius in world units, preferring the shared Scale API. */
  orbitRadius(id) {
    const s = this.scale;
    try {
      if (s && typeof s.orbitRadius === 'function') {
        const r = s.orbitRadius(id);
        if (Number.isFinite(r) && r > 0) return r;
      }
    } catch (e) { /* fall through */ }
    return this._fallbackOrbitRadius(id);
  }

  /** Compressed radius used when Scale is absent. */
  _compressedRadius(radiusKm) {
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) return 1;
    if (this.scaleMode() === 'true') return radiusKm * (2.5 / 1737.4) * 40;
    return Math.max(0.6, Math.min(6.5, 1.6 * Math.pow(radiusKm / 6371, 0.42)));
  }

  /** Fallback orbital radius via Kepler elements + display compression. */
  _fallbackOrbitRadius(id) {
    const mode = this.scaleMode();
    const kmToView = 2.5 / 1737.4 * 40;
    try {
      const p = planetPositionKm(id, Date.now());
      const v = displayPlanetVector(p, mode, kmToView);
      const r = Math.hypot(v[0], v[1], v[2]);
      if (r > 0) return r;
    } catch (e) { /* fall through */ }
    return id === 'earth' ? 16 : 30;
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * Initialise the WebGL renderer, camera, controls, scene and lighting.
   * @param {HTMLCanvasElement} canvas Target canvas element.
   * @returns {Promise<void>}
   */
  async init(canvas) {
    if (!hasDOM()) throw new Error('Renderer.init requires a browser DOM');
    const T = await loadThree();
    this.canvas = canvas;
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#05070d');

    const box = canvas.parentElement || canvas;
    const width = Math.max(1, box.clientWidth || canvas.clientWidth || 1280);
    const height = Math.max(1, box.clientHeight || canvas.clientHeight || 720);

    this.camera = new T.PerspectiveCamera(55, width / height, 0.01, 50000);
    this.camera.position.set(0, 60, 150);

    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.6;
    this.controls.enablePan = true;
    this.controls.minDistance = 0.05;

    this.scene.add(new T.AmbientLight(0xffffff, 0.06));
    this.scene.add(new T.HemisphereLight(0x8fb4ff, 0x05070d, 0.04));

    this.labelHost = document.createElement('div');
    this.labelHost.className = 'llp-labels';
    this.labelHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    (canvas.parentElement || canvas.parentNode || document.body).appendChild(this.labelHost);

    this._onContextLost = (e) => {
      e.preventDefault();
      toast('WebGL context lost - reload');
      this.stop();
    };
    canvas.addEventListener('webglcontextlost', this._onContextLost, false);

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(canvas.parentElement || canvas);
    }
  }

  /** Resize camera aspect and drawing buffer to the canvas box. */
  _resize() {
    if (!this.renderer || !this.camera || !this.canvas) return;
    const box = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, box.clientWidth || this.canvas.clientWidth || 1280);
    const h = Math.max(1, box.clientHeight || this.canvas.clientHeight || 720);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /**
   * Build the whole scene: starfield, Sun, planets, moons, rings, atmospheres,
   * clouds, craters, orbital trails and reference grid.
   * @returns {Promise<void>}
   */
  async build() {
    if (!this.scene) throw new Error('Renderer.init must complete before build');
    this.lastScaleMode = this.scaleMode();
    this._buildStarfield();
    const specs = this.planetSpecs;
    if (!specs.length) throw new Error('No planet catalogue available (window.LLP.Planets or DataSources)');
    const sunSpec = specs.find((s) => s && s.id === 'sun');
    this._buildSun(sunSpec);
    this._buildLayerGroups();
    for (const spec of specs) {
      if (!spec || !spec.id || spec.id === 'sun') continue;
      this._buildPlanet(spec);
    }
    // Refresh moon textures from the catalogue now that every module is
    // loaded (import order must not decide whether a moon gets its map).
    mergeMoonTextures();
    for (const moon of MOON_SPECS) {
      try { this._buildMoon(moon); }
      catch (e) { console.warn('[solar] moon build failed:', moon && moon.id, e && e.message); }
    }
    this._buildOrbits();
    this._buildGrid();
    this._buildLabels();
    this._warmTextures().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[Renderer] texture warm-up failed:', e && e.message);
    });
  }

  /** Create per-layer THREE.Group containers. */
  _buildLayerGroups() {
    const T = THREE;
    this.orbitGroup = new T.Group();
    this.scene.add(this.orbitGroup);
  }

  /** 5000-point additive starfield plus a soft galactic band. */
  _buildStarfield() {
    const T = THREE;
    const RADIUS = 40000;
    const COUNT = 5000;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    let seed = 20261108;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const n = new T.Vector3(0.42, 0.86, 0.28).normalize();
    const b1 = new T.Vector3(1, 0, 0).cross(n).normalize();
    const b2 = n.clone().cross(b1).normalize();
    for (let i = 0; i < COUNT; i++) {
      let dx, dy, dz;
      if (i < 1800) {
        const theta = rnd() * TAU;
        const spread = (rnd() + rnd() + rnd() - 1.5) * 0.22;
        dx = b1.x * Math.cos(theta) + b2.x * Math.sin(theta) + n.x * spread;
        dy = b1.y * Math.cos(theta) + b2.y * Math.sin(theta) + n.y * spread;
        dz = b1.z * Math.cos(theta) + b2.z * Math.sin(theta) + n.z * spread;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;
      } else {
        const z = 1 - 2 * rnd();
        const t = TAU * rnd();
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        dx = r * Math.cos(t); dy = z; dz = r * Math.sin(t);
      }
      const rad = RADIUS * (0.85 + 0.15 * rnd());
      positions[i * 3] = dx * rad;
      positions[i * 3 + 1] = dy * rad;
      positions[i * 3 + 2] = dz * rad;
      const c = rnd();
      let cr = 1, cg = 1, cb = 1;
      if (c < 0.12) { cr = 1.0; cg = 0.82; cb = 0.62; }
      else if (c < 0.34) { cr = 1.0; cg = 0.94; cb = 0.80; }
      else if (c < 0.62) { cr = 1.0; cg = 1.0; cb = 1.0; }
      else { cr = 0.78; cg = 0.86; cb = 1.0; }
      const br = 0.55 + 0.45 * rnd();
      colors[i * 3] = cr * br;
      colors[i * 3 + 1] = cg * br;
      colors[i * 3 + 2] = cb * br;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.BufferAttribute(colors, 3));
    const mat = new T.PointsMaterial({
      size: 1.5,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: T.AdditiveBlending
    });
    this.starfield = new T.Points(geo, mat);
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);
  }

  /** Emissive Sun sphere + glow sprite + PointLight at the origin. */
  _buildSun(spec) {
    const T = THREE;
    const radius = this.bodyRadius('sun', (spec && spec.radiusKm) || 695700);
    const group = new T.Group();
    group.name = 'sun';
    // Emissive material so the Sun self-illuminates on every side. A plain
    // MeshBasicMaterial looked flat; an emissiveStandard lets us attach the
    // sun.jpg photosphere as an emissiveMap while keeping full brightness.
    const mat = new T.MeshStandardMaterial({
      color: new T.Color('#ffd27a'),
      emissive: new T.Color('#ffcc66'),
      emissiveIntensity: 1.35,
      roughness: 1.0,
      metalness: 0.0
    });
    // Warm the photosphere texture (if present) as an emissiveMap.
    try {
      const loader = new T.TextureLoader();
      loader.setCrossOrigin('anonymous');
      const url = (spec && spec.textureUrl) || '/textures/sun.jpg';
      if (url) {
        const tex = loader.load(url, (t) => {
          t.colorSpace = T.SRGBColorSpace;
          t.wrapS = T.RepeatWrapping;
          t.anisotropy = 4;
          mat.emissiveMap = t;
          mat.map = t;
          mat.color.set('#ffffff');
          mat.needsUpdate = true;
        });
        tex.colorSpace = T.SRGBColorSpace;
        mat.emissiveMap = tex;
        mat.map = tex;
        mat.color.set('#ffffff');
      }
    } catch (e) { /* keep flat emissive colour */ }
    const mesh = new T.Mesh(new T.SphereGeometry(radius, 96, 48), mat);
    mesh.name = 'sun';
    mesh.userData = {
      bodyId: 'sun', radius, isSun: true, baseBumpScale: 0,
      palette: (spec && spec.colorPalette) || ['#fff3b0', '#ffb934', '#ec6f16']
    };
    group.add(mesh);

    const glow = new T.Sprite(new T.SpriteMaterial({
      map: makeGlowTexture(T),
      color: 0xffe9b0,
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false
    }));
    glow.scale.setScalar(radius * 3.0);
    group.add(glow);

    this.sunLight = new T.PointLight(0xffffff, 2.2, 0, 1);
    group.add(this.sunLight);

    this.scene.add(group);
    this.sunGroup = group;
    this.bodies.set('sun', {
      id: 'sun', spec: spec || null, group, mesh, spinPivot: mesh, radius,
      isSun: true, nearMesh: null, farMesh: mesh, rotationHours: 609.12,
      angle: 0, moons: [], palette: mesh.userData.palette, material: mat,
      cloudsMesh: null, atmoMesh: null, craterPoints: null, bumpTex: null,
      labelEl: null
    });
  }

  /** Build one planet: pivot, LOD meshes, rings, atmosphere, clouds, craters. */
  _buildPlanet(spec) {
    const T = THREE;
    const id = spec.id;
    const radius = this.bodyRadius(id, spec.radiusKm);
    const group = new T.Group();
    group.name = id;

    const tiltDeg = Number.isFinite(spec.axialTiltDeg) ? spec.axialTiltDeg : 0;
    const spinPivot = new T.Group();
    spinPivot.rotation.z = -tiltDeg * DEG;
    group.add(spinPivot);

    const palette = (spec.colorPalette && spec.colorPalette.length) ? spec.colorPalette : ['#8a8a8a'];
    // Realistic per-body PBR. Gas giants are fully rough and non-metallic;
    // rocky bodies are rough too, but Earth gets a lower base roughness so
    // oceans catch a specular highlight. Spec fields win, sensible defaults
    // per body id fill the gaps so a missing field never flattens the look.
    const roughDefaults = {
      earth: 0.55, mars: 0.85, mercury: 0.95, moon: 0.95, venus: 1.0,
      jupiter: 1.0, saturn: 1.0, uranus: 1.0, neptune: 1.0
    };
    const baseRoughness = Number.isFinite(spec.roughness)
      ? spec.roughness
      : (roughDefaults[id] != null ? roughDefaults[id] : 0.95);
    const baseMetalness = Number.isFinite(spec.metalness) ? spec.metalness : 0.02;
    const material = new T.MeshStandardMaterial({
      color: new T.Color(palette[0]),
      roughness: baseRoughness,
      metalness: baseMetalness,
      bumpScale: spec.bumpScale || 0
    });
    const farMesh = new T.Mesh(new T.SphereGeometry(radius, 64, 32), material);
    farMesh.name = id;
    farMesh.userData = { bodyId: id, radius, baseBumpScale: spec.bumpScale || 0 };
    spinPivot.add(farMesh);

    const rec = {
      id, spec, group, spinPivot, mesh: farMesh, farMesh, nearMesh: null, radius,
      isSun: false, isMoon: false, rotationHours: spec.rotationPeriodHours || 24,
      angle: 0, moons: [], palette, material, cloudsMesh: null, atmoMesh: null,
      craterPoints: null, ringMesh: null, bumpTex: null, labelEl: null,
      baseRoughness, baseMetalness, normalTex: null, specularTex: null
    };

    if (RING_BODIES.has(id) && spec.rings) {
      const inner = radius * (spec.rings.inner || 1.2);
      const outer = radius * (spec.rings.outer || 2.3);
      const ringGeo = new T.RingGeometry(inner, outer, 128, 1);
      const pos = ringGeo.attributes.position;
      const uv = ringGeo.attributes.uv;
      const v3 = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v3.fromBufferAttribute(pos, i);
        const r = v3.length();
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      uv.needsUpdate = true;
      const rc = hexToColor3(spec.rings.color || '#c8b894');
      const ringMat = new T.MeshStandardMaterial({
        color: new T.Color(rc[0], rc[1], rc[2]),
        alphaMap: makeRingAlphaTexture(T),
        transparent: true,
        side: T.DoubleSide,
        roughness: 0.9,
        metalness: 0,
        depthWrite: false
      });
      const ringMesh = new T.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      spinPivot.add(ringMesh);
      this.ringMeshes.push(ringMesh);
      rec.ringMesh = ringMesh;
    }

    if (ATMO_BODIES.has(id) && (spec.atmosphereOpacity || 0) > 0) {
      const atmoMat = new T.ShaderMaterial({
        uniforms: {
          color: { value: new T.Color(spec.atmosphereColor || palette[0]) },
          opacity: { value: Math.min(1, (spec.atmosphereOpacity || 0.2) * 2.2) },
          sunDir: { value: new T.Vector3(1, 0, 0) }
        },
        vertexShader: ATMOSPHERE_VERT,
        fragmentShader: ATMOSPHERE_FRAG,
        side: T.BackSide,
        blending: T.AdditiveBlending,
        transparent: true,
        depthWrite: false
      });
      const atmoMesh = new T.Mesh(new T.SphereGeometry(radius * 1.045, 64, 32), atmoMat);
      atmoMesh.userData = { isAtmosphere: true, bodyId: id };
      group.add(atmoMesh);
      this.atmoMeshes.push(atmoMesh);
      rec.atmoMesh = atmoMesh;
    }

    if (CLOUD_BODIES.has(id)) {
      const cloudMat = new T.MeshStandardMaterial({
        color: new T.Color(id === 'venus' ? '#f2e2c0' : '#ffffff'),
        transparent: true,
        opacity: id === 'venus' ? 0.55 : 0.42,
        roughness: 1,
        metalness: 0,
        depthWrite: false
      });
      const cloudsMesh = new T.Mesh(new T.SphereGeometry(radius * 1.01, 64, 32), cloudMat);
      cloudsMesh.userData = { isClouds: true, bodyId: id, textureId: id === 'earth' ? '2k_earth_clouds.jpg' : null };
      spinPivot.add(cloudsMesh);
      this.cloudMeshes.push(cloudsMesh);
      rec.cloudsMesh = cloudsMesh;
    }

    if (DISPLACEMENT_BODIES.has(id) || id === 'venus') {
      try {
        const terrain = llp().Terrain;
        if (terrain && typeof terrain.buildCraterField === 'function') {
          const points = terrain.buildCraterField({ ...spec, radiusKm: radius }, 500);
          // buildCraterField returns a real THREE.Points only when its shared
          // THREE is wired up; otherwise it returns a DOM-less descriptor that
          // must NOT be added to the scene graph.
          if (points && points.isObject3D) {
            points.userData = points.userData || {};
            points.userData.bodyId = id;
            spinPivot.add(points);
            this.craterMeshes.push(points);
            rec.craterPoints = points;
          }
        }
      } catch (e) { /* craters are decorative */ }
    }

    this.scene.add(group);
    this.bodies.set(id, rec);
  }

  /** Build a moon as a child of its parent planet group. */
  _buildMoon(moonSpec) {
    const T = THREE;
    const parent = this.bodies.get(moonSpec.parent);
    if (!parent) return;
    const trueScale = this.scaleMode() === 'true';
    const baseR = this.bodyRadius(moonSpec.id, moonSpec.radiusKm);
    // True scale keeps the real radius; overview enlarges tiny moons so they
    // remain visible and clickable.
    const radius = trueScale ? Math.max(baseR, 1e-6) : Math.max(0.12, baseR * 0.6);
    const orbitR = this._moonOrbitRadius(moonSpec);
    const BIG_MOONS = new Set(['moon', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'triton', 'charon']);
    const isBigMoon = BIG_MOONS.has(moonSpec.id);
    const bump = Number.isFinite(moonSpec.bumpScale) && moonSpec.bumpScale > 0
      ? moonSpec.bumpScale
      : (isBigMoon ? 0.03 : 0);
    const material = new T.MeshStandardMaterial({
      color: new T.Color(moonSpec.color || '#9a9a9a'),
      roughness: 0.95,
      metalness: 0.02,
      bumpScale: bump
    });
    // Load the official moon texture: Luna high-res, all other moons low-res.
    const moonTex = moonSpec.textureUrl || (moonSpec.id === 'moon' ? '/textures/moon.jpg' : null);
    if (moonTex) {
      try {
        const loader = new T.TextureLoader();
        loader.setCrossOrigin('anonymous');
        // Start the request immediately and assign the map before the first
        // render so a tiny/culled moon still receives its official texture.
        const tex = loader.load(moonTex, (t) => {
          t.colorSpace = T.SRGBColorSpace;
          t.anisotropy = 4;
          material.map = t;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        });
        tex.colorSpace = T.SRGBColorSpace;
        tex.anisotropy = 4;
        material.map = tex;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      } catch (e) { /* keep colour fallback */ }
    }
    // The Moon carries the real LOLA elevation; attach it as a bump map so its
    // craters and maria catch light. Other big moons stay smooth (no DEM).
    if (isBigMoon && moonSpec.id === 'moon' && moonSpec.heightmapUrl) {
      try {
        const bumpLoader = new T.TextureLoader();
        bumpLoader.setCrossOrigin('anonymous');
        const btex = bumpLoader.load(moonSpec.heightmapUrl, (t) => {
          t.colorSpace = T.NoColorSpace;
          t.wrapS = T.RepeatWrapping;
          t.wrapT = T.ClampToEdgeWrapping;
          material.bumpMap = t;
          material.bumpScale = 0.06;
          material.needsUpdate = true;
        });
        btex.colorSpace = T.NoColorSpace;
        btex.wrapS = T.RepeatWrapping;
        btex.wrapT = T.ClampToEdgeWrapping;
        material.bumpMap = btex;
        material.bumpScale = 0.06;
        material.needsUpdate = true;
      } catch (e) { /* ignore */ }
    }
    const seg = moonSpec.id === 'moon' ? 64 : 24;
    const mesh = new T.Mesh(new T.SphereGeometry(radius, seg, Math.round(seg / 2)), material);
    mesh.name = moonSpec.id;
    mesh.userData = { bodyId: moonSpec.id, radius, isMoon: true, parent: moonSpec.parent, baseBumpScale: 0, textureUrl: moonTex };
    const pivot = new T.Group();
    pivot.rotation.x = 0.09 * (moonSpec.id.charCodeAt(0) % 5);
    pivot.add(mesh);
    parent.group.add(pivot);
    this.moons.push({
      spec: moonSpec, mesh, pivot, parent, radius, orbitR,
      periodDays: moonSpec.periodDays, angle: (moonSpec.id.length * 1.7) % TAU
    });
    parent.moons.push(moonSpec.id);
    this.bodies.set(moonSpec.id, {
      id: moonSpec.id, spec: moonSpec, group: pivot, spinPivot: mesh, mesh, radius,
      isMoon: true, isSun: false, nearMesh: null, farMesh: mesh,
      rotationHours: 655.7, angle: 0, moons: [], palette: [moonSpec.color],
      material, cloudsMesh: null, atmoMesh: null, craterPoints: null, bumpTex: null,
      labelEl: null
    });
  }

  /** Moon orbital radius respecting the active scale mode. */
  _moonOrbitRadius(moonSpec) {
    const parentR = this.bodyRadius(moonSpec.parent, 6371);
    if (this.scaleMode() === 'true') {
      // TRUE SCALE: exact physical centre distance in scene units (1 unit =
      // 1,000 km). No parent-radius floor any more — that floor was what made
      // the Moon look glued to Earth. Earth's Moon: 384.4 units vs 6.37-unit
      // Earth = the real 60.3:1 ratio.
      return moonSpec.orbitRadiusKm / 1000;
    }
    // Overview: log-compressed so every moon stays visible next to its planet.
    const rel = moonSpec.orbitRadiusKm / 384400;
    return parentR * (2.2 + Math.log10(1 + rel * 10) * 1.4);
  }

  /** Rebuild planet pivot positions and orbital trail lines for current mode. */
  _buildOrbits() {
    const T = THREE;
    const mode = this.scaleMode();
    while (this.orbitGroup.children.length) {
      const c = this.orbitGroup.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    const now = Date.now();
    const kmToView = 2.5 / 1737.4 * 40;
    for (const [id, rec] of this.bodies) {
      if (rec.isSun || rec.isMoon) continue;
      if (!ELEMENTS[id]) continue;
      let pos = null;
      try {
        pos = displayPlanetVector(planetPositionKm(id, now), mode, kmToView);
      } catch (e) { pos = null; }
      if (!pos) pos = [this.orbitRadius(id), 0, 0];
      rec.group.position.set(pos[0], pos[1], pos[2]);
      rec.orbitPos = pos.slice();

      const periodDays = ORBIT_PERIOD_DAYS[id] || 365.25;
      const pts = [];
      const SAMPLES = 256;
      for (let i = 0; i < SAMPLES; i++) {
        const t = now - (i / SAMPLES) * periodDays * 86400000;
        try {
          const v = displayPlanetVector(planetPositionKm(id, t), mode, kmToView);
          pts.push(new T.Vector3(v[0], v[1], v[2]));
        } catch (e) { break; }
      }
      if (pts.length > 2) {
        const geo = new T.BufferGeometry().setFromPoints(pts);
        const mat = new T.LineBasicMaterial({
          color: new T.Color(rec.palette[0] || '#6f86b5'),
          transparent: true,
          opacity: 0.28,
          depthWrite: false
        });
        const line = new T.LineLoop(geo, mat);
        line.userData = { orbitOf: id };
        this.orbitGroup.add(line);
      }
    }
    for (const m of this.moons) m.orbitR = this._moonOrbitRadius(m.spec);
    this.lastScaleMode = mode;
  }

  /** Reference grid sized to Neptune's orbital radius (layer 'grid'). */
  _buildGrid() {
    const T = THREE;
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      this.gridHelper.material.dispose();
      this.gridHelper = null;
    }
    const size = this.orbitRadius('neptune') * 2.1;
    const grid = new T.GridHelper(size, 32, 0x1a2338, 0x0d1526);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    grid.visible = this._layerOn('grid', false);
    this.gridHelper = grid;
    this.scene.add(grid);
  }

  /** Create one HTML label div per body (once). */
  _buildLabels() {
    for (const [id, rec] of this.bodies) {
      const el = document.createElement('div');
      el.className = 'llp-label';
      el.dataset.bodyId = id;
      el.textContent = (rec.spec && rec.spec.name) || id.charAt(0).toUpperCase() + id.slice(1);
      el.style.cssText = 'position:absolute;transform:translate(-50%,-140%);'
        + 'font:500 11px/1.2 Inter,system-ui,sans-serif;color:#cfe0f5;'
        + 'text-shadow:0 1px 3px #000,0 0 6px #000a;white-space:nowrap;'
        + 'pointer-events:none;letter-spacing:.02em;opacity:.88;';
      this.labelHost.appendChild(el);
      rec.labelEl = el;
    }
  }

  /**
   * Asynchronously warm albedo / cloud textures and swap them into materials.
   * Placeholder palette colours remain until each texture resolves.
   * @returns {Promise<void>}
   */
  async _warmTextures() {
    const T = THREE;
    const data = llp().DataSources;
    const loader = new T.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const TEXTURE_TIMEOUT_MS = 15000;
    const load = (url) => new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('texture timeout: ' + url)); }
      }, TEXTURE_TIMEOUT_MS);
      loader.load(url, (tex) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(tex); }
      }, undefined, (err) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(err); }
      });
    });
    const jobs = [];
    const prep = (tex, aniso) => {
      tex.colorSpace = T.SRGBColorSpace;
      tex.wrapS = T.RepeatWrapping;
      tex.wrapT = T.ClampToEdgeWrapping;
      tex.anisotropy = aniso;
      tex.needsUpdate = true;
    };
    for (const [id, rec] of this.bodies) {
      const spec = rec.spec || {};
      const candidates = data && typeof data.getTextureCandidates === 'function'
        ? data.getTextureCandidates(spec.textureId || id) : [];
      const url = spec.textureUrl || candidates[0] || null;
      if (!url) continue;
      jobs.push(load(url).then((tex) => {
        prep(tex, 8);
        rec.material.map = tex;
        rec.material.color.set('#ffffff');
        rec.material.needsUpdate = true;
        // The near-LOD material is a clone; keep both in sync.
        if (rec.nearMesh && rec.nearMesh.material && rec.nearMesh.material !== rec.material) {
          rec.nearMesh.material.map = tex;
          rec.nearMesh.material.color.set('#ffffff');
          rec.nearMesh.material.needsUpdate = true;
        }
        rec.textureLoaded = true;
      }).catch(() => { /* keep placeholder colour */ }));

      // Normal map (linear colour space) – this is what makes craters/oceans
      // read as 3-D relief instead of a flat photo. Earth has a real file.
      const normalUrl = spec.normalMapUrl || (id === 'earth' ? '/textures/earth_normal.jpg' : null);
      if (normalUrl) {
        jobs.push(load(normalUrl).then((tex) => {
          tex.colorSpace = T.NoColorSpace;
          tex.wrapS = T.RepeatWrapping;
          tex.wrapT = T.ClampToEdgeWrapping;
          tex.anisotropy = 8;
          tex.needsUpdate = true;
          rec.normalTex = tex;
          const apply = (mat) => {
            if (!mat) return;
            mat.normalMap = tex;
            mat.normalScale = new T.Vector2(1, 1);
            mat.needsUpdate = true;
          };
          apply(rec.material);
          if (rec.nearMesh && rec.nearMesh.material && rec.nearMesh.material !== rec.material) {
            apply(rec.nearMesh.material);
          }
        }).catch(() => { /* no normal map */ }));
      }

      // Specular / roughness map: ocean + ice highlights on Earth/Mars.
      const specUrl = spec.specularMapUrl || spec.roughnessMapUrl || null;
      if (specUrl) {
        jobs.push(load(specUrl).then((tex) => {
          tex.colorSpace = T.NoColorSpace;
          tex.wrapS = T.RepeatWrapping;
          tex.wrapT = T.ClampToEdgeWrapping;
          tex.anisotropy = 4;
          tex.needsUpdate = true;
          rec.specularTex = tex;
          const apply = (mat) => {
            if (!mat) return;
            mat.roughnessMap = tex;
            mat.needsUpdate = true;
          };
          apply(rec.material);
          if (rec.nearMesh && rec.nearMesh.material && rec.nearMesh.material !== rec.material) {
            apply(rec.nearMesh.material);
          }
        }).catch(() => { /* no spec map */ }));
      }
    }
    if (jobs.length) await Promise.allSettled(jobs);
  }

  /**
   * Build (once) and show the high-resolution near-LOD mesh, optionally with
   * procedural displacement for rocky bodies that expose a heightmap URL.
   * @param {object} rec Body record.
   */
  _ensureNearMesh(rec) {
    if (rec.nearMesh) return;
    const T = THREE;
    const geo = new T.SphereGeometry(rec.radius, 256, 128);
    const spec = rec.spec || {};
    // Real depth for every rocky DISPLACEMENT_BODY. With a heightmapUrl this is
    // a true DEM; without one, buildBump() falls back to a procedural relief so
    // Earth/Mercury/Mars are never flat spheres (user requirement: see craters).
    if (DISPLACEMENT_BODIES.has(rec.id)) {
      const material = rec.material.clone();
      // Preserve an already-warmed albedo map on the cloned material.
      if (rec.material.map) {
        material.map = rec.material.map;
        material.color.set('#ffffff');
        material.needsUpdate = true;
      }
      const terrain = llp().Terrain;
      if (terrain && typeof terrain.buildBump === 'function') {
        terrain.buildBump(spec).then((tex) => {
          if (tex) {
            material.bumpMap = tex;
            material.bumpScale = spec.bumpScale || 0.6;
            material.needsUpdate = true;
            rec.bumpTex = tex;
          }
        }).catch(() => { /* ignore */ });
      }
      if (terrain && typeof terrain.buildDisplacement === 'function') {
        try {
          terrain.buildDisplacement(geo, spec).then((dispGeo) => {
            if (dispGeo && rec.nearMesh) {
              rec.nearMesh.geometry.dispose();
              rec.nearMesh.geometry = dispGeo;
            }
          }).catch(() => { /* keep smooth sphere */ });
        } catch (e) { /* ignore */ }
      }
      rec.nearMesh = new T.Mesh(geo, material);
    } else {
      rec.nearMesh = new T.Mesh(geo, rec.material);
    }
    rec.nearMesh.name = rec.id;
    rec.nearMesh.userData = { bodyId: rec.id, radius: rec.radius, baseBumpScale: spec.bumpScale || 0 };
    rec.spinPivot.add(rec.nearMesh);
    if (rec.cloudsMesh) { rec.spinPivot.remove(rec.cloudsMesh); rec.spinPivot.add(rec.cloudsMesh); }
    if (rec.craterPoints) { rec.spinPivot.remove(rec.craterPoints); rec.spinPivot.add(rec.craterPoints); }
    if (rec.ringMesh) { rec.spinPivot.remove(rec.ringMesh); rec.spinPivot.add(rec.ringMesh); }
  }

  // -- render-loop updates --------------------------------------------------

  /** Swap near/far visibility based on camera distance (throttled to 500 ms). */
  _updateLOD(now) {
    if (now - this.lastLodCheck < 500) return;
    this.lastLodCheck = now;
    const cam = this.camera.position;
    for (const [, rec] of this.bodies) {
      if (rec.isSun || rec.isMoon) continue;
      const wp = rec.group.position;
      const d = Math.hypot(cam.x - wp.x, cam.y - wp.y, cam.z - wp.z);
      if (pickLOD(d, rec.radius) === 'near') {
        this._ensureNearMesh(rec);
        rec.farMesh.visible = false;
        rec.nearMesh.visible = true;
        rec.mesh = rec.nearMesh;
      } else {
        rec.farMesh.visible = true;
        if (rec.nearMesh) rec.nearMesh.visible = false;
        rec.mesh = rec.farMesh;
      }
    }
  }

  /** Advance moon orbital angles and positions. @param {number} dtSec */
  _updateMoons(dtSec) {
    for (const m of this.moons) {
      const omega = TAU / (m.periodDays * 86400);
      m.angle += omega * dtSec;
      m.mesh.position.set(Math.cos(m.angle) * m.orbitR, 0, -Math.sin(m.angle) * m.orbitR);
      m.mesh.rotation.y = -m.angle;
    }
  }

  /** Spin bodies and refresh atmosphere sun-direction uniforms. */
  _updateSpin(dtSec) {
    for (const [, rec] of this.bodies) {
      rec.angle += computeOrbitRotation(rec.rotationHours, dtSec);
      if (!rec.isSun) rec.spinPivot.rotation.y = rec.angle;
      else rec.mesh.rotation.y = rec.angle;
      if (rec.atmoMesh) {
        const wp = rec.group.position;
        rec.atmoMesh.material.uniforms.sunDir.value.set(-wp.x, -wp.y, -wp.z).normalize();
      }
    }
  }

  /** Project body positions to screen space and update HTML labels. */
  _updateLabels() {
    if (!this.labelHost || !this.canvas) return;
    const showLabels = this._layerOn('labels', true);
    const v = new THREE.Vector3();
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    for (const [, rec] of this.bodies) {
      const el = rec.labelEl;
      if (!el) continue;
      if (!showLabels) { el.style.display = 'none'; continue; }
      rec.group.getWorldPosition(v);
      const dist = v.distanceTo(this.camera.position);
      v.project(this.camera);
      if (v.z > 1 || dist < rec.radius * 1.05) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.left = ((v.x * 0.5 + 0.5) * cw) + 'px';
      el.style.top = ((-v.y * 0.5 + 0.5) * ch) + 'px';
      el.style.opacity = String(Math.max(0.35, Math.min(0.95, 6 * rec.radius / Math.max(rec.radius, dist))));
    }
  }

  /** Rebuild orbits and grid when the shared Scale mode changed. */
  _checkScaleMode() {
    if (this.scaleMode() !== this.lastScaleMode) {
      this._buildOrbits();
      this._buildGrid();
      for (const m of this.moons) m.orbitR = this._moonOrbitRadius(m.spec);
    }
  }

  /** Read a layer flag from the shared Layers API with a default. */
  _layerOn(layerId, def) {
    const L = this.layers;
    try {
      if (L && typeof L.isOn === 'function') {
        const v = L.isOn(layerId);
        if (typeof v === 'boolean') return v;
      }
    } catch (e) { /* fall through */ }
    return def;
  }

  /** Advance the focus camera tween. @returns {boolean} true while animating */
  _updateFocus() {
    const anim = this.focusAnim;
    if (!anim) return false;
    const t = Math.min(1, (performance.now() - anim.start) / anim.duration);
    const k = easeInOutCubic(t);
    const target = anim.fromTarget.clone().lerp(anim.toTarget, k);
    const offset = anim.fromOffset.clone().lerp(anim.toOffset, k);
    this.camera.position.copy(target).add(offset);
    this.controls.target.copy(target);
    if (t >= 1) this.focusAnim = null;
    return true;
  }

  /** Render-loop body. @param {number} now performance.now() timestamp */
  _frame(now) {
    if (!this.running) return;
    // Re-arm through the bound reference so `this` survives every rAF hop
    // (an unbound this._frame loses its context in strict ES modules).
    this.frameId = requestAnimationFrame(this._boundFrame || this._frame);
    const dt = Math.min((now - (this.lastFrameTime || now)) / 1000, 0.1);
    this.lastFrameTime = now;
    this._checkScaleMode();
    this._updateFocus();
    this._updateLOD(now);
    this._updateSpin(dt);
    this._updateMoons(dt);
    this.controls.update();
    this._updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  /** Start the requestAnimationFrame render loop. */
  start() {
    if (!this.renderer || this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    // Bind once so the rAF callback keeps `this` (ES-module strict mode would
    // otherwise hand `_frame` an undefined context and crash on this.running).
    if (!this._boundFrame) this._boundFrame = this._frame.bind(this);
    this.frameId = requestAnimationFrame(this._boundFrame);
  }

  /** Stop the render loop and release GPU/DOM resources. */
  stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this._dispose();
  }

  /** Release geometries, materials, textures, listeners and the label host. */
  _dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.labelHost && this.labelHost.parentNode) this.labelHost.parentNode.removeChild(this.labelHost);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._resizeObserver) { try { this._resizeObserver.disconnect(); } catch (e) { /* ignore */ } }
    if (this._onContextLost && this.canvas) this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (!m) continue;
            for (const key of ['map', 'bumpMap', 'alphaMap']) {
              if (m[key] && typeof m[key].dispose === 'function') m[key].dispose();
            }
            if (typeof m.dispose === 'function') m.dispose();
          }
        }
      });
    }
    try {
      const terrain = llp().Terrain;
      if (terrain && typeof terrain.disposeTerrainCache === 'function') terrain.disposeTerrainCache();
    } catch (e) { /* ignore */ }
    this.bodies.clear();
    this.moons.length = 0;
    if (this.renderer) this.renderer.dispose();
    this.renderer = null;
    this.scene = null;
    this.controls = null;
    this.camera = null;
  }

  // -- public API -----------------------------------------------------------

  /**
   * Ease the camera to a body over 800 ms and set it as the current target.
   * @param {string} id Body identifier.
   * @param {number} [distanceMultiplier=4] Camera standoff in body radii.
   */
  focusBody(id, distanceMultiplier = 4) {
    const rec = this.bodies.get(id);
    if (!rec || !this.camera) return;
    const toTarget = new THREE.Vector3();
    rec.group.getWorldPosition(toTarget);
    const fromTarget = this.controls.target.clone();
    const fromOffset = this.camera.position.clone().sub(fromTarget);
    const dir = fromOffset.lengthSq() > 1e-9
      ? fromOffset.clone().normalize()
      : new THREE.Vector3(0.4, 0.35, 1).normalize();
    const dist = Math.max(rec.radius * distanceMultiplier, rec.radius + 0.2);
    this._currentBodyId = id;
    this.focusAnim = {
      start: performance.now(), duration: 800,
      fromTarget, toTarget, fromOffset,
      toOffset: dir.multiplyScalar(dist)
    };
  }

  /**
   * Zoom the camera to a coarse framing level.
   * 0 overview (whole system) · 1 solar system · 2 planet · 3 near-surface.
   * @param {number} level 0..3
   */
  zoomTo(level) {
    if (!this.camera || !this.controls) return;
    const lv = Math.max(0, Math.min(3, Math.floor(level)));
    let targetId = this._currentBodyId || 'sun';
    let dist;
    if (lv === 0) { targetId = 'sun'; dist = this.orbitRadius('neptune') * 2.4; }
    else if (lv === 1) { targetId = 'sun'; dist = this.orbitRadius('saturn') * 1.35; }
    else {
      const rec = this.bodies.get(targetId) || this.bodies.get('earth');
      if (!rec) return;
      targetId = rec.id;
      // Level 3 hovers just above the surface: 0.02 * radius altitude.
      dist = lv === 3 ? rec.radius * 1.02 : rec.radius * 4;
    }
    const rec = this.bodies.get(targetId);
    if (!rec) return;
    this._currentBodyId = targetId;
    const toTarget = new THREE.Vector3();
    rec.group.getWorldPosition(toTarget);
    const fromTarget = this.controls.target.clone();
    const fromOffset = this.camera.position.clone().sub(fromTarget);
    const dir = fromOffset.lengthSq() > 1e-9
      ? fromOffset.clone().normalize()
      : new THREE.Vector3(0.4, 0.35, 1).normalize();
    this.focusAnim = {
      start: performance.now(), duration: 800,
      fromTarget, toTarget, fromOffset,
      toOffset: dir.multiplyScalar(Math.max(dist, 0.05))
    };
  }

  /** @returns {string} Currently focused body id. */
  currentBodyId() {
    return this._currentBodyId;
  }

  /**
   * Toggle a named layer.
   * @param {string} layerId terrain|craters|mountains|atmosphere|clouds|orbits|labels|grid|rings
   * @param {boolean} on
   */
  setLayer(layerId, on) {
    const visible = !!on;
    switch (layerId) {
      case 'craters':
        for (const m of this.craterMeshes) m.visible = visible;
        break;
      case 'atmosphere':
        for (const m of this.atmoMeshes) m.visible = visible;
        break;
      case 'clouds':
        for (const m of this.cloudMeshes) m.visible = visible;
        break;
      case 'orbits':
        if (this.orbitGroup) this.orbitGroup.visible = visible;
        break;
      case 'rings':
        for (const m of this.ringMeshes) m.visible = visible;
        break;
      case 'labels':
        if (this.labelHost) this.labelHost.style.display = visible ? '' : 'none';
        break;
      case 'grid':
        if (this.gridHelper) this.gridHelper.visible = visible;
        break;
      case 'mountains':
      case 'terrain':
        for (const [, rec] of this.bodies) {
          if (!rec.material) continue;
          const base = (rec.farMesh.userData && rec.farMesh.userData.baseBumpScale) || 0;
          rec.material.bumpScale = visible ? base : 0;
          if (layerId === 'terrain') rec.material.bumpMap = visible ? rec.bumpTex || rec.material.bumpMap : null;
          rec.material.needsUpdate = true;
        }
        break;
      default:
        break;
    }
  }

  /**
   * @param {string} id Body identifier.
   * @returns {object} THREE.Mesh for the body (near LOD if built).
   */
  getBodyMesh(id) {
    const rec = this.bodies.get(id);
    return rec ? rec.mesh : null;
  }

  /**
   * Raycast the canvas and return the clicked body plus surface lat/lon.
   * lat = asin(y), lon = atan2(-z, x) in degrees, lon wrapped to [-180, 180].
   * @param {MouseEvent} event
   * @returns {{bodyId:string,lat:number,lon:number}|null}
   */
  raycastBody(event) {
    if (!this.camera || !this.canvas) return null;
    const T = THREE;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new T.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new T.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const targets = [];
    for (const [, rec] of this.bodies) {
      if (rec.mesh && rec.mesh.visible) targets.push(rec.mesh);
    }
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const mesh = hits[0].object;
    const local = mesh.worldToLocal(hits[0].point.clone()).normalize();
    return {
      bodyId: mesh.userData.bodyId,
      lat: Math.asin(Math.max(-1, Math.min(1, local.y))) / DEG,
      lon: wrapLon(Math.atan2(-local.z, local.x) / DEG)
    };
  }
}

/** Shared singleton used by window.LLP.Renderer. */
export const renderer = new SolarSystemRenderer();

const RendererAPI = {
  init: (canvas) => renderer.init(canvas),
  build: () => renderer.build(),
  start: () => renderer.start(),
  stop: () => renderer.stop(),
  focusBody: (id, mult) => renderer.focusBody(id, mult),
  zoomTo: (level) => renderer.zoomTo(level),
  currentBodyId: () => renderer.currentBodyId(),
  setLayer: (layerId, on) => renderer.setLayer(layerId, on),
  getBodyMesh: (id) => renderer.getBodyMesh(id),
  raycastBody: (event) => renderer.raycastBody(event),
  helpers: { computeOrbitRotation, pickLOD, hexToColor3 },
  instance: renderer
};

if (hasDOM()) {
  window.LLP = window.LLP || {};
  window.LLP.Renderer = Object.assign({}, window.LLP.Renderer, RendererAPI);
}

export const helpers = { computeOrbitRotation, pickLOD, hexToColor3 };

// ---------------------------------------------------------------------------
// Legacy exports required by static/app.js (rotation phase, year shifting,
// route ranking). Kept for backward compatibility after the renderer rewrite.
// ---------------------------------------------------------------------------

/** Julian centuries since J2000 for a UTC ISO string. */
function _utcToMillis(utc) {
  if (utc instanceof Date) return utc.getTime();
  if (typeof utc === 'number') return utc;
  const t = Date.parse(String(utc));
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * Accumulated mean axial rotation phase of a body at a given UTC epoch.
 * Zero phase is arbitrary (not the IAU prime meridian); only the difference
 * between two epochs is meaningful, as an illustrative spin angle.
 * @param {string} bodyId  e.g. 'earth', 'mars', 'sun', 'moon'
 * @param {string|number|Date} utc
 * @returns {number} rotation angle in degrees, 0..360
 */
export function rotationAngleDeg(bodyId, utc) {
  const model = ROTATION_MODELS[bodyId];
  if (!model || !Number.isFinite(model.hours) || model.hours === 0) return 0;
  const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0); // 2000-01-01T12:00:00Z
  const ms = _utcToMillis(utc) - J2000_MS;
  const hoursElapsed = ms / 3_600_000;
  const turns = hoursElapsed / model.hours;
  let deg = (turns * 360) % 360;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Shift a UTC ISO timestamp by a whole number of calendar years.
 * Feb 29 → Feb 28 in non-leap target years (calendar-safe clamping).
 * Preserves the time-of-day component when present.
 * @param {string} utcIso
 * @param {number} years  integer, positive or negative
 * @returns {string} ISO-8601 UTC string (e.g. '2027-03-15T12:00:00.000Z')
 */
export function shiftUTCYears(utcIso, years) {
  const n = Number(years);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error('Year offset must be an integer.');
  }
  const hasTime = typeof utcIso === 'string' && utcIso.includes('T');
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) throw new Error('Invalid UTC date: ' + utcIso);
  const year = d.getUTCFullYear() + n;
  const month = d.getUTCMonth();
  let day = d.getUTCDate();
  if (month === 1 && day === 29) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    if (!leap) day = 28;
  }
  const shifted = new Date(Date.UTC(
    year, month, day,
    hasTime ? d.getUTCHours() : 0,
    hasTime ? d.getUTCMinutes() : 0,
    hasTime ? d.getUTCSeconds() : 0,
    hasTime ? d.getUTCMilliseconds() : 0
  ));
  return shifted.toISOString();
}

/**
 * Rank Earth→Moon transfer candidates by user preference.
 * Preference keys (matching #routePreference in index.html):
 *   'balanced'       – primary: composite .score
 *   'fastest'        – primary: shortest flight time (hours)
 *   'lowest_delta_v' – primary: smallest departure Δv (deltaVkmS)
 *   'sunlight'       – primary: highest Sun clearance at lunar site
 * @param {Array} routes
 * @param {string} preference
 * @returns {Array} sorted copy
 */
export function rankRoutes(routes, preference) {
  if (!Array.isArray(routes)) return [];
  const pref = String(preference || 'balanced');
  const arr = routes.slice();
  const cmp = (a, b) => {
    switch (pref) {
      case 'fastest':
        return (a.hours ?? Infinity) - (b.hours ?? Infinity);
      case 'lowest_delta_v':
        return (a.deltaVkmS ?? Infinity) - (b.deltaVkmS ?? Infinity);
      case 'sunlight':
        return (b.terrainSunClear ?? -Infinity) - (a.terrainSunClear ?? -Infinity);
      case 'balanced':
      default:
        return (b.score ?? -Infinity) - (a.score ?? -Infinity);
    }
  };
  arr.sort(cmp);
  return arr;
}

export default RendererAPI;
