export function dcinsidePage(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['gall.dcinside.com', 'm.dcinside.com'].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
}
export const DC_IMAGE_PATTERN = '^https://(dcimg|dccdn)[0-9]*\\.dcinside\\.(co\\.kr|com)/(viewimage|dccon)\\.php(\\?|$)';
export function dcinsideImage(value) {
  try { const url = new URL(value); return !url.username && !url.password && new RegExp(DC_IMAGE_PATTERN).test(url.href); } catch { return false; }
}
export function dcinsideImageRule(extensionId) {
  return { id: 12001, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://gall.dcinside.com/' }] },
    condition: { regexFilter: DC_IMAGE_PATTERN, initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest', 'image'] } };
}
