import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Hilfsfunktion: Kamera-Position aus window.LLP.camera
async function camPos() {
  return await page.evaluate(() => {
    const c = window.LLP && window.LLP.camera;
    return c ? { x: +c.position.x.toFixed(3), y: +c.position.y.toFixed(3), z: +c.position.z.toFixed(3) } : null;
  });
}

// Solar-Modus
await page.evaluate(() => { const v = document.getElementById('viewMode'); if (v) { v.value = 'solar'; v.dispatchEvent(new Event('change')); } });
await new Promise(r => setTimeout(r, 3000));
console.log('cam vor Fokus:', JSON.stringify(await camPos()));

// Fokus Jupiter
await page.evaluate(() => {
  const sel = document.getElementById('planetFocus'); if (sel) { sel.value = 'jupiter'; sel.dispatchEvent(new Event('change')); }
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 2000));
console.log('cam nach Jupiter:', JSON.stringify(await camPos()));

// Fokus Saturn
await page.evaluate(() => {
  const sel = document.getElementById('planetFocus'); if (sel) { sel.value = 'saturn'; sel.dispatchEvent(new Event('change')); }
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 2000));
console.log('cam nach Saturn:', JSON.stringify(await camPos()));

// Prüfe: Wie viele Planeten-Meshes sind in der Szene, welche Texturen geladen?
const sceneInfo = await page.evaluate(() => {
  const scene = window.LLP && window.LLP.scene;
  if (!scene) return { err: 'no scene' };
  let meshes = 0, textured = 0, bodies = [];
  scene.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry') {
      meshes++;
      if (o.material && o.material.map && o.material.map.image) { textured++; bodies.push({ name: o.name || '?', tex: o.material.map.image.src ? o.material.map.image.src.split('/').pop() : 'img' }); }
    }
  });
  return { meshCount: meshes, texturedCount: textured, texturedBodies: bodies.slice(0, 30) };
});
console.log('SZENE:', JSON.stringify(sceneInfo, null, 2));

await browser.close();
