import { chromium } from 'playwright';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path'; import os from 'node:os'; import assert from 'node:assert/strict';
const root = await mkdtemp(path.join(os.tmpdir(), 'fact-lens-tribal-forum-')), extension = path.join(root, 'extension');
await cp('dist', extension, { recursive: true });
const context = await chromium.launchPersistentContext(path.join(root, 'profile'), { headless: true, channel: 'chrome', ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
context.setDefaultTimeout(15000);
try {
  const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: extension });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const lead = 'Published forum introduction is visible text inside a structural form. It is already posted content, not an unsent message.';
  const end = 'The final published paragraph must survive extraction even without paragraph tags, after bold text and a quoted table.';
  const table = 'A published table cell contains the original quoted message and important qualifications. These are source passages, not editable fields.';
  const forum = `<meta charset="utf-8"><title>Synthetic game shell title</title><div id="menu_row">NAVIGATION_SECRET</div><table class="main"><tr><td id="content_value"><h2>Thread context heading</h2><form id="forum_post_list"><div class="post"><div class="postheader">Example author · synthetic date</div><div class="text">${lead}<br><br><b>Published qualification</b><br>${end}</div></div><div class="post"><div class="text"><table><tr><td>${table}</td></tr></table></div></div><input type="text" value="INPUT_SECRET"><input type="password" value="PASSWORD_SECRET"><input type="hidden" value="TOKEN_SECRET"><textarea>DRAFT_SECRET</textarea><div contenteditable>EDITABLE_SECRET</div><div role="textbox">ROLE_SECRET</div><div data-slate-editor>SLATE_SECRET</div><div hidden>HIDDEN_SECRET</div><button>BUTTON_SECRET</button><script type="text/plain">SCRIPT_SECRET</script></form><form id="reply"><label>Reply editor</label><textarea>UNSENT_REPLY_SECRET</textarea></form></td></tr></table><footer>FOOTER_SECRET</footer>`;
  await context.route('https://en999.tribalwars.net/game.php**', route => route.fulfill({ body: forum, contentType: 'text/html' }));
  await context.route('https://ordinary.test/**', route => route.fulfill({ body: `<meta charset="utf-8"><article><p>${lead} ${end}</p><form id="forum_post_list"><p>STATIC_FORM_CONTENT: This is visible read-only source text, not an editable draft.</p><textarea>DRAFT_SECRET</textarea></form></article>`, contentType: 'text/html' }));
  // Same contents, unrelated hosts and arbitrary container IDs/classes.
  const arbitrary = forum.replaceAll('forum_post_list','layout_73').replaceAll('content_value','column_29').replaceAll('class="post"','class="segment"').replaceAll('class="text"','class="copy"');
  await context.route('https://unknown-layout.test/**', route => route.fulfill({body:arbitrary,contentType:'text/html'}));
  await context.route('https://table-layout.test/**', route => route.fulfill({body:arbitrary.replaceAll('<form','<div').replaceAll('</form>','</div>'),contentType:'text/html'}));
  const page = await context.newPage();
  const extract = async url => {
    await page.goto(url);
    return worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] }))[0].result; }, url);
  };
  const url = 'https://en999.tribalwars.net/game.php?screen=forum&screenmode=view_thread&thread_id=1';
  const result = await extract(url);
  assert.equal(result.extractionError, undefined); assert.ok(result.text.includes(lead)); assert.ok(result.text.includes(end)); assert.ok(result.text.includes(table));
  assert.ok(!/SECRET/.test(JSON.stringify(result))); assert.equal(await page.locator('#forum_post_list p').count(), 0);
  assert.ok(result.context.some(block => block.kind === 'headline' && block.text.includes('Thread context heading')));
  assert.ok(result.locations.length >= 3);
  for (const location of result.locations) assert.equal(await page.locator(`[data-fact-lens-node="${location.locationId}"]`).count(), 1);
  // The revision tracks the published post list, not changing resources or timers.
  await page.locator('#menu_row').evaluate(node => { node.textContent = 'Changed navigation'; });
  const navigationOnly = await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] }))[0].result; }, url);
  assert.deepEqual(navigationOnly.pageRevision, result.pageRevision);
  await page.locator('#forum_post_list .text').first().evaluate(node => node.append(' New published sentence.'));
  const changed = await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] }))[0].result; }, url);
  assert.notEqual(changed.pageRevision.fingerprint, result.pageRevision.fingerprint);
  const ordinary = await extract('https://ordinary.test/article'); assert.ok(ordinary.text.includes(lead)); assert.ok(!/SECRET/.test(JSON.stringify(ordinary)));assert.ok(ordinary.text.includes('STATIC_FORM_CONTENT'));
  for (const host of ['unknown-layout.test','table-layout.test']) { const extracted = await extract(`https://${host}/thread`); assert.equal(extracted.extractionError,undefined); assert.ok(extracted.text.includes(lead)); assert.ok(extracted.text.includes(end)); assert.ok(extracted.text.includes(table)); assert.ok(!/SECRET/.test(JSON.stringify(extracted))); }
  console.log('PASS Tribal Wars structural FORM and zero-P paragraphs: all published posts/quoted table, thread heading and source locations; input/password/hidden token/draft/editable fields excluded; same rules work with arbitrary form/container IDs, div wrappers and unrelated hosts; revision ignores changing game shell and detects published content.');
  console.log('Browser:', context.browser().version(), 'Synthetic forum only; no personal profile, private forum messages or OpenAI calls.');
} finally {
  await context.close();
  if (root.startsWith(path.join(os.tmpdir(), 'fact-lens-tribal-forum-'))) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}
