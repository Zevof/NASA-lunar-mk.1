import test from 'node:test';
import assert from 'node:assert';
import { createPlanetRings, createSaturnRings, createUranusRings, disposeRings } from '../static/planet-rings.mjs';
import * as THREE from 'three';

test('createSaturnRings geometric ratio', () => {
  const radius = 60268;
  const group = createSaturnRings(radius);
  const expectedRatio = 140180 / 66900;
  const inner = radius * (66900 / 60268);
  const outer = radius * (140180 / 60268);
  const actualRatio = outer / inner;
  assert.ok(Math.abs(actualRatio - expectedRatio) < 0.01);
});

test('createUranusRings narrow check', () => {
  const radius = 25559;
  const inner = radius * (41800 / 25559);
  const outer = radius * (51149 / 25559);
  const group = createUranusRings(radius);
  assert.ok(outer - inner < outer * 0.5);
});

test('disposeRings sets disposed flag and cleans up', () => {
  const group = createPlanetRings({ innerRadius: 1, outerRadius: 2 });
  disposeRings(group);
  assert.strictEqual(group.disposed, true);
});

