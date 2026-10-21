# Token Scale Is All You Need · 0.3.1 prerelease

Windows beta / macOS 14+ preview. This is a release candidate for review, not approval of the official hosted service launch.

## Install

Download the complete installer archive for your CPU, extract the whole folder, then open `Install.vbs` on Windows or `Install Token Scale.app` on Mac. Codex must already be installed and signed in. Finish Google connection in the browser. The collector then runs from the tray/menu bar without a terminal or measurement window. Public ranking remains opt-in.

- Windows x64: `Token-Scale-Install-Windows-x64-0.3.1.zip`
- Apple Silicon, macOS 14+: `Token-Scale-macos-arm64-0.3.1.tar.gz`
- Intel, macOS 14+: `Token-Scale-macos-x64-0.3.1.tar.gz`

The public Mac installers are native binaries built and executed on matching GitHub-hosted Mac runners. They do not download a Dart SDK. Formal Authenticode/Developer ID certification and notarization are not provided; OS execution approval may be required. No OS security setting is disabled. This is not proof of Gatekeeper approval on a user's device.

## Fixed and verified

- LF manifests and Mac scripts on Windows builds; compatibility with historical CRLF checksum lists.
- Required payload, SHA-256, duplicate, path and symlink checks before installation.
- Mac GUI installation log at `~/Library/Logs/Token Scale/install.log`.
- Native updater executable permissions and CPU verification; macOS minimum 14 aligned with Mach-O binary requirements.
- Windows removal releases its own working directory and retries a briefly locked empty owned directory.
- Stable web connection endpoint replaces the expired development preview.

[Native Mac CI](https://github.com/hssum9409/daily_odd_builds-public/actions/runs/39577792743): both architectures passed analysis, 14 CLI tests, 3 mocked JXA tests, 2 packaging tests, native compile/ad-hoc signature verification/CPU checks/version execution, and 16 package cases using the real macOS shasum. Windows real installation/tray/startup-setting preservation/uninstall tests were performed locally. Backend validation includes 26 model/contract tests and 12 isolated Firebase emulator rule/integration tests with synthetic users. Emulator Google tokens are not a real Google login test.

## Remaining launch conditions

- Physical Mac Finder install, menu-bar actions, Keychain, login/reboot startup and Gatekeeper approval remain unverified. CI execution does not replace these checks.
- The combined local App Server collector and hosted ranking needs OpenAI policy clarification. [Official App Server authentication documentation](https://learn.chatgpt.com/docs/app-server#authentication). There is no claim of OpenAI approval or cryptographic attestation of the statistics.
- Repeat Google pairing and private synchronization through the final website on target devices; prior development sessions are separate evidence.
- Finalize operator terms/privacy policy and operational contact/retention decisions before the formal launch. The website provides current data-use facts, not a legal compliance certification.

This release is marked prerelease and is deliberately excluded by the automatic updater. Promotion to a stable day004-cli release requires resolving the launch conditions. Host/installer changes require full-package reinstallation; a collector-only update does not replace those fixed files. SHA256SUMS covers all six installer/updater assets; checksums are not publisher certificates.

Collector/core source is an allowlisted MIT snapshot. Private development history, backend abuse thresholds, authentication secrets, logs and user data were not transferred. Other Days' source and release tags were not changed.
