import test from 'node:test';
import assert from 'node:assert';
import {
  toTrueUnits,
  toSceneUnits,
  setMode,
  getMode,
  bodyRadius,
  orbitRadius,
  getBodyPosition,
  MOON_ORBIT_RADIUS_KM,
  R_EARTH_KM
} from '../static/scale-core.mjs';

test('Scale mode switching', () => {
  setMode('true');
  assert.strictEqual(getMode(), 'true');
  setMode('overview');
  assert.strictEqual(getMode(), 'overview');
  setMode('true');
});

test('True scale units and body radii', () => {
  setMode('true');
  assert.strictEqual(toTrueUnits(1000), 1);
  assert.strictEqual(bodyRadius({ radiusKm: 1737.4 }), 1.7374);
});

test('Moon orbit independent position and ~60.3 ratio', () => {
  setMode('true');
  const moonPos = getBodyPosition('moon', 0);
  const earthPos = getBodyPosition('earth', 0);

  assert.notDeepStrictEqual(moonPos, earthPos);
  assert.strictEqual(moonPos.parentId, 'earth');

  const ratio = MOON_ORBIT_RADIUS_KM / R_EARTH_KM;
  assert.ok(Math.abs(ratio - 60.3) < 0.1, `Ratio should be ~60.3, got ${ratio}`);
});
