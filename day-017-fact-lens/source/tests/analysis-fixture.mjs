// Synthetic provider output only. Not included in extension bundles/packages.
export function analysisFixture(claims, input) {
  const groups = claims.map((claim, i) => {
    const block = input.sourceBlocks.find(block => (!claim.origin || block.origin === claim.origin) && block.text.replace(/\s+/g, ' ').includes(claim.quote.replace(/\s+/g, ' ')));
    return { id: `topic-${i + 1}`, claim: claim.claim, context: '전체 글의 맥락에 연결한 QA 논점입니다.', aspects: [{ claim: claim.claim, sourceId: block?.id || 'invented-source', quote: claim.quote }] };
  });
  return { overview: '이 페이지는 관측 조건과 근거를 바탕으로 달과 지구의 관계를 설명합니다.', claims: groups, coverage: input.sourceBlocks.map(block => {
    const groupIds = groups.filter(group => group.aspects.some(aspect => aspect.sourceId === block.id)).map(group => group.id);
    return { sourceId: block.id, groupIds, role: groupIds.length ? 'claim' : 'context' };
  }) };
}
export function verdictFixture(verdict, input) {
  return { ...verdict, reason: verdict.reason || '검색에서 **독립적인 근거**를 확인했습니다.', scopeSourceUrls: verdict.sources.map(source => source.url), aspectResults: input.aspects.map(aspect => ({ id: aspect.id, checks: [{ claim: aspect.claim, quote: aspect.quote, scope: 'component', verdict: verdict.verdict, reason: verdict.reason || '독립적인 근거를 확인했습니다.', explanation: verdict.explanation, sourceUrls: verdict.sources.map(source => source.url) }] })) };
}
export async function adaptJsonFixture(response, request) {
  if (!response.ok) return response;
  const data = await response.json();
  const input = JSON.parse(Array.isArray(request.input[0].content) ? request.input[0].content[0].text : request.input[0].content);
  for (const item of data.output || []) for (const part of item.content || []) {
    if (part.type !== 'output_text') continue;
    const value = JSON.parse(part.text);
    if (request.text.format.schema.properties.coverage && value.claims && !value.coverage) part.text = JSON.stringify(analysisFixture(value.claims, input));
    if (request.text.format.schema.properties.aspectResults && value.verdict && !value.aspectResults) part.text = JSON.stringify(verdictFixture(value, input));
  }
  return Response.json(data);
}
