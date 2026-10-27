# 디시 스크롤 도우미 1.6.0 구조

Manifest V3 콘텐츠 스크립트와 서비스 워커로 이루어집니다. 확장 실행에는 빌드나 외부 런타임 의존성이 없습니다. 기본 탐색·설정과 텍스트 공유는 로컬이며, 8자리 코드 공유를 선택할 때만 고정 HTTPS API를 호출합니다.

| 파일 | 책임 |
| --- | --- |
| page-context.js | URL·DOM으로 페이지와 갤러리 종류, 이동 대상·본인 갤로그 확인 |
| navigation.js | 약 200ms ease-in-out 이동, 목적지·바닥 변화 추적과 취소 |
| shortcuts.js | 기본 키·변경·입력 포커스 보호·숨긴 버튼 실행 방지 |
| settings.js | 설정 정규화·10개 슬롯·순서·줄 구분선·최근 두 갤러리 |
| sharing.js | 현재 갤러리 지정, 공유 JSON 허용 형식과 코드 검사 |
| share-client.js | 고정 API 업로드·조회·삭제, 삭제 키의 로컬 보관 |
| background.js | 설정/방문 기록 쓰기와 공유 요청의 순서·발신자 검사 |
| ui.js / style.css | Shadow DOM 패널, 네 설정 탭과 만든놈 내부 화면 |
| content_script.js | 페이지 변화·설정·탐색 작업 연결 |

설정 schema 4와 기존 슬롯 ID를 유지합니다. chrome.storage.local의 dcScrollSettings에 설정, dcScrollRecentGalleries에 최근 두 갤러리, dcScrollOwnedShares에 작성 기기의 코드·만료·삭제 키를 보관합니다. 공유 프로필에서 최근 기록·갤로그 주소·삭제 키를 제외하고 커스텀 주소·이름은 직접 포함을 선택합니다.

서버 응답은 허용한 JSON 데이터만 검증해 적용합니다. 코드나 URL을 평가·실행하지 않습니다. 공유 코드는 비밀번호가 아니며 아는 사람에게 설정을 공개합니다. 30일 만료와 작성 기기 삭제를 지원합니다. [보관·삭제·운영 메타데이터 처리](https://daily-odd-builds-portal.web.app/privacy/dcinside-scroll-helper)

storage와 고정 공유 API 도메인 한 곳의 host_permissions를 사용합니다. 원격 코드, 광고·분석 SDK는 없습니다. 공개 스냅샷에는 확장 실행 소스·사용 안내·이미지를 포함하며 서버 운영 소스와 개발 이력은 포함하지 않습니다.
