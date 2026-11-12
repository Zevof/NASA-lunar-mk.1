import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
const info = await page.evaluate(() => {
  const out = { solarBodies: 0, withBump: [], withBumpScale: [] };
  const scene = window.LLP && window.LLP.scene;
  if (!scene) return { error: 'no scene on window.LLP' };
  scene.traverse(o => {
    if (o.userData && o.userData.bodyId) {
      out.solarBodies++;
      const m = o.material;
      if (m && m.bumpMap) { out.withBump.push(o.userData.bodyId); }
      if (m && Number.isFinite(m.bumpScale) && m.bumpScale > 0) { out.withBumpScale.push(o.userData.bodyId + '=' + m.bumpScale); }
    }
  });
  return out;
});
console.log(JSON.stringify(info, null, 2));
console.log('PAGEERRORS:', errs.length ? errs.join(' | ') : 'keine');
await browser.close();
