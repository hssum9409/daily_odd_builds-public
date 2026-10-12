# 공개 버전 검증 범위

Windows 실제 WPF/패키지 진입점, 설치·업데이트·롤백·제거를 격리된 프로필로 검사했습니다.
GitHub HTTP/확인창 응답은 로컬 fixture로 대체했으며 공개 후 실제 다운로드 검증을 별도로 수행합니다.
Mac은 JS 문법·공통 로직·ZIP 권한 및 POSIX 설치 파일 작업 검증까지입니다. 실제 macOS 실행·자동 업데이트·권한·로그인은 미검증입니다.
[Mac 장치 QA](MAC-QA.md)와 [Windows 실사용 범위](WINDOWS-QA.md)를 확인하세요.
