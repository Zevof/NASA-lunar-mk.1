import test from 'node:test';
import assert from 'node:assert';
import {
  hohmannTransfer,
  biEllipticTransfer,
  lambertTransfer,
  swingByTransfer,
  MU_SUN_KM3_S2
} from '../static/mission-transfer-core.mjs';
import { planetPositionKm } from '../static/solar-system-core.mjs';

const AU = 149597870.7;

test('Hohmann Earth to Mars has plausible transfer time and positive burns', () => {
  const transfer = hohmannTransfer(AU, 1.52366231 * AU);
  assert.ok(transfer.totalDeltaVKmS > 0);
  assert.ok(transfer.transferSeconds > 200 * 86400);
  assert.ok(transfer.transferSeconds < 300 * 86400);
  assert.equal(transfer.pathKm.length > 2, true);
});

test('Bi-elliptic transfer validates apoapsis and returns three burns', () => {
  const transfer = biEllipticTransfer(AU, 1.52366231 * AU, 3 * AU);
  assert.equal(transfer.deltaVKmS.length, 3);
  assert.ok(transfer.intermediateApoapsisKm > 1.52366231 * AU);
  assert.ok(transfer.transferSeconds > hohmannTransfer(AU, 1.52366231 * AU).transferSeconds);
  assert.throws(() => biEllipticTransfer(AU, 1.52366231 * AU, 1.4 * AU), /apoapsis/);
});

test('Lambert arc reaches the requested arrival position', () => {
  const departure = planetPositionKm('earth', '2026-11-10T00:00:00Z');
  const arrival = planetPositionKm('mars', '2027-05-09T00:00:00Z');
  const seconds = 180 * 86400;
  const transfer = lambertTransfer(departure, arrival, seconds, MU_SUN_KM3_S2, true);
  const endpoint = transfer.pathKm[transfer.pathKm.length - 1];
  const miss = Math.hypot(
    endpoint.at(0) - arrival.at(0),
    endpoint.at(1) - arrival.at(1),
    endpoint.at(2) - arrival.at(2)
  );
  assert.ok(transfer.pathKm.length > 100);
  assert.ok(miss < 1);
});

test('Swing-by planner returns a patched-conic trajectory and metrics', () => {
  const departureEpoch = '2026-11-10T00:00:00Z';
  const arrivalEpoch = '2028-11-10T00:00:00Z';
  const transfer = swingByTransfer({
    originId: 'earth',
    destinationId: 'jupiter',
    flybyId: 'mars',
    departureEpoch,
    arrivalEpoch,
    flybyFraction: 0.5
  });
  assert.equal(transfer.type, 'swingby');
  assert.ok(transfer.pathKm.length > 100);
  assert.ok(Number.isFinite(transfer.departureDeltaVKmS));
  assert.ok(Number.isFinite(transfer.arrivalDeltaVKmS));
  assert.ok(Number.isFinite(transfer.flybyDeltaVKmS));
});
