import { filterPromotionalComments } from './comment-filter.mjs';
export const EXTRA_LABELS = { comment: '댓글', caption: '이미지 캡션', image_text: '이미지 글자 · OCR', image_visual: '이미지 내용 · AI 해석' };
export function supplementaryBlocks(article) {
  let remaining = 30000;
  return filterPromotionalComments(article.supplementary).blocks.slice(0, 50).flatMap(block => {
    if (!Object.hasOwn(EXTRA_LABELS, block?.kind) || typeof block.text !== 'string' || remaining <= 0) return [];
    const limit = block.kind === 'comment' && !block.locationId ? 10000 : 2400;
    const text = block.text.trim().slice(0, Math.min(limit, remaining)); remaining -= text.length;
    return text ? [{ kind: block.kind, label: EXTRA_LABELS[block.kind], text, ...(block.section === 'comment' ? { section: 'comment' } : {}), ...(block.locationId ? { locationId: block.locationId } : {}), ...(block.imageId ? { imageId: block.imageId } : {}) }] : [];
  });
}
