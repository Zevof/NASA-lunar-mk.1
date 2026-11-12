import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
executablePath: CHROME, headless: 'new',
args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value = 'solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 4000));

// Prüfe jeden Planeten-Mesh: sichtbar, Textur geladen, Material-Farbe
const check = await page.evaluate(() => {
const scene = window.LLP.scene;
const out = [];
scene.traverse(o => {
if (o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry') {
const mat = o.material;
const texLoaded = !!(mat && mat.map && mat.map.image && mat.map.image.complete !== false && (mat.map.image.width > 0 || mat.map.image.src));
const color = mat && mat.color ? '#' + mat.color.getHexString() : null;
out.push({
name: o.name || '',
visible: o.visible,
texLoaded,
texSrc: mat && mat.map && mat.map.image && mat.map.image.src ? mat.map.image.src.split('/').pop() : (mat && mat.map ? 'no-src' : 'no-map'),
color,
geoType: o.geometry.type,
matType: mat ? mat.type : 'none',
scale: +o.scale.x.toFixed(3)
});
}
});
return out;
});
console.log('=== MESH-TEXTUR-CHECK (erste 40) ===');
for (const m of check.slice(0, 40)) {
console.log(
(m.name || '(unnamed)').padEnd(15),
'vis=' + String(m.visible).padEnd(5),
'tex=' + String(m.texLoaded).padEnd(5),
'src=' + String(m.texSrc).padEnd(20),
'mat=' + m.matType
);
}
console.log('=== GESAMT:', check.length, 'Meshes,', check.filter(m => m.texLoaded).length, 'mit Textur ===');
await browser.close();
