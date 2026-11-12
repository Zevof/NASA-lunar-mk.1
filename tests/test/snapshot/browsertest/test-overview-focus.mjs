import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));

// Overview-Modus wählen
const scaleSel = await page.evaluate(() => {
  const s = document.getElementById('scaleMode');
  if (!s) return { exists: false, options: [] };
  const opts = [...s.options].map(o => o.value);
  s.value = 'diagram';
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return { exists: true, options: opts, current: s.value };
});
console.log('scaleMode:', JSON.stringify(scaleSel));

await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

for (const id of ['mercury','jupiter','saturn','neptune']) {
  await page.evaluate((pid) => { document.getElementById('planetFocus').value=pid; document.getElementById('focusPlanet').click(); }, id);
  await new Promise(r => setTimeout(r, 1300));
  const r = await page.evaluate((pid) => {
    const cam = window.LLP.camera;
    let solar = null, max = 0;
    for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
    // Finde den Körper, dessen Position der Kamera am nächsten ist (fokussiert)
    let best = null, bestD = Infinity;
    for (const g of solar.children) {
      const d = Math.hypot(g.position.x-cam.position.x, g.position.y-cam.position.y, g.position.z-cam.position.z);
      if (d < bestD) { bestD = d; best = g; }
    }
    return { dist: +bestD.toFixed(3), scaleX: +best.scale.x.toFixed(3) };
  }, id);
  console.log(id.padEnd(9), 'dist=' + r.dist, 'planetScale=' + r.scaleX);
}
await browser.close();
