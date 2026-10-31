import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClaims, validateVerdict, readSSE, safeUrl } from '../shared/report.mjs';
test('claims must be exact original quotations; duplicates excluded', () => {
 const article={text:'달은 지구 주위를 공전한다.\n달은 스스로 빛을 낸다.'};
 const claim={claim:'달의 궤도',quote:'달은 지구 주위를 공전한다.'};
 assert.equal(validateClaims({claims:[claim,claim]},article,6).length,1);
 assert.throws(()=>validateClaims({claims:[{...claim,quote:'거짓 인용'}]},article,6));
 assert.equal(validateClaims({claims:[]},article,6).length,0);
});
const sourceResponse={output:[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://science.nasa.gov/moon/',title:'NASA Moon'}]}}]};
test('verdict sources must be attributable to this completed search, unsafe/invented links rejected', () => {
 const verdict={verdict:'supported',explanation:'설명',sources:[{url:'https://science.nasa.gov/moon/',evidence:'근거 요약',relation:'supports'},{url:'https://invented.example/',evidence:'가짜',relation:'supports'}]};
 const result=validateVerdict(verdict,sourceResponse);
 assert.equal(result.verdict,'supported'); assert.equal(result.sources.length,1);
 assert.equal(validateVerdict(verdict,{output:[]}).verdict,'insufficient');
 assert.equal(validateVerdict({...verdict,sources:[{url:'javascript:alert(1)',evidence:'X',relation:'supports'}]},sourceResponse).verdict,'insufficient');
 assert.equal(safeUrl('https://user:password@example.com'),null);
});
function streamResponse(frames) {
 const encoder=new TextEncoder();
 return new Response(new ReadableStream({start(controller){for(const frame of frames)controller.enqueue(encoder.encode(frame));controller.close();}}));
}
test('SSE only accepts completed terminal response and handles chunk and CRLF splits',async()=>{
 const frame=`event: response.completed\r\ndata: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[]}})}\r\n\r\n`;
 assert.equal((await readSSE(streamResponse([frame.slice(0,41),frame.slice(41)]))).status,'completed');
 await assert.rejects(readSSE(streamResponse(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'])));
 await assert.rejects(readSSE(streamResponse(['data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n'])),/한도/);
});
