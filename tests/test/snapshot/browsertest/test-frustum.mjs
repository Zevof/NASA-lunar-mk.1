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

const check = async (id) => {
  await page.evaluate((pid) => {
    document.getElementById('planetFocus').value = pid;
    document.getElementById('focusPlanet').click();
  }, id);
  await new Promise(r => setTimeout(r, 1800));
  return await page.evaluate((pid) => {
    const scene = window.LLP.scene;
    const cam = window.LLP.camera;
    // solarLayer = child mit meisten Kindern
    let solar = null, max = 0;
    for (const c of scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
    // Planeten-Gruppen sind die Kinder mit einer Mesh und einer Position != 0
    // (Jupiter/Saturn/etc. liegen bei x != 0). Wir suchen nach der Gruppe, die
    // am besten zur planetFocus passt. Ohne IDs: Wir nehmen die, deren Position
    // der Kamera am nächsten ist (die App hat gerade dorthin gefokussiert).
    let best = null, bestDist = Infinity;
    for (const g of solar.children) {
      const d = Math.hypot(g.position.x - cam.position.x, g.position.y - cam.position.y, g.position.z - cam.position.z);
      if (d < bestDist) { bestDist = d; best = g; }
    }
    // Projiziere best (fokussierter Planet) in NDC
    const wp = best.position.clone();
    wp.project(cam);
    const dist = best.position.distanceTo(cam.position);
    return {
      planetPos: { x: +best.position.x.toFixed(2), y: +best.position.y.toFixed(2), z: +best.position.z.toFixed(2) },
      camPos: { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) },
      distance: +dist.toFixed(3),
      ndc: { x: +wp.x.toFixed(3), y: +wp.y.toFixed(3), z: +wp.z.toFixed(3) },
      inFrustum: Math.abs(wp.x) <= 1 && Math.abs(wp.y) <= 1 && wp.z >= -1 && wp.z <= 1
    };
  }, id);
};

console.log('=== FRUSTUM-CHECK PRO PLANET ===');
for (const id of ['sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','pluto']) {
  const r = await check(id);
  console.log(id.padEnd(9), 'dist=' + String(r.distance).padStart(7), 'ndc=' + JSON.stringify(r.ndc), 'inFrustum=' + r.inFrustum);
}
await browser.close();
