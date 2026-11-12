/**
 * Unit tests for mission-planning.js
 */
import assert from 'node:assert/strict';
import { validateCustomCoordinates, assessRelativitySignificance, generateTimelinePreview } from '../static/mission-planning.js';

// Test 1: validateCustomCoordinates - valid input
{
  const result = validateCustomCoordinates(45.0, 190.0);
  assert.equal(result.valid, true);
  assert.equal(result.lat, 45.0);
  assert.equal(result.lon, -170.0); // 190 wrapped to -170
  console.log('✓ validateCustomCoordinates: valid input with longitude wrap');
}

// Test 2: validateCustomCoordinates - invalid latitude
{
  const result = validateCustomCoordinates(95.0, 0.0);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('Latitude'));
  console.log('✓ validateCustomCoordinates: rejects invalid latitude');
}

// Test 3: validateCustomCoordinates - NaN
{
  const result = validateCustomCoordinates('abc', 10.0);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('finite'));
  console.log('✓ validateCustomCoordinates: rejects NaN');
}

// Test 4: assessRelativitySignificance - low velocity (lunar transfer)
{
  const result = assessRelativitySignificance(10.9, 259200); // ~3 days at 10.9 km/s
  assert.equal(result.isSignificant, false);
  assert.ok(result.deltaTMs < 1.0);
  assert.ok(result.gamma > 1.0 && result.gamma < 1.0000001);
  console.log(`✓ assessRelativitySignificance: lunar transfer deltaT = ${result.deltaTMs.toFixed(3)} ms (not significant)`);
}

// Test 5: assessRelativitySignificance - high velocity (interplanetary)
{
  const result = assessRelativitySignificance(50.0, 15768000); // ~180 days at 50 km/s
  assert.equal(result.isSignificant, true);
  assert.ok(result.deltaTMs > 1.0);
  console.log(`✓ assessRelativitySignificance: high-speed transfer deltaT = ${result.deltaTMs.toFixed(3)} ms (significant)`);
}

// Test 6: generateTimelinePreview - returns array
{
  const site = { lat: 0, lon: 0 };
  const start = Date.parse('2024-01-01T00:00:00Z');
  const end = Date.parse('2024-01-02T00:00:00Z');
  const events = generateTimelinePreview(site, start, end, 1);
  assert.ok(Array.isArray(events));
  assert.ok(events.length > 0);
  console.log(`✓ generateTimelinePreview: generated ${events.length} events for 24h period`);
}

console.log('\n✅ All mission-planning.js tests passed.');
