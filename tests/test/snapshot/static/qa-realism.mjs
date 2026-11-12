// QA Realism Test – verifies the REALISM_SCHEMA.md contract against the
// actual PLANET_DATA array (the catalogue exports an Array, not a map).
import { PLANET_DATA, MOON_DATA } from './planet-data-sources.mjs';

console.log('--- QA Realism Test ---');
let failed = 0;
const fail = (msg) => { console.error('FAIL:', msg); failed++; };
const pass = (msg) => console.log('PASS:', msg);

if (!Array.isArray(PLANET_DATA) || PLANET_DATA.length === 0) {
  fail('PLANET_DATA is not a non-empty array');
} else {
  pass(`PLANET_DATA is an array with ${PLANET_DATA.length} bodies`);
}

const byId = (id) => PLANET_DATA.find((p) => p.id === id);

// Every body must carry the realism metadata with valid types.
const REQUIRED = ['sun','mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune'];
for (const id of REQUIRED) {
  const b = byId(id);
  if (!b) { fail(`body missing: ${id}`); continue; }
  if (typeof b.textureUrl !== 'string' || !b.textureUrl) fail(`${id}.textureUrl missing`);
  if (typeof b.radiusKm !== 'number' || !(b.radiusKm > 0)) fail(`${id}.radiusKm invalid`);
  if (typeof b.roughness !== 'number' || b.roughness < 0 || b.roughness > 1) fail(`${id}.roughness not in 0..1`);
  if (typeof b.metalness !== 'number' || b.metalness < 0 || b.metalness > 1) fail(`${id}.metalness not in 0..1`);
  if (!['rayleigh','haze','none'].includes(b.atmosphereKind)) fail(`${id}.atmosphereKind invalid: ${b.atmosphereKind}`);
}

// Earth-specific contract: normal map + blue Rayleigh atmosphere.
const earth = byId('earth');
if (!earth) fail('earth not found');
else {
  if (earth.normalMapUrl !== '/textures/earth_normal.jpg') fail(`earth.normalMapUrl = ${earth.normalMapUrl}`);
  else pass('earth normalMapUrl correct');
  if (earth.atmosphereKind !== 'rayleigh') fail(`earth.atmosphereKind = ${earth.atmosphereKind}`);
  else pass('earth atmosphereKind = rayleigh');
}

// Venus-specific: atmosphere albedo override.
const venus = byId('venus');
if (!venus) fail('venus not found');
else if (!venus.textureUrl || !venus.textureUrl.endsWith('venus_atmosphere.jpg')) fail(`venus.textureUrl = ${venus.textureUrl}`);
else pass('venus textureUrl uses atmosphere map');

// Moons: big ones should be present in MOON_DATA.
if (!Array.isArray(MOON_DATA) || MOON_DATA.length === 0) fail('MOON_DATA is not a non-empty array');
else pass(`MOON_DATA has ${MOON_DATA.length} moons`);

if (failed > 0) { console.error(`\nResult: ${failed} checks FAILED.`); process.exit(1); }
console.log('\nResult: ALL CHECKS PASSED.');
process.exit(0);
