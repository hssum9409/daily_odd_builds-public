## 2026-10-21 파일 목록 줄바꿈 회귀 검사

공개 1.4.11의 Mac ZIP 3개에는 파일 목록 CRLF 생성 오류가 없었다. 다만 목록만 CRLF로 바꾸면 원본 설치기가 신규 설치·갱신에서 `Unsafe manifest`로 실패했다. 1.4.12 설치기는 잠금 폴더의 정규화 사본을 검증·필수 파일 확인·복사에 함께 사용한다. 원본 파일 목록은 그대로 보존한다.

`tests/mac_manifest.py`는 실제 Mac ZIP 3종의 설치·갱신·복원·제거와 거부/보존 경로를 Windows Git Bash에서 실행한다. 이것은 POSIX 파일 처리의 증거이며, Mac AppKit·launchd·로그온·Gatekeeper나 실제 UI/자동 업데이트 전체 흐름을 확인한 결과는 아니다. Mac preview와 아래 실기기 미확인 항목을 유지한다.

## 2026-10-15 진단 v6 실기기 결과: 사용량 응답 수신, 설정창 갱신 오류

macOS 14.6.1 / arm64 사용자 로그에서 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`를 발견하고 실행했다. `rpc-initialized`, `rpc-account-response-received`, `usage-response-received`가 확인됐다. CLI 발견·초기화·계정 응답·사용량 응답 수신의 실제 장치 증거다. 모든 사용량 필드의 화면 정확성이나 Pet 부착 성공까지 확인된 것은 아니다.

설정창을 연 뒤 `tick-caught: ReferenceError: Can't find variable: syncPetAvailability`가 발생했다. Settings.js는 showSettings 함수 내부 eval로 로드하므로 내부 함수가 Monitor 전역에서 보이지 않는다. 같은 방식의 syncUpdateStatus 호출도 수정 대상이다. 후보 소스는 설정 모듈이 두 함수를 공개하고 Monitor가 해당 객체로 호출하도록 고쳤다. 열린 창만 갱신하고 업데이트 상태 파일 조회는 1초 간격을 유지한다. 실기기에서 발견한 중첩 CLI 경로도 직접 후보에 추가했다.

마지막 `zsh: killed`의 원인은 **미확인**이다. 사용자는 직접 강제 종료했는지 기억나지 않는다고 답했다. 해당 ReferenceError는 tick에서 포착되므로 이것만으로 SIGKILL의 원인을 설명하지 않는다.

v7 진단은 수정된 Settings.js를 명령 파일에 포함해 원래 함수 내부 eval 범위를 유지한다. 설치본/기존 설정/시작 등록은 바꾸지 않고 실제 사용량 조회만 활성화하며 소식/업데이트/시작 등록 변경은 끈다. `settings-pet-refresh-done`, `settings-update-refresh-done`으로 설정창 갱신 도달을, `usage-response-refreshed`로 두 번째 이후 사용량 응답을 한 번씩 기록한다. **v7의 실제 Mac 결과는 아직 미확인이다.** Windows 앱 실행 검사와 공개 배포는 진행하지 않았다.

전달 전 관련 모의 테스트 55개가 통과했다. 설정 모듈 검사 7개는 실제 Settings.js를 실제 Monitor 로더의 지역 eval로 읽어 전역 함수 없는 갱신, 반복 tick/heartbeat, Pet 버튼 상태, 1초 조회 간격, 재열기, 언어 변경, v7 내장 모듈을 확인한다. 추가로 배포된 1.4.5 커밋의 Monitor.js에 v7 생성기를 적용해 내장 설정창과 반복 tick/heartbeat의 모의 검사를 통과했다. `.command` 셸 구문, ZIP CRC, 실행 권한 0755, UTF-8/LF 및 전달본 바이트 일치를 확인했다. 이는 AppKit 실기기나 강제 종료 원인 검증을 대체하지 않는다.

## 2026-10-15 진단 v5 실기기 결과: CLI 실행파일 미발견

사용자 Mac에서 Codex가 켜진 상태로 `startRPC-begin` → `findCodex-begin` → 공통 오류 `Codex 로그인과 실행 파일 경로를 확인하세요.`가 발생했다. `rpc-process-launch`에는 도달하지 않았다. 이는 기존 고정 후보 경로 중 실행 가능한 CLI를 찾지 못한 분기이며, 로그인 조회 실패의 증거가 아니다. 실제 앱 위치와 리소스 구조는 아직 전달받지 않았다.

후보 소스의 findCodex는 직접 지정한 파일/번들, NSRunningApplication.bundleURL로 얻은 실행 앱의 실제 위치, 표준 위치, 기존 PATH/Homebrew CLI를 확인한다. 직접 경로에 없으면 해당 앱 Resources 안에서만 `codex` 파일을 탐색한다. 디렉터리는 실행파일에서 제외하고 탐색은 3,000항목/약 0.3초 예산으로 제한한다(단일 파일시스템 호출 지연까지 보장하는 하드 타임아웃은 아니다). 미발견 결과는 60초간 보관하되 앱 경로/설정/PATH가 바뀌면 재탐색한다. 선택한 파일도 재사용 전에 존재/실행 권한을 확인한다. CLI를 설치하거나 로그인 설정을 변경하지 않는다.

v6 진단 파일은 설치본의 임시 복사본에 새 탐색기를 적용한다. macOS 버전/CPU, `cli-app-bundle`·`cli-candidate`·`cli-selected`·`cli-scan-resources`·`cli-not-found` 단계와 제한된 리소스 이름을 출력한다. 사용자 홈 경로는 `~`로 바꾸며 파일 내용이나 계정 토큰은 출력하지 않는다. 경로 탐색 10개, RPC 진단 8개, 기존 진단 10개, JXA 계약 11개를 모의 검사한다. **실제 Mac v6의 CLI 발견/계정 조회 결과는 아직 미확인이다.** Windows 앱 검사와 공개 배포는 하지 않았다.

## 2026-10-15 진단 v4 실기기 결과: 글자 표시 성공, 실제 조회 진단으로 전환

사용자가 실제 Mac에서 `title-style-rich-text-ok` 및 `displayCard:main:visible-done` 로그와 함께 **글자가 표시된다**고 확인했다. 표시 문구는 `사용량 연결 중`이었다. v4가 계정/네트워크 조회를 끈 UI 진단이므로 문구가 갱신되지 않는 것은 의도된 동작이다. 실제 사용량 조회·정확한 Pet 부착·메뉴 아이콘 표시 성공의 증거로 확대하지 않는다.

v5 `Diagnose-Mac-v5.command`는 동일한 임시 UI 수정에 실제 `startRPC`를 유지하고 Codex CLI 탐색, App Server 시작, initialize/account/read/rateLimits/read 응답 수신, 스트림 종료 및 timeout 단계를 기록한다. 계정 조회는 기존 읽기 전용 메서드 제한을 유지한다. 초기화 소식·자동 업데이트·시작 등록 변경은 비활성화한다. 설치본과 기존 모니터 설정은 바꾸지 않는다. 로그에는 계정 이메일/토큰/원시 응답이나 서버의 임의 오류 본문을 넣지 않는다.

`python tools/make_mac_diagnostic.py --usage`로 최신 계정 조회 진단을 생성하며, 기본 생성은 오프라인 v4다. v5 전달 전 실제 RPC 상태 전이를 모의 서버와 프로세스에서 검사하는 7개 테스트와 기존 UI 진단 10개, v5 셸 구문 검사가 통과했다. 정상 응답, 분할 JSON, 서버 거절, 로그인 필요/API 키, 손상 응답의 비밀 값 비노출, 스트림 종료를 확인했다. 이후 받은 실제 Mac v5 결과는 위에 기록했다. Windows 앱을 실행하거나 공개 배포하지 않았다.

## 2026-10-15 진단 v3 실기기 결과: 폴더 생성 통과, 텍스트 렌더링 오류

실제 Mac에서 JS null 비교 호출은 `NSNull objectForKey:`로 실패했고, ObjC nil 비교·프로필/commands 생성은 성공했다. 설정·델리게이트·잠금·카드/메뉴 생성, 이벤트 루프와 tick, Codex 앱 감지와 scanPet 호출까지 도달했다. `scanPet-done`은 함수 반환을 뜻하며 Pet 발견 성공을 뜻하지 않는다. 처음 `render-done` 뒤에 실제 글자가 필요한 경로에서 `NSMutableAttributedString.alloc.initWithStringAttributes is not a function`이 보고됐다. 패널/아이콘의 실제 화면 표시는 아직 확인되지 않았다.

후보 소스는 해당 초기화 메서드 호출을 없애고 NSTextField의 `attributedStringValue.mutableCopy`에 괄호 부분의 작은 회색 서식을 적용한다. 부분 서식이 실패하면 기존 기본 글자를 유지하고 같은 오류를 반복 출력하지 않는다. 글자·레이아웃 완료 후에만 내용 캐시를 갱신하여, 중간 실패를 완료로 처리하고 다음 렌더링을 건너뛰던 문제도 수정했다. 근거: [Apple NSControl attributedStringValue](https://developer.apple.com/documentation/appkit/nscontrol/attributedstringvalue?language=objc), [Attributed String 변경](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/AttributedStrings/Tasks/ChangingAttrStrings.html). 기존 initializer가 해당 장치의 JXA에 노출되지 않은 세부 이유는 확정하지 않았다.

진단 v4 ZIP의 `Diagnose-Mac-v4.command`는 이 수정 구간과 앞선 폴더 생성 수정을 설치본의 임시 복사본에 적용한다. `title-style-rich-text-ok`와 `title-style-plain-text-fallback`으로 서식 성공/기본 글자 대체를 구분한다. 계정 조회를 끄므로 패널의 연결 중 문구는 진단 상태이며 사용량 조회 성공을 의미하지 않는다.

실제 label/displayCard 함수를 호출하는 모의 검사 7개에서 제목·시간 범위 서식, 서식 실패 시 기본 글자 유지, 배치 실패 후 재시도, 리셋/크레딧 차이, 숨김, UTF-16 범위를 확인했다. 진단 생성/시작 범위 10개와 함께 17개 및 셸 구문이 통과한 뒤 v4를 전달했다. 이후 받은 실제 Mac v4 UI 결과는 위에 기록했다. Windows 제품 실행 검사와 공개 배포는 진행하지 않았다.

## 2026-10-15 진단 v2 실기기 결과: 새 폴더의 NSNull 오류

사용자가 v2를 실행했을 때 `profile-path-done` 다음에 `-[NSNull objectForKey:]` 오류로 종료됐다. 다음 계측 지점인 `settings-normalize-begin`에는 도달하지 않았다. 이 사이의 두 호출은 프로필/commands 폴더를 생성하면서 attributes에 JS `null`을 넘기고 있었다. 새 attributes 사전을 읽는 과정에서 NSNull에 objectForKey가 호출되는 결함과 일치한다. 기존 폴더가 있는 원래 실행에서 `ready: true`까지 도달했던 결과와도 모순되지 않으나, 이 결함 하나로 원래 UI 미표시의 원인까지 확정하지 않는다.

Apple 문서의 [파일 생성 attributes 계약](https://developer.apple.com/documentation/foundation/filemanager/createdirectory(atpath:withintermediatedirectories:attributes:)?language=objc)과 [JXA bridged nil 표기, 169–171쪽](https://devstreaming-cdn.apple.com/videos/wwdc/2014/306xxjtg7uz13v0/306/306_javascript_for_automation.pdf)에 맞춰 Monitor의 프로필·commands·LaunchAgents 및 Update의 작업 폴더 생성에 `$()`를 전달한다. 생성 반환값이 false면 명시적으로 중단한다.

진단 v3는 설치본의 해당 호출 세 곳을 **임시 복사본에서만** 수정한다. 같은 임시 프로필 아래의 서로 다른 새 폴더로 JS null/ObjC nil 호출을 비교하고, 예상 가능한 첫 오류는 기록한 뒤 수정된 호출과 UI 시작을 이어서 확인한다. 설치본과 사용자 설정을 바꾸거나 계정/네트워크 요청을 보내지 않는다. ZIP에는 `Diagnose-Mac-v3.command` 한 개를 넣어 v2와 혼동을 피한다.

v3 전달 전에는 생성/실행 범위 모의 검사 10개, 기존 JXA 검사 11개, 수정된 디렉터리 인수를 확인하는 업데이트 모의 검사 14개(총 35개)와 셸 구문이 통과했다. 이후 받은 실제 v3 출력은 위 기록에 정리했다. Windows 앱 실행 검사는 하지 않았고 공개 배포도 진행하지 않았다.

## 2026-10-15 추가 제보: 초기화 완료 뒤 화면 미표시

실제 Mac에서 1.4.5를 직접 실행한 뒤 `instance.json`의 `ready: true`와 버전은 확인됐지만, Codex가 실행 중이어도 패널과 메뉴 막대 아이콘이 보이지 않는다고 제보됐다. 현재 `ready`는 패널·메뉴 객체 생성과 타이머 등록 뒤, `app.run` 직전에 기록된다. 한 번의 상태 파일 출력으로 이벤트 루프·반복 heartbeat·화면 표시 성공까지 판단하지 않는다.

첫 UI 진단은 원본 전체를 함수 내부에서 `eval`한 뒤 실행했고, 프레임워크 로드 이후 `monitor-run`에서 `NSNull objectForKey:` 오류가 보고됐다. 원래 실행은 초기화를 통과했으므로 이 결과를 원래 앱의 실패 원인으로 단정하지 않는다. 진단 v2는 계측한 원본을 임시 `Monitor.js`로 저장한 뒤 별도 osascript의 최상위에서 실행한다. 환경·경로·공통 코드·설정·델리게이트·잠금·앱 객체·패널·메뉴·타이머 단계를 구분하고 계정/HTTP/업데이트 호출은 중단한다. 기존 설치와 설정은 수정하지 않는다.

v2를 전달하기 전에는 실제 원본 변환·최상위 클래스 등록·초기화 순서·단계별 오류 분류를 Node 모의 호스트 7개 검사와 셸 구문으로만 확인했다. 이후 실제 v2 결과와 폴더 생성 수정은 위 기록에 정리했다. 원래 화면 미표시의 원인은 아직 확인 중이며, Mac 실행 성공이나 배포 완료로 표시하지 않는다. Windows 제품 검사는 사용자 요청에 따라 중단했다.

## 2026-10-15 추가 제보: 라이선스 동의 직후 설치 중단

1.4.5 설치 UI에서 동의 후 터미널 세션이 끝났고, 사용자의 파일 검색에는 다운로드 폴더의 `run.command`만 나타났다. 표준 설치 폴더에서는 찾지 못했다. `setup.command`의 언어 추출은 GNU BRE 확장 `\|`에 의존했고 실패 시 설명 없이 종료했다. 1.4.6에서는 POSIX BRE의 두 글자 추출과 셸 whitelist로 바꾸고 UI 오류·잘못된 응답·취소·설치 진행을 표시한다.

`tests/mac_setup.py`는 실제 설치 ZIP의 최상위 진입점에서 실행하여 4개 언어×시작 등록 선택, 공백 포함 JSON, 취소, 잘못된 응답, UI 오류와 하위 설치 실패의 전달을 검사한다. Windows GNU sed의 `--posix`에서 구버전 패턴의 빈 결과와 수정 패턴의 설치 인수를 확인한다. **실제 BSD sed나 Mac UI를 실행한 검사는 아니며, 제보 장치의 원인 확정·수정 후 실제 설치/실행은 추가 확인이 필요하다.** 기존 파일 작업 테스트는 UI 다음 셸 구간을 우회했으므로 이 결함을 발견하지 못했다.

사용자가 실제 Mac에서 1.4.5의 `install.command`를 직접 실행했을 때 `Installed at .../CodexUsageMonitorScripts/app. Download files can now be removed` 출력이 확인됐다. UI 다음의 설치 파일 작업은 완료됐다는 제보이며, UI→설치 연결 구간을 우회하면 진행된다는 근거다. 입력의 `--launch` / `--language=ko`가 긴 대시 `—`로 바뀌어 전달되었으므로 이 결과로 자동 실행·언어 반영까지 성공했다고 판단하지 않는다. 설치된 `Monitor.js`의 foreground 실행 결과는 추가 확인 중이다.

백그라운드 실행기의 표준 출력/오류는 버리지 않고 프로필의 `startup.log`에 쓰며 직전 한 번은 `startup.previous.log`로 보관한다. 모의 자식 프로세스로 출력 기록·로그 교체·시작 실패 기록·부모 셸/SIGHUP 분리 5개 경우를 검사한다. 실제 장치에서 설치 결과 출력, 두 로그, `--foreground --settings`, 패널 표시를 우선 확인한다.

## 2026-10-15 실제 Mac 제보: JXA 무인수 selector 호출 오류

1.4.2 설치본에서 언어 선택 뒤 `choice.runModal is not a function` / `runModal is "1000"` 오류가 제보됐다. 공개 1.4.4까지 같은 호출이 남아 있었다. Gatekeeper 통과 뒤 설치 UI에서 발생하는 코드 오류이며 1.4.5 소스에서 수정했다.

JXA는 무인수 Objective-C 메서드를 속성 접근으로 실행한다. `choice.runModal()`은 창의 반환값 1000을 다시 함수로 호출한다. 1.4.5 소스의 설치·알림·업데이트 확인창, NSTask 실행/종료/대기, 파이프·잠금·타이머·창·애니메이션의 같은 잘못된 호출을 수정했다. `NSHomeDirectory()` / `AXIsProcessTrusted()` 같은 C 함수의 호출 문법은 유지했다.

`node --test tests/mac_jxa_bridge.test.js tests/mac_updates.test.js`는 getter 기반 모의 호스트에서 설치 동의/취소/언어/시작 등록, 프로세스·RPC 경계, 업데이트 승인/거절/복구를 검사한다. 기존 함수형 모의 객체가 JXA 규칙 오류를 허용했던 점도 수정했다. **이 검사는 실제 JXA/AppKit 실행이 아니다. 수정본의 Mac 설치부터 패널 표시·Pet 추적·업데이트까지 실제 장치에서 다시 확인해야 한다. 공개 1.4.4 ZIP은 보존하고 1.4.5를 새로 배포한다. 기존 Mac 업데이터도 같은 규칙 오류가 있으므로 1.4.4 이하에서는 새 설치 ZIP을 통한 수동 갱신을 권장한다.**

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
