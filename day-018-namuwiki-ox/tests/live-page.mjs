// Read-only production page check. No ChatGPT request, credentials or user data.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {extractArticle} from '../extension/extract.js';
import {validateArticle} from '../extension/shared/quiz.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  const response=await page.goto('https://namu.wiki/w/%EA%B3%A0%EC%96%91%EC%9D%B4',{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('h2 a[id="s-1"],.wiki-content').first().waitFor({timeout:15000});
  const article=await page.evaluate(extractArticle);validateArticle(article);
  assert.equal(response.status(),200);assert.equal(article.title,'고양이');
  assert.ok(article.blocks.length>10);assert.ok(article.chars<=60000);
  assert.ok(!article.blocks.some(b=>/최근 변경|이 저작물은 CC BY|This site is protected/.test(b.text)));
  console.log(JSON.stringify({result:'PASS',page:'live NamuWiki 고양이',title:article.title,extractor:article.extractor,blocks:article.blocks.length,chars:article.chars,truncated:article.truncated,providerRequests:0},null,2));
}finally{await browser.close();}
