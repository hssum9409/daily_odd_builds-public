# Day 004 · Token Scale Is All You Need · 0.3.1

한국어: 마 니 토큰 좀 쓰나? · 日本語: トークン、それだけ？ｗ · 简体中文: 不是哥们，就烧这么点 Token？ · English: You Call That Token Burn?

[Download](https://token-arena-hssum9409.web.app/download/) · [Release candidate](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day004-cli-v0.3.1)

This is a prerelease collector, not an announcement of the official service launch. Windows was tested on one real PC; macOS remains a preview pending physical-device installation, Keychain, menu-bar, login-startup and Gatekeeper checks. OpenAI authentication-policy clarification remains required for the combined hosted leaderboard. Statistics are community-reported and are not a measure of productivity or skill.

Extract the whole package. Windows: open `Install.vbs`. Mac (macOS 14+): open `Install Token Scale.app`. Approve per-user installation, finish Google connection on the website, and manage the background daemon from the tray/menu bar. Codex must already be installed and signed in. No OpenAI token or password is entered into this service.

0.3.1 fixes Windows-generated CRLF checksum lists and Mac source line endings. Verification accepts old CRLF lists while rejecting damaged, missing, duplicate, unsafe or linked payloads. GUI Mac installer diagnostics: `~/Library/Logs/Token Scale/install.log`. Check without installation: `bash install.command --verify-package`.

Public ranking remains opt-in. Google/Firebase identifies the Token Scale user, independently of the local ChatGPT account. Prompts, conversations, code, project paths and OpenAI credentials are not submitted. Local service credentials use Windows DPAPI or Mac Keychain. Uninstall retains local login/cache; use `logout` to clear local login and My profile to delete server account/statistics.

No formal Authenticode/Developer ID certificate or notarization is included. OS execution approval may be necessary; no security policy or quarantine setting is disabled. The Mac bootstrap development packages, if offered, fetch a pinned official Dart runtime; native packages do not require that runtime download.

`source/` is an allowlisted MIT collector/core snapshot with no private development Git history, backend abuse thresholds, credentials, logs or user data. Flutter 3.47.6 / Dart 3.13.5 is the build toolchain. In `source/`: `flutter pub get`, `dart test cli_collector/test`, then `python tools/build_cli.py --platform windows --defines cli_collector/public-config.json` on Windows or `python3 tools/build_cli.py --platform macos --arch arm64 --defines cli_collector/public-config.json` on the matching Mac (`x64` for Intel). Never label bootstrap kernels as native updater assets.

The updater only accepts non-prerelease `day004-cli-vX.Y.Z` releases from this repository. This candidate is a prerelease and is intentionally not auto-installed. Host/installer changes require reinstalling the full package; the updater replaces only versioned collector code.

Operator/support: [hssum9409 / issue tracker](https://github.com/hssum9409/daily_odd_builds-public/issues). Do not post tokens, credentials or private statistics in issues.
