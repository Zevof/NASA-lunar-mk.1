import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const s=document.getElementById('scaleMode'); s.value='diagram'; s.dispatchEvent(new Event('change',{bubbles:true})); });
await page.evaluate(() => { const v=document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

const bodies = ['sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','pluto'];
for (const id of bodies) {
  await page.evaluate((pid) => { document.getElementById('planetFocus').value=pid; document.getElementById('focusPlanet').click(); }, id);
  await new Promise(r => setTimeout(r, 1300));
  const r = await page.evaluate(() => {
    const cam = window.LLP.camera;
    let solar = null, max = 0;
    for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
    let best = null, bestD = Infinity;
    for (const g of solar.children) {
      const d = Math.hypot(g.position.x-cam.position.x, g.position.y-cam.position.y, g.position.z-cam.position.z);
      if (d < bestD) { bestD = d; best = g; }
    }
    return { dist: +bestD.toFixed(2), bodyR: +best.scale.x.toFixed(3), ratio: +(bestD / best.scale.x).toFixed(2) };
  });
  console.log(id.padEnd(9), 'dist=' + String(r.dist).padStart(6), 'radius=' + String(r.bodyR).padStart(5), 'dist/radius=' + r.ratio);
}
await browser.close();
