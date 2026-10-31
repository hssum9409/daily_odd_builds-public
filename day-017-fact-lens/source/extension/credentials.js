// Extension-origin storage, never sync. This is not an OS keychain: code running
// in this extension/profile can use the key even though JS cannot export it.
const DB='fact-lens-credentials',STORE='credentials';
const aad=new TextEncoder().encode('fact-lens:credentials:v1');
const corrupt=()=>Object.assign(Error('저장된 ChatGPT 연결을 읽지 못했습니다. 다시 연결해 주세요.'),{code:'credential_corrupt'});
export function validSession(s){
  return !!s && typeof s.accessToken==='string' && s.accessToken.length>0 && s.accessToken.length<=65536 &&
    (s.refreshToken===undefined || (typeof s.refreshToken==='string' && s.refreshToken.length<=65536)) &&
    /^oaiapp_[a-zA-Z0-9_-]+$/.test(s.clientId) && Number.isFinite(s.expires) &&
    (s.refreshExpires===undefined || Number.isFinite(s.refreshExpires)) &&
    typeof s.subject==='string' && !!s.subject && typeof s.name==='string' &&
    Array.isArray(s.scopes) && s.scopes.every(x=>typeof x==='string');
}
export async function sealSession(session){
  if(!validSession(session))throw Error('저장할 ChatGPT 연결 정보가 올바르지 않습니다.');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload={accessToken:session.accessToken,refreshToken:session.refreshToken,clientId:session.clientId,expires:session.expires,refreshExpires:session.refreshExpires,subject:session.subject,name:session.name,scopes:session.scopes};
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(JSON.stringify(payload)));
  return {version:1,key,iv,ciphertext};
}
export async function unsealSession(record){
  try{
    if(record?.version!==1 || record.key?.extractable!==false || record.key?.algorithm?.name!=='AES-GCM' || record.iv?.byteLength!==12 || record.ciphertext?.byteLength>262144)throw corrupt();
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad},record.key,record.ciphertext);
    const session=JSON.parse(new TextDecoder().decode(plaintext));if(!validSession(session))throw corrupt();return session;
  }catch{throw corrupt();}
}
async function openDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(Error('ChatGPT 연결 저장소를 열지 못했습니다. 다시 시도해 주세요.'));
  });
}
async function recordTransaction(mode,value){
  const db=await openDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode,mode==='readwrite'?{durability:'strict'}:undefined),store=tx.objectStore(STORE);
    const request=mode==='readonly'?store.get('current'):value===null?store.delete('current'):store.put(value,'current');
    let result;request.onsuccess=()=>{result=request.result;};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(Error('ChatGPT 연결 저장소에 반영하지 못했습니다. 다시 시도해 주세요.'));
  });}finally{db.close();}
}
export const credentialStore={
  async read(){const record=await recordTransaction('readonly');return record?unsealSession(record):null;},
  async write(session){await recordTransaction('readwrite',session===null?null:await sealSession(session));}
};
