import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=default']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

await page.evaluateOnNewDocument(() => {
  window.__drawCalls = 0;
  window.__clearCalls = 0;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const de = proto.drawElements, da = proto.drawArrays, cl = proto.clear;
    if (de) proto.drawElements = function (...a) { window.__drawCalls++; return de.apply(this, a); };
    if (da) proto.drawArrays = function (...a) { window.__drawCalls++; return da.apply(this, a); };
    if (cl) proto.clear = function (...a) { window.__clearCalls++; return cl.apply(this, a); };
  }
});

page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value = 'solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 4000));

const before = await page.evaluate(() => ({ draws: window.__drawCalls, clears: window.__clearCalls }));
await new Promise(r => setTimeout(r, 1500));
const after = await page.evaluate(() => ({ draws: window.__drawCalls, clears: window.__clearCalls }));

console.log('Draw-Calls vor:', JSON.stringify(before));
console.log('Draw-Calls nach 1.5s:', JSON.stringify(after));
console.log('Draw-Calls pro Sekunde:', Math.round((after.draws - before.draws) / 1.5));

// Prüfe, ob ein Renderer-Objekt erreichbar ist (Three.js WebGLRenderer hat .info)
const rendererInfo = await page.evaluate(() => {
  // Suche im window nach Objekten mit .info.render
  const found = [];
  for (const k of Object.keys(window)) {
    try {
      const v = window[k];
      if (v && v.info && v.info.render && typeof v.info.render.calls === 'number') {
        found.push({ key: k, calls: v.info.render.calls, triangles: v.info.render.triangles });
      }
    } catch {}
  }
  return found;
});
console.log('Renderer-Info gefunden:', JSON.stringify(rendererInfo));

await browser.close();
