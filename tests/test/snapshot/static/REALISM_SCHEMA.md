# Planet Realism Upgrade – Shared Contract

Goal: every planet and moon must look realistic (NASA-grade albedo + relief +
specular + atmospheric scattering), not flat/samey. All work must keep the
existing module APIs intact and stay Node-safe (no DOM at import time).

## Data fields added per planet/moon spec (planet-data-sources.mjs)

Each body spec in PLANET_DATA / MOON_DATA may now carry:

- `normalMapUrl`: string|null   // tangent-space normal map (local /textures file)
- `roughnessMapUrl`: string|null
- `specularMapUrl`: string|null // for ocean/ice specular on Earth/Mars caps
- `roughness`: number           // 0..1 base roughness (per body, realistic)
- `metalness`: number           // 0..1 base metalness (usually 0..0.1)
- `atmosphereTint`: string      // hex, e.g. '#7ec0ff'
- `atmosphereKind`: 'rayleigh'|'haze'|'none'

Renderer (solar-system-core.mjs) reads these with sensible fallbacks so a
missing field never breaks rendering.

## Body-specific realism targets

- Sun: emissive, no shadow side; texture emissiveMap, high emissiveIntensity.
- Mercury: rough (roughness .95), normalMap (craters) if available.
- Venus: atmosphere layer dominant; use venus_atmosphere.jpg as albedo when in
  'atmosphere view', thick cloud shell, warm haze.
- Earth: earth_daymap albedo + earth_normal normalMap (already on disk!),
  ocean specular (low roughness on water via specular/roughness map), cloud
  shell, blue Rayleigh rim.
- Moon: albedo + bump (existing LOLA), rough.
- Mars: rusty albedo, normalMap if available, thin haze atmosphere.
- Jupiter/Saturn/Uranus/Neptune: banded albedo, NO bump, soft limb darkening,
  subtle haze atmosphere; rings with real colour + shadow.
- Moons: albedo + subtle bump for the big ones (io, europa, ganymede, callisto,
  titan, triton, charon, moon).

## Rules
- Never present albedo as measured elevation.
- Keep functions/exports backward compatible.
- Run `node --check` on every changed .mjs (note: .mjs import of three will not
  run under node, but syntax check works).
