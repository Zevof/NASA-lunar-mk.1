import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:8765/index.html';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const consoleMsgs = [];
const failedReqs = [];
page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message));
page.on('requestfailed', r => failedReqs.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', r => { if (r.status() >= 400) failedReqs.push(r.status() + ' ' + r.url()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

const status = await page.evaluate(() => ({
  planetMeshStatus: document.getElementById('planetMeshStatus')?.textContent || '(kein Element)',
  terrainStatus: document.getElementById('terrainStatus')?.textContent || '(kein Element)',
  routeOptions: document.querySelectorAll('#route-from-select option, #fromSelect option, select option').length,
  hasRouting: !!window.LLP,
  hasPlanets: window.LLP?.Planets ? Object.keys(window.LLP.Planets).length : 0,
  canvasCount: document.querySelectorAll('canvas').length,
  planetSelector: document.querySelectorAll('#planet-selector, #solarBodySelect, select[id*="planet" i]').length
}));

console.log('=== STATUS ===');
console.log(JSON.stringify(status, null, 2));
console.log('=== KONSOLEN-FEHLER (error/warning/pageerror) ===');
consoleMsgs.filter(m => /error|warning|PAGEERROR/i.test(m)).slice(0, 30).forEach(m => console.log(m));
console.log('=== FEHLGESCHLAGENE / 4xx-REQUESTS ===');
failedReqs.slice(0, 30).forEach(f => console.log(f));
console.log('=== GESAMT: console=' + consoleMsgs.length + ' failed=' + failedReqs.length + ' ===');

await page.screenshot({ path: 'full-view.png', fullPage: false });
await browser.close();
