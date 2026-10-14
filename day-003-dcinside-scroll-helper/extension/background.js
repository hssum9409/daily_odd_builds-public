'use strict';
importScripts('page-context.js', 'settings.js');
const ns = globalThis.DCScrollHelper;
// Serialize writes across tabs. No tabs/history/cookies permissions or network calls.
let writes = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
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
