// Self-contained: also passed directly to chrome.scripting.executeScript.
export function pageRevision() {
  const root = document.querySelector('[data-fact-lens-root]') || document.body;
  let text = root?.innerText || root?.textContent || '';
  for (const image of root?.querySelectorAll('img') || []) { const src = image.currentSrc || image.src; text += `\n${src.length}:${src.slice(0, 2048)}:${src.slice(-128)}:${image.alt}`; }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return { href: location.href, title: document.title, fingerprint: `${text.length}:${hash >>> 0}:${root?.querySelectorAll('img').length || 0}` };
}
