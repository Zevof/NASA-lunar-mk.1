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

// Merke Jupiter-Position VOR Fokus
const jupPos = await page.evaluate(() => {
let solar = null, max = 0;
for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
// größter Planet-Root (scale > 1) mit großer x-Distanz
let best = null;
for (const g of solar.children) {
if (g.scale.x > 1.5 && Math.abs(g.position.x) > 20) { // große Planeten weit draußen
// Jupiter ist der größte mit |x| ~55
if (!best || Math.abs(Math.abs(g.position.x) - 55) < Math.abs(Math.abs(best.position.x) - 55)) best = g;
}
}
return best ? { x:+best.position.x.toFixed(1), y:+best.position.y.toFixed(1), z:+best.position.z.toFixed(1), scale:+best.scale.x.toFixed(2) } : null;
});
console.log('Jupiter-Position (diagram):', JSON.stringify(jupPos));

await page.evaluate(() => { document.getElementById('planetFocus').value='jupiter'; document.getElementById('focusPlanet').click(); });
await new Promise(r => setTimeout(r, 1500));

const r = await page.evaluate((jp) => {
const cam = window.LLP.camera;
let solar = null, max = 0;
for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
// Finde den Root, der JUPITER ist (nicht ein Mond): große Skala (>1) UND nahe an jp
let jup = null, bestD = Infinity;
for (const g of solar.children) {
if (g.scale.x < 1.5) continue; // Monde ausschließen
const d = Math.hypot(g.position.x-jp.x, g.position.y-jp.y, g.position.z-jp.z);
if (d < bestD) { bestD = d; jup = g; }
}
if (!jup) return { err: 'jupiter root not found' };
const camDist = Math.hypot(jup.position.x-cam.position.x, jup.position.y-cam.position.y, jup.position.z-cam.position.z);
return { camDist: +camDist.toFixed(3), jupScale: +jup.scale.x.toFixed(3), ratio: +(camDist/jup.scale.x).toFixed(2) };
}, jupPos);
console.log('Jupiter nach Fokus: dist=' + r.camDist, 'scale=' + r.jupScale, 'dist/scale=' + r.ratio);
await browser.close();
