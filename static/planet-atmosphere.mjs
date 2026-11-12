// Planet atmosphere shell and starfield for Three.js scenes.
import * as THREE from 'three';

// Vertex shader passes view-space data to the fragment stage.
export const ATMOSPHERE_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Fragment shader computes a Fresnel rim glow modulated by the sun direction.
export const ATMOSPHERE_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uDensity;
uniform vec3 uSunDirection;
uniform vec3 uCameraPosition;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);
  vec3 sunDir = normalize(uSunDirection);

  // Fresnel term: bright at grazing angles, dark facing the camera.
  float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 3.0) * uDensity;

  // Day/night fade: only the sunlit limb glows.
  float sunFacing = max(0.0, dot(normal, sunDir));

  float intensity = fresnel * sunFacing;
  vec3 color = uColor * intensity;

  gl_FragColor = vec4(color, intensity);
}
`;

// Builds a slightly enlarged sphere that renders the atmospheric rim glow.
export function createAtmosphereShell(radius, color, density = 1.0) {
  const geometry = new THREE.SphereGeometry(radius * 1.03, 64, 48);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uDensity: { value: density },
      uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) }
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'atmosphere-shell';
  return mesh;
}

// Updates the shader uniforms for sun direction and camera position.
export function updateAtmosphereShader(material, { sunDirection, cameraPosition } = {}) {
  if (!material || !material.uniforms) return;
  const uniforms = material.uniforms;

  if (sunDirection && uniforms.uSunDirection && uniforms.uSunDirection.value) {
    uniforms.uSunDirection.value.set(sunDirection.x, sunDirection.y, sunDirection.z);
  }
  if (cameraPosition && uniforms.uCameraPosition && uniforms.uCameraPosition.value) {
    uniforms.uCameraPosition.value.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
  }
}

// Deterministic pseudo random generator so the starfield stays reproducible.
function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Creates a spherical shell of stars with power-law sizes and blue to warm colors.
export function createStarfield(count = 8000) {
  const total = Math.max(0, Math.floor(count));
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);

  const random = makeRandom(0x5eed1234);
  const colorA = new THREE.Color('#aaccff');
  const colorB = new THREE.Color('#ffddaa');
  const tmpColor = new THREE.Color();

  const innerRadius = 100;
  const outerRadius = 1000;

  for (let i = 0; i < total; i++) {
    // Uniform direction on the unit sphere.
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));

    // Distance distribution biased towards the inner shell.
    const radius = innerRadius + (outerRadius - innerRadius) * Math.pow(random(), 1.5);

    const x = r * Math.cos(theta) * radius;
    const y = u * radius;
    const z = r * Math.sin(theta) * radius;

    const o = i * 3;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;

    // Power law sizes: many small stars, few large ones.
    const sizeT = Math.pow(random(), 3);
    sizes[i] = 0.5 + sizeT * 2.0;

    // Cool blue-white to warm yellow-white.
    tmpColor.copy(colorA).lerp(colorB, Math.pow(random(), 1.2));
    colors[o] = tmpColor.r;
    colors[o + 1] = tmpColor.g;
    colors[o + 2] = tmpColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 1.0,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'starfield';
  return points;
}
