import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionalCommentReason, filterPromotionalComments, parseEditedSupplement } from '../shared/comment-filter.mjs';
import { sourceBlocks, validateAnalysis } from '../shared/analysis.mjs';
import { checkArticle } from '../extension/provider.js';
import { analysisFixture, verdictFixture } from './analysis-fixture.mjs';
const ad = '무료 가입하면 보너스 10만원 지급! 추천인 코드 ABC로 가입하세요. https://shop.example/';
const legitimate = '본문의 관측 자료는 2020년 수집본이며 통계 기간이 서로 다릅니다.';
const subtle = '여러분의 새로운 시작을 저희 프로그램에서 함께 설계해 드립니다. 다음 단계는 제 소개에서 만나실 수 있어요.';
test('clear referral, offer, commercial contact and channel solicitations are excluded', () => {
  for (const text of [ad, '지금 할인 쿠폰 받으세요! 구매는 프로필 링크로 오세요.', '급전 대출 당일 승인 가능합니다. 오픈카톡 abc로 상담 주세요.', '제 유튜브 채널 구독 부탁드립니다. 새 영상을 많이 올립니다.', '제 블로그 방문 부탁드립니다. https://blog.example/', 'Sign up with my referral code ABC to get a bonus.', '무료\u200b가입 보너스 지급! 가입하세요.']) assert.ok(promotionalCommentReason(text), text);
});
test('ordinary citations, product facts, quoted-ad criticism and topical corrections are not keyword-filtered', () => {
  for (const text of [legitimate, '관측 기간은 원본 자료를 확인하세요. https://science.nasa.gov/moon/', '이 제품의 광고는 성능을 과장합니다. 가입하면 보너스를 준다는 말도 근거가 없습니다.', '할인 코드 발표일은 본문에 기재된 날짜와 다릅니다.', '대출 통계 자료에 관한 문의에 답변드립니다. 보고서는 2018년 자료입니다.', '유튜브 구독자 수 통계의 기준일은 작년 말입니다.', '무료 가입은 5월 1일 종료되었고 현재는 유료입니다.', '광고에는 가입하면 보너스 10만원 지급이라고 적었지만 공식 안내는 5만원으로 다릅니다.', '쿠폰 받으세요라는 광고 문구가 등장한 날짜는 2018년입니다.', subtle]) assert.equal(promotionalCommentReason(text), null, text);
});
test('only comment-origin content is prefiltered; main article and ordinary captions stay checkable', () => {
  const page = { title: '광고의 주장을 검증하는 기사', text: ad, supplementary: [{ kind: 'comment', text: ad }, { kind: 'comment', text: legitimate }, { kind: 'caption', text: ad }] };
  const blocks = sourceBlocks(page);
  assert.ok(blocks.some(b => b.origin === 'body' && b.text === ad)); assert.ok(blocks.some(b => b.origin === 'caption' && b.text === ad));
  assert.ok(!blocks.some(b => b.origin === 'comment' && b.text === ad)); assert.ok(blocks.some(b => b.text === legitimate));
});
test('editing mixed comments does not cause one promotional paragraph to remove all genuine comments', () => {
  const blocks = parseEditedSupplement(`댓글: ${legitimate}\n\n댓글: ${ad}\n\n이미지 캡션: 관측된 자료의 조건과 단위를 설명하는 그림입니다.`);
  const result = filterPromotionalComments(blocks);
  assert.equal(result.excludedCount, 1); assert.equal(result.blocks[0].text, legitimate); assert.equal(result.blocks[1].kind, 'caption');
});
test('comment image OCR/description is filtered as comment-origin content with one exclusion per image', () => {
  const result = filterPromotionalComments([{ kind: 'image_text', text: ad, section: 'comment', imageId: 'ad-image' }, { kind: 'image_visual', text: ad, section: 'comment', imageId: 'ad-image' }, { kind: 'image_text', text: ad, section: 'body', imageId: 'article-image' }]);
  assert.equal(result.excludedCount, 1); assert.deepEqual(result.blocks.map(b => b.imageId), ['article-image']);
  const paired = filterPromotionalComments([{ kind: 'image_visual', text: '숫자를 나란히 비교하는 도표의 이미지입니다.', section: 'comment', imageId: 'ad-image' }, { kind: 'image_text', text: ad, section: 'comment', imageId: 'ad-image' }]);
  assert.equal(paired.blocks.length, 0); assert.deepEqual(paired.excludedImageIds, ['ad-image']);
});
test('semantic promotional coverage is permitted only for unlinked comment-origin blocks', () => {
  const page = { title: '관측 자료', text: legitimate, supplementary: [{ kind: 'comment', text: subtle }] }, blocks = sourceBlocks(page);
  const plan = analysisFixture([{ claim: '관측 자료의 수집 시점과 통계 기간이 다르다.', quote: legitimate, origin: 'body' }], { sourceBlocks: blocks });
  const promo = plan.coverage.find(c => blocks.find(b => b.id === c.sourceId).origin === 'comment'); promo.role = 'promotional';
  assert.equal(validateAnalysis(plan, page, blocks).excludedPromotionalCount, 1);
  promo.groupIds = ['topic-1']; assert.throws(() => validateAnalysis(plan, page, blocks)); promo.groupIds = [];
  plan.coverage[0].role = 'promotional'; assert.throws(() => validateAnalysis(plan, page, blocks));
});
test('pipeline drops clear promotions before analysis and never searches semantic promotions', async () => {
  const page = { title: '관측 기사', text: legitimate, supplementary: [{ kind: 'comment', text: ad }, { kind: 'comment', text: subtle }, { kind: 'comment', text: legitimate }] }, requests = [];
  globalThis.chrome = { runtime: { async sendMessage() { return { ok: true, data: 'QA_TOKEN' }; } }, storage: { session: { async set() {} } } };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.input[0].content); requests.push(body);
    assert.ok(!JSON.stringify(input).includes(ad));
    let value;
    if (!body.tools) {
      value = analysisFixture([{ claim: '관측 자료의 수집 시점과 통계 기간이 다르다.', quote: legitimate, origin: 'body' }], input);
      value.coverage.find(c => input.sourceBlocks.find(b => b.id === c.sourceId).text === subtle).role = 'promotional';
    } else {
      assert.ok(!JSON.stringify(input).includes(subtle));
      value = verdictFixture({ verdict: 'supported', explanation: '원본 자료가 **기간 차이**를 보여줍니다.', caveat: '', sources: [{ url: 'https://evidence.example/', evidence: '수집 시점을 명시합니다.', relation: 'supports' }] }, input);
    }
    return Response.json({ status: 'completed', output: [...(body.tools ? [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://evidence.example/' }] } }] : []), { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  };
  const report = await checkArticle(page, 'qa-comment-filter', new AbortController().signal, () => {});
  assert.equal(requests.length, 2); assert.equal(report.claims.length, 1); assert.equal(report.excludedPromotionalCount, 2); assert.equal(report.claims[0].verdict, 'supported');
});
