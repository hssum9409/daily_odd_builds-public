(() => {
  'use strict';
  const ns = globalThis.DCScrollHelper ??= {};
  const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries([
    ['settings', 'KeyS'], ['gallery', 'KeyV'], ['comments', 'KeyC'], ['commentWrite', 'KeyW'],
    ['boardList', 'KeyL'], ['top', 'KeyT'], ['bottom', 'KeyB'], ['gallog', 'KeyG'],
    ['directory', 'KeyD'], ['minorDirectory', 'KeyM'],
    ...Array.from({ length: 10 }, (_, index) => [`custom${index}`, `Digit${(index + 1) % 10}`]),
  ].map(([id, code]) => [id, Object.freeze({ code, ctrl: false, alt: false, shift: false, meta: false })])));
  const validCode = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Space)$/;
  function shortcutProblem(value) {
    if (!value || typeof value !== 'object' || typeof value.code !== 'string' || !validCode.test(value.code) ||
        ['ctrl', 'alt', 'shift', 'meta'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) {
      return '문자·숫자·방향키·F키 조합을 지정하세요.';
    }
    const { code, ctrl, alt, meta } = value;
    // Reserve common browser/OS commands; other extensions may reserve more keys.
    const primary = (ctrl || meta) && !alt;
    if ((primary && (/^Key[A-Z]$/.test(code) || /^Digit/.test(code) || ['Space', 'F4', 'F5', 'F6', 'F12'].includes(code))) ||
        (alt && !ctrl && !meta && ['ArrowLeft', 'ArrowRight', 'Home', 'Space', 'F4', 'KeyD', 'KeyE', 'KeyF'].includes(code)) ||
        (!ctrl && !alt && !meta && ['F1', 'F3', 'F5', 'F6', 'F10', 'F11', 'F12'].includes(code)) ||
        (meta && ['KeyQ', 'KeyH', 'KeyM', 'Space'].includes(code))) {
      return '브라우저 또는 운영체제의 기본 단축키입니다. 다른 조합을 선택하세요.';
    }
    if (code === 'Space' && !ctrl && !alt && !meta) return '스페이스는 Ctrl·Alt·⌘와 함께 지정하세요.';
    return '';
  }
  function normalizeShortcut(value) {
    if (shortcutProblem(value)) return null;
    return { code: value.code, ctrl: value.ctrl === true, alt: value.alt === true,
      shift: value.shift === true, meta: value.meta === true };
  }
  function shortcutKey(binding) {
    return binding ? `${+binding.ctrl}${+binding.alt}${+binding.shift}${+binding.meta}:${binding.code}` : '';
  }
  function normalizeShortcuts(value) {
    const seen = new Set();
    return Object.fromEntries(Object.keys(DEFAULT_SHORTCUTS).map(id => {
      const binding = normalizeShortcut(value && Object.hasOwn(value, id) ? value[id] : DEFAULT_SHORTCUTS[id]);
      const key = shortcutKey(binding);
      if (!key || seen.has(key)) return [id, null];
      seen.add(key); return [id, binding];
    }));
  }
  function shortcutLabel(binding, aria = false) {
    if (!binding) return aria ? '' : '지정 안 함';
    const names = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space' };
    const key = binding.code.replace(/^(Key|Digit)/, '');
    return [binding.ctrl && (aria ? 'Control' : 'Ctrl'), binding.alt && 'Alt', binding.shift && 'Shift',
      binding.meta && (aria ? 'Meta' : '⌘'), aria ? key : names[key] ?? key].filter(Boolean).join(aria ? '+' : ' + ');
  }
  function shortcutFromEvent(event) {
    // Numeric keypad digits share the top-row bindings, only while Num Lock emits a digit.
    const code = /^Numpad[0-9]$/.test(event.code) && /^[0-9]$/.test(event.key) ? event.code.replace('Numpad', 'Digit') : event.code;
    return { code, ctrl: !!event.ctrlKey, alt: !!event.altKey, shift: !!event.shiftKey, meta: !!event.metaKey };
  }
  function shortcutConflict(shortcuts, binding, except) {
    const key = shortcutKey(binding);
    return key ? Object.keys(DEFAULT_SHORTCUTS).find(id => id !== except && shortcutKey(shortcuts[id]) === key) : undefined;
  }
  function shortcutAction(event, settings, available) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
        event.getModifierState?.('AltGraph') || event.view?.document?.designMode === 'on') return null;
    const nodes = event.composedPath?.() ?? [event.target];
    if (nodes.some(node => node?.isContentEditable || node?.matches?.(
      'input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"], [role="slider"], [role="spinbutton"]'))) return null;
    const binding = normalizeShortcut(shortcutFromEvent(event));
    if (!binding) return null;
    const action = Object.keys(DEFAULT_SHORTCUTS).find(id => shortcutKey(settings.shortcuts[id]) === shortcutKey(binding));
    if (!action || !available(action)) return null;
    if (action.startsWith('custom')) {
      const index = Number(action.slice(6));
      if (index >= settings.customSlotCount || settings.customGalleries[index]?.mode === 'off') return null;
    } else if (action !== 'settings' && !settings.buttons[action]) return null;
    return action;
  }
  Object.assign(ns, { DEFAULT_SHORTCUTS, shortcutProblem, normalizeShortcut, normalizeShortcuts,
    shortcutKey, shortcutLabel, shortcutFromEvent, shortcutConflict, shortcutAction });
})();
