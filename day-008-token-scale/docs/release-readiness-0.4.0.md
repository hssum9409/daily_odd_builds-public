# Day 008 / 0.4.0 공개 후 확인 · 2026-10-22 KST

- [서비스](https://token-arena-hssum9409.web.app/) / [다운로드](https://token-arena-hssum9409.web.app/download/)
- [공개 README·소스](https://github.com/hssum9409/daily_odd_builds-public/tree/main/day-008-token-scale)
- [정식 릴리스](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day004-cli-v0.4.0)
- [Portal Day 008](https://daily-odd-builds-portal.web.app/detail?id=day-2026-10-19)

GitHub 정식 공개 시각은 2026-10-21T22:34:44Z(한국 10월 22일)이다.
현재 공개 소스는 독립 공개 저장소의 스냅샷이며 비공개 개발 이력은 옮기지 않았다.
개발 경로·브랜치와 업데이트 채널은 호환성을 위해 기존 식별자를 보존한다.

## 배포 파일과 업데이트

Windows 설치 ZIP, Mac Intel/Apple Silicon 설치 tar.gz, 각 네이티브 업데이트 파일,
SHA256SUMS.txt의 7개 자산을 공개 HTTPS 주소에서 다시 다운로드했다. 크기·GitHub
SHA-256 digest·로컬 원본 해시가 모두 일치했다. Windows ZIP의 17개 내부 파일과
LF 매니페스트 해시도 일치했다.

기존 공개 0.3.1 AOT를 별도 Windows 폴더의 설치 레이아웃(runtime·versions·소유 marker)에서
실행하고 실제 GitHub feed로 update를 호출했다. 0.4.0 다운로드·해시·버전 probe·current
포인터 변경이 성공했다. 계정 연결·시작 프로그램·운영 설치를 변경하지 않았다.
이는 수동 업데이트 명령 검증이며, 실제 운영 데몬의 다음 6시간 자동 확인을 기다린 시험은 아니다.

macOS 두 아키텍처의 네이티브 CI와 이전 실제 Windows/합성 원본 시험 범위는
[0.4.0 검증 기록](verification-0.4.0.md)에 구분했다. **물리 Mac 실기 검증은 여전히 남아 있다.**

## 이미지와 아이콘

Hero·정사각 홍보 카드·랭킹·업적·프로필의 다섯 홍보 이미지와 브랜드 아이콘을 공개했다.
사용자 지정 가상 닉네임과 홍보 연출 주석을 확인했다. PNG 원본·무손실 WebP·실제
프롬프트·해시를 보존했다. 문안·아트디렉션은 GPT-6 Astra High, 비트맵은 내장 imagegen이다.

아이콘 master SHA-256은 `87fdedaba8fb9d68da7298fe1b5f1075e5b4478a8935459cbbf66626a0570e1f`이다.
10개 PNG 크기, 16/32/48 ICO, Apple touch, PWA any/maskable 192/512와 HTML 스플래시를
반영했다. 이전 favicon·Icon-192/512·maskable 주소의 내용도 교체했다. 운영 사이트에서
새 PNG 10개와 이전 주소 7개의 바이트를 로컬 원본과 비교해 일치를 확인했다.
홈·다운로드·개인정보 경로의 icon 메타데이터와 manifest를 확인했다.

브라우저에서 실제 브랜드 스플래시를 관측했고 본 화면 진입 후 제거됨을 확인했다.
PWA를 실제 OS에 새로 설치하거나, 이미 설치된 OS 아이콘·iOS 시스템 시작 화면을
기기에서 확인한 시험은 아니다. `manifest`와 웹 로딩 화면 제공, 물리 OS 검증을 구분한다.
초기화는 [Flutter 공식 bootstrap API](https://docs.flutter.dev/platform-integration/web/initialization)를 사용한다.

## 실제 웹과 Portal

브라우저 검증 경로는 다운로드 → 네 언어 선택 → 3개 0.4.0 설치 링크 확인,
홈 → 브랜드 로딩 → 정상 랭킹 화면, Portal Day 008 → Hero·소개·배포 링크 표시였다.
Browser 플러그인이 없어 연결된 Chrome의 CUA/Playwright 경로로 검사했다.
이 경로의 콘솔 error/warn은 0개였다. 실제 브라우저 화면을 로컬 검증 기록으로 저장했다.

최초 등록 시 Portal은 기존 공개 기록 7개를 보존하고 Day 008만 추가해 8개가 되었다.
다른 프로젝트의 미공개 초안을 함께 게시하지 않았다. Day 008 날짜 슬롯(2026-10-19)과
실제 소개/배포 작업일(2026-10-22)을 본문에서 구분했다.

운영 API 설정 GET 200, 비인증 stream-patch 401, Firestore/RTDB Rules 원본 일치를
확인했다. 시간별 flushUsage와 6시간 publishRankings Scheduler는 ENABLED였다.
이번 공개 점검에서 Google 신규 가입·새 실제 사용자 통계 업로드·계정 삭제를 다시 실행하지 않았다.
래스터 홍보 이미지는 실제 통계·설치·로그인 성공의 증거로 사용하지 않는다.

## 공개 기록 보완 · 2026-10-22 07:50 KST

사용자 요청으로 Day 001부터 기존 소개·토큰 필드와 Day 004·006 실패 문구를 확인했다.
Day 008(2026-10-19)에 제작 누적 **276,674,216토큰**과 집계 시점·범위를 추가하고,
공개 README에 같은 수치와 [집계 기준](TOKEN-USAGE.md)·[JSON](usage-summary.json)을 넣었다.
2026-10-22 07:46 KST까지 확인한 주 작업·소개 보조 작업의 2개 고유 세션 합계이며,
재개 전·후 누적값, 캐시 입력, reasoning을 중복해서 더하지 않았다.
서비스에 제출한 계정의 lifetime 통계와 다른 제작 기록이다.

[Day 009](https://daily-odd-builds-portal.web.app/detail?id=day-2026-10-20)는 사용자 지정대로
2026-10-20 실패 기록으로 게시했다. 제목은 ‘오늘은 완성을 못 데려왔다...’,
코멘트는 ‘하루 한 개라 해놓고 빈손으로 왔네... 실패라도 기록은 해야제. 좀 봐주이소... :(’이다.
토큰 수는 근거가 없어 0으로 채우지 않고 미기록으로 두었다.

다른 공개 기록 7개와 본문을 그대로 보존하고, 미공개 초안은 함께 게시하지 않았다.
비로그인 Firestore REST로 9개 발표(성공 6·실패 3), 총 1,328,257,086토큰을 확인했다.
실제 Chrome에서 Day 008 날짜·Hero·제작 토큰·소개와 Day 009 날짜·실패 표시·코멘트를 확인했고,
두 상세 페이지의 console error/warn은 0개였다.

공개 GitHub README에서 Hero·정사각 카드·랭킹·업적·프로필 이미지 5개의 정상 로드와
원본 크기를 확인했다. 공개 HTTPS로 받은 WebP 바이트가 로컬 최종 편집본과 모두 일치했다.
최종 닉네임 편집본을 사용하며 수치와 화면은 홍보 연출임을 표시한다.
공개 스냅샷 94개 파일의 Markdown 링크와 비밀정보 패턴 검사도 통과했다.
