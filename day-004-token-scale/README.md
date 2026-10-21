# Token Scale Is All You Need · 0.3.1

한국어: 마 니 토큰 좀 쓰나? · 日本語: トークン、それだけ？ｗ · 简体中文: 不是哥们，就烧这么点 Token？ · English: You Call That Token Burn?

[Live service](https://token-arena-hssum9409.web.app/) · [Windows / macOS downloads](https://token-arena-hssum9409.web.app/download/) · [Stable release](https://github.com/hssum9409/daily_odd_builds-public/releases/tag/day004-cli-v0.3.1) · [Privacy / terms / authentication](https://token-arena-hssum9409.web.app/about/)

The service and 0.3.1 stable collector are released on 21 October 2026 by the operator. Statistics are community-reported, provisional, and not a measure of productivity or skill. Public ranking is opt-in; installation does not change an existing private setting.

OpenAI authentication stays in the user's local Codex. The collector reads documented local App Server methods and submits minimal statistics using separate Google/Firebase authentication. Our backend neither stores OpenAI credentials nor calls OpenAI APIs or runs model inference. We found no explicit ruling prohibiting this statistics-only submission architecture; hosting the ranking alone is not treated as a confirmed violation. This is not a claim of OpenAI approval. [Policy review](docs/policy-and-privacy.md).

Extract the whole package. Windows x64: open `Install.vbs`. Mac (macOS 14+, Apple Silicon or Intel): open `Install Token Scale.app`. Approve per-user installation and finish the Google connection on the website. Codex must already be installed and signed in. The tray/menu-bar daemon then runs without a measurement window or terminal.

0.3.1 fixes CRLF checksum lists, Mac script line endings, native executable permissions and macOS minimum-version metadata. Installation verifies required payload hashes, duplicate/path/symlink safety. Mac diagnostics: `~/Library/Logs/Token Scale/install.log`; verify without installation: `bash install.command --verify-package`.

Windows real-PC installation/tray/local Codex reading/removal checks passed. Native Intel and Apple Silicon binaries built and executed on matching macOS CI runners. Physical Mac Finder/Keychain/menu/login-startup/Gatekeeper validation and Windows reboot remain unverified; stable publication does not change this evidence boundary. [Verification](docs/verification-0.3.1.md).

Formal Authenticode/Developer ID certification and notarization are not included. OS execution approval may be required; no OS protection is disabled. Native Mac packages need no separate Dart SDK. Local Firebase credentials use DPAPI/Keychain. Logout clears local login; uninstall preserves local login/cache. Delete server data and the service account through My profile.

The updater accepts stable `day004-cli-vX.Y.Z` releases from this repository. 0.3.1 is eligible for older supported collectors; fixed host/runtime/installer changes require reinstalling the full package. Checksums are integrity checks, not publisher certificates. Original native binaries and their source tag are unchanged; stable installer README/manifests and current documentation were updated separately.

`source/` is an allowlisted MIT collector/core snapshot, without private history, backend abuse thresholds, credentials, logs or user data. Flutter 3.47.6 / Dart 3.13.5 is the build toolchain. In `source/`: `flutter pub get`, `dart test cli_collector/test`, then `python tools/build_cli.py --platform windows --defines cli_collector/public-config.json` on Windows or `python3 tools/build_cli.py --platform macos --arch arm64 --defines cli_collector/public-config.json` on the matching Mac (`x64` for Intel).

Operator/support: [hssum9409 / issue tracker](https://github.com/hssum9409/daily_odd_builds-public/issues). Do not post credentials or private statistics in issues.
