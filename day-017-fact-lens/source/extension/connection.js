import {credentialStore} from './credentials.js';
const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const REFRESH_LIFETIME=30*24*60*60*1000;
export const RENEWAL_WINDOW=10*24*60*60*1000;
const TERMINAL_REFRESH = new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
export const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function makeAttempt(hostId, savedClientId) {
  const verifier = random(), state = random(), nonce = random();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  // No listener is started. The background worker observes this application's own tab callback.
  const port = 40000 + crypto.getRandomValues(new Uint16Array(1))[0] % 20000;
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  const params = new URLSearchParams({client_id:savedClientId || 'dynamic_agent_client',ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPE,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:challenge});
  if (!savedClientId) params.set('agent_name_hint','Fact Lens');
  return {verifier,state,nonce,redirectUri,clientId:savedClientId || null,url:`${AUTH}/api/accounts/authorize?${params}`};
}
export function validateCallback(raw, pending, tabId) {
  let u; try {u=new URL(raw);} catch {return null;}
  if (!pending || tabId !== pending.tabId || pending.expires < Date.now()) return null;
  const wanted = new URL(pending.redirectUri);
  if (u.origin !== wanted.origin || u.pathname !== wanted.pathname || u.username || u.password || u.hash) return null;
  for (const key of ['state','code','client_id','error']) if (u.searchParams.getAll(key).length > 1) return null;
  if (u.searchParams.get('state') !== pending.state) return null;
  if (u.searchParams.has('error')) return {error:u.searchParams.get('error') === 'access_denied' ? '연결을 취소했습니다.' : '로그인 서버에서 연결을 거절했습니다.'};
  const code=u.searchParams.get('code'), clientId=u.searchParams.get('client_id') || pending.clientId;
  if (!code || code.length > 4096 || !/^oaiapp_[a-zA-Z0-9_-]+$/.test(clientId || '') || (pending.clientId && clientId!==pending.clientId)) return null;
  return {code,clientId};
}
function decodePart(part) { const raw=part.replace(/-/g,'+').replace(/_/g,'/'); return Uint8Array.from(atob(raw), c=>c.charCodeAt(0)); }
export async function verifyIdToken(jwt, {clientId,nonce,issuer,jwks,subject}) {
  if (typeof jwt !== 'string' || jwt.length > 24000 || jwt.split('.').length !== 3) throw Error('로그인 증명 형식이 올바르지 않습니다.');
  const [a,b,c]=jwt.split('.'); const decoder=new TextDecoder();
  const header=JSON.parse(decoder.decode(decodePart(a))),claims=JSON.parse(decoder.decode(decodePart(b)));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw Error('지원하지 않는 로그인 서명입니다.');
  const jwk=jwks.keys?.find(k=>k.kid===header.kid && k.kty==='RSA' && (!k.use || k.use==='sig') && (!k.alg || k.alg==='RS256'));
  if (!jwk) throw Error('로그인 서명 키를 찾지 못했습니다.');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodePart(c),new TextEncoder().encode(`${a}.${b}`))) throw Error('로그인 서명이 올바르지 않습니다.');
  const now=Math.floor(Date.now()/1000), aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if (claims.iss!==issuer || !aud.includes(clientId) || (aud.length>1 && claims.azp!==clientId) || !Number.isFinite(claims.exp) || claims.exp<=now || (claims.nbf && claims.nbf>now+30) || !claims.sub || claims.nonce!==nonce || (subject && claims.sub!==subject)) throw Error('로그인 계정 또는 증명 유효기간이 올바르지 않습니다.');
  return claims;
}
export async function jsonRequest(url,options,phase='인증',fetcher=fetch) {
  const r=await fetcher(url,{credentials:'omit',...options,headers:{Accept:'application/json',...options?.headers},signal:AbortSignal.timeout(25000)});
  if (!r.ok) {
    // Never copy token-endpoint bodies or authorization URLs into errors/logs.
    const error=Error(`ChatGPT ${phase} 요청 실패 (HTTP ${r.status}). 잠시 후 다시 시도해 주세요.`);
    if(phase==='토큰 갱신' && r.status>=400 && r.status<500 && String(r.headers.get('content-type')).includes('application/json')){
      const data=await r.json().catch(()=>null),code=typeof data?.error==='string'?data.error:data?.error?.code;
      error.terminalRefresh=TERMINAL_REFRESH.has(code);
    }
    throw error;
  }
  const mime=String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (mime!=='application/json' && !mime.endsWith('+json')) throw Error(`ChatGPT ${phase} 응답이 JSON이 아닙니다 (HTTP ${r.status}). 로그인 페이지 또는 네트워크 중간 응답을 확인해 주세요.`);
  try { return await r.json(); } catch { throw Error(`ChatGPT ${phase} 응답을 해석하지 못했습니다. 다시 로그인해 주세요.`); }
}
export class ChatGPTConnection {
  // One owner serializes refresh and durable credential updates across all panels.
  #session=null; #attempt=null; #tail=Promise.resolve(); #ready=null; #store; #dirty=false; #now;
  constructor({store=credentialStore,now=()=>Date.now()}={}){this.#store=store;this.#now=now;}
  async #restore(){
    await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    // 0.1.2 credentials were RAM-only. Do not let an old cache revive a logout.
    await chrome.storage.session.remove('chatgptSession');
    const data=await chrome.storage.session.get('chatgptAttempt');
    try{this.#session=await this.#store.read();}
    catch(e){if(e.code!=='credential_corrupt')throw e;await this.#store.write(null);this.#session=null;await chrome.storage.session.set({oauthError:e.message});}
    if(this.#session?.refreshToken && this.#session.refreshExpires===undefined){
      // Legacy records only know access expiry. Infer the original issuance from
      // the documented one-hour lifetime; never grant 30 fresh days on each load.
      this.#session.refreshExpires=this.#session.expires-3600000+REFRESH_LIFETIME;
      await this.#save();
    }
    this.#attempt=data.chatgptAttempt || null;
    if(this.#attempt?.expires<this.#now()){this.#attempt=null;await chrome.storage.session.remove('chatgptAttempt');}
  }
  #run(action){const result=this.#tail.then(()=>this.#ready ||= this.#restore().catch(e=>{this.#ready=null;throw e;})).then(async()=>{
    if(this.#dirty)await this.#save();
    if(this.#session?.refreshToken && this.#session.refreshExpires<=this.#now()){
      this.#session=null;await this.#save();
      await chrome.storage.session.set({oauthError:'ChatGPT 연결의 갱신 유효기간이 지났습니다. 다시 연결해 주세요.'});
    }
    return action();
  });this.#tail=result.catch(()=>{});return result;}
  async #save(){this.#dirty=true;await this.#store.write(this.#session);this.#dirty=false;}
  status(){return this.#run(()=>({account:this.account,pending:!!this.#attempt && this.#attempt.expires>this.#now()}));}
  begin(){return this.#run(()=>this.#begin());}
  finish(message){return this.#run(()=>this.#finish(message));}
  accessToken(){return this.#run(()=>this.#accessToken());}
  renewalState(){return this.#run(async()=>{if(this.#dirty)await this.#save();return this.#renewalState();});}
  renew(){return this.#run(async()=>{
    if(this.#dirty)await this.#save();
    const state=this.#renewalState();
    if(!state || state.refreshAt>this.#now())return false;
    await this.#refresh();
    if(this.#session.refreshExpires===state.expires)throw Error('갱신 토큰 교체를 확인하지 못했습니다. 잠시 후 다시 시도합니다.');
    return true;
  });}
  cancel(){return this.#run(()=>this.#cancel());}
  disconnect(){return this.#run(()=>this.#disconnect());}
  isPending(state){return !!this.#attempt && this.#attempt.state===state;}
  get account(){return this.#session ? {name:this.#session.name,canGenerate:this.#session.scopes.includes('chatgpt.tokens.use.direct')} : null;}
  #renewalState(){return this.#session?.refreshToken && this.account.canGenerate ? {expires:this.#session.refreshExpires,refreshAt:this.#session.refreshExpires-RENEWAL_WINDOW} : null;}
  async #begin() {
    if (this.#attempt?.expires>this.#now()) throw Error('이미 로그인 중입니다. 취소 후 다시 시도해 주세요.');
    const saved=await chrome.storage.local.get(['hostId','chatgptClientId','chatgptSubject']);
    const hostId=saved.hostId || `urn:uuid:${crypto.randomUUID()}`;
    if (!saved.hostId) await chrome.storage.local.set({hostId});
    this.#attempt={...await makeAttempt(hostId,saved.chatgptClientId),expires:this.#now()+10*60*1000};
    if(saved.chatgptSubject)this.#attempt.subject=saved.chatgptSubject;
    await chrome.storage.session.set({chatgptAttempt:this.#attempt});
    return this.#attempt;
  }
  async #finish(message) {
    const attempt=this.#attempt; if (!attempt || message.state!==attempt.state) return false;
    await this.#cancel();
    if(attempt.expires<this.#now())throw Error('로그인 요청이 만료되었습니다. 다시 연결해 주세요.');
    if (message.error) throw Error(message.error);
    if (attempt.clientId && message.clientId!==attempt.clientId) throw Error('로그인 앱 식별자가 변경되었습니다.');
    // Retain an issued dynamic registration even when code exchange must be retried.
    await chrome.storage.local.set({chatgptClientId:message.clientId});
    const token=await jsonRequest(`${AUTH}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:message.clientId,code:message.code,code_verifier:attempt.verifier,redirect_uri:attempt.redirectUri,resource:RESOURCE})},'토큰 교환');
    const metadata=await jsonRequest(`${AUTH}/.well-known/openid-configuration`,undefined,'인증 서버 정보');
    if (metadata.issuer!==AUTH || !String(metadata.jwks_uri).startsWith(`${AUTH}/`)) throw Error('인증 서버 정보가 올바르지 않습니다.');
    const jwks=await jsonRequest(metadata.jwks_uri,undefined,'서명 키');
    const identity=await verifyIdToken(token.id_token,{clientId:message.clientId,nonce:attempt.nonce,issuer:metadata.issuer,jwks,subject:attempt.subject});
    if (typeof token.access_token!=='string' || !Number.isFinite(token.expires_in) || token.expires_in<=0) throw Error('로그인 토큰 정보가 없습니다.');
    const issuedAt=this.#now();
    this.#session={accessToken:token.access_token,refreshToken:token.refresh_token,clientId:message.clientId,expires:issuedAt+token.expires_in*1000,refreshExpires:token.refresh_token?issuedAt+REFRESH_LIFETIME:undefined,subject:identity.sub,name:identity.email || identity.name || 'ChatGPT 연결됨',scopes:String(token.scope || '').split(' ')};
    // Persist an authenticated, encrypted record before reporting login success.
    await chrome.storage.local.set({chatgptClientId:message.clientId,chatgptSubject:identity.sub});
    await this.#save();
    return true;
  }
  async #accessToken() {
    if(this.#dirty)await this.#save();
    if (!this.#session) throw Error('ChatGPT를 먼저 연결해 주세요.');
    if (!this.account.canGenerate) throw Error('ChatGPT 사용량 이용 권한이 필요합니다. 연결을 해제한 뒤 다시 동의해 주세요.');
    if (this.#session.expires>this.#now()+60000) return this.#session.accessToken;
    return this.#refresh();
  }
  async #refresh() {
    const current=this.#session;
    if (!current?.refreshToken){this.#session=null;await this.#save();throw Error('로그인이 만료되었습니다. 다시 연결해 주세요.');}
    let next;
    try{next=await jsonRequest(`${AUTH}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:current.clientId,refresh_token:current.refreshToken,resource:RESOURCE})},'토큰 갱신');}
    catch(e){if(e.terminalRefresh){this.#session=null;await this.#save();throw Error('ChatGPT 연결이 만료되었거나 해제되었습니다. 다시 연결해 주세요.');}throw e;}
    if (this.#session!==current) throw Error('연결 상태가 변경되었습니다.');
    if (typeof next.access_token!=='string' || !Number.isFinite(next.expires_in) || next.expires_in<=0) throw Error('갱신 응답이 올바르지 않습니다.');
    const issuedAt=this.#now(),replaced=typeof next.refresh_token==='string' && !!next.refresh_token && next.refresh_token!==current.refreshToken;
    this.#session={...current,accessToken:next.access_token,refreshToken:next.refresh_token || current.refreshToken,expires:issuedAt+next.expires_in*1000,refreshExpires:replaced?issuedAt+REFRESH_LIFETIME:current.refreshExpires,scopes:next.scope?String(next.scope).split(' '):current.scopes};
    await this.#save();
    if (!this.account.canGenerate) throw Error('ChatGPT 사용량 이용 권한이 해제되었습니다.');
    return next.access_token;
  }
  async #cancel(){this.#attempt=null;await chrome.storage.session.remove('chatgptAttempt');}
  async #disconnect() {
    const session=this.#session;
    // Do not forget a token before durable deletion commits: a failed logout
    // must remain retryable and must not report successful remote revocation.
    await this.#store.write(null);this.#session=null;this.#dirty=false;await this.#cancel();
    if (!session?.refreshToken) return {revoked:true};
    try {
      const meta=await jsonRequest(`${AUTH}/.well-known/openid-configuration`);
      if (!String(meta.revocation_endpoint).startsWith(`${AUTH}/`))return {revoked:false};
      const result=await fetch(meta.revocation_endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:session.refreshToken,token_type_hint:'refresh_token',client_id:session.clientId}),signal:AbortSignal.timeout(10000)});
      return {revoked:result.status===200};
    } catch {return {revoked:false};}
  }
}
