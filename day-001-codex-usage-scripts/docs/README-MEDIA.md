# README 이미지 출처와 재현 범위

2026-10-12, 스크립트 1.4.2의 Windows WPF 렌더러로 제작했습니다.

- `settings.png`, `style.png`: 실제 설정 위젯을 RenderTargetBitmap으로 렌더링한 화면입니다.
- `usage.png`, `notices.png`, `plans.png`: 같은 제품의 카드 렌더러에 샘플 응답을 넣고 설명용 WPF 캔버스에 배치했습니다.
- `hero.webp`: 지피쨩 기존 아트와 실제 카드 렌더링, 설명 문구를 WPF 캔버스로 구성한 뒤 무손실 WebP로 변환했습니다. 캐릭터 원본은 수정하지 않았습니다.
- 숫자는 샘플입니다. 개인 계정 정보, 다른 앱의 작업 내용, 실제 리셋 공지나 크레딧 소모 기록을 촬영하지 않았습니다.
- Free/Plus/Pro 이미지는 제공 정보의 형태를 보여주며 플랜별 고정 혜택이나 현재 한도를 보장하지 않습니다.
- 알림과 소리 옵션은 기본 ON을 보여주지만 캡처용 실행에서는 소리를 재생하지 않았습니다.
- 모든 UI 이미지는 Windows입니다. Mac 실기기 화면 또는 Mac 동작 검증으로 표시하지 않습니다.

제작 도구는 개발 저장소의 `render_plan_examples.ps1`, `render_release_media.ps1`입니다. 이 공개 소스 스냅샷에는 개발 도구/캡처용 프로필/QA 로그를 포함하지 않습니다.

README 구성은 국내 개발자의 [fzf](https://github.com/junegunn/fzf), 토스의 [es-toolkit](https://github.com/toss/es-toolkit), NHN의 [TOAST UI Editor](https://github.com/nhn/tui.editor)를 참고했습니다. 각자의 소개·빠른 시작·설치 표·시각 예시 구성만 참고하고 문구와 이미지는 복사하지 않았습니다.

지피쨩 아트의 출처와 적용 범위는 [ARTWORK.md](ARTWORK.md)를 참고하세요.

## 2026-10-27 · 별도 홍보 카드

`promotion-20261027.webp`는 기존 지피쨩 아트와 제품의 흑연색·민트색을 참고해 새로 생성한 정사각 홍보 일러스트입니다. 기존 hero·사용량·설정 예시는 1.4.2 Windows 렌더러의 자료로 유지하며, README의 현재 다운로드 버전과 구분합니다. 홍보 카드는 실제 UI나 계정 데이터의 캡처가 아닙니다.

GPT-6 Astra / High 아트 작업자가 Day 1·2·3·7·8 참고 픽셀과 이 제품의 캐릭터를 확인하고 내장 이미지 생성 도구를 직접 호출했습니다. 작업자의 reasoning 설정과 이미지 backend 모델·품질·과금 등급은 별개이며 후자는 도구에 노출되지 않았습니다. PNG 원본과 프롬프트는 제작 자료에 보존하고 공개 WebP는 같은 크기의 무손실 변환으로 제공합니다.
