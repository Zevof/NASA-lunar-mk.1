/**
 * Controls Core Module for Lunar Link Planner
 *
 * INTEGRATION IN app.js (Beispiel):
 * import { enable, update, setMode, focusBody, getCamera, disable } from './controls-core.mjs';
 *
 * // Nach Initialisierung von Kamera und Szene in app.js:
 * enable(camera, scene);
 *
 * // Im Render-Loop (deltaTime in Millisekunden):
 * let lastTime = performance.now();
 * function animate() {
 *   const now = performance.now();
 *   update(now - lastTime);
 *   lastTime = now;
 *   renderer.render(scene, camera);
 *   requestAnimationFrame(animate);
 * }
 * requestAnimationFrame(animate);
 */

import { tweenCamera } from './scene-tween.mjs';

// Inline Vektor-Hilfen (kein 'three'-Import, um Node-Safety zu wahren)
const v3 = (x=0,y=0,z=0) => ({x,y,z});
const vSub = (a,b) => v3(a.x-b.x, a.y-b.y, a.z-b.z);
const vCross = (a,b) => v3(a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x);
const vLen = (a) => Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z);
const vNorm = (a) => { const l = vLen(a) || 1; return v3(a.x/l, a.y/l, a.z/l); };

let camera = null;
let scene = null;
let enabled = false;
let currentMode = 'orbit';

// External camera/target changes (programmatic setView / focusBody /
// tweenCamera in app.js) bypass the input handlers below, which own
// `spherical` and `targetLookAt`. Without coordination, update() would
// overwrite any externally-set camera.position on the very next frame –
// making "Go to body", planet focus and view switching appear dead.
// We remember (a) the target the app wants and (b) the last position we
// ourselves wrote, so update() can detect a foreign write and re-derive
// spherical/target from it instead of clobbering it.
let externalTarget = { x: 0, y: 0, z: 0 };
let lastApplied = null; // {x,y,z} – last camera.position set by update()
let externalSyncFrames = 0; // frames to trust a foreign camera position

/**
 * Tell the controls where the camera should look after an external
 * (programmatic) camera move. Also queues a re-sync from the current
 * camera.position on the next update() call.
 */
function setExternalTarget(target, radius) {
  if (!target) return;
  const tx = Number.isFinite(target.x) ? target.x : 0;
  const ty = Number.isFinite(target.y) ? target.y : 0;
  const tz = Number.isFinite(target.z) ? target.z : 0;
  externalTarget = { x: tx, y: ty, z: tz };
  externalSyncFrames = 3; // a few frames so a tween's steps are all honoured
  velocity = { x: 0, y: 0 };
  zoomVelocity = 0;
  // When the caller knows the exact framing distance (focusSolarBody), lock
  // it in: adoptExternalCamera() must not freeze whatever mid-tween distance
  // the camera happens to have, which would leave the view stuck too close.
  if (Number.isFinite(radius) && radius > 0) {
    spherical.radius = radius;
    targetLookAt = { x: tx, y: ty, z: tz };
  }
}

// Interaktions-Status
let isDragging = false;
let isPanning = false;
let previousMousePosition = { x: 0, y: 0 };
let spherical = { radius: 100, phi: Math.PI / 2, theta: 0 };
let targetLookAt = { x: 0, y: 0, z: 0 };

// Inertia-Status
let velocity = { x: 0, y: 0 };
let zoomVelocity = 0;

// Konstanten für sanfte, Google-Maps-ähnliche Bewegung
const DAMPING = 0.90;
const ZOOM_DAMPING = 0.80;
const ROTATION_SPEED = 0.004;
const PAN_SPEED = 0.002;
const ZOOM_SPEED = 0.08;

// Touch-Status
let touchStartDist = 0;
let touchStartCenter = { x: 0, y: 0 };

function init(cameraRef, sceneRef) {
  if (typeof window === 'undefined') return;
  camera = cameraRef || (window.LLP && window.LLP.camera);
  scene = sceneRef || (window.LLP && window.LLP.scene);

  if (camera && camera.position) {
    const pos = camera.position;
    spherical.radius = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 100;
    spherical.phi = Math.acos(Math.max(-1, Math.min(1, pos.y / spherical.radius))) || Math.PI / 2;
    spherical.theta = Math.atan2(pos.x, pos.z) || 0;
    targetLookAt = { x: 0, y: 0, z: 0 };
  }
}

function enable(cameraRef, sceneRef) {
  if (typeof window === 'undefined') return;
  if (enabled) return; // Idempotent

  init(cameraRef, sceneRef);
  enabled = true;

  // Bestehende OrbitControls aus app.js deaktivieren, um Konflikte zu vermeiden
  if (window.LLP && window.LLP.controls && typeof window.LLP.controls.dispose === 'function') {
    window.LLP.controls.dispose();
    window.LLP.controls = null;
  }

  const canvas = document.querySelector('canvas');
  if (!canvas) return;

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('touchcancel', onTouchEnd);

  window.LLP = window.LLP || {};
  window.LLP.Controls = { enable, disable, focusBody, setMode, getCamera, update, setExternalTarget, zoom, reset };
}

function disable() {
  if (typeof window === 'undefined') return;
  if (!enabled) return; // Idempotent
  enabled = false;

  const canvas = document.querySelector('canvas');
  if (!canvas) return;

  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mouseup', onMouseUp);
  canvas.removeEventListener('mouseleave', onMouseUp);
  canvas.removeEventListener('wheel', onWheel);

  canvas.removeEventListener('touchstart', onTouchStart);
  canvas.removeEventListener('touchmove', onTouchMove);
  canvas.removeEventListener('touchend', onTouchEnd);
  canvas.removeEventListener('touchcancel', onTouchEnd);
}

function onMouseDown(event) {
  if (!enabled || !camera) return;
  if (event.button === 0) {
    isDragging = true;
  } else if (event.button === 2) {
    isPanning = true;
  }
  previousMousePosition = { x: event.clientX, y: event.clientY };
  velocity = { x: 0, y: 0 };
  zoomVelocity = 0;
}

function onMouseMove(event) {
  if (!enabled || !camera) return;
  const deltaX = event.clientX - previousMousePosition.x;
  const deltaY = event.clientY - previousMousePosition.y;

  if (isDragging) {
    spherical.theta -= deltaX * ROTATION_SPEED;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - deltaY * ROTATION_SPEED));
    velocity = { x: -deltaX * ROTATION_SPEED, y: -deltaY * ROTATION_SPEED };
  } else if (isPanning) {
    // Screen-Space Panning: Bewege targetLookAt entlang der lokalen Rechts/Oben-Achsen der Kamera
    const forward = vNorm(vSub(v3(targetLookAt.x, targetLookAt.y, targetLookAt.z), camera.position));
    const worldUp = v3(0, 1, 0);
    const right = vNorm(vCross(forward, worldUp));
    const up = vNorm(vCross(right, forward));

    const panFactor = PAN_SPEED * spherical.radius;
    targetLookAt.x += (right.x * -deltaX + up.x * deltaY) * panFactor;
    targetLookAt.y += (right.y * -deltaX + up.y * deltaY) * panFactor;
    targetLookAt.z += (right.z * -deltaX + up.z * deltaY) * panFactor;
  }

  previousMousePosition = { x: event.clientX, y: event.clientY };
}

function onMouseUp() {
  isDragging = false;
  isPanning = false;
}

function onWheel(event) {
  if (!enabled || !camera) return;
  event.preventDefault();
  zoomVelocity += event.deltaY * ZOOM_SPEED;
}

// Touch-Handler
function onTouchStart(event) {
  if (!enabled || !camera) return;
  if (event.touches.length === 1) {
    isDragging = true;
    previousMousePosition = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    velocity = { x: 0, y: 0 };
  } else if (event.touches.length === 2) {
    isPanning = true;
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    touchStartDist = Math.sqrt(dx * dx + dy * dy);
    touchStartCenter = {
      x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      y: (event.touches[0].clientY + event.touches[1].clientY) / 2
    };
    zoomVelocity = 0;
  }
}

function onTouchMove(event) {
  if (!enabled || !camera) return;
  event.preventDefault();

  if (event.touches.length === 1 && isDragging) {
    const deltaX = event.touches[0].clientX - previousMousePosition.x;
    const deltaY = event.touches[0].clientY - previousMousePosition.y;
    spherical.theta -= deltaX * ROTATION_SPEED;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - deltaY * ROTATION_SPEED));
    velocity = { x: -deltaX * ROTATION_SPEED, y: -deltaY * ROTATION_SPEED };
    previousMousePosition = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  } else if (event.touches.length === 2 && isPanning) {
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const deltaDist = touchStartDist - dist;
    zoomVelocity += deltaDist * ZOOM_SPEED * 0.5;
    touchStartDist = dist;

    const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    const deltaX = centerX - touchStartCenter.x;
    const deltaY = centerY - touchStartCenter.y;

    // Screen-Space Panning für Touch
    const forward = vNorm(vSub(v3(targetLookAt.x, targetLookAt.y, targetLookAt.z), camera.position));
    const worldUp = v3(0, 1, 0);
    const right = vNorm(vCross(forward, worldUp));
    const up = vNorm(vCross(right, forward));

    const panFactor = PAN_SPEED * spherical.radius;
    targetLookAt.x += (right.x * -deltaX + up.x * deltaY) * panFactor;
    targetLookAt.y += (right.y * -deltaX + up.y * deltaY) * panFactor;
    targetLookAt.z += (right.z * -deltaX + up.z * deltaY) * panFactor;

    touchStartCenter = { x: centerX, y: centerY };
  }
}

function onTouchEnd() {
  isDragging = false;
  isPanning = false;
}

// Re-derive spherical + targetLookAt from a camera position the app wrote
// directly. This lets programmatic moves (view switching, planet focus,
// tweenCamera) survive instead of being overwritten by our own state.
function adoptExternalCamera() {
  if (!camera || !camera.position) return;
  const pos = camera.position;
  const tx = externalTarget.x, ty = externalTarget.y, tz = externalTarget.z;
  const dx = pos.x - tx, dy = pos.y - ty, dz = pos.z - tz;
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(radius > 1e-6)) return;
  const phi = Math.acos(Math.max(-1, Math.min(1, dy / radius)));
  const theta = Math.atan2(dx, dz);
  spherical.radius = radius;
  spherical.phi = phi;
  spherical.theta = theta;
  targetLookAt = { x: tx, y: ty, z: tz };
  lastApplied = { x: pos.x, y: pos.y, z: pos.z };
}

// When the app runs its own camera tween (focusSolarBody), it suspends the
// controls so our per-frame write does not fight the tween. Without this the
// two writers oscillate and the camera freezes at an intermediate distance.
let suspended = false;
function setSuspended(v) { suspended = !!v; }

function update(deltaTime) {
  if (!enabled || !camera || typeof window === 'undefined') return;
  if (suspended) {
    // Let the external tween own the camera; remember its current pose so we
    // can re-derive our orbit state cleanly once it resumes.
    if (camera.position) lastApplied = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    return;
  }

  // 0. Detect a camera.position written by someone else (programmatic
  // setView / focusSolarBody / tweenCamera). If it differs from what we last
  // wrote, adopt it instead of clobbering it. During an external tween we do
  // this for a few frames and skip our own write so the tween owns the camera.
  if (lastApplied && (externalSyncFrames > 0 ||
      Math.abs(camera.position.x - lastApplied.x) > 1e-4 ||
      Math.abs(camera.position.y - lastApplied.y) > 1e-4 ||
      Math.abs(camera.position.z - lastApplied.z) > 1e-4)) {
    adoptExternalCamera();
    if (externalSyncFrames > 0) {
      externalSyncFrames -= 1;
      return; // let the external writer (e.g. tween) drive this frame
    }
    return; // adopted a foreign position; don't immediately overwrite it
  }

  // 1. Delta-Time-Capping: Verhindert Inertia-Explosion bei Tab-Wechseln (max 100ms)
  const clampedDt = Math.min(deltaTime || 16.67, 100);
  const dtFactor = clampedDt / 16.67;

  const effectiveDamping = Math.pow(DAMPING, dtFactor);
  const effectiveZoomDamping = Math.pow(ZOOM_DAMPING, dtFactor);

  // 2. Inertia anwenden
  spherical.theta += velocity.x * dtFactor;
  spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + velocity.y * dtFactor));
  velocity.x *= effectiveDamping;
  velocity.y *= effectiveDamping;

  spherical.radius += zoomVelocity * dtFactor;
  // Floor is intentionally tiny: the app frames planets at radii proportional
  // to their (possibly true-scale) size, which can be well below 1 unit.
  // A hard 2-unit floor used to yank the camera out of every focused planet.
  spherical.radius = Math.max(0.001, spherical.radius);
  zoomVelocity *= effectiveZoomDamping;

  // 3. Kamera-Position basierend auf sphärischen Koordinaten und Ziel berechnen
  const x = targetLookAt.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
  const y = targetLookAt.y + spherical.radius * Math.cos(spherical.phi);
  const z = targetLookAt.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);

  if (currentMode === 'top-down') {
    camera.position.set(targetLookAt.x, targetLookAt.y + spherical.radius, targetLookAt.z);
    camera.lookAt(targetLookAt.x, targetLookAt.y, targetLookAt.z);
  } else {
    // 'orbit' und 'first-person'
    camera.position.set(x, y, z);
    camera.lookAt(targetLookAt.x, targetLookAt.y, targetLookAt.z);
  }
  lastApplied = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
}

function setMode(mode) {
  if (!['orbit', 'top-down', 'first-person'].includes(mode)) return;
  currentMode = mode;

  if (mode === 'top-down') {
    spherical.phi = 0.1; // Fast senkrecht von oben
  } else if (mode === 'orbit') {
    spherical.phi = Math.PI / 2; // Äquatoriale Ansicht
  }
}

function focusBody(target, durationMs = 1000) {
  if (typeof window === 'undefined' || !camera) return;

  let endTarget = { x: 0, y: 0, z: 0 };

  // Flexible Zielauflösung
  if (typeof target === 'string') {
    const body = (window.LLP && window.LLP.bodies && window.LLP.bodies[target]) ? window.LLP.bodies[target].mesh : null;
    if (body && body.position) {
      endTarget = { x: body.position.x, y: body.position.y, z: body.position.z };
    }
  } else if (target && target.position) {
    endTarget = { x: target.position.x, y: target.position.y, z: target.position.z };
  } else if (target && typeof target.x === 'number') {
    endTarget = { x: target.x, y: target.y, z: target.z };
  }

  // 4. Robuster Offset: Klammerung verhindert extremes Wegfliegen aus großen Zoom-Stufen
  const safeRadius = Math.min(Math.max(20, spherical.radius), 200);
  const endPos = {
    x: endTarget.x + safeRadius * 0.5,
    y: endTarget.y + safeRadius * 0.8,
    z: endTarget.z + safeRadius * 0.5
  };

  const startPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const startTarget = { x: targetLookAt.x, y: targetLookAt.y, z: targetLookAt.z };

  if (typeof tweenCamera === 'function') {
    tweenCamera(camera, startPos, endPos, startTarget, endTarget, durationMs, () => {
      targetLookAt = endTarget;
      const dx = camera.position.x - targetLookAt.x;
      const dy = camera.position.y - targetLookAt.y;
      const dz = camera.position.z - targetLookAt.z;
      spherical.radius = Math.sqrt(dx*dx + dy*dy + dz*dz);
    });
  } else {
    // Fallback
    camera.position.set(endPos.x, endPos.y, endPos.z);
    camera.lookAt(endTarget.x, endTarget.y, endTarget.z);
    targetLookAt = endTarget;
  }
}

function getCamera() {
  return camera;
}

/**
 * Impulse zoom. Pass a positive value to zoom in (radius shrinks) and a
 * negative value to zoom out. The actual motion is applied by update() through
 * zoomVelocity, so it inherits the same damping as wheel/touch input.
 * @param {number} delta  Zoom impulse (e.g. 1 for one step in, -1 for one out).
 */
function zoom(delta) {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return;
  // Larger radius -> bigger impulse so distant views still respond visibly.
  const scale = Math.max(1, spherical.radius * ZOOM_SPEED);
  zoomVelocity += -d * scale;
}

/**
 * Reset the camera to a neutral orbit view of the current target: equatorial
 * angle, a comfortable distance, no inertia. Used by the Escape key / UI button.
 * @param {number} [distance=120] Desired orbit radius in scene units.
 */
function reset(distance = 120) {
  const dist = Number.isFinite(distance) && distance > 0 ? distance : 120;
  spherical.radius = dist;
  spherical.phi = Math.PI / 2;
  spherical.theta = 0;
  velocity = { x: 0, y: 0 };
  zoomVelocity = 0;
  if (camera && typeof window !== 'undefined') {
    update(0);
  }
}

export { init, enable, disable, focusBody, setMode, zoom, reset, getCamera, update, setExternalTarget, setSuspended };
