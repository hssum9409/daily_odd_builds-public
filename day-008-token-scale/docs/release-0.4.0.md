# Day 008 · 마 니 토큰 좀 쓰나? · 0.4.0

Token Scale Is All You Need를 Day 008로 공개합니다.

[웹에서 보기](https://token-arena-hssum9409.web.app/) ·
[Windows / macOS 다운로드](https://token-arena-hssum9409.web.app/download/) ·
[소개·기능 이미지·공개 소스](https://github.com/hssum9409/daily_odd_builds-public/tree/main/day-008-token-scale)

## 달라진 점

- 백그라운드 수집기가 토큰 통계를 30초마다 확인합니다. 값이 같으면 전송하지 않고,
  달라진 값·날짜는 최신 절대값으로 보냅니다. 과거 날짜의 하향 정정도 처리합니다.
- 추가 메타데이터는 시작 및 시간별로 확인해 로컬 캐시와 비교하고 변경분만 보냅니다.
  최초 웹 연결은 정기 수집 시각과 관계없이 즉시 동기화합니다.
- 빠른 변경분은 RTDB, 시간별 이력과 업적은 Firestore로 나눠 처리합니다.
  공개 랭킹은 기존 UTC 00/06/12/18시 서버 일괄 집계를 유지합니다.
- 4개 언어의 다운로드·데이터 처리 안내와 Day 008 소개·홍보 이미지를 갱신했습니다.

## 설치와 업데이트

ZIP/tar.gz 전체를 풀고 Windows는 `Install.vbs`, Mac은 `Install Token Scale.app`을 엽니다.
Codex의 기존 ChatGPT 로그인과 별도의 Google 웹 연결이 필요합니다.
일반 측정 창이나 터미널을 계속 열어둘 필요 없이 트레이/메뉴 막대에서 실행합니다.

현재 설치본 3개, 네이티브 업데이트 파일 3개와 `SHA256SUMS.txt`를 제공합니다.
기존 설치본은 정식 업데이트를 확인할 수 있습니다. 설치 관리자/호스트/런타임까지
갱신하려면 새 전체 설치본을 실행합니다. 기존 자동 업데이트 호환을 위해 태그는
`day004-cli-v0.4.0`을 유지하며 현재 공개 번호와 표시명은 **Day 008**입니다.

## 확인한 범위

Windows 실제 설치 엔진·웹 연결·Codex 원본 조회·운영 RTDB 저장·시간별 Firestore 반영을
확인했습니다. 응답 유실·재시도·과거 정정은 Windows 데몬과 합성 원본/Firebase Emulator로
검증했습니다. 공개용 별도 workspace의 분석과 64개 테스트를 통과했습니다.

[macOS 네이티브 CI](https://github.com/hssum9409/daily_odd_builds-public/actions/runs/39685452130)의
Intel·Apple Silicon 빌드·버전 실행과 각 16개 패키지 검사도 통과했습니다.
**macOS 14+ 실기기 미검증 preview**이며 Finder·Keychain·Gatekeeper·메뉴·로그인 시작은
물리 Mac 검증 전입니다. Windows 재부팅·SmartScreen도 이번 검증 범위에 포함하지 않습니다.
정식 Authenticode/Developer ID·Apple 공증을 제공하지 않습니다.

통계는 `community_reported`이며 생산성·실력·원본 진위를 인증하지 않습니다.
OpenAI 인증정보·대화·프롬프트·코드·프로젝트 경로는 전송하지 않습니다.
이미지는 가상 수치와 아바타를 사용한 홍보용 연출입니다.

[자세한 검증 기록](verification-0.4.0.md) ·
[개인정보·인증 구조](https://token-arena-hssum9409.web.app/about/?lang=ko)
