# ChatGPT 로그인 공통화 · 0.1.22

이번 릴리즈는 인증 코드를 [공통 모듈 0.1.0](https://github.com/hssum9409/daily_odd_builds-public/tree/main/packages/chatgpt-auth)으로 옮겼습니다. 실행 코드는 확장 ZIP에 포함합니다. 원격 코드 로드나 별도 서버를 추가하지 않습니다.

모듈 버전은 `package.json`에 고정하고, 빌드 전에 실행 파일 SHA-256을 검사합니다. 공개 소스에 포함된 사본만으로 독립 빌드할 수 있습니다. 기존 확장 경로와 ID를 유지한 상태로 파일을 갱신하고 Chrome 확장 관리 화면에서 새로고침하세요. 확장을 삭제하거나 재설치할 필요가 없습니다.

앱 이름, 기존 IndexedDB 이름과 암호화 AAD, host/client 식별자, 설정과 갱신 주기는 유지했습니다. 제품 간 계정·토큰·모델 설정은 공유하지 않습니다. 이 변경으로 모델이나 Fast 기본값을 바꾸지 않았습니다.

## 2026-11-01 로컬 검증

- 공통 모듈: 구문 검사와 테스트 39개 통과. OAuth·OIDC 검증, 토큰 수명, 갱신 직렬화·재시도, 암호화·namespace 격리, 정확한 확장 페이지 발신자 검사를 포함합니다.
- 소비 앱: 구문 검사, 기존 단위 검사, 실제 Windows Chrome 156의 격리 프로필 UI·합성 OAuth/모델 흐름과 패키징을 검사했습니다.
- 이전 버전의 실제 저장 코드로 만든 암호화 연결 정보를 새 버전이 읽고, 같은 확장 ID·host/client ID·설정을 유지하는지 확인했습니다. 이후 Chrome 전체 재시작에서도 연결을 복원했습니다.
- 실제 계정의 새 동의·모델 호출·토큰 발급/폐기, 실제 20/30일 경과, Chrome Web Store 설치, macOS/Linux는 이번 검사로 확인하지 않았습니다. 합성 테스트를 실제 계정 검증으로 취급하지 않습니다.

검사 명령은 `npm run check`, `npm test`, `npm run test:browser`, `npm run package`입니다. 추가로 `npm run test:persistence`에서 실제 Chrome 재시작·알람·오프라인 재시도·로그아웃·30일 부재를 합성 시계와 토큰으로 검사했습니다.
