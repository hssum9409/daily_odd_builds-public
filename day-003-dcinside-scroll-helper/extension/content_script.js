(() => {
  'use strict';
  const ns = globalThis.DCScrollHelper;
  ns.dispose?.();
  let context, panel = null, navigator = null, liveJob = null;
  let disposed = false, refreshTimer, saveTimer, pendingPatch = {}, lastRecorded = null;
  const inFlightPatches = new Set();
  const store = ns.createSettingsStore(chrome, () => refresh(), text => panel?.notice(text, true));

  function visibleSettings() {
    let value = store.settings;
    for (const patch of inFlightPatches) value = ns.mergeSettings(value, patch);
    return ns.mergeSettings(value, pendingPatch);
  }

  function customTargets() {
    return visibleSettings().customGalleries.map(slot => slot.mode === 'previous'
      ? ns.previousGallery(store.history, context)
      : slot.mode === 'fixed' ? ns.galleryAddress(slot.url) : null);
  }
  function actionCapabilities() {
    const caps = ns.capabilities(context, document);
    return { ...caps, settings: true, directory: true, minorDirectory: true, gallog: !!ns.gallogUrl(document, context),
      ...Object.fromEntries(customTargets().map((target, index) => ['custom' + index, !!target])) };
  }
  function removePanel() {
    navigator?.cancel('page-changed'); navigator = null;
    panel?.remove(); panel = null; liveJob = null;
  }
  function recordVisit(force = false) {
    if (!context || !['view', 'list'].includes(context.pageType) || document.visibilityState !== 'visible') return;
    const key = ns.galleryKey(context);
    if (force || key !== lastRecorded) { lastRecorded = key; store.visit(); }
  }
  function refresh() {
    if (disposed || !document.body) return;
    const next = ns.parseContext(location.href, document);
    if (JSON.stringify(next) !== JSON.stringify(context) || (panel && !panel.connected())) removePanel();
    context = next;
    if (!ns.isSupportedPage(context)) { removePanel(); return; }
    if (!panel) {
      panel = ns.createPanel({ api: chrome, onAction: performAction, onPatch: queuePatch,
        onClearHistory: () => store.clearHistory(), onOpen: () => navigator?.cancel('settings') });
      navigator = ns.createNavigator({
        resolveTarget: action => ns.resolveTarget(action, document, context),
        onState: state => { liveJob = state.status === 'seeking' ? state.action : null; panel?.state(state); },
      });
    }
    const targets = customTargets();
    const labels = visibleSettings().customGalleries.map((slot, index) => slot.mode === 'previous'
      ? (slot.name || '직전 갤러리로 이동') + (targets[index] ? ' · ' + targets[index].galleryId : ' · 방문 기록 없음')
      : slot.name || targets[index]?.galleryId || '');
    panel.update(visibleSettings(), actionCapabilities(), labels);
    recordVisit();
  }
  function scheduleRefresh(mutations) {
    if (Array.isArray(mutations) && mutations.every(record =>
      record.target instanceof Element && record.target.closest('dc-scroll-helper, dc-scroll-settings'))) return;
    if (disposed || refreshTimer) return;
    refreshTimer = window.setTimeout(() => { refreshTimer = null; refresh(); }, 180);
  }
  async function flushPatch() {
    window.clearTimeout(saveTimer); saveTimer = null;
    const patch = pendingPatch; pendingPatch = {};
    if (!Object.keys(patch).length) return true;
    inFlightPatches.add(patch);
    try { return await store.patch(patch); }
    finally { inFlightPatches.delete(patch); refresh(); }
  }
  function queuePatch(patch, immediate = false) {
    pendingPatch = { ...pendingPatch, ...patch,
      ...(patch.buttons ? { buttons: { ...pendingPatch.buttons, ...patch.buttons } } : {}) };
    window.clearTimeout(saveTimer);
    if (immediate) return flushPatch();
    saveTimer = window.setTimeout(flushPatch, 220);
  }
  async function performAction(action) {
    refresh();
    if (!panel || !actionCapabilities()[action]) return;
    let url;
    if (action === 'gallery') url = ns.galleryUrl(context);
    else if (action === 'directory') url = ns.directoryUrl;
    else if (action === 'minorDirectory') url = ns.minorDirectoryUrl;
    else if (action === 'gallog') url = ns.gallogUrl(document, context);
    else if (action.startsWith('custom')) url = customTargets()[Number(action.slice(6))]?.url;
    if (url) {
      navigator.cancel('page-navigation');
      await flushPatch();
      if (!disposed) location.assign(url);
    } else navigator.run(action);
  }
  function cancelOnInput(event) {
    if (!liveJob) return;
    if (event.type === 'keydown' && !['Escape', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    const editable = event.composedPath().some(node => node instanceof Element &&
      (node.matches('input, textarea, select') || node.isContentEditable));
    if (editable && event.key !== 'Escape') return;
    navigator?.cancel(event.type === 'keydown' && event.key === 'Escape' ? 'escape' : 'manual-scroll');
  }
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'readonly', 'href', 'onclick'] });
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  window.navigation?.addEventListener('currententrychange', scheduleRefresh);
  document.addEventListener('keydown', cancelOnInput, true);
  document.addEventListener('wheel', cancelOnInput, { capture: true, passive: true });
  document.addEventListener('touchstart', cancelOnInput, { capture: true, passive: true });
  function onPageHide() { navigator?.cancel('page-hidden'); flushPatch(); }
  function onPageShow() { scheduleRefresh(); }
  function onVisibility() { if (document.visibilityState === 'visible') { refresh(); recordVisit(true); } }
  window.addEventListener('pagehide', onPageHide); window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  ns.dispose = () => {
    disposed = true; observer.disconnect();
    window.clearTimeout(refreshTimer); flushPatch(); store.dispose();
    window.removeEventListener('popstate', scheduleRefresh); window.removeEventListener('hashchange', scheduleRefresh);
    window.navigation?.removeEventListener('currententrychange', scheduleRefresh);
    document.removeEventListener('keydown', cancelOnInput, true);
    document.removeEventListener('wheel', cancelOnInput, true); document.removeEventListener('touchstart', cancelOnInput, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow); removePanel();
  };
  refresh(); store.load();
})();
