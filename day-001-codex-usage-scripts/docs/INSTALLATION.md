# 고정 폴더 설치

Windows 설치형 ZIP을 풀고 최상위 `Install.cmd`를 실행합니다. 관리자 권한은 필요 없습니다.
설치 위치는 `%LOCALAPPDATA%\Programs\CodexUsageMonitorScripts`입니다.
시작 메뉴에 실행·설정·제거 바로가기가 생깁니다. 설치 후 다운로드 ZIP과 압축 해제 폴더는 지워도 됩니다.
초반에 시스템 언어를 따라 한국어/영어/중국어/일본어를 선택하며 지원하지 않는 언어는 한국어를 기본으로 합니다. MIT 참고 번역에는 영어 원문을 함께 보존합니다. 라이선스 동의와 선택형 시작 프로그램 등록 체크박스를 제공합니다. 시작 등록에 동의하면 앱의 권장 팝업을 다시 띄우지 않습니다.

macOS preview 설치형은 ZIP을 풀고 최상위 `Install.command`를 실행합니다. 언어 및 MIT 라이선스·시작 등록 선택 화면 뒤에 설치합니다.
파일은 `~/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts/app`에 설치합니다.
해당 폴더의 `macos/run.command` / `settings.command`로 실행하며, 로그인 자동 실행은 설정에서 선택하거나 `install.command --startup`으로 선택합니다.
실제 Mac의 실행 권한·보안 안내·접근성 권한·로그인 동작은 아직 검증하지 않았습니다. `MAC-QA.md`를 먼저 확인하세요.

1.4.4 이하 Mac 버전에서 `choice.runModal is not a function` 오류가 발생하거나 1.4.5에서 동의 뒤 설치가 조용히 끝났다면 1.4.6 이상 설치 ZIP을 전체 압축 해제한 뒤 `Install.command`로 수동 갱신하세요. 1.4.4 이하 Mac 업데이터에도 JXA 호출 오류가 있으므로 자동 갱신에 의존하지 마세요. 개발자 확인 경고는 실행 시도 뒤 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기에서 해당 파일을 승인할 수 있습니다. [Apple 안내](https://support.apple.com/ko-kr/102445)를 참고하세요.

설치가 끝나면 터미널에 `Installed at ...`가 출력됩니다. 1.4.6부터는 취소·설치 진행·잘못된 설치 응답도 표시합니다. 백그라운드 모니터가 보이지 않으면 아래 명령으로 최근 실행 오류를 확인할 수 있습니다. 사용자 지정 프로필을 사용했다면 그 폴더의 `startup.log`를 확인하세요. 로그에는 로컬 경로 등 진단 정보가 들어갈 수 있으므로 공개 전에 확인하세요.

```sh
cat "$HOME/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts/startup.log"
```

## 업데이트와 제거

Windows에서 설정까지 삭제하려면 설치기의 `-Uninstall -PurgeSettings` 옵션을 사용합니다. 1.4.10부터 설정 JSON 외에 작업표시줄용 지피쨩 아이콘·바로가기 캐시도 정리하며, 일반 제거는 기존처럼 설정을 보존합니다. 이미 앱을 제거한 뒤에도 다운로드 ZIP의 설치기에 같은 옵션을 지정할 수 있습니다. 알 수 없는 파일과 연결된 외부 폴더는 보존합니다.

설치형은 새 설치 ZIP의 Install 진입점을 실행하면 전체 파일의 SHA-256을 확인한 후 교체합니다. 내부 `windows/update.cmd` / `macos/update.command`도 설치형 갱신용입니다. 포터블은 설정에서 자동 업데이트하거나 종료 후 새 포터블 ZIP으로 교체하세요. 자동 업데이트는 설치형·포터블 모두 현재 실행 위치를 갱신합니다.
다운로드 폴더에서 실행 중인 이전 무설치 복사본은 먼저 종료하세요. 설치된 복사본은 업데이트가 종료 요청을 보내고, 교체 후 다시 실행합니다.
설정과 알림 기록은 설치 파일과 별도 보관하여 업데이트·제거 시 보존합니다.
Windows는 설치된 `windows/uninstall.cmd` 또는 Windows 설치된 앱 목록에서 제거할 수 있습니다.
Mac은 설치된 `macos/uninstall.command`로 제거합니다. 이 버전의 로그인 등록만 함께 지웁니다.

Windows 프로필: `%LOCALAPPDATA%\DailyOddBuilds\CodexUsageMonitorScripts`
Mac 프로필: `~/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts`
기존 EXE의 `CodexUsageMonitor` 설치·설정에는 접근하지 않습니다.

## 파일 검증의 범위

`payload.sha256`은 손상·누락된 파일을 거부합니다. 배포자 인증용 전자서명은 아닙니다.
별도 업데이트 서버는 없습니다. GitHub 공개 Release를 에디션/OS별로 조회하는 자동 업데이트와 수동 ZIP 업데이트를 지원합니다. 자동 업데이트는 기본 OFF(설치 전 확인)이며 ON이면 확인 없이 진행합니다. Codex 비활성 시 조회하지 않고 활성 중 6시간 주기로 확인합니다. 새 버전이 없거나 조회에 실패하면 현재 파일을 계속 실행합니다. 자세한 자산 목록은 [RELEASE.md](RELEASE.md)를 확인하세요.

## 숨긴 모니터 다시 찾기

Windows에서는 패널을 숨긴 동안 복귀용 트레이 아이콘이 유지됩니다. 아이콘의 우클릭 메뉴에서 설정 또는 모니터 ON을 선택하세요. 트레이 아이콘 OFF 선호는 패널 복원 후 다시 적용됩니다.

설치형의 시작 메뉴 또는 포터블의 Start 실행기를 다시 실행해도 숨김 상태의 설정창을 열 수 있습니다. macOS에서는 메뉴 막대 아이콘이나 Start.command를 사용하세요. Windows 로그온 자동 시작과 업데이트 후 재시작은 백그라운드 상태를 유지합니다.

제거 CMD 실행기는 자신이 삭제된 뒤 정상 종료하도록 해당 CMD 프로세스를 종료합니다. 열려 있는 명령 프롬프트를 유지하려면 `cmd /c "설치 경로\windows\uninstall.cmd"`로 실행하거나 설치된 앱 목록/제거 바로가기를 사용하세요.

### Windows 실행 진단 로그

1.5.3부터 설정 폴더의 `runtime.jsonl`과 작업표시줄용 `runtime-taskbar.jsonl`에 시작·종료 사유와 예외 형식·발생 파일/줄을 남깁니다. 각 로그는 약 256 KiB에서 직전 파일 한 개로 순환하고 같은 오류는 횟수로 묶습니다. 예외 메시지, 계정 응답·인증 정보·대화 내용은 기록하지 않습니다. 로컬에만 보관하며 자동 전송하지 않습니다.
