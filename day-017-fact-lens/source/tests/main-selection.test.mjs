import test from 'node:test';import assert from 'node:assert/strict';import {checkArticle} from '../extension/provider.js';import {analysisFixture,verdictFixture} from './analysis-fixture.mjs';
test('select eight central propositions from the original page; nineteen peripheral factual blocks are considered but not promoted or searched',async()=>{
 const main=Array.from({length:8},(_,i)=>({claim:`핵심 사업 ${i+1}의 성과가 주요 논점이다.`,quote:`핵심 사업 ${i+1}은 중요한 성과와 영향을 보고했다.`,origin:'body'}));
 const peripheral=Array.from({length:19},(_,i)=>`주변 정보 ${i+1}: 행사 배경에 등장하는 별도 날짜와 장소의 사실이다.`);
 const article={title:'여덟 가지 핵심 사업과 주변 정보가 있는 합성 원문',url:'https://article.example/',text:[...main.map(c=>c.quote),...peripheral].join('\n\n')};const requests=[];
 globalThis.chrome={runtime:{async sendMessage(){return{ok:true,data:'QA'};}},storage:{session:{async set(){}}}};
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body),input=JSON.parse(body.input[0].content);requests.push(body);let value,search=[];
  if(!body.tools){assert.equal(body.text.format.name,'page_analysis');assert.equal(body.text.format.schema.properties.claims.maxItems,8);assert.ok(body.instructions.includes('SELECT MAIN CLAIMS FIRST'));assert.ok(body.instructions.includes('Do NOT enumerate every atomic fact'));value=analysisFixture(main,input);value.coverage.forEach(item=>{if(input.sourceBlocks.find(b=>b.id===item.sourceId).text.startsWith('주변 정보'))item.role='not_selected';});}
  else{assert.ok(!JSON.stringify(input.relatedPassages).includes('주변 정보'));const url='https://evidence.example/core';search=[{type:'web_search_call',status:'completed',action:{sources:[{url}]}}];value=verdictFixture({verdict:'supported',reason:'핵심 논점의 근거를 확인했다.',explanation:'선정된 핵심 논점을 확인했다.',caveat:'',sources:[{url,relation:'supports',evidence:'합성 근거'}]},input);}
  return Response.json({status:'completed',output:[...search,{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 };
 const report=await checkArticle(article,'main-selection',new AbortController().signal,()=>{},{maxClaims:8});
 assert.equal(report.claims.length,8);assert.equal(report.selectionStats.notSelectedBlocks,19);assert.equal(report.coverage.length,28);assert.equal(requests.length,9);assert.ok(report.claims.every(c=>c.verdict==='supported'));
});
