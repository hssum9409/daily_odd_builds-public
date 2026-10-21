import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:token_arena_core/token_arena_core.dart';

// ignore: avoid_relative_lib_imports
import '../lib/stream_sync.dart';
// ignore: avoid_relative_lib_imports
import '../lib/runtime.dart';

UsageSnapshot sample({int tokens = 100, int? skills = 2, int seconds = 0}) =>
    UsageSnapshot(
      summary: {'lifetimeTokens': tokens, 'longestRunningTurnSec': 30},
      daily: {
        '2026-10-20': DailyValue(
          tokens,
          DateTime.utc(2026, 10, 22, 0, 0, seconds),
        ),
      },
      fetchedAt: DateTime.utc(2026, 10, 22, 0, 0, seconds),
      accountKey: 'local-only',
      detectedPlan: 'plus',
      observations: skills == null ? {} : {'enabledSkills': skills},
    );
void main() {
  test('30 second polling is independent from hourly metadata scans', () {
    expect(tokenPollInterval, const Duration(seconds: 30));
    expect(metadataPollInterval, const Duration(hours: 1));
  });
  test(
    'timestamps never cause an upload; token patch omits unchanged metadata',
    () {
      final a = sample(), b = sample(seconds: 30);
      expect(usagePatch(b, a), null);
      final patch = usagePatch(sample(tokens: 101, seconds: 30), a)!;
      expect(patch.keys, containsAll(['summary', 'daily', 'fetchedAt']));
      expect(patch.containsKey('observations'), false);
      expect(patch.containsKey('detectedPlan'), false);
      expect((patch['summary'] as Map).keys, ['lifetimeTokens']);
    },
  );
  test(
    'optional RPC omission retains cache; actual zero and reductions are sent',
    () {
      final a = sample();
      final retained = retainObserved(sample(skills: null, seconds: 30), a);
      expect(usagePatch(retained, a), null);
      final patch = usagePatch(sample(tokens: 0, skills: 0, seconds: 30), a)!;
      expect(patch['observations'], {'enabledSkills': 0});
      expect(patch['daily']['2026-10-20']['tokens'], 0);
    },
  );
  test('response loss persists pending body, restart replays identically, unchanged makes no request', () async {
    final temp = await Directory.systemTemp.createTemp(
      'token-scale-delta-test-',
    );
    final file = File('${temp.path}/cache.json');
    final requests = <String>[];
    Map<String, dynamic>? accepted;
    var lose = true;
    final client = MockClient((r) async {
      requests.add(r.url.path);
      if (r.url.path.endsWith('stream-open')) {
        return http.Response(
          jsonEncode({'epoch': 'e' * 32, 'sequence': 0}),
          200,
        );
      }
      final body = jsonDecode(r.body) as Map<String, dynamic>;
      if (accepted != null) expect(body, accepted);
      accepted = body;
      if (lose) {
        lose = false;
        throw http.ClientException('simulated response loss');
      }
      return http.Response(
        jsonEncode({'sequence': body['sequence'], 'changed': true}),
        200,
      );
    });
    final repo = ArenaRepository(
      client: client,
      tokenProvider: () async => 'fixture',
      apiEndpoint: 'https://fixture.invalid',
    );
    Future<bool> send(UsageSnapshot s) => StreamUploader(
      file,
      repo,
    ).upload(s, uid: 'fixture', sourceId: 'a' * 32, proof: {});
    try {
      await expectLater(send(sample()), throwsA(isA<ArenaFailure>()));
      expect((await readJson(file))['pending'], isNotNull);
      expect((await send(sample(seconds: 30))), true);
      expect((await readJson(file))['pending'], isNull);
      final count = requests.length;
      expect(await send(sample(seconds: 60)), false);
      expect(requests.length, count);
      expect((await readJson(file))['sequence'], 1);
    } finally {
      client.close();
      await file.delete();
      await File('${file.path}.lock').delete();
      await temp.delete();
    }
  });
  test('live owner merge preserves history, replaces corrected dates, isolates source switches', () {
    final saved = {'sourceId': 'a', 'usage': sample().toJson()};
    final live = {
      'sourceId': 'a',
      'head': sample(tokens: 50).toJson()..remove('daily'),
      'pending': {
        'daily': {
          '2026-10-20': DailyValue(0, DateTime.utc(2026, 10, 22)).toJson(),
        },
      },
      'uploadedAt': '2026-10-22T00:00:00Z',
    };
    expect(
      UsageSnapshot.fromJson(
        ArenaRepository.mergeLiveUsage(saved, live)['usage'],
      ).daily['2026-10-20']!.tokens,
      0,
    );
    expect(
      ArenaRepository.mergeLiveUsage(
        saved,
        live,
      )['usage']['daily']['2026-10-20']['tokens'],
      0,
    );
    expect(
      ArenaRepository.mergeLiveUsage(saved, {
        ...live,
        'sourceId': 'b',
        'pending': {},
      })['usage']['daily'],
      isEmpty,
    );
  });
}
