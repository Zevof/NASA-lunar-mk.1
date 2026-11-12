import test from "node:test";
import assert from "node:assert";
import { ATMOSPHERE_VERTEX_SHADER, ATMOSPHERE_FRAGMENT_SHADER, createAtmosphereShell, createStarfield, updateAtmosphereShader } from "../static/planet-atmosphere.mjs";

test("Atmosphere shaders contain required uniforms and varyings", () => {
  assert.ok(ATMOSPHERE_VERTEX_SHADER.includes("uSunDirection"));
  assert.ok(ATMOSPHERE_VERTEX_SHADER.includes("uCameraPosition"));
  assert.ok(ATMOSPHERE_VERTEX_SHADER.includes("varying"));
  assert.ok(ATMOSPHERE_FRAGMENT_SHADER.includes("uSunDirection"));
  assert.ok(ATMOSPHERE_FRAGMENT_SHADER.includes("uCameraPosition"));
  assert.ok(ATMOSPHERE_FRAGMENT_SHADER.includes("varying"));
});

test("createAtmosphereShell exists and is a function", () => {
  assert.strictEqual(typeof createAtmosphereShell, "function");
});

test("createStarfield creates Points with correct vertex count", () => {
  const stars = createStarfield(100);
  assert.ok(stars);
  assert.strictEqual(stars.geometry.attributes.position.count, 100);
});
