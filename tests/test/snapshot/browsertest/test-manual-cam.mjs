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

// Test A: Kamera manuell weit von Jupiter weg positionieren
const setup = await page.evaluate(() => {
  const scene = window.LLP.scene;
  const cam = window.LLP.camera;
  let solar = null, max = 0;
  for (const c of scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
  // Jupiter = body mit größtem Radius und großer Distanz. Wir nehmen den
  // Mesh, dessen Position weit draußen und dessen Kind eine große Geometrie hat.
  // Einfacher: die App hat gerade keinen Fokus. Wir suchen Jupiter über die
  // Gruppen-Reihenfolge: body 6 laut früherem Test war Jupiter (-55.5, 23.6, 51.9).
  let jup = null;
  for (const g of solar.children) {
    if (Math.abs(g.position.x - (-55.5)) < 3 && Math.abs(g.position.z - 51.9) < 3) { jup = g; break; }
  }
  return { found: !!jup, jupPos: jup ? { x: +jup.position.x.toFixed(2), y: +jup.position.y.toFixed(2), z: +jup.position.z.toFixed(2) } : null };
});
console.log('Jupiter gefunden:', JSON.stringify(setup));

// Kamera manuell 15 Einheiten entfernt setzen (sicher außerhalb)
await page.evaluate(() => {
  const scene = window.LLP.scene;
  const cam = window.LLP.camera;
  let solar = null, max = 0;
  for (const c of scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
  let jup = null;
  for (const g of solar.children) {
    if (Math.abs(g.position.x - (-55.5)) < 3 && Math.abs(g.position.z - 51.9) < 3) { jup = g; break; }
  }
  if (jup) {
    // Setze Kamera manuell. controls.target wird über die Façade den
    // controls-core-Sync auslösen, der die Kamera dann "adoptiert".
    const target = { x: jup.position.x, y: jup.position.y, z: jup.position.z };
    if (window.LLP.Controls && window.LLP.Controls.setExternalTarget) {
      window.LLP.Controls.setExternalTarget(target);
    }
    cam.position.set(jup.position.x, jup.position.y, jup.position.z + 15);
    cam.lookAt(jup.position.x, jup.position.y, jup.position.z);
    cam.updateMatrixWorld();
  }
});
await new Promise(r => setTimeout(r, 1200));

const after = await page.evaluate(() => {
  const cam = window.LLP.camera;
  return { camPos: { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) } };
});
console.log('Kamera nach manueller Positionierung:', JSON.stringify(after));

// Screenshot
const clip = await page.evaluate(() => {
  const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
await page.screenshot({ path: 'planet-shots/jupiter-manual.png', clip });
await browser.close();
import { statSync } from 'fs';
console.log('screenshot bytes:', statSync('planet-shots/jupiter-manual.png').size);
