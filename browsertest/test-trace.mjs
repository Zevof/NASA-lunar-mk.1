import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 7000));
const result = await page.evaluate(async () => {
  const fromIn = document.querySelector('#route-from-input');
  const toIn = document.querySelector('#route-to-input');
  fromIn.value = 'Berlin'; fromIn.dispatchEvent(new Event('input', {bubbles:true}));
  toIn.value = 'Munich'; toIn.dispatchEvent(new Event('input', {bubbles:true}));
  // Directly call the internal renderer to capture the stack
  let stack = null;
  try {
    // find renderRoute3D via the module? It's not exported. Trigger via button.
    document.querySelector('#route-plan-btn').click();
    await new Promise(r => setTimeout(r, 2500));
  } catch (e) { stack = e.stack; }
  // Try calling window functions
  let directStack = null;
  try {
    if (window.LLP?.Routing?.getActiveRoute) {
      const r = window.LLP.Routing.getActiveRoute();
      // attempt to re-render
    }
  } catch(e) { directStack = e.stack; }
  return { stack, directStack, view: document.getElementById('viewMode')?.value };
});
console.log('VIEW:', result.view);
console.log('STACK:', result.stack);
console.log('DIRECT:', result.directStack);
await browser.close();
