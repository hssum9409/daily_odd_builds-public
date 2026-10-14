(() => {
  'use strict';
  const ns = globalThis.DCScrollHelper;
  const ACTIONS = Object.freeze([
    ['settings', '설정', 0], ['gallery', '갤러리 홈', 1], ['comments', '댓글보기', 2],
    ['commentWrite', '댓글쓰기', 3], ['boardList', '글 목록 보기', 7], ['top', '맨위로', 4], ['bottom', '맨밑으로', 5],
    ['gallog', '갤로그 가기', 6], ['directory', '갤러리 목록 가기', 9], ['minorDirectory', '마이너 갤러리 목록', 10],
    ...Array.from({ length: ns.MAX_CUSTOM_GALLERIES }, (_, index) => [`custom${index}`, `커스텀 갤러리 ${index + 1}`, 1]),
  ]);
  // Measured opaque bounds and their centers in generated 1254px images.
  // Each glyph has different source padding; equal grid-cell positions are not centered.
  const ICON_METRICS = Object.freeze([
    [274, 253, 266], [276, 627, 261.5], [284, 1015, 274],
    [273, 253.5, 644.5], [271, 625.5, 643.5], [281, 1014.5, 644],
    [263, 253.5, 1013], [262, 628, 1015], [275, 1012.5, 1015],
    [714, 655.5, 633], [784, 624, 648],
    [303, 215, 375.5], [320, 626.5, 385], [280, 1038.5, 381.5],
    [334, 214.5, 892], [315, 626, 885], [316, 1038.5, 886],
  ]);
  function createPanel({ api, onAction, onPatch, onClearHistory, onOpen }) {
    let settings = ns.normalizeSettings(), caps = {}, customLabels = [], toastTimer, toolbarKey, editorKey, drag = null;
    const host = document.createElement('dc-scroll-helper');
    host.id = 'dc-scroll-helper-host';
    host.style.cssText = 'all:initial;position:fixed;display:block;z-index:2147483646';
    const shadow = host.attachShadow({ mode: 'open' });
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = api.runtime.getURL('style.css');
    const nav = document.createElement('nav'); nav.className = 'toolbar'; nav.setAttribute('aria-label', 'DCInside 빠른 이동');
    const toast = document.createElement('p'); toast.className = 'toast'; toast.hidden = true;
    const status = document.createElement('p'); status.className = 'sr-only'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const buttons = new Map();
    function setIcon(button, index) {
      const icon = button.querySelector('.icon');
      icon.classList.remove('emoji-icon'); icon.textContent = '';
      const [extent, centerX, centerY] = ICON_METRICS[index];
      const file = index >= 11 ? 'custom-atlas.png' : index === 9 ? 'directory-g.png' : index === 10 ? 'directory-m.png' : 'toolbar-atlas.png';
      icon.style.setProperty('--icon-atlas', `url("${api.runtime.getURL('icons/' + file)}")`);
      icon.style.setProperty('--sprite-scale', 1254 / extent);
      // The mask box is 1.25 × glyph size, leaving room for asymmetric tails/triangles.
      icon.style.setProperty('--sprite-x', .625 - centerX / extent);
      icon.style.setProperty('--sprite-y', .625 - centerY / extent);
    }
    function setCustomIcon(button, slot) {
      if (slot.icon === 'emoji' && slot.emoji) {
        const icon = button.querySelector('.icon'); icon.classList.add('emoji-icon'); icon.textContent = slot.emoji;
      } else {
        const index = ns.CUSTOM_ICONS.findIndex(item => item.id === slot.icon);
        setIcon(button, index > 0 && index < 7 ? index + 10 : slot.mode === 'previous' ? 8 : 1);
      }
    }
    for (const [action, label, index] of ACTIONS) {
      const button = document.createElement('button'); button.className = 'toolbar-button'; button.type = 'button'; button.dataset.action = action;
      button.setAttribute('aria-label', label); button.title = label; button.hidden = true;
      const icon = document.createElement('span'); icon.className = 'icon'; icon.setAttribute('aria-hidden', 'true'); button.append(icon); setIcon(button, index);
      button.addEventListener('click', () => action === 'settings' ? toggleSettings(dialog.hidden) : onAction(action));
      nav.append(button); buttons.set(action, button);
    }
    buttons.get('settings').setAttribute('aria-expanded', 'false'); buttons.get('settings').setAttribute('aria-haspopup', 'dialog');
    const dialog = document.createElement('section'); dialog.id = 'settings-dialog'; dialog.className = 'settings'; dialog.hidden = true;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', '디시 스크롤 도우미 설정');
    // Static trusted markup only. User names/URLs use .value/.textContent.
    dialog.innerHTML = `
      <header class="settings-header"><h2>설정</h2><button type="button" class="text-button" data-close>닫기</button></header>
      <div class="settings-body">
        <label class="field color-field"><span>배경색</span><input type="color" name="backgroundColor"><output data-value="backgroundColor"></output></label>
        <label class="field color-field"><span>아이콘 색</span><input type="color" name="iconColor"><output data-value="iconColor"></output></label>
        <label class="field range-field"><span>배경 불투명도</span><input type="range" name="opacity" min="20" max="100"><output data-value="opacity"></output></label>
        <label class="field range-field"><span>아이콘 크기</span><input type="range" name="iconSize" min="10" max="40"><output data-value="iconSize"></output></label>
        <fieldset><legend>버튼 정렬</legend><div class="segments"><label><input type="radio" name="orientation" value="horizontal"><span>가로</span></label><label><input type="radio" name="orientation" value="vertical"><span>세로</span></label></div></fieldset>
        <fieldset><legend>버튼 위치</legend><div class="positions"></div></fieldset>
        <fieldset><legend>표시할 버튼</legend><p class="hint">핸들을 끌어 순서를 바꾸세요. 구분선은 가로에서 새 줄, 세로에서 새 열을 만듭니다. 설정은 항상 표시됩니다.</p><div class="button-layout"></div></fieldset>
        <fieldset><legend>커스텀 갤러리 <output class="slot-count" aria-label="커스텀 슬롯 수"></output></legend><p class="hint">+로 최대 10개까지 추가하세요. 직전 갤러리는 한 슬롯에 지정할 수 있습니다.</p><div class="custom-slots"></div><button type="button" class="add-slot" data-add-slot aria-label="커스텀 갤러리 슬롯 추가">+ 슬롯 추가</button></fieldset>
        <div class="settings-footer"><p class="hint">모양과 버튼 변경은 자동 저장됩니다.</p><p class="hint">직전 갤러리 이동을 위해 최근 갤러리 두 곳을 이 기기에만 저장합니다. 기록은 아래 버튼으로 지울 수 있으며, 이후 방문하면 다시 저장됩니다.</p><button type="button" class="text-button" data-reset>기본값으로</button><button type="button" class="text-button" data-clear-history>방문 기록 지우기</button></div>
      </div><p class="settings-message" role="status" aria-live="polite"></p>`;
    const controls = new Map(), slots = [];
    function message(text, error = false) { const node = dialog.querySelector('.settings-message'); node.textContent = text; node.dataset.error = String(error); }
    function preview(patch) { settings = ns.mergeSettings(settings, patch); applyTheme(); renderButtons(); syncBasic(); onPatch(patch); }
    for (const name of ['backgroundColor', 'iconColor', 'opacity', 'iconSize']) {
      const input = dialog.querySelector(`[name="${name}"]`); controls.set(name, input);
      input.addEventListener('input', () => preview({ [name]: input.type === 'range' ? Number(input.value) : input.value }));
    }
    dialog.querySelectorAll('[name="orientation"]').forEach(input => input.addEventListener('change', () => preview({ orientation: input.value })));
    const names = ['왼쪽 위', '가운데 위', '오른쪽 위', '왼쪽 중앙', '가운데 중앙', '오른쪽 중앙', '왼쪽 아래', '가운데 아래', '오른쪽 아래'];
    ns.POSITIONS.forEach((position, index) => {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'radio'; input.name = 'position'; input.value = position; label.append(input, document.createTextNode(names[index]));
      input.addEventListener('change', () => preview({ position })); dialog.querySelector('.positions').append(label);
    });
    const layoutEditor = dialog.querySelector('.button-layout');
    const grip = '<svg viewBox="0 0 16 20" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/><circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/></g></svg>';
    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const current = drag; drag = null;
      layoutEditor.querySelectorAll('[data-drop]').forEach(row => delete row.dataset.drop);
      current.handle.classList.remove('dragging');
      if (current.handle.hasPointerCapture(event.pointerId)) current.handle.releasePointerCapture(event.pointerId);
      if (event.type === 'pointerup' && current.moved && current.before !== undefined) {
        preview({ toolbarLayout: ns.moveToolbarEntry(settings.toolbarLayout, current.entry, current.before) });
        layoutEditor.querySelector(`[data-entry="${current.entry}"] .drag-handle`)?.focus();
      }
    }
    function renderLayoutEditor() {
      const shownLayout = settings.toolbarLayout.filter(entry => !entry.startsWith('custom') || Number(entry.slice(6)) < settings.customSlotCount);
      const key = settings.customSlotCount + ':' + shownLayout.join('|');
      if (key !== editorKey && !drag) {
        editorKey = key; layoutEditor.replaceChildren();
        for (const entry of shownLayout) {
          const isBreak = ns.isToolbarBreak(entry), action = ACTIONS.find(([id]) => id === entry);
          const row = document.createElement('div'); row.className = `layout-row${isBreak ? ' break-row' : ''}`; row.dataset.entry = entry;
          const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'drag-handle'; handle.innerHTML = grip;
          const label = isBreak ? '줄 구분선' : action[1]; handle.setAttribute('aria-label', `${label} 순서 이동`);
          handle.title = '드래그 또는 위/아래 방향키로 이동';
          handle.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const list = shownLayout, index = list.indexOf(entry), next = index + (event.key === 'ArrowUp' ? -1 : 1);
            if (next < 0 || next >= list.length) return;
            preview({ toolbarLayout: ns.moveToolbarEntry(settings.toolbarLayout, entry, event.key === 'ArrowUp' ? list[next] : list[next + 1] ?? null) });
            layoutEditor.querySelector(`[data-entry="${entry}"] .drag-handle`)?.focus();
          });
          handle.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0) return;
            drag = { entry, handle, pointerId: event.pointerId, y: event.clientY, moved: false };
            handle.setPointerCapture(event.pointerId); handle.classList.add('dragging');
          });
          handle.addEventListener('pointermove', event => {
            if (!drag || drag.handle !== handle || event.pointerId !== drag.pointerId) return;
            if (Math.abs(event.clientY - drag.y) < 4 && !drag.moved) return;
            drag.moved = true;
            const target = popoverShadow.elementFromPoint(event.clientX, event.clientY)?.closest('.layout-row');
            layoutEditor.querySelectorAll('[data-drop]').forEach(node => delete node.dataset.drop);
            drag.before = undefined;
            if (target && target !== row) {
              const after = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
              const entries = shownLayout, targetIndex = entries.indexOf(target.dataset.entry);
              drag.before = after ? entries[targetIndex + 1] ?? null : target.dataset.entry;
              target.dataset.drop = after ? 'after' : 'before';
            }
            const body = dialog.querySelector('.settings-body'), rect = body.getBoundingClientRect();
            if (event.clientY < rect.top + 28) body.scrollTop -= 14;
            else if (event.clientY > rect.bottom - 28) body.scrollTop += 14;
          });
          handle.addEventListener('pointerup', finishDrag); handle.addEventListener('pointercancel', finishDrag);
          row.append(handle);
          const text = document.createElement('span'); text.className = 'layout-label'; text.textContent = label;
          if (entry in ns.DEFAULT_SETTINGS.buttons) {
            const toggle = document.createElement('label'); toggle.className = 'toggle-row';
            const input = document.createElement('input'); input.type = 'checkbox'; input.name = entry; input.setAttribute('role', 'switch');
            input.addEventListener('change', () => preview({ buttons: { [entry]: input.checked } }));
            toggle.append(text, input); row.append(toggle); controls.set(entry, input);
          } else {
            row.append(text); const state = document.createElement('span'); state.className = 'layout-state';
            state.textContent = entry === 'settings' ? '항상 표시' : isBreak ? '' : '슬롯 설정'; row.append(state);
          }
          const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'layout-edit';
          if (isBreak) {
            edit.textContent = '삭제'; edit.setAttribute('aria-label', '줄 구분선 삭제');
            edit.addEventListener('click', () => { preview({ toolbarLayout: settings.toolbarLayout.filter(item => item !== entry) }); layoutEditor.querySelector('.drag-handle')?.focus(); });
          } else {
            edit.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 15h14M10 8v4M8 10h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            edit.setAttribute('aria-label', `${label} 뒤에 줄 구분선 추가`); edit.title = '뒤에 줄 구분선 추가';
            edit.addEventListener('click', () => {
              const list = [...settings.toolbarLayout];
              if (list.filter(ns.isToolbarBreak).length >= ns.BUTTON_IDS.length - 1) { message(`줄 구분선은 최대 ${ns.BUTTON_IDS.length - 1}개입니다.`, true); return; }
              const separator = `break:${crypto.randomUUID()}`; list.splice(list.indexOf(entry) + 1, 0, separator);
              preview({ toolbarLayout: list }); layoutEditor.querySelector(`[data-entry="${separator}"] .drag-handle`)?.focus();
            });
          }
          row.append(edit); layoutEditor.append(row);
        }
      }
      for (let index = 0; index < settings.customSlotCount; index++) {
        const label = layoutEditor.querySelector(`[data-entry="custom${index}"] .layout-label`);
        if (label) label.textContent = settings.customGalleries[index].name || `커스텀 갤러리 ${index + 1}`;
      }
    }
    function createSlot(index) {
      const slot = document.createElement('div'); slot.className = 'custom-slot';
      slot.innerHTML = `<label class="slot-mode"><span>슬롯 ${index + 1}</span><select aria-label="커스텀 ${index + 1} 종류"><option value="off">사용 안 함</option><option value="fixed">갤러리 지정</option><option value="previous">직전 갤러리로 이동</option></select></label>
        <label class="slot-url"><span>갤러리 URL</span><input type="url" aria-label="커스텀 ${index + 1} URL" placeholder="https://gall.dcinside.com/board/lists/?id=…"></label>
        <label class="slot-name"><span>버튼 이름</span><input type="text" aria-label="커스텀 ${index + 1} 이름" maxlength="24" placeholder="선택 사항"></label>
        <div class="slot-appearance"><span class="slot-caption">버튼 아이콘</span><div class="icon-options" role="radiogroup" aria-label="커스텀 ${index + 1} 아이콘"></div>
        <div class="emoji-fields"><label class="slot-emoji"><span>이모지 한 개</span><input type="text" aria-label="커스텀 ${index + 1} 이모지" maxlength="48" placeholder="예: 🎮 · Windows + ."></label><div class="emoji-options" aria-label="추천 이모지"></div><p class="hint">이모지는 원래 색상으로 표시됩니다.</p></div></div>
        <button type="button" class="apply-button" aria-label="커스텀 ${index + 1} 적용">적용</button>`;
      const mode = slot.querySelector('select'), url = slot.querySelector('[type="url"]'), name = slot.querySelector('[type="text"]');
      const emoji = slot.querySelector('.slot-emoji input');
      const entry = { node: slot, mode, url, name, emoji, icon: 'default', dirty: false, showFields() {
        slot.querySelector('.slot-url').hidden = mode.value !== 'fixed'; slot.querySelector('.slot-name').hidden = mode.value === 'off';
        slot.querySelector('.slot-appearance').hidden = mode.value === 'off';
        slot.querySelector('.emoji-fields').hidden = entry.icon !== 'emoji';
        slot.querySelectorAll('.icon-option').forEach(button => {
          button.setAttribute('aria-checked', String(button.dataset.icon === entry.icon));
          if (button.dataset.icon === 'default') setCustomIcon(button, { mode: mode.value, icon: 'default' });
        });
      } }; slots.push(entry);
      ns.CUSTOM_ICONS.forEach(option => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-option';
        button.dataset.icon = option.id; button.setAttribute('role', 'radio'); button.setAttribute('aria-label', `커스텀 ${index + 1} ${option.label} 아이콘`);
        const glyph = document.createElement('span'); glyph.className = 'icon'; glyph.setAttribute('aria-hidden', 'true');
        const caption = document.createElement('span'); caption.className = 'icon-caption'; caption.textContent = option.label;
        const frame = document.createElement('span'); frame.className = 'icon-preview'; frame.append(glyph); button.append(frame, caption);
        setCustomIcon(button, { mode: mode.value, icon: option.id, emoji: '😊' });
        button.addEventListener('click', () => { entry.icon = option.id; entry.dirty = true; entry.showFields(); if (option.id === 'emoji') emoji.focus(); });
        button.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); const options = [...slot.querySelectorAll('.icon-option')], step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
          const next = options[(options.indexOf(button) + step + options.length) % options.length]; next.click(); next.focus();
        });
        slot.querySelector('.icon-options').append(button);
      });
      for (const symbol of ['🎮', '📚', '🎨', '🎵', '⚽', '🚀', '🐱', '💎']) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'emoji-choice'; button.textContent = symbol;
        button.setAttribute('aria-label', `커스텀 ${index + 1} 이모지 ${symbol}`);
        button.addEventListener('click', () => { emoji.value = symbol; entry.dirty = true; }); slot.querySelector('.emoji-options').append(button);
      }
      mode.addEventListener('change', () => { entry.dirty = true; entry.showFields(); });
      url.addEventListener('input', () => { entry.dirty = true; }); name.addEventListener('input', () => { entry.dirty = true; });
      emoji.addEventListener('input', () => { entry.dirty = true; });
      slot.querySelector('.apply-button').addEventListener('click', async () => {
        const address = mode.value === 'fixed' ? ns.galleryAddress(url.value.trim()) : null;
        if (mode.value === 'fixed' && !address) { message('일반·마이너·미니 갤러리의 PC 게시글 또는 목록 URL을 입력하세요.', true); url.focus(); return; }
        const custom = settings.customGalleries.map(item => ({ ...item }));
        if (entry.icon === 'emoji' && !ns.normalizeEmoji(emoji.value)) { message('이모지를 한 개 입력하거나 추천 이모지를 선택하세요.', true); emoji.focus(); return; }
        if (mode.value === 'previous') custom.forEach((item, i) => { if (i !== index && item.mode === 'previous') custom[i] = { ...item, mode: 'off' }; });
        custom[index] = { mode: mode.value, name: name.value, url: address?.url ?? (mode.value === 'off' ? url.value : ''), icon: entry.icon, emoji: emoji.value };
        if (await onPatch({ customGalleries: custom }, true)) { entry.dirty = false; syncSlots(); message('커스텀 갤러리를 저장했습니다.'); }
      });
      dialog.querySelector('.custom-slots').append(slot);
    }
    const addSlot = dialog.querySelector('[data-add-slot]'); let addingSlot = false;
    addSlot.addEventListener('click', async () => {
      if (addingSlot || settings.customSlotCount >= ns.MAX_CUSTOM_GALLERIES) return;
      addingSlot = true; addSlot.disabled = true;
      try {
        if (await onPatch({ customSlotCount: settings.customSlotCount + 1 }, true)) {
          syncSlots(); slots.at(-1).mode.focus(); message('빈 슬롯을 추가했습니다.');
        }
      } finally { addingSlot = false; syncSlots(); }
    });
    function syncBasic() {
      renderLayoutEditor();
      for (const name of ['backgroundColor', 'iconColor', 'opacity', 'iconSize']) {
        controls.get(name).value = settings[name]; dialog.querySelector(`[data-value="${name}"]`).textContent = `${settings[name]}${name === 'opacity' ? '%' : name === 'iconSize' ? 'px' : ''}`;
      }
      dialog.querySelectorAll('[name="orientation"], [name="position"]').forEach(input => { input.checked = input.value === settings[input.name]; });
      for (const action of Object.keys(settings.buttons)) controls.get(action).checked = settings.buttons[action];
    }
    function syncSlots() {
      while (slots.length > settings.customSlotCount) slots.pop().node.remove();
      while (slots.length < settings.customSlotCount) createSlot(slots.length);
      dialog.querySelector('.slot-count').textContent = `${settings.customSlotCount} / ${ns.MAX_CUSTOM_GALLERIES}`;
      addSlot.disabled = addingSlot || settings.customSlotCount >= ns.MAX_CUSTOM_GALLERIES;
      addSlot.textContent = settings.customSlotCount >= ns.MAX_CUSTOM_GALLERIES ? '최대 10개까지 추가했습니다' : '+ 슬롯 추가';
      slots.forEach((entry, index) => {
      if (entry.dirty) return; const current = settings.customGalleries[index];
      entry.mode.value = current.mode; entry.url.value = current.url; entry.name.value = current.name;
      entry.icon = current.icon; entry.emoji.value = current.emoji; entry.showFields();
    }); }
    function placeDialog() {
      if (dialog.hidden) return;
      const rect = nav.getBoundingClientRect(), width = Math.min(340, window.innerWidth - 24);
      let height = Math.min(620, window.innerHeight - 96);
      const [vertical] = settings.position.split('-');
      const beside = settings.orientation === 'vertical' || vertical === 'center';
      if (!beside) {
        const room = settings.position.startsWith('top') ? window.innerHeight - rect.bottom - 24 : rect.top - 24;
        if (room >= 160) height = Math.min(height, room);
      }
      dialog.style.maxHeight = `${height}px`;
      let left = settings.position.endsWith('left') ? rect.left : settings.position.endsWith('center') ? (window.innerWidth - width) / 2 : rect.right - width;
      let top = settings.position.startsWith('top') ? rect.bottom + 12 : rect.top - height - 12;
      if (beside) {
        left = rect.left - width - 12; if (left < 12) left = rect.right + 12;
        top = vertical === 'center' ? (window.innerHeight - height) / 2 : rect.top;
      }
      dialog.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
      dialog.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
    }
    function applyTheme() {
      const hex = settings.backgroundColor.slice(1), rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
      host.style.setProperty('--button-background', `rgba(${rgb.join(',')},${settings.opacity / 100})`);
      host.style.setProperty('--icon-color', settings.iconColor); host.style.setProperty('--icon-size', `${settings.iconSize}px`);
      host.style.setProperty('--icon-atlas', `url("${api.runtime.getURL('icons/toolbar-atlas.png')}")`); host.dataset.orientation = settings.orientation;
      const [vertical, horizontal] = settings.position.split('-');
      host.style.top = vertical === 'top' ? '20px' : vertical === 'center' ? '50%' : 'auto'; host.style.bottom = vertical === 'bottom' ? '20px' : 'auto';
      host.style.left = horizontal === 'left' ? '20px' : horizontal === 'center' ? '50%' : 'auto'; host.style.right = horizontal === 'right' ? '20px' : 'auto';
      host.style.transform = `translate(${horizontal === 'center' ? '-50%' : '0'}, ${vertical === 'center' ? '-50%' : '0'})`;
      host.style.setProperty('--toolbar-align', horizontal === 'left' ? 'flex-start' : horizontal === 'center' ? 'center' : 'flex-end');
      host.style.setProperty('--column-align', vertical === 'top' ? 'flex-start' : vertical === 'center' ? 'center' : 'flex-end');
      placeDialog();
    }
    function renderButtons() {
      for (const [action, label, icon] of ACTIONS) {
        const button = buttons.get(action); let visible = action === 'settings' || !!(settings.buttons[action] && caps[action]);
        if (action.startsWith('custom')) {
          const index = Number(action.slice(6)), slot = settings.customGalleries[index]; visible = index < settings.customSlotCount && slot.mode !== 'off'; button.disabled = !caps[action];
          const description = (customLabels[index] ?? slot.name) || (slot.mode === 'previous' ? '직전 갤러리로 이동' : `커스텀 갤러리 ${index + 1}`);
          button.title = description; button.setAttribute('aria-label', description); setCustomIcon(button, slot); button.dataset.badge = String(index + 1);
        } else {
          // Login capability affects visibility only; saved order/toggle stay intact.
          button.disabled = false;
          button.title = label;
          setIcon(button, icon);
        }
        if (button.hidden !== !visible) button.hidden = !visible;
      }
      const visible = new Set([...buttons].filter(([, button]) => !button.hidden).map(([id]) => id));
      const groups = ns.toolbarGroups(settings.toolbarLayout, visible), key = JSON.stringify(groups);
      if (key !== toolbarKey) {
        toolbarKey = key;
        nav.replaceChildren(...groups.map(entries => { const group = document.createElement('div'); group.className = 'toolbar-group'; group.append(...entries.map(id => buttons.get(id))); return group; }));
      }
      placeDialog();
    }
    function toggleSettings(open) {
      dialog.hidden = !open; buttons.get('settings').setAttribute('aria-expanded', String(open));
      if (open) { onOpen(); syncBasic(); syncSlots(); placeDialog(); dialog.querySelector('[data-close]').focus(); } else buttons.get('settings').focus();
    }
    dialog.querySelector('[data-close]').addEventListener('click', () => toggleSettings(false));
    dialog.querySelector('[data-reset]').addEventListener('click', async () => { slots.forEach(entry => { entry.dirty = false; }); if (await onPatch(ns.normalizeSettings(), true)) message('기본 설정으로 되돌렸습니다.'); });
    dialog.querySelector('[data-clear-history]').addEventListener('click', async () => { if (await onClearHistory()) message('직전 갤러리 기록을 지웠습니다.'); });
    // Separate host keeps fixed popover coordinates correct at center/translated anchors.
    const popoverHost = document.createElement('dc-scroll-settings'); popoverHost.id = 'dc-scroll-settings-host';
    popoverHost.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const popoverShadow = popoverHost.attachShadow({ mode: 'open' }); popoverShadow.append(css.cloneNode(), dialog);
    const outside = event => { if (!dialog.hidden && !event.composedPath().includes(host) && !event.composedPath().includes(popoverHost)) toggleSettings(false); };
    const escape = event => { if (event.key === 'Escape' && !dialog.hidden) toggleSettings(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('resize', placeDialog);
    shadow.append(css, nav, toast, status); document.body.append(host, popoverHost);
    applyTheme(); syncBasic(); syncSlots(); renderButtons();
    return {
      connected: () => host.isConnected && popoverHost.isConnected,
      update(value, capabilities, labels) { settings = value; caps = capabilities; customLabels = labels; applyTheme(); syncBasic(); syncSlots(); renderButtons(); },
      notice(text, error = false) { message(text, error); status.textContent = text; },
      state(state) {
        const label = ACTIONS.find(([action]) => action === state.action)?.[1] ?? '';
        const text = { seeking: `${label} 이동 중 · Esc 취소`, complete: `${label} 도착`, cancelled: '이동 취소됨', 'not-found': '목표를 찾지 못했습니다', timeout: '이동 시간이 초과됐습니다 · 다시 시도하세요', error: '이동 중 오류가 발생했습니다' }[state.status];
        buttons.forEach((button, action) => button.setAttribute('aria-busy', String(state.status === 'seeking' && action === state.action)));
        status.textContent = text; toast.textContent = text; toast.hidden = false; window.clearTimeout(toastTimer);
        if (state.status !== 'seeking') toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2500);
      },
      remove() { window.clearTimeout(toastTimer); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', placeDialog); host.remove(); popoverHost.remove(); },
    };
  }
  Object.assign(ns, { ACTIONS, createPanel });
})();
