import { resultText } from './language.mjs';
import { pageContexts, quoteOrigin } from './page-context.mjs';
import { supplementaryBlocks } from './supplementary.mjs';
import { normalize, validateVerdict, safeUrl, noEvidenceReason } from './report.mjs';
import { verdictSchema } from './structured.mjs';
const string = { type: 'string' };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const array = items => ({ type: 'array', items });
export const pageAnalysisSchema = object({ overview: string, claims: array(object({
  id: string, claim: string, context: string, aspects: array(object({ claim: string, sourceId: string, quote: string })),
})), coverage: array(object({ sourceId: string, groupIds: array(string), role: { type: 'string', enum: ['claim', 'context', 'opinion', 'promotional', 'not_selected'] } })) });
export function mainClaimSchema(maximum) {
  return { ...pageAnalysisSchema, properties: { ...pageAnalysisSchema.properties, claims: { ...pageAnalysisSchema.properties.claims, maxItems: maximum } } };
}
export const groupVerdictSchema = object({ ...verdictSchema.properties, reason: string, scopeSourceUrls: array(string), aspectResults: array(object({
  id: string, checks: array(object({ claim: string, quote: string, scope: { type: 'string', enum: ['component', 'separate'] },
    verdict: verdictSchema.properties.verdict, reason: string, explanation: string, sourceUrls: array(string),
  })),
})) });
export function sourceBlocks(article) {
  const blocks = pageContexts(article).map((block, i) => ({ id: `context-${i + 1}`, origin: block.kind, label: block.label, text: block.text }));
  // Partition all supplied body text for coverage; never sample sentences or
  // take a fixed number of claims. Long paragraphs remain in contiguous chunks.
  let index = 0;
  for (const paragraph of String(article.text || '').split(/\n\s*\n/)) {
    for (let start = 0; start < paragraph.length; start += 2400) {
      const text = paragraph.slice(start, start + 2400).trim(); if (!text) continue;
      const location = article.locations?.find(block => normalize(block.text).includes(normalize(text)));
      blocks.push({ id: `body-${++index}`, origin: 'body', label: '본문', text, ...(location ? { locationId: location.locationId } : {}) });
    }
  }
  for (const [i, block] of supplementaryBlocks(article).entries()) blocks.push({ ...block, id: `extra-${i + 1}`, origin: block.kind });
  return blocks;
}
export class AnalysisValidationError extends Error {
  constructor(code, counts = {}, sourceIds = []) {
    super('전체 맥락 분석의 원문 연결을 확인하지 못했습니다. [' + code + ']');
    this.code = code; this.validationCounts = counts; this.repairSourceIds = sourceIds;
  }
}
const canonical = value => String(value).normalize('NFC').replace(/[\u200b\ufeff]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
// Typography-only recovery: preserve original characters and exact source offsets.
// Never use fuzzy similarity, strip punctuation/numbers/negation, or guess a quote.
export function exactQuote(text, quote) {
  if (text.includes(quote) && quote.trim()) return quote;
  const wanted = canonical(quote); if (!wanted || !canonical(text).includes(wanted)) return null;
  let normalized = ''; const offsets = [];
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const value = part.segment.normalize('NFC').replace(/[\u200b\ufeff]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    for (const char of value) {
      const space = /\s/.test(char); if (space && (!normalized || normalized.endsWith(' '))) continue;
      normalized += space ? ' ' : char;
      for (let i = 0; i < char.length; i++) offsets.push([part.index, part.index + part.segment.length]);
    }
  }
  const at = normalized.indexOf(wanted); return at < 0 ? null : text.slice(offsets[at][0], offsets[at + wanted.length - 1][1]);
}
export function validateAnalysis(data, article, blocks, maximum = 60) {
  const fail = (code, counts = {}, ids = []) => { throw new AnalysisValidationError(code, { inputBlocks: blocks.length, maximumClaims: maximum, ...counts }, ids); };
  if (!data?.overview?.trim() || data.overview.length > 4000 || !Array.isArray(data.claims) || !Array.isArray(data.coverage)) fail('analysis_shape');
  if (data.claims.length > maximum) fail('claim_limit', { actualClaims: data.claims.length });
  const ids = new Set(), sources = new Map(blocks.map(block => [block.id, block])), aliases = new Map(), refs = new Map();
  let repairs = 0;
  const claims = data.claims.map(group => {
    if (!group.id?.trim() || group.id.length > 80 || ids.has(group.id)) fail('group_id');
    if (!group.claim?.trim() || group.claim.length > 1600 || typeof group.context !== 'string' || group.context.length > 2400 || !group.aspects?.length || group.aspects.length > 40) fail('group_bounds');
    ids.add(group.id);
    const aspects = group.aspects.map((aspect, i) => {
      if (!aspect.claim?.trim() || aspect.claim.length > 1200 || !aspect.quote?.trim() || aspect.quote.length > 1200) fail('aspect_bounds');
      let block = sources.get(aspect.sourceId), quote = block && exactQuote(block.text, aspect.quote);
      if (!quote) {
        const matches = blocks.map(candidate => ({ block: candidate, quote: exactQuote(candidate.text, aspect.quote) })).filter(item => item.quote);
        if (matches.length !== 1) fail(matches.length ? 'quote_ambiguous' : 'quote_mismatch', { matchingBlocks: matches.length });
        ({ block, quote } = matches[0]); repairs++;
        if (!aliases.has(aspect.sourceId)) aliases.set(aspect.sourceId, new Set()); aliases.get(aspect.sourceId).add(block.id);
      }
      if (quote !== aspect.quote) repairs++;
      const origin = quoteOrigin(article, quote, block.origin);
      if (!origin) fail('origin_missing');
      if (!refs.has(block.id)) refs.set(block.id, new Set()); refs.get(block.id).add(group.id);
      return { id: `${group.id}-aspect-${i + 1}`, claim: aspect.claim.trim(), quote, sourceId: block.id, origin: { ...origin, ...(block.locationId ? { locationId: block.locationId } : {}), ...(block.imageId ? { imageId: block.imageId } : {}) }, verdict: 'pending' };
    });
    return { id: group.id, claim: group.claim.trim(), context: group.context.trim(), aspects, quote: aspects[0].quote, origin: aspects[0].origin, verdict: 'pending', sources: [] };
  });
  const covered = new Map();
  for (const raw of data.coverage) {
    const item = { ...raw, groupIds: [...new Set(raw.groupIds || [])] };
    if (!sources.has(item.sourceId) && aliases.get(item.sourceId)?.size === 1) { item.sourceId = [...aliases.get(item.sourceId)][0]; repairs++; }
    if (!sources.has(item.sourceId)) fail('source_unknown');
    if (!['claim', 'context', 'opinion', 'promotional', 'not_selected'].includes(item.role) || !Array.isArray(raw.groupIds) || item.groupIds.some(id => !ids.has(id))) fail('coverage_group');
    const source = sources.get(item.sourceId);
    if (item.role === 'not_selected' && item.groupIds.length) fail('coverage_group');
    if (item.role === 'promotional' && ((source.origin !== 'comment' && source.section !== 'comment') || item.groupIds.length || refs.has(item.sourceId))) fail('promotional_link');
    if (covered.has(item.sourceId)) {
      const before = covered.get(item.sourceId); if (before.role !== item.role) fail('coverage_conflict');
      before.groupIds = [...new Set([...before.groupIds, ...item.groupIds])]; repairs++;
    } else covered.set(item.sourceId, item);
  }
  for (const [sourceId, groupIds] of refs) {
    let item = covered.get(sourceId);
    if (!item) { item = { sourceId, role: 'claim', groupIds: [] }; covered.set(sourceId, item); repairs++; }
    if (item.role !== 'claim' || [...groupIds].some(id => !item.groupIds.includes(id))) { item.role = 'claim'; item.groupIds = [...new Set([...item.groupIds, ...groupIds])]; repairs++; }
  }
  const missing = blocks.filter(block => !covered.has(block.id)).map(block => block.id);
  if (missing.length) fail('coverage_missing', { missingBlocks: missing.length }, missing);
  if ([...covered.values()].some(item => item.role === 'claim' && !item.groupIds.length)) fail('coverage_group');
  return { overview: data.overview.trim(), claims, mappingRepairs: repairs, excludedPromotionalCount: [...covered.values()].filter(item => item.role === 'promotional').length,
    coverage: blocks.map(source => ({ ...covered.get(source.id), origin: source.origin, label: source.label, ...(source.section === 'comment' ? { section: 'comment' } : {}) })) };
}
function briefReason(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw Object.assign(Error('판정의 핵심 근거가 없거나 너무 깁니다.'), { code: 'invalid_reason' });
  return value.replace(/\s+/g, ' ').trim();
}
export function validateGroupVerdict(data, completed, group, articleUrl, language = 'ko') {
  const reason = briefReason(data.reason);
  const result = validateVerdict(data, completed, language);
  const sources = result.sources.filter(source => source.url !== safeUrl(articleUrl));
  const allowed = new Set(sources.map(source => source.url));
  const seen = new Set(), components = [], excludedAspects = [];
  if (!Array.isArray(data.scopeSourceUrls) || !Array.isArray(data.aspectResults) || data.aspectResults.length !== group.aspects.length) throw Error('대주장 범위와 소주장별 검증 결과가 누락됐습니다.');
  for (const aspect of group.aspects) {
    const detail = data.aspectResults.find(item => item.id === aspect.id);
    if (!detail || seen.has(detail.id) || !Array.isArray(detail.checks) || !detail.checks.length || detail.checks.length > 20) throw Error('소주장별 검증 결과의 연결을 확인할 수 없습니다.');
    seen.add(detail.id);
    const atomicSeen = new Set();
    for (const [index, check] of detail.checks.entries()) {
      if (!['component', 'separate'].includes(check.scope) || !check.claim?.trim() || check.claim.length > 1600 || !check.quote?.trim() || check.quote.length > 1200 || !normalize(aspect.quote).includes(normalize(check.quote)) || !['supported', 'refuted', 'mixed', 'insufficient'].includes(check.verdict) || !Array.isArray(check.sourceUrls) || typeof check.explanation !== 'string' || !check.explanation.trim() || check.explanation.length > 2000) throw Error('독립 주장과 대주장 범위의 연결을 확인할 수 없습니다.');
      const key = `${normalize(check.claim)}:${normalize(check.quote)}`;
      if (atomicSeen.has(key)) throw Error('같은 세부 주장에 중복된 검증 결과가 있습니다.'); atomicSeen.add(key);
      const sourceUrls = [...new Set(check.sourceUrls.map(safeUrl).filter(url => allowed.has(url)))];
      const verdict = sourceUrls.length ? check.verdict : 'insufficient';
      const atomic = { ...aspect, id: `${aspect.id}-check-${index + 1}`, claim: check.claim.trim(), quote: check.quote.trim(), verdict,
        reason: sourceUrls.length ? briefReason(check.reason) : resultText(language, 'noSource'), explanation: sourceUrls.length ? check.explanation.trim() : resultText(language, 'noSource'), sourceUrls };
      // A related topic is not necessarily a component of the displayed proposition.
      // Keep out-of-scope facts independently traceable, never in its aggregation.
      if (check.scope === 'component') components.push(atomic);
      else excludedAspects.push({ id: atomic.id, claim: atomic.claim, quote: atomic.quote, sourceId: atomic.sourceId, origin: atomic.origin, selectionReason: 'outside_selected_claim' });
    }
  }
  if (!components.length) throw Error('대주장 자체를 확인하는 세부 근거가 없습니다. 원문에 맞게 범위를 다시 나눠야 합니다.');
  result.reason = reason;
  result.aspects = components;
  result.quote = components[0].quote; result.origin = components[0].origin;
  // Only URLs explicitly tied to the displayed parent claim belong to its card.
  const scopeUrls=new Set(data.scopeSourceUrls.map(safeUrl).filter(Boolean));
  result.sources = sources.filter(source => scopeUrls.has(source.url));
  result.sourceStats.acceptedSources=result.sources.length;
  result.excludedAspects = excludedAspects;
  const verdicts = new Set(components.map(aspect => aspect.verdict));
  if (!result.sources.length || verdicts.has('insufficient')) result.verdict = 'insufficient';
  else if (verdicts.size > 1 || verdicts.has('mixed')) result.verdict = 'mixed';
  else if ((result.verdict === 'supported' && !verdicts.has('supported')) || (result.verdict === 'refuted' && !verdicts.has('refuted'))) result.verdict = 'mixed';
  if (result.verdict !== data.verdict) {
    result.reason = result.verdict === 'insufficient' ? resultText(language, 'missing') : resultText(language, 'conflict');
    result.explanation = result.reason;
    result.caveat = `**${resultText(language, 'adjusted')}** ${result.caveat || ''}`;
  }
  if (!result.sources.length) result.reason = noEvidenceReason(language,result.sourceStats);
  return result;
}
