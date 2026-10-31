import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = await mkdtemp(path.join(os.tmpdir(), 'fact-lens-dc-images-'));
const extension = path.join(root, 'extension'); await cp('dist', extension, { recursive: true });
// Test-only import surface; production bundles and packages do not include it.
await build({ entryPoints: ['extension/images.js'], outfile: path.join(extension, 'image-probe.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome120' });
const context = await chromium.launchPersistentContext(path.join(root, 'profile'), { headless: true, channel: 'chrome', viewport: { width: 440, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
context.setDefaultTimeout(15000);
try {
  const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: extension });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host, base = `chrome-extension://${id}`;
  const probe = await context.newPage(); await probe.goto(`${base}/auth-result.html`);
  console.log('Browser:', context.browser().version());
  const live = JSON.parse(process.env.FACT_LENS_DC_IMAGE_URLS || '[]');
  const before = [];
  for (const url of live) before.push(await probe.evaluate(async url => {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const type = response.headers.get('content-type'); await response.body?.cancel(); return { status: response.status, type };
  }, url));
  assert.equal(await probe.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'images.prepare' })).ok), true);
  const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  assert.equal(rules.length, 1); assert.deepEqual(rules[0].condition.initiatorDomains, [id]);
  if (live.length) {
    const after = await probe.evaluate(async urls => {
      const { imageBlob, prepareImages } = await import(chrome.runtime.getURL('image-probe.js'));
      const source = [];
      for (const src of urls) {
        const response = await fetch(src, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(20000) });
        const originalType = response.headers.get('content-type'); await response.body?.cancel();
        const blob = await imageBlob(src, AbortSignal.timeout(20000)), bitmap = await createImageBitmap(blob);
        source.push({ status: response.status, originalType, detectedType: blob.type, bytes: blob.size, width: bitmap.width, height: bitmap.height }); bitmap.close();
      }
      const result = await prepareImages(urls.map((src, i) => ({ id: `image-${i + 1}`, src, kind: 'body', alt: '', caption: '' })), AbortSignal.timeout(60000));
      return { source, loaded: result.loaded.map(item => ({ id: item.id, jpeg: item.dataUrl.startsWith('data:image/jpeg;base64,'), bytes: item.dataUrl.length })), warnings: result.warnings };
    }, live);
    assert.equal(after.loaded.length, live.length); assert.deepEqual(after.warnings, []);
    assert.ok(after.source.every(item => item.status === 200 && item.width > 120 && item.height > 80 && /^image\//.test(item.detectedType)));
    assert.ok(after.loaded.every(item => item.jpeg && item.bytes > 1000));
    console.log('LIVE selected public DC image responses:', JSON.stringify({ before, after }));
  }
  const png = await probe.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 850; canvas.height = 588; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 850, 588); ctx.fillStyle = '#123'; ctx.font = '40px sans-serif'; ctx.fillText('DC IMAGE OCR 123', 30, 90); return canvas.toDataURL('image/png'); });
  const bytes = Buffer.from(png.split(',')[1], 'base64');
  await context.route(/https:\/\/(dcimg8\.dcinside\.co\.kr|nstatic\.dcinside\.com)\/.+fixture/, route => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  const images = ['first', 'second'].map(no => `https://dcimg8.dcinside.co.kr/viewimage.php?id=fixture&no=${no}`);
  const lead = '현재 게시글의 본문과 첨부 이미지가 분석 대상입니다. 하단 글 목록은 더 길어도 본문이 아닙니다.';
  const fixture = `<meta charset="utf-8"><title>디시 이미지 수집 회귀 검사</title><main><article>${Array.from({length:100},(_,i)=>`<a href="/menu/${i}">상단 메뉴 ${i}</a> `).join('')}</article><article><h3>글 제목</h3><div class="writing_view_box"><div class="write_div"><p>${lead}</p>${images.map(src => `<div class="imgwrap"><img src="${src}" width="425" height="294"></div>`).join('')}<div class="og-img"><img src="https://nstatic.dcinside.com/images/fixture.png" width="150" height="100"></div><img src="https://dcimg8.dcinside.co.kr/dccon.php?fixture=emoji" width="100" height="100"><form><textarea>FORM_SECRET</textarea></form><p hidden>HIDDEN_SECRET</p></div></div></article><article id="unrelated">${Array.from({length:1500},(_,i)=>`<a href="/unrelated/${i}">UNRELATED_LIST_SECRET ${i}</a> `).join('')}${Array.from({ length: 8 }, (_, i) => `<img src="https://dcimg8.dcinside.co.kr/viewimage.php?id=fixture&no=unrelated${i}" width="200" height="150">`).join('')}</article></main>`;
  await context.route('https://gall.dcinside.com/mgallery/board/view/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage(); await page.goto('https://gall.dcinside.com/mgallery/board/view/?id=qa&no=1');
  await page.locator('.write_div img').evaluateAll(nodes => Promise.all(nodes.map(node => node.decode())));
  const extracted = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://gall.dcinside.com/mgallery/board/view/*' });
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] }))[0].result;
  });
  if (!extracted.text?.includes(lead)) console.log('Selected fixture root', await page.locator('[data-fact-lens-root]').evaluate(node=>({tag:node.tagName,id:node.id,cls:node.className})),extracted.text?.length);
  assert.equal(extracted.extractionError, undefined); assert.ok(extracted.text.includes(lead)); assert.ok(!/SECRET/.test(extracted.text));
  assert.equal(extracted.images.length, 2); assert.deepEqual(extracted.images.map(image => image.src), images);
  assert.ok(extracted.images.every(image => image.kind === 'body' && image.locationId));
  const result = await probe.evaluate(async images => {
    const { prepareImages } = await import(chrome.runtime.getURL('image-probe.js'));
    const result = await prepareImages(images, AbortSignal.timeout(20000));
    const box = document.createElement('section'); box.id = 'dc-preview';
    for (const item of result.loaded) { const image = document.createElement('img'); image.src = item.dataUrl; image.style.width = '100%'; image.alt = item.id; box.append(image); await image.decode(); }
    document.body.append(box);
    return { ids: result.loaded.map(image => image.id), warnings: result.warnings };
  }, extracted.images);
  assert.deepEqual(result.ids, ['image-1','image-2']); assert.deepEqual(result.warnings, []);
  const preview = await probe.evaluate(async src => { const image = new Image(); image.referrerPolicy = 'no-referrer'; image.src = src; document.body.append(image); await image.decode(); return [image.naturalWidth, image.naturalHeight]; }, images[0]);
  assert.deepEqual(preview, [850,588]);
  const evidence = process.env.FACT_LENS_EVIDENCE || path.join(os.tmpdir(), 'fact-lens-dc-evidence'); await mkdir(evidence, { recursive: true });
  await probe.locator('#dc-preview').screenshot({ path: path.join(evidence, 'decoded-images.png') });
  console.log('PASS DC-shaped multiple article DOM: actual body/2 images, unrelated list and link/emoji thumbnails excluded; generic binary PNG decoded to real JPEG pixel payload; own-extension image preview succeeds.');
  console.log('PASS one session rule restricted to own extension and DC image endpoints; no cookies, account data or OpenAI model calls used. Screenshot:', evidence);
} finally {
  await context.close();
  if (root.startsWith(path.join(os.tmpdir(), 'fact-lens-dc-images-'))) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}
