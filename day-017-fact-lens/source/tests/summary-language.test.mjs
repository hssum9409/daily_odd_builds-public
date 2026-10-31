import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeArticle, checkArticle } from '../extension/provider.js';
import { analysisFixture, verdictFixture } from './analysis-fixture.mjs';
import { sourceBlocks, validateGroupVerdict } from '../shared/analysis.mjs';
import { validateSummary } from '../shared/summary.mjs';
import { LANGUAGES, languageInstruction, outputLanguage } from '../shared/language.mjs';
import { maxClaims } from '../shared/preferences.mjs';
const article = { title: 'A source in English', text: 'The moon orbits Earth.\n\nThe page describes reflected sunlight.', url: 'https://article.example/', supplementary: [{ kind: 'comment', text: '무료 가입하고 보너스를 받으세요! 추천인 코드 ABC123 https://shop.example/' }] };
const completed = value => Response.json({ status: 'completed', service_tier: 'priority', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const plan = blocks => ({ overview: '요약 개요', sections: [{ heading: '핵심', summary: '**핵심 내용**과 조건', sourceIds: blocks.map(block => block.id) }], coverage: blocks.map(block => ({ sourceId: block.id, role: 'content' })) });
function setup(handler) {
  globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: true, data: 'QA_TOKEN' }) }, storage: { session: { set: async () => {} } } };
  const requests = [];
  globalThis.fetch = async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); return handler(body); };
  return requests;
}
test('four output languages apply to summary without external search; original source and exclusions remain intact', async () => {
  for (const language of Object.keys(LANGUAGES)) {
    const requests = setup(body => {
      const input = JSON.parse(body.input[0].content);
      assert.ok(!JSON.stringify(input).includes('ABC123'));
      assert.ok(input.sourceBlocks.some(block => block.text.includes('The moon orbits Earth')));
      return completed(plan(input.sourceBlocks));
    });
    const result = await summarizeArticle(article, 'test-model', new AbortController().signal, { language });
    assert.equal(result.mode, 'summary'); assert.equal(result.language, language); assert.equal(result.excludedPromotionalCount, 1);
    assert.equal(requests.length, 1); assert.equal(requests[0].tools, undefined); assert.equal(requests[0].tool_choice, undefined);
    assert.equal(requests[0].text.format.name, 'article_summary'); assert.ok(requests[0].instructions.includes(languageInstruction(language)));
    assert.ok(result.sections[0].originals.some(block => block.text.includes('The moon orbits Earth')));
  }
});
test('summary rejects missing source coverage, fabricated IDs, promotional attachments and unattached material content', () => {
  const blocks = sourceBlocks(article), valid = plan(blocks);
  assert.ok(validateSummary(valid, blocks).sections.length);
  const mutate = fn => { const copy = structuredClone(valid); fn(copy); return copy; };
  assert.throws(() => validateSummary(mutate(data => data.coverage.pop()), blocks));
  assert.throws(() => validateSummary(mutate(data => data.sections[0].sourceIds.push('invented')), blocks));
  assert.throws(() => validateSummary(mutate(data => data.sections[0].sourceIds.pop()), blocks));
  assert.throws(() => validateSummary(mutate(data => { data.coverage.at(-1).role = 'promotional'; }), blocks));
  assert.throws(() => validateSummary(mutate(data => { data.coverage[0].role = 'promotional'; data.sections[0].sourceIds.shift(); }), blocks));
});
test('selected language reaches analysis and every verifier without translating the original quote', async () => {
  const clean = { ...article, supplementary: [] }, quote = 'The moon orbits Earth.';
  for (const language of Object.keys(LANGUAGES)) {
    const requests = setup(body => {
      const input = JSON.parse(body.input[0].content);
      if (!body.tools) return completed(analysisFixture([{ quote, claim: 'Translated claim', origin: 'body' }], input));
      assert.equal(input.originalQuote, quote);
      const verdict = verdictFixture({ verdict: 'supported', reason: 'Independent observations support the orbit.', explanation: '**Observed orbit.**', caveat: '', sources: [{ url: 'https://evidence.example/', relation: 'supports', evidence: '**Independent observation.**' }] }, input);
      return Response.json({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://evidence.example/' }] } }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(verdict) }] }] });
    });
    const result = await checkArticle(clean, 'test-model', new AbortController().signal, () => {}, { language });
    assert.equal(result.language, language); assert.equal(result.claims[0].quote, quote); assert.equal(result.claims[0].verdict, 'supported');
    assert.equal(requests.length, 2); assert.ok(requests.every(body => body.instructions.endsWith(languageInstruction(language))));
  }
  assert.equal(outputLanguage('unsupported'), 'ko');
});
test('verdict corrections use selected language instead of Korean fallback', () => {
  const group = { aspects: [{ id: 'a', claim: 'A', quote: 'A' }, { id: 'b', claim: 'B', quote: 'B' }] };
  const response = { output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://evidence.example/' }] } }] };
  const value = { verdict: 'supported', reason: 'All true', explanation: 'All true', caveat: '', sources: [{ url: 'https://evidence.example/', evidence: 'Evidence', relation: 'supports' }], scopeSourceUrls: ['https://evidence.example/'], aspectResults: ['a','b'].map((id, i) => ({ id, checks: [{ claim: id.toUpperCase(), quote: id.toUpperCase(), scope: 'component', verdict: i ? 'refuted' : 'supported', reason: 'Detail', explanation: 'Detail', sourceUrls: ['https://evidence.example/'] }] })) };
  const result = validateGroupVerdict(value, response, group, article.url, 'en');
  assert.equal(result.verdict, 'mixed'); assert.match(result.reason, /conflicting/); assert.ok(!/[가-힣]/.test(result.explanation + result.caveat));
});
test('claim maximum defaults to eight, supports four through twenty, and rejects over-limit output without silently truncating', async () => {
  for (const value of [undefined, '', 'bad', 3, 21, 4.5]) assert.equal(maxClaims(value), 8);
  assert.equal(maxClaims('4'), 4); assert.equal(maxClaims('20'), 20);
  const requests = setup(body => {
    assert.ok(!body.tools);
    const input = JSON.parse(body.input[0].content);
    return completed(analysisFixture(Array.from({ length: 5 }, (_, i) => ({ claim: `Topic ${i}`, quote: 'The moon orbits Earth.', origin: 'body' })), input));
  });
  await assert.rejects(() => checkArticle({ ...article, supplementary: [] }, 'test-model', new AbortController().signal, () => {}, { maxClaims: 4 }), error => error.code === 'schema_mismatch');
  assert.equal(requests.length, 2); assert.ok(requests.every(body=>body.text.format.schema.properties.claims.maxItems===4)); assert.ok(requests.every(body => body.instructions.includes('MAXIMUM is 4 major claims')));
  const quotes = Array.from({ length: 20 }, (_, i) => `Independent source assertion number ${i + 1}.`);
  const twenty = { ...article, supplementary: [], text: quotes.join('\n\n') };
  setup(body => {
    const input = JSON.parse(body.input[0].content);
    if (!body.tools) return completed(analysisFixture(quotes.map(quote => ({ quote, claim: quote, origin: 'body' })), input));
    const value = verdictFixture({ verdict: 'supported', reason: 'Independent evidence supports this assertion.', explanation: 'Evidence', caveat: '', sources: [{ url: 'https://evidence.example/', evidence: 'Evidence', relation: 'supports' }] }, input);
    return Response.json({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://evidence.example/' }] } }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  });
  const result = await checkArticle(twenty, 'test-model', new AbortController().signal, () => {}, { maxClaims: 20 });
  assert.equal(result.claims.length, 20); assert.equal(result.maxClaims, 20); assert.ok(result.claims.every(claim => claim.verdict === 'supported'));
});
