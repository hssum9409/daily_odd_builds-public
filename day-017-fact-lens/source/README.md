# 팩트렌즈 0.1.21 소스

Chrome 사이드패널 확장과 선택형 오류 리포트 서버의 릴리즈 소스 스냅샷입니다. [제품 소개·설치용 ZIP](../README.md) · [MIT 라이선스](LICENSE) · [제3자 고지](extension/THIRD-PARTY-NOTICES.txt)

## 빌드와 설치

Node.js 22 이상, npm이 필요합니다. 아래 명령은 이 `source` 폴더에서 실행합니다. ZIP 생성 스크립트는 시스템 `tar`를 사용하며 Windows 환경에서 검증했습니다.

```sh
npm ci
npm run check
npm test
npm run build
npm run package
```

`dist` 폴더가 압축 해제 확장입니다. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**로 `dist`를 선택하세요. 빌드 도구는 개발자에게만 필요하며, 배포 ZIP을 사용하는 사람에게 Node.js나 로컬 서버는 필요하지 않습니다.

`build/fact-lens-0.1.21.zip`과 SHA-256 파일이 생성됩니다. 잠금 파일의 의존성을 사용하며 `SOURCE-MANIFEST.json`은 공개한 릴리즈 코드 파일의 SHA-256 목록입니다. 재빌드한 JavaScript 등 10개 파일은 기존 0.1.21 설치본과 바이트가 일치합니다. manifest·HTML·CSS·제3자 고지 4개 파일은 LF/CRLF 줄바꿈만 다르며 정규화 후 일치합니다. 소스는 운영체제 간 일관성을 위해 LF로 보관하고 ZIP 컨테이너 자체의 시간 정보 등은 달라질 수 있습니다.

## 코드 구성

- `extension/`: OAuth·토큰 저장/갱신, 페이지 추출·이미지 처리, 모델 요청, 사이드패널 UI.
- `shared/`: 대주장 선정·범위 검사, 구조화 응답, 언어·요약·진단 스키마.
- `scripts/`: 로컬 구문 검사·번들·ZIP 패키징.
- `tests/`: 단위 검사와 격리 Chrome 프로필의 합성 자료·모의 인증/모델 검사.
- `reporting-server/`: 선택형 오류 진단의 Firebase Functions·Firestore 구현과 에뮬레이터 검사.

## Chrome 자동 검사

Chrome이 설치되어 있어야 합니다. Windows Chrome 156에서 확인했으며 사용자 프로필 대신 임시 프로필을 만듭니다.

```sh
npm run test:browser
npm run test:persistence
npm run test:images
npm run test:forum
```

기본 브라우저 검사는 합성 자료와 모의 OpenAI 응답을 사용합니다. 실제 사용자 계정의 로그인·갱신·모델 호출 성공을 입증하지 않습니다. `tests/reporting-live.mjs`는 `FACT_LENS_REPORT_LIVE=1`을 명시했을 때 운영 서버에 합성 리포트를 전송하는 별도 검사이며 기본 검사에 포함되지 않습니다. `FACT_LENS_DC_IMAGE_URLS`를 지정하면 이미지 검사가 지정한 공개 URL에도 접근하므로 기본값에서는 지정하지 마세요.

## 오류 서버

일반 확장 사용·본문 처리·ChatGPT 인증에는 자체 서버가 필요하지 않습니다. 오류 리포트만 별도의 진단 서버를 사용합니다. 직접 운영하려면 [서버 개발 안내](reporting-server/README.md)를 참고하세요. 공개 소스에는 사용자 리포트·계정·토큰·쿠키·Secret Manager 값·서비스 계정 키를 포함하지 않습니다.

## 공개 범위와 라이선스

이 폴더의 자체 작성 확장·서버·검사 코드와 개발 안내는 MIT 라이선스로 공개합니다. 의존성과 Lucide 아이콘 등 제3자 자료에는 각자의 라이선스가 적용됩니다. 상위 제품 소개의 홍보 이미지에는 이 소스 라이선스를 자동 적용하지 않습니다.

비공개 개발 저장소의 이력, 운영 로그·리포트, 개발자 로컬 설정과 배포 인증정보는 포함하지 않습니다. 코드 공개만을 위해 기존 0.1.21 설치 ZIP이나 태그를 교체하지 않습니다. GitHub Actions를 사용하지 않습니다.
