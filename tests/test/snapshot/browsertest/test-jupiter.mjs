import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
mkdirSync('planet-shots', { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value = 'solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

// Diagnose: Szene-Graph + Kamera-Ausrichtung relativ zu Jupiter
const diag = await page.evaluate(() => {
  const THREE = window.LLP;
  const cam = window.LLP.camera;
  const scene = window.LLP.scene;
  // Finde Jupiter-Mesh über Scene-Traverse (Suche nach solarLayer-Kindern)
  // Wir kennen die internen Namen nicht, aber die App hat solarObjects im Modul-Scope.
  // Stattdessen: suche alle Meshes, deren Position weit draußen liegt, und nimm die größte.
  const out = {
    camPos: { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) },
    near: cam.near, far: cam.far, fov: cam.fov,
    direction: null,
    jupiterScreen: null
  };
  const dir = { x: 0, y: 0, z: 0 };
  cam.getWorldDirection && (() => { const d = new cam.constructor(); })();
  return out;
});
console.log('diag1:', JSON.stringify(diag));

// Fokus Jupiter
await page.evaluate(() => {
  document.getElementById('planetFocus').value = 'jupiter';
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 1600));

const diag2 = await page.evaluate(() => {
  const cam = window.LLP.camera;
  // getWorldDirection auf echtes THREE.Vector3
  const out = { camPos: { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) } };
  // Suche Jupiter: Wir kennen die y-Position der Planeten nicht direkt.
  // Aber die App exportiert solarObjects nicht. Wir prüfen stattdessen die
  // Szene: alle Objekte im solarLayer, die im Kamera-Frustum sichtbar wären.
  // Einfachster Check: Sind überhaupt sichtbare Meshes in Kamera-Richtung?
  return out;
});
console.log('diag2 (nach Jupiter-Fokus):', JSON.stringify(diag2));

// Screenshot des gesamten Canvas
const clip = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
console.log('canvas clip:', JSON.stringify(clip));
await page.screenshot({ path: 'planet-shots/jupiter-verify.png', clip });
await browser.close();
import { statSync } from 'fs';
console.log('screenshot bytes:', statSync('planet-shots/jupiter-verify.png').size);
