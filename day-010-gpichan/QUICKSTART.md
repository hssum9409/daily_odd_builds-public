# 지피쨩 0.5.1 · 설치와 연결

컴퓨터 호스트와 Android 앱 둘 다 필요합니다. Codex Desktop은 기존 대화와 설정을 유지한 채 실행해 둡니다. 호스트는 로그인한 같은 사용자로 실행합니다. 로그인 전 시스템 서비스가 아닙니다.

## Windows x64

[릴리스](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day010-gpichan-v0.5.1)에서 Setup 또는 Portable ZIP을 받습니다. 포터블은 반드시 전부 압축 해제하세요. Python·Node·TLS 런타임이 들어 있어 별도 Flutter/Dart 개발 도구는 필요하지 않습니다. 기본 호스트는 Codex CLI 없이 기존 Desktop IPC를 사용하고, Queue에는 Codex CLI가 필요합니다.

Setup의 자동 시작과 설치 후 실행은 기본 선택되지 않습니다. 실행 파일이 Windows 보안 정책으로 거부되면 임의 인증서 설치나 보안 기능 해제로 진행하지 마세요. SmartScreen에는 정책에 따라 개별 실행 허용이 있지만 Smart App Control에는 앱별 예외가 없습니다. 이 배포물의 Windows EXE는 미서명입니다.

설치 폴더에서 PowerShell을 열고 다음을 실행합니다. 포터블도 같은 명령을 사용합니다.

```powershell
.\gpichan.exe configure
.\gpichan.exe start
.\gpichan.exe status --json
.\gpichan.exe pair
.\gpichan.exe pending
.\gpichan.exe approve <요청-ID>
```

Setup 기본 설치 경로는 `%LOCALAPPDATA%\Programs\Gpichan`입니다. 포터블에서는 `configure`를 먼저 실행해 현재 폴더의 절대 경로를 저장하세요. 폴더를 이동했다면 호스트 정지 후 다시 설정합니다. `start` 후 터미널을 닫아도 호스트는 유지됩니다.

## macOS preview

현재 Mac ZIP은 native 앱이 아닌 **Dart 3.13.5 kernel**입니다. Python 3, Node.js, 정확한 Dart SDK 3.13.5와 OpenSSL이 있어야 합니다. 설치기는 누락된 도구를 자동 다운로드하지 않습니다. 실제 Mac·launchd·Codex Desktop 연결은 미검증입니다.

```sh
./install.command
cd "$HOME/Library/Application Support/GpichanCLI"
./gpichan doctor --json
./gpichan start
./gpichan pair
./gpichan pending
./gpichan approve <요청-ID>
```

Gatekeeper가 미확인 개발자/미공증 경고를 표시하면 신뢰한 파일에 한해 시스템 설정의 개인정보 보호 및 보안에서 개별 실행을 허용할 수 있습니다. 실제 설치 스크립트와 하위 런타임 각각의 허용 여부를 확인해야 합니다. 격리 표시를 자동 삭제하거나 Gatekeeper를 끄지 않습니다.

## Android 연결

1. [릴리스 APK](https://github.com/hssum9409/daily_odd_builds-public/releases/download/day010-gpichan-v0.5.1/Gpichan-android-0.5.1.apk)를 설치합니다. 설치에 사용한 브라우저/파일 관리자의 외부 앱 설치 허용이 필요할 수 있습니다.
2. 컴퓨터와 같은 사설 Wi-Fi에 연결합니다. 게스트 네트워크의 기기 격리나 방화벽이 있으면 직접 연결이 되지 않을 수 있습니다. 호스트는 방화벽을 자동 변경하지 않습니다.
3. 앱의 QR 연결에서 카메라를 허용하고 `pair`의 3분 유효 QR을 스캔합니다. 컴퓨터의 `pending`과 `approve`로 직접 승인합니다. 승인 전에 대화가 노출되지 않아야 합니다.
4. 상단에서 대화를 선택합니다. 말풍선은 머리 위, 텍스트 입력은 하단에 있습니다. 간식은 얼굴 오른쪽 위 버튼입니다. 대화/설정과 세션 목록을 열면 캐릭터가 하단에 웅크립니다.
5. 길게 누르기는 강한 콕, 볼 가로 드래그는 볼 늘이기입니다. 흔들기·움직임 줄이기·Codex 터치 전달은 설정에서 선택합니다.

기존 개발 APK와 이번 APK는 서명이 달라 바로 덮어쓸 수 없습니다. 설치 충돌 시 기존 앱의 연결을 잊고 개발 APK를 제거한 뒤 설치·재페어링하세요. 컴퓨터의 Codex 대화는 삭제되지 않습니다. 공개 버전의 서명 키는 후속 업데이트에 유지합니다.

## 명령과 중단

아래 `gpichan`은 Windows의 `gpichan.exe`, Mac의 `./gpichan`을 뜻합니다.

```sh
gpichan doctor --json
gpichan sessions --json
gpichan logs
gpichan restart
gpichan integration off
gpichan integration on
gpichan devices list
gpichan devices revoke <장치-ID>
gpichan startup status
gpichan startup enable
gpichan startup disable
gpichan stop
```

`startup enable`은 명시적 동의를 받습니다. 설치 과정에서 동의해도 OS가 실행을 거부하면 자동 시작은 동작하지 않습니다. Windows는 사용자 Run 항목, Mac은 사용자 LaunchAgent로 로그인 후 실행합니다. 작업 관리자에서 비활성화한 항목을 자동으로 다시 켜지 않습니다.

사설 LAN IPv4 하나는 자동 선택합니다. 여러 어댑터가 있으면 `gpichan stop` 뒤 `gpichan configure --bind <PC의 사설-IPv4>`로 선택합니다. 네트워크 준비 전에는 대기하며, 네트워크 변경 뒤에는 `restart`로 다시 탐색합니다. QR 또는 포트를 인터넷에 노출하지 마세요.

`send --session <기존-ID> --mode steer|queue|start --message <텍스트>`로도 명시적 입력을 보낼 수 있습니다. Queue는 후속 입력이며 유휴 대화에서 바로 실행될 수 있습니다. 전송 결과가 불명확하면 자동 재전송하지 않습니다. 기존 Desktop 대화를 먼저 확인하세요.

## 제거와 개인 데이터

Windows 설치형은 Windows 앱 제거, Mac은 설치 폴더의 `./uninstall.command`를 사용합니다. 포터블은 `stop`과 `startup disable` 후 자신의 압축 해제 폴더를 제거합니다. 기존 Codex Desktop과 대화는 유지합니다.

장치 승인·TLS·설정은 별도 개인 데이터에 남깁니다. Windows는 `%LOCALAPPDATA%\Gpichan`, Mac은 `~/Library/Application Support/Gpichan`입니다. 완전 삭제는 먼저 자신의 호스트와 자동 시작을 정지한 뒤 이 Gpichan 전용 경로만 확인해 직접 삭제하세요. **`.codex`나 다른 앱의 폴더는 삭제하지 마세요.** 인증서/승인 데이터를 삭제하면 재페어링이 필요합니다.

[개인정보처리방침](PRIVACY.md) · [검증과 한계](https://github.com/hssum9409/daily_odd_builds-public/blob/main/day-010-gpichan/VERIFICATION.md)
