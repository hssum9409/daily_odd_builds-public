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
  function createPanel({ api, onAction, onPatch, onClearHistory, onOpen, getCurrentGallery = () => null }) {
    let settings = ns.normalizeSettings(), caps = {}, customLabels = [], toastTimer, toolbarKey, editorKey, drag = null;
    let shortcutEditorKey, capturingShortcut = null;
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
      <header class="settings-header"><h2>설정</h2><div class="settings-header-actions"><button type="button" class="text-button creator-toggle" id="dc-settings-creator" data-creator aria-pressed="false" aria-controls="dc-settings-panel-creator">만든놈</button><button type="button" class="text-button" data-close>닫기</button></div></header>
      <div class="settings-body">
        <label class="field color-field"><span>배경색</span><input type="color" name="backgroundColor"><output data-value="backgroundColor"></output></label>
        <label class="field color-field"><span>아이콘 색</span><input type="color" name="iconColor"><output data-value="iconColor"></output></label>
        <label class="field range-field"><span>배경 불투명도</span><input type="range" name="opacity" min="20" max="100"><output data-value="opacity"></output></label>
        <label class="field range-field"><span>아이콘 크기</span><input type="range" name="iconSize" min="10" max="40"><output data-value="iconSize"></output></label>
        <fieldset><legend>버튼 정렬</legend><div class="segments"><label><input type="radio" name="orientation" value="horizontal"><span>가로</span></label><label><input type="radio" name="orientation" value="vertical"><span>세로</span></label></div></fieldset>
        <fieldset><legend>버튼 위치</legend><div class="positions"></div></fieldset>
        <fieldset class="shortcut-settings"><legend>키보드 단축키</legend><p class="hint">입력창 밖에서만 작동합니다. 커스텀 1~10은 숫자 1~9·0입니다. 숨긴 버튼은 실행하지 않습니다.</p><details><summary>단축키 보기 · 변경</summary><p class="hint shortcut-help">버튼 옆의 키를 누른 뒤 원하는 키 조합을 입력하세요. Ctrl·Alt·Shift·⌘ 조합도 지원합니다. Esc 취소 · Tab 다음 항목. 다른 확장이나 OS가 먼저 처리하는 조합은 작동하지 않을 수 있습니다.</p><div class="shortcut-list"></div><div class="shortcut-tools"><button type="button" class="text-button" data-reset-shortcuts>기본 키로</button><button type="button" class="text-button" data-clear-shortcuts>모두 해제</button></div></details></fieldset>
        <fieldset><legend>표시할 버튼</legend><p class="hint">핸들을 끌어 순서를 바꾸세요. 구분선은 가로에서 새 줄, 세로에서 새 열을 만듭니다. 설정은 항상 표시됩니다.</p><div class="button-layout"></div></fieldset>
        <fieldset><legend>커스텀 갤러리 <output class="slot-count" aria-label="커스텀 슬롯 수"></output></legend><p class="hint">+로 최대 10개까지 추가하세요. 직전 갤러리는 한 슬롯에 지정할 수 있습니다.</p><div class="custom-slots"></div><button type="button" class="add-slot" data-add-slot aria-label="커스텀 갤러리 슬롯 추가">+ 슬롯 추가</button></fieldset>
        <fieldset class="share-settings"><legend>설정 공유</legend>
          <p class="hint">모양·버튼 배치·단축키를 공유합니다. 최근 방문 기록·계정 정보는 포함하지 않습니다. 아직 적용하지 않은 슬롯 편집은 먼저 적용하세요.</p>
          <label class="share-check"><input type="checkbox" data-share-galleries>커스텀 갤러리 주소·이름 포함</label>
          <div class="share-tools"><button type="button" class="text-button" data-export>공유할 설정 만들기</button><button type="button" class="text-button" data-copy>설정 복사</button></div>
          <label class="share-field"><span>복사·붙여넣기할 설정</span><textarea data-share-text aria-label="공유 설정 텍스트" maxlength="24000" spellcheck="false" placeholder="공유할 설정을 만들거나 다른 사람의 설정을 붙여넣으세요."></textarea></label>
          <button type="button" class="text-button" data-parse>붙여넣은 설정 확인</button>
          <p class="hint">코드 공유는 선택 기능입니다. 업로드하면 설정을 Google Firebase 서버에 30일간 보관하고, 코드를 아는 사람이 받아갈 수 있습니다. 민감한 주소·이름을 넣지 마세요. 설정 텍스트와 코드는 자동 업로드하지 않습니다.</p>
          <a class="share-policy" href="https://daily-odd-builds-portal.web.app/privacy/dcinside-scroll-helper" target="_blank" rel="noopener noreferrer">공유 데이터·보관·삭제 안내</a>
          <label class="share-check"><input type="checkbox" data-share-consent>위 공유 범위와 서버 저장에 동의합니다.</label>
          <button type="button" class="apply-button" data-upload>현재 설정 업로드 · 코드 만들기</button>
          <label class="share-field"><span>공유 코드 8자리</span><input type="text" data-share-code aria-label="공유 코드 8자리" maxlength="8" autocomplete="off" spellcheck="false" placeholder="예: AB2C3D4E"></label>
          <button type="button" class="text-button" data-copy-code>코드 복사</button>
          <button type="button" class="text-button" data-download>코드 불러오기</button>
          <p class="share-preview hint" role="status"></p><button type="button" class="apply-button" data-import hidden>확인한 설정 적용</button>
          <details class="owned-shares"><summary>내가 만든 코드 관리</summary><p class="hint">이 기기에 저장한 삭제 키로만 삭제할 수 있습니다. 확장 제거·데이터 삭제 전에 공유 코드를 삭제하세요. 삭제하지 않아도 30일 후 만료됩니다.</p><button type="button" class="text-button" data-owned>목록 새로고침</button><div class="owned-share-list"></div></details>
        </fieldset>
        <div class="settings-footer"><p class="hint">모양·버튼·단축키 변경은 자동 저장됩니다.</p><details class="settings-maintenance"><summary>초기화·방문 기록 관리</summary><p class="hint">직전 갤러리 이동을 위해 최근 갤러리 두 곳을 이 기기에만 저장합니다. 기록은 아래 버튼으로 지울 수 있으며, 이후 방문하면 다시 저장됩니다.</p><button type="button" class="text-button" data-reset>기본값으로</button><button type="button" class="text-button" data-clear-history>방문 기록 지우기</button></details></div>
        <section class="settings-tab-panel creator-content" id="dc-settings-panel-creator" role="region" aria-labelledby="dc-settings-creator" hidden>
          <h3>만든놈</h3>
          <a class="creator-name" href="https://github.com/hssum9409" target="_blank" rel="noopener noreferrer">hssum9409</a>
          <p>매일 한개씩 잡동사니 만드는 사람<br>요청사항은 <a href="https://github.com/hssum9409/daily_odd_builds-public/issues" target="_blank" rel="noopener noreferrer">github</a> 에 보내면 수정할지도 안할지도. 버그는 가능한 빠르게 수정함.</p>
          <p>그 외 잡동사니가 보고싶은 사람은 <a href="https://daily-odd-builds-portal.web.app/" target="_blank" rel="noopener noreferrer">여기</a>로.<br>AI 슬롭 같다구요? 으쩌라구요</p>
          <p class="creator-product">Day 003 · 디시 스크롤 도우미<span data-creator-version></span></p>
        </section>
      </div><p class="settings-message" role="status" aria-live="polite"></p>`;
    const controls = new Map(), slots = [];
    function message(text, error = false) { const node = dialog.querySelector('.settings-message'); node.textContent = text; node.dataset.error = String(error); }
    // Move existing controls once; switching tabs never rebuilds editors or loses drafts.
    const settingsBody = dialog.querySelector('.settings-body');
    const tabList = document.createElement('div'); tabList.className = 'settings-tabs';
    tabList.setAttribute('role', 'tablist'); tabList.setAttribute('aria-label', '설정 분류');
    const tabDefinitions = [
      ['appearance', '모양·배치', '모양·배치', [...dialog.querySelectorAll('.field'), dialog.querySelector('.segments').closest('fieldset'), dialog.querySelector('.positions').closest('fieldset'), dialog.querySelector('.settings-footer')]],
      ['buttons', '버튼·단축키', '버튼·단축키', [dialog.querySelector('.shortcut-settings'), dialog.querySelector('.button-layout').closest('fieldset')]],
      ['galleries', '갤러리', '커스텀 갤러리', [dialog.querySelector('.custom-slots').closest('fieldset')]],
      ['sharing', '설정 공유', '설정 공유', [dialog.querySelector('.share-settings')]],
    ];
    const tabButtons = new Map(), tabPanels = new Map(), tabScroll = new Map();
    let activeTab = 'appearance', previousSettingsTab = 'appearance';
    const creatorButton = dialog.querySelector('[data-creator]');
    const creatorPanel = dialog.querySelector('.creator-content');
    const version = api.runtime.getManifest?.().version;
    if (version) dialog.querySelector('[data-creator-version]').textContent = ` · v${version}`;
    for (const [id, caption, label, nodes] of tabDefinitions) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'settings-tab';
      button.id = `dc-settings-tab-${id}`; button.dataset.tab = id; button.textContent = caption;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-label', label);
      button.setAttribute('aria-controls', `dc-settings-panel-${id}`);
      button.setAttribute('aria-selected', String(id === activeTab)); button.tabIndex = id === activeTab ? 0 : -1;
      const panel = document.createElement('section'); panel.id = `dc-settings-panel-${id}`; panel.className = 'settings-tab-panel';
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); panel.tabIndex = 0;
      panel.hidden = id !== activeTab; panel.append(...nodes); settingsBody.append(panel);
      button.addEventListener('click', () => selectSettingsTab(id));
      button.addEventListener('keydown', event => {
        const index = tabDefinitions.findIndex(([key]) => key === id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabDefinitions.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % tabDefinitions.length
            : event.key === 'ArrowLeft' ? (index + tabDefinitions.length - 1) % tabDefinitions.length : null;
        if (next === null) return;
        event.preventDefault(); selectSettingsTab(tabDefinitions[next][0]); tabButtons.get(activeTab).focus();
      });
      tabButtons.set(id, button); tabPanels.set(id, panel); tabList.append(button);
    }
    tabPanels.set('creator', creatorPanel);
    creatorButton.addEventListener('click', () => {
      if (activeTab === 'creator') selectSettingsTab(previousSettingsTab);
      else { previousSettingsTab = activeTab; selectSettingsTab('creator'); }
    });
    dialog.querySelector('.settings-header').after(tabList);
    function selectSettingsTab(id) {
      if (id === activeTab) return;
      tabScroll.set(activeTab, settingsBody.scrollTop); stopShortcutCapture(); activeTab = id;
      creatorButton.setAttribute('aria-pressed', String(id === 'creator'));
      tabButtons.forEach((button, key) => { button.setAttribute('aria-selected', String(key === id)); button.tabIndex = key === (id === 'creator' ? previousSettingsTab : id) ? 0 : -1; });
      tabPanels.forEach((panel, key) => { panel.hidden = key !== id; });
      settingsBody.scrollTop = tabScroll.get(id) ?? 0; message(''); placeDialog();
    }
    const shareText = dialog.querySelector('[data-share-text]'), shareCode = dialog.querySelector('[data-share-code]');
    const sharePreview = dialog.querySelector('.share-preview'), importButton = dialog.querySelector('[data-import]');
    let pendingImport = null, shareBusy = false, shareTextIsExport = false;
    function showImport(profile) {
      shareTextIsExport = false; pendingImport = ns.validateShareProfile(profile); sharePreview.textContent = `${ns.shareSummary(pendingImport)} · 적용하면 해당 설정을 바꿉니다. 방문 기록은 유지합니다.`;
      importButton.hidden = false;
    }
    function invalidateImport() { pendingImport = null; shareTextIsExport = false; importButton.hidden = true; sharePreview.textContent = ''; }
    shareText.addEventListener('input', invalidateImport); shareCode.addEventListener('input', invalidateImport);
    const includeGalleries = () => dialog.querySelector('[data-share-galleries]').checked;
    function createExport() {
      const profile = ns.exportShareProfile(settings, includeGalleries());
      invalidateImport(); shareText.value = JSON.stringify(profile); shareTextIsExport = true; sharePreview.textContent = ns.shareSummary(profile);
      return profile;
    }
    dialog.querySelector('[data-export]').addEventListener('click', () => { createExport(); message('공유할 설정을 만들었습니다. 텍스트를 복사해 보내세요.'); });
    dialog.querySelector('[data-share-galleries]').addEventListener('change', () => { if (shareTextIsExport) createExport(); });
    dialog.querySelector('[data-copy]').addEventListener('click', async () => {
      const profile = createExport(), text = JSON.stringify(profile);
      try { await navigator.clipboard.writeText(text); message('설정을 복사했습니다. 다른 사람에게 붙여넣어 보내세요.'); }
      catch { shareText.focus(); shareText.select(); message('복사가 제한되어 텍스트를 선택했습니다. Ctrl+C 또는 ⌘C로 복사하세요.'); }
    });
    dialog.querySelector('[data-parse]').addEventListener('click', () => {
      invalidateImport();
      try { showImport(shareText.value); message('설정 형식을 확인했습니다. 적용할 내용을 확인하세요.'); }
      catch (error) { message(error.message, true); }
    });
    importButton.addEventListener('click', async () => {
      if (!pendingImport || shareBusy) return;
      const profile = ns.validateShareProfile(pendingImport);
      if (await onPatch(profile.settings, true)) { slots.forEach(slot => { slot.dirty = false; }); invalidateImport(); syncSlots(); message('공유 설정을 적용했습니다. 방문 기록은 유지했습니다.'); }
    });
    async function sharingRequest(type, body = {}) {
      const response = await api.runtime.sendMessage({ type, ...body });
      if (!response?.ok) throw new Error(response?.error || '공유 요청에 실패했습니다. 연결 상태를 확인하세요.');
      return response.data;
    }
    async function shareTask(button, action) {
      if (shareBusy) return;
      shareBusy = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
      try { await action(); }
      catch (error) { message(error.message || '공유 요청에 실패했습니다.', true); }
      finally { shareBusy = false; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
    const uploadButton = dialog.querySelector('[data-upload]');
    uploadButton.addEventListener('click', () => {
      if (!dialog.querySelector('[data-share-consent]').checked) { message('공유 범위와 서버 저장 안내를 확인하고 동의해 주세요.', true); return; }
      shareTask(uploadButton, async () => {
        const profile = createExport(); message('공유 코드를 만드는 중입니다.');
        const result = await sharingRequest('share.create', { profile });
        shareCode.value = result.code; sharePreview.textContent = `${ns.shareSummary(profile)} · ${new Date(result.expiresAt).toLocaleDateString()} 만료`;
        message(`공유 코드 ${result.code}를 만들었습니다. 30일 동안 사용할 수 있습니다.`); await renderOwned();
      });
    });
    const downloadButton = dialog.querySelector('[data-download]');
    dialog.querySelector('[data-copy-code]').addEventListener('click', async () => {
      try {
        const code = ns.normalizeShareCode(shareCode.value); shareCode.value = code;
        try { await navigator.clipboard.writeText(code); message('공유 코드를 복사했습니다.'); }
        catch { shareCode.focus(); shareCode.select(); message('코드를 선택했습니다. Ctrl+C 또는 ⌘C로 복사하세요.'); }
      } catch (error) { message(error.message, true); }
    });
    downloadButton.addEventListener('click', () => shareTask(downloadButton, async () => {
      invalidateImport(); const code = ns.normalizeShareCode(shareCode.value); shareCode.value = code;
      const result = await sharingRequest('share.get', { code }); showImport(result.profile);
      shareText.value = JSON.stringify(pendingImport); message('설정을 불러왔습니다. 아래 내용을 확인한 뒤 적용하세요.');
    }));
    async function renderOwned() {
      const result = await sharingRequest('share.owned'), list = dialog.querySelector('.owned-share-list');
      list.replaceChildren();
      for (const share of result.shares) {
        const row = document.createElement('div'); row.className = 'owned-share-row';
        const label = document.createElement('span'); label.textContent = `${share.code} · ${new Date(share.expiresAt).toLocaleDateString()}`;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = '서버에서 삭제';
        button.setAttribute('aria-label', `${share.code} 공유 삭제`);
        button.addEventListener('click', () => shareTask(button, async () => {
          await sharingRequest('share.delete', { code: share.code }); await renderOwned(); message(`${share.code} 공유를 삭제했습니다.`);
        }));
        row.append(label, button); list.append(row);
      }
      if (!result.shares.length) list.textContent = '이 기기에서 만든 유효한 코드가 없습니다.';
    }
    const ownedButton = dialog.querySelector('[data-owned]');
    ownedButton.addEventListener('click', () => shareTask(ownedButton, renderOwned));
    const shortcutList = dialog.querySelector('.shortcut-list');
    function stopShortcutCapture() {
      capturingShortcut = null;
      syncShortcuts();
    }
    async function saveShortcut(action, binding) {
      const conflict = ns.shortcutConflict(settings.shortcuts, binding, action);
      if (conflict) {
        message(`${ns.shortcutLabel(binding)}는 ${ACTIONS.find(([id]) => id === conflict)[1]}에 지정되어 있습니다. 먼저 해당 키를 해제하세요.`, true);
        return;
      }
      stopShortcutCapture();
      if (await onPatch({ shortcuts: { [action]: binding } }, true)) message(binding ? '단축키를 저장했습니다.' : '단축키를 해제했습니다.');
    }
    function syncShortcuts() {
      const actions = ACTIONS.filter(([id]) => !id.startsWith('custom') || Number(id.slice(6)) < settings.customSlotCount);
      const key = actions.map(([id]) => id).join('|');
      if (key !== shortcutEditorKey) {
        capturingShortcut = null; shortcutEditorKey = key; shortcutList.replaceChildren();
        for (const [action, label] of actions) {
          const row = document.createElement('div'); row.className = 'shortcut-row'; row.dataset.shortcut = action;
          const name = document.createElement('span'); name.className = 'shortcut-label'; name.textContent = label;
          const assign = document.createElement('button'); assign.type = 'button'; assign.className = 'shortcut-key'; assign.setAttribute('aria-label', `${label} 단축키 변경`);
          assign.addEventListener('click', () => { capturingShortcut = action; syncShortcuts(); message('사용할 키 조합을 누르세요. Esc로 취소합니다.'); });
          assign.addEventListener('blur', () => { if (capturingShortcut === action) stopShortcutCapture(); });
          assign.addEventListener('keydown', event => {
            if (capturingShortcut !== action) return;
            if (event.key === 'Tab') { stopShortcutCapture(); return; }
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Escape') { stopShortcutCapture(); message('단축키 변경을 취소했습니다.'); return; }
            if (event.repeat || event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph') ||
                ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
            const binding = ns.shortcutFromEvent(event), problem = ns.shortcutProblem(binding);
            if (problem) { message(problem, true); return; }
            saveShortcut(action, ns.normalizeShortcut(binding));
          });
          const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'shortcut-clear'; clear.textContent = '×';
          clear.setAttribute('aria-label', `${label} 단축키 해제`); clear.title = '단축키 해제';
          clear.addEventListener('click', () => saveShortcut(action, null));
          row.append(name, assign, clear); shortcutList.append(row);
        }
      }
      for (const [action, label] of actions) {
        const row = shortcutList.querySelector(`[data-shortcut="${action}"]`), button = row.querySelector('.shortcut-key');
        const slot = action.startsWith('custom') ? settings.customGalleries[Number(action.slice(6))] : null;
        row.querySelector('.shortcut-label').textContent = slot?.name || label;
        button.textContent = capturingShortcut === action ? '키를 누르세요…' : ns.shortcutLabel(settings.shortcuts[action]);
        button.dataset.recording = String(capturingShortcut === action);
        button.setAttribute('aria-pressed', String(capturingShortcut === action));
        row.querySelector('.shortcut-clear').disabled = !settings.shortcuts[action];
      }
    }
    dialog.querySelector('[data-reset-shortcuts]').addEventListener('click', async () => {
      stopShortcutCapture();
      if (await onPatch({ shortcuts: ns.DEFAULT_SHORTCUTS }, true)) message('기본 단축키로 되돌렸습니다.');
    });
    dialog.querySelector('[data-clear-shortcuts]').addEventListener('click', async () => {
      stopShortcutCapture();
      if (await onPatch({ shortcuts: Object.fromEntries(ns.BUTTON_IDS.map(id => [id, null])) }, true)) message('모든 단축키를 해제했습니다.');
    });
    dialog.querySelector('.shortcut-settings details').addEventListener('toggle', () => {
      if (!dialog.querySelector('.shortcut-settings details').open) stopShortcutCapture();
    });
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
            row.append(text);
            if (entry.startsWith('custom')) {
              const configure = document.createElement('button'); configure.type = 'button'; configure.className = 'layout-gallery-settings';
              configure.setAttribute('aria-label', `${label} 설정 열기`); configure.title = '갤러리 탭에서 설정';
              configure.setAttribute('aria-controls', 'dc-settings-panel-galleries');
              // Dedicated vector for this small control; do not shrink the raster toolbar atlas.
              configure.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4l.5 2.2 1.5.6 1.9-1.2 2.8 2.8-1.2 1.9.6 1.5L22 10v4l-2.2.5-.6 1.5 1.2 1.9-2.8 2.8-1.9-1.2-1.5.6L14 22h-4l-.5-2.2-1.5-.6-1.9 1.2-2.8-2.8 1.2-1.9-.6-1.5L2 14v-4l2.2-.5.6-1.5-1.2-1.9 2.8-2.8L8 4.8l1.5-.6L10 2Z"/><circle cx="12" cy="12" r="3.2"/></svg>';
              configure.addEventListener('click', () => {
                selectSettingsTab('galleries');
                const slot = slots[Number(entry.slice(6))];
                if (slot) {
                  slot.mode.focus({ preventScroll: true });
                  settingsBody.scrollTop += slot.node.getBoundingClientRect().top - settingsBody.getBoundingClientRect().top - 8;
                }
              });
              row.append(configure);
            } else {
              const state = document.createElement('span'); state.className = 'layout-state';
              state.textContent = entry === 'settings' ? '항상 표시' : ''; row.append(state);
            }
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
        <button type="button" class="text-button current-gallery" aria-label="커스텀 ${index + 1} 현재 갤러리 지정">현재 갤러리 지정</button>
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
      async function applySlot() {
        const address = mode.value === 'fixed' ? ns.galleryAddress(url.value.trim()) : null;
        if (mode.value === 'fixed' && !address) { message('일반·마이너·미니 갤러리의 PC 게시글 또는 목록 URL을 입력하세요.', true); url.focus(); return; }
        const custom = settings.customGalleries.map(item => ({ ...item }));
        if (entry.icon === 'emoji' && !ns.normalizeEmoji(emoji.value)) { message('이모지를 한 개 입력하거나 추천 이모지를 선택하세요.', true); emoji.focus(); return; }
        if (mode.value === 'previous') custom.forEach((item, i) => { if (i !== index && item.mode === 'previous') custom[i] = { ...item, mode: 'off' }; });
        custom[index] = { mode: mode.value, name: name.value, url: address?.url ?? (mode.value === 'off' ? url.value : ''), icon: entry.icon, emoji: emoji.value };
        if (await onPatch({ customGalleries: custom }, true)) { entry.dirty = false; syncSlots(); message('커스텀 갤러리를 저장했습니다.'); }
      }
      slot.querySelector('.apply-button').addEventListener('click', applySlot);
      slot.querySelector('.current-gallery').addEventListener('click', () => {
        const current = getCurrentGallery();
        if (!current) { message('갤러리 게시글이나 글 목록에서 지정할 수 있습니다.', true); return; }
        mode.value = 'fixed'; url.value = current.url; if (!name.value.trim()) name.value = current.name;
        entry.dirty = true; entry.showFields(); applySlot();
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
      syncShortcuts();
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
      const currentButton = entry.node.querySelector('.current-gallery');
      currentButton.disabled = !getCurrentGallery(); currentButton.title = currentButton.disabled ? '갤러리 게시글·글 목록에서 사용할 수 있습니다.' : '지금 보고 있는 갤러리를 바로 저장합니다.';
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
        const shortcut = settings.shortcuts[action];
        if (shortcut) {
          button.title += ` (${ns.shortcutLabel(shortcut)})`;
          button.setAttribute('aria-keyshortcuts', ns.shortcutLabel(shortcut, true));
        } else button.removeAttribute('aria-keyshortcuts');
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
      stopShortcutCapture();
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
      isSettingsOpen: () => !dialog.hidden,
      toggleSettings,
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
