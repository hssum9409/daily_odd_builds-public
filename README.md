# daily_odd_builds

매일 하나의 생각을 실제로 작동하는 소프트웨어로 만들어 끝내는 프로젝트.

유용한 도구, 기술 데모, 게임, 자동화, 장난감 등 서로 독립적인 프로그램을 계속 만듭니다. 규모나 실용성보다 오늘 새로운 결과물 하나를 실제로 완성하는 것을 우선합니다.

## 배포와 다운로드

이 저장소는 `daily_odd_builds`의 공개 배포 저장소입니다. 프로그램별 배포물, 릴리즈 안내와 사용 방법을 이곳에서 제공합니다.

- [릴리즈 및 다운로드](https://github.com/hssum9409/daily_odd_builds-public/releases)

## 소스 공개 원칙

코드 공개가 필요한 경우에만 릴리즈 버전의 소스 스냅샷을 게시합니다. 개발 커밋 이력은 옮기지 않으며, 이 저장소는 공개 문서와 배포물, 릴리즈 소스를 위한 독립적인 이력을 관리합니다.

각 프로그램의 실행 환경, 설치 방법과 확인된 한계는 해당 릴리즈 안내에 기록합니다.

<!-- day001:start -->
## Day 001 — Codex Usage Monitor

Codex Pet 옆에 사용량·초기화권·잔여 크레딧·리셋 예고를 표시하는 작은 모니터입니다.

[소개와 사용 방법](day-001-codex-usage-scripts/README.md) · [다운로드 · 1.4.13](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day001-v1.4.13)

Windows 설치형·포터블을 제공합니다. Mac 설치형·포터블은 실기기 미검증 preview입니다.
<!-- day001:end -->

<!-- day002:start -->
## Day 002 — 푸시알림 띄워줘

원하는 시간에 나와 그룹에게 보내는 예약 Push. 매일 반복도 예약 1개로, 사이트를 닫아도 받아보세요.

[서비스 열기](https://dingdong-to-me.web.app/) · [소개와 사용 방법](day-002-push-me/README.md) · [웹서비스 릴리즈 · v1.0.0](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day002-web-v1.0.0) · [구조 설명](day-002-push-me/docs/ARCHITECTURE.md)

Web / PWA · Google 로그인 · 개인 Chrome Push 실제 수신/클릭 확인. iPhone은 홈 화면 설치가 필요하며 실기기 수신은 미검증입니다. 원본 소스는 비공개입니다.
<!-- day002:end -->

<!-- day003:start -->
## Day 003 — 디시 스크롤 도우미

긴 디시 글에서도 댓글·댓글쓰기·글 목록·맨 아래로 이동하는 작은 탐색 패널입니다. 색·크기·위치·버튼 순서·여러 줄 배치와 최대 10개 커스텀 갤러리를 설정할 수 있습니다. 기본 키와 사용자 지정 단축키를 지원하며 입력창에서는 실행하지 않습니다.

[Chrome 웹 스토어에서 설치](https://chromewebstore.google.com/detail/ncfjoncjghbhknfmlnniciobbddebnff) · [소개와 사용 방법](day-003-dcinside-scroll-helper/README.md) · [릴리즈 · 1.5.0](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day003-v1.5.0) · [개인정보처리방침](https://daily-odd-builds-portal.web.app/privacy/dcinside-scroll-helper)

1.5.0 ZIP·소스 공개 / 스토어 업데이트 미제출 · Chrome Extension Manifest V3 · PC 일반·마이너·미니 갤러리 지원 · 설정과 최근 갤러리는 로컬 저장. 출시 버전 소스 공개, 코드 MIT. DCInside 비공식 도구입니다.
<!-- day003:end -->


## Day 005 · 성실삐🤖

업무·휴식 시간 기록. [웹](https://bbi.hssum.kr/) · [Windows / macOS 다운로드](https://bbi.hssum.kr/download) · [안내·공개 소스](day-005-seongsilbbi/README.md). [릴리스 · 0.6.4](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day005-v0.6.5). Windows/Web beta, macOS preview.

<!-- day008-token-scale:start -->
## Day 008 · 마 니 토큰 좀 쓰나?

토큰은 썼고, 자랑할 곳은 필요하니까. Codex 통계를 닉네임 랭킹·업적 도감·조합형 아바타로 즐기는 커뮤니티입니다.

[웹에서 보기](https://token-arena-hssum9409.web.app/) · [소개와 사용 방법](day-008-token-scale/README.md) · [Windows / macOS 다운로드](https://token-arena-hssum9409.web.app/download/) · [릴리스 · 0.4.0](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day004-cli-v0.4.0)

30초 로컬 조회·변경분만 전송, 서버 랭킹 6시간 집계. Windows 실제 실행 확인 · macOS 실기기 미검증 preview. 비공식 재미용 community-reported 통계이며 공개 참가는 선택입니다.

공개 포털 **Day 008 · 2026-10-19** · [포털 기록](https://daily-odd-builds-portal.web.app/detail?id=day-2026-10-19) · 제작 누적 **276,674,216토큰** (2026-10-22 07:46 KST, 캐시 입력 포함). [집계 기준](day-008-token-scale/docs/TOKEN-USAGE.md)
<!-- day008-token-scale:end -->

<!-- day006:start -->
## DC 계정 인증 / SSO · 공개 포털 Day 007

내 사이트에도 디시 인증 로그인. SSO로 로그인받거나, 기존 회원에게 계정 인증만 연결할 수 있는 비공식 웹서비스입니다.

[서비스 열기](https://dc-identity.web.app/) · [소개와 기능 이미지](day-006-dc-identity/README.md) · [개발자 연동 가이드](https://dc-identity.web.app/?guide=1&section=examples) · [화면 체험](https://dc-identity.web.app/examples/) · [공개 포털](https://daily-odd-builds-portal.web.app/detail?id=day-2026-10-18)

Web · Google/아이디 로그인 · 계정 인증 API / OpenID Connect · 기록된 누적 토큰 **314,135,620** (2026-10-22, 캐시 입력 포함). 서비스와 안내·이미지만 공개하며 앱·서버 원본 소스와 운영 설정은 비공개입니다.
<!-- day006:end -->

<!-- day010-gpichan:start -->
## Day 010 · 지피쨩

책상 옆 Android 파트너를 쓰다듬고, 기존 Codex Desktop 대화에 피드백을 보내세요. [소개와 기능 이미지](day-010-gpichan/README.md) · [다운로드 · 0.5.1 공개 베타](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day010-gpichan-v0.5.1) · [설치·연결](day-010-gpichan/QUICKSTART.md) · [포털 기록](https://daily-odd-builds-portal.web.app/detail?id=day-2026-10-21)

Windows/Android beta, macOS 실기기 미검증 preview. 창 없는 CLI 호스트와 Android 2D 파트·메시 캐릭터. 전체 개발 소스는 비공개입니다. 포털 Day 010 기록일 2026-10-21 · 실제 공개 2026-10-22. [검증 범위](day-010-gpichan/VERIFICATION.md) · [제작 누적 토큰](day-010-gpichan/TOKEN-USAGE.md).
<!-- day010-gpichan:end -->

<!-- day011-dungeon:start -->
## Day 011 · 던전 하청업자 생존기

던전도 하청의 시대. 한 던전을 설계·증축하고 몬스터 직원들과 여러 원청의 침입을 막는 도트 경영·자동 방어 게임입니다. 급여·산재·위약금까지 사장님 몫입니다.

[게임 시작](https://daily-odd-builds-dungeon.web.app/) · [소개·기능 이미지](day-011-dungeon-subcontract/README.md) · [0.13.0 웹 배포 ZIP](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day011-dungeon-v0.13.0) · [처음 시작하기](day-011-dungeon-subcontract/QUICKSTART.md) · [포털 기록](https://daily-odd-builds-portal.web.app/detail?id=day-2026-10-22)

Web / 싱글플레이 MVP · 7×11부터 30×30까지 · 명시적 초안 저장·자동 영업·몬스터 인사카드·로컬 저장 코드·오프라인 영업. 포털 Day 011 기록일 2026-10-22, 실제 공개 2026-10-23. [제작 토큰 집계](day-011-dungeon-subcontract/TOKEN-USAGE.md) · [검증 범위](day-011-dungeon-subcontract/VERIFICATION.md). 개발 원본과 이력은 비공개입니다.
<!-- day011-dungeon:end -->

<!-- day012-oclock:start -->
## Day 012 · o'clock catcher

매시 정각에 가장 가까운 순간을 잡고, 우승 이미지와 문구로 한 시간의 주인공이 되는 익명 타이밍 게임입니다.

[정각 잡기](https://oclock-catcher-20261027.web.app/) · [소개와 사용 방법](day-012-oclock-catcher/README.md) · [릴리즈 0.1.2](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day012-web-v0.1.2) · [데이터 보관 안내](https://oclock-catcher-20261027.web.app/privacy.html) · [포털 기록](https://daily-odd-builds-portal.web.app/detail?id=day-2026-10-23)

Web / Mobile Web MVP · 로그인 없이 익명 참가 · 정각 전후 3초, 익명 신원당 1회 · 우승자만 이미지 전송. 포털 Day 012 기록일 2026-10-23, 실제 공개일은 제품 안내를 따릅니다. 원본 소스와 개발 이력은 비공개입니다. [제작 토큰 집계](day-012-oclock-catcher/TOKEN-USAGE.md).
<!-- day012-oclock:end -->
