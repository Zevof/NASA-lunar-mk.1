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
await page.evaluate(() => { const v = document.getElementById('viewMode'); v.value = 'solar'; v.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 3500));

// Szene-Struktur: Top-Level-Kinder mit Namen/Positionen
const sceneInfo = await page.evaluate(() => {
  const scene = window.LLP.scene;
  const layers = [];
  for (const child of scene.children) {
    const info = {
      type: child.type, name: child.name || '(unnamed)',
      pos: { x: +child.position.x.toFixed(2), y: +child.position.y.toFixed(2), z: +child.position.z.toFixed(2) },
      visible: child.visible, childCount: child.children.length
    };
    layers.push(info);
  }
  // Finde solarLayer: Das ist die Gruppe, die die Planeten enthält (viele Kinder, sichtbar)
  return layers;
});
console.log('=== TOP-LEVEL SCENE CHILDREN ===');
for (const l of sceneInfo) console.log(JSON.stringify(l));

// Jupiter fokussieren
await page.evaluate(() => {
  document.getElementById('planetFocus').value = 'jupiter';
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 1600));

// Finde in solarLayer den Jupiter-ähnlichen Mesh. Wir wissen: Jupiter hat
// radiusKm 69911, aber im Overview-Modus skaliert. Wir suchen nach einem Mesh
// in einer Gruppe, dessen Position weit von (0,0,0) liegt.
const jupInfo = await page.evaluate(() => {
  const scene = window.LLP.scene;
  const cam = window.LLP.camera;
  // Suche solarLayer: das Kind mit den meisten Meshes
  let solar = null, maxChildren = 0;
  for (const c of scene.children) {
    if (c.children.length > maxChildren) { maxChildren = c.children.length; solar = c; }
  }
  if (!solar) return { err: 'no solarLayer found' };
  // Liste alle Kinder von solar mit Positionen (das sollten die Planeten-Gruppen sein)
  const bodies = solar.children.map((g, i) => ({
    i, type: g.type, name: g.name || '',
    pos: { x: +g.position.x.toFixed(2), y: +g.position.y.toFixed(2), z: +g.position.z.toFixed(2) },
    children: g.children.length
  }));
  // Projiziere jedes auf den Bildschirm
  const projected = bodies.map(b => {
    const v = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    // manuelle Projektion
    const p = { x: v.x - cam.position.x, y: v.y - cam.position.y, z: v.z - cam.position.z };
    // Kamera-Matrix anwenden
    cam.updateMatrixWorld && cam.updateMatrixWorld();
    return b;
  });
  return {
    camPos: { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) },
    solarChildCount: solar.children.length,
    bodies: bodies.slice(0, 20),
    camQuat: cam.quaternion ? { x: +cam.quaternion.x.toFixed(3), y: +cam.quaternion.y.toFixed(3), z: +cam.quaternion.z.toFixed(3), w: +cam.quaternion.w.toFixed(3) } : null
  };
});
console.log('=== SOLAR LAYER BODIES (nach Jupiter-Fokus) ===');
console.log('camPos:', JSON.stringify(jupInfo.camPos));
console.log('solarChildCount:', jupInfo.solarChildCount);
for (const b of jupInfo.bodies) console.log('body', b.i, 'pos', JSON.stringify(b.pos), 'children', b.children);
await browser.close();
