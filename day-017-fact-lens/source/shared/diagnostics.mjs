// This closed allowlist is shared by the extension and report server.
const choices = {
 requestedTier:['fast','default'], wireTier:['priority','fast','default','omitted'], effectiveTier:['fast','priority','default','flex','scale','ultrafast','unreported'],
 requestFormat:['json_schema','prompt_json'], responseFormat:['json_schema','json_object','text','unspecified'],
 transport:['json','sse','sse-header-mismatch'], status:['completed','other'], validation:['source_mapping','brief_reason'],
 validationCode:['analysis_shape','claim_limit','group_id','group_bounds','aspect_bounds','quote_ambiguous','quote_mismatch','origin_missing','source_unknown','coverage_group','promotional_link','coverage_conflict','coverage_missing','invalid_reason'],
 code:['no_independent_sources','ok','empty_output','invalid_json','schema_mismatch','refusal','http_error','transport_error','response_too_large','empty_response','unexpected_html','unexpected_json','not_completed','provider_error','invalid_sse','not_streaming','network_error'],
 errorCategory:['tier_rejected','structured_format_rejected','input_format_rejected','context_limit','model_unavailable','access_rejected','unspecified'],
 errorShape:['detail_array','detail_string','detail_object','error_string','error_object','message_string','unknown'],
 tierReason:['parameter_unsupported','not_allowed','unsupported_value','unspecified'], parameter:['service_tier','text.format','input'],
 providerCode:['unspecified','invalid_grant','invalid_request_error','invalid_request','permission_denied','rate_limit_exceeded','server_error','model_not_found'],
};
const counts = ['inputBlocks','maximumClaims','actualClaims','missingBlocks','matchingBlocks','searchCalls','completedSearchCalls','discoveredSources','acceptedSources'];
const integers = ['attempt','httpAttempt','httpStatus','textLength'];
const compatibility = ['standard_fallback','fast_alias','tier_omitted','prompt_json'];
const outputTypes = ['message','reasoning','web_search_call','other'];
export function safeDiagnostic(value = {}) {
 const out = {};
 if(typeof value.phase==='string')out.phase=/^주요 주장 \d+ 검증$/.test(value.phase)?'주요 주장 검증':['전체 맥락 분석','이미지 인식','본문 요약','요약정리','주장 추출','주장 검증','주요 주장 검증'].includes(value.phase)?value.phase:'기타';
 if(typeof value.model==='string')out.model=/^gpt-\d+(?:\.\d+)?(?:-(?:sol|terra|astra|luna|mini|nano|pro|codex))*(?:-\d{4}-\d{2}-\d{2})?$/.test(value.model)?value.model:'other';
 for(const [key,allowed] of Object.entries(choices))if(Object.hasOwn(value,key))out[key]=allowed.includes(value[key])?value[key]:'other';
 for(const key of integers)if(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=10000000)out[key]=value[key];
 if(Object.hasOwn(value,'contentType'))out.contentType=['application/json','text/event-stream','text/plain','text/html','unspecified'].includes(value.contentType)?value.contentType:'other';
 if(Array.isArray(value.compatibility))out.compatibility=[...new Set(value.compatibility.filter(v=>compatibility.includes(v)))].slice(0,4);
 if(Array.isArray(value.outputTypes))out.outputTypes=value.outputTypes.slice(0,100).map(v=>outputTypes.includes(v)?v:'other');
 if(value.validationCounts&&typeof value.validationCounts==='object')out.validationCounts=Object.fromEntries(counts.filter(key=>Number.isSafeInteger(value.validationCounts[key])&&value.validationCounts[key]>=0&&value.validationCounts[key]<=10000000).map(key=>[key,value.validationCounts[key]]));
 return out;
}
export function makeDiagnosticReport(diagnostic, version, chromeMajor, reportId) {
 return { schemaVersion:1, reportId, extensionVersion:version, chromeMajor, diagnostic:safeDiagnostic(diagnostic) };
}
export function validateDiagnosticReport(value) {
 const keys=['schemaVersion','reportId','extensionVersion','chromeMajor','diagnostic'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||value.schemaVersion!==1||!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value.extensionVersion)||!/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(value.reportId)||!Number.isSafeInteger(value.chromeMajor)||value.chromeMajor<0||value.chromeMajor>1000)throw Error('invalid_report');
 const clean=safeDiagnostic(value.diagnostic);
 // Deep equality by sorted keys, including nested count keys. Unknown data is rejected.
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 if(!value.diagnostic||!Object.hasOwn(clean,'code')||JSON.stringify(stable(clean))!==JSON.stringify(stable(value.diagnostic)))throw Error('invalid_diagnostic');
 return {...value,diagnostic:clean};
}
