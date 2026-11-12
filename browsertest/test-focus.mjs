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
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));
await page.evaluate(() => { const v = document.getElementById('viewMode'); if (v) { v.value = 'solar'; v.dispatchEvent(new Event('change')); } });
await new Promise(r => setTimeout(r, 3000));

// Prüfe, ob focusSolarBody existiert und was es macht, indem wir es direkt aufrufen
const probe = await page.evaluate(() => {
  const out = {};
  out.hasFn = typeof window.focusSolarBody;
  // Wo liegt Jupiter? Wir greifen auf die canvas Szene zu über die interne Variable — nicht exportiert.
  // Stattdessen: wir rufen focus über das UI auf und lesen danach die canvas.
  const sel = document.getElementById('planetFocus');
  const btn = document.getElementById('focusPlanet');
  out.selExists = !!sel; out.btnExists = !!btn;
  out.selOptions = sel ? [...sel.options].map(o => o.value) : [];
  return out;
});
console.log('probe:', JSON.stringify(probe));

// Klick auf Jupiter und warte auf Tween-Ende (700ms + Puffer)
await page.evaluate(() => {
  const sel = document.getElementById('planetFocus');
  sel.value = 'jupiter';
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 1500));

// Screenshot des gesamten Canvas
await page.screenshot({ path: 'planet-shots/jupiter-full.png' });

// Direkt danach Saturn
await page.evaluate(() => {
  const sel = document.getElementById('planetFocus');
  sel.value = 'saturn';
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'planet-shots/saturn-full.png' });

console.log('errors:', errors.length ? errors : '(keine)');
await browser.close();
import { statSync } from 'fs';
for (const n of ['jupiter-full', 'saturn-full']) {
  try { console.log(n, statSync('planet-shots/' + n + '.png').size); } catch (e) { console.log(n, 'fehlt'); }
}
