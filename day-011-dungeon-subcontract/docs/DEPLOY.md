# 정적 배포

이 제품은 공개 GitHub 릴리스의 정적 ZIP을 Firebase Hosting 사이트 `daily-odd-builds-dungeon`에 배포합니다. 포털과 같은 기존 프로젝트 `daily-odd-builds-portal`의 별도 Hosting 사이트이며 게임용 Auth·DB·Storage·Functions는 만들지 않습니다.

1. 제품별 `day011-dungeon-v0.13.0` 릴리스의 ZIP과 `SHA256SUMS.txt`를 내려받아 SHA-256을 확인합니다.
2. 압축을 현재 디렉터리의 `web/`에 풉니다. `.gitignore`는 이 재현용 폴더를 제외합니다.
3. 승인된 운영자 계정으로 Firebase CLI에 로그인하고 아래 명령을 실행합니다.

```sh
firebase deploy --only hosting --project daily-odd-builds-portal --config firebase.json
```

설정의 명시적인 `site`는 게임 사이트만 선택합니다. 포털 Hosting·Rules·서버 배포를 이 명령에 추가하지 않습니다. 배포 뒤 HTTPS 첫 화면, 새 게임·저장 복구, 실제 이미지/음원, 서비스워커와 오프라인 재열기를 검증합니다.

## 되돌리기

이전 게임 Hosting 릴리스가 있으면 Firebase Hosting의 해당 게임 사이트에서 이전 릴리스로 되돌립니다. 첫 공개에는 이전 게임 릴리스가 없습니다. 다른 Day나 포털의 배포를 되돌리지 않습니다. 공개 릴리스 태그를 옮기거나 기존 배포 ZIP을 같은 버전으로 교체하지 않고 수정 버전을 발행합니다.

공개 포털 데이터의 복구는 별도 작업입니다. 현재 게시 버전과 동시 수정을 먼저 확인하고 대상 Day만 수정합니다.
