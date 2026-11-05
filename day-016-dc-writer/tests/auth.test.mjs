import test from 'node:test';
import assert from 'node:assert/strict';
import {makeAttempt,validateCallback,verifyIdToken,b64url,jsonRequest} from '../extension/auth.js';

test('HTML, malformed JSON, and HTTP failures report the stage without leaking response bodies',async()=>{
  const sensitive='DO_NOT_LOG_FAKE_CREDENTIAL';
  for(const [status,type,body,expected]of [[200,'text/html',`<!DOCTYPE html>${sensitive}`,/トークン|토큰 교환 응답이 JSON이 아닙니다/],[200,'application/json',`<!DOCTYPE html>${sensitive}`,/응답을 해석하지/],[403,'text/html',sensitive,/HTTP 403/]]){
    await assert.rejects(jsonRequest('https://auth.openai.com/api/accounts/oauth/token',undefined,'토큰 교환',async()=>new Response(body,{status,headers:{'content-type':type}})),e=>{assert.match(e.message,expected);assert.ok(!e.message.includes(sensitive));assert.ok(!e.message.includes('<!DOCTYPE'));return true;});
  }
  let headers;const value=await jsonRequest('https://auth.openai.com/.well-known/openid-configuration',undefined,'인증 서버 정보',async(_u,options)=>{headers=options.headers;return Response.json({issuer:'https://auth.openai.com'});});assert.equal(value.issuer,'https://auth.openai.com');assert.equal(headers.Accept,'application/json');
});

test('Fresh PKCE/state/nonce with stable host identity and returning client registration',async()=>{
  const a=await makeAttempt('urn:uuid:test'),b=await makeAttempt('urn:uuid:test','oaiapp_registered');
  assert.notEqual(a.state,b.state);assert.notEqual(a.nonce,b.nonce);assert.equal(a.verifier.length,43);const u=new URL(a.url);
  assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(u.searchParams.get('code_challenge'),b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(a.verifier)))));assert.equal(new URL(b.url).searchParams.get('client_id'),'oaiapp_registered');assert.ok(!new URL(b.url).searchParams.has('agent_name_hint'));
});
test('Callback is bound to tab, exact loopback port/path, state, expiry and issued client ID',()=>{
  const p={tabId:17,redirectUri:'http://127.0.0.1:47921/auth/callback',state:'own-state',expires:Date.now()+10000,clientId:null};
  const good='http://127.0.0.1:47921/auth/callback?code=FAKE&state=own-state&client_id=oaiapp_example';
  assert.deepEqual(validateCallback(good,p,17),{code:'FAKE',clientId:'oaiapp_example'});
  for(const [url,pending,tab] of [[good,p,18],[good.replace('own-state','wrong'),p,17],[good.replace(':47921',':47922'),p,17],[good.replace('/auth/callback','/callback'),p,17],[good+'&state=own-state',p,17],[good,{...p,expires:0},17],[good,{...p,clientId:'oaiapp_other'},17]])assert.equal(validateCallback(url,pending,tab),null);
  assert.ok(validateCallback('http://127.0.0.1:47921/auth/callback?state=own-state&error=access_denied',p,17).error);
});
test('OIDC checks signature, audience, nonce, expiry and account subject',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test',alg:'RS256',use:'sig'};
  const claims={iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'synthetic-user',exp:Math.floor(Date.now()/1000)+60,nonce:'test-nonce'};
  const encode=x=>b64url(new TextEncoder().encode(JSON.stringify(x)));
  const sign=async c=>{const v=`${encode({alg:'RS256',kid:'test'})}.${encode(c)}`;return `${v}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(v))))}`;};
  const options={clientId:'oaiapp_test',nonce:'test-nonce',issuer:'https://auth.openai.com',jwks:{keys:[jwk]}};
  assert.equal((await verifyIdToken(await sign(claims),options)).sub,'synthetic-user');
  for(const changed of [{nonce:'wrong'},{aud:'other'},{exp:0},{iss:'https://attacker.invalid'}])await assert.rejects(verifyIdToken(await sign({...claims,...changed}),options));
  await assert.rejects(verifyIdToken(await sign(claims),{...options,subject:'different-user'}));
});
