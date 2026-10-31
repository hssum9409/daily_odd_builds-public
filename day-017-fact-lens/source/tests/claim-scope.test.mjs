import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGroupVerdict } from '../shared/analysis.mjs';
import { checkArticle } from '../extension/provider.js';
import { analysisFixture } from './analysis-fixture.mjs';

// Synthetic predicates matching the reported failure shapes; not real news evidence.
export const scopeCases = [
  { parent: '후보 측은 상대 후보의 어머니가 출연한 공격 광고를 내보냈다.', core: '어머니가 출연한 공격 광고를 내보냈다.',
    extra: '광고 당시 후보는 4%포인트 뒤졌다.', verdict: 'insufficient' },
  { parent: '두 정치인은 해당 광고를 옹호했다.', core: '두 정치인은 해당 광고를 옹호했다.',
    extra: '광고는 계속 방송됐다.', verdict: 'refuted' },
];
const origin = { kind: 'body', label: '본문', locationId: 'source-1' };
function groupFor(example) {
  return { id: 'topic', claim: example.parent, aspects: [{ id: 'aspect', claim: `${example.core} ${example.extra}`,
    quote: `${example.core} ${example.extra}`, sourceId: 'body-1', origin }] };
}
function responseFor(example, group) {
  return { verdict: 'supported', reason: '독립적인 자료가 핵심 주장을 뒷받침합니다.', explanation: '핵심 사건은 자료에서 확인됩니다.', caveat: '',
    sources: [{ url: 'https://evidence.example/core', relation: 'supports', evidence: '핵심 사건 자료' },
      { url: 'https://evidence.example/extra', relation: 'context', evidence: '별도 수치 또는 후속 사건 자료' }],
    scopeSourceUrls: ['https://evidence.example/core'], aspectResults: [{ id: group.aspects[0].id, checks: [
      { claim: example.core, quote: example.core, scope: 'component', verdict: 'supported', reason: '핵심 사건을 확인했습니다.', explanation: '핵심 사건은 확인됩니다.', sourceUrls: ['https://evidence.example/core'] },
      ...(example.extras || [example.extra]).map(extra=>({ claim: extra, quote: extra, scope: 'separate', verdict: example.verdict, reason: '별도 내용에는 다른 판정이 필요합니다.', explanation: '별도 주장의 자료를 대조했습니다.', sourceUrls: ['https://evidence.example/extra'] })),
    ] }] };
}
const completed = { output: [{ type: 'web_search_call', status: 'completed', action: { sources: [
  { url: 'https://evidence.example/core' }, { url: 'https://evidence.example/extra' },
] } }] };
for (const [index, example] of scopeCases.entries()) test(`scope repair ${index + 1}: an unrelated ${example.verdict} detail is excluded without changing the selected parent`, () => {
  const group = groupFor(example), result = validateGroupVerdict(responseFor(example, group), completed, group, 'https://article.example/');
  assert.equal(result.verdict, 'supported'); assert.equal(result.aspects.length, 1);
  assert.equal(result.aspects[0].claim, example.core); assert.equal(result.quote, example.core);
  assert.equal(result.excludedAspects.length, 1); const extra = result.excludedAspects[0];
  assert.equal(extra.claim, example.extra); assert.equal(Object.hasOwn(extra,'verdict'), false);
  assert.deepEqual(extra.origin, origin); assert.equal(extra.quote, example.extra);
  assert.deepEqual(result.sources.map(s => s.url), ['https://evidence.example/core']);
  assert.equal(extra.selectionReason, 'outside_selected_claim');
});

test('an unverified separate claim cannot contaminate a parent; invented evidence still fails closed on its own card', () => {
  const example = scopeCases[0], group = groupFor(example), data = responseFor(example, group);
  data.aspectResults[0].checks[1].sourceUrls = ['https://invented.example/'];
  const result = validateGroupVerdict(data, completed, group, 'https://article.example/');
  assert.equal(result.verdict, 'supported'); assert.equal(result.excludedAspects[0].selectionReason, 'outside_selected_claim');
  assert.equal(Object.hasOwn(result.excludedAspects[0],'sources'), false);
  data.scopeSourceUrls = ['https://invented.example/'];
  assert.equal(validateGroupVerdict(data, completed, group, 'https://article.example/').verdict, 'insufficient');
});

test('separating OCR/image assertions preserves image origin, location and source ids on each new card', () => {
  const example = scopeCases[0], group = groupFor(example);
  group.aspects[0].origin = { kind: 'image_text', label: '이미지 글자 · OCR', imageId: 'image-1', locationId: 'image-location' };
  group.aspects[0].sourceId = 'extra-1';
  const result = validateGroupVerdict(responseFor(example, group), completed, group, 'https://article.example/');
  assert.deepEqual(result.origin, group.aspects[0].origin);
  const separate = result.excludedAspects[0];
  assert.deepEqual(separate.origin, group.aspects[0].origin);
  assert.equal(separate.sourceId, 'extra-1');
});

test('material conditions retained as components can still downgrade the parent verdict', () => {
  const example = scopeCases[1], group = groupFor(example), data = responseFor(example, group);
  data.aspectResults[0].checks[1].scope = 'component';
  const result = validateGroupVerdict(data, completed, group, 'https://article.example/');
  assert.equal(result.verdict, 'mixed'); assert.equal(result.excludedAspects.length, 0);
  assert.equal(result.aspects.length, 2);
});

test('scope repair rejects invented quotes, missing checks, unknown ids, duplicate checks and removal of every parent component', () => {
  const example = scopeCases[0], group = groupFor(example);
  for (const mutate of [
    d => { d.aspectResults[0].checks[1].quote = '본문에 없는 인용'; },
    d => { d.aspectResults[0].checks = []; },
    d => { d.aspectResults[0].id = 'unknown'; },
    d => { d.aspectResults[0].checks.push(d.aspectResults[0].checks[0]); },
    d => { d.aspectResults[0].checks[0].scope = 'separate'; },
  ]) { const data = responseFor(example, group); mutate(data); assert.throws(() => validateGroupVerdict(data, completed, group, 'https://article.example/')); }
});

function setupPipeline(count = 2, firstExtras = 1) {
  const examples = Array.from({ length: count }, (_, i) => {const base=scopeCases[i % scopeCases.length];if(count<=2)return base;
   const extras=Array.from({length:i===0?firstExtras:1},(_,j)=>`부수 사실 ${i+1}-${j+1}: ${base.extra}`);
   return {...base,parent:`핵심 논점 ${i+1}: ${base.parent}`,core:`핵심 논점 ${i+1}: ${base.core}`,extra:extras.join(' '),extras};
 });
  const article = { title: '독립 주장 범위 합성 검사', url: 'https://article.example/', text: examples.map(e => `${e.core} ${e.extra}`).join('\n\n') };
  let calls = 0, active = 0, peak = 0;
  globalThis.chrome = { runtime: { async sendMessage() { return { ok: true, data: 'QA' }; } }, storage: { session: { async set() {} } } };
  globalThis.fetch = async (_url, options) => {
    calls++; const body = JSON.parse(options.body), input = JSON.parse(body.input[0].content);
    let data, search = [];
    if (!body.tools) {
      assert.ok(body.instructions.includes('SELECT MAIN CLAIMS FIRST')); assert.ok(body.instructions.includes('not_selected'));
      data = analysisFixture(examples.map(e => ({ claim: e.parent, quote: `${e.core} ${e.extra}`, origin: 'body' })), input);
      data.claims.forEach((g, i) => { g.aspects[0].claim = `${examples[i].core} ${examples[i].extra}`; });
    } else {
      assert.ok(body.instructions.includes('AUDIT SCOPE')); assert.ok(body.instructions.includes('scope=separate'));
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); active--;
      data = responseFor(examples.find(e => e.parent === input.claim), { aspects: input.aspects }); search = completed.output;
    }
    return Response.json({ status: 'completed', output: [...search, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] });
  };
  return { article, counts: () => ({ calls, peak }) };
}
test('parallel pipeline keeps only planned main cards and excludes outside details with no extra model round trip', async () => {
  const { article, counts } = setupPipeline(); const snapshots = [];
  const report = await checkArticle(article, 'scope-model', new AbortController().signal, value => snapshots.push(value));
  assert.deepEqual(report.claims.map(c => c.verdict), ['supported', 'supported']);
  assert.equal(new Set(report.claims.map(c => c.id)).size, 2);
  assert.deepEqual(counts(), { calls: 3, peak: 2 });
  for (const claim of report.claims) for (const aspect of claim.aspects) assert.ok(report.coverage.find(b => b.sourceId === aspect.sourceId).groupIds.includes(claim.id));
  assert.equal(snapshots.at(-1).length, 2); assert.equal(report.selectionStats.outsideAspects,2);
});
test('eight selected main topics with nineteen outside facts complete as eight cards instead of a claim-limit error', async () => {
  const { article, counts } = setupPipeline(8,12); const snapshots = [];
  const report=await checkArticle(article, 'scope-limit', new AbortController().signal, value => snapshots.push(value), { maxClaims: 8 });
  assert.equal(report.claims.length,8);assert.equal(report.selectionStats.outsideAspects,19);assert.ok(report.claims.every(c=>c.verdict==='supported'));
  assert.ok(snapshots.every(s=>s.length===8));assert.deepEqual(counts(),{calls:9,peak:3});
});

// User's example tests the verdict contract only; these are NOT chemical findings.
test('one compound main claim can include four explicit items and become mixed when only one item is refuted',()=>{
 const names=['포름알데히드','NNN','NNK','벤조피렌'];
 const sentence='전자담배에 포름알데히드, NNN, NNK, 벤조피렌이 확인되었다.';
 const group={id:'compound',claim:sentence,aspects:names.map((name,i)=>({id:`item-${i}`,claim:`${name}의 포함이 확인되었다.`,quote:sentence,sourceId:'body-1',origin}))};
 const data={verdict:'mixed',reason:'합성 검증 사례에서는 벤조피렌 항목만 근거와 다릅니다.',explanation:'세 항목은 뒷받침되고 한 항목은 반박된다는 판정 구조 검사입니다.',caveat:'실제 화학 분석 결과가 아닌 합성 사례입니다.',sources:[{url:'https://evidence.example/core',relation:'context',evidence:'판정 로직을 위한 합성 근거'}],scopeSourceUrls:['https://evidence.example/core'],aspectResults:group.aspects.map((aspect,i)=>({id:aspect.id,checks:[{claim:aspect.claim,quote:names[i],scope:'component',verdict:i===3?'refuted':'supported',reason:'합성 항목별 판정입니다.',explanation:'실제 물질 포함 여부를 평가한 결과가 아닙니다.',sourceUrls:['https://evidence.example/core']}]}))};
 const result=validateGroupVerdict(data,completed,group,'https://article.example/');
 assert.equal(result.verdict,'mixed');assert.equal(result.aspects.length,4);assert.equal(result.excludedAspects.length,0);assert.deepEqual(result.aspects.map(a=>a.verdict),['supported','supported','supported','refuted']);assert.ok(result.reason.includes('벤조피렌'));
});
