import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

// Fokus Jupiter, dann mehrfach Kamera-Position über Zeit abtasten
await page.evaluate(() => { document.getElementById('planetFocus').value='jupiter'; document.getElementById('focusPlanet').click(); });
const samples = [];
for (let i = 0; i < 10; i++) {
await new Promise(r => setTimeout(r, 250));
const s = await page.evaluate(() => {
const cam = window.LLP.camera;
let solar = null, max = 0;
for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
let jup = null;
for (const g of solar.children) if (Math.abs(g.position.x - (-55.5)) < 3 && Math.abs(g.position.z - 51.9) < 3) { jup = g; break; }
const d = jup ? Math.hypot(jup.position.x-cam.position.x, jup.position.y-cam.position.y, jup.position.z-cam.position.z) : -1;
return { t: performance.now()|0, cam: {x:+cam.position.x.toFixed(2),y:+cam.position.y.toFixed(2),z:+cam.position.z.toFixed(2)}, distJup: +d.toFixed(2) };
});
samples.push(s);
}
console.log('=== KAMERA-VERLAUF NACH JUPITER-FOKUS (250ms-Schritte) ===');
for (const s of samples) console.log('t=' + s.t, 'distJup=' + s.distJup, JSON.stringify(s.cam));
await browser.close();
