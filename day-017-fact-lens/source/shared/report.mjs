import { resultText } from './language.mjs';
export const VERDICTS = { supported: '사실로 뒷받침됨', refuted: '오류로 뒷받침됨', mixed: '맥락·일부 수정 필요', insufficient: '근거 부족' };
export function safeUrl(value) {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null; url.hash = ''; return url.href; } catch { return null; }
}
export const normalize = value => String(value).replace(/\s+/g, ' ').trim();
import { quoteOrigin } from './page-context.mjs';
export function validateClaims(data, article) {
  if (!Array.isArray(data?.claims)) throw new Error('주장 추출 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
  const seen = new Set();
  return data.claims.map((claim, i) => {
    const origin = typeof claim?.quote === 'string' ? quoteOrigin(article, claim.quote, claim.origin) : null;
    if (typeof claim?.quote !== 'string' || typeof claim.claim !== 'string' || !claim.quote.trim() || claim.quote.length > 1200 || claim.claim.length > 800 || !origin) throw new Error('전송한 본문·페이지 맥락과 일치하지 않는 주장 인용이 반환됐습니다. 결과를 표시하지 않았습니다.');
    const key = `${origin.kind}:${normalize(claim.quote)}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { id: `claim-${i + 1}`, quote: claim.quote.trim(), claim: claim.claim.trim(), origin, verdict: 'pending', sources: [] };
  }).filter(Boolean);
}
export function collectedSources(response) {
  const sources = new Map();
  let searched = false, searchCalls = 0, completedSearchCalls = 0;
  for (const output of response.output || []) {
    if (output.type === 'web_search_call') searchCalls++;
    if (output.type === 'web_search_call' && output.status === 'completed') {
      completedSearchCalls++;
      searched = true;
      if(output.action?.type==='open_page'){const url=safeUrl(output.action.url);if(url&&!sources.has(url))sources.set(url,{url,title:new URL(url).hostname});}
      for (const source of output.action?.sources || []) { const url = safeUrl(source?.url); if (url) sources.set(url, { url, title: source.title || new URL(url).hostname }); }
    }
    if (output.type === 'message') for (const part of output.content || []) for (const annotation of part.annotations || []) {
      if (annotation?.type === 'url_citation') { const citation=annotation.url_citation||annotation; const url = safeUrl(citation.url); if (url) sources.set(url, { url, title: citation.title || new URL(url).hostname }); }
    }
  }
  return { searched, sources, searchCalls, completedSearchCalls };
}
export function validateVerdict(data, response, language = 'ko') {
  if (!data || !Object.hasOwn(VERDICTS, data.verdict) || typeof data.explanation !== 'string' || !Array.isArray(data.sources)) throw new Error('검증 응답 형식이 올바르지 않습니다.');
  const provenance = collectedSources(response);
  const sources = data.sources.map(source => {
    const url = safeUrl(source.url);
    const known = provenance.sources.get(url);
    if (!known || typeof source.evidence !== 'string' || !source.evidence.trim() || !['supports', 'contradicts', 'context'].includes(source.relation)) return null;
    return { ...known, evidence: source.evidence.slice(0, 1600), relation: source.relation };
  }).filter(Boolean).filter((source, i, all) => all.findIndex(other => other.url === source.url) === i).slice(0,8);
  const valid = provenance.searched && sources.length > 0;
  return { verdict: valid ? data.verdict : 'insufficient', explanation: valid ? data.explanation.slice(0, 3000) : resultText(language, 'noSource'),
    caveat: typeof data.caveat === 'string' ? data.caveat.slice(0, 1000) : '', sources: valid ? sources : [],
    sourceStats: {searchCalls:provenance.searchCalls,completedSearchCalls:provenance.completedSearchCalls,discoveredSources:provenance.sources.size,acceptedSources:valid?sources.length:0}, searched: provenance.searched, checkedAt: new Date().toISOString() };
}
export function responseText(response) {
  const messages = (response.output || []).filter(item => item.type === 'message' && (!item.role || item.role === 'assistant'));
  const final = messages.filter(item => item.channel === 'final');
  return (final.length ? final : messages.filter(item => !item.channel)).flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text').map(part => part.text).join('');
}
export async function readSSE(response, signal) {
  if (!response.body) throw new Error('서버 스트림이 비어 있습니다.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', completed, bytes = 0;
  const items = new Map();
  const indexById = new Map();
  function position(event) {
    if (Number.isInteger(event.output_index)) return event.output_index;
    if (event.item_id && indexById.has(event.item_id)) return indexById.get(event.item_id);
    return 0;
  }
  function mergeItem(index, next) {
    if (!next || typeof next !== 'object') return;
    const before = items.get(index) || {};
    const merged = { ...before, ...next };
    if (before.content?.length && next.type === 'message') {
      const content = [...before.content];
      for (let i = 0; i < (next.content || []).length; i++) {
        const part = next.content[i];
        if (!part) continue;
        content[i] = { ...content[i], ...part };
        if (!part.text && before.content[i]?.text) content[i].text = before.content[i].text;
        if (!part.annotations?.length && before.content[i]?.annotations?.length) content[i].annotations = before.content[i].annotations;
      }
      merged.content = content;
    }
    items.set(index, merged);
    if (next.id) indexById.set(next.id, index);
  }
  function consume(frame) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); } catch { throw new Error('서버의 스트리밍 이벤트 형식이 올바르지 않습니다.'); }
    if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) throw new Error(providerMessage(event.response?.error?.code || event.code));
    if (['response.output_item.added', 'response.output_item.done'].includes(event.type)) mergeItem(position(event), event.item);
    if (event.type === 'response.content_part.added' || event.type === 'response.content_part.done') {
      const index = position(event), item = items.get(index) || { type: 'message', role: 'assistant', id: event.item_id, content: [] };
      const content = [...(item.content || [])], partIndex = event.content_index || 0;
      const old = content[partIndex]; content[partIndex] = { ...old, ...event.part };
      if (!event.part?.text && old?.text) content[partIndex].text = old.text;
      if (!event.part?.annotations?.length && old?.annotations?.length) content[partIndex].annotations = old.annotations;
      mergeItem(index, { ...item, content });
    }
    if (['response.output_text.delta', 'response.output_text.done', 'response.refusal.delta', 'response.refusal.done', 'response.output_text.annotation.added'].includes(event.type)) {
      const index = position(event), item = items.get(index) || { type: 'message', role: 'assistant', id: event.item_id, content: [] };
      const content = [...(item.content || [])], partIndex = event.content_index || 0;
      const refusal = event.type.startsWith('response.refusal.');
      const old = content[partIndex] || { type: refusal ? 'refusal' : 'output_text', text: '', annotations: [] };
      const part = { ...old };
      if (refusal) { part.type = 'refusal'; part.refusal = event.type.endsWith('.done') ? event.refusal : (old.refusal || '') + (event.delta || ''); }
      else if (event.type.endsWith('annotation.added')) {
        part.annotations = [...(old.annotations || [])]; part.annotations[event.annotation_index ?? part.annotations.length] = event.annotation;
      } else part.text = event.type.endsWith('.done') ? event.text : (old.text || '') + (event.delta || '');
      content[partIndex] = part; mergeItem(index, { ...item, content });
    }
    if (event.type === 'response.completed') completed = event.response;
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) consume(buffer);
        break;
      }
      bytes += value.length;
      if (bytes > 8_000_000) throw new Error('응답이 너무 큽니다. 주장 수를 줄여 다시 시도해 주세요.');
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2); consume(frame);
      }
    }
    if (!completed || completed.status !== 'completed') throw new Error('검증 응답이 중간에 끊겼습니다. 완료된 결과로 처리하지 않았습니다.');
    for (let index = 0; index < (completed.output || []).length; index++) {
      const item = completed.output[index];
      const target = item.id && indexById.has(item.id) ? indexById.get(item.id) : index;
      mergeItem(target, item);
    }
    return { ...completed, output: [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item) };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function providerMessage(code) {
  if (['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'rate_limit_exceeded'].includes(code)) return 'ChatGPT 사용 한도에 도달했거나 요금제 사용이 허용되지 않습니다. ChatGPT의 연결 앱 사용 설정을 확인해 주세요.';
  return '모델 요청이 완료되지 않았습니다. 계정·모델의 웹 검색 지원과 사용 한도를 확인해 주세요.';
}

export function noEvidenceReason(language, stats) {
 return resultText(language,!stats?.completedSearchCalls?'searchNotConfirmed':!stats.discoveredSources?'searchNoUrls':'searchNoIndependent');
}
