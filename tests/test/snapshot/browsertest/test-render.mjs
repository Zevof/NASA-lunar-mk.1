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
await page.evaluate(() => {
  document.getElementById('planetFocus').value = 'jupiter';
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 1800));

// Prüfe Szenen-Hintergrund und Renderer-Zustand + erzwungener Render vor Readback
const info = await page.evaluate(() => {
  const scene = window.LLP.scene;
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const bg = scene.background;
  const bgInfo = bg ? (bg.isColor ? { type: 'Color', hex: '#' + bg.getHexString() } : { type: bg.type || 'other' }) : null;

  // Clear-Farbe direkt setzen und readPixels
  gl.clearColor(1, 0, 1, 1); // magenta
  gl.clear(gl.COLOR_BUFFER_BIT);
  const w = canvas.width, h = canvas.height;
  const px = new Uint8Array(4);
  gl.readPixels(Math.floor(w/2), Math.floor(h/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const clearReadback = [px[0], px[1], px[2], px[3]];

  return {
    sceneBackground: bgInfo,
    canvasSize: { w, h },
    glContext: gl.constructor.name,
    clearReadback,
    solarLayerVisible: (() => {
      // solarLayer = das Kind mit den meisten Kindern
      let solar = null, max = 0;
      for (const c of scene.children) if (c.children.length > max) { max = c.children.length; solar = c; }
      return solar ? { childCount: solar.children.length, visible: solar.visible } : null;
    })()
  };
});
console.log('=== SCENE/RENDER INFO ===');
console.log(JSON.stringify(info, null, 2));
await browser.close();
