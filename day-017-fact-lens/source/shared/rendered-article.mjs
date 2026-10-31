// Read the rendered DOM, including bare text nodes and <br>-delimited articles.
// The caller supplies the same excluded regions used for article sanitization.
export function renderedTextBlocks(root, excludedSelector) {
  const blocks = []; let buffer = '', first, last;
  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    if (text && first && last) {
      let node = first.parentElement;
      while (node && !node.contains(last)) node = node.parentElement;
      blocks.push({ text, node: node || root });
    }
    buffer = ''; first = last = undefined;
  };
  const visit = node => {
    if (node.nodeType === 3) {
      buffer += node.nodeValue;
      if (/\S/.test(node.nodeValue)) { first ||= node; last = node; }
      return;
    }
    if (node.nodeType !== 1) return;
    const style = getComputedStyle(node);
    if ((excludedSelector && node.matches(excludedSelector)) || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) { flush(); return; }
    if (node.tagName === 'BR' || node.tagName === 'HR') { flush(); return; }
    const block = /^(block|list-item|flow-root|flex|grid|table-row|table-cell|table-caption)$/.test(style.display);
    if (block) flush();
    for (const child of node.childNodes) visit(child);
    if (block) flush();
  };
  visit(root); flush(); return blocks;
}
// Score readable regions, not tag names or site-specific form IDs. A FORM is
// a layout container here; its editable controls are excluded by the caller.
export function primaryArticleRoot(document, excludedSelector) {
  const blocks = renderedTextBlocks(document.body, excludedSelector), stats = new Map();
  const ancestors = (node, visit) => { for (let depth = 0; node && depth < 18; node = node.parentElement, depth++) { visit(node); if (node === document.body) break; } };
  for (const block of blocks) {
    if (block.text.length < 2) continue;
    ancestors(block.node, node => {
      const value = stats.get(node) || { chars: 0, raw: 0, long: 0, links: 0 };
      // Score contribution is bounded per rendered block; output is never cut.
      const weight = Math.min(block.text.length, 300);
      value.raw += block.text.length; value.chars += weight; if (block.text.length >= 80) value.long += weight;
      stats.set(node, value);
    });
  }
  for (const link of document.querySelectorAll('a[href]')) {
    if (!link.getClientRects().length || (excludedSelector && link.closest(excludedSelector))) continue;
    const length = (link.innerText || '').replace(/\s+/g, ' ').trim().length;
    ancestors(link, node => { const value = stats.get(node); if (value) value.links += length; });
  }
  let best, bestScore = -1;
  for (const [node, value] of stats) {
    if (!node.matches('article,main,section,div,td,form,body,[role="main"],[role="article"],[itemprop~="articleBody"]')) continue;
    const identity = `${node.id} ${typeof node.className === 'string' ? node.className : ''}`;
    let semantic = node === document.body ? .6 : node.matches('article,[role="article"]') ? 2.2 : node.matches('main,[role="main"]') ? 1.5 : 1;
    if (/(?:^|[\s_-])(article|entry|story|writing|write)(?:$|[\s_-])/i.test(identity)) semantic = Math.max(semantic, 4);
    else if (/(?:^|[\s_-])(post|message)(?:$|[\s_-])/i.test(identity)) semantic = Math.max(semantic, 3);
    else if (/(?:^|[\s_-])(content|body)(?:$|[\s_-])/i.test(identity)) semantic = Math.max(semantic, 1.8);
    if (node.matches('[itemprop~="articleBody"]')) semantic = 4;
    if (node.matches('main,[role="main"],body') && node.querySelectorAll('article,main,[role="main"],[itemprop~="articleBody"]').length === 1) semantic *= .2;
    const linkRatio = Math.min(.95, value.links / Math.max(value.raw, 1));
    const score = Math.sqrt(value.chars) * (.3 + .7 * value.long / value.chars) * (1 - linkRatio) ** 2 * semantic;
    if (score > bestScore) { bestScore = score; best = node; }
  }
  // Preserve image-only pages too; the original image guards still apply.
  return best || [...document.querySelectorAll('img')].find(node => node.getClientRects().length && !(excludedSelector && node.closest(excludedSelector)))?.closest('article,main,[role="main"],section,div') || document.body;
}
