const string = { type: 'string' };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const array = items => ({ type: 'array', items });
export const summarySchema = object({ overview: string, sections: array(object({ heading: string, summary: string, sourceIds: array(string) })), coverage: array(object({ sourceId: string, role: { type: 'string', enum: ['content', 'context', 'promotional'] } })) });
export function validateSummary(data, blocks) {
  if (!data.overview?.trim() || data.overview.length > 2400 || !data.sections?.length || data.sections.length > 60) throw Error('요약 결과의 구조를 확인할 수 없습니다.');
  const sources = new Map(blocks.map(block => [block.id, block])), covered = new Map();
  for (const item of data.coverage) {
    const source = sources.get(item.sourceId);
    if (!source || covered.has(item.sourceId) || !['content','context','promotional'].includes(item.role) || (item.role === 'promotional' && source.origin !== 'comment' && source.section !== 'comment')) throw Error('요약의 원문 대응을 확인할 수 없습니다.');
    covered.set(item.sourceId, item.role);
  }
  if (covered.size !== blocks.length) throw Error('요약 분석에서 누락된 원문 구간이 있습니다.');
  const used = new Set();
  const sections = data.sections.map(section => {
    if (!section.heading?.trim() || section.heading.length > 240 || !section.summary?.trim() || section.summary.length > 2400 || !section.sourceIds?.length || new Set(section.sourceIds).size !== section.sourceIds.length) throw Error('요약 항목이 비어 있거나 너무 깁니다.');
    const originals = section.sourceIds.map(id => {
      if (!sources.has(id) || covered.get(id) === 'promotional') throw Error('요약에 연결할 수 없는 원문입니다.');
      used.add(id); return sources.get(id);
    });
    return { heading: section.heading.trim(), summary: section.summary.trim(), originals };
  });
  if ([...covered].some(([id, role]) => role === 'content' && !used.has(id))) throw Error('주요 내용을 요약 항목에 연결하지 못했습니다.');
  return { overview: data.overview.trim(), sections, excludedPromotionalCount: [...covered.values()].filter(role => role === 'promotional').length };
}
