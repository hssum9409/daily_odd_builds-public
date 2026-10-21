# 0.4.0 변경분 수집 검증 · 2026-10-22 KST

구현 계약: [stream-sync.md](stream-sync.md). 브랜치 `day_004_token_arena`.
운영 API/RTDB Rules/시간별 집계/웹은 배포했다. 공개 다운로드와 GitHub 자동 업데이트
릴리스는 아직 0.3.1이다. 새 Windows ZIP은 로컬에서 빌드·실행했으며 새 Mac 릴리스를
빌드하거나 실기기에서 검증한 것으로 표시하지 않는다.

## 실제 Windows / Google / Codex / Firebase

- 빈 Firebase 세션과 빈 통계 캐시를 가진 새 Windows 설치 경로로 0.4.0 설치 엔진 실행.
  기존 비공개 Google 테스트 사용자와 원본 sourceId 연결만 재사용했다. 새로운 Google
  서비스 가입을 이번에 다시 시험한 것은 아니다. 기존 표준 설치·세션은 보존했다.
- 사용자가 이미 로그인한 서비스 Chrome에서 수집기 연결 버튼을 눌렀다.
  2026-10-22 06:53:38 KST 웹 연결, 06:53:42 원본 조회, 06:53:45 RTDB 저장,
  06:53:46 로컬 성공 처리를 확인했다. 정기 수집 시각을 기다리거나 수동 sync하지 않았다.
- 다음 두 조회는 06:54:09 / 06:54:40에 시작했다. 서버 sequence는 2로 유지되어
  변경 없는 조회가 제출되지 않았다. 원본 실제 summary와 ACK 캐시/RTDB 값의 일치를
  관리자 읽기 전용 검사로 확인했다. 운영 데이터에 합성 수치를 넣지 않았다.
- Chrome 새로고침 없이 연결 완료 및 조회/전송 시각이 06:46 → 06:53으로 바뀌었다.
  수정본 페이지 콘솔 error/warn 0개, 정상 통계/그래프/업적 화면을 확인했다.
  첫 검증에서 발견한 중첩 Map 타입 오류를 수정하고 변환 회귀 테스트를 추가했다.
- 매시간 UTC 55분 Scheduler가 06:55:00 KST 실행했고, 06:55:02 Firestore snapshot에
  fastRevision 2가 반영됐다. 사용자 통계 업로드마다 Firestore를 쓴 결과가 아니다.
- 실제 Scheduler 조회: flushUsage `55 * * * *`, publishRankings `0 */6 * * *`, 둘 다 ENABLED.
  새 코드의 6시간 순위 시각을 기다려 운영 배치를 재시험한 것은 아니다. 순위 생성·top50·
  본인 순위·공개 철회는 서버 에뮬레이터 회귀 테스트로 확인했다.
- 최종 설치/연결 관측에서 소유 프로세스 177개 시점 샘플의 visible main window 최대 0.
  이 결과는 샘플 관측이며 순간적인 모든 OS 창이나 SmartScreen/재부팅을 검증한 것은 아니다.
- 검증용 설치·자동 시작·프로그램 등록·Firebase 로컬 세션 제거를 확인했고 표준 세션은 남았다.
  Google 테스트 사용자의 기존 비공개 클라우드 데이터는 삭제하지 않았다.

## 실제 Windows 데몬 + 합성 원본 + Firebase Emulator

`tools/verify_stream_windows.py`는 실제 설치 엔진, DPAPI, 숨김 관리자/데몬, stdio RPC,
실제 30초 타이머, 로컬 HTTP 중계와 Auth/Functions/RTDB/Firestore 에뮬레이터를 사용한다.
숫자를 통제하는 원본은 Python fixture이므로 실제 OpenAI 응답이나 정정 사건의 증거가 아니다.
모든 합성 제출은 `demo-token-arena` / loopback에서만 수행한다.

- 관측 간격 30.27초 / 31.83초. 3회 조회 중 첫 제출 이후 HTTP 요청 수가 늘지 않았다.
- 첫 회만 skills/list를 호출했다. 변경 없는 토큰·메타데이터는 전송하지 않았다.
- 과거 날짜의 100을 40으로 수정했다. 토큰 summary와 메타데이터를 재전송하지 않고
  해당 날짜 변경만 제출했다. 서버 커밋 후 HTTP 응답을 일부러 끊었다.
- 약 64.17초 후 데몬이 같은 sequence/본문 digest를 재전송해 ACK를 회복했다.
  RTDB sequence는 한 번만 증가했다. 이후 Firestore 반영에서도 값은 40으로 교체됐다.
- 검증 중 메타데이터 재조회 기한을 앞당겨 가용 스킬 수 2→3을 관측했다.
  다음 요청은 observations.enabledSkills/fetchedAt만 포함했다.
- 실패/성공 후 테스트 프로그램 등록을 정리했고 합성 세션을 제거했다.

회귀 테스트가 공유 에뮬레이터 데이터를 초기화한 첫 장애 주입 시도는 무효 처리했다.
데몬 시험과 전체 DB 초기화 테스트를 순차 실행한 재시험이 위 결과다.

## 자동 검사

| 검사 | 결과 |
|---|---|
| Dart analyze: CLI/core/web | 문제 없음 |
| Dart CLI/core 테스트 | 64 통과 |
| 서버 단위·실제 에뮬레이터 통합 | 40 통과, skip 0 |
| 두 DB 보안 규칙 | 7 통과 |
| 패키지 매니페스트/합성 RPC 생성 회귀 | 3 통과 |
| Flutter Web release | 성공. 기존 CupertinoIcons 미사용 폰트 경고 있음 |
| Windows 0.4.0 AOT/ZIP | 빌드 및 실제 설치 엔진 실행 성공 |

재현 도구의 최종 재실행도 통과했다. 간격은 30.42초 / 32.15초, 응답 유실 후 재시도는
61.14초였으며 동일 본문/순번, 전송 생략, 메타데이터만의 변경 및 Firestore 정정을 재확인했다.

보안 규칙은 다른 UID/익명 접근, ingest 루트 열람과 소유자의 직접 쓰기를 거부했다.
서버 테스트는 순번 재사용, 시간/범위/필드 위반, 원본 교체 동의, 정정, 비공개/삭제/운영자
숨김과 업적 관측값 보존을 확인했다. 통계 진위는 계속 community_reported다.

재현 시 에뮬레이터 Auth 9199, Functions 5004, Firestore 8788, RTDB 9004를 사용한다.
DB를 비우는 규칙/서버 회귀 테스트와 Windows 데몬 시험은 동시에 실행하지 않는다.
Windows 통제 시험은 `python tools/verify_stream_windows.py`로 실행하며 실제 SDK/패키지
빌드와 실행 중인 에뮬레이터가 필요하다. 실제 Google 인증정보는 이 도구에 입력하지 않는다.
