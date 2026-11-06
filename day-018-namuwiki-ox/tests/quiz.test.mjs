import test from 'node:test';
import assert from 'node:assert/strict';
import {questionCount,isArticleUrl,validateQuiz,validateArticle,score,DEFAULT_MODEL} from '../extension/shared/quiz.mjs';
import {request,generateQuiz} from '../extension/provider.js';
const blocks=Array.from({length:20},(_,i)=>({id:`b${i+1}`,section:'특징',text:`${i+1}번 시험 동물의 털은 흰색이다. 이 문장은 본문에 근거한 OX 문항을 검증하기 위한 합성 자료이다.`}));
const article={url:'https://namu.wiki/w/합성검사',title:'합성검사',blocks};
const fixture=n=>({questions:blocks.slice(0,n).map((b,i)=>({statement:`${i+1}번 시험 동물의 털은 ${i%2?'검은색':'흰색'}이다.`,answer:i%2===0,sourceId:b.id,quote:b.text,explanation:'본문은 털이 흰색이라고 설명한다.',correction:i%2?'털은 흰색이다.':''}))});
test('count bounds and exact site allowlist',()=>{
  for(const n of [5,10,20,'5'])assert.equal(questionCount(n),Number(n));
  for(const n of [0,4,21,5.5,'bad',undefined])assert.equal(questionCount(n),10);
  assert.equal(DEFAULT_MODEL,'gpt-6.1-terra');
  for(const url of ['https://namu.wiki.evil.test/w/a','https://evil@namu.wiki/w/a','http://namu.wiki/w/a','https://namu.wiki/edit/a','https://namu.wiki/w/'])assert.equal(isArticleUrl(url),false);
  assert.ok(isArticleUrl(article.url));assert.equal(validateArticle(article),article);
});
test('exact requested count, genuine quote and corrections required',()=>{
  assert.equal(validateQuiz(fixture(20),article,20).length,20);
  const cases=[d=>d.questions.pop(),d=>d.questions[0].sourceId='outside',d=>d.questions[0].quote='모델이 외부 지식으로 만든 존재하지 않는 원문입니다.',d=>d.questions[1].correction='',d=>d.questions[0].answer='O',d=>d.questions[1].statement=d.questions[0].statement,d=>d.questions[0].explanation='외부 https://example.com 참조'];
  for(const mutate of cases){const d=fixture(5);mutate(d);assert.throws(()=>validateQuiz(d,article,5));}
  assert.equal(score(validateQuiz(fixture(5),article,5),{q1:true,q2:true,q3:true}),2);
});
test('editor corrects its own draft and automatically repairs invalid evidence',async()=>{
  const oldFetch=globalThis.fetch,oldChrome=globalThis.chrome;
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,data:'synthetic-token'})}};
  let calls=0,scenario='normal',editorCalls=0;
  globalThis.fetch=async(url,opts)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(opts.body);
    assert.equal(b.model,DEFAULT_MODEL);assert.equal(b.store,false);assert.equal(b.service_tier,'priority');assert.deepEqual(b.reasoning,{effort:'medium'});assert.ok(!('tools' in b));assert.ok(!('include' in b));assert.equal(opts.credentials,'omit');
    calls++;const input=JSON.parse(b.input[0].content),editing=Object.hasOwn(input,'proposedQuestions');const parsed=fixture(5);
    if(editing){editorCalls++;assert.equal(input.questionCount,5);assert.deepEqual(input.sourceBlocks,blocks);assert.ok(b.instructions.includes('FINAL QUIZ EDITOR'));}
    if(!editing && scenario==='draft'){parsed.questions[0].quote='처음 생성한 잘못된 근거는 편집 단계에서 고쳐야 합니다.';parsed.questions[1].answer=true;}
    if(editing && scenario==='edit' && editorCalls===1)parsed.questions[0].quote='검수 중 잘못 만든 근거도 자동으로 다시 고쳐야 합니다.';
    return Response.json({status:'completed',service_tier:'priority',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(parsed)}]}]});
  };
  try{
    for(const mode of ['normal','draft','edit']){
      scenario=mode;calls=0;editorCalls=0;
      const r=await generateQuiz(article,DEFAULT_MODEL,5,undefined);
      assert.equal(r.questions.length,5);assert.equal(r.questions[0].quote,blocks[0].text);assert.equal(r.questions[1].answer,false);
      assert.equal(calls,mode==='edit'?3:2);assert.equal(r.editorPasses,mode==='edit'?2:1);
    }
  }
  finally{globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;}
});
test('body length has distinct readiness codes, including empty extracted body',()=>{
  for(const blocks of [[],[{id:'b1',section:'본문',text:'짧은 본문입니다.'}]])assert.throws(()=>validateArticle({...article,blocks}),e=>e.code==='article_too_short');
  assert.throws(()=>validateArticle({...article,blocks:Array.from({length:31},(_,i)=>({id:`b${i+1}`,section:'본문',text:'가'.repeat(2200)}))}),e=>e.code==='article_too_long');
});
test('different facts may cite the same exact paragraph without rejecting the whole quiz',()=>{
  const text='고양이의 털은 흰색이고, 고양이의 귀는 둥글다.';
  const page={...article,blocks:[{id:'b1',section:'특징',text}]};
  const questions=[{statement:'고양이의 털은 흰색이다.',answer:true,sourceId:'b1',quote:text,explanation:'본문은 털이 흰색이라고 설명한다.',correction:''},{statement:'고양이의 귀는 뾰족하다.',answer:false,sourceId:'b1',quote:text,explanation:'본문은 귀가 둥글다고 설명한다.',correction:'고양이의 귀는 둥글다.'}];
  assert.equal(validateQuiz({questions},page,2).length,2);
});
test('permanently invalid model output is bounded and is never exposed as a quiz',async()=>{
  const oldFetch=globalThis.fetch,oldChrome=globalThis.chrome;let calls=0;
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,data:'synthetic-token'})}};
  globalThis.fetch=async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({questions:[]})}]}]});};
  try{await assert.rejects(generateQuiz(article,DEFAULT_MODEL,5),/문제 응답을 완성하지/);assert.equal(calls,4);}
  finally{globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;}
});
test('cancellation stops automatic editorial repair without further requests',async()=>{
  const oldFetch=globalThis.fetch,oldChrome=globalThis.chrome,abort=new AbortController();let calls=0;
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,data:'synthetic-token'})}};
  globalThis.fetch=async()=>{calls++;abort.abort();return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]});};
  try{await assert.rejects(generateQuiz(article,DEFAULT_MODEL,5,abort.signal),e=>e.name==='AbortError');assert.equal(calls,1);}
  finally{globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;}
});
test('Fast alias, disclosed fallback, JSON compatibility keep model and source input',async()=>{
  const oldFetch=globalThis.fetch,oldChrome=globalThis.chrome;globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,data:'synthetic-token'})}};
  const tiers=[],phases=[];let calls=0;
  globalThis.fetch=async(url,opts)=>{
    const b=JSON.parse(opts.body);tiers.push(b.service_tier);assert.equal(b.model,DEFAULT_MODEL);assert.deepEqual(b.reasoning,{effort:'high'});assert.ok(!b.tools);
    calls++;
    if(calls===1)return Response.json({error:{code:'unsupported_value',param:'service_tier',message:'service_tier unsupported value'}},{status:400});
    if(calls===2)return Response.json({error:{param:'service_tier',message:'service_tier not allowed'}},{status:400});
    if(calls===3)return Response.json({error:{param:'text.format',message:'json_schema unsupported'}},{status:400});
    assert.ok(!b.text);return Response.json({status:'completed',service_tier:'default',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]});
  };
  try{const r=await request(DEFAULT_MODEL,'test',{body:'original'}, {}, undefined,{effort:'high',onPhase:s=>phases.push(s)});assert.deepEqual(tiers,['priority','fast','default','default']);assert.ok(phases[0].includes('일반'));assert.equal(r.effectiveTier,'default');assert.deepEqual(r.compatibility,['fast_alias','standard_fallback','prompt_json']);}
  finally{globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;}
});
