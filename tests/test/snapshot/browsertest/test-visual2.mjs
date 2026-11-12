import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 6000));
// Solar view (all planets)
await page.evaluate(() => { const v=document.getElementById('viewMode'); if(v){ v.value='solar'; v.dispatchEvent(new Event('change')); } });
await new Promise(r => setTimeout(r, 4000));
await page.screenshot({ path: 'solar2.png', clip: { x: 340, y: 80, width: 700, height: 620 } });
// Analyze pixels via canvas in the page
const stats = await page.evaluate(async () => {
  const img = new Image();
  const blob = await (await fetch('/index.html')).blob(); // dummy to ensure page alive
  return { alive: document.querySelectorAll('canvas').length };
});
console.log('canvases:', stats.alive);
await browser.close();
// Analyze PNG in Node with a tiny check via sharp-free approach
import { readFileSync } from 'fs';
const buf = readFileSync('solar2.png');
console.log('screenshot bytes:', buf.length);
