export function unsupportedPage(url) {
  try {
    const page = new URL(url);
    return !['http:', 'https:'].includes(page.protocol) || page.hostname === 'chromewebstore.google.com' ||
      (page.hostname === 'chrome.google.com' && page.pathname.startsWith('/webstore')) || /\.pdf$/i.test(page.pathname);
  } catch { return false; }
}
export const UNSUPPORTED_PAGE = '이 페이지는 본문을 읽을 수 없습니다. Chrome 내부 페이지·Chrome 웹 스토어·PDF 대신 일반 웹 기사나 문서를 열어 주세요.';
export function injectionFailure(error) {
  const message = String(error?.message || '');
  if (/permission|Cannot access|cannot be scripted|Extensions gallery/i.test(message)) {
    return '사이트 접근이 허용되지 않았습니다. Chrome 확장 관리 → 팩트렌즈 → 세부정보 → 사이트 액세스를 ‘모든 사이트에서’로 설정한 뒤 페이지를 새로고침해 주세요.';
  }
  if (/No tab|No frame|frame was removed|tab was closed/i.test(message)) return '페이지가 닫혔거나 이동 중입니다. 페이지 로딩 후 다시 읽어 주세요.';
  return '페이지에 본문 읽기 스크립트를 실행하지 못했습니다. 확장과 페이지를 새로고침한 뒤 다시 시도해 주세요.';
}
export function extractionFailure(code) {
  if (code === 'too_large') return '페이지 구조가 너무 커서 본문을 추출하지 못했습니다. 더 짧은 기사·문서 페이지를 열어 주세요.';
  if (code === 'no_article') return '읽을 수 있는 본문을 찾지 못했습니다. 충분한 분량의 기사·문서 페이지를 열어 주세요.';
  return '페이지 본문 처리 중 오류가 발생했습니다. 페이지 로딩 후 다시 읽어 주세요.';
}
