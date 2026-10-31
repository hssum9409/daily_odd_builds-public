import test from 'node:test';import assert from 'node:assert/strict';
import {exactQuote,sourceBlocks,validateAnalysis,pageAnalysisSchema} from '../shared/analysis.mjs';
import {analysisFixture} from './analysis-fixture.mjs';import {requestStructured} from '../extension/provider.js';
const text='독립적인 원문 주장에 관한 충분한 문장입니다. 숫자 4%와 부정 표현이 바뀌면 안 됩니다.';
const article={title:'검증 문서 제목',text,url:'https://article.example/'};const blocks=sourceBlocks(article);
const plan=()=>analysisFixture([{claim:'원문의 의미를 요약한 주장',quote:text,origin:'body'}],{sourceBlocks:blocks});
test('typography-only quote recovery preserves original Unicode and rejects factual/punctuation edits',()=>{
 const original='“가나다”와 e\u0301 문구에\u200b 4%라고 썼다.';assert.equal(exactQuote(original,'"가나다"와 é 문구에 4%라고 썼다.'),original);
 for(const q of ['“가나다”와 é 문구에 5%라고 썼다.','“가나다”와 é 문구에 4%라고 쓰지 않았다.'])assert.equal(exactQuote(original,q),null);
});
test('unique verbatim quotes repair source id aliases, repeated coverage and missing quoted links without dropping blocks',()=>{
 const data=plan();data.claims[0].aspects[0].sourceId='wrong-id';data.coverage.find(b=>b.sourceId==='body-1').sourceId='wrong-id';data.coverage.push({...data.coverage[0]});
 let result=validateAnalysis(data,article,blocks);assert.equal(result.claims[0].aspects[0].sourceId,'body-1');assert.equal(result.coverage.length,blocks.length);assert.ok(result.mappingRepairs>0);
 const missing=plan();missing.coverage=missing.coverage.filter(b=>b.sourceId!=='body-1');result=validateAnalysis(missing,article,blocks);assert.deepEqual(result.coverage.find(b=>b.sourceId==='body-1').groupIds,['topic-1']);
});
test('missing unquoted context and nonunique quote origins remain explicit failures',()=>{
 const data=plan();data.coverage.shift();assert.throws(()=>validateAnalysis(data,article,blocks),e=>e.code==='coverage_missing'&&e.validationCounts.missingBlocks===1&&e.repairSourceIds[0]==='context-1');
 const repeated={...article,text:text+'\n\n'+text},sections=sourceBlocks(repeated),p=analysisFixture([{claim:'같은 문장',quote:text,origin:'body'}],{sourceBlocks:sections});p.claims[0].aspects[0].sourceId='missing';assert.throws(()=>validateAnalysis(p,repeated,sections),e=>e.code==='quote_ambiguous');
});
function setup(choose){const requests=[],diagnostics=[];globalThis.chrome={runtime:{async sendMessage(){return {ok:true,data:'QA_ONLY'};}},storage:{session:{async set(v){diagnostics.push(v);}}}};globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);requests.push(body);const value=choose(requests.length);const completed={status:'completed',text:{format:{type:'json_schema'}},output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]};return new Response(`data: ${JSON.stringify({type:'response.completed',response:completed})}\n\n`,{headers:{'content-type':''}});};return {requests,diagnostics};}
test('terra/SSE semantic failure records real text length and specific cause without leaking content; no model/tier substitution',async()=>{
 const {requests,diagnostics}=setup(()=>{const p=plan();p.coverage.shift();return p;});
 await assert.rejects(requestStructured('gpt-6.1-terra','Analyze entire page',JSON.stringify({sourceBlocks:blocks}),pageAnalysisSchema,false,new AbortController().signal,'전체 맥락 분석',{validate:v=>validateAnalysis(v,article,blocks)}),e=>e.diagnostic.validationCode==='coverage_missing'&&e.diagnostic.textLength>0&&e.diagnostic.transport==='sse-header-mismatch');
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.model==='gpt-6.1-terra'&&r.service_tier==='priority'));assert.ok(requests[1].instructions.includes('context-1'));assert.ok(requests[1].instructions.includes('coverage_missing'));assert.ok(!JSON.stringify(diagnostics).includes(text));assert.ok(!JSON.stringify(diagnostics).includes('QA_ONLY'));
});
test('specific repair feedback recovers the next response and retains complete coverage',async()=>{
 const {requests}=setup(n=>{const p=plan();if(n===1)p.coverage.shift();return p;});const result=await requestStructured('gpt-6.1-terra','Analyze',JSON.stringify({sourceBlocks:blocks}),pageAnalysisSchema,false,new AbortController().signal,'전체 맥락 분석',{validate:v=>validateAnalysis(v,article,blocks)});assert.equal(requests.length,2);assert.equal(result.validated.coverage.length,blocks.length);
});
