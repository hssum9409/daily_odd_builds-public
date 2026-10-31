import { credentialStore, validSession } from './credentials.js';
import { REFRESH_LIFETIME } from './connection.js';

// Migrate this extension's own 0.1.0 session; never read another app's tokens.
export async function setupStorage(store = credentialStore) {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const saved = await chrome.storage.local.get(['registration', 'chatgptClientId']);
  if (!saved.chatgptClientId && saved.registration?.clientId) await chrome.storage.local.set({ chatgptClientId: saved.registration.clientId });
  if (!saved.chatgptClientId && saved.registration?.subject) await chrome.storage.local.set({ chatgptSubject: saved.registration.subject });
  const old = await chrome.storage.session.get(['account', 'authError', 'pending', 'chatgptAttempt']);
  if (old.account) {
    const account = old.account;
    const migrated = { accessToken: account.accessToken, refreshToken: account.refreshToken, clientId: account.clientId,
      expires: account.expiresAt, refreshExpires: account.refreshToken ? account.expiresAt - 3600000 + REFRESH_LIFETIME : undefined,
      subject: account.subject, name: account.email || 'ChatGPT 연결됨', scopes: account.scopes };
    if (validSession(migrated)) {
      // A failed durable write leaves the old record available for a retry.
      if (!await store.read()) await store.write(migrated);
    } else await chrome.storage.session.set({ oauthError: '이전 연결 정보를 읽지 못했습니다. 다시 연결해 주세요.' });
    await chrome.storage.session.remove('account');
  }
  if (old.authError) await chrome.storage.session.set({ oauthError: old.authError });
  await chrome.storage.session.remove('authError');
  if (old.pending && !old.chatgptAttempt) {
    const pending = old.pending;
    if (!pending.processing && pending.createdAt + 600000 > Date.now()) {
      const attempt = { ...pending, redirectUri: 'http://127.0.0.1:14557/auth/callback', expires: pending.createdAt + 600000 };
      await chrome.storage.session.set({ chatgptAttempt: attempt, pending: { tabId: pending.tabId, state: pending.state,
        redirectUri: attempt.redirectUri, clientId: pending.clientId, expires: attempt.expires } });
    } else {
      await chrome.storage.session.remove('pending');
      await chrome.storage.session.set({ oauthError: '이전 로그인 요청이 만료됐습니다. 다시 연결해 주세요.' });
    }
  }
}
