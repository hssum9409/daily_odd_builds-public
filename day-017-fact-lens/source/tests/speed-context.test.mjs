import { adaptJsonFixture } from './analysis-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, requestStructured } from '../extension/provider.js';
import { extractionSchema } from '../shared/structured.mjs';
import { validateClaims } from '../shared/report.mjs';
import { pageContexts } from '../shared/page-context.mjs';
import { emphasisParts } from '../shared/emphasis.mjs';
const claims = Array.from({ length: 6 }, (_, i) => ({ quote: `원문에 실제 존재하는 검증 대상 문장 ${i + 1}입니다.`, claim: `대상 주장 ${i + 1}`, origin: 'body' }));
const article = { title: '제목에만 있는 독립적인 중요한 주장입니다.', context: [{ kind: 'description', text: '설명에서만 제시하는 중요한 제한 조건입니다.' }, { kind: 'published', text: '2026-10-31' }], text: claims.map(c => c.quote).join('\n'), url: 'https://article.example/' };
function response(value, index) {
  const url = `https://evidence.example/${index}`;
  return new Response(JSON.stringify({ status: 'completed', service_tier: 'fast', output: [
    ...(index === undefined ? [] : [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url, title: `Source ${index}` }] } }]),
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
  ] }), { headers: { 'content-type': 'application/json' } });
}
const verdict = i => ({ verdict: 'supported', explanation: '**결론이 뒷받침됩니다.** 추가 설명입니다.', caveat: '', sources: [{ url: `https://evidence.example/${i}`, relation: 'supports', evidence: '**결정적인 근거**와 세부 설명입니다.' }] });
function setup(handler) {
  const requests = [];
  globalThis.chrome = { runtime: { async sendMessage() { return { ok: true, data: 'QA_TOKEN' }; } }, storage: { session: { async set() {} } } };
  globalThis.fetch = async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); return adaptJsonFixture(await handler(body, options), body); };
  return requests;
}
test('Fast is default, explicitly disabled by default tier, and preserved on format retry', async () => {
  let count = 0;
  const requests = setup(() => response(++count === 1 ? { wrong: true } : { claims: [] }));
  const signal = new AbortController().signal;
  await requestStructured('gpt-6.1-sol', 'extract', '{}', extractionSchema, false, signal);
  assert.deepEqual(requests.map(r => r.service_tier), ['priority', 'priority']);
  await requestStructured('gpt-6.1-sol', 'extract', '{}', extractionSchema, false, signal, '주장 추출', { fast: false });
  assert.equal(requests.at(-1).service_tier, 'default');
});
test('six claims run with at most three in flight, stream progress out of order, retain source isolation and final order', async () => {
  let active = 0, peak = 0;
  const requests = setup(async body => {
    if (!body.tools) return response({ claims });
    const input = JSON.parse(body.input[0].content), i = claims.findIndex(c => c.quote === input.originalQuote);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 80 : 8)); active--;
    return response(verdict(i), i);
  });
  const progress = [];
  const report = await checkArticle(article, 'gpt-6.1-sol', new AbortController().signal, value => progress.push(value));
  assert.equal(peak, 3); assert.equal(active, 0); assert.equal(requests.length, 7);
  assert.ok(progress.some(snapshot => snapshot[0].verdict === 'checking' && snapshot[1].verdict === 'supported'));
  assert.deepEqual(report.claims.map(c => c.quote), claims.map(c => c.quote));
  report.claims.forEach((claim, i) => assert.equal(claim.sources[0].url, `https://evidence.example/${i}`));
  assert.ok(requests.every(r => r.service_tier === 'priority'));
  assert.deepEqual(report.effectiveTiers, ['fast']);
  // Earlier snapshots must not mutate as later requests finish.
  assert.ok(progress[0].every(c => c.verdict === 'pending'));
});
test('standard tier applies to extraction and all parallel verdicts; one HTTP failure does not cancel siblings', async () => {
  const requests = setup(body => {
    if (!body.tools) return response({ claims: claims.slice(0, 3) });
    const i = claims.findIndex(c => c.quote === JSON.parse(body.input[0].content).originalQuote);
    return i === 1 ? new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } }) : response(verdict(i), i);
  });
  const report = await checkArticle(article, 'model', new AbortController().signal, () => {}, { fast: false });
  assert.deepEqual(report.claims.map(c => c.verdict), ['supported', 'insufficient', 'supported']);
  assert.ok(requests.every(r => r.service_tier === 'default')); assert.equal(report.fast, false);
});
test('cancellation aborts in-flight searches and starts no queued claims', async () => {
  const controller = new AbortController(); let active = 0;
  const requests = setup((body, options) => {
    if (!body.tools) return response({ claims });
    active++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { active--; reject(options.signal.reason); }, { once: true }));
  });
  const run = checkArticle(article, 'model', controller.signal, snapshot => {
    if (snapshot.filter(c => c.verdict === 'checking').length === 3) setTimeout(() => controller.abort(), 0);
  });
  await assert.rejects(run, error => error.name === 'AbortError');
  assert.equal(requests.length, 4); assert.equal(active, 0);
});
test('title and metadata quotations are accepted with origins, fabricated or removed context is rejected', () => {
  const input = { claims: [{ claim: '제목 주장', quote: article.title, origin: 'title' }, { claim: '설명 조건', quote: article.context[0].text }, claims[0]] };
  assert.deepEqual(validateClaims(input, article, 6).map(c => c.origin.kind), ['title', 'description', 'body']);
  assert.throws(() => validateClaims(input, { ...article, context: [] }, 6));
  assert.throws(() => validateClaims({ claims: [{ claim: '가짜', quote: '존재하지 않는 사실을 새로 만들었습니다.' }] }, article, 6));
});
test('full page context reaches extraction and each verifier, keeping nearby body and origin', async () => {
  const requests = setup(body => body.tools ? response(verdict(0), 0) : response({ claims: [{ claim: '제목 주장', quote: article.title, origin: 'title' }] }));
  await checkArticle(article, 'model', new AbortController().signal, () => {});
  const extraction = JSON.parse(requests[0].input[0].content), verification = JSON.parse(requests[1].input[0].content);
  assert.deepEqual(extraction.sourceBlocks.filter(b => b.origin !== 'body').map(b => ({ kind: b.origin, label: b.label, text: b.text })), pageContexts(article)); assert.equal(extraction.sourceBlocks.find(b => b.origin === 'body').text, article.text);
  assert.deepEqual(verification.context, pageContexts(article)); assert.equal(verification.quoteOrigin.kind, 'title');
  assert.equal(verification.nearbyPassage, article.text); assert.match(requests[1].instructions, /Reading ONLY the bold clauses/);
});
test('context has bounded size and recognizes only allowed article metadata', () => {
  const context = pageContexts({ title: 'T'.repeat(900), context: [{ kind: 'cookies', text: 'SECRET' }, ...Array.from({ length: 12 }, (_, i) => ({ kind: 'description', text: `${i}${'x'.repeat(2000)}` }))] });
  assert.equal(context[0].text.length, 500); assert.ok(context.slice(1).reduce((n, b) => n + b.text.length, 0) <= 6000);
  assert.ok(!JSON.stringify(context).includes('SECRET'));
});
test('emphasis supports only inline paired bold; HTML and unsupported Markdown remain literal text', () => {
  const parts = emphasisParts('세부 **핵심 결론** 연결 **중요한 조건** <img src=x onerror=alert(1)> [link](javascript:alert(1)) **미완성');
  assert.deepEqual(parts.filter(p => p.strong).map(p => p.text), ['핵심 결론', '중요한 조건']);
  assert.ok(parts.at(-1).text.includes('<img')); assert.ok(parts.at(-1).text.includes('**미완성'));
});
