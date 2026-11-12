import puppeteer from 'puppeteer-core';
import { statSync } from 'fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const errors = [];
const failed = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('requestfailed', r => failed.push('FAIL ' + r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });

await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Solar-Modus aktivieren
await page.evaluate(() => { const v = document.getElementById('viewMode'); if (v) { v.value = 'solar'; v.dispatchEvent(new Event('change')); } });
await new Promise(r => setTimeout(r, 3500));

const planets = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon', 'pluto'];
const shotDir = 'C:/Users/sahin/Downloads/NASA lunar/lunar-link-planner/browsertest/planet-shots';
import { mkdirSync } from 'fs';
try { mkdirSync(shotDir, { recursive: true }); } catch {}

const results = [];
for (const id of planets) {
  // Planet per UI fokussieren (gleiche Route wie der "Go to body"-Picker)
  const info = await page.evaluate((pid) => {
    const sel = document.getElementById('planetFocus');
    if (!sel) return { ok: false, why: 'no #planetFocus' };
    sel.value = pid;
    const btn = document.getElementById('focusPlanet');
    if (!btn) return { ok: false, why: 'no #focusPlanet' };
    btn.click();
    return { ok: true };
  }, id);
  await new Promise(r => setTimeout(r, 1200));
  const path = shotDir + '/' + id + '.png';
  await page.screenshot({ path, clip: { x: 300, y: 60, width: 800, height: 700 } });
  let bytes = 0; try { bytes = statSync(path).size; } catch {}
  results.push({ id, clickOk: info.ok, why: info.why || null, bytes });
  // Zurück zur Übersicht
  await page.evaluate(() => { const v = document.getElementById('viewMode'); if (v) { v.value = 'solar'; v.dispatchEvent(new Event('change')); } });
  await new Promise(r => setTimeout(r, 400));
}

console.log('=== PLANET-SHOTS ===');
for (const r of results) console.log(`${r.id.padEnd(9)} click=${r.clickOk} bytes=${r.bytes}${r.why ? ' why=' + r.why : ''}`);
console.log('=== KONSOLEN/PAGE ERRORS ===');
if (errors.length === 0) console.log('(keine)'); else errors.slice(0, 20).forEach(e => console.log(e));
console.log('=== FEHLGESCHLAGENE REQUESTS ===');
if (failed.length === 0) console.log('(keine)'); else failed.slice(0, 30).forEach(f => console.log(f));

await browser.close();
