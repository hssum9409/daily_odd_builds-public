'use strict';
importScripts('page-context.js', 'shortcuts.js', 'settings.js', 'sharing.js', 'share-client.js');
const ns = globalThis.DCScrollHelper;
// Serialize local writes and explicit sharing requests across tabs.
let writes = Promise.resolve();
let sharing = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['share.create', 'share.get', 'share.delete', 'share.owned'].includes(message?.type)) {
    if (sender.id !== chrome.runtime.id || !ns.isSupportedPageUrl(sender.url)) return false;
    const task = sharing.then(async () => {
      if (message.type === 'share.owned') {
        const data = await chrome.storage.local.get(ns.OWN_SHARES_KEY);
        return { shares: (Array.isArray(data[ns.OWN_SHARES_KEY]) ? data[ns.OWN_SHARES_KEY] : [])
          .filter(item => item.expiresAt > Date.now()).map(({ code, expiresAt }) => ({ code, expiresAt })) };
      }
      return ns.shareRequest(message, chrome);
    });
    sharing = task.catch(() => {});
    task.then(data => respond({ ok: true, data }), error => respond({ ok: false,
      error: error.name === 'TimeoutError' ? '공유 서버 응답이 늦습니다. 잠시 후 다시 시도하세요.' : error.message }));
    return true;
  }
  if (!['settings.patch', 'gallery.visit', 'gallery.clear'].includes(message?.type) ||
      sender.id !== chrome.runtime.id || !ns.isSupportedPageUrl(sender.url) ||
      (message.type === 'gallery.visit' && !ns.galleryAddress(sender.url))) return false;
  const task = writes.then(async () => {
    const data = await chrome.storage.local.get([ns.SETTINGS_KEY, ns.HISTORY_KEY]);
    let update;
    if (message.type === 'settings.patch') {
      update = { [ns.SETTINGS_KEY]: ns.mergeSettings(ns.normalizeSettings(data[ns.SETTINGS_KEY]), message.patch) };
    } else {
      const history = message.type === 'gallery.clear' ? [] : ns.recordGallery(data[ns.HISTORY_KEY], ns.galleryAddress(sender.url));
      update = { [ns.HISTORY_KEY]: history };
    }
    await chrome.storage.local.set(update);
    return update;
  });
  writes = task.catch(() => {});
  task.then(data => respond({ ok: true, data }), () => respond({ ok: false }));
  return true;
});
