import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = []; const warns = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (/bump|terrain|displac/i.test(m.text())) warns.push(m.type()+': '+m.text()); });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
// Switch to solar system view to build the planet meshes
await page.evaluate(() => { const v=document.getElementById('viewMode'); if(v){ v.value='solar'; v.dispatchEvent(new Event('change')); } });
await new Promise(r => setTimeout(r, 4000));
const info = await page.evaluate(() => {
  const scene = window.LLP && window.LLP.scene;
  const out = { meshes: [], bodyIds: [], matProps: {} };
  if (!scene) return { error: 'no scene' };
  scene.traverse(o => {
    if (o.isMesh && o.material && o.material.type === 'MeshStandardMaterial') {
      const bid = (o.userData && o.userData.bodyId) || (o.parent && o.parent.userData && o.parent.userData.bodyId) || '?';
      out.bodyIds.push(bid);
      const m = o.material;
      if (m.bumpMap || m.normalMap) {
        out.meshes.push({ bodyId: bid, hasBump: !!m.bumpMap, hasNormal: !!m.normalMap, bumpScale: m.bumpScale });
      }
    }
  });
  out.bodyIds = [...new Set(out.bodyIds)];
  return out;
});
console.log('BODY-IDS:', JSON.stringify(info.bodyIds));
console.log('MESHES MIT BUMP/NORMAL:', JSON.stringify(info.meshes, null, 2));
console.log('BUMP/Terrain-WARNINGS:', warns.length ? warns.slice(0,10).join(' | ') : 'keine');
console.log('PAGEERRORS:', errs.length ? errs.join(' | ') : 'keine');
await browser.close();
