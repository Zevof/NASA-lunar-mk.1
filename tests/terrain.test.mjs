import test from 'node:test';
import assert from 'node:assert';
import { maxDisplacementFor, MAX_ELEVATION_KM } from '../static/terrain-core.mjs';

test('Terrain max elevation and displacement correctness', () => {
  assert.strictEqual(MAX_ELEVATION_KM.moon, 10.7);
  assert.strictEqual(MAX_ELEVATION_KM.mars, 21.2);
  assert.strictEqual(MAX_ELEVATION_KM.earth, 19.8);

  const moonDisp = maxDisplacementFor({ id: 'moon', radiusKm: 1737.4 });
  assert.strictEqual(moonDisp, 10.7 / 1000);

  const marsDisp = maxDisplacementFor({ id: 'mars', radiusKm: 3389.5 });
  assert.strictEqual(marsDisp, 21.2 / 1000);
});
