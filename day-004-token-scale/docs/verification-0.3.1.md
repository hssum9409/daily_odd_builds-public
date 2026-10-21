# 0.3.1 post-publication verification · 2026-10-21

Release assets were published at 2026-10-21T09:37:58Z. All seven GitHub asset sizes/digests matched the reviewed originals. The three complete installers were downloaded anonymously and their actual bytes matched the website SHA-256 manifest.

- Published Windows ZIP: real per-user QA installation, native tray menu events, singleton IPC, WScript/CMD launch, no visible owned windows, parent exit survival, startup preference preservation on reinstall, graceful stop and scoped removal passed. Native menu events were programmatic PerformClick, not OS mouse input. Launcher returned in 642 ms; OS reboot/login was not performed.
- The same published Windows collector used an existing DPAPI login to read real Codex statistics and submit them to real Firebase. The existing private setting and source binding were preserved; no public profile/ranking was exposed. This is separate from a new Google browser pairing test.
- [Final Mac CI](https://github.com/hssum9409/daily_odd_builds-public/actions/runs/39577792743) passed on Intel and Apple Silicon. Native compile, CPU, macOS 14 minimum, ad-hoc code-signature verification, direct version execution and 16 package checks with macOS shasum passed per architecture. Physical Finder, Keychain, menu-bar, login-startup and Gatekeeper remain pending.
- CLI 14, mocked JXA 3, packaging 2, backend model/contract 26, and synthetic Firebase emulator rule/integration 12 tests passed. Production Firestore and RTDB Rules matched the tested sources. Local emulators used Node 24; production Functions uses Node 22.
- Deployed HTTPS website: four languages, language selection, desktop 1440/mobile 390 layouts, dashboard-to-download navigation and all three links passed in installed Google Chrome controlled by Playwright. No page or console errors. Screenshots were inspected. This is not physical-mobile or Safari/Firefox QA.
- Connection endpoint returned 200 with a stable non-expiring development URL; missing authentication returned 401; allowed CORS preflight 204 and a foreign origin 403. Google provider/domain settings and the enabled UTC six-hour ranking scheduler were checked.

No production synthetic users, destructive real-account deletion, paid certificates, global OS-policy changes or private-history transfer were used. Native Mac packages require macOS 14+ and no separate Dart SDK.

## Stable release and public launch · 21 October 2026

The operator authorized stable publication and the service launch. The prior policy-blocking wording was corrected: local Codex authentication and Google/Firebase statistics ingestion are separate; the documentation does not explicitly resolve this statistics-only architecture. There is no claim of OpenAI approval. Four-language privacy/terms/authentication information is linked from the website.

Stable installers change only README text and checksum manifests. All executable/script bytes and Mac file modes match the previously verified packages. A fresh Windows installation from the stable ZIP passed the same tray/hidden-window/Codex/settings/removal checks; launcher return was 1219 ms, visible owned windows zero. CLI14, mocked JXA3, packaging2, server26 and Flutter analyze passed again; the shared 343-rule achievement catalog matched. Website release build and deployed browser/download checks are recorded below after final verification.

Physical Mac, actual OS reboot, fresh final-site Google pairing, and real mobile/Safari/Firefox remain unverified. Stable channel promotion does not certify those behaviors. The source tag/native collector binaries are unchanged; current documentation and stable installer READMEs were updated without rewriting published Git tags.
