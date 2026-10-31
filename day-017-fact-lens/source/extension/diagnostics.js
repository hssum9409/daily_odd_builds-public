import { makeDiagnosticReport } from '../shared/diagnostics.mjs';
export const REPORT_ENDPOINT='https://asia-northeast3-daily-odd-builds-portal.cloudfunctions.net/factLensDiagnostics';
export function prepareDiagnosticReport(value) {
 const major=Number(navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/)?.[1]||0);
 return makeDiagnosticReport(value,chrome.runtime.getManifest().version,major,crypto.randomUUID());
}
export async function submitDiagnosticReport(payload) {
 const response=await fetch(REPORT_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(response.status===429?'전송 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.':'전송하지 못했습니다. 진단 정보를 복사하거나 잠시 후 다시 시도해 주세요.');
 const value=await response.json();if(value.reportId!==payload.reportId||value.accepted!==true)throw Error('서버의 접수 확인을 읽지 못했습니다. 같은 리포트로 다시 시도할 수 있습니다.');
 return value;
}
