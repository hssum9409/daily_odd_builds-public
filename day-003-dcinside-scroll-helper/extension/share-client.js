(() => {
  'use strict';
  const ns = globalThis.DCScrollHelper;
  const SHARE_API_URL = 'https://asia-northeast3-daily-odd-builds-portal.cloudfunctions.net/dcScrollShare';
  const OWN_SHARES_KEY = 'dcScrollOwnedShares';
  async function shareRequest(message, api, fetcher = fetch) {
    let body;
    if (message.type === 'share.create') body = { operation: 'create', profile: ns.validateShareProfile(message.profile) };
    else if (message.type === 'share.get') body = { operation: 'get', code: ns.normalizeShareCode(message.code) };
    else if (message.type === 'share.delete') {
      const code = ns.normalizeShareCode(message.code);
      const data = await api.storage.local.get(OWN_SHARES_KEY);
      const owned = (Array.isArray(data[OWN_SHARES_KEY]) ? data[OWN_SHARES_KEY] : []).find(item => item.code === code);
      if (!owned || !/^[a-f0-9]{64}$/.test(owned.deleteToken)) throw new Error('이 기기에서 만든 공유 코드만 삭제할 수 있습니다.');
      body = { operation: 'delete', code, deleteToken: owned.deleteToken };
    } else throw new Error('지원하지 않는 공유 작업입니다.');
    const response = await fetcher(SHARE_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (Number(response.headers.get('content-length')) > 100000) throw new Error('공유 응답이 너무 큽니다.');
    const text = await response.text();
    if (text.length > 100000) throw new Error('공유 응답이 너무 큽니다.');
    let result;
    try { result = JSON.parse(text); } catch { throw new Error('공유 서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'); }
    if (!response.ok) throw new Error(({ 400: '공유 코드나 설정 형식을 확인하세요.', 404: '없거나 만료·삭제된 공유 코드입니다.',
      403: '이 공유 코드를 삭제할 권한이 없습니다.', 429: '요청이 많습니다. 잠시 후 다시 시도하세요.' })[response.status] || '공유 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');
    if (message.type === 'share.get') return { profile: ns.validateShareProfile(result.profile) };
    if (message.type === 'share.create') {
      const code = ns.normalizeShareCode(result.code);
      if (!/^[a-f0-9]{64}$/.test(result.deleteToken) || !Number.isFinite(result.expiresAt)) throw new Error('공유 서버 응답 형식이 올바르지 않습니다.');
      // Serialize these calls in the worker, so different tabs cannot lose deletion keys.
      const data = await api.storage.local.get(OWN_SHARES_KEY);
      const previous = (Array.isArray(data[OWN_SHARES_KEY]) ? data[OWN_SHARES_KEY] : [])
        .filter(item => item.expiresAt > Date.now() && item.code !== code);
      try {
        await api.storage.local.set({ [OWN_SHARES_KEY]: [...previous, { code, deleteToken: result.deleteToken, expiresAt: result.expiresAt }] });
      } catch {
        // If local ownership cannot be saved, compensate rather than silently lose deletion access.
        let removed = false;
        try {
          removed = (await fetcher(SHARE_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation: 'delete', code, deleteToken: result.deleteToken }), credentials: 'omit',
            redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store' })).ok;
        } catch { /* The 30-day expiry still applies if the network is unavailable. */ }
        throw new Error(removed ? '삭제 키를 기기에 저장하지 못해 서버 공유를 취소했습니다. 저장 공간을 확인하세요.'
          : `공유 코드 ${code}의 삭제 키를 저장하지 못했습니다. 삭제가 필요하면 지원처에 문의하세요. 공유는 30일 후 만료됩니다.`);
      }
      return { code, expiresAt: result.expiresAt };
    }
    const data = await api.storage.local.get(OWN_SHARES_KEY);
    await api.storage.local.set({ [OWN_SHARES_KEY]: (Array.isArray(data[OWN_SHARES_KEY]) ? data[OWN_SHARES_KEY] : []).filter(item => item.code !== body.code) });
    return { deleted: true };
  }
  Object.assign(ns, { SHARE_API_URL, OWN_SHARES_KEY, shareRequest });
})();
