import puppeteer from 'puppeteer-core';
import { statSync, mkdirSync } from 'fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--enable-webgl2', '--ignore-gpu-blocklist']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value = 'solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

const dir = 'C:/Users/sahin/Downloads/NASA lunar/lunar-link-planner/browsertest/planet-shots';
try { mkdirSync(dir, { recursive: true }); } catch {}

const bodies = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

// Bestimme Canvas-Bounding-Box für sauberen Clip
const box = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});

const results = [];
for (const id of bodies) {
  await page.evaluate((pid) => {
    const sel = document.getElementById('planetFocus');
    sel.value = pid;
    document.getElementById('focusPlanet').click();
  }, id);
  await new Promise(r => setTimeout(r, 1400));
  const path = dir + '/focus-' + id + '.png';
  await page.screenshot({ path, clip: box });
  let bytes = 0; try { bytes = statSync(path).size; } catch {}
  // Auch Kamera-Distanz zum Planeten auslesen (indirekt über planetStatus)
  const status = await page.evaluate(() => (document.getElementById('planetStatus') || {}).textContent || '');
  results.push({ id, bytes, statusShort: status.slice(0, 60) });
}

console.log('=== FOKUS-SHOTS ===');
for (const r of results) console.log(`${r.id.padEnd(9)} bytes=${String(r.bytes).padStart(7)} | ${r.statusShort}`);
console.log('=== ERRORS ===');
console.log(errors.length ? errors.slice(0, 10).join('\n') : '(keine)');

await browser.close();
