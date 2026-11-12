import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setCacheEnabled(false);
const tex = [];
page.on('response', r => { if (r.url().includes('/textures/') && r.status() === 200) tex.push(r.url().split('/').pop()); });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html?v=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const s=document.getElementById('scaleMode'); s.value='diagram'; s.dispatchEvent(new Event('change',{bubbles:true})); });
await page.evaluate(() => { const v=document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 4000));
const loaded = await page.evaluate(() => {
  const scene = window.LLP.scene;
  const out = new Set();
  scene.traverse(o => { if (o.isMesh && o.material && o.material.map && o.material.map.image && o.material.map.image.src) out.add(o.material.map.image.src.split('/').pop()); });
  return [...out].sort();
});
console.log('=== GELADENE TEXTUREN IM SZENE-GRAPH (' + loaded.length + ') ===');
console.log(loaded.join(', '));
console.log('=== Pluto-Textur geladen? ', loaded.includes('pluto.jpg') ? 'JA ✅' : 'NEIN ❌');
console.log('=== Alle 8 Planeten vorhanden?');
for (const p of ['mercury.jpg','venus_surface.jpg','earth_daymap.jpg','mars.jpg','jupiter.jpg','saturn.jpg','uranus.jpg','neptune.jpg']) {
  console.log('  ' + p.padEnd(20) + (loaded.includes(p) ? '✅' : '❌'));
}
await browser.close();
