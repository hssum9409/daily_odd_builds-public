# 스크립트 에디션의 범위와 구조

기존 EXE와 설정을 보존하며 Day 001의 스크립트 에디션 1.4.0을 구현한다. 배포 버전은 EXE와 맞추고 프로필은 각각 유지한다. OS 내장 런타임을 사용하고, 설치 스크립트가 사용자별 고정 폴더에 코드·에셋을 복사한다. 공개 배포/merge/push는 이번 작업에 포함하지 않는다.

## 설치 및 UI 공유

- Windows: `%LOCALAPPDATA%/Programs/CodexUsageMonitorScripts`, 별도 HKCU 제거 항목·시작 메뉴 바로가기.
- Mac: `~/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts/app`; 프로필은 상위 폴더에 보존.
- 패키지의 `payload.sha256`을 모두 검증한 후 staging → 기존 폴더 backup → 새 폴더 전환. 설정은 복사 대상이 아니다.
- 업데이트는 실행 중인 설치본에 IPC 종료 요청을 보내며, 실패하면 교체하지 않는다. 다운로드 원본 경로를 바로가기/자동 실행에 저장하지 않는다.
- `ui.json`은 원본 Windows 앱의 크기·팔레트·폰트 사양 기록이다. 같은 PNG/ICO를 동봉한다.
- Windows `Theme.xaml` + `Settings.ps1`, Mac `Settings.js`는 실제 위젯 UI다. Windows 스타일 미리보기는 실제 패널의 렌더러를 공유한다.
- 공개 Release 조회·설치 기능은 구현했고, 공개 파일 업로드는 하지 않았다. 같은 Release에서 EXE/Windows 스크립트/Mac 스크립트에 맞는 자산만 선택한다. 자동 업데이트 기본 OFF와 수동 ZIP 설치를 모두 지원한다.

```text
Windows start.cmd → Windows PowerShell 5.1 → WPF 패널/설정/트레이
                                        → 메모리에서 컴파일한 Native.cs
macOS run.command → osascript/JXA → AppKit NSPanel/설정/메뉴 막대
                                  → Foundation NSTask/AX

로그인된 Codex CLI app-server → 계정 사용량 (읽기 전용)
codex-resets.com/api/v1/status → 제3자 초기화 예고 / 리셋 조짐
```

## 분리 기준

- `common/core.js`: macOS 순수 상태/표시/레이아웃 로직. OS 없이 Node 테스트 가능하다.
- `windows/Core.ps1`: Windows 계산 로직. 같은 fixture와 기대값으로 비교한다.
- `windows/Native.cs`: UIA/Win32 읽기, 비동기 RPC/HTTP. 자체 exe를 만들지 않는다. 인증 정보/오류 원문을 로그로 내보내지 않는다.
- `windows/Monitor.ps1`: WPF UI, 사용자 설정, 수명 주기, 메뉴와 명령 처리. 작업 스레드의 완료만 읽는다.
- `macos/Monitor.js`: 내장 ObjC bridge/AX/NSTask/NSRunLoop 어댑터. Mac에서 런타임 검증이 필요하다.
- `defaults.json`, `strings.json`: 공유 설정 스키마와 네 언어. 기존 앱 설정은 가져오지 않는다.
- `tests/`: 경계값, 플랫폼 결과 비교, 가짜 App Server, Windows 네이티브 UI/실제 계정/HTTP 검사.
- `tools/build.py`: 개발 전용 ZIP/SHA-256 생성. 사용자 실행에는 Python이 필요하지 않다.

레이아웃은 정해진 카드다. 사용자가 항목·색·불투명도·위치를 선택하고 자유 테마 편집은 제공하지 않는다. 알림을 여러 개 쌓는 시스템 대신 예고 1개/크레딧 경고 1개를 갱신한다. 배치 계산에 실제 렌더링 높이를 포함한다.

## 상태

리셋 공급 응답은 `scheduled_reset`의 유효한 예고를 우선하고, 없으면 `active_watch`를 조짐으로 해석한다. 조짐 식별자는 원문 게시물 ID를 사용하고 `expires_at`은 표시 유효기간과 가능성 문구의 남은 시간 계산에 사용한다. 최초 범위인 `forecast_window`는 카운트다운에 사용하지 않는다. Windows/Mac 모두 매 렌더링마다 종료 시각에서 현재 시각을 빼며 API 조회 횟수는 늘리지 않는다. 조짐에는 확정된 초기화 예정 시각을 부여하지 않는다. 기존 resetNotice/resetSound 설정과 같은 알림 카드를 사용하되 문구를 구분한다. 정식 예고 전환·소식 없음·후속 완료·만료를 처리하며, 조짐의 재표시는 설정 간격으로만 결정한다.

`placement`는 명시적 사용자 선호이고 `mode`는 실제 표시 상태다. `above/below → Pet 감지 실패 → free → Pet 재발견 → above/below` 동안 설정값을 덮어쓰지 않는다. 데스크톱이 종료되면 `idle`로 전환하고 자기가 만든 App Server만 종료한다. 명시적인 `hidden`은 그대로 유지한다.

스크립트는 일반 ChatGPT 사용량 전체나 앱의 비공개 서비스 인증을 재구현하지 않는다. Codex 데스크톱/CLI의 계정 데이터가 실제로 제공하는 항목을 표시한다. API 키 전용 계정은 로그인 안내로 처리한다.

## 기존 앱과 다른 부분

- 배포 버전은 공유하며 프로필/자동 실행 항목은 각각 유지한다. 스크립트는 별도 PowerShell/JXA 업데이트 도우미를 쓰고 EXE 교체 도우미를 사용하지 않는다.
- 플랫폼 기본 네이티브 위젯을 같은 UI 사양에 맞춘다. 기존 지피쨩 아트/아이콘을 공유하며, 설치 안내도 스크립트가 표시한다. Mac의 폰트/배율별 렌더링은 장치 QA에서 확인한다.
- 자동 실행 권장은 README/설정에서 안내하며, 등록은 사용자의 명시적인 버튼 클릭으로 한다.
- GUI를 만드는 PowerShell/JXA도 실행 프로세스와 메모리를 필요로 한다. 무설치가 무프로세스/무메모리를 의미하지 않는다.
- 정상 종료에서는 자기 자식을 정리한다. OS 강제 종료/전원 차단 뒤의 자식 정리와 Mac lock 회복은 해당 QA 범위를 따로 확인한다.

## 호환성과 테스트 경계

Windows PowerShell 5.1/.NET Framework에 맞춰 C# 5 문법만 사용한다. Windows 10/11 x64가 검사 대상이다. Mac은 macOS 12+를 목표로 ES5 호환 JXA와 AppKit을 사용한다. OS별 화면/접근성 구현을 공유하려고 브라우저·Flutter·Node를 추가하지 않는다.

현재 Mac이 없어 JS 순수 로직/구문, shell 구문, ZIP 모드만 검증할 수 있다. ObjC selector와 AX C 구조체 반환형, 실제 NSPanel UI, 로그인/keychain, LaunchAgent는 정적 검사로 실행 성공을 보장할 수 없다. 미검증 항목은 MAC-QA.md에서 관리한다.

이번 goal의 완료 기준은 두 플랫폼 구현 + Windows 실제 실행/오류/UI/패키징 검사 + Mac 공통/정적 검사 + Mac 장치 미검증 기록이다. Mac 장치 E2E를 완료했다고 주장하지 않는다.
