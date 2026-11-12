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

// Jupiter fokussieren
await page.evaluate(() => {
  document.getElementById('planetFocus').value = 'jupiter';
  document.getElementById('focusPlanet').click();
});
await new Promise(r => setTimeout(r, 1800));

// Read pixels directly from the WebGL context (bypasses preserveDrawingBuffer issue)
const pixelStats = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { err: 'no webgl context' };
  const w = canvas.width, h = canvas.height;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let nonBlack = 0, total = w * h;
  let rSum = 0, gSum = 0, bSum = 0;
  const colors = new Set();
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
    rSum += r; gSum += g; bSum += b;
    if (r + g + b > 30) nonBlack++;
    colors.add((r >> 4) * 256 + (g >> 4) * 16 + (b >> 4));
  }
  // Zentrale 100x100 Region
  let centerNonBlack = 0, centerTotal = 0;
  const cx = Math.floor(w/2), cy = Math.floor(h/2);
  for (let y = cy-50; y < cy+50; y++) {
    for (let x = cx-50; x < cx+50; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      if (pixels[i] + pixels[i+1] + pixels[i+2] > 30) centerNonBlack++;
      centerTotal++;
    }
  }
  return {
    w, h, totalPixels: total,
    nonBlackPct: +(100 * nonBlack / total).toFixed(2),
    centerNonBlackPct: +(100 * centerNonBlack / centerTotal).toFixed(2),
    avgRGB: [Math.round(rSum/total), Math.round(gSum/total), Math.round(bSum/total)],
    uniqueColors: colors.size,
    glError: gl.getError()
  };
});
console.log('=== PIXEL-READBACK (nach Jupiter-Fokus) ===');
console.log(JSON.stringify(pixelStats, null, 2));
await browser.close();
