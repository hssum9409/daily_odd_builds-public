import test from 'node:test';
import assert from 'node:assert/strict';
import {isWriteUrl,safeDcImage,preservedDocument,validateDocument,validateGeneratedDocument,writingSource,renderDocument,buildRequest} from '../extension/core.js';
import {readResponseStream,resolveInference,withInferenceOptions} from '../extension/network.js';

test('Inference presets use account-visible models and Auto prefers Terra, then Luna, with Medium and Fast', () => {
  const models = ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6.1-terra'].map(id => ({id}));
  for (const [preset, model, effort, fast] of [
    ['free', 'gpt-6-luna', 'low', false],
    ['plus', 'gpt-6.1-terra', 'high', false],
    ['pro', 'gpt-6.1-sol', 'high', true],
    ['auto', 'gpt-6.1-terra', 'medium', true]
  ]) {
    const choice = resolveInference(models, {chatgptPreset: preset});
    assert.deepEqual([choice.model.id, choice.effort, choice.fast], [model, effort, fast]);
  }
  const withoutTerra = resolveInference(models.slice(0, 2));
  assert.deepEqual([withoutTerra.model.id, withoutTerra.effort, withoutTerra.fast], ['gpt-6-luna', 'medium', true]);
  const manual = resolveInference(models, {chatgptModel: 'gpt-6.1-sol', chatgptEffort: 'low', chatgptFast: false});
  assert.deepEqual([manual.model.id, manual.effort, manual.fast], ['gpt-6.1-sol', 'low', false]);
  assert.equal(resolveInference([]).model, undefined);
});

test('Saved visible model and manual options override presets and serialize to Responses', () => {
  const models = [{id: 'gpt-6.1-sol'}, {id: 'other-model'}];
  const prefs = {chatgptPreset: 'pro', chatgptModel: 'other-model', chatgptEffort: 'medium', chatgptFast: false};
  const choice = resolveInference(models, prefs);
  assert.deepEqual(withInferenceOptions({model: choice.model.id}, choice), {
    model: 'other-model', reasoning: {effort: 'medium'}, service_tier: 'default'
  });
  const fallback = resolveInference(models.slice(0, 1), {chatgptPreset: 'pro', chatgptModel: prefs.chatgptModel});
  assert.deepEqual(withInferenceOptions({model: fallback.model.id}, fallback), {
    model: 'gpt-6.1-sol', reasoning: {effort: 'high'}, service_tier: 'fast'
  });
  assert.deepEqual(withInferenceOptions({}, resolveInference(models.slice(1))), {service_tier: 'default'});
});

test('Only exact PC write routes and galleries are accepted',()=>{
  for(const prefix of ['','mgallery/','mini/'])assert.equal(isWriteUrl(`https://gall.dcinside.com/${prefix}board/write/?id=test_1`),true);
  for(const u of ['https://gall.dcinside.com.evil.test/board/write/?id=a','https://gall.dcinside.com/board/view/?id=a','http://gall.dcinside.com/board/write/?id=a','https://gall.dcinside.com:444/board/write/?id=a','https://gall.dcinside.com/board/write/?id=../a','https://m.dcinside.com/write/a'])assert.equal(isWriteUrl(u),false);
});
test('Original text including whitespace, unsafe text and photos retains exact text order',()=>{
  const source='  첫 줄\n\n<script>문자 그대로</script>\r\n[[사진:p1]]\n마지막 줄  ';
  const doc=preservedDocument(source,'제목',[{id:'p1'},{id:'p2'}]);
  assert.equal(doc.blocks.filter(b=>b.type==='paragraph').map(b=>b.text).join(''),source.replace('[[사진:p1]]',''));
  assert.deepEqual(doc.blocks.filter(b=>b.type==='image').map(b=>b.id),['p1','p2']);
  const html=renderDocument(doc,[{id:'p1'},{id:'p2'}],'plain',true);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});
test('No remote URL, unsupported HTML blocks, unknown or duplicate image IDs',()=>{
  const photos=[{id:'p1'}];
  for(const blocks of [[{type:'html',text:'<iframe>'}],[{type:'image',id:'madeup'}],[{type:'image',id:'p1'},{type:'image',id:'p1'}]])assert.throws(()=>validateDocument({title:'t',blocks},photos));
  assert.throws(()=>renderDocument({blocks:[{type:'image',id:'p1'}]},[{id:'p1',url:'https://foreign.invalid/photo.png'}]));
  assert.equal(safeDcImage('https://dcimg1.dcinside.com/a.png'),true);assert.equal(safeDcImage('https://dccdn11.dcinside.co.kr/a.png'),true);assert.equal(safeDcImage('https://dcinside.co.kr.evil.test/a.png'),false);assert.equal(safeDcImage('https://dcinside.com.evil.test/a.png'),false);
});
test('AI receives structured material and no photo bytes unless explicitly opted in',()=>{
  const options={source:'재료',title:'제목',mode:'structure',style:'plain',photos:[{id:'p1',name:'image.png',blob:'PRIVATE',analysisUrl:'data:image/jpeg;base64,TEST'}],analyzeImages:false};
  const r=buildRequest(options,'account-selected-model');assert.equal(r.store,false);assert.equal(r.stream,true);assert.equal(r.model,'account-selected-model');assert.equal(r.input[0].content.length,1);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(!JSON.stringify(r).includes('base64,TEST'));
  assert.equal(buildRequest({...options,analyzeImages:true},'m').input[0].content.length,3);assert.throws(()=>buildRequest({...options,mode:'preserve'},'m'));
});
test('Stream handles fragmented UTF-8 and CRLF, requires completed and valid JSON',async()=>{
  const output=JSON.stringify({title:'한글',blocks:[{type:'paragraph',text:'문장'}]});
  const events=`data: ${JSON.stringify({type:'response.output_text.delta',delta:output})}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n`;
  const encoded=new TextEncoder().encode(events);const stream=new ReadableStream({start(c){for(let i=0;i<encoded.length;i+=3)c.enqueue(encoded.slice(i,i+3));c.close();}});
  assert.equal((await readResponseStream(stream)).title,'한글');
  const make=s=>new Blob([s]).stream();await assert.rejects(readResponseStream(make('data: {"type":"response.output_text.delta","delta":"{}"}\n\n')),/중간에/);
  await assert.rejects(readResponseStream(make('data: {"type":"response.failed"}\n\n')),/완료되지/);
});
test('reference takes presentation priority; absent reference falls back to instructions/template/style',()=>{
  const base={source:'커피는 고소했다.',title:'',mode:'polish',style:'info',photos:[],reference:'짧은 두 문단, 편안한 반말',instructions:'격식 있는 목록',template:'서론 → 결론'};
  const data=o=>JSON.parse(buildRequest(o,'m').input[0].content[0].text);
  assert.deepEqual(data(base).writingGuide,{primary:'reference',priority:['reference','instructions','template','style']});
  assert.equal(data({...base,reference:' \n '}).writingGuide.primary,'instructions');
  assert.equal(data({...base,reference:'',instructions:''}).writingGuide.primary,'template');
  assert.equal(data({...base,reference:'',instructions:'',template:''}).writingGuide.primary,'style');
  assert.equal(data(base).reference,base.reference);assert.equal(data(base).source,base.source);
});
test('AI removes leading test-material label while original preservation and actual quotations retain it',()=>{
  const source='검증용 가상 메모 : 커피는 고소했고 창가 자리가 좋았다.';
  assert.equal(writingSource(source),'커피는 고소했고 창가 자리가 좋았다.');
  assert.equal(preservedDocument(source,'제목',[]).blocks[0].text,source);
  const quote='문구 “검증용 가상 메모:”를 화면에서 지웠다.';assert.equal(writingSource(quote),quote);
  const doc=validateGeneratedDocument({title:'후기',blocks:[{type:'paragraph',text:source}]});
  assert.equal(doc.blocks[0].text,'커피는 고소했고 창가 자리가 좋았다.');assert.ok(!renderDocument(doc,[]).includes('가상 메모'));
  assert.equal(validateGeneratedDocument({title:'인용',blocks:[{type:'quote',text:source}]}).blocks[0].text,source);
});
test('generated label-only heading disappears; validation still rejects arbitrary HTML and invented images',()=>{
  const doc=validateGeneratedDocument({title:'검증용 메모: 커피 후기',blocks:[{type:'heading',text:'검증용 가상 메모:'},{type:'paragraph',text:'커피가 고소했다.'}]});
  assert.equal(doc.title,'커피 후기');assert.deepEqual(doc.blocks,[{type:'paragraph',text:'커피가 고소했다.'}]);
  assert.throws(()=>validateGeneratedDocument({title:'t',blocks:[{type:'html',text:'<script>'}]}));
  assert.throws(()=>validateGeneratedDocument({title:'t',blocks:[{type:'image',id:'invented'}]}));
});
