# 성실삐 0.6.6 · Day 005

macOS 0.6.5 설치 중 `Unsafe payload`로 종료되는 문제를 수정했습니다.

- Windows에서 패키지를 만들 때 `payload.sha256`에 CRLF 줄바꿈이 들어가 파일명 끝의 CR을 잘못된 경로 문자로 판단했습니다. 패키지의 파일 목록·체크섬·릴리스 메타데이터는 이제 운영체제와 관계없이 LF로 생성합니다.
- Mac 설치기는 검증과 파일 복사 단계 모두에서 LF·CRLF 파일 목록을 처리합니다. 경로 제한과 SHA-256 검증은 유지합니다.
- Mac의 `Diagnose.command`에 CRLF 목록 및 공백·괄호가 있는 다운로드 폴더에서의 설치 회귀 검사를 추가했습니다.

0.6.5 설치에 실패했다면 https://bbi.hssum.kr/download 에서 0.6.6을 새로 받아 ZIP 전체를 압축 해제한 후 `Install.command`를 실행하세요. 서버의 계정·업무 기록은 그대로 사용합니다.

Windows에서 실제 공개 0.6.5 ZIP의 CRLF 목록을 확인했습니다. 새 패키지의 전체 파일 해시, 실행 권한, LF 줄바꿈을 검사하고 POSIX 셸로 설치·CRLF 업데이트·손상 및 경로 이탈 거부·제거를 검증합니다. Windows 셸 검사는 macOS의 해시 도구만 같은 SHA-256 도구로 바꾼 임시 사본을 사용하며, Mac 실기기 AppKit·Keychain·Gatekeeper 실행 증거는 아닙니다. macOS는 preview 상태를 유지합니다.
