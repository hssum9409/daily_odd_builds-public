import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceBlocks, validateAnalysis, validateGroupVerdict } from '../shared/analysis.mjs';
import { requestStructured } from '../extension/provider.js';
import { pageAnalysisSchema } from '../shared/analysis.mjs';
import { analysisFixture } from './analysis-fixture.mjs';
const sentences = ['이 발전 방식은 특정 조건에서 에너지 효율이 높다고 주장합니다.', '다만 설치 비용과 운영 기간을 함께 고려해야 한다는 조건이 붙습니다.', '한편 관측 자료는 별도 실험에서 수집되었으며 관련 통계는 다른 기간을 사용합니다.'];
const article = { title: '에너지 방식과 관측 자료의 조건을 논하는 글', text: sentences.join('\n\n'), url: 'https://article.example/' };
const blocks = sourceBlocks(article);
function plan() {
  const aspect = (text, sourceId) => ({ claim: text, sourceId, quote: text });
  return { overview: '효율과 비용은 하나의 조건부 주장으로, 자료 수집과 통계 기간은 별도 쟁점으로 다루는 글입니다.', claims: [
    { id: 'efficiency', claim: '이 방식의 효율 우위는 설치 비용과 운영 기간을 함께 고려해야 성립한다는 주장입니다.', context: '효율을 비용과 분리해 단정하지 않도록 두 구간을 묶었습니다.', aspects: [aspect(sentences[0], 'body-1'), aspect(sentences[1], 'body-2')] },
    { id: 'observation', claim: '기사의 관측 자료는 별도 실험에서 수집했다는 주장입니다.', context: '한 문단의 자료 출처와 통계 기간은 서로 다른 증거가 필요한 쟁점입니다.', aspects: [aspect('관측 자료는 별도 실험에서 수집되었으며', 'body-3')] },
    { id: 'period', claim: '통계에 사용된 기간이 관측 자료의 수집 기간과 다르다는 주장입니다.', context: '같은 문단 안에서도 별도 검증해야 하는 기간의 문제입니다.', aspects: [aspect('관련 통계는 다른 기간을 사용합니다.', 'body-3')] },
  ], coverage: [
    { sourceId: 'context-1', groupIds: [], role: 'context' },
    { sourceId: 'body-1', groupIds: ['efficiency'], role: 'claim' },
    { sourceId: 'body-2', groupIds: ['efficiency'], role: 'claim' },
    { sourceId: 'body-3', groupIds: ['observation', 'period'], role: 'claim' },
  ] };
}
test('whole-page plan merges two passages and splits one compound passage into independent major topics without a quota', () => {
  const result = validateAnalysis(plan(), article, blocks);
  assert.equal(result.claims.length, 3); assert.equal(result.claims[0].aspects.length, 2);
  assert.equal(result.claims[1].aspects[0].sourceId, result.claims[2].aspects[0].sourceId);
  assert.equal(result.coverage.length, blocks.length); assert.ok(result.overview.includes('조건부'));
});
test('coverage omissions, duplicate sections, invented groups and unlinked quotations are rejected instead of silently showing a subset', () => {
  for (const mutate of [
    p => p.coverage.shift(),
    p => p.coverage.push({ ...p.coverage[0], role: 'opinion' }),
    p => p.coverage[1].groupIds.push('invented'),
    p => p.claims[0].aspects[0].quote = '원문에 없는 인용을 임의로 만든 문장입니다.',
  ]) { const p = plan(); mutate(p); assert.throws(() => validateAnalysis(p, article, blocks)); }
});
test('no-checkable-claims result still classifies the entire supplied page', () => {
  const result = validateAnalysis({ overview: '검증 대상 없이 의견과 배경으로 구성된 글입니다.', claims: [], coverage: blocks.map(b => ({ sourceId: b.id, groupIds: [], role: 'opinion' })) }, article, blocks);
  assert.equal(result.claims.length, 0); assert.equal(result.coverage.length, blocks.length);
});
test('the analysis-derived number of major claims is not sliced to the old 3/6/8 choices', () => {
  const claims = Array.from({ length: 11 }, (_, i) => ({ claim: `별도 쟁점 ${i + 1}`, quote: `서로 독립적인 검증 쟁점 ${i + 1}에 관한 원문 설명입니다.`, origin: 'body' }));
  const page = { title: '여러 독립 쟁점', text: claims.map(c => c.quote).join('\n\n') }, sections = sourceBlocks(page);
  assert.equal(validateAnalysis(analysisFixture(claims, { sourceBlocks: sections }), page, sections).claims.length, 11);
});
test('a schema-valid but incomplete coverage map retries once; no partial plan is silently accepted', async () => {
  let calls = 0; const diagnostics = [];
  globalThis.chrome = { runtime: { async sendMessage() { return { ok: true, data: 'QA_TOKEN' }; } }, storage: { session: { async set(value) { diagnostics.push(value); } } } };
  globalThis.fetch = async () => {
    const value = plan(); if (++calls === 1) value.coverage.shift();
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  };
  const result = await requestStructured('model', 'Analyze entire page', JSON.stringify({ sourceBlocks: blocks }), pageAnalysisSchema, false, new AbortController().signal, '전체 맥락 분석', { validate: value => validateAnalysis(value, article, blocks) });
  assert.equal(calls, 2); assert.equal(result.validated.coverage.length, blocks.length); assert.equal(result.formatRetries, 1);
  assert.equal(diagnostics[0].lastRequestDiagnostic.validation, 'source_mapping'); assert.ok(!JSON.stringify(diagnostics).includes(article.title));
});
test('all input body text is carried through bounded contiguous blocks, including the end of a long paragraph', () => {
  const text = '가'.repeat(7201) + ' 마지막 결론'; const body = sourceBlocks({ title: '제목', text }).filter(b => b.origin === 'body');
  assert.equal(body.map(b => b.text).join(''), text); assert.ok(body.every(b => b.text.length <= 2400));
});
const completed = { output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://evidence.example/' }, { url: article.url }] } }] };
function judgment(group, verdicts, missingSource = false) { return { verdict: 'supported', reason: '모든 세부 주장을 지지하는 근거가 있습니다.', explanation: '모두 지지된다는 잘못된 종합 설명', caveat: '', sources: [{ url: 'https://evidence.example/', evidence: '독립적인 검색 근거입니다.', relation: 'supports' }], scopeSourceUrls: ['https://evidence.example/'], aspectResults: group.aspects.map((a, i) => ({ id: a.id, checks: [{ claim: a.claim, quote: a.quote, scope: 'component', verdict: verdicts[i], reason: '독립적인 근거입니다.', explanation: '각 소주장의 근거를 설명합니다.', sourceUrls: missingSource && i === 1 ? ['https://invented.example/'] : ['https://evidence.example/'] }] })) }; }
test('contradictory subclaim verdicts cannot become a wholly supported major claim', () => {
  const group = validateAnalysis(plan(), article, blocks).claims[0];
  const result = validateGroupVerdict(judgment(group, ['supported', 'refuted']), completed, group, article.url);
  assert.equal(result.verdict, 'mixed'); assert.ok(!result.reason.includes('모든 세부 주장을 지지')); assert.ok(!result.explanation.includes('모두 지지')); assert.equal(result.aspects[1].verdict, 'refuted');
});
test('missing subclaim evidence downgrades the major claim and missing/duplicate result ids fail closed', () => {
  const group = validateAnalysis(plan(), article, blocks).claims[0];
  const result = validateGroupVerdict(judgment(group, ['supported', 'supported'], true), completed, group, article.url);
  assert.equal(result.verdict, 'insufficient'); assert.ok(result.reason.includes('근거가 부족')); assert.equal(result.aspects[1].verdict, 'insufficient');
  const missing = judgment(group, ['supported', 'supported']); missing.aspectResults.pop(); assert.throws(() => validateGroupVerdict(missing, completed, group, article.url));
  const duplicate = judgment(group, ['supported', 'supported']); duplicate.aspectResults[1].id = duplicate.aspectResults[0].id; assert.throws(() => validateGroupVerdict(duplicate, completed, group, article.url));
});
test('missing or long brief reason fails validation without truncating a material qualification', () => {
  const group = validateAnalysis(plan(), article, blocks).claims[0];
  for (const reason of [undefined, '', ' ', '가'.repeat(161)]) {
    const data = { ...judgment(group, ['supported', 'supported']), reason };
    assert.throws(() => validateGroupVerdict(data, completed, group, article.url), error => error.code === 'invalid_reason');
  }
  const data = judgment(group, ['supported', 'supported']); data.reason = '관측 자료와 조건이\n주장을 뒷받침합니다.';
  assert.equal(validateGroupVerdict(data, completed, group, article.url).reason, '관측 자료와 조건이 주장을 뒷받침합니다.');
});
