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

await page.evaluate(() => { document.getElementById('planetFocus').value='jupiter'; document.getElementById('focusPlanet').click(); });
await new Promise(r => setTimeout(r, 1500));

const r = await page.evaluate(() => {
const cam = window.LLP.camera;
let solar = null, max = 0;
for (const c of window.LLP.scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
// Sortiere alle Roots nach Distanz zur Kamera, zeige die nächsten 6
const all = solar.children.map((g,i) => ({
i, dist: +Math.hypot(g.position.x-cam.position.x, g.position.y-cam.position.y, g.position.z-cam.position.z).toFixed(2),
scale: +g.scale.x.toFixed(3), pos: {x:+g.position.x.toFixed(1),y:+g.position.y.toFixed(1),z:+g.position.z.toFixed(1)},
nMeshes: (() => { let n=0; g.traverse(o=>{if(o.isMesh)n++;}); return n; })()
})).sort((a,b)=>a.dist-b.dist);
return { cam: {x:+cam.position.x.toFixed(1),y:+cam.position.y.toFixed(1),z:+cam.position.z.toFixed(1)}, nearest: all.slice(0,6) };
});
console.log('Kamera:', JSON.stringify(r.cam));
console.log('Nächste Roots zur Kamera:');
for (const n of r.nearest) console.log('  #' + n.i, 'dist=' + n.dist, 'scale=' + n.scale, 'meshes=' + n.nMeshes, 'pos=' + JSON.stringify(n.pos));
await browser.close();
