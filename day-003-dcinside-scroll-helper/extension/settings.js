(() => {
  'use strict';
  const ns = globalThis.DCScrollHelper ??= {};
  const SETTINGS_KEY = 'dcScrollSettings';
  const HISTORY_KEY = 'dcScrollRecentGalleries';
  const POSITIONS = ['top-left', 'top-center', 'top-right', 'center-left', 'center-center', 'center-right',
    'bottom-left', 'bottom-center', 'bottom-right'];
  const MAX_CUSTOM_GALLERIES = 10;
  const CUSTOM_ICONS = Object.freeze([
    ['default', '기본'], ['star', '별'], ['heart', '하트'], ['bookmark', '북마크'],
    ['gamepad', '게임'], ['lightning', '번개'], ['compass', '나침반'], ['emoji', '이모지'],
  ].map(([id, label]) => Object.freeze({ id, label })));
  const BUTTON_IDS = Object.freeze(['settings', 'gallery', 'comments', 'commentWrite', 'boardList', 'top', 'bottom',
    'gallog', 'directory', 'minorDirectory', ...Array.from({ length: MAX_CUSTOM_GALLERIES }, (_, i) => `custom${i}`)]);
  const isToolbarBreak = value => typeof value === 'string' && /^break:[a-zA-Z0-9_-]{1,48}$/.test(value);
  function normalizeToolbarLayout(value) {
    const result = [], seen = new Set(); let breaks = 0;
    for (const item of Array.isArray(value) ? value : []) {
      if (seen.has(item)) continue;
      if (!BUTTON_IDS.includes(item) && !(isToolbarBreak(item) && breaks++ < BUTTON_IDS.length - 1)) continue;
      result.push(item); seen.add(item);
    }
    return [...result, ...BUTTON_IDS.filter(id => !seen.has(id))];
  }
  function moveToolbarEntry(layout, entry, before = null) {
    const normalized = normalizeToolbarLayout(layout);
    if (!normalized.includes(entry) || entry === before || (before !== null && !normalized.includes(before))) return normalized;
    const result = normalized.filter(item => item !== entry);
    result.splice(before === null ? result.length : result.indexOf(before), 0, entry);
    return result;
  }
  function toolbarGroups(layout, visible) {
    const groups = []; let current = [];
    for (const entry of normalizeToolbarLayout(layout)) {
      if (isToolbarBreak(entry)) { if (current.length) { groups.push(current); current = []; } }
      else if (visible.has(entry)) current.push(entry);
    }
    if (current.length) groups.push(current);
    return groups;
  }
  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: 4, backgroundColor: '#3b4890', iconColor: '#ffffff', opacity: 70,
    iconSize: 16, orientation: 'horizontal', position: 'bottom-right',
    toolbarLayout: BUTTON_IDS,
    shortcuts: ns.DEFAULT_SHORTCUTS,
    buttons: Object.freeze({ gallery: true, comments: true, commentWrite: true, boardList: true, top: true, bottom: true,
      gallog: false, directory: false, minorDirectory: false }),
    customSlotCount: 1,
    customGalleries: Object.freeze(Array.from({ length: MAX_CUSTOM_GALLERIES }, () =>
      Object.freeze({ mode: 'off', name: '', url: '', icon: 'default', emoji: '' }))),
  });

  // One user-perceived emoji, including flags, skin tones and ZWJ sequences.
  // Render with textContent only; never interpret saved input as markup.
  const emojiSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  function normalizeEmoji(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (text.length > 48 || [...emojiSegmenter.segment(text)].length !== 1) return '';
    return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\d#*]\uFE0F?\u20E3/u.test(text) ? text : '';
  }

  function galleryAddress(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'gall.dcinside.com' || url.port || url.username || url.password) return null;
    const path = url.pathname.replace(/\/$/, '');
    const routes = { normal: '/board', minor: '/mgallery/board', mini: '/mini/board' };
    const type = Object.keys(routes).find(key => ['lists', 'view'].some(route => path === `${routes[key]}/${route}`));
    const ids = url.searchParams.getAll('id');
    if (!type || ids.length !== 1 || !/^[a-zA-Z0-9_]+$/.test(ids[0])) return null;
    const context = { galleryType: type, galleryId: ids[0] };
    return { ...context, url: ns.galleryUrl(context) };
  }
  function galleryKey(context) { return `${context.galleryType}:${context.galleryId}`; }
  function normalizeSettings(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const color = (input, fallback) => typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : fallback;
    const number = (input, fallback, min, max) => Number.isFinite(input) ? Math.round(Math.max(min, Math.min(max, input))) : fallback;
    let hasPrevious = false;
    const customGalleries = Array.from({ length: MAX_CUSTOM_GALLERIES }, (_, index) => {
      const slot = value.customGalleries?.[index] ?? {};
      const name = typeof slot.name === 'string' ? slot.name.trim().slice(0, 24) : '';
      const emoji = normalizeEmoji(slot.emoji);
      const icon = CUSTOM_ICONS.some(item => item.id === slot.icon) && (slot.icon !== 'emoji' || emoji)
        ? slot.icon : 'default';
      const appearance = { icon, emoji };
      if (slot.mode === 'previous' && !hasPrevious) {
        hasPrevious = true;
        return { mode: 'previous', name, url: '', ...appearance };
      }
      const address = galleryAddress(slot.url);
      return { mode: slot.mode === 'fixed' && address ? 'fixed' : 'off', name,
        url: address?.url ?? '', ...appearance };
    });
    // Migrate the old three slots without shifting their IDs or toolbar positions.
    // Keep every configured slot visible even if a stale count is supplied.
    const lastConfigured = customGalleries.reduce((last, slot, index) =>
      slot.mode !== 'off' || slot.name || slot.url || slot.icon !== 'default' || slot.emoji ? index + 1 : last, 1);
    const customSlotCount = Math.max(lastConfigured, number(value.customSlotCount, 1, 1, MAX_CUSTOM_GALLERIES));
    return {
      schemaVersion: 4,
      backgroundColor: color(value.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
      iconColor: color(value.iconColor, DEFAULT_SETTINGS.iconColor),
      opacity: number(value.opacity, DEFAULT_SETTINGS.opacity, 20, 100),
      iconSize: number(value.iconSize, DEFAULT_SETTINGS.iconSize, 10, 40),
      orientation: value.orientation === 'vertical' ? 'vertical' : 'horizontal',
      position: POSITIONS.includes(value.position) ? value.position : DEFAULT_SETTINGS.position,
      toolbarLayout: normalizeToolbarLayout(value.toolbarLayout),
      shortcuts: ns.normalizeShortcuts(value.shortcuts),
      buttons: Object.fromEntries(Object.entries(DEFAULT_SETTINGS.buttons).map(([key, fallback]) =>
        [key, typeof value.buttons?.[key] === 'boolean' ? value.buttons[key] : fallback])),
      customSlotCount, customGalleries,
    };
  }
  function mergeSettings(current, patch = {}) {
    return normalizeSettings({ ...current, ...patch, buttons: { ...current.buttons, ...patch.buttons },
      shortcuts: { ...current.shortcuts, ...patch.shortcuts } });
  }
  function normalizeHistory(value) {
    const result = [];
    for (const entry of Array.isArray(value) ? value : []) {
      const address = galleryAddress(ns.galleryUrl(entry ?? {}) ?? '');
      if (address && !result.some(item => galleryKey(item) === galleryKey(address))) result.push(address);
      if (result.length === 2) break;
    }
    return result;
  }
  function recordGallery(history, context) {
    const address = galleryAddress(ns.galleryUrl(context) ?? '');
    const previous = normalizeHistory(history);
    return address ? [address, ...previous.filter(item => galleryKey(item) !== galleryKey(address))].slice(0, 2) : previous;
  }
  function previousGallery(history, context) {
    return normalizeHistory(history).find(item => galleryKey(item) !== galleryKey(context)) ?? null;
  }
  function createSettingsStore(api, onChange, onError) {
    let settings = normalizeSettings();
    let history = [];
    let disposed = false;
    function accept(data) {
      if (disposed) return;
      if (SETTINGS_KEY in data) settings = normalizeSettings(data[SETTINGS_KEY]);
      if (HISTORY_KEY in data) history = normalizeHistory(data[HISTORY_KEY]);
      onChange(settings, history);
    }
    const changed = (changes, area) => {
      if (area === 'local') accept(Object.fromEntries(Object.entries(changes).map(([key, item]) => [key, item.newValue])));
    };
    api.storage.onChanged.addListener(changed);
    async function request(message) {
      try {
        const response = await api.runtime.sendMessage(message);
        if (!response?.ok) throw new Error('Storage update failed');
        accept(response.data ?? {});
        return true;
      } catch { if (!disposed) onError('설정을 저장하지 못했습니다. 확장을 새로고침하세요.'); return false; }
    }
    return {
      async load() {
        try { accept(await api.storage.local.get([SETTINGS_KEY, HISTORY_KEY])); }
        catch { if (!disposed) onError('설정을 불러오지 못했습니다. 기본 설정으로 실행합니다.'); }
      },
      patch: patch => request({ type: 'settings.patch', patch }),
      visit: () => request({ type: 'gallery.visit' }),
      clearHistory: () => request({ type: 'gallery.clear' }),
      dispose() { disposed = true; api.storage.onChanged.removeListener(changed); },
      get settings() { return settings; }, get history() { return history; },
    };
  }
  Object.assign(ns, { SETTINGS_KEY, HISTORY_KEY, POSITIONS, DEFAULT_SETTINGS, galleryAddress, galleryKey,
    MAX_CUSTOM_GALLERIES, CUSTOM_ICONS, normalizeEmoji, BUTTON_IDS, isToolbarBreak, normalizeToolbarLayout, moveToolbarEntry, toolbarGroups,
    normalizeSettings, mergeSettings, normalizeHistory, recordGallery, previousGallery, createSettingsStore });
})();
