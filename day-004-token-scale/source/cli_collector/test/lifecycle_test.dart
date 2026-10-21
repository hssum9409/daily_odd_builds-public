import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

// ignore: avoid_relative_lib_imports
import '../lib/runtime.dart';
// ignore: avoid_relative_lib_imports
import '../lib/updater.dart';
// ignore: avoid_relative_lib_imports
import '../lib/collector.dart';

Map<String, dynamic> release(
  String version, {
  String repo = releaseRepo,
  String? assetName,
}) {
  Map<String, dynamic> asset(String name) => {
    'name': name,
    'state': 'uploaded',
    'size': 512,
    'digest': 'sha256:${'a' * 64}',
    'browser_download_url':
        'https://github.com/$repo/releases/download/day004-cli-v$version/$name',
  };
  return {
    'draft': false,
    'prerelease': false,
    'tag_name': 'day004-cli-v$version',
    'assets': [asset(assetName ?? nativeAsset), asset('SHA256SUMS.txt')],
  };
}

void main() {
  test('numeric version ordering and strict path-safe versions', () {
    expect(compareVersions('0.10.0', '0.2.9'), greaterThan(0));
    for (final bad in [
      '../0.2.0',
      '01.2.0',
      '1.0',
      '1.0.0-beta',
      '99999.0.0',
    ]) {
      expect(validVersion(bad), false);
    }
  });
  test(
    'only newer complete Day 004 stable assets from exact public repository',
    () {
      final old = release('0.1.0'),
          good = release('0.2.1'),
          latest = release('0.10.0');
      expect(
        selectRelease([old, good, latest], '0.2.0', nativeAsset)?.version,
        '0.10.0',
      );
      final draft = release('9.0.0')..['draft'] = true,
          preview = release('9.1.0')..['prerelease'] = true;
      final other = release('9.2.0')..['tag_name'] = 'day001-v9.2.0';
      expect(
        selectRelease(
          [draft, preview, other, release('9.3.0', repo: 'evil/repo')],
          '0.2.0',
          nativeAsset,
        ),
        null,
      );
      for (final field in ['digest', 'size', 'state']) {
        final bad = release('0.2.1');
        (bad['assets'] as List).first.remove(field);
        expect(selectRelease([bad], '0.2.0', nativeAsset), null);
      }
    },
  );
  test('binary headers reject HTML/wrong machine and accept PE x64', () {
    final b = List<int>.filled(300, 0)
      ..[0] = 0x4d
      ..[1] = 0x5a
      ..[60] = 128
      ..[128] = 0x50
      ..[129] = 0x45
      ..[132] = 0x64
      ..[133] = 0x86;
    expect(nativeHeader(b, true), true);
    b[132] = 0xaa;
    expect(nativeHeader(b, true), false);
    expect(nativeHeader(utf8.encode('<html>failed</html>'), true), false);
  });
  test(
    'Windows AOT update selection rejects PE and wrong-architecture snapshots',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'token-scale-aot-test',
      );
      final client = MockClient((_) async => http.Response('[]', 200));
      try {
        await atomicText(File('${root.path}/runtime-mode'), 'aot');
        final updater = Updater(root, root, client);
        if (Platform.isWindows) {
          expect(updater.assetName, 'token-scale-windows-x64.aot');
          expect(
            selectRelease([release('0.2.1')], '0.2.0', updater.assetName),
            null,
          );
          expect(
            selectRelease(
              [release('0.2.1', assetName: updater.assetName)],
              '0.2.0',
              updater.assetName,
            )?.version,
            '0.2.1',
          );
        }
        final bytes = List<int>.filled(256, 0)
          ..setRange(0, 6, [0x7f, 0x45, 0x4c, 0x46, 2, 1])
          ..[18] = 0x3e;
        expect(aotHeader(bytes), true);
        bytes[18] = 0xb7;
        expect(aotHeader(bytes), false);
        expect(aotHeader(utf8.encode('<html>failed</html>')), false);
      } finally {
        client.close();
        await root.delete(recursive: true);
      }
    },
  );
  test('downloads check exact size/hash and redirect host before accepting bytes', () async {
    final root = await Directory.systemTemp.createTemp(
      'token-scale-update-test',
    );
    try {
      final bytes = utf8.encode('legitimate fixture'),
          asset = {
            'browser_download_url':
                'https://github.com/$releaseRepo/releases/download/day004-cli-v0.2.1/$nativeAsset',
            'size': bytes.length,
            'digest': 'sha256:${sha256.convert(bytes)}',
          };
      final client = MockClient((_) async => http.Response.bytes(bytes, 200));
      expect(await Updater(root, root, client).download(asset), bytes);
      await expectLater(
        Updater(
          root,
          root,
          client,
        ).download({...asset, 'size': bytes.length + 1}),
        throwsFormatException,
      );
      await expectLater(
        Updater(
          root,
          root,
          client,
        ).download({...asset, 'digest': 'sha256:${'0' * 64}'}),
        throwsFormatException,
      );
      final redirect = MockClient(
        (_) async => http.Response(
          '',
          302,
          headers: {'location': 'https://evil.example/payload'},
        ),
      );
      await expectLater(
        Updater(root, root, redirect).download(asset),
        throwsFormatException,
      );
      client.close();
      redirect.close();
    } finally {
      await root.delete(recursive: true);
    }
  });
  test(
    'rate limit blocks even forced requests and cache avoids duplicate network',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'token-scale-rate-test',
      );
      var calls = 0;
      final client = MockClient((_) async {
        calls++;
        return http.Response('', 429, headers: {'retry-after': '600'});
      });
      try {
        final updater = Updater(root, root, client);
        expect(await updater.check(force: true), false);
        expect(await updater.check(force: true), false);
        expect(calls, 1);
        final state = await readJson(File('${root.path}/updates.json'));
        expect(state['rateLimited'], true);
      } finally {
        client.close();
        await root.delete(recursive: true);
      }
    },
  );
  test('ETag 304 uses cached release selection and unchanged feed needs no download', () async {
    final root = await Directory.systemTemp.createTemp('token-scale-etag-test');
    var calls = 0;
    final client = MockClient((req) async {
      calls++;
      if (calls == 1) {
        return http.Response('[]', 200, headers: {'etag': '"fixture"'});
      }
      expect(req.headers['If-None-Match'], '"fixture"');
      return http.Response('', 304);
    });
    try {
      final updater = Updater(root, root, client);
      expect(await updater.check(force: true), false);
      expect(await updater.check(), false);
      expect(calls, 1);
      expect(await updater.check(force: true), false);
      expect(calls, 2);
    } finally {
      client.close();
      await root.delete(recursive: true);
    }
  });
  test(
    'private atomic state and DPAPI storage round trip preserve metadata',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'token-scale-store-test',
      );
      try {
        final store = SessionStore(home: root.path);
        await store.saveState({'fingerprint': 'fixture'});
        await store.saveState({'fingerprint': 'corrected'});
        expect((await store.state())['fingerprint'], 'corrected');
        if (Platform.isWindows) {
          const secret = 'synthetic-test-not-a-credential';
          final encrypted = await store.protect(secret, false);
          expect(encrypted.contains(secret), false);
          expect(await store.protect(encrypted, true), secret);
        } else if (Platform.isMacOS) {
          try {
            await store.keychain('set', 'synthetic-keychain-test');
            expect(await store.keychain('get'), 'synthetic-keychain-test');
            await store.keychain('set', 'synthetic-keychain-corrected');
            expect(await store.keychain('get'), 'synthetic-keychain-corrected');
          } finally {
            await store.keychain('delete');
          }
        }
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'version cleanup preserves rollback, blocked version and unexpected files',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'token-scale-cleanup-test',
      );
      try {
        await atomicText(File('${root.path}/current.txt'), '0.2.1');
        await atomicText(File('${root.path}/previous.txt'), '0.2.0');
        await atomicText(
          File('${root.path}/blocked-update.json'),
          '{"version":"0.2.2"}',
        );
        for (final version in [
          '0.1.0',
          '0.1.1',
          '0.2.0',
          '0.2.1',
          '0.2.2',
          'notes',
        ]) {
          await atomicText(
            File('${root.path}/versions/$version/token-scale.exe'),
            'fixture',
          );
        }
        await atomicText(
          File('${root.path}/versions/0.1.1/user-note.txt'),
          'retain',
        );
        await cleanupManagedVersions(root);
        expect(await Directory('${root.path}/versions/0.1.0').exists(), false);
        expect(
          await File('${root.path}/versions/0.1.1/token-scale.exe').exists(),
          false,
        );
        expect(
          await File('${root.path}/versions/0.1.1/user-note.txt')
              .readAsString(),
          'retain',
        );
        for (final version in ['0.2.0', '0.2.1', '0.2.2', 'notes']) {
          expect(
            await File('${root.path}/versions/$version/token-scale.exe')
                .exists(),
            true,
          );
        }
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
  test('retry is bounded and resets after recovery', () {
    final retry = RetryPolicy();
    expect(retry.failed(), const Duration(seconds: 60));
    for (var n = 0; n < 20; n++) {
      expect(retry.failed().inSeconds, lessThanOrEqualTo(3840));
    }
    retry.success();
    expect(retry.failed(), const Duration(seconds: 60));
  });
}
