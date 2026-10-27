(() => {
  'use strict';
  const ns = globalThis.DCScrollHelper;
  const SHARE_FORMAT = 'dcinside-scroll-helper-settings';
  const SHARE_LIMIT = 24000;
  const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const fields = ['backgroundColor', 'iconColor', 'opacity', 'iconSize', 'orientation', 'position', 'toolbarLayout', 'buttons', 'shortcuts'];
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function fail() { throw new Error('올바른 디시 스크롤 도우미 공유 설정이 아닙니다.'); }
  function object(value, allowed, required = allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value, key))) fail();
  }
  function currentGallerySlot(context, slot = {}) {
    if (!context || !['view', 'list'].includes(context.pageType)) return null;
    const address = ns.galleryAddress(ns.galleryUrl(context));
    if (!address) return null;
    return { ...slot, mode: 'fixed', url: address.url, name: slot.name || address.galleryId };
  }
  function validateShareProfile(input) {
    let value;
    try {
      const text = typeof input === 'string' ? input : JSON.stringify(input);
      if (!text || text.length > SHARE_LIMIT) fail();
      value = JSON.parse(text);
    } catch { fail(); }
    object(value, ['format', 'version', 'settings']);
    if (value.format !== SHARE_FORMAT || value.version !== 1) fail();
    const data = value.settings;
    object(data, [...fields, 'customSlotCount', 'customGalleries'], fields);
    if (own(data, 'customSlotCount') !== own(data, 'customGalleries')) fail();
    for (const key of ['backgroundColor', 'iconColor']) if (typeof data[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(data[key])) fail();
    if (!Number.isInteger(data.opacity) || data.opacity < 20 || data.opacity > 100 ||
        !Number.isInteger(data.iconSize) || data.iconSize < 10 || data.iconSize > 40 ||
        !['horizontal', 'vertical'].includes(data.orientation) || !ns.POSITIONS.includes(data.position)) fail();
    if (!Array.isArray(data.toolbarLayout) || data.toolbarLayout.length > ns.BUTTON_IDS.length * 2 ||
        data.toolbarLayout.some(id => !ns.BUTTON_IDS.includes(id) && !ns.isToolbarBreak(id)) ||
        new Set(data.toolbarLayout).size !== data.toolbarLayout.length) fail();
    object(data.buttons, Object.keys(ns.DEFAULT_SETTINGS.buttons));
    if (Object.values(data.buttons).some(value => typeof value !== 'boolean')) fail();
    object(data.shortcuts, ns.BUTTON_IDS);
    const bindings = new Set();
    for (const binding of Object.values(data.shortcuts)) {
      if (binding === null) continue;
      object(binding, ['code', 'ctrl', 'alt', 'shift', 'meta']);
      if (typeof binding.code !== 'string' || ['ctrl', 'alt', 'shift', 'meta'].some(key => typeof binding[key] !== 'boolean') ||
          !ns.normalizeShortcut(binding) || ns.shortcutProblem(binding)) fail();
      const key = ns.shortcutLabel(binding);
      if (bindings.has(key)) fail(); bindings.add(key);
    }
    if (own(data, 'customGalleries')) {
      if (!Number.isInteger(data.customSlotCount) || data.customSlotCount < 1 || data.customSlotCount > ns.MAX_CUSTOM_GALLERIES ||
          !Array.isArray(data.customGalleries) || data.customGalleries.length !== ns.MAX_CUSTOM_GALLERIES) fail();
      let previous = 0;
      for (const slot of data.customGalleries) {
        object(slot, ['mode', 'url', 'name', 'icon', 'emoji']);
        if (!['off', 'fixed', 'previous'].includes(slot.mode) || typeof slot.url !== 'string' || slot.url.length > 256 ||
            typeof slot.name !== 'string' || slot.name.length > 24 || typeof slot.emoji !== 'string' || slot.emoji.length > 48 ||
            !ns.CUSTOM_ICONS.some(item => item.id === slot.icon) ||
            (slot.emoji && !ns.normalizeEmoji(slot.emoji)) || (slot.icon === 'emoji' && !ns.normalizeEmoji(slot.emoji)) ||
            (slot.url && !ns.galleryAddress(slot.url)) || (slot.mode === 'fixed' && !ns.galleryAddress(slot.url)) ||
            (slot.mode === 'previous' && (++previous > 1 || slot.url))) fail();
      }
    }
    const normalized = ns.normalizeSettings(data);
    return { format: SHARE_FORMAT, version: 1, settings: Object.fromEntries(
      [...fields, ...(own(data, 'customGalleries') ? ['customSlotCount', 'customGalleries'] : [])].map(key => [key, normalized[key]])) };
  }
  function exportShareProfile(settings, includeGalleries = false) {
    const normalized = ns.normalizeSettings(settings);
    return validateShareProfile({ format: SHARE_FORMAT, version: 1, settings: Object.fromEntries(
      [...fields, ...(includeGalleries ? ['customSlotCount', 'customGalleries'] : [])].map(key => [key, normalized[key]])) });
  }
  function shareSummary(profile) {
    const value = validateShareProfile(profile).settings;
    const base = `모양·버튼 배치·단축키 · ${value.orientation === 'horizontal' ? '가로' : '세로'} · ${value.iconSize}px`;
    return own(value, 'customGalleries') ? `${base} · 커스텀 갤러리 포함 (주소·이름 공유)` : `${base} · 내 커스텀 갤러리와 방문 기록 유지`;
  }
  function normalizeShareCode(value) {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (code.length !== 8 || [...code].some(char => !SHARE_ALPHABET.includes(char))) throw new Error('공유 코드는 영문·숫자 8자리입니다.');
    return code;
  }
  Object.assign(ns, { SHARE_FORMAT, SHARE_LIMIT, SHARE_ALPHABET, currentGallerySlot, validateShareProfile, exportShareProfile, shareSummary, normalizeShareCode });
})();
