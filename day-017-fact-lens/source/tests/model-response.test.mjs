import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelResponse, ModelTransportError } from '../shared/model-response.mjs';
import { extractionSchema } from '../shared/structured.mjs';
import { requestStructured } from '../extension/provider.js';
const claims={claims:[{claim:'달은 지구를 공전한다',quote:'달은 지구 주위를 공전한다.'}]};
const complete={object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(claims)}]}]};
const sse=`data: ${JSON.stringify({type:'response.completed',response:complete})}\n\n`;
test('completed non-stream JSON and a JSON completed-event envelope are accepted with completion proof',async()=>{
 for(const body of [complete,{type:'response.completed',response:complete}]){
  const result=await readModelResponse(Response.json(body));assert.equal(result.transport,'json');assert.deepEqual(result.completed,complete);
 }
});
test('SSE is recognized with JSON/plain/missing headers and completion is still required',async()=>{
 for(const type of ['application/json','text/plain',null]){
  const response=new Response(new TextEncoder().encode(sse),{headers:type?{'content-type':type}:{}});
  const result=await readModelResponse(response);assert.equal(result.transport,'sse-header-mismatch');assert.equal(result.completed.status,'completed');
 }
 await assert.rejects(readModelResponse(new Response('data: {"type":"response.output_text.delta","delta":"{}"}\n\n',{headers:{'content-type':'text/plain'}})),e=>e.code==='stream_error');
});
test('completed JSON works despite a missing or plain Content-Type, without treating bare claims as complete',async()=>{
 for(const headers of [{},{'content-type':'text/plain'}])assert.equal((await readModelResponse(new Response(new TextEncoder().encode(JSON.stringify(complete)),{headers}))).completed.status,'completed');
 await assert.rejects(readModelResponse(Response.json(claims)),e=>e.code==='unexpected_json');
 for(const status of ['incomplete','failed','in_progress','queued'])await assert.rejects(readModelResponse(Response.json({...complete,status})),e=>e.code==='not_completed');
});
test('HTML and arbitrary text fail safely with status and MIME, without exposing body secrets',async()=>{
 for(const [body,type,code] of [['<html>PRIVATE_QA_BODY_TOKEN</html>','text/html','unexpected_html'],['PRIVATE_QA_BODY_TOKEN','text/plain','invalid_json']]){
  await assert.rejects(readModelResponse(new Response(body,{headers:{'content-type':type}})),e=>e.code===code&&e.message.includes(type)&&e.message.includes('HTTP 200')&&!e.message.includes('PRIVATE_QA_BODY_TOKEN')&&!JSON.stringify(e.diagnostic).includes('PRIVATE_QA_BODY_TOKEN'));
 }
});
test('HTTP and HTTP-200 provider error JSON is not interpreted as model output',async()=>{
 const body={error:{code:'unsupported_parameter',param:'text.format',message:'PRIVATE_QA_BODY_TOKEN'}};
 await assert.rejects(readModelResponse(Response.json(body)),e=>e.code==='provider_error'&&e.diagnostic.providerCode==='unsupported_parameter'&&e.diagnostic.parameter==='text.format'&&!e.message.includes('PRIVATE_QA_BODY_TOKEN'));
 await assert.rejects(readModelResponse(Response.json({error:{code:'rate_limit_exceeded'}},{status:429})),e=>e.code==='http_error'&&e.message.includes('한도'));
});
test('oversized fallback response and cancellation are rejected without buffering indefinitely',async()=>{
 const huge=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(8_000_001));c.close()}}));
 await assert.rejects(readModelResponse(huge),e=>e.code==='response_too_large');
 const controller=new AbortController();controller.abort();await assert.rejects(readModelResponse(Response.json(complete),controller.signal),e=>e.name==='AbortError');
});
test('provider still requests stream=true and strict schema, accepts completed JSON without an extra model call',async()=>{
 let calls=0,diagnostic;
 globalThis.chrome={runtime:{async sendMessage(){return {ok:true,data:'QA_AUTH'}}},storage:{session:{async set(value){diagnostic=value.lastRequestDiagnostic}}}};
 globalThis.fetch=async(_url,options)=>{calls++;const request=JSON.parse(options.body);assert.equal(request.stream,true);assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.equal(options.headers.Accept,'text/event-stream, application/json');return Response.json(complete)};
 const result=await requestStructured('gpt-6.1-sol','Extract','PRIVATE_ARTICLE',extractionSchema,false,new AbortController().signal);
 assert.deepEqual(result.parsed,claims);assert.equal(calls,1);assert.equal(diagnostic.transport,'json');assert.equal(diagnostic.code,'ok');
});
test('transport failure persists safe diagnostics once, with no format retry or raw output',async()=>{
 let calls=0,diagnostic;
 globalThis.chrome={runtime:{async sendMessage(){return {ok:true,data:'QA_AUTH'}}},storage:{session:{async set(value){diagnostic=value.lastRequestDiagnostic}}}};
 globalThis.fetch=async()=>{calls++;return new Response('<html>PRIVATE_QA_BODY_TOKEN</html>',{headers:{'content-type':'text/html'}})};
 await assert.rejects(requestStructured('gpt-6.1-sol','Extract','PRIVATE_ARTICLE',extractionSchema,false,new AbortController().signal),e=>e instanceof ModelTransportError&&e.message.includes('주장 추출')&&e.diagnostic.contentType==='text/html');
 assert.equal(calls,1);assert.equal(diagnostic.code,'unexpected_html');assert.equal(diagnostic.httpStatus,200);assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE_'));
});
