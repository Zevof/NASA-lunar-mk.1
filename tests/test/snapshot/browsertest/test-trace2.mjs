import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 7000));
// Patch: intercept the catch in the route button by wrapping console + Error
const trace = await page.evaluate(async () => {
  // Override Error.prepareStackTrace to capture where undefined.multiplyScalar occurs
  const logs = [];
  const origErr = window.onerror;
  // Monkeypatch Float32? Instead: wrap the click and capture the error via a global try
  const fromIn = document.querySelector('#route-from-input');
  const toIn = document.querySelector('#route-to-input');
  fromIn.value = 'Berlin'; fromIn.dispatchEvent(new Event('input', {bubbles:true}));
  toIn.value = 'Munich'; toIn.dispatchEvent(new Event('input', {bubbles:true}));
  // Re-create the error by calling the same internals if exposed; otherwise use a
  // try/catch around a manual render by dispatching click and hooking console.error
  let captured = null;
  const oldError = console.error;
  console.error = (...a) => { captured = captured || a.join(' '); oldError(...a); };
  // Hook the route-result mutation
  const res = document.querySelector('#route-result');
  const obs = new MutationObserver(() => { if (/unavailable|multiplyScalar/.test(res.textContent)) captured = captured || res.textContent; });
  obs.observe(res, { childList: true, characterData: true, subtree: true });
  document.querySelector('#route-plan-btn').click();
  await new Promise(r => setTimeout(r, 2500));
  obs.disconnect();
  console.error = oldError;
  return { captured, resultText: res.textContent.slice(0,150), view: document.getElementById('viewMode')?.value, hasFrames: typeof frames !== 'undefined' ? frames.length : 'n/a' };
});
console.log(JSON.stringify(trace, null, 2));
await browser.close();
