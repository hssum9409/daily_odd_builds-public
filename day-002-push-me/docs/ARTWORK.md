# 홍보 아트 제작 기록 — 실사용 사례 개정

2026-10-13. 내장 imagegen으로 대표/정사각 이미지를 편집하고 기능 소개 4장을 제작했습니다. CLI/API fallback을 사용하지 않았습니다.

## 현재 방향과 출처

- 코랄 #DB5B4B, 흰색/회색과 벨 아이콘을 유지합니다.
- 대표 예시는 **5분 뒤 콘서트 예매 시작! / 눌러서 예매 대기 페이지로 바로가기**입니다.
- 알림 클릭 소개는 Push에서 예약에 지정한 예매 대기 페이지로 이동하는 흐름입니다. URL이 없으면 서비스로 돌아오며 예매 화면은 설명용 연출입니다.
- 기기 간 수신은 PC 예약과 같은 계정의 등록된 휴대폰을 연결합니다. 기기마다 로그인·권한·등록, iOS Home Screen 조건을 그림에 표시합니다.
- 그룹 알림은 두 갤러리 이름의 서비스 그룹과 완장 메시지입니다. Gemini 4 아르곤/다이마 8.3 내용은 가상이며 실제 뉴스·가격·특가 공지가 아닙니다.
- 매일 반복은 영양제 습관 알림으로 반복 슬롯 1개를 설명합니다.
- desktop.png / mobile.png는 실제 Flutter UI의 격리 예시 계정/예약 캡처를 새로 만들었습니다. 생성 편집의 UI 삽입 참조로도 사용했습니다. FCM 수신은 이 캡처에서 시험하지 않았습니다.
- 생성된 전화기·알림은 설명용 연출입니다. 실제 OS Push 수신 화면으로 제시하지 않습니다. source PNG는 내용 편집 없이 보존하고 hero.webp는 RGB 픽셀을 유지하는 무손실 변환입니다.
- 기기 간 페이지의 오래된 가상 입력 날짜를 실제 PC 목록으로 교체하고, 그룹 페이지의 불필요한 잠금 화면 날짜/시계는 제거했습니다. 기존 초안은 비공개 Git 이력에 남아 있습니다.

앱 원본 소스는 비공개입니다. 이 이미지/프롬프트를 공개하는 것이 앱 코드의 MIT/오픈소스 허가를 뜻하지 않습니다. Day 001 캐릭터나 타사 공식 로고는 사용하지 않았습니다. 이미지 내부의 UI 미세 문구는 원본 캡처와 차이가 있을 수 있습니다.

## 대표 배너 수정 — 실제 사용 프롬프트

```text
Edit the first attached image (existing landscape promo hero). The second image is the updated real app UI capture and is a supporting insert. Preserve the banner's overall coral/white/gray brand, layout, service title, large "사이트를 닫아도, 알림은 와요." headline, service URL, and footer. Replace the entire phone screen with the second supplied updated UI as faithfully as possible. It has two reservations: concert booking and daily vitamins, and two gallery groups. Remove all water-drinking, meeting and book-reading examples from the old phone screen.
Replace the foreground notification illustration with exactly:
"5분 뒤 콘서트 예매 시작!"
"눌러서 예매 대기 페이지로 바로가기"
The notification card may be widened/repositioned just enough to fit these two lines in a very readable size. Preserve the concert wording, punctuation and Korean spelling. Do not add a real ticketing vendor URL, ticket purchase, calendar integration or new app features.
Keep small footer "화면·알림은 설명용 예시입니다." and brand copy "개인 예약 · 그룹 알림 · 매일 반복", "dingdong-to-me.web.app". This remains a promotional illustration, never a real OS Push receipt. No water reminders anywhere. No extra invented dates or text.
```

## 정사각 카드 수정 — 실제 사용 프롬프트

```text
Edit the attached square promotional card, preserving its layout, colors, app title, "DAY 002", "미래의 나에게, 딩동.", feature line and service address. Replace only the water reminder with a larger two-line concert-booking notification card:
"5분 뒤 콘서트 예매 시작!"
"눌러서 예매 대기 페이지로 바로가기"
Make both lines clearly readable, with the first line bold and the second line below it. Keep the coral bell; add a small link/arrow hint if helpful, indicating the card opens the configured web page. Resize/shift the card modestly if needed to fit while preserving the square layout and generous margins. Keep footer "알림은 설명용 연출입니다." Remove any water-drinking wording. Do not change the message into a real ticket vendor ad or guaranteed exact-time claim.
```

## 기기 간 수신 소개 생성 — 실제 사용 프롬프트

```text
Create a finished Korean marketing feature page for "푸시알림 띄워줘", as part of a matching set. Wide landscape, approximately 1600x1000. Use the supplied banner only as brand/style reference: spacious white/off-white and light gray, coral #DB5B4B, crisp charcoal Korean typography and coral outlined bell. It is a new image, not an edit of the reference. No water-drinking examples, anime, mascot, third-party logos, QR, real credentials or source code. All notification cards are explicitly promotional illustrations, not actual OS receipt screenshots. Accurate legible Korean, clear hierarchy, generous margins.
This page explains cross-device account delivery. Headline exactly:
"컴퓨터에서 예약해 놓으면,"
"핸드폰에서도 딩동"
Subheading "같은 Google 계정으로, 기기마다 알림 받기"
Show a simple laptop at left scheduling a concert reminder, a clear coral directional link to a generic phone at right receiving that same reminder. On the reminder card include verbatim:
"5분 뒤 콘서트 예매 시작!"
"눌러서 예매 대기 페이지로 바로가기"
Small labels "PC에서 예약" and "등록된 휴대폰으로 Push".
Important readable bottom instruction: "각 기기에서 로그인 · 알림 허용 · 기기 등록이 필요해요"
Also "iPhone/iPad는 홈 화면 앱에서 설정" and footer "기기·알림은 기능 설명용 연출입니다."
Include small service URL "dingdong-to-me.web.app".
Do not claim the phone works without setup, or universal browser compatibility. Use a generic phone, no actual iOS lock-screen branding. No other examples or extra slogans.
```

## 기기 간 수신 — 실제 PC 화면 삽입 — 실제 사용 프롬프트

```text
Edit the first attached cross-device feature image. Use the second image (real updated app desktop capture) as a supporting insert. Preserve headline, service URL, all notification wording, device registration/iOS instructions, bell, phone, footer and overall composition. Replace only the laptop display with the second supplied real app screenshot, fitted accurately to the screen; it shows the concert and daily vitamins reminders. Remove the invented old 2024 date/input mockup by replacing the full screen. Do not introduce any numeric calendar dates or new UI controls. Preserve the phone notification verbatim: "5분 뒤 콘서트 예매 시작!" / "눌러서 예매 대기 페이지로 바로가기". Main headline stays "컴퓨터에서 예약해 놓으면, 핸드폰에서도 딩동". This remains a feature illustration, not real device receipt evidence.
```

## 그룹 메시지 소개 생성 — 실제 사용 프롬프트

```text
Create a finished Korean marketing feature page for "푸시알림 띄워줘", as part of a matching set. Wide landscape, approximately 1600x1000. Use the supplied banner only as brand/style reference: spacious white/off-white and light gray, coral #DB5B4B, crisp charcoal Korean typography and coral outlined bell. It is a new image, not an edit of the reference. No water-drinking examples, anime, mascot, third-party logos, QR, real credentials or source code. All notification cards are explicitly promotional illustrations, not actual OS receipt screenshots. Accurate legible Korean, clear hierarchy, generous margins.
This page explains user-created groups with owners scheduling messages to joined members. Headline:
"예약한 소식을,"
"그룹 멤버에게 딩동"
Subheading "그룹장이 예약하면, 가입한 멤버에게 알림"
Two large, very readable notification-example cards with group labels. First card label:
"특이점이 온다 갤러리 · 완장"
First card message, verbatim:
"속보! 구글 Gemini 4 아르곤 공앱 출시됨!"
Second card label:
"헬스 보충제 갤러리 · 완장"
Second card message lines, verbatim, preserve the playful deliberate typos:
"양야야야ㅑ야!!! 다이마 8.3 드디어 떴다"
"빨리 ㄱㄱ 누르면 쿠팡 링크 바로 열림"
A small link cue "알림을 누르면 지정한 웹 링크로" explains URL navigation. Show subtle group-members icons/flow, with no new chat/composer/admin features.
Bottom chips "그룹당 예약 20개" and "가입 그룹 최대 2개".
Important readable footer: "서비스 내 그룹의 가상 메시지 예시 · 실제 출시/특가 공지가 아닙니다."
Small URL "dingdong-to-me.web.app".
These release/deal claims are fictional user-requested examples, never real news. Do not invent real prices, affiliate URLs, purchases, official announcements or automatic gallery integration. No other slogans.
```

## 그룹 메시지 — 불필요한 날짜/시계 제거 — 실제 사용 프롬프트

```text
Edit the attached group messages feature image with one targeted change: remove the decorative phone lock-screen date "4월 13일 (일)" and the large "9:00" clock, leaving that area a quiet blank/pale background. Preserve everything else: headline, group-owner-to-members diagram, both group names, exact message texts, link hint, 20/2 limit chips, URL and the footer that labels fictional examples. Do not change or shorten the group messages. Keep first "속보! 구글 Gemini 4 아르곤 공앱 출시됨!" and second "양야야야ㅑ야!!! 다이마 8.3 드디어 떴다" / "빨리 ㄱㄱ 누르면 쿠팡 링크 바로 열림". No new dates, time, OS branding, official-news claims or invented UI.
```

## 매일 반복 소개 생성 — 실제 사용 프롬프트

```text
Create a new wide landscape Korean marketing feature page for "푸시알림 띄워줘", approximately 1600x1000. Use the attached hero only for matching style: white/off-white, gray, coral #DB5B4B, bold charcoal Korean editorial typography and coral bell icon. New feature graphic, not an edit target. This page introduces daily recurring reminders. No water-drinking reminder. Use the user's casual funny copy exactly, without replacing it with formal language.
Headline, two lines:
"매일 챙길 일은,"
"한 번만 예약하세요."
Subheading "매일 울려도, 예약은 1개"
Large prominent generic reminder illustration containing:
"영양제 먹어야 될 시간임"
"영양제 안먹는 습관좀 고쳐라 나 자신아..."
A readable coral chip "매일 반복 · 오후 9:00".
Show a small, clean progression of three day tiles "오늘" → "내일" → "모레", each with a bell, linked back to one reminder card / one reservation. No numeric calendar dates, phone time/date overlay or actual OS lock screen. Do not imply three separate bookings or claim exactly-once/on-time guaranteed delivery.
Bottom "개인 20개 · 그룹당 20개 한도에서도 반복은 1건"
Service URL "dingdong-to-me.web.app"
Footer "기능 설명용 알림 연출입니다."
No supplement product, dosage, medicine recommendation, health efficacy claim or other third-party branding. Just an ordinary reminder, not medical advice or adherence monitoring. No QR, extra slogan, real credentials, source code, open-source/MIT/free claims. Clean composition and high Korean text legibility.
```

## 알림 클릭 → 웹페이지 소개 생성 — 실제 사용 프롬프트

참조 이미지: 기존 기기 간 수신 소개의 색상·타이포그래피. 새 이미지 생성이며 기존 이미지는 수정하지 않았습니다.

```text
Use case: ads-marketing.
Create a finished Korean marketing feature page for "푸시알림 띄워줘", in a matching set. Wide landscape approximately 1600x1000. The attached image is ONLY a brand/style reference, not an edit target. Follow its spacious white/off-white background, light gray, coral #DB5B4B, charcoal Korean typography, coral outlined bell, gentle shadows and generous margins. New distinct composition; no plants or extra props needed.
Main feature: tapping a Push notification opens the HTTP/HTTPS web page supplied when scheduling.
Brand top-left "푸시알림 띄워줘" with coral bell.
Headline exactly, two lines:
"알림을 누르면,"
"원하는 페이지로 바로"
Subheading: "예매 시작 전에 딩동, 누르면 대기 페이지로"
Central left: large generic phone with a clearly readable floating notification card, verbatim:
"5분 뒤 콘서트 예매 시작!"
"눌러서 예매 대기 페이지로 바로가기"
A simple coral touch/click cue on that card, then a strong coral arrow pointing right.
Central right: generic browser-window illustration, visibly a destination page, titled "콘서트 예매 대기 페이지", with a simple ticket icon and restrained placeholder layout, no real vendor logo, purchase button, booking success, queue position or price. Small label above browser: "예약에 넣은 웹 주소".
Labels below: left "Push 알림 누르기", right "지정한 웹페이지 열기".
Bottom clear three-step strip: "예약에 URL 입력 → Push 알림 클릭 → 웹페이지 열기".
Small note: "URL이 없으면 서비스 화면으로 이동해요".
Small service URL: "dingdong-to-me.web.app".
Readable footer exactly: "화면·알림은 기능 설명용 연출입니다."
Do not show invented calendar dates, device time, OS branding, actual ticketing branding, QR codes, user credentials or source code. No guarantee of ticket purchase, queue skipping, exact-time delivery or physical iPhone receipt. This is an explanatory promotional illustration, not an actual OS notification or ticketing screenshot. All Korean must be accurately spelled and legible. Do not add other slogans or examples.
```

## 대표 배너 손글씨 주석 — 실제 사용 프롬프트

사용자가 첨부한 대표 배너에 좌측 하단 손그림 화살표와 반응을 추가한 최초 시안입니다. 이후 사용자 수정에 따라 공개 이미지의 최종 반응은 **와 이거 슬롭 느낌 지린다...**로 바꿨습니다. 내장 imagegen을 사용했으며 아래 프롬프트의 원본 크기는 편집 입력 크기입니다.

```text
Edit the attached existing Korean landscape marketing banner. Make ONLY one small annotation change in the lower-left area. Preserve the entire banner's dimensions (1672x941), layout, phone/app display, title, coral headline, service address, foreground notification, existing text, gray handwritten slogan, underline, props, colors and footer. Do not redesign, reflow, crop, recolor or rewrite anything else.
The existing pale gray handwritten slogan at the lower left reads "작은 알림이 더 나은 하루를 만들어요." Keep it intact as the target.
To the RIGHT of this slogan, in the empty space below the notification card and left of the phone, add exactly this Korean reaction in a natural, casual handwritten dark-charcoal pen/marker style:
"와 이 문구"
"슬롭냄새 지린다..."
The line break is for fit; preserve all characters and the three dots. It should look scribbled by a person reacting to the slogan: slightly irregular baseline and varied strokes, clear and readable, not a computer/typeset font. Keep it smaller than the feature subheading but legible, approximately 35-42px handwriting at the original image size.
Draw one thin, loosely curved HAND-DRAWN dark-charcoal arrow from beside the reaction pointing BACK LEFT to the original pale gray slogan. The arrowhead must clearly target the original "작은 알림이 더 나은 하루를 만들어요." wording, not the service address or phone. Fit the new arrow and reaction into the existing whitespace; avoid overlaps with the original slogan, URL pill, notification card, phone and footer. No speech bubble, no new icon, no other words. Everything outside this local annotation must remain as close to the source as possible.
```

## 손글씨 주석 — 최종 문구 수정 프롬프트

최초 시안의 화살표와 손글씨 배치는 유지하고 아래 최종 문구를 적용했습니다. 최초 시안 이미지는 공개하지 않았습니다.

```text
Edit the attached banner with ONLY a wording change to the dark handwritten annotation near the lower left. Preserve the image dimensions (1672x941) and every other element: all banner content, phone display, title, headline, service address, notification card, pale gray original slogan, underline, and the curved hand-drawn arrow. Keep the annotation in the same position, size, dark charcoal color, natural casual handwriting, slight tilt and two-line layout.
Replace the annotation's current first line "와 이 문구" and second line "슬롭냄새 지린다..." with EXACTLY:
"와 이거"
"슬롭 느낌 지린다..."
Keep a visible space between "슬롭" and "느낌", and exactly three dots at the end. The whole phrase is "와 이거 슬롭 느낌 지린다...". Do not use "문구" or "냄새" anywhere in the annotation. Handwritten pen/marker style, not a typed font. Keep the original gray slogan "작은 알림이 더 나은 하루를 만들어요." unchanged and keep the existing curved arrow pointing at it. Do not redraw, reflow, crop, recolor or change any other part of the banner.
```

## 손글씨·화살표 크기/농도 조정 — 최종 프롬프트

사용자 요청에 따라 위 문구를 유지한 채 연한 회색, 작은 손글씨, 더 짧고 가는 화살표로 조정했습니다. 공개 대표 이미지에는 이 마지막 결과를 사용합니다.

```text
Edit the attached banner ONLY within the lower-left handwritten reaction and its curved arrow. Keep the entire rest of the image exactly as it is, including dimensions 1672x941, phone/app display, all headlines, URL, notification card, original pale gray slogan and coral underline, background and footer.
The current annotation already has the correct text. Preserve it VERBATIM, two lines:
"와 이거"
"슬롭 느낌 지린다..."
Make both the annotation and its hand-drawn arrow softer and smaller:
- Change their dark charcoal ink to a faded LIGHT GRAY around #A6A8AB, close to the tone of the original gray slogan. It should feel like a quiet pencil note, still legible.
- Reduce the handwritten text size to approximately 75% of its current size, preserving its natural irregular handwritten strokes and slight tilt.
- Reduce the arrow stroke weight and arrowhead size to about 75% of current.
- Shorten the curved arrow to around 60% of its current length, with a gentle shallow curve.
- Move the smaller annotation slightly left if needed, so it sits just beside the original slogan and the shorter arrow fits in the gap. The arrowhead still clearly points LEFT at "작은 알림이 더 나은 하루를 만들어요.", with no overlaps.
Do not change the original slogan or its underline. Do not change the final reaction wording, spacing between "슬롭" and "느낌", or the three dots. No dark bold lettering, no bubble, no extra text. Everything outside this small annotation region remains unchanged.
```
