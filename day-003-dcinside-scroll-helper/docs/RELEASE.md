# Day 003 — 디시 스크롤 도우미 1.5.0

- 업데이트 기록: 2026-10-27
- 플랫폼: Chrome Extension Manifest V3
- [1.5.0 실행 ZIP·공개 소스·SHA-256](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day003-v1.5.0)
- [Chrome 웹 스토어](https://chromewebstore.google.com/detail/ncfjoncjghbhknfmlnniciobbddebnff)
- [개인정보처리방침](https://daily-odd-builds-portal.web.app/privacy/dcinside-scroll-helper)

## 이번 변경

버튼을 키보드로 실행하고 설정창에서 키를 바꾸거나 해제할 수 있습니다. 기본 키는 S 설정, V 현재 갤러리 홈, C 댓글보기, W 댓글쓰기, L 글 목록, T 맨위로, B 맨밑으로, G 갤로그, D 갤러리 목록, M 마이너 목록이며 커스텀 슬롯 1–10은 1–9·0입니다.

입력창·편집 영역·한글 조합 중에는 실행하지 않습니다. 중복 조합과 대표적인 브라우저 예약키를 안내하고 설정 저장·새로고침 복원·기본 키 복원을 지원합니다. 숨긴 버튼과 사용할 수 없는 슬롯은 키로도 실행하지 않습니다. 기존 모양·순서·구분선·갤러리 설정을 보존합니다.

권한은 storage만 유지하며 사이트 적용 범위는 1.4.0과 같습니다. 키 입력 내용을 기록하거나 전송하지 않고 선택한 단축키 조합만 로컬 설정에 저장합니다.

## 배포 파일

`dcinside-scroll-helper-1.5.0.zip`은 manifest.json이 최상위인 실행 파일 17개입니다. `dcinside-scroll-helper-source-1.5.0.zip`은 이 공개 폴더의 실행 소스·README·문서·기존 홍보 이미지입니다. `SHA256SUMS.txt`로 무결성을 확인합니다.

- 실행 ZIP 크기: 559,635 bytes
- 실행 ZIP SHA-256: `2d32445ddf8694d27786b5411bbfa56c7c02794084f67e9ca647932be128b928`

`.release-snapshot.json`의 파일별 해시는 공개 Git blob 기준이며 실행 소스 17개는 배포 ZIP과 바이트 단위로 대조합니다. 스토어에서 제공하는 CRX 전체가 동일한 해시라는 뜻은 아닙니다.

## 확인한 범위

Node 검사 43개와 Python 패키징 검사 6개가 통과했습니다. Chrome 155.0.8059.86의 로컬 재현 페이지에서 기본 키·키 조합 변경/해제/복원·새로고침 복원·입력 포커스 보호·일반/마이너/미니 홈 URL·10개 커스텀 슬롯의 1–9/0·로그인 상태별 갤로그 제한·목록 페이지 및 미지원 페이지를 확인했습니다. 1280×800과 390×844에서 설정창이 넘치지 않았고 관련 콘솔 오류가 없었습니다.

재현 페이지의 Chrome 저장/API는 모의 구현이며 외부 이동은 가로채 목적지를 검증했습니다. 새 버전의 실제 DCInside 설치·자동 주입·갱신·완전 재시작이나 실제 계정 로그인 검증으로 간주하지 않습니다. GitHub Actions는 사용하지 않았습니다.

## Chrome 웹 스토어 업데이트 상태

1.5.0의 스토어 패키지 업로드와 심사 제출은 아직 수행하지 않았습니다. GitHub ZIP·소스 공개와 스토어 심사·게시는 별개입니다. 스토어 링크는 기존 항목을 유지합니다. 제출 및 승인 후 스토어 등록정보의 버전을 확인해야 합니다.

---

## 이전 출시 기록 — 1.4.0

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
