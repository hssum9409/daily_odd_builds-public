## 1.4.3 포터블 터미널 연결 점검

Mac 포터블 실행기는 기존 `nohup`과 `</dev/null >/dev/null 2>&1 &`를 유지한다. 일반 실행은 부모 셸을 기다리지 않고, 단발 조회·명시적인 `--foreground`는 의도적으로 동기 실행한다.

2026-10-12, 실제 배포 ZIP의 최상위 `Start.command`와 `run.command`를 Git Bash에서 검사했다. `osascript`만 가짜 자식 셸로 바꾸고 기본 실행/설정 실행/foreground/단발 조회 네 경우의 인수 전달, 입력 EOF, 출력 분리, 부모 셸 종료와 SIGHUP 이후 자식 진행을 확인했다. 기본 실행은 약 0.2초에 반환했다. **POSIX 에뮬레이션 검사이며 실제 macOS의 osascript/JXA/AppKit/Terminal.app 검증은 아니다.**

Terminal은 셸 종료 후 창을 유지할 수 있다. [Apple의 Shell 설정 안내](https://support.apple.com/en-gb/guide/terminal/trmlshll)에 따르면 창 닫기 동작은 프로필의 `When the shell exits` 설정에 따른다. 실행이 끝난 창이 남는 현상과 모니터가 터미널 종료에 종속되는 문제를 구분해야 한다. 실제 Mac에서는 Finder 실행 → 창 종료 → 패널 유지와 Terminal 앱 종료까지 추가 검사한다. 사용자 Terminal 설정이나 다른 창은 자동으로 변경/종료하지 않는다.

재현: `python tests/mac_portable_background.py`. 실제 Mac이 생기기 전까지 preview 표시를 유지한다.

## 1.4.1 공개 후보의 설치형·포터블 업데이트

두 Mac 다운로드 형식 모두 preview입니다. 두 형식은 같은 `CodexUsageMonitorScripts-macos-update-preview.zip`을 받습니다. 설치형은 설치 영수증의 경로를, 포터블은 현재 실행 폴더를 갱신합니다. 사용자 지정 프로필과 설치 경로를 자식 도우미에 명시적으로 전달합니다.

Windows의 Node 모의 호스트에서 업데이트 성공/시작 실패 롤백(포터블·표준 설치·별도 설치 경로), 미배포·거절·오프라인·체크섬 불일치·ZIP 경로 탈출·다른 실행 인스턴스·429 대기 13개를 검사했습니다. 이 결과는 Foundation/NSTask selector, JXA, AppKit 또는 실제 Mac 업데이트 실행의 증거가 아닙니다. 아래 장치 QA를 설치형과 포터블 각각 실행해야 합니다.

# Mac에서 나중에 수행할 검증

## 1.4.0 추가 범위

스타일 탭의 간격 3개, 접힌 고급 설정, 빠름/기본/여유로움 및 개별 반응 주기도 소스에 반영했다. JavaScript 구문과 공통 설정 이행/범위/배치 계산은 검증했지만 AppKit 슬라이더·접기·NSWindow 애니메이션 시간·실제 타이머 전환은 Mac에서 확인해야 한다. 드래그 중 잠시 패널을 숨기는 기존 Mac 방식은 유지한다. 화면 캡처나 실제 반응 속도 검증 결과로 간주하지 않는다.

설치형을 기본으로 바꾸고 최상위 `Install.command` → 언어 선택 → MIT 참고 번역과 영어 원문 → 시작 등록 선택 → 고정 app 폴더 설치로 구성했다. 기존 프로필의 언어는 유지하며 새 프로필에만 선택 언어를 반영한다. 시작 등록 동의는 기존 프로필에도 저장한다.

설정의 자동 업데이트 ON/OFF, 공개 GitHub Release의 Mac 전용 ZIP 선택, SHA-256/manifest/ZIP 경로·심볼릭 링크 검사, 실행 중 종료·교체·준비 응답·롤백, 403/429 대기와 업데이트 잠금 복구를 구현했다. **이 JXA/AppKit/업데이트 실행 경로는 실제 Mac에서 전부 미검증이다.** JavaScript 구문 검사와 공통 버전/자산 선택 테스트, Git Bash의 설치 파일 작업 14개 검사를 실제 Mac 실행·권한·업데이트 검증으로 대체하지 않는다. Mac updater의 curl/unzip/NSDistributedLock/NSFileManager selector·재실행과 오프라인/쓰기 실패/중도 종료를 먼저 검사해야 한다.

Mac 설치/업데이트 ZIP은 동일한 본체·에셋을 포함하고 실행 비트/LF/SHA-256을 검사했다. 실제 Finder에서 ZIP을 푼 뒤 quarantine, .command 실행, 접근성 허용, 로그인 자동 시작, 다운로드 폴더 삭제 이후 실행을 확인하기 전 preview 명칭을 유지한다.

2026-10-11 현재 Mac이 없어 **아래 모든 장치 검증은 미실행**이다. 0.2.0은 Windows에서 Node 문법/공통 로직, shell 구문, ZIP 실행 권한 및 Git Bash의 POSIX 파일 작업 검사를 수행했다. 설치→다운로드 원본 삭제→설정 보존 업데이트→손상 파일 거부→제거 14개 검사가 통과했다. 이는 macOS의 AppKit/launchd/보안 동작 검증이 아니다. 테스트용 preview이며 Mac 프로덕션 호환성을 확인했다고 표시하지 않는다.

| 항목 | 절차 / 합격 기준 | 현재 |
| --- | --- | --- |
| JXA/ObjC 시작 | macOS 12+ Intel/Apple Silicon에서 `--foreground --settings`; ObjC framework/selector/구조체 변환 오류 없음 | 미검증 |
| 실제 계정 데이터 | `once.command`; 앱 내 CLI 자동 탐색, ChatGPT 인증/keychain, 사용량 JSON 확인 | 미검증 |
| 계정 유형 | Free/Plus/Pro/API 키/로그아웃; 제공 정보만 표시, Pro 5h 비활성화, 로그인 오류 안내 | 미검증 |
| AX 브리지 | AXUIElement/AXValue/Ref 반환형, 권한 거부/허용/철회, 권한 주체 확인 | 미검증 |
| Pet 검색 | 실제 앱의 AXImage가 캐릭터인지 확인; 없는 경우 별도 표시, 잘못된 일반 창에 붙지 않음 | 미검증 |
| Pet 드래그 | 좌우/상하/화면 경계/여러 모니터/Retina; 흔들림·오탐 없이 이동 | 미검증 |
| 기본 메시지/조작 UI | 실제 AXGroup/AXButton 구조로 위/아래 겹침 회피; 숨겨진 요소 제외 | 미검증 |
| 화면 좌표 | 음수 좌표, 주 모니터 변경, 화면 해상도/Dock 위치 변경, 전체 화면/Spaces | 미검증 |
| Hide Pet | 자동 별도 표시 → 재등장 시 위/아래 복원; 명시적 free/hidden은 보존 | 미검증 |
| 앱 종료/업데이트 | 데스크톱 종료 시 UI·RPC·HTTP 중단, 재실행 후 복원, CLI만 실행해도 깨지 않음 | 미검증 |
| AppKit UI | NSPanel/NSPopover/NSTextField 줄바꿈 높이, 작은 리셋 폰트, 다국어 길이, hover 버튼/툴팁 | 미검증 |
| 별도 드래그 | 이동 중 되돌림 없음, 좌표 저장/재실행 복원, 모니터 분리 후 화면 안으로 보정 | 미검증 |
| 설정/스타일 | 4개 언어·시간대·색·불투명도·종속 옵션·앞으로 열기·저장 실패 안내 | 미검증 |
| 메뉴 막대 | 설정/현재 상태에 따른 ON/OFF/새로고침/등록/종료, 기존 앱과 공존 | 미검증 |
| 예고 | 실제 HTTPS/ETag 304/429/Retry-After/오프라인; null 상태는 숨김, 잘못된 예고 생성 없음 | 미검증 |
| 경고/소리 | 같은 예고의 중복 소리 없음, 닫기 후 간격·이정표 재표시, 크레딧 감소 단위, 알림 OFF 소리 비활성화 | 미검증 |
| 프로세스/인스턴스 | NSTask 파이프 비동기 read/EOF/timeout, 정상 종료의 자식 정리, 이중 실행/비정상 종료 lock 회복 | 미검증 |
| 자동 실행 | 사용자 동의 후 LaunchAgent plist, 재로그인 시 실행, 폴더 경로 한글/공백, 등록 해제/제거 | 미검증 |
| 휴지통/정책 | 다운로드 quarantine/실행 권한 제한/읽기 전용 폴더에서 안내와 동작 확인; 보안 정책 강제 변경 없음 | 미검증 |
| 자원 | Codex 없음/있음/Pet 드래그/설정/오프라인 각각 5분 CPU/RAM/자식/네트워크 요청 측정 | 미검증 |
| 설치/다운로드 제거 | 고정 app 폴더 설치 후 다운로드 ZIP/원본 제거; 실제 JXA·에셋·메뉴 막대 정상 | 파일 작업 통과 / 실제 Mac 미검증 |
| 업데이트 | 실행 중 JXA 종료→검증된 ZIP 교체→재시작→설정/위치/LaunchAgent 유지; 쓰기 실패 롤백 | 파일 작업 통과 / 실제 Mac 미검증 |
| 제거 | 설치된 uninstall.command 실행; app 파일·이 제품의 LaunchAgent만 제거, 프로필 보존 | 파일 작업 통과 / 실제 Mac 미검증 |
| 원본 UI 비교 | 840×720/154 사이드바/120×180 아트/폰트·투명도·그림자·알림 간격을 Mac 화면에서 확인 | 미검증 |

## 검사 실행

```sh
./macos/run.command --foreground --settings
./macos/once.command
./macos/run.command --register-startup
# 로그아웃/로그인 후 메뉴 막대와 패널 확인
./macos/remove-startup.command
./macos/stop.command
```

GUI 오류는 `--foreground`에서 나온 오류/OS 버전/CPU 종류/실제 앱 버전과 함께 기록한다. 계정 이메일·토큰·auth.json을 결과물에 넣지 않는다. 현재 전송/AX 예외는 사용자에게 상세 원문을 노출하지 않으므로, UI가 안 보이면 이 문서의 첫 항목부터 별도 디버깅한다.

1. 먼저 CLI 단발 조회와 AppKit 설정창을 따로 확인한다.
2. AX C 함수의 포인터/CGPoint/CGSize 변환을 실제로 확인한다. 실패하면 AX 어댑터만 수정한다.
3. 권한 없는 별도 패널을 합격시킨 뒤 Pet 추적을 검사한다.
4. fixture 기반 공통 계산 테스트 통과를 실제 화면/권한/프로세스 E2E 통과와 구분한다.
5. 실제 합격 증거를 TESTING.md에 추가한 뒤 preview 명칭 해제를 결정한다.
