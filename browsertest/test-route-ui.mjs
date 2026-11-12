import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 7000));
const result = await page.evaluate(async () => {
  const fromIn = document.querySelector('#route-from-input');
  const toIn = document.querySelector('#route-to-input');
  const btn = document.querySelector('#route-plan-btn');
  const out = { hasFromInput: !!fromIn, hasToInput: !!toIn, hasBtn: !!btn };
  if (fromIn && toIn && btn) {
    fromIn.value = 'Berlin'; fromIn.dispatchEvent(new Event('input', {bubbles:true}));
    toIn.value = 'Munich'; toIn.dispatchEvent(new Event('input', {bubbles:true}));
    btn.click();
    await new Promise(r => setTimeout(r, 3000));
    const res = document.querySelector('#route-result');
    out.resultText = res ? res.textContent.trim().slice(0, 200) : '(none)';
    out.activeRoute = window.LLP?.Routing?.getActiveRoute?.() || null;
  }
  return out;
});
console.log(JSON.stringify(result, null, 2));
console.log('PAGEERRORS:', errs.length ? errs.join(' | ') : 'keine');
await browser.close();
