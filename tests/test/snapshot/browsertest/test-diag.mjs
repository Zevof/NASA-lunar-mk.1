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
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Diagnose: Welche viewMode-Optionen, ist canvas sichtbar, welcher Renderer läuft
const diag = await page.evaluate(() => {
  const vm = document.getElementById('viewMode');
  const canvas = document.querySelector('canvas');
  const out = {
    viewModes: vm ? [...vm.options].map(o => o.value) : [],
    currentView: vm ? vm.value : null,
    canvasW: canvas ? canvas.width : 0,
    canvasH: canvas ? canvas.height : 0,
    canvasVisible: canvas ? (canvas.offsetWidth > 0) : false,
  };
  return out;
});
console.log('DIAG:', JSON.stringify(diag));

// Wechsle zu solar und prüfe, ob sich das Canvas-Layout ändert
await page.evaluate(() => { const v = document.getElementById('viewMode'); if (v) { v.value = 'solar'; v.dispatchEvent(new Event('change')); } });
await new Promise(r => setTimeout(r, 4000));

// JPEG-Screenshot statt PNG, um File-Size-Vergleich zu ermöglichen
await page.screenshot({ path: 'planet-shots/solar-a.jpg', type: 'jpeg', quality: 80 });
await new Promise(r => setTimeout(r, 200));

// Fokus Jupiter
await page.evaluate(() => {
  const sel = document.getElementById('planetFocus');
  if (sel) { sel.value = 'jupiter'; sel.dispatchEvent(new Event('change')); }
  const btn = document.getElementById('focusPlanet');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: 'planet-shots/solar-b.jpg', type: 'jpeg', quality: 80 });

// Fokus Saturn
await page.evaluate(() => {
  const sel = document.getElementById('planetFocus');
  if (sel) { sel.value = 'saturn'; sel.dispatchEvent(new Event('change')); }
  const btn = document.getElementById('focusPlanet');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: 'planet-shots/solar-c.jpg', type: 'jpeg', quality: 80 });

// planetStatus auslesen, um zu sehen, ob focusSolarBody wirklich greift
const status = await page.evaluate(() => {
  const s = document.getElementById('planetStatus');
  return s ? s.textContent : '(kein planetStatus)';
});
console.log('STATUS:', status);

await browser.close();
import { statSync } from 'fs';
for (const n of ['solar-a', 'solar-b', 'solar-c']) {
  try { console.log(n, statSync('planet-shots/' + n + '.jpg').size); } catch (e) { console.log(n, 'fehlt'); }
}
