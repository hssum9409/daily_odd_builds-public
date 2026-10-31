async function setupStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
import { ChatGPTConnection, validateCallback } from './connection.js';
import { BackgroundRenewal, RENEWAL_ALARM } from './renewal.js';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.action.onClicked.addListener(tab => { if (tab.id) void chrome.storage.session.set({ sourceTabId: tab.id }); });
const connection = new ChatGPTConnection();
const renewal = new BackgroundRenewal(connection);
let ready, queue = Promise.resolve(), handling = false;
function enqueue(action) {
  const result = queue.then(() => ready ||= setupStorage().catch(error => { ready = undefined; throw error; })).then(action);
  queue = result.catch(() => {}); return result;
}
const notify = () => chrome.runtime.sendMessage({ type: 'auth.changed' }).catch(() => {});
const restore = () => enqueue(() => renewal.sync()).catch(() => {});
async function status() {
  const value = await connection.status();
  const { oauthError, oauthDiagnostic } = await chrome.storage.session.get(['oauthError', 'oauthDiagnostic']);
  return { connected: !!value.account, sharing: !!value.account?.canGenerate, email: value.account?.name || '',
    pending: value.pending, error: oauthError || '', diagnostic: oauthDiagnostic || null };
}
async function clearPending(closeTab = false) {
  const { pending } = await chrome.storage.session.get('pending');
  await chrome.storage.session.remove(['pending', 'oauthDiagnostic']);
  await chrome.alarms.clear('oauth-timeout');
  if (closeTab && pending?.tabId) await chrome.tabs.remove(pending.tabId).catch(() => {});
}
async function begin() {
  const attempt = await connection.begin();
  try {
    await clearPending(true); await chrome.storage.session.remove('oauthError');
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('auth-result.html'), active: true });
    await chrome.storage.session.set({ pending: { tabId: tab.id, state: attempt.state, redirectUri: attempt.redirectUri,
      clientId: attempt.clientId, expires: attempt.expires } });
    await chrome.alarms.create('oauth-timeout', { when: attempt.expires });
    await chrome.tabs.update(tab.id, { url: attempt.url }); await notify();
  } catch {
    await connection.cancel(); await clearPending(true); throw Error('로그인 탭을 열지 못했습니다. 다시 시도해 주세요.');
  }
}
async function cancel(message = '로그인을 취소했습니다.') {
  await connection.cancel(); await clearPending(true);
  await chrome.storage.session.set({ oauthError: message }); await notify();
}
async function logout() {
  await clearPending(true);
  const result = await connection.disconnect();
  const saved = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(saved).filter(key => key.startsWith('quiz-window-')));
  await chrome.storage.session.remove('oauthError'); await notify(); return result;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !['sidepanel.html', 'auth-result.html'].some(path => sender.url === chrome.runtime.getURL(path))) return;
  const actions = { 'auth.status': status, 'auth.login': begin, 'auth.cancel': cancel, 'auth.logout': logout,
    'auth.token': async () => {
      try { return await connection.accessToken(); }
      catch (error) { await renewal.failed().catch(() => {}); if (!connection.account) await notify(); throw error; }
    } };
  if (!Object.hasOwn(actions, message?.type)) return;
  enqueue(async () => { try { return await actions[message.type](); } finally { await renewal.sync().catch(() => {}); } })
    .then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.type !== 'main_frame' || handling) return;
  void (async () => {
    const { pending } = await chrome.storage.session.get('pending');
    const callback = validateCallback(details.url, pending, details.tabId);
    if (!callback || handling) return;
    handling = true;
    try {
      await clearPending();
      await chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('auth-result.html') }).catch(() => {});
      await enqueue(async () => {
        try {
          await connection.finish({ state: pending.state, ...callback });
          await chrome.storage.session.remove('oauthError');
        } catch (error) { await chrome.storage.session.set({ oauthError: error.message }); }
        finally { await renewal.sync().catch(() => {}); await notify(); }
      });
    } finally { handling = false; }
  })().catch(() => {});
}, { urls: ['http://127.0.0.1/*'], types: ['main_frame'] });
// Diagnostics contain only HTTP status/MIME/stage, never body, query, cookie or tokens.
chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.type !== 'xmlhttprequest' && !(details.type === 'main_frame' && details.statusCode >= 400)) return;
  const url = new URL(details.url);
  if (url.origin !== 'https://auth.openai.com' || !url.pathname.startsWith('/api/accounts/')) return;
  const mime = (details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-type')?.value || '').split(';')[0].trim().toLowerCase();
  if (mime !== 'text/html' && details.statusCode < 500) return;
  void enqueue(async () => {
    const { pending } = await chrome.storage.session.get('pending');
    if (!pending || pending.tabId !== details.tabId || pending.expires < Date.now()) return;
    await chrome.storage.session.set({ oauthDiagnostic: { stage: 'provider-login-page', status: details.statusCode, contentType: mime },
      oauthError: `OpenAI 로그인 페이지가 ${mime === 'text/html' ? 'HTML로 응답했습니다' : '요청에 실패했습니다'} (HTTP ${details.statusCode}). 토큰 교환 전 단계입니다. 로그인 탭을 확인하거나 취소 후 다시 시도해 주세요.` });
    await notify();
  }).catch(() => {});
}, { urls: ['https://auth.openai.com/api/accounts/*'], types: ['xmlhttprequest', 'main_frame'] }, ['responseHeaders']);
chrome.tabs.onRemoved.addListener(tabId => {
  void enqueue(async () => {
    const { pending } = await chrome.storage.session.get('pending');
    if (pending?.tabId === tabId) await cancel('로그인 탭을 닫았습니다.');
  }).catch(() => {});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'oauth-timeout') void enqueue(async () => {
    const { pending } = await chrome.storage.session.get('pending');
    if (pending && pending.expires <= Date.now()) await cancel('로그인 요청이 만료됐습니다. 다시 연결해 주세요.');
  }).catch(() => {});
  if (alarm.name === RENEWAL_ALARM) void enqueue(async () => {
    const connected = !!connection.account; await connection.status();
    await renewal.tick(); if (connected && !connection.account) await notify();
  }).catch(restore);
});
chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
chrome.windows.onCreated.addListener(restore);
chrome.windows.onRemoved.addListener(restore);
chrome.windows.onRemoved.addListener(id => { void chrome.storage.session.remove(`quiz-window-${id}`).catch(() => {}); });
restore();
