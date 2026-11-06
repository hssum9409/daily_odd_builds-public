import { analysisFixture, verdictFixture } from './analysis-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelResponse } from '../shared/model-response.mjs';
import { requestStructured, checkArticle } from '../extension/provider.js';
import { extractionSchema } from '../shared/structured.mjs';
import { recommendedEffort, recommendedModel } from '../shared/preferences.mjs';
const completed = () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"claims":[]}' }] }] });
const signal = () => new AbortController().signal;
function setup(handler) {
  const requests = [], diagnostics = [];
  globalThis.chrome = { runtime: { async sendMessage() { return { ok: true, data: 'QA_AUTH_SECRET' }; } }, storage: { session: { async set(value) { diagnostics.push(value); } } } };
  globalThis.fetch = async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); return handler(body, requests.length); };
  return { requests, diagnostics };
}
test('recommendations use the account catalog and fall back to an available model', () => {
  const ids = ['other', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol'];
  const catalog = ids.map(id => ({ id }));
  for (const [preset, id, effort] of [
    ['auto', 'gpt-6.1-terra', 'medium'], ['free', 'gpt-6-luna', 'medium'], ['plus', 'gpt-6.1-terra', 'medium'], ['pro', 'gpt-6.1-sol', 'high'],
  ]) {
    const model = recommendedModel(catalog, preset);
    assert.equal(model.id, id);
    assert.equal(recommendedEffort(model.id), effort);
  }
  assert.equal(recommendedModel(catalog.filter(model => model.id !== 'gpt-6.1-terra'), 'auto').id, 'gpt-6-luna');
  assert.equal(recommendedModel(catalog.filter(model => model.id !== 'gpt-6.1-terra' && model.id !== 'gpt-6-luna'), 'auto').id, 'gpt-6.1-sol');
  assert.equal(recommendedModel(catalog.slice(0, 1), 'plus').id, 'other');
  assert.equal(recommendedEffort('other'), undefined);
});

test('a rejected effort falls back independently of Fast, model, and web search', async () => {
  const { requests, diagnostics } = setup(body => body.reasoning
    ? Response.json({ detail: [{ loc: ['body', 'reasoning', 'effort'], msg: 'Unsupported value' }] }, { status: 400 })
    : completed());
  let fallback = 0;
  await requestStructured('qa-effort', 'Check', '{}', extractionSchema, true, signal(), '주장 검증',
    { effort: 'high', onEffortFallback: () => fallback++ });
  assert.equal(fallback, 1);
  const { reasoning, ...withoutEffort } = requests[0];
  assert.deepEqual(reasoning, { effort: 'high' });
  assert.deepEqual(requests[1], withoutEffort);
  assert.equal(requests[1].service_tier, 'priority');
  assert.deepEqual(requests[1].tools, [{ type: 'web_search' }]);
  assert.equal(diagnostics.at(-1).lastRequestDiagnostic.wireEffort, 'omitted');
});
test('detail-string and validation-array HTTP 400 bodies identify tier/schema/input without exposing descriptors or echoed inputs', async () => {
  for (const [body, category, shape, parameter] of [
    [{ detail: 'Unsupported value for service_tier: fast. PRIVATE_QA_TEXT' }, 'tier_rejected', 'detail_string', undefined],
    [{ detail: [{ type: 'literal_error', loc: ['body', 'service_tier'], msg: 'Invalid tier PRIVATE_QA_TEXT', input: 'PRIVATE_QA_TOKEN' }] }, 'tier_rejected', 'detail_array', 'service_tier'],
    [{ detail: { message: 'Unsupported text.format json_schema PRIVATE_QA_TEXT' } }, 'structured_format_rejected', 'detail_object', undefined],
    [{ error: { code: 'invalid_type', param: 'input[0].content', message: 'Expected an array PRIVATE_QA_TEXT' } }, 'input_format_rejected', 'error_object', 'input'],
  ]) await assert.rejects(readModelResponse(Response.json(body, { status: 400 })), error => {
    assert.equal(error.diagnostic.errorCategory, category); assert.equal(error.diagnostic.errorShape, shape); assert.equal(error.diagnostic.parameter, parameter);
    assert.ok(!JSON.stringify(error.diagnostic).includes('PRIVATE_QA')); assert.ok(!error.message.includes('PRIVATE_QA')); return true;
  });
});
test('confirmed schema-option rejection retries without text.format, keeps Fast/search/JSON contract and local schema validation', async () => {
  const { requests } = setup((_body, n) => n === 1 ? Response.json({ detail: 'Unsupported text.format json_schema' }, { status: 400 }) : completed());
  const result = await requestStructured('qa-schema-rejection', 'Extract', 'PRIVATE_ARTICLE', extractionSchema, true, signal());
  assert.equal(requests.length, 2); assert.equal(requests[0].text.format.strict, true); assert.equal(requests[1].text, undefined);
  assert.ok(requests.every(r => r.service_tier === 'priority' && r.store === false && r.stream === true && r.tool_choice === 'required'));
  assert.ok(requests[1].instructions.includes(JSON.stringify(extractionSchema))); assert.deepEqual(result.parsed, { claims: [] });
  assert.deepEqual(result.compatibility, ['prompt_json']);
});
test('priority Fast alias can negotiate fast without silently requesting standard; successful alias is reused', async () => {
  const { requests } = setup(body => body.service_tier === 'priority' ? Response.json({ detail: [{ loc: ['body', 'service_tier'], msg: 'Unsupported alias' }] }, { status: 400 }) : completed());
  await requestStructured('qa-fast-alias', 'Extract', '{}', extractionSchema, false, signal());
  await requestStructured('qa-fast-alias', 'Extract', '{}', extractionSchema, false, signal());
  assert.deepEqual(requests.map(r => r.service_tier), ['priority', 'fast', 'fast']);
});
test('when both Fast and standard are denied, recovery still fails explicitly without fabricating output', async () => {
  const { requests, diagnostics } = setup(() => Response.json({ detail: 'service_tier is not allowed for this account PRIVATE_QA_TEXT' }, { status: 400 }));
  await assert.rejects(requestStructured('qa-fast-denied', 'Extract', 'PRIVATE_ARTICLE', extractionSchema, false, signal()), error => /Fast 모드를 해제/.test(error.message) && error.diagnostic.errorCategory === 'tier_rejected');
  assert.deepEqual(requests.map(r => r.service_tier), ['priority', 'default']); assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE_'));
});
test('Fast-off requests may omit a rejected service_tier field, without enabling Fast', async () => {
  const { requests } = setup(body => body.service_tier ? Response.json({ error: { code: 'unsupported_parameter', param: 'service_tier' } }, { status: 400 }) : completed());
  const result = await requestStructured('qa-no-tier-field', 'Extract', '{}', extractionSchema, false, signal(), '전체 맥락 분석', { fast: false });
  assert.deepEqual(requests.map(r => r.service_tier), ['default', undefined]); assert.equal(result.effectiveTier, 'unreported');
});
test('context-limit errors do not retry; opaque Fast 400 gets one standard probe with the same input/schema', async () => {
  for (const [body, category] of [[{ detail: 'maximum context length exceeded PRIVATE_QA' }, 'context_limit'], [{ detail: 'PRIVATE_QA_OPAQUE' }, 'unspecified']]) {
    const { requests } = setup(() => Response.json(body, { status: 400 }));
    await assert.rejects(requestStructured('qa-unrecoverable', 'Extract', '{}', extractionSchema, false, signal()), error => error.diagnostic.errorCategory === category && !error.message.includes('PRIVATE_QA'));
    assert.equal(requests.length, category === 'unspecified' ? 2 : 1);
    if (requests.length === 2) { assert.deepEqual(requests[0].text, requests[1].text); assert.deepEqual(requests[0].input, requests[1].input); assert.equal(requests[1].service_tier, 'default'); }
  }
});

test('reported live pattern: opaque Fast 400 and successful Fast-off recovers, reports standard fallback and avoids repeated rejected Fast calls', async () => {
  const article = { title: '관측 조건에 관한 기사', text: '원문에서 관측 자료와 조건을 함께 대조해야 한다고 주장합니다.', url: 'https://article.example/' };
  const result = value => Response.json({ status: 'completed', service_tier: 'default', output: [
    ...(value.verdict ? [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://evidence.example/' }] } }] : []),
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
  ] });
  const { requests } = setup(body => {
    if (body.service_tier !== 'default') return Response.json({ detail: 'PRIVATE_QA_OPAQUE_PROVIDER_ERROR' }, { status: 400 });
    assert.equal(body.model, 'gpt-6.1-sol');
    const input = JSON.parse(body.input[0].content);
    if (!body.tools) return result(analysisFixture([{ claim: '관측 결과의 해석은 자료와 조건을 함께 대조해야 한다는 맥락입니다.', quote: article.text, origin: 'body' }], input));
    return result(verdictFixture({ verdict: 'supported', explanation: '**관측 조건을 함께 확인**해야 한다는 근거입니다.', caveat: '', sources: [{ url: 'https://evidence.example/', evidence: '**자료와 관측 조건**을 제시합니다.', relation: 'supports' }] }, input));
  });
  const report = await checkArticle(article, 'gpt-6.1-sol', signal(), () => {});
  assert.deepEqual(requests.map(r => r.service_tier), ['priority', 'default', 'default']);
  assert.equal(report.fast, true); assert.equal(report.fastFallback, true); assert.equal(report.warnings.length, 1);
  assert.deepEqual(report.effectiveTiers, ['default']); assert.equal(report.claims[0].verdict, 'supported');
  assert.ok(report.warnings[0].includes('일반 처리')); assert.ok(!JSON.stringify(report).includes('PRIVATE_QA'));
});
