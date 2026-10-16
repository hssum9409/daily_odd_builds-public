# README 이미지 출처와 재현 범위

2026-10-17. 홍보·웹 이미지는 성실삐 0.6.1 작업본, Windows 위젯·설정 이미지는 0.6.4 작업본으로 제작했습니다. 공개 ZIP 버전은 [다운로드 페이지](https://bbi.hssum.kr/download)에서 확인합니다.

Day 001의 대표 이미지 → 빠른 시작 → 기능별 화면 → 접힌 상세 안내, Day 002의 가로/정사각 홍보물과 실제 UI 예시 구분, Day 003의 한 문장 헤드라인과 기능 중심 설명을 참고했습니다. 다른 프로젝트의 캐릭터·화면·로고는 복사하지 않았습니다.

| 이미지 | 제작 방식과 범위 |
| --- | --- |
| `hero.png`, `hero.webp` | 내장 imagegen으로 생성한 가로 홍보 이미지. 실제 위젯 렌더와 로봇 아이콘을 참고했습니다. UI와 그림자는 홍보용 연출이며 실제 OS 화면 캡처가 아닙니다. |
| `social-card.png`, `social-card.webp` | 같은 방식의 정사각 홍보 카드. 시작 전·업무·휴식을 소개하며 앱 실측 크기를 나타내지 않습니다. |
| `login-intro.webp` | 사용자가 제공한 로그인 인트로 PNG의 무손실 WebP 변환. 865×777 크기와 디코딩 RGBA 픽셀 일치를 확인했습니다. |
| `widget-cream-*.png`, `widget-dark-*.png` | 실제 Windows PowerShell 5.1/WPF 위젯 렌더러에 예시 기록을 넣은 RenderTargetBitmap 출력. 마우스를 올렸을 때의 불투명도 95%로 촬영했습니다. Mac 화면이나 실제 사용자 기록이 아닙니다. |
| `feature-widgets.png` | 위 WPF 출력 여덟 장과 설명을 문서용 HTML에 배치해 Chrome으로 캡처했습니다. 위젯 내부 UI는 재제작하지 않았습니다. |
| `settings-*.png` | 실제 Windows 설정창의 WPF 콘텐츠 렌더링. 크림·차콜 미리보기, 색·투명도, 로그인, 만든놈 화면입니다. OS 창 테두리는 포함하지 않습니다. |
| `web-today.png`, `web-week.png`, `web-month.png`, `web-editor.png` | 실제 제품의 Tracker·Timeline·Records·Statistics·Editor 컴포넌트를 문서용 프레임에서 Chrome으로 캡처. 날짜·이름·시간은 예시 데이터입니다. 운영 API와 Firebase 계정에 연결하지 않았고 저장도 수행하지 않습니다. |
| `web-login.png`, `web-login-mobile.png` | 실제 AuthScreen 컴포넌트를 데스크톱/390px 폭 Chrome으로 캡처. 모바일 브라우저 폭의 예시이며 Android/iOS 실기기 화면이 아닙니다. |

웹 예시는 `demo@example.com`이라는 예약된 예시 주소를 사용합니다. 계정·토큰·실제 이메일·개인 업무 기록·운영 메일을 포함하지 않습니다. Google Fonts 다운로드 이외의 외부 요청은 캡처 브라우저에서 차단했습니다. 캡처 도구는 현재 제품의 컴포넌트와 CSS를 가져오며, 문서 프레임의 탐색 UI와 샘플 데이터는 별도입니다. 기능 연동·저장 성공·기기 간 동기화를 입증하는 테스트가 아닙니다.

## 다시 만들기

Windows 위젯/설정 화면은 OS PowerShell 5.1에서 `desktop/windows/Verify-Theme.ps1 -Media -OutputDirectory <임시 출력 폴더>`로 생성합니다. QA 프로필과 실제 사용자 프로필은 분리됩니다. `-Media`는 선명한 호버 상태와 창 콘텐츠 영역을 캡처합니다.

웹/위젯 비교 화면은 `npm run dev`로 실행한 뒤 `/tools/media/preview.html?screen=today`를 엽니다. `statistics`, `edit`, `login`, `widgets` 화면을 제공합니다. 해당 진입점은 개발 도구이며 프로덕션 `web/main.tsx`에서 가져오지 않습니다. 예시 편집창의 저장은 비활성 동작으로 서버를 변경하지 않습니다.

Playwright가 설치된 개발 환경에서는 앱 루트에서 `node tools/media/capture-web.cjs`로 웹 캡처를 다시 만듭니다. 기존 번들에 포함된 Playwright를 쓰려면 `NODE_PATH`를 해당 `node_modules`로 지정할 수 있습니다. 문서 도구 전용이며 앱 사용자의 설치 요건은 아닙니다. 캡처 중 `npm run dev`는 127.0.0.1:5178에서 실행 중이어야 합니다.

가로 히어로와 정사각 카드의 원본 PNG는 보존했습니다. README용 WebP는 무손실 형식 변환이며 디코딩한 RGBA 픽셀 일치를 확인합니다. 제작 프롬프트와 자산 권리는 [ARTWORK.md](ARTWORK.md)에 기록했습니다.

공개 README 스냅샷에 이 문서를 넣을 때는 `docs/images/`, `docs/ARTWORK.md`, `desktop/assets/robot.png`도 함께 포함해야 합니다.
