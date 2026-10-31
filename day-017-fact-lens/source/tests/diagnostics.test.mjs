import test from 'node:test';import assert from 'node:assert/strict';import {safeDiagnostic,makeDiagnosticReport,validateDiagnosticReport} from '../shared/diagnostics.mjs';
const id='412998c0-2422-46e9-8acc-55b859764361';
test('report allowlist excludes page, token, arbitrary metadata, unexpected nested fields and model/phase injection',()=>{
 const raw={code:'schema_mismatch',phase:'전체 맥락 분석',model:'gpt-6.1-terra',attempt:2,textLength:501,validationCode:'coverage_missing',validationCounts:{inputBlocks:10,missingBlocks:1,body:'SECRET'},title:'SECRET',url:'SECRET',token:'SECRET',error:'SECRET',outputTypes:['message','SECRET']};const safe=safeDiagnostic(raw);assert.ok(!JSON.stringify(safe).includes('SECRET'));assert.equal(safe.model,'gpt-6.1-terra');assert.equal(safe.validationCounts.missingBlocks,1);
 const report=makeDiagnosticReport(raw,'0.1.16',156,id);assert.deepEqual(validateDiagnosticReport(report),report);assert.throws(()=>validateDiagnosticReport({...report,article:'SECRET'}));assert.throws(()=>validateDiagnosticReport({...report,diagnostic:{...safe,token:'SECRET'}}));assert.equal(safeDiagnostic({model:'user@example.com',phase:'SECRET'}).model,'other');
});
test('server rejects oversized versions, malformed ids and sensitive or invalid diagnostic values',()=>{
 const report=makeDiagnosticReport({code:'schema_mismatch'},'0.1.16',156,id);
 for(const mutate of [v=>v.reportId='secret',v=>v.chromeMajor=-1,v=>v.diagnostic.code='raw-provider-message',v=>v.diagnostic.validationCounts={inputBlocks:'SECRET'}]){const v=structuredClone(report);mutate(v);assert.throws(()=>validateDiagnosticReport(v));}
});
