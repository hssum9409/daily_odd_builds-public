import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {onRequest} from 'firebase-functions/v2/https';
import {defineSecret} from 'firebase-functions/params';
import {createService,ReportError} from './service.mjs';
initializeApp();const rateKey=defineSecret('FACT_LENS_REPORT_RATE_KEY');let execute;
export const factLensDiagnostics=onRequest({region:'asia-northeast3',memory:'256MiB',cpu:'gcf_gen1',minInstances:0,maxInstances:1,concurrency:1,timeoutSeconds:20,invoker:'public',secrets:[rateKey],cors:false},async(req,res)=>{
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 const origin=req.get('origin');if(origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)){res.status(403).json({error:'origin_rejected'});return;}
 if(origin){res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');}
 if(req.method==='OPTIONS'){res.set('Access-Control-Allow-Methods','POST');res.set('Access-Control-Allow-Headers','Content-Type');res.status(204).end();return;}
 if(req.method!=='POST'){res.set('Allow','POST');res.status(405).json({error:'method_rejected'});return;}
 if(!/^application\/json(?:;|$)/i.test(req.get('content-type')||'')||!req.rawBody||req.rawBody.length>16384){res.status(400).json({error:'invalid_content'});return;}
 try{execute??=createService({db:getFirestore(),secret:rateKey.value()});res.json(await execute(req.body,req.ip||'unknown'));}
 catch(error){res.status(error instanceof ReportError?error.status:500).json({error:error instanceof ReportError?error.message:'server_error'});}
});
