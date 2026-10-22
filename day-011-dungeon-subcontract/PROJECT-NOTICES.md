# 출처와 라이선스

## 원본 에셋

실제 스프라이트, 타일, UI 테두리, 배경, 효과는 이 프로젝트에서 직접 픽셀을 작성한 원본입니다.
외부 게임의 이미지, 캐릭터, 로고, 스토리, 대사, 음원은 사용하지 않았습니다.
효과음은 수학적으로 합성한 사각파 샘플이며 외부 음원을 샘플링하지 않았습니다.
화면 참고 컨셉은 OpenAI의 내장 Image Gen 도구로 이번 작업에서 생성했습니다.
외부 폰트 파일은 배포하지 않습니다. 본문은 운영체제 시스템 폰트를 사용합니다.
프로젝트의 소스와 원본 아트에 별도의 공개 배포 라이선스를 임의로 부여하지 않습니다.

## 의존 라이브러리

React / React DOM, Phaser 3, Zustand, Vite, TypeScript, Vitest, Playwright 및 개발 도구는 npm의 공식 패키지를 사용합니다.
직접 의존 라이브러리는 MIT 또는 Apache-2.0 계열 라이선스입니다.
배포 ZIP은 설치된 프로덕션 의존 라이브러리의 실제 LICENSE 파일과 package.json의 라이선스 정보를 THIRD_PARTY_LICENSES.txt로 함께 제공합니다.
lockfile은 버전을 고정합니다. 공개 배포를 결정할 때 최종 배포물과 저작권 고지를 함께 검토합니다.

## 게임 시스템 레퍼런스

2004년 소프트하우스 캐라의 巣作りドラゴン은 방 배치·방어 몬스터·자동 침입·턴 종료 정산과 전투 관찰의 접근 방식만 참고했습니다.
다음은 공개된 시스템 설명 및 공략입니다. 원작을 직접 실행해 확인한 자료로 취급하지 않습니다.

- [방 배치와 자동 전투 / 정산에 대한 공개 플레이 감상](https://www.netlaputa.ne.jp/~gk-home/kansou-sudukuridragon.html)
- [당시의 방/함정 데이터 공략](https://blog.livedoor.jp/p-6806241/archives/4642474.html)
- [발매 정보](https://www.suruga-ya.jp/product/detail/145011207)
- [공식 DMM 데모의 수비 화면을 게재한 기사](https://news.denfaminicogamer.jp/news/200323h-2): 02:23 수비 캡처를 방/통로 공간감의 시각 참고로 확인했습니다. 캡처나 원작의 텍스처·UI·가구는 배포물에 포함하지 않습니다.
- [게임메카의 둥지 배치 화면과 소개](https://dpg.danawa.com/mobile/news/view?boardSeq=60&listSeq=3085337)

게임의 세계관, 직원, 계약 문구, 다중 차원문, 정찰 기억과 경영 수치는 새로 작성했습니다.
- 0.9의 4방향 스프라이트 8시트와 BGM 3곡도 프로젝트 원본입니다. BGM은 직접 작성한 악보와 합성기로 만들며 외부 멜로디·샘플·음원을 포함하지 않습니다. 제작용 NumPy는 BSD-3-Clause이며 웹 배포물에는 포함되지 않습니다.
- [Cookie Clicker 공식 실행 코드](https://orteil.dashnet.org/cookieclicker/main.js): 0.9의 자동저장·저장 코드 내보내기/가져오기 조작 흐름을 읽어 확인했습니다. 본 게임은 독자적인 압축 JSON·SHA-256 형식을 사용하며 해당 코드를 복제하지 않습니다.
- [Cookie Clicker 공식 Steam](https://store.steampowered.com/app/1454400/Cookie_Clicker/): 고정된 게임 영역과 독립 관리 목록의 배치만 참고했습니다. 공식 웹판은 보안 확인 화면으로 실제 게임 조작을 확인하지 못했습니다. 원작 에셋·코드는 포함하지 않습니다.
- 0.10 앱 아이콘·favicon·마스킹 아이콘·시작화면 38장은 기존 32색 팔레트로 새로 작성한 원본 픽셀 아트입니다. 외부 이미지·폰트·템플릿이 없습니다. 원본 생성기와 검수 시트를 `art_sources/ui/app-icon/`에 보관합니다.
- 0.11의 WebP·압축 PNG·FLAC은 위 원본의 무손실 배포본입니다. 개발용 Pillow(MIT-CMU), NumPy(BSD-3-Clause), SoundFile(BSD-3-Clause)/libsndfile(LGPL-2.1-or-later)은 제작 환경에서만 실행하며 웹 배포물에 라이브러리 코드를 포함하지 않습니다. 압축으로 원본 에셋의 권리나 배포 조건은 달라지지 않습니다.
