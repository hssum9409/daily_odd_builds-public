import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

// ignore: avoid_relative_lib_imports
import '../lib/desktop.dart';

void main() {
  test('menu IPC consumes only fixed commands', () async {
    final root = await Directory.systemTemp.createTemp('token-scale-ipc-');
    try {
      for (final command in ['pause', 'sync', 'connect']) {
        await File('${root.path}/$command.request').writeAsString(command);
      }
      await File('${root.path}/unknown.request').writeAsString('private');
      expect(await takeDesktopCommands(root), {'pause', 'sync', 'connect'});
      expect(await takeDesktopCommands(root), isEmpty);
      expect(await File('${root.path}/unknown.request').exists(), true);
    } finally {
      await root.delete(recursive: true);
    }
  });

  test(
    'tray status is small and never copies credentials, profile or usage data',
    () async {
      final home = await Directory.systemTemp.createTemp('token-scale-status-');
      try {
        final status = DaemonStatus(home);
        status.preferences = {
          'autoSync': false,
          'autoUpdate': true,
          'uid': 'private',
          'token': 'secret',
        };
        await status.publish('daemon-started');
        var raw = await File('${home.path}/daemon-status.json').readAsString();
        var data = jsonDecode(raw) as Map<String, dynamic>;
        expect(data['phase'], 'paused');
        expect(data['pid'], pid);
        expect(raw.contains('private'), false);
        expect(raw.contains('secret'), false);
        await status.publish('web-connection-needed');
        data = jsonDecode(
          await File('${home.path}/daemon-status.json').readAsString(),
        );
        expect(data['phase'], 'connection-needed');
        await status.publish('private/path with email@invalid');
        data = jsonDecode(
          await File('${home.path}/daemon-status.json').readAsString(),
        );
        expect(data['lastEvent'], 'collector-failed');
        expect(data.keys.toSet(), {
          'version',
          'pid',
          'phase',
          'lastEvent',
          'connected',
          'autoSync',
          'autoUpdate',
          'lastSync',
          'updatedAt',
        });
      } finally {
        await home.delete(recursive: true);
      }
    },
  );

  test('Mac discovery includes nested ChatGPT CLI, renamed bundles and non-shell PATH', () {
    final candidates = unixCodexCandidates(
      {
        'HOME': '/Users/test',
        'PATH': './bad:/custom/bin::relative',
        'CODEX_EXECUTABLE': '/Volumes/Tools/Chat Client.app',
      },
      bundles: ['/Users/test/Downloads/Renamed Codex.app'],
    );
    expect(
      candidates,
      contains(
        '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
      ),
    );
    expect(
      candidates,
      contains('/Volumes/Tools/Chat Client.app/Contents/Resources/codex'),
    );
    expect(
      candidates,
      contains(
        '/Users/test/Downloads/Renamed Codex.app/Contents/Resources/bin/codex',
      ),
    );
    expect(candidates, contains('/custom/bin/codex'));
    expect(candidates.any((path) => !path.startsWith('/')), false);
  });

  test(
    'LaunchAgent uses the GUI login session and XML-escapes the owned path',
    () {
      final plist = launchAgentXml('/Users/test/A&B/<Token>');
      expect(plist, contains('A&amp;B/&lt;Token&gt;/host.sh'));
      expect(plist, contains('<string>Aqua</string>'));
      expect(plist, contains('<string>Interactive</string>'));
      expect(plist, contains('<key>RunAtLoad</key><true/>'));
      expect(plist, isNot(contains('Terminal')));
    },
  );
}
