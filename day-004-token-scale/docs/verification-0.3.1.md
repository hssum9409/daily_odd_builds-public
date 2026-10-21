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

Stable installers change only README text and checksum manifests. All executable/script bytes and Mac file modes match the previously verified packages. A fresh Windows installation from the stable ZIP passed the same tray/hidden-window/Codex/settings/removal checks; launcher return was 1219 ms, visible owned windows zero. CLI14, mocked JXA3, packaging2, server26 and Flutter analyze passed again; the shared 343-rule achievement catalog matched. Website release build passed. Deployed browser/download verification is recorded below.

Physical Mac, actual OS reboot, fresh final-site Google pairing, and real mobile/Safari/Firefox remain unverified. Stable channel promotion does not certify those behaviors. The source tag/native collector binaries are unchanged; current documentation and stable installer READMEs were updated without rewriting published Git tags.

### Final stable-site verification

- GitHub release is non-draft/non-prerelease. All seven uploaded asset sizes/digests match; repository-wide Latest was preserved.
- Actual HTTPS service in installed Chrome via Playwright (Browser plugin unavailable): desktop1440/mobile390, four locales plus English fallback, all four ranking tabs, dashboard→policies/download, privacy/terms/authentication text, and three anonymous installer downloads with matching SHA-256 passed. Zero page/console errors, no blank/error overlay or mobile horizontal overflow; screenshots inspected.
- Actual public GitHub feed: Windows AOT and Mac arm64/x64 each select0.3.1 for0.3.0, download over HTTPS and match both asset digest and checksum manifest; same-version update skipped. This does not claim a new native OS replacement/restart/rollback test.
- API production channel/non-expiring stable URL, Google auth configuration, ACTIVE state and minimum0/maximum2 instances confirmed; anonymous401, allowed CORS204, foreign Origin403. Production Rules still match tested local rules. Scheduler remains enabled at UTC six-hour intervals with successful recent delivery.
- Existing profile/source binding and private visibility preserved. Personal rankings correctly retain the last scheduled cutoff until the next batch; source submissions are not immediate ranking publications.

The operator released the service without claiming OpenAI approval, certified statistics, paid code signatures or validation on every target device. Original source tags/private Git history and other Days remain untouched.


## New-user Windows onboarding and first-sync display · 21–22 October 2026

This resolves the earlier fresh final-site Google-pairing limitation. The published Windows ZIP was downloaded through real Chrome and its SHA-256 verified. The published native installer engine used its supported isolated install-root/home/product-key options to preserve the existing installation and login. A genuinely new Firebase user signed in with Google; the human completed Google authentication. A new nickname was saved with public visibility OFF.

On 21 October, connection completed at20:18:18 KST and real statistics reached production Firebase at20:18:22. No manual synchronization command was used for that first upload. Read-only server checks confirmed new account creation, a different UID from the existing user, Google provider, matching source binding, real summary/daily data, private visibility, and no public profile/ranking entry. No identifiers or actual token totals are published here.

Owned-process inspection sampled440 times during install/first sync and found zero visible main windows. Background PowerShell/conhost processes are distinct from visible terminals. Exact Install.vbs GUI confirmation, SmartScreen, a new Windows OS account, clean-browser local-network permission, and OS reboot were not exercised in this isolated-engine test.

The first upload revealed a web refresh omission: pairing succeeded while the page still said no usage. On22 October, the web was fixed to check only the owner's snapshot at most four times after connection, handle the initial-profile-read race, and allow forced personal refresh. Analyze/release build passed and Hosting was updated. Actual Chrome reconnection verified the reading indicator, completion, personal statistics and the real server timestamp without page reload. An additional12 owned-process samples found zero visible main windows. This reconnection regression check is separate from the original genuinely new-account first upload.

Test installations, startup registrations and local Firebase login were cleaned up; the existing installation/login were preserved. The new cloud account and its real statistics remain private and were not deleted. Original native release binaries are unchanged; this display correction is web-only.

Current collection: immediately after first connection and app startup, then local00/06/12/18 slots while running, plus manual requests; unchanged data is not uploaded. Ranking publication remains UTC00/06/12/18. Source-service aggregation delay is separate from collection cadence.
