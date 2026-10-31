# 팩트렌즈 오류 리포트 서버

Firebase Functions(Node.js 22)·Firestore 기반 선택형 진단 접수 서버입니다. 본문과 ChatGPT 호출을 중계하지 않습니다. 사용자가 확인하고 전송한 허용 필드만 받고, 페이지 본문·URL·제목·계정·토큰은 받지 않습니다.

## 로컬 검사

Node.js 22 이상, Firebase CLI와 해당 CLI가 요구하는 Java 런타임이 필요합니다. 이 `reporting-server` 폴더에서 실행하세요.

```sh
npm ci --prefix functions
firebase emulators:exec --only firestore --project demo-factlens-report "npm --prefix functions test"
```

테스트는 `FIRESTORE_EMULATOR_HOST`가 없으면 중단하며 운영 Firestore에 쓰지 않습니다. `functions/prepare.cjs`는 상위 `shared/diagnostics.mjs`를 함수 배포 폴더로 복사합니다. 생성 파일은 저장소에서 제외합니다. 로컬 Secret Manager 값이 필요한 HTTP 함수 에뮬레이션에는 Firebase CLI의 `.secret.local` 방식을 사용하고 해당 파일을 커밋하지 마세요.

로컬 검증 호스트는 Node 24.19.0이며 배포 함수 런타임은 Node 22입니다. 잠금 파일의 Firebase SDK 전이 의존성에 moderate 취약점 경고 6개가 남아 있습니다. 이번 소스 스냅샷 공개에서 의존성 버전을 변경하지 않았습니다.

## 직접 운영

자신의 Firebase 프로젝트와 권한을 사용하세요. 서버의 `FACT_LENS_REPORT_RATE_KEY` Secret Manager 값은 직접 생성해야 하며 공개 소스나 확장에 넣지 않습니다. 함수 배포는 해당 프로젝트의 요금제·권한·Firestore 설정에 따라 별도로 준비해야 합니다.

```sh
firebase functions:secrets:set FACT_LENS_REPORT_RATE_KEY --project YOUR_PROJECT_ID
firebase deploy --only functions:factlens-diagnostics --project YOUR_PROJECT_ID
```

이 설정은 함수만 배포하며 다른 서비스의 rules/hosting을 배포하지 않습니다. 독립 프로젝트의 Firestore 접근 규칙과 `factlens_error_reports_v1`, `factlens_error_limits_v1`의 `expiresAt` TTL을 직접 구성하세요. 공유 프로젝트의 기존 rules를 이 예제 파일 전체로 덮어쓰지 마세요. TTL 삭제는 비동기이며 Google Cloud 플랫폼 로그 보관과 별개입니다.

확장의 `extension/diagnostics.js`에 있는 진단 endpoint를 자신의 함수 주소로 변경한 뒤 빌드해야 자신이 운영하는 서버로 연결됩니다. 서버는 CORS를 인증으로 간주하지 않습니다. 저장·접수 제한과 중복 처리 구현은 `functions/service.mjs`, HTTP 입력 처리는 `functions/index.mjs`를 참고하세요.

`admin.mjs`는 기존 운영자의 Windows Firebase CLI 로그인으로 프로젝트 상태·리포트를 관리하는 선택형 도구입니다. 프로젝트 ID가 기존 운영 프로젝트로 지정되어 있으므로 자체 운영에서는 자신의 프로젝트에 맞게 검토·수정해야 합니다. 빌드·테스트에 실행할 필요는 없으며 인증정보 자체는 포함하지 않습니다.
