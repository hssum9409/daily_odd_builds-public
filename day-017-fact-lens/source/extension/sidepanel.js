import { prepareDiagnosticReport, submitDiagnosticReport } from './diagnostics.js';
import { dcinsideImage } from '../shared/dcinside.mjs';
import { maxClaims } from '../shared/preferences.mjs';
import { parseEditedSupplement } from '../shared/comment-filter.mjs';
import { models, checkArticle, summarizeArticle } from './provider.js';
import { safeUrl } from '../shared/report.mjs';
import { outputLanguage, LANGUAGES, resultText } from '../shared/language.mjs';
import { pageRevision } from '../shared/page-revision.mjs';
import { icon } from './icons.js';
import { unsupportedPage, UNSUPPORTED_PAGE, injectionFailure, extractionFailure } from '../shared/page-access.mjs';
import { pageContexts } from '../shared/page-context.mjs';
import { appendEmphasis } from '../shared/emphasis.mjs';
import { supplementaryBlocks } from '../shared/supplementary.mjs';
import { prepareImages } from './images.js';
const $ = id => document.getElementById(id);
const labels = { all: '전체', supported: '사실', refuted: '오류', mixed: '맥락', insufficient: '근거 부족' };
const statusIcon = value => value === 'supported' ? 'check' : value === 'refuted' ? 'cross' : 'question';
let article, contextPreview = '', supplementPreview = '', sourceTabId, sourceHref, report, filter = 'all', controller, busy = false, auth = {}, openSections = new Set(), lastDiagnostic, compact = false, reading = false, detecting = false, stale = false, starting = false;
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function message(text = '') { $('message').textContent = text; $('message').hidden = !text; if (!auth.sharing) { $('gate-status').textContent = text; $('gate-status').hidden = !text; } }
let diagnosticPayload, diagnosticSending = false;
function diagnosticState(value) {
 lastDiagnostic=value; diagnosticPayload=undefined;
 $('copy-diagnostic').hidden=!value; $('report-diagnostic').hidden=!value; $('diagnostic-report').hidden=true;
}
function notice(text = '') { $('notice').replaceChildren(icon('info'), document.createTextNode(text)); $('notice').hidden = !text; }
function busyState(value, mode) {
  busy = value;
  for (const id of ['check', 'summarize', 'refresh-page', 'output-language', 'read-page', 'model', 'max-claims', 'article-text', 'article-title', 'article-context', 'supplement-text', 'include-comments', 'include-images', 'fast-mode', 'login']) $(id).disabled = value;
  for (const node of document.querySelectorAll('#image-preview input')) node.disabled = value;
  $('stop').hidden = !value;
  for (const [id, runMode, label, symbol] of [['check', 'check', '팩트체크', 'search'], ['summarize', 'summary', '요약정리', 'document']]) {
    const active = value && mode === runMode;
    $(id).setAttribute('aria-busy', String(active));
    $(id).classList.toggle('is-running', active);
    $(`${id}-label`).textContent = active ? `${label} 진행 중` : label;
    $(`${id}-icon`).replaceChildren(icon(active ? 'loader' : symbol, active ? 'action-spinner' : ''));
  }
  $('stop').textContent = mode === 'summary' ? '요약 중지' : '검증 중지';
}
async function rpc(type) { const result = await chrome.runtime.sendMessage({ type }); if (!result?.ok) throw new Error(result?.error || '확장 연결을 확인해 주세요.'); return result.data; }
function domain(url) { try { return new URL(url).hostname; } catch { return ''; } }
function pageContext(value) { $('page-title').textContent = value.title; $('page-domain').replaceChildren(icon('globe'), document.createTextNode(domain(value.url))); }
async function refreshAuth() {
  auth = await rpc('auth.status');
  $('login-gate').hidden = !!auth.sharing; $('workspace').hidden = !auth.sharing;
  $('gate-login').hidden = !!auth.pending; $('gate-cancel').hidden = !auth.pending;
  if (auth.pending) { $('gate-status').textContent = '열린 탭에서 ChatGPT 로그인을 완료해 주세요.'; $('gate-status').hidden = false; }
  if (!auth.sharing) { controller?.abort(); article = undefined; report = undefined; sourceTabId = undefined; sourceHref = undefined; stale = false; $('page-update').hidden = true; $('results').hidden = true; $('summary-results').hidden = true; for (const id of ['article-text','article-context','article-title','supplement-text']) $(id).value = ''; $('image-preview').replaceChildren(); }

  $('account-toggle').textContent = auth.pending ? '로그인 진행 중' : auth.sharing ? 'ChatGPT 연결됨' : 'ChatGPT 로그인';
  $('account-toggle').setAttribute('aria-label', auth.connected ? 'ChatGPT 연결 설정 열기' : 'ChatGPT 로그인 설정 열기');
  $('account-status').textContent = auth.pending ? '열린 탭에서 로그인을 완료해 주세요.' : auth.connected ? `${auth.email || 'ChatGPT 계정'} · ${auth.sharing ? '요금제 사용 연결됨' : '요금제 사용 권한이 필요합니다'}` : 'ChatGPT에 연결하면 내 요금제로 검증할 수 있습니다.';
  $('login').hidden = auth.pending || (auth.connected && auth.sharing);
  $('logout').hidden = !auth.connected;
  $('cancel-login').hidden = !auth.pending;
  if (auth.error) message(auth.error);
}
async function loadModels() {
  if (!auth.sharing) return;
  const chosen = $('model').value;
  const available = await models(AbortSignal.timeout(25000));
  if (!available.length) throw new Error('이 계정에서 사용할 수 있는 모델이 없습니다.');
  $('model').replaceChildren(...available.map(model => { const option = el('option', '', model.name); option.value = model.id; return option; }));
  const { selectedModel } = await chrome.storage.local.get('selectedModel');
  const saved = chosen || selectedModel;
  if (available.some(model => model.id === saved)) $('model').value = saved;
}
async function readPage() {
  if (busy || reading || !auth.sharing) return;
  reading = true;
  try {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { sourceTabId: remembered } = await chrome.storage.session.get('sourceTabId');
  // An OAuth result tab is not article content; return to the tab where the panel was opened.
  const authPage = active?.url?.startsWith('https://auth.openai.com/') || active?.url?.startsWith(chrome.runtime.getURL('auth-result.html'));
  const tabId = authPage ? remembered : active?.id;
  if (!tabId) throw new Error('기사 탭에서 확장 아이콘을 눌러 주세요.');
  const originalTab = await chrome.tabs.get(tabId).catch(() => null);
  if (!originalTab) throw new Error('확인할 페이지 탭이 닫혔습니다. 기사·문서 탭을 열어 주세요.');
  if (originalTab.url && unsupportedPage(originalTab.url)) throw new Error(UNSUPPORTED_PAGE);
  let result;
  try { [result] = await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] }); }
  catch (error) { throw new Error(injectionFailure(error)); }
  if (result?.result?.extractionError) throw new Error(extractionFailure(result.result.extractionError));
  if (result?.error || typeof result?.result?.text !== 'string') throw new Error(extractionFailure('failed'));
  article = result.result;
  sourceTabId = tabId;
  sourceHref = originalTab.url;
  report = null; openSections.clear(); $('page-overview').open = false; filter = 'all';
  $('results').hidden = true; $('summary-results').hidden = true; setCompact(false); stale = false; $('page-update').hidden = true; $('preview').hidden = false; $('extra-preview').hidden = false; document.querySelector('.scope-controls').hidden = false;
  pageContext(article); $('article-text').value = article.text;
  $('article-title').value = article.title;
  contextPreview = pageContexts(article).filter(block => block.kind !== 'title').map(block => `${block.label}: ${block.text}`).join('\n');
  $('article-context').value = contextPreview;
  supplementPreview = supplementaryBlocks(article).filter(block => !block.imageId).map(block => `${block.label}: ${block.text}`).join('\n\n').slice(0, 10000);
  $('supplement-text').value = supplementPreview;
  $('supplement-count').textContent = `· ${(article.supplementary || []).length}개${article.excludedPromotionalCount ? ` · 홍보 ${article.excludedPromotionalCount}개 제외` : ''}`;
  $('image-count').textContent = `· ${(article.images || []).length}개`;
  let imageWarning = '';
  if ((article.images || []).some(image => dcinsideImage(image.src))) { try { await rpc('images.prepare'); } catch { imageWarning = ' 디시 이미지 호환 처리를 준비하지 못했습니다. 확장을 새로고침한 뒤 다시 읽어 주세요.'; } }
  $('image-preview').replaceChildren(...(article.images || []).map((image, index) => {
    const row = el('label', 'image-choice'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = index < 4; checkbox.dataset.imageId = image.id;
    const thumbnail = el('img'); thumbnail.src = image.src; thumbnail.alt = ''; thumbnail.loading = 'lazy'; thumbnail.referrerPolicy = 'no-referrer';
    row.append(checkbox, thumbnail, el('span', '', `${image.id} · ${image.kind === 'comment' ? '댓글 이미지' : '본문 이미지'}${image.alt || image.caption ? ` · ${image.alt || image.caption}` : ''}`)); return row;
  }));
  $('text-count').textContent = `· ${article.text.length.toLocaleString()}자`;
  notice(article.truncated ? `긴 본문의 앞 36,000자만 읽었습니다. 전체 ${article.totalLength.toLocaleString()}자 중 일부입니다.` : '제목·페이지 맥락과 본문 전체를 읽었습니다. 전송할 내용을 확인하세요.' + imageWarning);
  diagnosticState(undefined);
  message();
  } finally { reading = false; }
}
function round(value) { const node = el('span', 'round-icon'); node.append(icon(statusIcon(value))); return node; }
function renderReport() {
  if (!report) return;
  if (report.mode === 'summary') return renderSummary();
  $('summary-results').hidden = true; $('results').hidden = false;
  $('claim-count').textContent = `주요 주장 ${report.claims.length}개`;
  $('comment-filter-status').hidden = !report.excludedPromotionalCount; $('comment-filter-status').textContent = report.excludedPromotionalCount ? `홍보성 댓글 등 ${report.excludedPromotionalCount}개 자동 제외` : '';
  $('page-overview').hidden = !report.overview;
  $('overview-text').replaceChildren(); appendEmphasis($('overview-text'), report.overview || '');
  $('coverage-info').textContent = report.coverage?.length ? `원문 ${report.coverage.length}개 구간의 전체 맥락을 읽고 핵심 논점 ${report.claims.length}개를 선정해 검증했습니다. 모든 세부 사실의 전수 검증은 아닙니다.${report.article.truncated ? ' 원문 전체가 아닌 전송 범위의 분석입니다.' : ''}` : '';
  $('report-warnings').textContent = (report.warnings || []).join('\n'); $('report-warnings').hidden = !report.warnings?.length;
  $('image-analysis').replaceChildren(...(report.imageAnalysis || []).map(image => {
    const node = el('details', 'image-analysis'); node.append(el('summary', '', `${image.id} · 이미지 인식 내용 확인`));
    if (image.transcription) node.append(el('p', 'small', '이미지 글자 (OCR)'), el('p', 'image-transcript', image.transcription));
    if (image.description) node.append(el('p', 'small', '시각적 내용 (AI 해석)'), el('p', 'image-transcript', image.description));
    node.append(el('p', 'caveat', image.uncertainty || '이미지 인식은 원본의 진위나 특정 사건을 입증하지 않습니다.'));
    const button = el('button', 'text-button', '원본 이미지로 이동·강조'); button.onclick = () => revealQuote('', { kind: 'image_visual', imageId: image.id, locationId: image.locationId, label: '이미지' }).catch(error => message(error.message)); node.append(button); return node;
  }));
  const done = report.claims.filter(claim => !['checking', 'pending'].includes(claim.verdict)).length;
  $('progress').textContent = busy ? `검증 ${done}/${report.claims.length} · 최대 3개씩 병렬 검증 중` : report.partial ? '중지된 검증 · 완료된 항목만 참고하세요.' : !report.claims.length ? '이 페이지에서 독립적으로 검증 가능한 주장을 찾지 못했습니다.' : '';
  $('summary').replaceChildren();
  const summaryKeys = ['supported', 'refuted', ...(report.claims.some(claim => claim.verdict === 'mixed') ? ['mixed'] : []), 'insufficient'];
  for (const value of summaryKeys) { const node = el('div', `stat ${value}`); node.append(round(value), document.createTextNode(`${report.language && report.language !== 'ko' ? resultText(report.language, value) : labels[value]} ${report.claims.filter(claim => claim.verdict === value).length}`)); $('summary').append(node); }
  $('filters').replaceChildren();
  for (const value of ['all', ...summaryKeys]) {
    const button = el('button', `filter${value === filter ? ' active' : ''}`, value === 'all' ? '전체' : report.language && report.language !== 'ko' ? resultText(report.language, value) : labels[value]); button.type = 'button'; button.setAttribute('aria-pressed', String(value === filter));
    button.onclick = () => { filter = value; renderReport(); }; $('filters').append(button);
  }
  const visible = report.claims.filter(claim => filter === 'all' || claim.verdict === filter);
  $('empty-filter').hidden = !!visible.length || !report.claims.length;
  $('claims').replaceChildren(...visible.map(claim => claimNode(claim, report.claims.indexOf(claim))));
  $('copy').disabled = busy; $('export').disabled = busy;
  const tier = report.effectiveTiers?.length ? ` · 서버 처리: ${report.effectiveTiers.map(value => ({ fast: 'Fast', priority: 'Fast', default: '일반', unreported: '미확인' })[value] || value).join(', ')}` : '';
  $('report-meta').textContent = report.demo ? '예시 자료입니다. 실제 검색·판정 결과가 아닙니다.' : `${report.model} · ${LANGUAGES[report.language || 'ko']} · ${report.checkedAt ? new Date(report.checkedAt).toLocaleString('ko-KR') : '검증 중'} · ${report.fast ? 'Fast 요청' : '일반 처리 요청'}${report.fastFallback ? ' → 일반 처리로 재요청' : ''}${tier} · 맥락에 따라 구성한 주요 주장 ${report.claims.length}개${report.article.truncated ? ' · 일부 본문' : ''}`;
}
function claimSection(claim, kind, label) {
  const node = el('details', `claim-section claim-${kind}`);
  const key = `${claim.id}:${kind}`; node.open = openSections.has(key);
  const summary = el('summary', '', label); summary.append(icon('chevron', 'section-chevron')); node.append(summary);
  node.addEventListener('toggle', () => { if (!node.isConnected) return; if (node.open) openSections.add(key); else openSections.delete(key); });
  return node;
}
function claimNode(claim, index) {
  const card = el('article', 'claim');
  const originLabels = [...new Set((claim.aspects || [claim]).map(aspect => aspect.origin?.label).filter(Boolean))];
  const heading = el('div', 'claim-head'); heading.append(el('span', 'claim-number', `주요 주장 ${index + 1}${originLabels.length ? ` · ${originLabels.join(' · ')}` : ''}`), el('h3', '', claim.claim));
  const status = resultText(report.language, claim.verdict) || (claim.verdict === 'checking' ? '출처 확인 중' : '검증 대기');
  const badge = el('span', `badge ${claim.verdict}`); badge.append(round(claim.verdict), document.createTextNode(status)); heading.append(badge); card.append(heading);
  const reason = claim.reason || (claim.error ? '요청 오류로 근거를 확인하지 못했습니다.' : ['pending', 'checking'].includes(claim.verdict) ? '근거를 확인하고 있습니다.' : '독립적인 근거를 확인하지 못했습니다.');
  card.append(appendEmphasis(el('p', 'claim-reason'), `핵심 근거: ${reason}`));
  let context;
  if (claim.context) { context = claimSection(claim, 'context', '글의 맥락'); context.append(el('p', 'claim-summary', claim.context)); }
  const references = [...new Map((claim.aspects || [claim]).map(aspect => [`${aspect.origin?.kind}:${aspect.quote}`, aspect])).values()];
  const originals = claimSection(claim, 'originals', `원문 · ${references.length}곳`);
  for (const aspect of references) {
    const quote = el('button', 'original-quote', `${aspect.origin?.imageId ? '인식 내용' : '원문'} · ${aspect.origin?.label || '본문'}: “${aspect.quote}”`);
    quote.title = '클릭하여 원문 위치로 이동하고 강조';
    quote.onclick = async () => { if (report.demo) return message('예시 항목에는 실제 원문 위치가 없습니다.'); try { await revealQuote(aspect.quote, aspect.origin); } catch (error) { message(error.message); } };
    originals.append(quote);
  }
  const original = el('button', 'secondary original', '원문에서 보기'); original.prepend(icon('original'));
  original.onclick = async () => {
    if (report.demo) return message('예시 항목에는 실제 원문 위치가 없습니다. 현재 페이지를 읽어 검증해 주세요.');
    try { await revealQuote(claim.quote, claim.origin); } catch (error) { message(error.message); }
  }; originals.append(original);
  const evidence = claimSection(claim, 'evidence', '검증 근거·출처');
  evidence.id = `claim-evidence-${index + 1}`; evidence.setAttribute('aria-label', '검증 근거·출처');
  evidence.classList.add('primary-evidence'); evidence.querySelector('summary').hidden = true;
  const move = el('button', 'claim-move', '이동'); move.type = 'button'; move.title = '원문 위치로 이동·하이라이트';
  move.setAttribute('aria-label', `주요 주장 ${index + 1} 원문으로 이동`);
  move.onclick = event => { event.stopPropagation(); const aspect = (claim.aspects || [claim]).find(item => item.origin?.locationId && (item.origin?.kind === 'body' || item.origin?.imageId)) || claim; void revealQuote(aspect.quote, aspect.origin).catch(error => message(error.message)); };
  card.prepend(move);
  // The heading is the keyboard target; the whole non-interactive card surface clicks.
  const toggle = () => { evidence.open = !evidence.open; const key = `${claim.id}:evidence`; if (evidence.open) openSections.add(key); else openSections.delete(key); sync(); };
  const sync = () => { const aspects = evidence.querySelector('.aspect-results'); if (aspects) { aspects.open = evidence.open; const key = `${claim.id}:aspects`; if (aspects.open) openSections.add(key); else openSections.delete(key); } heading.setAttribute('aria-expanded', String(evidence.open)); heading.setAttribute('aria-label', `주요 주장 ${index + 1} 검증 근거·출처 ${evidence.open ? '접기' : '펼치기'}`); };
  heading.tabIndex = 0; heading.setAttribute('role', 'button'); heading.setAttribute('aria-controls', evidence.id);
  heading.onkeydown = event => { if (event.target === heading && ['Enter', ' '].includes(event.key)) { event.preventDefault(); toggle(); } };
  card.onclick = event => { if (event.target.closest('button,a,summary,input,select,textarea,.claim-context,.claim-originals,.aspect-results') || window.getSelection()?.toString()) return; toggle(); };
  evidence.addEventListener('toggle', sync); sync();
  evidence.append(appendEmphasis(el('p', 'explanation'), claim.explanation || '독립적인 웹 출처와 대조할 예정입니다.'));
  if (claim.error) evidence.append(el('p', 'caveat', claim.error));
  if (claim.aspects?.length > 1) {
    const aspects = claimSection(claim, 'aspects', `함께 검증한 세부 내용 ${claim.aspects.length}개`); aspects.classList.add('aspect-results');
    for (const aspect of claim.aspects) {
      const node = el('div', 'aspect-result'); node.append(el('p', '', aspect.claim), el('span', `badge ${aspect.verdict}`, resultText(report.language, aspect.verdict) || '확인 중'));
      if (aspect.explanation) node.append(appendEmphasis(el('p', 'small'), aspect.explanation));
      aspects.append(node);
    }
    aspects.open = evidence.open; evidence.append(aspects);
  }
  if (claim.sources?.length) {
    evidence.append(el('p', 'source-heading', '근거 출처'));
    for (const source of claim.sources) {
      const url = safeUrl(source.url); if (!url) continue;
      const row = el('div', 'source'); const link = el('a', '', source.title); link.href = url; link.target = '_blank'; link.rel = 'noreferrer noopener'; link.append(icon('external'));
      row.append(link, el('span', 'source-domain', domain(url)));
      if (!report.demo) row.append(appendEmphasis(el('p', 'evidence'), `${({ supports: '주장을 지지', contradicts: '주장과 배치', context: '맥락 보충' })[source.relation]} · ${source.evidence}`));
      evidence.append(row);
    }
  }
  if (claim.caveat) evidence.append(appendEmphasis(el('p', 'caveat'), `확인 한계: ${claim.caveat}`));
  card.append(evidence); if (context) card.append(context); card.append(originals); return card;
}
async function revealQuote(quote, origin) {
  const tab = await chrome.tabs.get(sourceTabId).catch(() => null);
  if (!tab || tab.url !== sourceHref) throw new Error('원문 탭이 닫혔거나 주소가 바뀌었습니다. 현재 페이지를 다시 읽어 주세요.');
  const highlightCSS = '[data-fact-lens-highlight]{outline:3px solid #e6a800!important;outline-offset:4px!important;scroll-margin-block:100px!important} [data-fact-lens-highlight]:not(img){background-color:#fff1a8!important} ::highlight(fact-lens-claim){background:#ffe16b;color:#161616}';
  const styleTarget = { target: { tabId: sourceTabId }, css: highlightCSS, origin: 'USER' };
  await chrome.scripting.removeCSS(styleTarget).catch(() => {}); await chrome.scripting.insertCSS(styleTarget);
  const [result] = await chrome.scripting.executeScript({ target: { tabId: sourceTabId }, func: (text, origin) => {
    const normalize = value => value.replace(/\s+/g, ' ').trim();
    const located = origin?.locationId ? [...document.querySelectorAll('[data-fact-lens-node]')].find(node => node.getAttribute('data-fact-lens-node') === origin.locationId) : null;
    const target = located && (origin.imageId || normalize(located.textContent).includes(normalize(text))) ? located : origin?.imageId ? null : [...document.querySelectorAll('p,li,blockquote,h1,h2,h3,figcaption,[itemprop="comment"],.comment-body,.comment-content,.cmt_txt')].find(node => node.getClientRects().length && normalize(node.textContent).includes(normalize(text)));
    if (!target) return false;
    document.querySelectorAll('[data-fact-lens-highlight]').forEach(node => node.removeAttribute('data-fact-lens-highlight'));
    const marker = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-'); target.setAttribute('data-fact-lens-highlight', marker);
    const range = document.createRange(); range.selectNodeContents(target);
    if (!origin?.imageId && text) {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT), nodes = []; let node, raw = '';
      while ((node = walker.nextNode())) { nodes.push({ node, start: raw.length }); raw += node.data; }
      let normalized = ''; const offsets = [];
      for (let i = 0; i < raw.length; i++) {
        const space = /\s/.test(raw[i]);
        if (space && (!normalized || normalized.endsWith(' '))) continue;
        normalized += space ? ' ' : raw[i]; offsets.push(i);
      }
      const start = normalized.indexOf(normalize(text));
      if (start >= 0) {
        const first = offsets[start], last = offsets[start + normalize(text).length - 1] + 1;
        const firstNode = nodes.find(item => item.start + item.node.length > first);
        const lastNode = nodes.find(item => item.start + item.node.length >= last);
        if (firstNode && lastNode) { range.setStart(firstNode.node, first - firstNode.start); range.setEnd(lastNode.node, last - lastNode.start); }
      }
    }
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    if (globalThis.Highlight && CSS.highlights) CSS.highlights.set('fact-lens-claim', new Highlight(range));
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    setTimeout(() => { if (target.getAttribute('data-fact-lens-highlight') === marker) target.removeAttribute('data-fact-lens-highlight'); if (CSS.highlights?.get('fact-lens-claim')?.has(range)) CSS.highlights.delete('fact-lens-claim'); }, 30000);
    return true;
  }, args: [quote, origin || null] });
  if (!result?.result && (!origin || ['body', 'comment', 'caption'].includes(origin.kind) || origin.imageId)) throw new Error('페이지가 변경됐거나 수정한 내용에 해당합니다. 원문 위치를 찾지 못했습니다.');
  await chrome.tabs.update(sourceTabId, { active: true });
  if (!result?.result) message(`${origin.label}에서 추출한 주장입니다. 화면에 표시되지 않는 메타정보이거나 수정한 맥락일 수 있습니다. 전송할 내용 미리보기에서 확인하세요.`);
}
function setCompact(value) {
  compact = value; document.querySelector('.page-context').classList.toggle('compact-input', value);
  $('input-options').hidden = value; $('preview').open = false; $('extra-preview').open = false;
}
async function detectPageChange() {
  if (!auth.sharing || !article || reading || detecting) return;
  detecting = true; const captured = article;
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active || active.url?.startsWith(chrome.runtime.getURL('')) || active.url?.startsWith('https://auth.openai.com/')) return;
    let changed = active.id !== sourceTabId || active.url !== sourceHref;
    if (!changed && !unsupportedPage(active.url)) {
      const [current] = await chrome.scripting.executeScript({ target: { tabId: active.id }, func: pageRevision });
      changed = !!current?.result && JSON.stringify(current.result) !== JSON.stringify(article.pageRevision);
    }
    if (article === captured && !reading) { stale = changed; $('page-update').hidden = !changed; }
  } catch { /* Navigation can temporarily destroy the execution context; tab events/poll retry. */ }
  finally { detecting = false; }
}
function renderSummary() {
  $('results').hidden = true; $('summary-results').hidden = false;
  $('summary-count').textContent = `${report.sections?.length || 0}개 항목`;
  $('summary-overview').replaceChildren(); appendEmphasis($('summary-overview'), report.overview || (report.partial ? '요약을 완료하지 못했습니다. 다시 시도해 주세요.' : ''));
  $('summary-warnings').textContent = (report.warnings || []).join('\n'); $('summary-warnings').hidden = !report.warnings?.length;
  $('summary-sections').replaceChildren(...(report.sections || []).map(section => {
    const card = el('article', 'summary-item'); card.append(el('h3', '', section.heading), appendEmphasis(el('p'), section.summary));
    const originals = el('details', 'summary-originals'); originals.append(el('summary', '', '원문 확인'));
    for (const block of section.originals) {
      const quote = el('button', 'original-quote', `${block.label}: ${block.text}`);
      quote.onclick = () => void revealQuote(block.text, { kind: block.origin, locationId: block.locationId, imageId: block.imageId, label: block.label }).catch(error => message(error.message)); originals.append(quote);
    }
    card.append(originals); return card;
  }));
  $('summary-meta').textContent = `${report.model} · ${LANGUAGES[report.language]} · ${report.fast ? 'Fast 요청' : '일반 처리'}${report.fastFallback ? ' → 일반 처리로 재요청' : ''} · 서버 처리: ${(report.effectiveTiers || []).join(', ') || '미확인'}${report.excludedPromotionalCount ? ` · 홍보 ${report.excludedPromotionalCount}개 제외` : ''}`;
  $('summary-copy').disabled = busy || !report.sections?.length; $('summary-export').disabled = busy;
}
async function startCheck(mode = 'check') {
  if (busy || reading || starting) return;
  starting = true;
  try {
  await refreshAuth();
  if (!auth.sharing) return;
  await detectPageChange();
  if (stale) return message('페이지가 바뀌었습니다. 먼저 페이지 내용 반영하기를 눌러 주세요.');
  if (article) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    const source = await chrome.tabs.get(sourceTabId).catch(() => null);
    if (!source || source.url !== sourceHref || (active?.id !== sourceTabId && !active?.url?.startsWith(chrome.runtime.getURL('auth-result.html')))) await readPage();
  }
  if (!article) await readPage();
  await refreshAuth();
  if (!auth.sharing) { $('settings-panel').hidden = false; return message('Continue with ChatGPT로 로그인하고 요금제 사용을 승인해 주세요.'); }
  if (!$('model').value) await loadModels();
  const text = $('article-text').value.trim();
  if (text.length > 120000) throw new Error('본문이 120,000자를 초과합니다. 일부를 자동으로 잘라 분석하지 않았습니다. 미리보기에서 검증 범위를 직접 정해 주세요.');
  const contextText = $('article-context').value.trim();
  if ($('article-context').value !== contextPreview && contextText.length > 6000) throw new Error('수정한 페이지 맥락은 6,000자 이하로 입력해 주세요.');
  const context = $('article-context').value === contextPreview ? article.context : [{ kind: 'context', text: contextText }];
  const extraText = $('supplement-text').value.trim();
  const supplementary = !$('include-comments').checked ? [] : $('supplement-text').value === supplementPreview ? supplementaryBlocks(article).filter(block => !block.imageId) : parseEditedSupplement(extraText);
  const imageIds = [...document.querySelectorAll('#image-preview input:checked')].map(node => node.dataset.imageId);
  const selectedImages = $('include-images').checked ? (article.images || []).filter(image => imageIds.includes(image.id) && ($('include-comments').checked || image.kind !== 'comment')) : [];
  if (selectedImages.length > 4) throw new Error('이미지는 한 번에 최대 4개를 선택해 주세요.');
  if (!text && !supplementary.some(block => block.text.trim()) && !selectedImages.length) throw new Error('검증할 본문·댓글 또는 이미지를 선택해 주세요.');
  const warnings = [];
  if ($('include-comments').checked && article.supplementTruncated) warnings.push('댓글·캡션이 수집 범위를 초과해 일부만 포함됐습니다. 미리보기의 전송 범위를 기준으로 분석했습니다.');
  if ($('include-images').checked && article.imagesTruncated) warnings.push('이미지 후보는 최대 6개입니다. 이 중 선택한 이미지만 분석했습니다.');
  const selected = { ...article, title: $('article-title').value.trim().slice(0, 500), context, supplementary, text, warnings, excludedPromotionalCount: $('include-comments').checked ? article.excludedPromotionalCount || 0 : 0 }; const model = $('model').value;
  const fast = $('fast-mode').checked, language = outputLanguage($('output-language').value);
  controller = new AbortController(); setCompact(true); $('settings-panel').hidden = true; busyState(true, mode); message(mode === 'summary' ? '제목·페이지 맥락과 본문을 요약하고 있습니다.' : '제목·페이지 맥락과 본문에서 주장을 추출하고 있습니다.'); notice(); filter = 'all'; openSections.clear(); $('page-overview').open = false;
  diagnosticState(undefined);
  report = { article: { title: selected.title, url: selected.url, capturedAt: selected.capturedAt, truncated: selected.truncated }, mode, language, claims: [], model, fast, partial: true };
  $('results').hidden = true; $('summary-results').hidden = true;
  try {
    if (selectedImages.length) { message('선택한 이미지를 준비하고 있습니다.'); const images = await prepareImages(selectedImages, controller.signal); selected.loadedImages = images.loaded; selected.warnings.push(...images.warnings); }
    if (mode === 'summary') {
      report = await summarizeArticle(selected, model, controller.signal, { fast, language, maxClaims: maxClaims($('max-claims').value), onPhase: text => message(text), onFallback: () => message('Fast 요청이 거절되어 일반 처리로 복구하고 있습니다.') });
      message('요약정리를 완료했습니다. 원문의 주장을 정리한 내용이며 사실 검증 결과가 아닙니다.');
      return;
    }
    report = await checkArticle(selected, model, controller.signal, claims => {
      report.claims = claims; message(); renderReport();
    }, { fast, language, maxClaims: maxClaims($('max-claims').value), onPhase: text => message(text), onFallback: () => message('Fast 요청이 거절되어 일반 처리로 복구하고 있습니다.'), onAnalysis: analysis => Object.assign(report, analysis) });
    diagnosticState(report.claims.findLast(claim => claim.diagnostic)?.diagnostic);
    message(report.claims.some(claim => claim.error) ? '일부 항목은 요청 오류로 검증하지 못했습니다. 해당 항목의 안내를 확인하세요.' : report.warnings?.length ? '검증을 완료했습니다. 분석 범위와 처리 안내를 함께 확인하세요.' : '검증을 완료했습니다. 요약 판정과 함께 각 출처를 확인하세요.');
  } catch (error) {
    diagnosticState(error.diagnostic);
    if (!report) return;
    report.partial = true;
    for (const claim of report.claims || []) if (['pending', 'checking'].includes(claim.verdict)) Object.assign(claim, { verdict: 'insufficient', reason: resultText(language, 'failed'), explanation: resultText(language, 'failed'), sources: [], aspects: claim.aspects?.map(aspect => ({ ...aspect, verdict: 'insufficient', explanation: resultText(language, 'failed') })) });
    message(controller.signal.aborted ? `${mode === 'summary' ? '요약' : '검증'}을 중지했습니다. 이미 전송된 요청은 사용량에 포함될 수 있습니다.` : error.message);
  } finally { busyState(false); renderReport(); }
  } finally { starting = false; }
}
function wire(id, handler) { $(id).onclick = () => Promise.resolve().then(handler).catch(error => message(error.message)); }
$('gate-icon').append(icon('lens')); $('brand-icon').append(icon('lens')); $('settings').append(icon('settings')); busyState(false);
$('creator-version').textContent = `팩트렌즈 · v${chrome.runtime.getManifest().version}`;
wire('settings', () => { $('settings-panel').hidden = !$('settings-panel').hidden; });
function selectSettingsTab(name, focus = false) {
  for (const tab of ['general', 'creator']) {
    const active = name === tab, button = $(`settings-tab-${tab}`);
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    $(`settings-${tab}`).hidden = !active;
    if (active && focus) button.focus();
  }
}
for (const name of ['general', 'creator']) {
  wire(`settings-tab-${name}`, () => selectSettingsTab(name));
  $(`settings-tab-${name}`).onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectSettingsTab(event.key === 'Home' ? 'general' : event.key === 'End' ? 'creator' : name === 'general' ? 'creator' : 'general', true);
  };
}
wire('close-settings', () => { $('settings-panel').hidden = true; $('settings').focus(); });
wire('account-toggle', () => { selectSettingsTab('general'); $('settings-panel').hidden = false; });
wire('read-page', readPage); wire('refresh-page', readPage); wire('check', () => startCheck('check')); wire('summarize', () => startCheck('summary'));
wire('edit-input', () => { setCompact(false); $('settings-panel').hidden = true; window.scrollTo(0, 0); });
wire('gate-login', async () => { await rpc('auth.login'); await refreshAuth(); });
wire('gate-cancel', async () => { await rpc('auth.cancel'); await refreshAuth(); });
wire('login', async () => { await rpc('auth.login'); await refreshAuth(); });
wire('cancel-login', async () => { await rpc('auth.cancel'); await refreshAuth(); });
wire('logout', async () => { controller?.abort(); const result = await rpc('auth.logout'); $('model').replaceChildren(el('option', '', '로그인 후 선택')); await refreshAuth(); message(result.revoked ? '연결을 해제했습니다. 저장된 인증 토큰을 지웠습니다.' : '기기에 저장된 인증 토큰을 지웠습니다. 서버의 연결 해제는 확인하지 못했습니다. ChatGPT 설정에서 앱 연결을 확인해 주세요.'); });
wire('reload-models', loadModels); wire('stop', () => controller?.abort());
wire('recent-diagnostic', async () => { const saved=await chrome.storage.session.get(['lastFailedRequestDiagnostic','lastRequestDiagnostic']); const value=saved.lastFailedRequestDiagnostic || (saved.lastRequestDiagnostic?.code!=='ok' ? saved.lastRequestDiagnostic : undefined); if(!value)return message('현재 Chrome 세션에 저장된 오류 진단이 없습니다.'); diagnosticState(value); $('report-diagnostic').click(); });
wire('report-diagnostic', () => {
 if(!lastDiagnostic)return;
 diagnosticPayload??=prepareDiagnosticReport(lastDiagnostic);
 $('diagnostic-preview').textContent=JSON.stringify(diagnosticPayload,null,2); $('diagnostic-report').hidden=false;
 $('diagnostic-status').textContent=''; $('send-diagnostic').disabled=diagnosticSending; $('send-diagnostic').focus();
});
wire('cancel-diagnostic', () => { $('diagnostic-report').hidden=true; });
wire('send-diagnostic', async () => {
 if(diagnosticSending||!diagnosticPayload)return;
 const payload=diagnosticPayload; diagnosticSending=true; $('send-diagnostic').disabled=true; $('diagnostic-status').textContent='전송 중…';
 try { const receipt=await submitDiagnosticReport(payload); $('diagnostic-status').textContent=`접수했습니다. 리포트 번호: ${receipt.reportId}`; }
 catch(error){$('diagnostic-status').textContent=error.message;}
 finally{diagnosticSending=false; $('send-diagnostic').disabled=false;}
});
wire('copy-diagnostic', async () => { if (!lastDiagnostic) return; await navigator.clipboard.writeText(JSON.stringify(lastDiagnostic, null, 2)); message('오류 진단 정보를 복사했습니다. 본문·생성 결과·인증 토큰은 포함하지 않습니다.'); });
wire('copy', async () => {
  if (!report) return;
  const text = [report.demo ? '예시 결과 · 실제 검증 아님' : `팩트렌즈 · ${report.article.title}`, report.article.url,
    ...report.claims.map(claim => `\n${claim.claim}\n원문 (${claim.origin?.label || '본문'}): ${claim.quote}\n${resultText(report.language, claim.verdict) || '미완료'}\n${claim.explanation || ''}\n${claim.sources.map(source => `${source.title}: ${source.url}\n${source.evidence}`).join('\n')}`)].join('\n');
  await navigator.clipboard.writeText(text); message('검증 결과를 복사했습니다.');
});
wire('export', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = el('a'); link.href = url; link.download = 'fact-lens-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
wire('summary-copy', async () => { if (report?.mode !== 'summary') return; await navigator.clipboard.writeText([`팩트렌즈 · 원문 요약 (사실 검증 아님) · ${report.article.title}`, report.article.url, report.overview, ...report.sections.map(section => `${section.heading}\n${section.summary}\n${section.originals.map(block => `${block.label}: ${block.text}`).join('\n')}`)].join('\n\n')); message('요약을 복사했습니다.'); });
wire('summary-export', () => $('export').click());
$('max-claims').onchange = () => { $('max-claims').value = maxClaims($('max-claims').value); void chrome.storage.local.set({ maxClaims: Number($('max-claims').value) }); };
$('output-language').onchange = () => void chrome.storage.local.set({ outputLanguage: outputLanguage($('output-language').value) });
$('model').onchange = () => void chrome.storage.local.set({ selectedModel: $('model').value });
$('fast-mode').onchange = () => void chrome.storage.local.set({ fastMode: $('fast-mode').checked });
$('article-text').oninput = () => { $('text-count').textContent = `· ${$('article-text').value.length.toLocaleString()}자`; };
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'session' && (changes.oauthError || changes.pending)) {
    const wasConnected = auth.sharing; await refreshAuth();
    if (auth.sharing && !wasConnected) { await loadModels().catch(error => message(error.message)); await readPage().catch(error => message(error.message)); }
  }
  if (area === 'session' && changes.sourceTabId) await detectPageChange();
});
chrome.runtime.onMessage.addListener(event => {
  if (event?.type !== 'auth.changed') return;
  const wasConnected = auth.sharing;
  void refreshAuth().then(() => { if (auth.sharing && !wasConnected) return loadModels().then(readPage); }).catch(error => message(error.message));
});
window.addEventListener('pagehide', () => controller?.abort());
const { fastMode, outputLanguage: savedLanguage, maxClaims: savedMaximum } = await chrome.storage.local.get(['fastMode', 'outputLanguage', 'maxClaims']);
$('max-claims').value = maxClaims(savedMaximum);
$('output-language').value = outputLanguage(savedLanguage);
$('fast-mode').checked = fastMode !== false;
await refreshAuth().catch(error => message(error.message));
if (auth.sharing) { await loadModels().catch(error => message(error.message)); await readPage().catch(error => message(error.message)); }
chrome.tabs.onActivated.addListener(() => void detectPageChange());
chrome.tabs.onUpdated.addListener(() => void detectPageChange());
const pageWatch = setInterval(() => void detectPageChange(), 3000);
window.addEventListener('pagehide', () => clearInterval(pageWatch));
