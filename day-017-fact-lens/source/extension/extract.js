import { dcinsidePage } from '../shared/dcinside.mjs';
import { pageRevision } from '../shared/page-revision.mjs';
import { renderedTextBlocks, primaryArticleRoot } from '../shared/rendered-article.mjs';
import { promotionalCommentReason } from '../shared/comment-filter.mjs';
import { Readability } from '@mozilla/readability';
import { pageContexts } from '../shared/page-context.mjs';
export function extract() {
  // Read selected context before Readability and hidden-region removal strip <head>.
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const meta = selector => [...document.querySelectorAll(selector)].map(node => clean(node.content)).filter(Boolean).slice(0, 3).join(' · ');
  const pageTitle = clean(document.title);
  const description = meta('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]');
  const author = meta('meta[name="author"],meta[property="article:author"]');
  const published = meta('meta[property="article:published_time"],meta[property="article:modified_time"],meta[itemprop="datePublished"],meta[itemprop="dateModified"]');
  const comments = '[itemprop="comment"],[data-comment-id],[data-testid="comment"],#comments,#comment,.comments,.comment-list,.comment_list,.comment-body,.comment_body,.comment-content,.comment_content,.reply-list,.reply_list,.reply-content,.reply_content,.cmt_list,.cmt_txt,.comment_box';
  const excluded = 'nav,footer,input,textarea,select,button,[contenteditable],[role="textbox"],[role="searchbox"],[role="combobox"],[data-slate-editor],[data-lexical-editor],[hidden],[aria-hidden="true"],[role="dialog"],[role="navigation"]';
  const isVisible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest(excluded);
  const locationPrefix = `fl-${Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-')}`;
  let locationIndex = 0; const locatedNodes = new WeakMap();
  const locate = node => {
    if (locatedNodes.has(node)) return locatedNodes.get(node);
    const locationId = `${locationPrefix}-${++locationIndex}`;
    node.setAttribute('data-fact-lens-node', locationId); locatedNodes.set(node, locationId); return locationId;
  };
  const clone = document.cloneNode(true);
  const originals = document.querySelectorAll('*');
  const copies = clone.querySelectorAll('*');
  if (originals.length > 50000) throw Object.assign(new Error('Article DOM too large'), { code: 'too_large' });
  for (let i = 0; i < originals.length; i++) {
    const style = getComputedStyle(originals[i]);
    if (style.display === 'none' || style.visibility === 'hidden') copies[i].remove();
  }
  // Remove sensitive/form/hidden regions before a parser can consider them article text.
  clone.querySelectorAll(`script,style,noscript,template,aside,${excluded},${comments}`).forEach(el => el.remove());
  const dcPage = dcinsidePage(location.href);
  const root = primaryArticleRoot(document, `${excluded},aside,script,style,noscript,template,figcaption,.img_desc,${comments}`);
  document.querySelectorAll('[data-fact-lens-root]').forEach(node => node.removeAttribute('data-fact-lens-root'));
  root.setAttribute('data-fact-lens-root', '');
  const contextRoot = root.closest('article,main,[role="main"]') || root.parentElement || root;
  const visibleText = selector => [...contextRoot.querySelectorAll(selector)].filter(node => isVisible(node) && !node.closest('aside')).map(node => clean(node.innerText || node.textContent)).filter(Boolean).slice(0, 8).join('\n');
  const context = [
    { kind: 'headline', text: visibleText('h1') || visibleText('h2,h3') },
    { kind: 'subtitle', text: visibleText('.subtitle,.sub-title,.media_end_summary,[itemprop="alternativeHeadline"]') },
    { kind: 'description', text: description },
    { kind: 'author', text: author || visibleText('[rel="author"],[itemprop="author"],.byline') },
    { kind: 'published', text: published || visibleText('time,[itemprop="datePublished"],[itemprop="dateModified"]') },
    { kind: 'headings', text: visibleText('h2,h3') },
  ];
  const supplementary = [];
  let supplementLength = 0, supplementTruncated = false, imagesTruncated = false;
  const visibleContent = node => {
    const copy = node.cloneNode(true), originals = node.querySelectorAll('*'), copies = copy.querySelectorAll('*');
    for (let i = 0; i < originals.length; i++) if (!isVisible(originals[i])) copies[i].remove();
    copy.querySelectorAll(`${excluded},script,style`).forEach(node => node.remove());
    return clean(copy.textContent);
  };
  const addSupplement = (node, kind) => {
    if (!isVisible(node)) return;
    const raw = visibleContent(node);
    if (raw.length < 15 || supplementary.some(block => block.text === raw)) return;
    const text = raw.slice(0, Math.min(2000, 9500 - supplementLength));
    if (supplementary.filter(block => block.kind === kind).length >= (kind === 'comment' ? 30 : 8) || text.length < 15) { supplementTruncated = true; return; }
    if (text.length < raw.length) supplementTruncated = true;
    supplementary.push({ kind, text, ...(node.closest(comments) ? { section: 'comment' } : {}), locationId: locate(node) }); supplementLength += text.length;
  };
  const commentNodes = [...document.querySelectorAll(comments)].filter(isVisible), candidates = new Set();
  for (const node of commentNodes) {
    const children = [...node.querySelectorAll('[itemprop="text"],.comment-body,.comment_body,.comment-content,.comment_content,.reply-content,.reply_content,.cmt_txt,.usertxt,p,li')].filter(isVisible);
    const leaves = children.filter(child => !children.some(other => other !== child && child.contains(other)));
    if (leaves.length) leaves.forEach(child => candidates.add(child));
    else if (!commentNodes.some(other => other !== node && node.contains(other))) candidates.add(node);
  }
  const commentRoot = node => node.closest('[data-comment-id],[itemprop="comment"],[data-testid="comment"],.comment-body,.comment_body,.comment-content,.comment_content,.reply-content,.reply_content,.cmt_txt,.usertxt') || node;
  const excludedComments = new Set([...new Set([...candidates].map(commentRoot))].filter(node => promotionalCommentReason(visibleContent(node))));
  const excludedCommentNode = node => { for (let parent = node; parent; parent = parent.parentElement) if (excludedComments.has(parent)) return true; return false; };
  for (const node of candidates) if (!excludedCommentNode(node)) addSupplement(node, 'comment');
  root.querySelectorAll('figcaption,.img_desc').forEach(node => { if (!excludedCommentNode(node)) addSupplement(node, 'caption'); });
  const images = [];
  const imageNodes = [...root.querySelectorAll('img'), ...commentNodes.flatMap(node => [...node.querySelectorAll('img')])];
  for (const node of new Set(imageNodes)) {
    if (excludedCommentNode(node) || !isVisible(node) || node.closest('nav,aside,footer') || Math.max(node.naturalWidth, node.width) < 120 || Math.max(node.naturalHeight, node.height) < 80) continue;
    const src = node.currentSrc || node.src;
    if (dcPage && (node.closest('.og-img') || (/\/dccon\.php(?:\?|$)/.test(src) && node.width < 120))) continue;
    if (!src || !/^(https?:|data:image\/(png|jpeg|webp|gif);base64,)/i.test(src) || src.length > 7000000 || images.some(image => image.src === src)) continue;
    if (images.length >= 6) { imagesTruncated = true; continue; }
    images.push({ id: `image-${images.length + 1}`, src, alt: clean(node.alt).slice(0, 500), caption: clean(node.closest('figure')?.querySelector('figcaption')?.textContent).slice(0, 1000), kind: node.closest(comments) ? 'comment' : 'body', locationId: locate(node) });
  }
  const visibleBlocks = renderedTextBlocks(root, `${excluded},aside,script,style,noscript,template,figcaption,.img_desc,${comments}`);
  const article = new Readability(clone, { charThreshold: 120 }).parse();
  // Rendered blocks already partition the visible text, including tables,
  // bare text and structural forms. Readability may not understand app layouts.
  const unique = visibleBlocks.map(block => block.text).filter(text => text.length > 1);
  const text = unique.join('\n\n');
  if (text.length < 120 && !images.length && !supplementary.length) throw Object.assign(new Error('No readable article'), { code: 'no_article' });
  const locations = unique.map((text, index) => {
    const block = visibleBlocks.filter(block => block.text.length > 1)[index];
    return block ? { kind: 'body', text, locationId: locate(block.node) } : null;
  }).filter(Boolean);
  const url = new URL(location.href);
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  const title = (pageTitle || article?.title || '').slice(0, 500);
  return { pageRevision: pageRevision(), title, context: pageContexts({ title, context }).filter(block => block.kind !== 'title'), supplementary, excludedPromotionalCount: excludedComments.size, supplementTruncated, images, imagesTruncated, locations, url: url.href, text,
    totalLength: text.length, truncated: false, capturedAt: new Date().toISOString() };
}
// Chrome does not consistently expose thrown injection errors as InjectionResult.error.
// Return a non-sensitive extraction status so parser failures never look like permissions.
export function extractSafely() {
  try { return extract(); }
  catch (error) { return { extractionError: ['no_article', 'too_large'].includes(error?.code) ? error.code : 'failed' }; }
}
