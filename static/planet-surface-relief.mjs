// @module planet-surface-relief
// Procedural planetary surface relief using FBM noise and geometry displacement.

const RELIEF_DATA = {
  mercury: { amplitudeKm: 3.0, baseFrequency: 6, octaves: 4, lacunarity: 2.0, gain: 0.5 },
  venus: { amplitudeKm: 11.0, baseFrequency: 6, octaves: 5, lacunarity: 2.0, gain: 0.5 },
  earth: { amplitudeKm: 8.8, baseFrequency: 8, octaves: 6, lacunarity: 2.0, gain: 0.5 },
  mars: { amplitudeKm: 22.0, baseFrequency: 8, octaves: 6, lacunarity: 2.0, gain: 0.5 },
  jupiter: { amplitudeKm: 0.0, baseFrequency: 4, octaves: 4, lacunarity: 2.0, gain: 0.5 },
  saturn: { amplitudeKm: 0.0, baseFrequency: 4, octaves: 4, lacunarity: 2.0, gain: 0.5 },
  uranus: { amplitudeKm: 0.0, baseFrequency: 4, octaves: 4, lacunarity: 2.0, gain: 0.5 },
  neptune: { amplitudeKm: 0.0, baseFrequency: 4, octaves: 4, lacunarity: 2.0, gain: 0.5 }
};

export function getReliefParams(name) {
  const key = String(name || '').toLowerCase();
  const base = RELIEF_DATA[key] || { amplitudeKm: 0.0, baseFrequency: 6, octaves: 4, lacunarity: 2.0, gain: 0.5 };
  return {
    ...base,
    seed: key
  };
}

function stringToSeedNumber(seedStr) {
  let hash = 0;
  const s = String(seedStr || 'earth');
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

function hashNoise(u, v, seedNum) {
  const x = Number(u) || 0;
  const y = Number(v) || 0;
  const s = Number(seedNum) || 1;
  const val = Math.sin(s * 12.9898 + x * 78.233 + y * 37.719) * 43758.5453;
  return val - Math.floor(val);
}

function valueNoise2D(u, v, seedNum) {
  const X = Math.floor(u);
  const Y = Math.floor(v);
  const x = u - X;
  const y = v - Y;

  const sx = x * x * (3 - 2 * x);
  const sy = y * y * (3 - 2 * y);

  const n00 = hashNoise(X, Y, seedNum);
  const n10 = hashNoise(X + 1, Y, seedNum);
  const n01 = hashNoise(X, Y + 1, seedNum);
  const n11 = hashNoise(X + 1, Y + 1, seedNum);

  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;

  return nx0 * (1 - sy) + nx1 * sy;
}

export function generateReliefHeight(u, v, params) {
  if (!params || params.amplitudeKm === 0) return 0;
  const octaves = params.octaves || 4;
  const lacunarity = params.lacunarity || 2.0;
  const gain = params.gain || 0.5;
  const seedNum = stringToSeedNumber(params.seed);

  let freq = params.baseFrequency || 6;
  let amp = 1.0;
  let total = 0;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2D(u * freq, v * freq, seedNum + i * 1000);
    const signedN = n * 2 - 1;
    total += signedN * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  if (maxAmp === 0) return 0;
  const normalized = total / maxAmp;
  return Math.max(-1, Math.min(1, normalized));
}

export function applyReliefToGeometry(geometry, params, radius) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
  const posAttr = geometry.attributes.position;
  let normAttr = geometry.attributes.normal;

  if (!normAttr && typeof geometry.computeVertexNormals === 'function') {
    geometry.computeVertexNormals();
    normAttr = geometry.attributes.normal;
  }
  if (!normAttr) return;

  const count = posAttr.count;
  const ampKm = params && params.amplitudeKm ? params.amplitudeKm : 0;
  if (ampKm === 0 || !radius || radius <= 0) return;

  const ratio = ampKm / radius;

  for (let i = 0; i < count; i++) {
    const px = posAttr.getX(i);
    const py = posAttr.getY(i);
    const pz = posAttr.getZ(i);

    const len = Math.hypot(px, py, pz);
    if (len === 0) continue;

    const u = (Math.atan2(py, px) / Math.PI + 1) * 0.5;
    const v = Math.acos(Math.max(-1, Math.min(1, pz / len))) / Math.PI;

    const heightVal = generateReliefHeight(u, v, params);

    const nx = normAttr.getX(i);
    const ny = normAttr.getY(i);
    const nz = normAttr.getZ(i);
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen === 0) continue;

    const unx = nx / nLen;
    const uny = ny / nLen;
    const unz = nz / nLen;

    const disp = heightVal * ratio * radius;
    const newX = px + unx * disp;
    const newY = py + uny * disp;
    const newZ = pz + unz * disp;

    if (Number.isFinite(newX) && Number.isFinite(newY) && Number.isFinite(newZ)) {
      posAttr.setXYZ(i, newX, newY, newZ);
    }
  }
  posAttr.needsUpdate = true;
}

export function sampleRelief(name, latDeg, lonDeg) {
  const params = getReliefParams(name);
  if (params.amplitudeKm === 0) return 0.0;
  const lat = Math.max(-90, Math.min(90, Number(latDeg) || 0));
  const lon = Number(lonDeg) || 0;
  const u = (lon + 180) / 360;
  const v = (lat + 90) / 180;
  return generateReliefHeight(u, v, params);
}
