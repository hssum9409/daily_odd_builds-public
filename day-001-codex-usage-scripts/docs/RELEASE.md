# Codex Usage Monitor Scripts 1.4.4 — 배포 안내

모든 배포물은 OS 내장 런타임으로 실행되는 스크립트입니다. 1.4.4는 Windows 설치본의 백그라운드 실행 경로를 보완합니다. 공개된 1.4.3 파일은 교체하지 않습니다. Mac은 **실기기 미검증 preview**를 유지합니다.

## 1.4.4 변경 사항

시작 메뉴·설정 바로가기·자동 시작은 공통 백그라운드 실행기를 사용하고, 설치 직후·업데이트 후 실행도 콘솔과 입출력 핸들을 분리합니다. 구버전 바로가기나 업데이터가 모니터를 직접 실행해도 모니터가 스스로 콘솔에서 분리됩니다. 기존 직접 실행 방식의 자동 시작 등록은 설치 시 이행하며 새 방식의 등록도 갱신·제거 때 올바르게 처리합니다.

## 1.4.3 변경 사항

Windows 포터블의 실행용 CMD 창을 자동으로 닫고, 모니터는 콘솔 창 없는 별도 프로세스로 실행합니다. 시작·새로고침·설정 실행기가 같은 백그라운드 실행 방식을 사용합니다. 기존 CMD를 닫아도 모니터가 종료되지 않습니다.

| 플랫폼 / 방식 | 다운로드 | 실행 |
| --- | --- | --- |
| Windows 설치형 · 권장 | `CodexUsageMonitorScripts-1.4.4-windows-installer.zip` | 전체 압축 해제 → `Install.cmd` |
| Windows 포터블 | `CodexUsageMonitorScripts-1.4.4-windows-portable.zip` | 전체 압축 해제 → `Start.cmd` |
| macOS 설치형 · preview | `CodexUsageMonitorScripts-1.4.4-macos-installer-preview.zip` | 전체 압축 해제 → `Install.command` |
| macOS 포터블 · preview | `CodexUsageMonitorScripts-1.4.4-macos-portable-preview.zip` | 전체 압축 해제 → `Start.command` |

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

