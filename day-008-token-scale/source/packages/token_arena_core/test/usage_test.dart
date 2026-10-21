import 'package:test/test.dart';
import 'package:token_arena_core/token_arena_core.dart';

void main() {
  final fetched = DateTime.utc(2026, 10, 10, 18);
  UsageSnapshot parse(Map<String, dynamic> input) => UsageSnapshot.fromApi(
    input,
    fetchedAt: fetched,
    accountKey: 'local-user',
  );
  test('null metrics and missing buckets remain unknown', () {
    final snapshot = parse({'summary': null, 'dailyUsageBuckets': null});
    expect(snapshot.summary['lifetimeTokens'], isNull);
    expect(totalFor(snapshot, ArenaPeriod.daily, fetched).tokens, isNull);
    expect(snapshot.achievements(), isEmpty);
  });
  test('lifetime is not the daily sum', () {
    final s = parse({
      'summary': {'lifetimeTokens': 1000},
      'dailyUsageBuckets': [
        {'startDate': '2026-10-10', 'tokens': 100},
      ],
    });
    expect(totalFor(s, ArenaPeriod.lifetime, fetched).tokens, 1000);
  });
  test('zero is observed and ranked; missing is not', () {
    final s = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-10', 'tokens': 0},
      ],
    });
    expect(totalFor(s, ArenaPeriod.daily, fetched).complete, isTrue);
    expect(totalFor(s, ArenaPeriod.daily, fetched).tokens, 0);
    expect(totalFor(s, ArenaPeriod.weekly, fetched).complete, isFalse);
  });
  test('replace the same date rather than accumulate', () {
    final old = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-10', 'tokens': 12000000},
      ],
    });
    final changed = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-10', 'tokens': 18000000},
      ],
    }).merge(old);
    expect(changed.daily['2026-10-10']!.tokens, 18000000);
  });
  test('historical downward correction and missing historical values', () {
    final old = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-08', 'tokens': 100},
        {'startDate': '2026-10-09', 'tokens': 200},
      ],
    });
    final next = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-08', 'tokens': 50},
      ],
    }).merge(old);
    expect(next.daily['2026-10-08']!.tokens, 50);
    expect(next.daily['2026-10-09']!.tokens, 200);
  });
  test('account switch never mixes cached daily values', () {
    final old = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-09', 'tokens': 999},
      ],
    });
    final next = UsageSnapshot.fromApi(
      {'dailyUsageBuckets': []},
      fetchedAt: fetched,
      accountKey: 'different',
    ).merge(old);
    expect(next.daily, isEmpty);
  });
  test('same statistics hash ignores fetch time and raw rate metadata', () {
    final old = parse({
      'summary': {'lifetimeTokens': 10},
    });
    final next = UsageSnapshot.fromApi(
      {
        'summary': {'lifetimeTokens': 10},
      },
      fetchedAt: fetched.add(const Duration(hours: 6)),
      accountKey: 'local-user',
      rateLimits: {
        'weekly': {'resetsAt': 9999999999},
      },
    );
    expect(next.fingerprint, old.fingerprint);
  });
  test('weekly is Monday through UTC service date; month starts first', () {
    final s = parse({
      'dailyUsageBuckets': [
        for (var day = 1; day <= 10; day++)
          {
            'startDate': '2026-10-${day.toString().padLeft(2, '0')}',
            'tokens': day,
          },
      ],
    });
    final w = totalFor(s, ArenaPeriod.weekly, fetched);
    expect(w.key, '2026-10-05/2026-10-10');
    expect(w.tokens, 45);
    expect(w.complete, isTrue);
    expect(totalFor(s, ArenaPeriod.monthly, fetched).tokens, 55);
  });
  test('partial periods never publish a ranked total', () {
    final s = parse({
      'summary': {'lifetimeTokens': 100},
      'dailyUsageBuckets': [
        {'startDate': '2026-10-09', 'tokens': 100},
      ],
    });
    final p = publicProjection('uid', {'nickname': 'hello'}, s, fetched);
    expect(p['dailyTokens'], isNull);
    expect(p['weeklyTokens'], isNull);
    expect(p['weeklyObservedTokens'], 100);
    expect(p['lifetimeTokens'], 100);
    expect(p['verificationStatus'], 'community_reported');
  });
  test('weekly and monthly coverage keys expire at UTC day rollover', () {
    final s = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-10', 'tokens': 1},
      ],
    });
    for (final period in [ArenaPeriod.weekly, ArenaPeriod.monthly]) {
      expect(
        totalFor(s, period, fetched).key,
        isNot(totalFor(s, period, fetched.add(const Duration(days: 1))).key),
      );
    }
  });
  test('valid CJK nicknames and markup/control protection', () {
    for (final n in ['토큰 먹는 하마', '令牌 玩家', 'トークン大食い', 'Token eater']) {
      expect(normalizeNickname(n), n);
    }
    for (final n in [
      '',
      '<script>x</script>',
      'a\nname',
      'a\u202eb',
      'a' * 21,
    ]) {
      expect(() => normalizeNickname(n), throwsFormatException);
    }
  });
  test('invalid values and impossible dates fail closed', () {
    for (final v in [
      -1,
      1.5,
      double.nan,
      double.infinity,
      maxTokens + 1,
      '10',
    ]) {
      expect(() => metric(v), throwsFormatException);
    }
    expect(() => parseDate('2026-02-30'), throwsFormatException);
    expect(() => parseDate('2026-10-10T00:00Z'), throwsFormatException);
  });
  test('period sums cannot exceed the exact web integer range', () {
    final s = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-09', 'tokens': maxTokens},
        {'startDate': '2026-10-10', 'tokens': 1},
      ],
    });
    expect(
      () => totalFor(s, ArenaPeriod.monthly, fetched),
      throwsFormatException,
    );
  });
  test('duplicate dates are rejected rather than summed', () {
    expect(
      () => parse({
        'dailyUsageBuckets': [
          {'startDate': '2026-10-10', 'tokens': 1},
          {'startDate': '2026-10-10', 'tokens': 2},
        ],
      }),
      throwsFormatException,
    );
  });
  test('cloud payload excludes identity and credentials', () {
    final s = parse({
      'summary': {'lifetimeTokens': 100},
    });
    expect(s.toJson().containsKey('accountKey'), isFalse);
    expect(s.toJson(local: true)['accountKey'], 'local-user');
    expect(
      s.toJson().keys,
      unorderedEquals([
        'summary',
        'daily',
        'fetchedAt',
        'detectedPlan',
        'sourceTimezone',
        'rateLimits',
      ]),
    );
  });
  test('achievements only use returned metrics', () {
    final s = parse({
      'summary': {
        'lifetimeTokens': 1000000000,
        'peakDailyTokens': 100000000,
        'longestStreakDays': 7,
        'longestRunningTurnSec': 3600,
      },
    });
    expect(
      s.achievements(),
      containsAll([
        'billion',
        'daily_hundred_million',
        'streak_7',
        'long_turn',
      ]),
    );
    expect(s.achievements(), isNot(contains('streak_30')));
  });
  test('four local schedule slots, no missed-slot replay', () {
    final s = SyncSchedule();
    for (final hour in [0, 6, 12, 18]) {
      final now = DateTime(2026, 10, 10, hour);
      expect(s.shouldRun(now), true);
      s.mark(now);
      expect(s.shouldRun(now.add(const Duration(hours: 1))), false);
    }
    expect(s.shouldRun(DateTime(2026, 10, 11)), true);
  });
  test('cache serialization round trip and provenance', () {
    final s = parse({
      'dailyUsageBuckets': [
        {'startDate': '2026-10-10', 'tokens': 42},
      ],
    });
    final copy = UsageSnapshot.fromJson(s.toJson(local: true));
    expect(copy.fingerprint, s.fingerprint);
    expect(copy.daily['2026-10-10']!.fetchedAt, fetched);
  });
}
