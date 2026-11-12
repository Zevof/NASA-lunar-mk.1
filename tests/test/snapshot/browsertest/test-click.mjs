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
await new Promise(r => setTimeout(r, 8000));

async function cam() {
return await page.evaluate(() => { const c = window.LLP.camera; return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) }; });
}

// Solar
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value = 'solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3000));
console.log('cam solar-init:', JSON.stringify(await cam()));

// NUR select setzen (kein change-Event!), dann click
await page.evaluate(() => { document.getElementById('planetFocus').value = 'jupiter'; });
await new Promise(r => setTimeout(r, 300));
console.log('cam vor click:', JSON.stringify(await cam()));
await page.evaluate(() => { document.getElementById('focusPlanet').click(); });
await new Promise(r => setTimeout(r, 1500));
console.log('cam nach jupiter-click (ohne change):', JSON.stringify(await cam()));

// Direkt focusSolarBody über die interna? Er ist nicht global. Prüfe über Button-Picker: solarPicker
const pickerInfo = await page.evaluate(() => {
const pk = document.getElementById('solarPicker');
if (!pk) return { exists: false };
const btns = [...pk.querySelectorAll('button, [data-id], [data-body]')].map(b => ({ tag: b.tagName, id: b.id, dataId: b.getAttribute('data-id'), dataBody: b.getAttribute('data-body'), text: (b.textContent || '').trim().slice(0, 20) }));
return { exists: true, hidden: pk.hidden, children: btns.slice(0, 20) };
});
console.log('picker:', JSON.stringify(pickerInfo));

await browser.close();
