export const CONTEXT_LABELS = { headline: '화면 제목', subtitle: '부제', description: '페이지 설명', author: '작성자', published: '게시·수정일', headings: '소제목', context: '페이지 맥락' };
export function pageContexts(article) {
  const blocks = [{ kind: 'title', label: '페이지 제목', text: String(article.title || '').trim().slice(0, 500) }];
  let remaining = 6000;
  for (const block of (Array.isArray(article.context) ? article.context : []).slice(0, 12)) {
    if (!Object.hasOwn(CONTEXT_LABELS, block?.kind) || typeof block.text !== 'string') continue;
    const text = block.text.trim().slice(0, Math.min(block.kind === 'context' ? 6000 : 1200, remaining));
    if (!text || blocks.some(other => other.text === text)) continue;
    blocks.push({ kind: block.kind, label: CONTEXT_LABELS[block.kind], text }); remaining -= text.length;
    if (!remaining) break;
  }
  return blocks.filter(block => block.text);
}
import { supplementaryBlocks } from './supplementary.mjs';
export function quoteOrigin(article, quote, expectedKind) {
  const normalize = text => String(text).replace(/\s+/g, ' ').trim();
  const wanted = normalize(quote);
  if (!wanted) return null;
  if ((!expectedKind || expectedKind === 'body') && normalize(article.text).includes(wanted)) {
    const location = article.locations?.find(block => block.kind === 'body' && normalize(block.text).includes(wanted));
    return { kind: 'body', label: '본문', ...(location ? { locationId: location.locationId } : {}) };
  }
  const block = pageContexts(article).find(block => (!expectedKind || expectedKind === block.kind) && normalize(block.text).includes(wanted));
  if (block) return { kind: block.kind, label: block.label };
  const extra = supplementaryBlocks(article).find(block => (!expectedKind || expectedKind === block.kind) && normalize(block.text).includes(wanted));
  return extra ? { kind: extra.kind, label: extra.label, ...(extra.locationId ? { locationId: extra.locationId } : {}), ...(extra.imageId ? { imageId: extra.imageId } : {}) } : null;
}
