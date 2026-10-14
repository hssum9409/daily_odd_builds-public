# Day 003 — 디시 스크롤 도우미 1.4.0

- 공개 기록: 2026-10-15
- 플랫폼: Chrome Extension Manifest V3
- [Chrome 웹 스토어 설치](https://chromewebstore.google.com/detail/ncfjoncjghbhknfmlnniciobbddebnff)
- [개인정보처리방침](https://daily-odd-builds-portal.web.app/privacy/dcinside-scroll-helper)
- [GitHub 릴리즈](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day003-v1.4.0)

개인용 확장을 기반으로 페이지 판별, 긴 글 목적지 추적·충돌 취소, 원형 아이콘 패널, 설정·배치, 최대 10개 커스텀 갤러리와 아이콘 선택을 정리했습니다.

## 파일

일반 사용자는 스토어에서 설치하세요. `dcinside-scroll-helper-1.4.0.zip`은 직접 로드할 수 있는 실행 파일 16개만 포함합니다. ZIP 안의 `manifest.json`이 최상위에 있습니다. `dcinside-scroll-helper-source-1.4.0.zip`은 이 공개 폴더의 실행 소스·README·이미지·문서 스냅샷입니다. `SHA256SUMS.txt`로 다운로드 무결성을 확인할 수 있습니다.

실행 ZIP SHA256: `67eb0aeff75881871722cf28b0c7f68bb8da06ba814b3ce6d0b89ca02b82fda6`

GitHub 실행 ZIP과 공개 `extension/` 파일은 바이트 단위로 대조합니다. 웹 스토어는 설치용 패키지를 별도로 제공하므로 이 기록이 스토어에서 설치한 CRX 전체의 동일 해시를 주장하는 것은 아닙니다.

## 확인한 범위

- 자동 검사 32개: 일반·마이너·미니 URL 판별, 갤러리 URL, 추적 스크롤·취소, 로컬 설정·슬롯·배치, manifest와 아이콘.
- 패키징 검사 6개: 허용 파일 목록, ZIP 구조와 바이트 무결성, 공개 자료 규격 및 경로 처리.
- 2026-10-12 실제 Chrome의 AI 활용·특이점이 온다 갤러리: 기본 패널, 설정창, 구분선으로 만든 두 줄 배치와 새로고침 후 유지 확인. 긴 글의 맨 위·맨 아래·댓글·댓글쓰기·글 목록 도착 확인.
- 2026-10-15 공개 스토어 페이지: 프로그램 이름, 버전 1.4.0 및 Chrome에 추가 표시 확인.

일반·미니 갤러리의 모든 실제 페이지, 로그인 상태 변경, Chrome 완전 재시작, 업데이트 경로와 모든 지연 로딩 조합을 이 기록에서 확인 완료로 표시하지 않습니다. 사이트 구조가 바뀌면 버튼 사용이 제한될 수 있습니다.

## 공개 범위

사용자가 출시 버전 소스 공개를 선택했습니다. 실행 파일, 이 프로젝트용 홍보 이미지와 공개 안내만 독립적인 공개 커밋으로 게시합니다. 비공개 개발 이력, 세션·사용량 로그, 기존 개인용 원본과 내부 심사 준비 자료는 포함하지 않습니다.
