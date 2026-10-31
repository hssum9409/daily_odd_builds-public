import test from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedPage, injectionFailure, extractionFailure } from '../shared/page-access.mjs';
test('ordinary sites are supported, browser/store/PDF pages are distinguished', () => {
  for (const url of ['https://news.example/article', 'http://example.test/post?a=1', 'https://example.test/file.pdf.html']) assert.equal(unsupportedPage(url), false);
  for (const url of ['chrome://extensions', 'chrome-extension://abc/panel.html', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x', 'https://example.com/paper.PDF?q=1']) assert.equal(unsupportedPage(url), true);
});
test('injection errors distinguish permissions, closed tabs and runtime failures without exposing URL', () => {
  assert.match(injectionFailure(Error('Cannot access contents of url https://private.test/?secret=hidden. Extension manifest must request permission')), /모든 사이트에서/);
  assert.ok(!injectionFailure(Error('Cannot access https://private.test/?secret=hidden')).includes('secret'));
  assert.match(injectionFailure(Error('No tab with id: 123')), /닫혔거나/);
  assert.match(injectionFailure(Error('Unexpected parser failure')), /실행하지 못했/);
  assert.ok(!injectionFailure(Error('Unexpected parser failure')).includes('권한'));
});
test('extraction errors do not masquerade as missing permissions', () => {
  assert.match(extractionFailure('no_article'), /본문을 찾지/);
  assert.match(extractionFailure('too_large'), /너무 커서/);
  for (const code of ['no_article', 'too_large', 'failed']) assert.ok(!extractionFailure(code).includes('권한'));
});
