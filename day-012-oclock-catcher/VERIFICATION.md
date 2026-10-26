# 운영 검증 · 2026-10-27

대상: https://oclock-catcher-20261027.web.app/ · v0.1.0. 로컬 Windows에서 Firebase CLI로 배포했으며 GitHub Actions는 사용하지 않았다.

## 실제 브라우저와 운영 서비스

2026-10-27 02:00 KST 자연 정각 실행은 빈 회차를 10.158초 뒤 게시했습니다. 별도 운영 검증 회차에서 실제 브라우저의 독립 익명 세션 2개로 ±3초 입력·1회 잠금·서버 판정·우승 파일 자동 전송과 양쪽 화면 표시를 확인했습니다. 검증 회차는 운영자 전용 Scheduler로 정산했으며 서버 기준 우승 오차는 +42ms였습니다.

- 운영 HTTPS에서 reCAPTCHA Enterprise 토큰 교환 200 및 Firebase 익명 인증 200을 관찰했다. 두 Hosting origin의 독립 익명 세션으로 참가했다.
- 준비 시 두 이미지 모두 기기 안에서 약 6KB → 4KB로 압축했다. 결과 전 우승 업로드 POST가 없었고, 우승자만 파일을 전송했다. 실제 브라우저와 운영 provider의 관찰을 기준으로 기록했다.
- 5초 연습 실측: 내 터치 +45ms / 서버 도착 +251ms / 추정 전송 206ms. 재연결 뒤 RTT 약 78~80ms. 특정 순간·연결의 관찰이며 일반 지연 보장은 아니다.
- 1536×1024 및 390×844 데스크톱 브라우저 viewport를 확인했다. 모바일 화면의 scrollWidth 375, innerWidth 390으로 가로 넘침이 없었다. 물리 모바일 검증과 구분한다.
- 검증 회차 우승 오차 42ms. 수동 정산 대기시간을 포함한 검증 회차 게시까지의 경과는 529175ms이며, 정상 정시 실행의 10.158초와 구분한다. 공개 결과는 참가자 UID·이미지 해시를 포함하지 않는다.
- 파일 GET 200, image/webp, 2474 bytes. SHA-256 경로 일치, 정적 WebP 실제 디코딩·크기·메타데이터 제거를 확인했다. 운영 Storage의 해당 회차 파일은 1개다.
- 이미지 응답 Cache-Control: public, max-age=31536000, s-maxage=86400, immutable. 관찰한 Age: 없음. 캐시 헤더와 실제 CDN 적중은 구분한다.

## 운영 차단과 배포 상태

- RTDB App Check enforcement: ENFORCED. 토큰 없는 공개 경로 요청도 401 Missing appcheck token.
- 운영 RTDB Rules와 로컬 시험 파일의 JSON이 일치했다. 직접 Storage 업로드는 403, 인증 없는 winner 업로드는 401, 운영의 /local/round 및 /local/settle은 404였다.
- api/hourly/cleanup은 ACTIVE, 두 Scheduler job은 ENABLED다. cleanup 수동 실행은 성공 상태이며 두 등록 데이터를 유지했다.
- 수동 hourly 호출이 미래 예정 시각을 전달하는 실제 동작을 확인했다. 5초보다 이른 예정 회차는 worker에서 즉시 종료하며, 늦은 재시도는 원래 회차를 유지한다. 자연 정각의 빈 회차 실행과 운영자 지정 검증 회차를 구분했다. 검증 회차는 서버 전용 만료 설정과 지정 UID만 사용하며 일반 참가자는 만들거나 바꿀 수 없다. 검증 후 임시 Scheduler job과 지정·설정을 정리하고 이전 자연 회차 전시로 복원한다.
- Functions는 로컬 TypeScript 빌드의 lib를 업로드한다. src는 배포 패키지에서 제외하고 gcp-build를 빈 문자열로 설정했다. 관리형 컨테이너 준비 단계는 Firebase 배포 과정에서 수행된다. 컨테이너 이미지 정리 정책은 7일이다.

## 로컬 검사와 한계

최종 npm run verify:local이 빌드 → 단위 7개 → 에뮬레이터 통합 12개 → 에뮬레이터 종료까지 exit 0으로 통과했다. 통합 검사의 64개 동시 클라이언트·1만 합성 기록은 실제 인터넷 부하 검증이 아니다.

실제 대규모 동시 접속, 물리 Android/iOS, Safari, Firefox 및 모든 네트워크의 비대칭 지연은 미검증이다. 익명 신원당 1회이며 동일인의 브라우저 초기화·다중 계정·자동 클릭을 완전히 방지하지 않는다. Scheduler 장애 시 정확히 00분 10초 게시를 보장하지 않는다.
