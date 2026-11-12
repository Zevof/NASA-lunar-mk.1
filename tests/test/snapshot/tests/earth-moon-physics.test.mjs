import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planRoute } from '../static/route-core.mjs';
import { previewFrames, surveyTransfers } from '../static/earth-route-core.mjs';

test('Earth to Moon route uses physics-derived Hohmann transfer', async () => {
  const route = await planRoute({ type: 'planet', id: 'earth' }, { type: 'planet', id: 'moon' });
  assert.equal(route.isValid, true);
  assert.equal(route.transferType, 'hohmann-geocentric');
  assert.ok(route.deltaVKms > 3 && route.deltaVKms < 5, `deltaV ${route.deltaVKms}`);
  assert.ok(route.durationHours > 24 && route.durationHours < 240, `duration ${route.durationHours}`);
});

test('surveyTransfers returns best-effort candidates in preview mode', () => {
  const frames = previewFrames('2026-11-10', 30, 24);
  const launchIndex = Math.floor(frames.length * .25);
  const results = surveyTransfers(frames, launchIndex, { lat: 28.5, lon: -80.6 }, { lat: 0, lon: 0 }, 0, {});
  assert.ok(results.length > 0, 'at least one candidate');
  for (const r of results) {
    assert.ok(Number.isFinite(r.deltaVkmS), 'deltaV finite');
    assert.ok(r.missKm < 500, `miss ${r.missKm} under fallback threshold`);
    assert.equal(typeof r.approximate, 'boolean');
  }
});

test('geocentric Hohmann route is wired into the route UI', async () => {
  const routeCore = readFileSync(new URL('../static/route-core.mjs', import.meta.url), 'utf8');
  const appCore = readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');

  assert.match(routeCore, /transferType:\s*'hohmann-geocentric'/);
  assert.match(appCore, /'hohmann-geocentric':\s*'Hohmann transfer \(geocentric\)'/);

  const outbound = await planRoute({ type: 'planet', id: 'earth' }, { type: 'planet', id: 'moon' });
  const inbound = await planRoute({ type: 'planet', id: 'moon' }, { type: 'planet', id: 'earth' });

  for (const route of [outbound, inbound]) {
    assert.equal(route.transferType, 'hohmann-geocentric');
    assert.equal(route.transfer.totalDeltaVKmS, route.deltaVKms);
    assert.ok(route.transfer.maneuvers.length === 2, 'two patched-conic maneuvers');
    assert.ok(route.transfer.maneuvers.every((maneuver) => Number.isFinite(maneuver.deltaVKms) && maneuver.deltaVKms > 0));
    assert.ok(route.deltaVKms > 3 && route.deltaVKms < 5, `deltaV ${route.deltaVKms}`);
  }

  // With identical circular parking orbits and a reversible, coplanar Hohmann
  // arc, patched-conic burns are reciprocal. Directional asymmetry requires a
  // time-dependent three-body ephemeris solution rather than this idealisation.
  assert.ok(
    Math.abs(outbound.deltaVKms - inbound.deltaVKms) < 1e-9,
    'idealised patched-conic transfer is reciprocal'
  );
  assert.equal(outbound.transfer.maneuvers.at(0).label, 'Trans-lunar injection');
  assert.equal(outbound.transfer.maneuvers.at(1).label, 'Lunar orbit capture');
  assert.equal(inbound.transfer.maneuvers.at(0).label, 'Lunar departure injection');
  assert.equal(inbound.transfer.maneuvers.at(1).label, 'Earth orbit capture');
});
