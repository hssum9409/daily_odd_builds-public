import 'dart:convert';
import 'dart:io';

import 'runtime.dart';

const desktopCommands = [
  'connect',
  'sync',
  'pause',
  'resume',
  'update',
  'web',
  'startup-enable',
  'startup-disable',
];

Future<Set<String>> takeDesktopCommands(Directory root) async {
  final commands = <String>{};
  for (final name in desktopCommands) {
    final file = File('${root.path}/$name.request');
    if (await FileSystemEntity.type(file.path, followLinks: false) ==
        FileSystemEntityType.file) {
      await file.delete();
      commands.add(name);
    }
  }
  return commands;
}

// Public UI status contains no account identifiers, statistics or credentials.
class DaemonStatus {
  DaemonStatus(this.home);
  final Directory home;
  String phase = 'starting';
  String lastEvent = 'daemon-started';
  String? lastSync;
  bool connected = false;
  Map<String, dynamic> preferences = const {};

  Future<void> publish([String? event]) async {
    if (event != null) {
      lastEvent = RegExp(r'^[a-z0-9-]{1,80}$').hasMatch(event)
          ? event
          : 'collector-failed';
      phase = switch (lastEvent) {
        'daemon-started' || 'web-connected' || 'sync-completed' => 'running',
        'sync-started' => 'syncing',
        'sync-paused' => 'paused',
        'web-connection-needed' ||
        'arena-sign-in-required' => 'connection-needed',
        'daemon-stopped' => 'stopped',
        _ => 'error',
      };
    }
    if (preferences['autoSync'] == false && phase == 'running') {
      phase = 'paused';
    }
    await atomicText(
      File('${home.path}/daemon-status.json'),
      jsonEncode({
        'version': collectorVersion,
        'pid': pid,
        'phase': phase,
        'lastEvent': lastEvent,
        'connected': connected,
        'autoSync': preferences['autoSync'] != false,
        'autoUpdate': preferences['autoUpdate'] != false,
        'lastSync': lastSync,
        'updatedAt': DateTime.now().toUtc().toIso8601String(),
      }),
    );
  }
}

List<String> unixCodexCandidates(
  Map<String, String> environment, {
  Iterable<String> bundles = const [],
}) {
  final userHome = environment['HOME'] ?? '';
  final configured = environment['CODEX_EXECUTABLE'];
  final roots = <String>{
    if (configured != null && configured.endsWith('.app')) configured,
    ...bundles,
    '/Applications/Codex.app',
    '/Applications/ChatGPT.app',
    '$userHome/Applications/Codex.app',
    '$userHome/Applications/ChatGPT.app',
  };
  return [
    if (configured != null &&
        configured.startsWith('/') &&
        !configured.endsWith('.app'))
      configured,
    for (final root in roots)
      if (root.startsWith('/') && root.endsWith('.app'))
        for (final path in [
          'codex',
          'bin/codex',
          'codex-cli/CodexCLI.app/Contents/MacOS/codex',
        ])
          '$root/Contents/Resources/$path',
    for (final dir in <String>{
      ...(environment['PATH'] ?? '').split(':'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '$userHome/.local/bin',
      '$userHome/.npm-global/bin',
    })
      if (dir.startsWith('/')) '${dir.replaceFirst(RegExp(r'/+$'), '')}/codex',
  ];
}

String launchAgentXml(String root) {
  String xml(String value) => value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
      '<key>Label</key><string>org.dailyoddbuilds.token-scale</string>'
      '<key>ProgramArguments</key><array><string>/bin/bash</string><string>${xml('$root/host.sh')}</string></array>'
      '<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>'
      '<key>ThrottleInterval</key><integer>60</integer><key>ProcessType</key><string>Interactive</string>'
      '<key>LimitLoadToSessionType</key><string>Aqua</string>'
      '<key>WorkingDirectory</key><string>${xml(root)}</string>'
      '<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>'
      '<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>';
}
