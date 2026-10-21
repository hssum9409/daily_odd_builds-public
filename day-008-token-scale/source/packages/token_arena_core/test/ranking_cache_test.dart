import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:token_arena_core/token_arena_core.dart';

void main() {
  test('cached period reuses one document; new revision and period fetch independently', () async {
    var reads = 0;
    final repo = ArenaRepository(
      tokenProvider: () async => null,
      client: MockClient((q) async {
        reads++;
        expect(q.method, 'GET');
        expect(q.url.path, contains('rankingSnapshots/'));
        return http.Response(
          jsonEncode({
            'fields': {
              'rows': encodeValue([
                {'uid': 'fixture', 'nickname': 'F', 'tokens': 100, 'rank': 1},
              ]),
            },
            'updateTime': '2026-10-10T00:00:00Z',
          }),
          200,
        );
      }),
    );
    addTearDown(repo.close);
    final cache = MemoryRankingCache(),
        reader = RankingReader(repo, cache),
        meta = {'batchId': '20261010T000000000Z', 'revision': 1};
    await reader.read(meta, ArenaPeriod.daily, 'all');
    await reader.read(meta, ArenaPeriod.daily, 'all');
    expect(reads, 1);
    await reader.read(meta, ArenaPeriod.weekly, 'all');
    expect(reads, 2);
    await reader.read(meta, ArenaPeriod.daily, 'all');
    expect(reads, 2);
    await reader.read({...meta, 'revision': 2}, ArenaPeriod.daily, 'all');
    expect(reads, 3);
    expect(cache.values.keys.any((k) => k.contains('fixture')), false);
  });
  test('server achievement display uses stored measurements and preserves unavailable categories', () {
    final p = serverAchievementProgress({
      'values': {'lifetime': 1000000, 'longTurn': 3600, 'consecutiveTokens': 0},
    });
    expect(
      p.firstWhere((a) => a.definition.id == 'million').state,
      AchievementState.unlocked,
    );
    expect(
      p.firstWhere((a) => a.definition.id == 'fastPercent_100').state,
      AchievementState.awaitingData,
    );
  });
}
