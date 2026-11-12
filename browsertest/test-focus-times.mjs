import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setCacheEnabled(false);
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html?v=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const s=document.getElementById('scaleMode'); s.value='diagram'; s.dispatchEvent(new Event('change',{bubbles:true})); });
await page.evaluate(() => { const v=document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

const jp = await page.evaluate(() => {
  let solar = null, max = 0;
  for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
  let jup = null;
  for (const g of solar.children) if (g.scale.x > 1.5 && Math.abs(Math.abs(g.position.x) - 52) < 5) jup = g;
  return jup ? { x:+jup.position.x.toFixed(1), y:+jup.position.y.toFixed(1), z:+jup.position.z.toFixed(1) } : null;
});
console.log('Jupiter:', JSON.stringify(jp));

// Klick und dann in kurzen Abständen die Kamera + Distanz messen
await page.evaluate(() => { document.getElementById('planetFocus').value='jupiter'; document.getElementById('focusPlanet').click(); });
const times = [0, 50, 150, 350, 700, 1000, 1600];
let prev = 0;
for (const t of times) {
  await new Promise(r => setTimeout(r, t - prev)); prev = t;
  const s = await page.evaluate((jp) => {
    const cam = window.LLP.camera;
    const d = Math.hypot(cam.position.x-jp.x, cam.position.y-jp.y, cam.position.z-jp.z);
    return { dist: +d.toFixed(2), cam: {x:+cam.position.x.toFixed(1),y:+cam.position.y.toFixed(1),z:+cam.position.z.toFixed(1)} };
  }, jp);
  console.log('t=' + String(t).padStart(4) + 'ms', 'distJup=' + String(s.dist).padStart(7), JSON.stringify(s.cam));
}
await browser.close();
