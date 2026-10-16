# Codex Usage Monitor Scripts 1.4.7 — 배포 안내

모든 배포물은 OS 내장 런타임으로 실행되는 스크립트입니다. 1.4.7은 Windows 설치형 자동 업데이트의 폴더 교체 오류를 수정하고 복구 실패 로그를 보강합니다. 기존 공개 ZIP은 교체하지 않고 새 버전으로 제공합니다. Mac은 **전체 기능 실기기 미검증 preview**를 유지합니다.

## 1.4.7 변경 사항

Windows 설치 폴더를 PowerShell 작업 위치로 사용하던 1.4.4에서 자동 업데이트할 때, 설치 폴더가 사용 중이라 교체와 복구가 모두 실패하던 문제를 수정했습니다. 설치기·업데이터의 PowerShell 작업 위치와 백그라운드 실행기의 작업 위치를 임시 폴더로 옮깁니다. 기존 1.4.4 업데이터도 새 설치기를 내려받아 사용하므로 별도의 구버전 패치는 필요하지 않습니다.

업데이트 작업 폴더에 `update.log`, `install.stdout.log`, `install.stderr.log`와 복구 단계 로그를 보관합니다. 복구까지 실패하면 `result.json`에 원래 오류·복구 오류·실패 단계·백업 위치를 함께 기록하고 `recovery_required` 상태로 남깁니다. 구버전 업데이터가 실행하는 새 설치기도 프로필의 `install-last-error.json`에 실패 원인을 남깁니다.

Windows/Mac ‘만든놈’과 README의 전체 프로젝트 링크를 [Daily Odd Builds](https://daily-odd-builds-portal.web.app/)로 바로잡았습니다. Mac 기능은 기존 수정 사항을 유지하며 preview로 제공합니다.

## 1.4.6 변경 사항

Windows/Mac 모두 Codex Resets의 `active_watch`를 읽어 `리셋 조짐 · 24시간 이내 가능성`처럼 표시합니다. 일반/보관형 리셋 예고와 문구를 구분하고 기존 알림 디자인·표시/소리 설정·원문 링크를 사용합니다. 유효기간이 지나거나 더 최근의 리셋 완료가 확인되면 숨기고, 정식 예고가 함께 있으면 예고를 우선합니다. 조짐 유효기간을 리셋 예정 시각으로 사용하지 않습니다. 같은 게시물은 중복 알리지 않고 설정된 10분/30분/1시간/2시간 간격에 재표시합니다. 실제 예정 시각에 적용되는 필수 임계 알림은 조짐에는 적용하지 않습니다.

Mac 설치 동의 응답에서 언어를 읽는 셸 코드가 GNU sed 확장에 의존하던 문제를 POSIX 정규식으로 수정했습니다. 취소·설치 진행·잘못된 응답·설치 UI 실패를 터미널에 표시하며, 라이선스 동의 후 실제 설치 스크립트까지 연결되는 배포 ZIP 검사를 추가했습니다. 이 검사는 Windows의 Git Bash/POSIX 모드와 모의 UI 경계를 사용하므로 실제 macOS 설치 성공의 증거는 아닙니다.

Mac 폴더 생성의 ObjC nil 인수, 글자 서식과 렌더링 재시도, 실행 앱 번들 및 중첩 CLI 탐색을 수정했습니다. macOS 14.6.1 / arm64 사용자 진단 v6에서 CLI 발견·프로세스 시작·계정/사용량 응답 수신을 확인했고, 앞선 v4에서 실제 글자 표시를 확인했습니다. 설정창의 지역 함수를 모듈 객체로 호출하도록 수정한 v7 영역은 아직 실기기 미검증입니다. 이 결과를 전체 설치·Pet 추적·업데이트 검증 완료로 확대하지 않습니다.

Mac 백그라운드 실행 오류는 프로필의 `startup.log`에 남기고 직전 로그는 `startup.previous.log`에 보관합니다. 설치 성공 시 `Installed at ...`가 표시됩니다. 기존 Mac 설치가 동의 직후 끝났다면 새 설치 ZIP을 전체 압축 해제해 `Install.command`를 실행하세요.

## 1.4.5 변경 사항

Mac 설치기의 언어 선택·라이선스 동의 창에서 `runModal` 반환값을 함수로 다시 호출하여 설치가 중단되던 오류를 수정했습니다. 실행·대기·종료, 파이프·잠금·타이머·창·애니메이션에도 JXA의 무인수 Objective-C 메서드 접근 규칙을 적용했습니다. 관련 모의 호스트도 함수 대신 getter를 사용하도록 고쳐 재발 검사를 추가했습니다.

Windows/Mac 설치형·포터블·자동 업데이트 ZIP을 같은 버전으로 제공합니다. Windows 기능 변경은 없으며 기존 백그라운드 실행 수정을 유지합니다. 실제 Mac 설치·화면 표시·Pet 추적·업데이트는 아직 미검증입니다. 1.4.4 이하에서 설치가 중단됐다면 새 설치 ZIP을 전체 압축 해제하고 `Install.command`를 실행하세요. 기존 Mac 업데이터에도 같은 호출 오류가 있어 이 수정은 수동 설치를 권장합니다.

## 1.4.4 변경 사항

시작 메뉴·설정 바로가기·자동 시작은 공통 백그라운드 실행기를 사용하고, 설치 직후·업데이트 후 실행도 콘솔과 입출력 핸들을 분리합니다. 구버전 바로가기나 업데이터가 모니터를 직접 실행해도 모니터가 스스로 콘솔에서 분리됩니다. 기존 직접 실행 방식의 자동 시작 등록은 설치 시 이행하며 새 방식의 등록도 갱신·제거 때 올바르게 처리합니다.

## 1.4.3 변경 사항

Windows 포터블의 실행용 CMD 창을 자동으로 닫고, 모니터는 콘솔 창 없는 별도 프로세스로 실행합니다. 시작·새로고침·설정 실행기가 같은 백그라운드 실행 방식을 사용합니다. 기존 CMD를 닫아도 모니터가 종료되지 않습니다.

| 플랫폼 / 방식 | 다운로드 | 실행 |
| --- | --- | --- |
| Windows 설치형 · 권장 | `CodexUsageMonitorScripts-1.4.7-windows-installer.zip` | 전체 압축 해제 → `Install.cmd` |
| Windows 포터블 | `CodexUsageMonitorScripts-1.4.7-windows-portable.zip` | 전체 압축 해제 → `Start.cmd` |
| macOS 설치형 · preview | `CodexUsageMonitorScripts-1.4.7-macos-installer-preview.zip` | 전체 압축 해제 → `Install.command` |
| macOS 포터블 · preview | `CodexUsageMonitorScripts-1.4.7-macos-portable-preview.zip` | 전체 압축 해제 → `Start.command` |

설치형은 Windows `%LOCALAPPDATA%/Programs/CodexUsageMonitorScripts`, Mac `~/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts/app`에 복사됩니다. 설치 후 다운로드 ZIP과 원본 폴더를 삭제해도 됩니다. 포터블은 실행 폴더를 유지해야 합니다. 원본 ZIP은 삭제해도 됩니다. 관리자 권한이나 Python/Node 설치는 필요 없습니다.

Mac에서 실행 권한이 유지되지 않으면 터미널에서 압축 해제한 폴더로 이동해 `sh ./Start.command` 또는 `sh ./Install.command`를 실행하세요. Pet 추적에는 접근성 권한이 필요할 수 있습니다. Finder 실행·quarantine·Intel/Apple Silicon·AppKit·launchd·업데이트는 실제 Mac에서 미검증입니다. [MAC-QA.md](MAC-QA.md)를 확인하세요. 보안 정책은 자동으로 변경하지 않습니다.

## 자동 업데이트

공개 저장소 `hssum9409/daily_odd_builds-public`의 `day001-vX.Y.Z` Release를 직접 조회합니다. 별도 서버가 필요 없습니다.

| 설치 / 포터블 | 자동 업데이트 파일 | 교체 대상 |
| --- | --- | --- |
| Windows 둘 다 | `CodexUsageMonitorScripts-windows-update.zip` | 현재 실행 폴더; 설치형은 등록된 설치 경로 |
| macOS 둘 다 · preview | `CodexUsageMonitorScripts-macos-update-preview.zip` | 현재 실행 폴더; 설치형은 설치 영수증 경로 |

설정의 자동 업데이트는 기본 OFF입니다. OFF여도 새 버전을 확인하고 설치 여부를 묻습니다. ON이면 확인창 없이 진행합니다. Codex 활성 시 확인하고 활성 중 6시간 간격으로 조회하며, 비활성 시 조회하지 않습니다. 설정에서 수동으로 새 버전을 확인할 수도 있습니다.

SHA-256·파일 크기·버전·ZIP 경로·payload manifest 검증 → 자기 모니터 종료 → 코드와 에셋 교체 → 재실행 준비 응답 확인 순서입니다. 시작 실패 시 이전 버전으로 복구합니다. 사용자 설정·알림 기록·시작 등록은 유지합니다. 쓰기 권한 없는 포터블 폴더에서는 업데이트할 수 없습니다. 종료 후 쓰기 가능한 폴더로 옮겨 실행하세요. 폴더를 옮겼다면 시작 등록을 해제한 뒤 새 위치에서 다시 등록하세요.

새 버전 없음·미배포·오프라인·손상 ZIP·잘못된 버전은 현재 파일을 유지합니다. 403/429에는 대기 시간을 적용합니다. 이미 실행 중인 업데이트와 중복 실행하지 않습니다. 강제 전원 종료 중의 교체는 원자적인 OS 트랜잭션이 아니므로 완전한 복구를 보장하지 않습니다. 복구용 backup은 프로필의 updates 폴더에 보존합니다.

Mac preview 자산을 받기 위해 Release 자체는 일반 릴리즈로 만들고, Mac 다운로드 이름·문서에 preview를 유지합니다. draft/prerelease Release는 자동 업데이트가 무시합니다. 업데이트 ZIP 두 개와 `SHA256SUMS.txt`를 모두 업로드·검증한 뒤 공개해야 합니다. 체크섬은 파일 무결성 검사이며 배포자 인증용 전자서명은 아닙니다.

## 수동 업데이트 / 제거

설치형은 새 설치 ZIP의 `Install.cmd` / `Install.command`를 실행하면 기존 설정을 보존하며 갱신합니다. 내부 `update.cmd` / `update.command`도 **설치형 갱신용**입니다. 포터블을 유지하려면 자동 업데이트를 사용하거나, 모니터를 종료하고 새 포터블 ZIP을 별도 폴더에 풀어 실행하세요. 기존 설정은 별도 프로필에 남습니다.

설치형은 Windows 설치된 앱/시작 메뉴의 Uninstall, Mac 설치 폴더의 `macos/uninstall.command`로 제거합니다. 기본적으로 설정을 보존합니다. 포터블은 자동 시작을 등록했다면 `remove-startup.cmd` / `remove-startup.command`로 먼저 해제하고, 모니터를 종료한 뒤 실행 폴더를 삭제하세요.

