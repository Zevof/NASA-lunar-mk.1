import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setCacheEnabled(false); // WICHTIG: kein Cache
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html?v=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const s=document.getElementById('scaleMode'); s.value='diagram'; s.dispatchEvent(new Event('change',{bubbles:true})); });
await page.evaluate(() => { const v=document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

// Prüfe: scaleMode-Wert + alle Roots mit scale
const pre = await page.evaluate(() => {
const s = document.getElementById('scaleMode');
let solar = null, max = 0;
for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
const scales = solar.children.map(g => +g.scale.x.toFixed(3)).filter(x => x > 0);
return { scaleMode: s ? s.value : '?', uniqueScales: [...new Set(scales)].sort((a,b)=>a-b).slice(0,10), count: scales.length };
});
console.log('VOR Fokus: scaleMode=' + pre.scaleMode, 'uniqueScales=', JSON.stringify(pre.uniqueScales));

// Jupiter fokussieren
await page.evaluate(() => { document.getElementById('planetFocus').value='jupiter'; document.getElementById('focusPlanet').click(); });
await new Promise(r => setTimeout(r, 1500));

const post = await page.evaluate(() => {
const cam = window.LLP.camera;
const s = document.getElementById('scaleMode');
let solar = null, max = 0;
for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
// Der fokussierte Planet: nächster zur Kamera
let best = null, bestD = Infinity;
for (const g of solar.children) {
const d = Math.hypot(g.position.x-cam.position.x, g.position.y-cam.position.y, g.position.z-cam.position.z);
if (d < bestD) { bestD = d; best = g; }
}
return {
scaleMode: s ? s.value : '?',
camDist: +bestD.toFixed(3),
bestScale: +best.scale.x.toFixed(4),
ratio: +(bestD / best.scale.x).toFixed(2),
allScales: solar.children.map(g => +g.scale.x.toFixed(3)).filter(x => x > 0).sort((a,b)=>a-b)
};
});
console.log('NACH Jupiter-Fokus: scaleMode=' + post.scaleMode);
console.log('  Kamera-Distanz=' + post.camDist, 'planetScale=' + post.bestScale, 'dist/scale=' + post.ratio);
console.log('  Alle Skalen:', JSON.stringify(post.allScales));
await browser.close();
