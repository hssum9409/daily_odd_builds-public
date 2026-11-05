// Development browser launcher only. The installed extension needs neither this process nor a server.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv.includes('--automated')){
  console.log(`실계정 로그인은 일반 Chrome에서 확인하세요.\nchrome://extensions → 개발자 모드 → 압축해제된 확장 프로그램 로드\n확장 폴더: ${path.join(root,'extension')}\n확장 아이콘으로 패널을 열고 ChatGPT로 계속하기를 누르세요.\n자동화 UI 개발 창은 npm run dev -- --automated 로만 엽니다.`);
  process.exit(0);
}
const {chromium}=await import(process.env.DC_WRITER_PLAYWRIGHT?pathToFileURL(process.env.DC_WRITER_PLAYWRIGHT).href:'playwright');
const out=path.resolve(process.env.DC_WRITER_QA_OUT || path.join(root,'.private','manual'));
await fs.mkdir(out,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(out,'manual-profile'),{...(process.env.DC_WRITER_CHROME?{executablePath:process.env.DC_WRITER_CHROME}:{}),headless:false,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-first-run'],viewport:null});
const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:path.join(root,'extension')});
const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/panel.html`);
const report={started:new Date().toISOString(),browser:context.browser().version(),realProvider:true,connected:false,modelList:false,generationCompleted:false};
let writing=Promise.resolve();
async function save(){writing=writing.then(()=>fs.writeFile(path.join(out,'auth-live-result.json'),JSON.stringify(report,null,2)));await writing;}
panel.on('response',async response=>{
  const u=new URL(response.url());
  if(u.origin==='https://auth.openai.com'&&u.pathname==='/api/accounts/oauth/token'){report.tokenHttpStatus=response.status();await save();}
  if(u.origin==='https://api.openai.com'&&u.pathname==='/v1/models'){report.modelHttpStatus=response.status();await save();}
});
const timer=setInterval(async()=>{
  try{
    const state=await panel.evaluate(()=>({connected:!document.querySelector('#connected').hidden,models:document.querySelector('#model').value!=='',generated:document.querySelector('#message').textContent.startsWith('초안을 만들었습니다.')}));
    if(state.connected&&!report.connected){report.connected=true;console.log('LIVE_AUTH: connected to real account (identity omitted).');}
    if(state.models&&!report.modelList){report.modelList=true;console.log('LIVE_AUTH: real model list received.');}
    if(state.generated&&!report.generationCompleted){report.generationCompleted=true;console.log('LIVE_AUTH: generation completed.');}
    await save();
  }catch{/* The user may have closed the browser. */}
},2000);
context.on('close',()=>clearInterval(timer));
await save();console.log('Development extension is open in a separate Chrome profile. Sign in and approve access directly in the browser. No local HTTP server is running.');
await new Promise(resolve=>context.on('close',resolve));
