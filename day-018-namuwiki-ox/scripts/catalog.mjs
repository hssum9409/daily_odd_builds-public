import {readFile,writeFile} from 'node:fs/promises';
const m=JSON.parse(await readFile(new URL('../metadata.json',import.meta.url),'utf8'));
const released=!!m.download_url;
const links=released?[{label:`ZIP 다운로드 · ${m.version}`,url:m.download_url},...(m.source_url?[{label:'소개·공개 소스',url:m.source_url}]:[]),{label:'개인정보취급방침',url:'https://daily-odd-builds-portal.web.app/privacy/namuwiki-ox'}]:[];
const draft={id:`day-${m.date}`,date:m.date,published:false,outcome:'success',name:released?m.name:`${m.name} · 로컬 preview`,description:m.one_line_description,type:'Chrome 확장',category:'extension',platform:m.platform,links,tokens:null,sections:[{title:'지피쨩과 OX 한 판',paragraphs:['현재 열어둔 나무위키 본문으로 5~20개의 OX 퀴즈를 만듭니다. 기본은 10문제이며 답을 고른 뒤 해설과 정확한 본문 인용을 확인합니다.','기본 GPT-6.1 Terra와 Fast 켜짐으로 시작하며 설정에서 계정 모델과 처리 옵션을 변경합니다. ChatGPT 로그인과 출제는 OpenAI에 직접 연결하고 자체 서버·외부 검색은 사용하지 않습니다.']},{title:'현재 상태',paragraphs:[m.limitations,released?'ZIP preview와 릴리즈 소스를 공개합니다. Chrome 웹 스토어에는 제출하지 않았습니다.':'아직 공개 다운로드가 없으므로 links는 비워둡니다. 이 후보 파일 생성은 외부 서비스에 쓰지 않습니다.']}]};
await writeFile(new URL('../docs/portal-entry.draft.json',import.meta.url),JSON.stringify(draft,null,2)+'\n');
console.log('Prepared unpublished local portal candidate from metadata.json; no network write.');
