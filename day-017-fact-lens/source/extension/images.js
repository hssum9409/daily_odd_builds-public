import { dcinsideImage } from '../shared/dcinside.mjs';
import { rasterMime } from '../shared/image-format.mjs';
const LIMIT = 5 * 1024 * 1024;
const MIME = /^image\/(png|jpeg|webp|gif)$/;
export async function imageBlob(src, signal) {
  signal.throwIfAborted();
  if (/^data:/i.test(src)) {
    const match = src.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match || match[2].length > LIMIT * 4 / 3 + 8) throw Error('지원하지 않는 이미지 형식 또는 크기입니다.');
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    if (bytes.length > LIMIT) throw Error('이미지가 5MB를 초과합니다.');
    return new Blob([bytes], { type: match[1].toLowerCase() });
  }
  const url = new URL(src);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('지원하지 않는 이미지 주소입니다.');
  const response = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal });
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok) { await response.body?.cancel(); throw Error('이미지 파일을 읽을 수 없습니다.'); }
  if (Number(response.headers.get('content-length')) > LIMIT) { await response.body?.cancel(); throw Error('이미지가 5MB를 초과합니다.'); }
  const reader = response.body?.getReader(); if (!reader) throw Error('이미지 파일이 비어 있습니다.');
  let size = 0; const chunks = [];
  try { while (true) {
    signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > LIMIT) throw Error('이미지가 5MB를 초과합니다.'); chunks.push(value);
  } } finally { await reader.cancel().catch(() => {}); }
  let imageType = type;
  if (!MIME.test(imageType || '')) {
    const generic = !imageType || ['application/octet-stream', 'binary/octet-stream', 'application/binary'].includes(imageType);
    const prefix = new Uint8Array(Math.min(size, 12)); let offset = 0;
    for (const chunk of chunks) { const count = Math.min(chunk.length, prefix.length - offset); prefix.set(chunk.subarray(0, count), offset); offset += count; if (offset === prefix.length) break; }
    imageType = generic ? rasterMime(prefix) : null;
    if (!imageType) throw Error('이미지 파일 형식을 확인할 수 없습니다.');
  }
  return new Blob(chunks, { type: imageType });
}
export async function prepareImages(images, signal) {
  const loaded = [], warnings = []; let next = 0, dcReady = true;
  if (images.some(image => dcinsideImage(image.src))) {
    try { const result = await chrome.runtime.sendMessage({ type: 'images.prepare' }); if (!result?.ok) throw Error('Image headers unavailable'); }
    catch { dcReady = false; }
  }
  const workers = await Promise.allSettled(Array.from({ length: Math.min(2, images.length) }, async () => {
    while (next < images.length) {
      signal.throwIfAborted(); const image = images[next++];
      try {
        if (dcinsideImage(image.src) && !dcReady) throw Error('Image headers unavailable');
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
        const blob = await imageBlob(image.src, requestSignal);
        const bitmap = await createImageBitmap(blob);
        try {
          if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw Error('이미지 해상도가 너무 큽니다.');
          const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', .88);
          if (dataUrl.length > 3000000) throw Error('변환한 이미지가 너무 큽니다.');
          loaded.push({ id: image.id, locationId: image.locationId, kind: image.kind, alt: image.alt, caption: image.caption, dataUrl });
        } finally { bitmap.close(); }
      } catch (error) { signal.throwIfAborted(); warnings.push(`${image.id}: 이미지를 읽지 못했습니다. 로그인·접근 제한 또는 형식·크기 제한을 확인하세요.`); }
    }
  }));
  signal.throwIfAborted();
  const failed = workers.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
  loaded.sort((a, b) => images.findIndex(image => image.id === a.id) - images.findIndex(image => image.id === b.id));
  return { loaded, warnings };
}
