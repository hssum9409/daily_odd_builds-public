import {createHash,createHmac} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {validateDiagnosticReport} from './diagnostics.mjs';
export const REPORTS='factlens_error_reports_v1', LIMITS='factlens_error_limits_v1';
export class ReportError extends Error{constructor(status,code){super(code);this.status=status;}}
export function createService({db,secret,now=Date.now}){
 if(!secret||secret.length<32)throw Error('server_configuration');
 return async(payload,ip)=>{
  let clean;try{clean=validateDiagnosticReport(payload);}catch{throw new ReportError(400,'invalid_report');}
  const time=now(),day=Math.floor(time/86400000),minute=Math.floor(time/60000);
  const report=db.collection(REPORTS).doc(clean.reportId);
  const fingerprint=createHmac('sha256',secret).update(`${day}:${ip}`).digest('hex');
  const caller=db.collection(LIMITS).doc(`caller-${fingerprint}`),global=db.collection(LIMITS).doc(`global-${day}`);
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  const digest=createHash('sha256').update(JSON.stringify(stable(clean))).digest('hex');
  await db.runTransaction(async tx=>{
   const [existing,u,g]=await tx.getAll(report,caller,global);
   if(existing.exists){if(existing.data().digest!==digest)throw new ReportError(409,'report_conflict');return;}
   const user=u.data()||{},all=g.data()||{};const minuteCount=user.minute===minute?user.minuteCount:0;
   if(minuteCount>=3||(user.dailyCount||0)>=20||(all.count||0)>=1000)throw new ReportError(429,'rate_limit');
   tx.create(report,{...clean,digest,createdAt:Timestamp.fromMillis(time),expiresAt:Timestamp.fromMillis(time+30*86400000)});
   const expiresAt=Timestamp.fromMillis((day+2)*86400000);
   tx.set(caller,{minute,minuteCount:minuteCount+1,dailyCount:(user.dailyCount||0)+1,expiresAt});
   tx.set(global,{count:(all.count||0)+1,expiresAt});
  });
  return {accepted:true,reportId:clean.reportId};
 };
}
