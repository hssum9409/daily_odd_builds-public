# 개발과 로컬 검증

공개 릴리즈 소스의 `extension/`을 그대로 Chrome 개발자 모드에서 로드할 수 있습니다. 설치용 실행 ZIP에는 해당 디렉터리의 런타임 파일만 포함합니다.

검사에는 Node.js 22 이상과 Python 3.11 이상을 사용합니다. 런타임 npm 의존성은 없습니다.

```text
npm run check
npm test
npm run package
```

브라우저 검사는 개발용 Playwright와 Chrome이 필요합니다. `DC_WRITER_PLAYWRIGHT`에는 설치된 Playwright index.mjs 경로, `DC_WRITER_CHROME`에는 Chrome 실행 파일 경로, `DC_WRITER_QA_OUT`에는 별도 비공개 검사 폴더를 지정할 수 있습니다.

```text
npm run qa
npm run qa:restart
npm run qa:background
```

위 검사는 합성 OAuth·모델·편집기를 사용하며 운영 서비스의 성공 증거가 아닙니다. `npm run qa:live`는 실제 디시 기본 업로더에 임시 테스트 사진을 업로드합니다. 실제 업로드를 의도할 때만 실행하세요. 게시하지 않으며 서버의 임시 파일 삭제를 보장하지 않습니다.

`core.js`: 글쓰기 프롬프트·문서 검증·HTML 렌더링. `panel.js`: 사용자 흐름. `editor.js`: 디시 Summernote와 기본 업로더 연결. `photos.js`: 기기 사진·초안 저장. `network.js`: 모델 조회·Responses SSE. `auth.js`/`background.js`: 고정된 인증 모듈과 패널 연결. `vendor/chatgpt-auth`: 공개된 MIT 인증 모듈의 버전·해시 고정 사본.

GitHub Actions는 사용하지 않습니다. 변경 후 로컬에서 검사하고 공개 릴리즈는 직접 업로드합니다. 테스트 프로필·로그·인증정보를 소스나 릴리즈에 포함하지 마세요.
