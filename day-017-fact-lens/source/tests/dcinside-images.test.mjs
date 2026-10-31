import test from 'node:test';
import assert from 'node:assert/strict';
import { dcinsidePage, dcinsideImage, dcinsideImageRule } from '../shared/dcinside.mjs';
import { rasterMime } from '../shared/image-format.mjs';
import { imageBlob } from '../extension/images.js';
test('DC image compatibility is limited to known endpoints and this extension initiator', () => {
  assert.ok(dcinsidePage('https://gall.dcinside.com/mgallery/board/view/?id=test'));
  assert.ok(dcinsidePage('https://m.dcinside.com/board/test/1'));
  for (const host of ['dcimg8.dcinside.co.kr','dccdn11.dcinside.co.kr','dcimg5.dcinside.com']) assert.ok(dcinsideImage(`https://${host}/viewimage.php?id=test`));
  for (const url of ['https://dcimg8.dcinside.co.kr.evil.test/viewimage.php','https://evil.test/viewimage.php?id=dcimg8.dcinside.co.kr','https://dcimg8.dcinside.co.kr/login','https://user:pass@dcimg8.dcinside.co.kr/viewimage.php','http://dcimg8.dcinside.co.kr/viewimage.php']) assert.equal(dcinsideImage(url),false);
  assert.equal(dcinsidePage('https://gall.dcinside.com.evil.test/'),false);
  const rule = dcinsideImageRule('own-extension');
  assert.deepEqual(rule.condition.initiatorDomains,['own-extension']); assert.deepEqual(rule.condition.resourceTypes,['xmlhttprequest','image']);
  assert.deepEqual(rule.action.requestHeaders,[{header:'Referer',operation:'set',value:'https://gall.dcinside.com/'}]);
  assert.equal(rule.action.responseHeaders,undefined);
});
test('generic binary content requires raster magic and never admits HTML, SVG or unknown bytes', async () => {
  const cases = [
    [[137,80,78,71,13,10,26,10], 'image/png'], [[255,216,255,224], 'image/jpeg'],
    [[...Buffer.from('GIF89a')], 'image/gif'], [[...Buffer.from('RIFFabcdWEBP')], 'image/webp'],
  ];
  for (const [bytes, expected] of cases) {
    assert.equal(rasterMime(Uint8Array.from(bytes)),expected);
    // Deliberately split every byte: a stream chunk need not hold the signature.
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { for (const value of bytes) controller.enqueue(Uint8Array.of(value)); controller.close(); } }), { headers: {'content-type':'application/octet-stream'} });
    assert.equal((await imageBlob('https://images.example/file',new AbortController().signal)).type,expected);
  }
  for (const value of ['<html>not an image</html>','<svg xmlns="http://www.w3.org/2000/svg"/>','unknown','']) {
    assert.equal(rasterMime(Buffer.from(value)),null);
    globalThis.fetch = async () => new Response(value,{headers:{'content-type':'application/octet-stream'}});
    await assert.rejects(imageBlob('https://images.example/file',new AbortController().signal),/이미지 파일/);
  }
  globalThis.fetch = async () => new Response(Uint8Array.from([255,216,255]),{headers:{'content-type':'text/html'}});
  await assert.rejects(imageBlob('https://images.example/file',new AbortController().signal),/이미지 파일/);
});
