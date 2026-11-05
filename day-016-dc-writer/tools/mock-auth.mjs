// Only used by local QA; never packaged. Every auth fetch is synthetic.
export async function installMockAuth(worker,keys){
  await worker.evaluate(({jwk,privateJwk})=>{
    const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const part=o=>encode(new TextEncoder().encode(JSON.stringify(o)));
    self.qaAuth={refreshes:0,exchanges:0,revocations:0,refreshError:null};
    self.fetch=async(raw,options={})=>{
      const url=String(raw),body=options.body,stats=self.qaAuth;
      if(url==='https://auth.openai.com/.well-known/openid-configuration')return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/qa-jwks',revocation_endpoint:'https://auth.openai.com/qa-revoke'});
      if(url==='https://auth.openai.com/qa-jwks')return Response.json({keys:[jwk]});
      if(url==='https://auth.openai.com/qa-revoke'){stats.revocations++;return new Response('',{status:200});}
      if(url==='https://auth.openai.com/api/accounts/oauth/token'){
        if(body.get('client_id')!=='oaiapp_qa')throw Error('QA client mismatch');
        if(body.get('grant_type')==='refresh_token'){
          if(stats.expectedRefresh && body.get('refresh_token')!==stats.expectedRefresh)throw Error('QA refresh rotation mismatch');
          stats.refreshes++;if(stats.refreshError)return Response.json({error:stats.refreshError.code},{status:stats.refreshError.status});
          return Response.json({access_token:'FAKE_QA_ACCESS',refresh_token:'FAKE_QA_REFRESH_ROTATED',expires_in:3600,scope:'openid profile email chatgpt.tokens.use.direct'});
        }
        stats.exchanges++;
        const {qaAuthorize}=await chrome.storage.session.get('qaAuthorize');
        if(!qaAuthorize || encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.get('code_verifier')))))!==qaAuthorize.challenge)throw Error('QA PKCE mismatch');
        const key=await crypto.subtle.importKey('jwk',privateJwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
        const unsigned=part({alg:'RS256',kid:jwk.kid})+'.'+part({iss:'https://auth.openai.com',aud:'oaiapp_qa',sub:'synthetic-qa',email:'synthetic@example.invalid',exp:Math.floor(Date.now()/1000)+3600,nonce:qaAuthorize.nonce});
        const jwt=unsigned+'.'+encode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned))));
        return Response.json({access_token:'FAKE_QA_ACCESS',refresh_token:'FAKE_QA_REFRESH',id_token:jwt,expires_in:1,scope:'openid profile email chatgpt.tokens.use.direct'});
      }
      throw Error('Unexpected QA worker request');
    };
  },keys);
}
