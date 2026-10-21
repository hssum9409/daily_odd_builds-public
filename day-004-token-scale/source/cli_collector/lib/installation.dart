import 'dart:io';

import 'package:crypto/crypto.dart';

import 'runtime.dart';

Future<void> installWindows(List<String> args) async {
  if (!Platform.isWindows) throw const FormatException('use-macos-installer');
  if (!args.contains('--consent')) {
    throw const FormatException('installation-consent-required');
  }
  final root = Directory(
    option(args, '--install-root') ??
        '${Platform.environment['LOCALAPPDATA']}/Programs/Token Scale',
  ).absolute;
  if (root.path == root.parent.path || root.path.contains('"')) {
    throw const FormatException('invalid-installation');
  }
  final source = Directory(
    option(args, '--payload-root') ??
        File(Platform.resolvedExecutable).parent.path,
  ).absolute;
  final snapshot = await File('${source.path}/token-scale.aot').exists();
  final marker = File('${root.path}/product-id');
  final key = option(args, '--product-key') ?? productId;
  if (!RegExp(r'^DailyOddBuilds\.TokenScale(?:\.[A-Za-z0-9_-]+)?$')
      .hasMatch(key)) {
    throw const FormatException('invalid-installation');
  }
  final files = [
    snapshot ? 'token-scale.aot' : 'token-scale.exe',
    if (snapshot) ...['dartaotruntime.exe', 'token-scale.cmd'],
    'start.cmd',
    'host.ps1',
    'manage.ps1',
    'launch.ps1',
    'launch.vbs',
    'setup.ps1',
    'tray.ps1',
    'desktop-strings.json',
    'LICENSE',
    'THIRD_PARTY_LICENSES.txt',
    'README.txt',
  ];
  final sums = await File('${source.path}/SHA256SUMS.txt').readAsLines();
  // Installer copies only these product files; never traverses another Day or
  // reads credentials from the package. A modified payload fails before writes.
  for (final name in files) {
    final file = File('${source.path}/$name');
    final hash = sha256.convert(await file.readAsBytes()).toString();
    if (sums.where((line) => line == '$hash  $name').length != 1) {
      throw const FormatException('installer-checksum');
    }
  }
  if (await root.exists()) {
    if (!await marker.exists() && !await root.list().isEmpty) {
      throw const FormatException('installation-directory-not-empty');
    }
    if (await marker.exists() &&
        (await marker.readAsString()).trim() != productId) {
      throw const FormatException('invalid-installation');
    }
    if (await marker.exists()) {
      final result = await Process.run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        '${root.path}/manage.ps1',
        '-Action',
        'stop',
        '-Root',
        root.path,
      ]);
      if (result.exitCode != 0) {
        throw const FormatException('installation-stop-failed');
      }
    }
  }
  await Directory('${root.path}/versions/$collectorVersion')
      .create(recursive: true);
  if (snapshot) await Directory('${root.path}/runtime').create(recursive: true);
  for (final name in files) {
    final destination = name == 'token-scale.exe' || name == 'token-scale.aot'
        ? '${root.path}/versions/$collectorVersion/$name'
        : name == 'dartaotruntime.exe'
        ? '${root.path}/runtime/$name'
        : '${root.path}/$name';
    await File('${source.path}/$name').copy(destination);
  }
  await atomicText(
    File('${root.path}/runtime-mode'),
    snapshot ? 'aot' : 'native',
  );
  final home = option(args, '--home');
  for (final action in ['initialize', 'register', 'startup-enable', 'start']) {
    if (action == 'startup-enable') {
      final preferences = await readJson(
        File(
          '${home ?? '${Platform.environment['LOCALAPPDATA']}/TokenScaleCLI'}/preferences.json',
        ),
      );
      if (preferences['startupEnabled'] == false) continue;
    }
    final result = await Process.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      '${root.path}/manage.ps1',
      '-Action',
      action,
      '-Root',
      root.path,
      '-Version',
      collectorVersion,
      '-ProductKey',
      key,
      if (home != null) ...['-DataHome', home],
    ]);
    if (result.exitCode != 0) {
      throw FormatException('installation-$action-failed');
    }
  }
  stdout.writeln(
    'Installed a tray daemon for this user. First install enables background sync and GitHub updates; existing settings are preserved. Finish connection in the browser if prompted.\nPublication is controlled on the website. Uninstall is available in Windows Settings > Apps.',
  );
}

Future<void> uninstallWindows(Directory root) async {
  final result = await Process.run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    '${root.path}/manage.ps1',
    '-Action',
    'uninstall',
    '-Root',
    root.path,
    '-WaitPid',
    '$pid',
  ]);
  if (result.exitCode != 0) {
    throw const FormatException('uninstall-start-failed');
  }
}
