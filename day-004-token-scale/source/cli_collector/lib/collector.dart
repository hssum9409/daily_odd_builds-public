import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'runtime.dart';
import 'keychain.dart';
import 'installation.dart';
import 'updater.dart';
import 'desktop.dart';

import 'package:http/http.dart' as http;
import 'package:token_arena_core/token_arena_core.dart';

String randomId(int length) => List.generate(
  length,
  (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
).join();

Future<Uri> connectionUrl(http.Client client) async {
  if (ArenaConfig.emulator) return Uri.parse(ArenaConfig.webUrl);
  final api = Uri.parse(ArenaConfig.effectiveApiUrl);
  if (api.scheme != 'https') throw const ArenaFailure('configuration');
  // Stable operator-controlled endpoint. Renewing the development web channel
  // no longer requires re-installing every collector.
  final response = await client
      .get(Uri.parse('${ArenaConfig.effectiveApiUrl}/v1/collector-config'))
      .timeout(const Duration(seconds: 20));
  if (response.statusCode != 200) {
    throw const ArenaFailure('connection-site-unavailable');
  }
  final body = jsonDecode(response.body) as Map<String, dynamic>;
  final web = Uri.parse(body['webUrl'] as String);
  final project = ArenaConfig.projectId;
  if (web.scheme != 'https' ||
      web.userInfo.isNotEmpty ||
      web.hasQuery ||
      web.hasFragment ||
      !(web.host == '$project.web.app' ||
          web.host == '$project.firebaseapp.com' ||
          web.host.startsWith('$project--') && web.host.endsWith('.web.app'))) {
    throw const ArenaFailure('configuration');
  }
  final expires = DateTime.tryParse(body['expiresAt'] as String? ?? '');
  if (expires != null && DateTime.now().toUtc().isAfter(expires)) {
    throw const ArenaFailure('connection-site-expired');
  }
  return web;
}

Future<void> daemon(
  SessionStore store,
  http.Client client,
  List<String> args,
) async {
  final root = installRoot(args), log = EventLog(store.directory);
  final desktop = DaemonStatus(store.directory);
  Future<void> report(String event) async {
    await log.event(event);
    await desktop.publish(event);
  }

  final lease = await WorkerLease.acquire(store.directory);
  if (lease == null) throw const ArenaFailure('collector-already-running');
  final stopped = Completer<void>();
  var due = DateTime.now(), lastPrompt = DateTime.fromMillisecondsSinceEpoch(0);
  var manualConnection = false, manualSync = false;
  var commandsWaiting = false;
  Completer<void>? sleeping;
  void requestStop({bool restart = false}) {
    if (stopped.isCompleted) return;
    if (restart) exitCode = 42;
    stopped.complete();
    if (sleeping != null && !sleeping.isCompleted) sleeping.complete();
    client.close();
  }

  final stop = File('${root.path}/stop');
  final signals = <StreamSubscription<ProcessSignal>>[];
  for (final signal in [
    ProcessSignal.sigint,
    if (!Platform.isWindows) ProcessSignal.sigterm,
  ]) {
    signals.add(
      signal.watch().listen((_) {
        requestStop();
      }),
    );
  }
  final ticker = Timer.periodic(const Duration(seconds: 1), (_) {
    if (desktopCommands.any(
      (name) => File('${root.path}/$name.request').existsSync(),
    )) {
      commandsWaiting = true;
      if (sleeping != null && !sleeping.isCompleted) sleeping.complete();
    }
    final restart = File('${root.path}/restart');
    if (restart.existsSync() && !stopped.isCompleted && !stop.existsSync()) {
      restart.deleteSync();
      requestStop(restart: true);
    }
    if (stop.existsSync()) requestStop();
  });
  try {
    final ready = option(args, '--ready-file'),
        token = option(args, '--ready-token');
    if (ready != null &&
        token != null &&
        RegExp(r'^[a-f0-9]{32}$').hasMatch(token)) {
      // Readiness means executable/runtime/storage/lease initialization, not
      // network availability. Offline startup must never trigger a rollback.
      await store.prepare();
      await atomicText(File(ready), '$collectorVersion\n$token');
    }
    await report('daemon-started');
    try {
      await cleanupManagedVersions(root);
    } catch (_) {
      await report('version-cleanup-failed');
    }
    final retry = RetryPolicy();
    var needsConnection = false;
    while (!stopped.isCompleted) {
      var preferences = await readJson(
        File('${store.directory.path}/preferences.json'),
      );
      final commands = await takeDesktopCommands(root);
      commandsWaiting = false;
      if (commands.contains('pause') || commands.contains('resume')) {
        preferences = {...preferences, 'autoSync': !commands.contains('pause')};
        await atomicText(
          File('${store.directory.path}/preferences.json'),
          jsonEncode(preferences),
        );
        if (preferences['autoSync'] == true) due = DateTime.now();
      }
      desktop.preferences = preferences;
      desktop.connected = await store.session.exists();
      desktop.lastSync = (await store.state())['lastSync'] as String?;
      if (commands.contains('pause')) await report('sync-paused');
      if (commands.contains('resume')) await report('daemon-started');
      if (commands.contains('connect')) {
        manualConnection = true;
        due = DateTime.now();
        lastPrompt = DateTime.fromMillisecondsSinceEpoch(0);
      }
      if (commands.contains('sync')) {
        manualSync = true;
        due = DateTime.now();
      }
      for (final action in ['startup-enable', 'startup-disable']) {
        if (commands.contains(action)) {
          try {
            await startup(root, action == 'startup-enable');
          } catch (_) {
            await report('startup-registration-failed');
          }
        }
      }
      if (commands.contains('web')) {
        try {
          await openExternal(await connectionUrl(client));
        } catch (_) {
          await report('connection-site-unavailable');
        }
      }
      if (preferences['autoUpdate'] != false || commands.contains('update')) {
        try {
          if (await Updater(
            root,
            store.directory,
            client,
          ).check(force: commands.contains('update'))) {
            exitCode = 42;
            return;
          }
        } catch (_) {
          await report('update-check-failed');
        }
      }
      final now = DateTime.now();
      if (!now.isBefore(due) &&
          (preferences['autoSync'] != false ||
              manualConnection ||
              manualSync)) {
        try {
          if (await store.read() == null ||
              needsConnection ||
              manualConnection ||
              preferences['uploadConsent'] != true) {
            if (now.difference(lastPrompt) >= const Duration(hours: 24)) {
              await report('web-connection-needed');
              final session = await login(
                client,
                cancelled: stopped.future,
                onOpened: () => lastPrompt = DateTime.now(),
              );
              await store.save(session);
              await atomicText(
                File('${store.directory.path}/preferences.json'),
                jsonEncode({
                  ...await readJson(
                    File('${store.directory.path}/preferences.json'),
                  ),
                  'uploadConsent': true,
                }),
              );
              needsConnection = false;
              desktop.connected = true;
              await report('web-connected');
            } else {
              due = now.add(const Duration(minutes: 5));
              continue;
            }
          }
          manualConnection = false;
          if (preferences['autoSync'] == false && !manualSync) {
            due = now.add(const Duration(minutes: 5));
            continue;
          }
          await report('sync-started');
          await sync(store, client, ['--consent']);
          manualSync = false;
          desktop.lastSync = (await store.state())['lastSync'] as String?;
          await report('sync-completed');
          retry.success();
          // Local six-hour slots, no catch-up requests for missed slots.
          final n = DateTime.now();
          due = DateTime(n.year, n.month, n.day, (n.hour ~/ 6 + 1) * 6);
        } catch (error) {
          final code = error is ArenaFailure
              ? error.code
              : error is CodexFailure
              ? error.code
              : 'collector-failed';
          if (code == 'arena-sign-in-required') needsConnection = true;
          // Source identity changes need an explicit terminal consent command;
          // never silently replace the account's source from a daemon.
          manualConnection = false;
          manualSync = false;
          await report(code);
          due = DateTime.now().add(retry.failed());
        }
      }
      await desktop.publish();
      if (!stopped.isCompleted && !commandsWaiting) {
        final wake = Completer<void>();
        sleeping = wake;
        final timer = Timer(const Duration(seconds: 30), () {
          if (!wake.isCompleted) wake.complete();
        });
        try {
          await wake.future;
        } finally {
          timer.cancel();
          sleeping = null;
        }
      }
    }
  } finally {
    ticker.cancel();
    for (final signal in signals) {
      await signal.cancel();
    }
    await lease.close();
    await report('daemon-stopped');
  }
}

Future<void> startup(Directory root, bool enable) async {
  final result = Platform.isWindows
      ? await Process.run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          '${root.path}/manage.ps1',
          '-Action',
          enable ? 'startup-enable' : 'startup-disable',
          '-Root',
          root.path,
        ])
      : await Process.run('/bin/bash', [
          '${root.path}/manage.sh',
          enable ? 'startup-enable' : 'startup-disable',
          root.path,
        ]);
  if (result.exitCode != 0) {
    throw const ArenaFailure('startup-registration-failed');
  }
  final dataPath = (await File(
    '${root.path}/data-home.txt',
  ).readAsString()).trim();
  final preferences = File('$dataPath/preferences.json');
  await atomicText(
    preferences,
    jsonEncode({...await readJson(preferences), 'startupEnabled': enable}),
  );
}

Future<void> runCollector(List<String> args) async {
  final command = args.isEmpty ? 'help' : args.first;
  final client = http.Client();
  try {
    final rootPath = option(args, '--install-root');
    final store = SessionStore(home: option(args, '--home'));
    switch (command) {
      case 'install':
        await installWindows(args);
      case 'uninstall':
        if (Platform.isWindows) {
          await uninstallWindows(installRoot(args));
          stdout.writeln(
            'Removal started. Local login and cache are retained.',
          );
        } else {
          throw const ArenaFailure('use-macos-uninstaller');
        }
      case 'version':
        stdout.writeln(collectorVersion);
      case 'inspect':
        final reader = CodexReader(executable: await codexPath()),
            usage = await reader.fetch();
        stdout.writeln(
          jsonEncode({
            'source': reader.version,
            'summary': usage.summary,
            'observedDates': usage.daily.length,
            'latestDate': usage.daily.isEmpty
                ? null
                : (usage.daily.keys.toList()..sort()).last,
            'verificationStatus': 'community_reported',
            'upload': false,
          }),
        );
      case 'login':
        await store.save(
          await login(client, openBrowser: !args.contains('--no-open')),
        );
        final f = File('${store.directory.path}/preferences.json');
        await atomicText(
          f,
          jsonEncode({...await readJson(f), 'uploadConsent': true}),
        );
        stdout.writeln(
          'Connected. Background statistics sync is enabled; publication remains a website setting.',
        );
      case 'logout':
        await store.logout();
        stdout.writeln('Local Firebase session removed.');
      case 'status':
        final state = await store.state(),
            preferences = await readJson(
              File('${store.directory.path}/preferences.json'),
            );
        stdout.writeln(
          jsonEncode({
            'version': collectorVersion,
            'connected': await store.read() != null,
            'lastSync': state['lastSync'],
            'autoSync': preferences['autoSync'] != false,
            'autoUpdate': preferences['autoUpdate'] != false,
            'uploadConsent': preferences['uploadConsent'] == true,
            if (rootPath != null)
              'installedVersion': await File(
                '${installRoot(args).path}/current.txt',
              ).readAsString(),
          }),
        );
      case 'sync':
        await sync(store, client, args);
      case 'daemon':
      case 'watch':
        await daemon(store, client, args);
      case 'stop':
        await stopInstallation(installRoot(args));
        stdout.writeln('Stopped.');
      case 'startup':
        if (args.length < 2 || !['enable', 'disable'].contains(args[1])) {
          throw const ArenaFailure('invalid-command');
        }
        await startup(installRoot(args), args[1] == 'enable');
        stdout.writeln('Startup ${args[1]}d.');
      case 'launchagent':
        if (!Platform.isMacOS) throw const ArenaFailure('unsupported-platform');
        final root = installRoot(args);
        final plist = File(
          '${Platform.environment['HOME']}/Library/LaunchAgents/org.dailyoddbuilds.token-scale.plist',
        );
        await atomicText(plist, launchAgentXml(root.path));
      case 'update':
        final changed = await Updater(
          installRoot(args),
          store.directory,
          client,
        ).check(force: true);
        if (changed) {
          await atomicText(
            File('${installRoot(args).path}/restart'),
            'restart',
          );
        }
        stdout.writeln(
          changed
              ? 'Update staged. Restart the background collector.'
              : 'No update available.',
        );
      case 'settings':
        final file = File('${store.directory.path}/preferences.json'),
            preferences = await readJson(file);
        for (final key in ['autoSync', 'autoUpdate']) {
          final value = option(
            args,
            key == 'autoSync' ? '--auto-sync' : '--auto-update',
          );
          if (value != null) {
            if (!['on', 'off'].contains(value)) {
              throw const ArenaFailure('invalid-command');
            }
            preferences[key] = value == 'on';
          }
        }
        await atomicText(file, jsonEncode(preferences));
        stdout.writeln('Settings saved.');
      default:
        stdout.writeln(
          'token-scale install --consent | uninstall | version | inspect | login [--no-open] | sync --consent [--reset-source] | status | logout | settings --auto-sync on|off --auto-update on|off | daemon | stop | startup enable|disable | update\nInstalled lifecycle commands accept --install-root PATH and --home PATH. On macOS use install.command and manage.sh uninstall.',
        );
    }
  } catch (error) {
    stderr.writeln(
      error is ArenaFailure || error is CodexFailure
          ? error.toString()
          : error is FormatException
          ? error.message
          : 'collector-failed',
    );
    exitCode = 1;
  } finally {
    client.close();
  }
}

class SessionStore {
  SessionStore({String? home})
    : directory = Directory(
        home ??
            Platform.environment['TOKEN_SCALE_HOME'] ??
            (Platform.isWindows
                ? '${Platform.environment['LOCALAPPDATA']}/TokenScaleCLI'
                : '${Platform.environment['HOME']}/.config/token-scale'),
      );
  final Directory directory;
  File get session => File('${directory.path}/session');
  File get metadata => File('${directory.path}/state.json');
  Future<void> prepare() async {
    await directory.create(recursive: true);
    if (!Platform.isWindows) {
      final result = await Process.run('chmod', ['700', directory.path]);
      if (result.exitCode != 0) throw const ArenaFailure('credential-storage');
    }
  }

  Future<String> protect(String value, bool decrypt) async {
    if (!Platform.isWindows) return value;
    final script = decrypt
        ? r'Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadLine(); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
        : r'Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadLine(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
    final child = await Process.start('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    final out = utf8.decoder.bind(child.stdout).join();
    unawaited(child.stderr.drain<void>());
    child.stdin.writeln(value);
    await child.stdin.close();
    final encrypted = await out.timeout(
      const Duration(seconds: 20),
      onTimeout: () {
        child.kill();
        throw const ArenaFailure('credential-storage');
      },
    );
    if (await child.exitCode != 0) {
      throw const ArenaFailure('credential-storage');
    }
    return encrypted.trim();
  }

  Future<void> save(FirebaseSession value) async {
    await prepare();
    if (Platform.isMacOS) {
      await keychain('set', jsonEncode(value.toJson()));
      await atomicText(session, 'keychain-v1');
    } else {
      await atomicText(
        session,
        await protect(jsonEncode(value.toJson()), false),
      );
    }
    if (!Platform.isWindows) {
      if ((await Process.run('chmod', ['600', session.path])).exitCode != 0) {
        throw const ArenaFailure('credential-storage');
      }
    }
  }

  Future<FirebaseSession?> read() async => await session.exists()
      ? FirebaseSession.fromJson(
          jsonDecode(
            Platform.isMacOS
                ? await keychain('get')
                : await protect(await session.readAsString(), true),
          ),
        )
      : null;
  Future<Map<String, dynamic>> state() async =>
      await metadata.exists() ? jsonDecode(await metadata.readAsString()) : {};
  Future<void> saveState(Map<String, dynamic> value) async {
    await prepare();
    await atomicText(metadata, jsonEncode(value));
  }

  Future<String> keychain(String command, [String? input]) async {
    return MacKeychain().command(command, directory.absolute.path, input);
  }

  Future<void> logout() async {
    if (Platform.isMacOS && await session.exists()) await keychain('delete');
    if (await session.exists()) await session.delete();
  }
}

Future<String> codexPath() async {
  final configured = Platform.environment['CODEX_EXECUTABLE'];
  if (configured != null && File(configured).existsSync()) return configured;
  if (!Platform.isWindows) {
    final bundles = <String>[];
    if (Platform.isMacOS) {
      try {
        final probe = await Process.run('/usr/bin/osascript', [
          '-l',
          'JavaScript',
          '-e',
          "ObjC.import('AppKit'); JSON.stringify(ObjC.unwrap(\$.NSWorkspace.sharedWorkspace.runningApplications).filter(function(a){var id=ObjC.unwrap(a.bundleIdentifier)||'';return id.indexOf('openai')>=0;}).map(function(a){return ObjC.unwrap(a.bundleURL.path);}))",
        ]).timeout(const Duration(seconds: 5));
        if (probe.exitCode == 0) {
          bundles.addAll(
            (jsonDecode(probe.stdout.toString()) as List).whereType<String>(),
          );
        }
      } catch (_) {
        /* Fixed bundle/PATH candidates still work without JXA discovery. */
      }
    }
    for (final candidate in unixCodexCandidates(
      Platform.environment,
      bundles: bundles,
    )) {
      if (File(candidate).existsSync()) return candidate;
    }
    throw const CodexFailure('codex-not-found');
  }
  final found = await Process.run('where.exe', ['codex.exe']);
  if (found.exitCode == 0) {
    for (final p in const LineSplitter().convert(found.stdout.toString())) {
      if (File(p).existsSync()) return p;
    }
  }
  final local = Platform.environment['LOCALAPPDATA'];
  final roaming = Platform.environment['APPDATA'];
  if (roaming != null) {
    for (final package in ['codex', 'codex-win32-x64', 'codex-win32-arm64']) {
      final installed = Directory('$roaming/npm/node_modules/@openai/$package');
      if (installed.existsSync()) {
        final native = installed
            .listSync(recursive: true, followLinks: false)
            .whereType<File>()
            .where((f) => f.uri.pathSegments.last == 'codex.exe');
        if (native.isNotEmpty) return native.first.path;
      }
    }
  }
  final root = Directory('$local/OpenAI/Codex/bin');
  if (root.existsSync()) {
    final files =
        root
            .listSync()
            .whereType<Directory>()
            .map((d) => File('${d.path}/codex.exe'))
            .where((f) => f.existsSync())
            .toList()
          ..sort(
            (a, b) => b.lastModifiedSync().compareTo(a.lastModifiedSync()),
          );
    if (files.isNotEmpty) return files.first.path;
  }
  throw const CodexFailure('codex-not-found');
}

Future<void> openExternal(Uri uri) async {
  final result = await Process.run(
    Platform.isWindows
        ? 'rundll32.exe'
        : Platform.isMacOS
        ? '/usr/bin/open'
        : 'xdg-open',
    Platform.isWindows
        ? ['url.dll,FileProtocolHandler', uri.toString()]
        : [uri.toString()],
  );
  if (result.exitCode != 0) throw const ArenaFailure('browser-open-failed');
}

Future<FirebaseSession> login(
  http.Client client, {
  bool openBrowser = true,
  Future<void>? cancelled,
  void Function()? onOpened,
}) async {
  if (ArenaConfig.apiKey.isEmpty) throw const ArenaFailure('configuration');
  final web = await connectionUrl(client);
  if (web.scheme != 'https' &&
      !(ArenaConfig.emulator &&
          web.scheme == 'http' &&
          ['localhost', '127.0.0.1'].contains(web.host))) {
    throw const ArenaFailure('configuration');
  }
  final state = base64UrlEncode(
    List.generate(32, (_) => Random.secure().nextInt(256)),
  ).replaceAll('=', '');
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final result = Completer<FirebaseSession>();
  var busy = false;
  final listener = server.listen((req) async {
    if (req.uri.path != '/connect' ||
        req.headers.value('origin') != web.origin) {
      req.response.statusCode = 403;
      await req.response.close();
      return;
    }
    req.response.headers.set('Access-Control-Allow-Origin', web.origin);
    req.response.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
    req.response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    req.response.headers.set('Access-Control-Allow-Private-Network', 'true');
    req.response.headers.set('Cache-Control', 'no-store');
    if (req.method == 'OPTIONS') {
      req.response.statusCode = 204;
      await req.response.close();
      return;
    }
    if (req.method != 'POST' || busy || result.isCompleted) {
      req.response.statusCode = 405;
      await req.response.close();
      return;
    }
    try {
      final bytes = <int>[];
      await for (final chunk in req) {
        if (bytes.length + chunk.length > 32768) {
          throw const ArenaFailure('invalid-connection');
        }
        bytes.addAll(chunk);
      }
      final body = jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
      final received = body.remove('state');
      if (received is! String || received.length != state.length) {
        throw const ArenaFailure('invalid-connection');
      }
      var delta = 0;
      for (var i = 0; i < state.length; i++) {
        delta |= state.codeUnitAt(i) ^ received.codeUnitAt(i);
      }
      if (delta != 0) throw const ArenaFailure('invalid-connection');
      busy = true;
      final session = await FirebaseSession.verify(body, client);
      req.response.write('{"connected":true}');
      await req.response.close();
      result.complete(session);
    } catch (_) {
      busy = false;
      req.response.statusCode = 400;
      await req.response.close();
    }
  });
  final uri = web.replace(
    queryParameters: {
      'connectPort': '${server.port}',
      'connectState': state,
      'collector': 'cli',
    },
  );
  stdout.writeln(
    'Approve this collector in the browser. The connection expires in five minutes.',
  );
  try {
    try {
      if (!openBrowser) {
        stdout.writeln(uri);
      } else {
        await openExternal(uri);
      }
    } catch (_) {
      stdout.writeln(uri);
    }
    onOpened?.call();
    return await Future.any([
      result.future,
      if (cancelled != null)
        cancelled.then<FirebaseSession>(
          (_) => throw const ArenaFailure('connection-cancelled'),
        ),
    ]).timeout(const Duration(minutes: 5));
  } finally {
    await listener.cancel();
    await server.close(force: true);
  }
}

Future<void> sync(
  SessionStore store,
  http.Client client,
  List<String> args,
) async {
  if (!args.contains('--consent')) {
    throw const ArenaFailure('upload-consent-required');
  }
  final session = await store.read();
  if (session == null) throw const ArenaFailure('arena-sign-in-required');
  final reader = CodexReader(executable: await codexPath());
  final usage = await reader.fetch(); // No input JSON/file upload path exists.
  final state = await store.state();
  final switched =
      state['accountKey'] != null && state['accountKey'] != usage.accountKey;
  if (switched && !args.contains('--reset-source')) {
    throw const ArenaFailure('source-change-needs-consent');
  }
  if (!switched &&
      state['fingerprint'] == usage.fingerprint &&
      state['uid'] == session.uid) {
    stdout.writeln('Unchanged. No server request.');
    return;
  }
  final sourceId = switched || state['sourceId'] == null
      ? randomId(16)
      : state['sourceId'] as String;
  final repo = ArenaRepository(
    uid: session.uid,
    client: client,
    tokenProvider: () async {
      final token = await session.token(client);
      await store.save(session);
      return token;
    },
  );
  final changed = await repo.upload(
    usage,
    sourceId: sourceId,
    proof: reader.proof,
    resetSource: args.contains('--reset-source'),
  );
  await store.saveState({
    ...state,
    'uid': session.uid,
    'sourceId': sourceId,
    'accountKey': usage.accountKey,
    'fingerprint': usage.fingerprint,
    'lastSync': DateTime.now().toUtc().toIso8601String(),
  });
  stdout.writeln(
    changed
        ? 'Statistics submitted. Rankings update in the server batch.'
        : 'Server statistics unchanged.',
  );
}
