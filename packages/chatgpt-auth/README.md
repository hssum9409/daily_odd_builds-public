# ChatGPT auth · 0.1.0

Chrome Manifest V3 확장용 ChatGPT 로그인 공통 코드입니다. Day 17 팩트렌즈, Day 18 지피쨩 나무위키 OX 퀴즈, 디시 글쓰기 개발판에서 사용합니다. MIT 라이선스이며 외부 npm 의존성은 없습니다. npm 레지스트리 게시 없이 이 저장소에서 버전별로 배포합니다.

## 포함하는 기능

- PKCE, state, nonce, 로그인 탭 및 정확한 loopback 콜백 검증
- OpenID Connect 서명·issuer·audience·만료·계정 subject 검증
- 비내보내기 AES-GCM 키와 IndexedDB를 이용한 연결 정보 저장
- 서비스 워커가 소유하는 직렬 토큰 갱신과 로그아웃
- 일반 Chrome 창이 열려 있을 때 갱신 토큰 만료 약 10일 전부터 자동 갱신, 일시 오류 재시도
- 서비스 워커 종료와 브라우저 재시작 후 복원

모델 선택, Fast 옵션, 프롬프트, 제품 UI는 소비 앱이 관리합니다. 로그인 코드가 같아도 확장마다 저장소·host ID·발급 client ID·토큰이 독립적입니다. 이미 설치된 확장은 기존 확장 ID, 로드 경로와 암호화 namespace를 유지해야 연결 정보를 계속 읽을 수 있습니다.

## 앱에 포함하기

Node.js 22 이상에서 이 모듈과 대상 앱을 내려받고 실행합니다. 대상 앱에는 `extension/manifest.json`과 `scripts/` 또는 `tools/` 디렉터리가 있어야 합니다.

```sh
node packages/chatgpt-auth/tools/vendor.mjs /path/to/app
```

앱 `package.json`에 검증한 버전을 고정합니다.

```json
{"chatgptAuth":{"version":"0.1.0"}}
```

이 명령은 `extension/vendor/chatgpt-auth/`에 실행 코드·MIT 라이선스·버전 및 SHA-256을 담은 `module.json`을 만들고, 앱 빌드 도구 디렉터리에 `verify-auth.mjs`를 복사합니다. 앱의 빌드·검사·패키징 진입점에서 `import './verify-auth.mjs';`로 검사합니다. 자동 업데이트나 CDN 로드는 하지 않습니다. 공개된 앱 소스에도 이 사본이 들어 있으므로 공통 저장소 없이 독립 빌드할 수 있습니다.

## 앱별 연결 예시

```js
import {createCredentialStore} from './vendor/chatgpt-auth/credentials.js';
import {ChatGPTConnection} from './vendor/chatgpt-auth/connection.js';
import {createChromeAuthService,isAllowedSender} from './vendor/chatgpt-auth/chrome.js';

const {credentialStore}=createCredentialStore({
  databaseName:'my-extension-credentials',
  encryptionContext:'my-extension:credentials:v1'
});
const auth=createChromeAuthService({
  connection:new ChatGPTConnection({appName:'My extension',store:credentialStore}),
  callbackPage:null
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!isAllowedSender(sender,['panel.html']))return;
  const actions={status:auth.status,login:auth.login,token:auth.token,
    cancel:()=>auth.cancel(),logout:auth.logout};
  if(!Object.hasOwn(actions,message?.type))return;
  actions[message.type]().then(data=>reply({ok:true,data}),
    error=>reply({ok:false,error:error.message}));
  return true;
});
```

`token` 요청은 신뢰하는 자체 확장 페이지만 허용해야 합니다. content script나 외부 페이지에서 토큰을 요청하도록 중계하지 마세요. 기본 `auth.changed` 메시지에는 토큰이 없습니다. 자체 결과 페이지를 사용하려면 `callbackPage`에 실제 확장 HTML 경로를 지정합니다. `null`이면 로그인 완료 후 해당 로그인 탭을 닫습니다.

`createChromeAuthService`는 Chrome 이벤트 리스너를 등록하므로 서비스 워커의 최상위에서 한 번 생성합니다. `setupStorage`로 기존 데이터 마이그레이션, `onLogout`으로 제품별 임시 데이터 정리, `changedMessage`와 `onDiagnostic`으로 기존 알림 규약을 연결할 수 있습니다. `run`은 제품 작업을 인증 큐에 직렬 연결합니다. `sessionStatus`는 기존 패널 호환용 `{account,pending}` 형태를 반환합니다.

필요 권한은 `storage`, `alarms`, `webRequest`와 `https://auth.openai.com/*`, `http://127.0.0.1/*` 접근입니다. 실제 모델 요청에는 소비 앱이 `https://api.openai.com/*` 접근을 별도로 선언합니다. 예시는 완성된 확장 manifest를 대신하지 않습니다.

## 공개 배포와 데이터

OpenAI의 [공개 소스 앱용 로그인 지침](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)에 따라 최초 등록과 재연결을 구분합니다. secret이나 개인 토큰을 소스·ZIP에 넣지 않습니다. 실제 발급된 client ID와 host ID는 사용자별 로컬 저장소에서 유지하며 제품끼리 복사하지 않습니다. 이 코드는 OpenAI 공식 SDK가 아닙니다.

별도 개발자 서버는 사용하지 않습니다. 로그인·갱신·폐기는 OpenAI와 통신하며, 로컬 실행이 오프라인 인증을 뜻하지 않습니다. 외부 로그 수집이나 분석 기능은 없습니다. 라이브러리가 오류 진단에 사용하는 값은 단계·HTTP 상태·MIME뿐입니다. 액세스/갱신 토큰과 사용자 데이터는 배포물에 포함하지 않습니다.

앱마다 기존 개인정보처리방침, 전송 데이터 안내와 권한 설명을 유지해야 합니다. OpenAI 지침 준수 및 Chrome 심사 여부를 이 모듈의 공개 자체가 보증하지 않습니다. MV3 실행 코드는 [Chrome의 원격 호스팅 코드 규칙](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)에 맞게 앱 패키지 안에 포함합니다.

## 검증과 업데이트

```sh
cd packages/chatgpt-auth
npm run check
npm test
```

OAuth 검증·저장 형식·갱신·재시작·namespace 격리를 포함한 로컬 테스트입니다. 모듈을 수정하면 버전을 올린 뒤 소비 앱의 pin과 사본을 갱신하고, 앱별 Chrome 로그인·재시작·패키징 검사도 실행합니다. `module.json`의 해시는 변경 실수를 검출하기 위한 것이며 배포자의 전자서명을 대신하지 않습니다.

이전 배포 태그는 유지하고 새 태그 `chatgpt-auth-v0.1.0`으로 공개합니다. 공개 소스에는 비공개 개발 저장소 이력이나 개인 프로필이 포함되지 않습니다. 실제 계정의 신규 로그인·모델 호출과 실제 20/30일 경과는 이번 공통화 검증 범위에 포함되지 않습니다.
