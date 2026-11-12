import * as THREE from 'three';

export function createPlanetRings({innerRadius, outerRadius, tiltDeg=0, texture=null, color=0xd9c9a3, opacity=1}) {
  const group = new THREE.Group();
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 128);

  // Adjust UVs or material parameters if needed
  const materialOpts = {
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity,
    depthWrite: false
  };

  if (texture) {
    materialOpts.map = texture;
    materialOpts.alphaMap = texture;
  }

  const material = new THREE.MeshBasicMaterial(materialOpts);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2 + THREE.MathUtils.degToRad(tiltDeg);
  group.add(mesh);

  group.userData = { innerRadius, outerRadius, tiltDeg };
  return group;
}

export function createSaturnRings(radius) {
  const inner = radius * (66900 / 60268);
  const outer = radius * (140180 / 60268);

  // Generate CanvasTexture for Cassini division (~78% and ~92%)
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#d9c9a3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Cassini division lines
  ctx.fillStyle = '#000000';
  const width = canvas.width;
  ctx.fillRect(width * 0.76, 0, width * 0.03, canvas.height);
  ctx.fillRect(width * 0.90, 0, width * 0.02, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return createPlanetRings({
    innerRadius: inner,
    outerRadius: outer,
    tiltDeg: 26.73,
    texture,
    color: 0xe3d4b8,
    opacity: 0.9
  });
}

export function createUranusRings(radius) {
  const inner = radius * (41800 / 25559);
  const outer = radius * (51149 / 25559);

  return createPlanetRings({
    innerRadius: inner,
    outerRadius: outer,
    tiltDeg: 97.77,
    color: 0x88bbcc,
    opacity: 0.6
  });
}

export function disposeRings(group) {
  if (!group) return;
  group.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (child.material.map) child.material.map.dispose();
      if (child.material.alphaMap) child.material.alphaMap.dispose();
      child.material.dispose();
    }
  });
  group.disposed = true;
}

