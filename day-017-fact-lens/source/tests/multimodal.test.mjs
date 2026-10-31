import { adaptJsonFixture } from './analysis-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle } from '../extension/provider.js';
import { imageBlob } from '../extension/images.js';
import { validateClaims } from '../shared/report.mjs';
import { supplementaryBlocks } from '../shared/supplementary.mjs';
const image = { id: 'image-1', locationId: 'img-location', kind: 'body', alt: '도표', caption: '실험 결과', dataUrl: 'data:image/jpeg;base64,QA_PIXELS' };
const bodyQuote = '원문 본문에서 설명하는 과학적 검증 대상 주장입니다.';
const commentQuote = '댓글 작성자가 반론으로 제시한 독립적인 사실 주장입니다.';
const ocr = '관측 결과 달은 태양에서 온 빛을 반사합니다.';
const visual = '도표에는 관측 시점에 따른 밝기의 변화가 표시되어 있습니다.';
const article = { title: '관측에 관한 전체 맥락', text: bodyQuote, url: 'https://page.example/', loadedImages: [image], supplementary: [{ kind: 'comment', text: commentQuote, locationId: 'comment-location' }] };
function output(value, searched = false) { return Response.json({ status: 'completed', service_tier: 'fast', output: [
  ...(searched ? [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://evidence.example/' }] } }] : []),
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
] }); }
const vision = { images: [{ id: 'image-1', transcription: ocr, description: visual, uncertainty: '작은 글자는 일부 불명확합니다.' }] };
const verdict = { verdict: 'supported', explanation: '**핵심 결론**을 검색 근거와 대조했습니다.', caveat: '', sources: [{ url: 'https://evidence.example/', evidence: '**주장을 지지하는 근거**입니다.', relation: 'supports' }] };
const inputText = body => JSON.parse(Array.isArray(body.input[0].content) ? body.input[0].content[0].text : body.input[0].content);
function setup(handler) {
  const requests = [];
  globalThis.chrome = { runtime: { async sendMessage() { return { ok: true, data: 'QA_TOKEN' }; } }, storage: { session: { async set() {} } } };
  globalThis.fetch = async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); return adaptJsonFixture(await handler(body, options), body); };
  return requests;
}
test('actual image bytes enter vision and image-verdict requests; OCR, visual description and comments retain distinct origins', async () => {
  const requests = setup(body => {
    if (body.text.format.name === 'page_images') return output(vision);
    if (!body.tools) return output({ claims: [
      { claim: '사진에 제시된 관측에서 달빛은 반사광이라는 의미입니다.', quote: ocr, origin: 'image_text' },
      { claim: '댓글 작성자는 본문의 관측 주장에 별도의 사실 반론을 제시합니다.', quote: commentQuote, origin: 'comment' },
      { claim: '원문에서 설명한 조건에서 관측 결과를 해석해야 한다는 주장입니다.', quote: bodyQuote, origin: 'body' },
    ] });
    return output(verdict, true);
  });
  const report = await checkArticle(article, 'gpt-6.1-sol', new AbortController().signal, () => {});
  assert.equal(requests.length, 5);
  assert.equal(requests[0].input[0].content[1].type, 'input_image'); assert.equal(requests[0].input[0].content[1].image_url, image.dataUrl);
  const extracted = inputText(requests[1]);
  assert.deepEqual(extracted.sourceBlocks.filter(b => ['comment', 'image_text', 'image_visual'].includes(b.origin)).map(b => b.origin), ['comment', 'image_text', 'image_visual']);
  assert.deepEqual(report.claims.map(c => c.origin.kind), ['image_text', 'comment', 'body']);
  assert.equal(report.claims[0].origin.locationId, image.locationId); assert.equal(report.claims[1].origin.locationId, 'comment-location');
  const imageCheck = requests.find(body => body.tools && inputText(body).quoteOrigin.imageId);
  assert.equal(imageCheck.input[0].content[1].image_url, image.dataUrl);
  assert.match(report.claims[0].caveat, /오인식/); assert.match(report.claims[0].caveat, /불명확/);
  const textCheck = requests.find(body => body.tools && inputText(body).quoteOrigin.kind === 'body');
  assert.equal(typeof textCheck.input[0].content, 'string');
  assert.ok(!JSON.stringify(report).includes('QA_PIXELS')); assert.equal(report.imageAnalysis[0].transcription, ocr);
});
test('an invented image id is rejected; failure is visible and text checking continues', async () => {
  setup(body => body.text.format.name === 'page_images' ? output({ images: [{ ...vision.images[0], id: 'invented-image' }] }) : !body.tools ? output({ claims: [{ claim: '본문 맥락의 요약', quote: bodyQuote, origin: 'body' }] }) : output(verdict, true));
  const report = await checkArticle(article, 'model', new AbortController().signal, () => {});
  assert.equal(report.imageAnalysis.length, 0); assert.equal(report.warnings.length, 1); assert.equal(report.claims[0].verdict, 'supported');
});
test('failed image recognition cannot turn an invented OCR quotation into an accepted claim', async () => {
  setup(body => body.text.format.name === 'page_images' ? new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } }) : output({ claims: [{ claim: '가짜 OCR', quote: ocr, origin: 'image_text' }] }));
  await assert.rejects(checkArticle(article, 'model', new AbortController().signal, () => {}), /schema_mismatch/);
});
test('same text in body and comment retains declared origin; false origin is rejected', () => {
  const page = { text: commentQuote, supplementary: article.supplementary };
  const result = validateClaims({ claims: [{ claim: '본문 주장', quote: commentQuote, origin: 'body' }, { claim: '댓글 주장', quote: commentQuote, origin: 'comment' }] }, page, 6);
  assert.deepEqual(result.map(c => c.origin.kind), ['body', 'comment']);
  assert.throws(() => validateClaims({ claims: [{ claim: '없는 출처', quote: bodyQuote, origin: 'comment' }] }, article, 6));
});
test('edited supplementary text is bounded and preserved beyond one original paragraph', () => {
  const text = '댓글 '.repeat(3000); const blocks = supplementaryBlocks({ supplementary: [{ kind: 'comment', text }] });
  assert.equal(blocks[0].text.length, text.trim().length); assert.ok(blocks[0].text.length > 2400);
});
test('image downloads omit credentials/referrer, reject HTML, unsafe URLs, oversized and cancelled images', async () => {
  let seen;
  globalThis.fetch = async (_url, options) => { seen = options; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }); };
  const signal = new AbortController().signal;
  assert.equal((await imageBlob('https://images.example/photo.png', signal)).size, 3);
  assert.equal(seen.credentials, 'omit'); assert.equal(seen.referrerPolicy, 'no-referrer');
  for (const url of ['file:///secret', 'https://user:pass@images.example/photo', 'data:image/svg+xml;base64,PHN2Zz4=']) await assert.rejects(imageBlob(url, signal));
  globalThis.fetch = async () => new Response('<html>SECRET</html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(imageBlob('https://images.example/html', signal), /이미지 파일/);
  globalThis.fetch = async () => new Response('', { headers: { 'content-type': 'image/png', 'content-length': '6000000' } });
  await assert.rejects(imageBlob('https://images.example/large', signal), /5MB/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(imageBlob('data:image/png;base64,YQ==', controller.signal), error => error.name === 'AbortError');
});
