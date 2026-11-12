import puppeteer from 'puppeteer-core';
import { mkdirSync, statSync } from 'fs';
mkdirSync('planet-shots', { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
executablePath: CHROME,
headless: 'new',
args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

// Erzwinge preserveDrawingBuffer:true für ALLE WebGL-Kontexte, bevor die App läuft
await page.evaluateOnNewDocument(() => {
const origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attrs) {
if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
}
return origGetContext.call(this, type, attrs);
};
});

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));

// Solar-Modus + Overview
await page.evaluate(() => {
const v = document.getElementById('viewMode'); v.value = 'solar'; v.dispatchEvent(new Event('change'));
const radios = [...document.querySelectorAll('input[type=radio]')];
const ov = radios.find(r => /overview/i.test((r.value || '') + (r.nextElementSibling?.textContent || '') + (r.labels?.[0]?.textContent || '')));
if (ov) { ov.checked = true; ov.dispatchEvent(new Event('change', { bubbles: true })); }
});
await new Promise(r => setTimeout(r, 4000));

const canvasBox = await page.evaluate(() => {
const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
console.log('canvas:', JSON.stringify(canvasBox));

// Screenshot der ganzen Solar-Übersicht
await page.screenshot({ path: 'planet-shots/gpu-overview.png', clip: canvasBox });

// Pro Planet fokussieren + Screenshot
const bodies = ['sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','pluto'];
for (const id of bodies) {
await page.evaluate((pid) => {
const sel = document.getElementById('planetFocus');
if (sel) sel.value = pid;
const btn = document.getElementById('focusPlanet');
if (btn) btn.click();
}, id);
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'planet-shots/gpu-' + id + '.png', clip: canvasBox });
}

console.log('=== ERRORS ===');
console.log(errors.length ? errors.slice(0, 8).join('\n') : '(keine)');
await browser.close();
for (const n of ['gpu-overview', ...bodies.map(b => 'gpu-' + b)]) {
try { console.log(n.padEnd(16), statSync('planet-shots/' + n + '.png').size); } catch { console.log(n, 'fehlt'); }
}
