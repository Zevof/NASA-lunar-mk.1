import test from 'node:test';
import assert from 'node:assert';
import {sunlightDirectionFromPositions,sunlightDirectionsForBodies} from '../static/sunlight-core.mjs';

test('Earth and Moon receive effectively parallel sunlight', () => {
  const sun={x:0,y:0,z:0};
  const earth={x:149597870.7,y:0,z:0};
  const moon={x:149597870.7+384400,y:0,z:0};

  const earthDirection=sunlightDirectionFromPositions(sun,earth);
  const moonDirection=sunlightDirectionFromPositions(sun,moon);

  assert.strictEqual(earthDirection.x,1);
  assert.strictEqual(earthDirection.y,0);
  assert.strictEqual(earthDirection.z,0);
  assert.strictEqual(moonDirection.x,1);
  assert.strictEqual(moonDirection.y,0);
  assert.strictEqual(moonDirection.z,0);

  const angleDifference=Math.acos(
    earthDirection.x*moonDirection.x+
    earthDirection.y*moonDirection.y+
    earthDirection.z*moonDirection.z
  );
  assert.ok(angleDifference<1e-10);
});

test('Moon-only sunlight follows the Sun-to-Moon direction', () => {
  const sun={x:-1000,y:0,z:0};
  const moon={x:0,y:0,z:0};
  const direction=sunlightDirectionFromPositions(sun,moon);

  assert.strictEqual(direction.x,1);
  assert.strictEqual(direction.y,0);
  assert.strictEqual(direction.z,0);
});

test('Sunlight direction is normalised for arbitrary geometry', () => {
  const sun={x:1,y:2,z:3};
  const body={x:4,y:6,z:15};
  const direction=sunlightDirectionFromPositions(sun,body);

  const length=Math.sqrt(direction.x**2+direction.y**2+direction.z**2);
  assert.ok(Math.abs(length-1)<1e-12);
  assert.ok(direction.x>0&&direction.y>0&&direction.z>0);
});

test('Coincident positions use a stable fallback direction', () => {
  const direction=sunlightDirectionFromPositions({x:5,y:5,z:5},{x:5,y:5,z:5});
  assert.deepStrictEqual(direction,{x:-1,y:0,z:0});
});

test('Batch helper returns directions in input order', () => {
  const sun={x:0,y:0,z:0};
  const directions=sunlightDirectionsForBodies(sun,[
    {x:10,y:0,z:0},
    {x:0,y:20,z:0}
  ]);

  assert.deepStrictEqual(directions,[
    {x:1,y:0,z:0},
    {x:0,y:1,z:0}
  ]);
});
