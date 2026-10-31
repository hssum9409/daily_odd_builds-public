import test from 'node:test';import assert from 'node:assert/strict';
import {initializeApp} from 'firebase-admin/app';import {getFirestore} from 'firebase-admin/firestore';import {randomUUID} from 'node:crypto';
import {createService,REPORTS,LIMITS} from './service.mjs';import {makeDiagnosticReport} from './diagnostics.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('emulator required; never run this test against production');
initializeApp({projectId:'demo-factlens-report'});const db=getFirestore();let time=1000000000;const execute=createService({db,secret:'qa-server-only-secret-'.repeat(3),now:()=>time});
const make=()=>makeDiagnosticReport({code:'schema_mismatch',phase:'전체 맥락 분석',model:'gpt-6.1-terra',validation:'source_mapping',validationCode:'quote_mismatch',textLength:100},'0.1.16',156,randomUUID());
test('emulator: idempotent report receipt, private bounded storage, TTL and strict unknown-field rejection',async()=>{
 const payload=make();const receipts=await Promise.all([execute(payload,'test-address'),execute(payload,'test-address')]);assert.deepEqual(receipts[0],receipts[1]);
 const data=(await db.collection(REPORTS).doc(payload.reportId).get()).data();assert.equal(data.expiresAt.toMillis()-data.createdAt.toMillis(),30*86400000);assert.ok(!JSON.stringify(data).includes('test-address'));
 assert.equal((await db.collection(LIMITS).where('dailyCount','==',1).get()).size,1);
 await assert.rejects(execute({...payload,chromeMajor:155},'test-address'),e=>e.status===409);
 for(const bad of [{...make(),article:'PRIVATE'},{...make(),diagnostic:{code:'schema_mismatch',token:'PRIVATE'}},{...make(),diagnostic:{code:'PRIVATE'}}])await assert.rejects(execute(bad,'test-address'),e=>e.status===400);
 const anonymous=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-factlens-report/databases/(default)/documents/${REPORTS}/${payload.reportId}`);assert.equal(anonymous.status,403);
});
test('emulator: transaction rate limits under concurrent reports and minute reset',async()=>{
 const results=await Promise.allSettled(Array.from({length:6},()=>execute(make(),'second-address')));assert.equal(results.filter(r=>r.status==='fulfilled').length,3);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.status===429));
 time+=60000;await execute(make(),'second-address');
});
