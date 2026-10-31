// Local operator tool. Uses the existing Firebase CLI login without exporting credentials.
import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/package.json'));
const account=require('./lib/auth').getGlobalDefaultAccount();if(!account)throw Error('Firebase CLI login required');
await require('./lib/requireAuth').requireAuth({...account,project:'daily-odd-builds-portal',nonInteractive:true});
const {Client}=require('./lib/apiv2');
const project='daily-odd-builds-portal';
const fs=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const base=`/projects/${project}/databases/(default)`;
const collections=['factlens_error_reports_v1','factlens_error_limits_v1'];
const mode=process.argv[2];
if(mode==='prepare'||mode==='status'){
 const billing=await new Client({urlPrefix:'https://cloudbilling.googleapis.com',apiVersion:'v1'}).get(`/projects/${project}/billingInfo`);console.log(JSON.stringify({project,billingEnabled:billing.body.billingEnabled}));
 for(const collection of collections){
  const field=`${base}/collectionGroups/${collection}/fields/expiresAt`;
  if(mode==='prepare'){const value=await fs.patch(field,{ttlConfig:{}},{queryParams:{updateMask:'ttlConfig'}});console.log(JSON.stringify({collection,operation:value.body.name}));}
  else {const value=await fs.get(field);console.log(JSON.stringify({collection,ttl:value.body.ttlConfig?.state||'DISABLED'}));}
 }
}else if(mode==='read'||mode==='cleanup'){
 const id=process.argv[3];if(!/^[0-9a-f-]{36}$/.test(id))throw Error('invalid report id');
 const doc=`${base}/documents/factlens_error_reports_v1/${id}`;const value=(await fs.get(doc)).body;
 if(mode==='read')console.log(JSON.stringify({name:value.name,fields:value.fields,updateTime:value.updateTime}));
 else {if(value.fields?.extensionVersion?.stringValue!=='0.1.16'||value.fields?.diagnostic?.mapValue?.fields?.phase?.stringValue!=='기타')throw Error('not the synthetic QA receipt');await fs.delete(doc,{queryParams:{'currentDocument.updateTime':value.updateTime}});console.log('Removed synthetic QA report');}
}else throw Error('Use prepare/status/read/cleanup');
