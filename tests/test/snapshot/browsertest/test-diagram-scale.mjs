import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 9000));

// Auf diagram wechseln
await page.evaluate(() => { const s=document.getElementById('scaleMode'); s.value='diagram'; s.dispatchEvent(new Event('change',{bubbles:true})); });
await page.evaluate(() => { const v=document.getElementById('viewMode'); v.value='solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

const info = await page.evaluate(() => {
const scene = window.LLP.scene;
let solar = null, max = 0;
for (const c of scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
// Liste alle Root-Kinder mit scale
const items = solar.children.map((g,i) => ({ i, scale: +g.scale.x.toFixed(4), pos: {x:+g.position.x.toFixed(1),z:+g.position.z.toFixed(1)} }));
// Finde das größte (sollte im diagram-Modus Jupiter/Saturn sein)
items.sort((a,b) => b.scale - a.scale);
return { scaleSelValue: (document.getElementById('scaleMode')||{}).value, top5: items.slice(0,5) };
});
console.log('scaleMode.value =', info.scaleSelValue);
console.log('Top-5 größte Planeten-Roots (scale):');
for (const it of info.top5) console.log('  #' + it.i, 'scale=' + it.scale, 'pos=', JSON.stringify(it.pos));
await browser.close();
