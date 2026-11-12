import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const reqs = [];
page.on('response', r => { if (r.url().includes('/textures/')) reqs.push(r.status() + ' ' + r.url().split('/').pop()); });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 4000));
const r = await page.evaluate(() => {
  const scene = window.LLP.scene;
  const found = { sun: null, saturnRings: null };
  scene.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const m = o.material;
    if (m.map && m.map.image && m.map.image.src) {
      const src = m.map.image.src.split('/').pop();
      if (src === 'sun.jpg') found.sun = { loaded: m.map.image.complete !== false, tex: src, mat: m.type };
      if (src === 'saturn_ring_alpha.png') found.saturnRings = { loaded: m.map.image.complete !== false, tex: src, mat: m.type, geo: o.geometry.type };
    }
    // Auch Ring ohne map prüfen
    if (o.geometry && o.geometry.type === 'RingGeometry') {
      found.saturnRings = found.saturnRings || { tex: 'no-map', mat: m.type, geo: 'RingGeometry' };
    }
  });
  return found;
});
console.log('Sonne:', JSON.stringify(r.sun));
console.log('Saturn-Ringe:', JSON.stringify(r.saturnRings));
console.log('Textur-Requests (sun/ring):', reqs.filter(x => /sun\.jpg|saturn_ring/.test(x)));
await browser.close();
