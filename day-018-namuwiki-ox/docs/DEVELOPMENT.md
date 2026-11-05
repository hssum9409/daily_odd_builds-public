# 공개 소스 개발

0.1.7은 문서·탭을 바꾸면 다음 출제 대상을 자동 반영합니다. 출제·풀이·결과 화면은 현재 탭과 독립적으로 유지하며 문서 변경 안내와 갱신·다시 읽기 버튼을 제거했습니다.

Node.js 22 이상(이번 검사는 24.19.0), Python 3, Chrome을 사용합니다. 확장 자체에는 Node/Python이 필요하지 않습니다.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm run test:browser
npm run test:live-page
npm run package
```

`extension/`이 원본이며 `build`는 동일 파일을 `dist/`에 복사합니다. `package`는 같은 `dist/`와 버전 ZIP·SHA-256을 갱신하고 원본·dist·ZIP의 모든 파일을 비교합니다. Chrome은 동일한 `dist/` 경로를 계속 로드하세요.

`test:browser`는 격리 Chrome에서 합성 본문·OAuth·모델을 사용합니다. `test:live-page`는 실제 나무위키 본문 추출만 확인하며 모델 요청을 보내지 않습니다. 실제 ChatGPT 계정 로그인·모델 호출의 성공 증거와 구분하세요. 로그인한 Chrome 프로필·쿠키·토큰은 테스트에 복사하지 않습니다.

실행 코드의 외부 런타임 의존성은 없습니다. 개발 의존성 Playwright는 Apache-2.0이며 내려받는 브라우저는 해당 제공자의 조건을 따릅니다. GitHub Actions는 사용하지 않으며 빌드·검사·패키징은 로컬에서 수행합니다.
