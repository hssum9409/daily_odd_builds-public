import 'package:test/test.dart';
import 'package:token_arena_core/token_arena_core.dart';

void main() {
  final at = DateTime.utc(2026, 10, 11);
  UsageSnapshot sample({
    Map<String, int?> summary = const {},
    Map<String, int> daily = const {},
    String plan = 'pro',
    Map<String, int?> observations = const {},
  }) => UsageSnapshot(
    summary: summary,
    daily: daily.map((k, v) => MapEntry(k, DailyValue(v, at))),
    fetchedAt: at,
    detectedPlan: plan,
    accountKey: 'same',
    observations: observations,
  );
  AchievementProgress rule(UsageSnapshot? s, String id) =>
      evaluateAchievements(s).firstWhere((p) => p.definition.id == id);
  test('hundreds of stable unique IDs, legacy compatibility and exact lifetime tiers', () {
    expect(achievementCatalog.length, greaterThanOrEqualTo(200));
    expect(achievementsById.length, achievementCatalog.length);
    expect(
      achievementCatalog
          .where((a) => a.metric == AchievementMetric.lifetime)
          .map((a) => a.target),
      tokenMilestones,
    );
    expect(achievementsById['lifetime_8319000000']!.specialTitle, 'humanity');
    expect(achievementsById['lifetime_1000000000000']!.specialTitle, 'really');
    for (final id in [
      'million',
      'hundred_million',
      'billion',
      'daily_hundred_million',
      'streak_7',
      'long_turn',
    ]) {
      expect(achievementsById, contains(id));
    }
  });
  test('missing metric is unknown, explicit zero is locked', () {
    expect(rule(sample(), 'million').state, AchievementState.awaitingData);
    expect(
      rule(sample(summary: {'lifetimeTokens': 0}), 'million').state,
      AchievementState.locked,
    );
    expect(
      rule(sample(summary: {'lifetimeTokens': 1000000}), 'million').state,
      AchievementState.unlocked,
    );
  });
  test(
    'longest turn thresholds retain legacy ID and require the API metric',
    () {
      expect(
        rule(sample(), 'longTurn_5400').state,
        AchievementState.awaitingData,
      );
      expect(
        rule(
          sample(summary: {'longestRunningTurnSec': 5399}),
          'longTurn_5400',
        ).state,
        AchievementState.locked,
      );
      expect(
        rule(
          sample(summary: {'longestRunningTurnSec': 5400}),
          'longTurn_5400',
        ).state,
        AchievementState.unlocked,
      );
      expect(
        rule(
          sample(summary: {'longestRunningTurnSec': 5400}),
          'long_turn',
        ).state,
        AchievementState.unlocked,
      );
    },
  );
  test(
    'consecutive tokens require two dates; gaps and zero never bridge runs',
    () {
      expect(
        rule(sample(), 'consecutiveTokens_1000000').state,
        AchievementState.awaitingData,
      );
      expect(
        rule(
          sample(daily: {'2026-10-01': 1000000}),
          'consecutiveTokens_1000000',
        ).value,
        0,
      );
      final days = {
        '2026-10-04': 600000,
        '2026-10-01': 600000,
        '2026-10-02': 600000,
      };
      final p = rule(sample(daily: days), 'consecutiveTokens_1000000');
      expect(p.value, 1200000);
      expect(p.state, AchievementState.unlocked);
      expect(p.evidence, AchievementEvidence.observedDays);
      days['2026-10-02'] = 0;
      expect(rule(sample(daily: days), 'consecutiveTokens_1000000').value, 0);
    },
  );
  test(
    'daily threshold streak spans month/year boundaries but not a missing date',
    () {
      final days = {
        '2025-12-31': 1000000,
        '2026-01-01': 1000000,
        '2026-01-02': 1000000,
      };
      const id = 'sustainedBurn_1000000_3';
      expect(rule(sample(daily: days), id).state, AchievementState.unlocked);
      expect(rule(sample(daily: days), 'sustainedBurn_10000000_3').value, 0);
      days.remove('2026-01-01');
      expect(rule(sample(daily: days), id).value, 1);
      expect(rule(sample(daily: days), id).state, AchievementState.locked);
      expect(rule(sample(), id).state, AchievementState.awaitingData);
    },
  );
  test(
    'daily corrections re-evaluate both token run and sustained daily burn',
    () {
      final old = sample(
        daily: {
          '2026-10-01': 1000000,
          '2026-10-02': 1000000,
          '2026-10-03': 1000000,
        },
      );
      final corrected = sample(daily: {'2026-10-02': 0}).merge(old);
      expect(
        rule(old, 'consecutiveTokens_3000000').state,
        AchievementState.unlocked,
      );
      expect(
        rule(old, 'sustainedBurn_1000000_3').state,
        AchievementState.unlocked,
      );
      expect(
        rule(corrected, 'consecutiveTokens_3000000').state,
        AchievementState.locked,
      );
      expect(
        rule(corrected, 'sustainedBurn_1000000_3').state,
        AchievementState.locked,
      );
    },
  );
  test('huge token runs stay in exact web integer range without wrapping', () {
    final s = sample(daily: {'2026-10-01': maxTokens, '2026-10-02': maxTokens});
    expect(rule(s, 'consecutiveTokens_1000000000000').value, maxTokens);
    expect(
      rule(s, 'consecutiveTokens_1000000000000').state,
      AchievementState.unlocked,
    );
  });
  test('incomplete week never qualifies; full 7 dates do', () {
    final days = {for (var i = 1; i <= 7; i++) '2026-10-0$i': 200000};
    expect(
      rule(sample(daily: days), 'week_1000000').state,
      AchievementState.unlocked,
    );
    days.remove('2026-10-04');
    expect(
      rule(sample(daily: days), 'week_1000000').state,
      AchievementState.awaitingData,
    );
  });
  test('complete calendar month required; current or gap month unknown', () {
    final days = {
      for (var i = 1; i <= 30; i++)
        '2026-09-${i.toString().padLeft(2, '0')}': 100000,
    };
    expect(
      rule(sample(daily: days), 'month_3000000').state,
      AchievementState.unlocked,
    );
    days.remove('2026-09-10');
    expect(
      rule(sample(daily: days), 'month_1000000').state,
      AchievementState.awaitingData,
    );
  });
  test('downward corrections re-evaluate instead of accumulating awards', () {
    final old = sample(summary: {'lifetimeTokens': 8319000000});
    final next = sample(summary: {'lifetimeTokens': 5000000000}).merge(old);
    expect(rule(old, 'lifetime_8319000000').state, AchievementState.unlocked);
    expect(rule(next, 'lifetime_8319000000').state, AchievementState.locked);
  });
  test('current plan and inventories cannot prove historical use', () {
    final s = sample(
      summary: {'lifetimeTokens': 1000000000},
      observations: {
        'enabledSkills': 95,
        'callableApps': 17,
        'availableResetCredits': 3,
      },
    );
    expect(rule(s, 'plan_pro').state, AchievementState.unlocked);
    expect(rule(s, 'enabledSkills_75').state, AchievementState.unlocked);
    expect(rule(s, 'resetAvailable_3').state, AchievementState.unlocked);
    for (final id in [
      'uniqueSkills_1',
      'skillCalls_1',
      'resetUses_1',
      'planMonths_pro_1',
      'paidRest_pro_7',
      'freeTokens_1000000',
      'fastPercent_1',
      'plugins_1',
    ]) {
      expect(rule(s, id).state, AchievementState.awaitingData);
    }
  });
  test(
    'missing zero days and current paid plan never imply a paid holiday',
    () {
      final s = sample(daily: {'2026-10-01': 0});
      expect(rule(s, 'quietDays_1').state, AchievementState.unlocked);
      expect(rule(s, 'quietDays_7').state, AchievementState.locked);
      expect(rule(s, 'paidRest_pro_7').state, AchievementState.awaitingData);
    },
  );
  test(
    'meta awards exclude themselves, public representative payload bounded',
    () {
      final s = sample(summary: {'lifetimeTokens': 1000000}, plan: 'unknown');
      final list = evaluateAchievements(s, nicknameSet: true, visitDays: 1);
      final base = list
          .where(
            (p) =>
                p.definition.metric != AchievementMetric.collection &&
                p.state == AchievementState.unlocked,
          )
          .length;
      expect(
        list.firstWhere((p) => p.definition.id == 'collection_1').value,
        base,
      );
      expect(
        list.firstWhere((p) => p.definition.id == 'collection_5').state,
        AchievementState.locked,
      );
      final ids = representativeAchievements(
        sample(summary: {'lifetimeTokens': 1000000000000}),
        {'nickname': 'Test'},
      );
      expect(ids.length, lessThanOrEqualTo(5));
      expect(ids, contains('lifetime_1000000000000'));
      expect(ids, isNot(contains('million')));
    },
  );
  test('weekly quota progress changes sync hash, timestamps do not', () {
    UsageSnapshot observed(num? percent, int reset) => UsageSnapshot.fromApi(
      {
        'summary': {'lifetimeTokens': 1000000},
      },
      fetchedAt: DateTime.utc(2026, 10, 10),
      rateLimits: {
        'weekly': {'usedPercent': percent, 'resetsAt': reset},
      },
    );
    final low = observed(89, 100);
    final high = observed(90, 200);
    expect(low.fingerprint, isNot(high.fingerprint));
    expect(high.fingerprint, observed(90.0, 999).fingerprint);
    expect(rule(low, 'weeklyPercent_90').state, AchievementState.locked);
    expect(rule(high, 'weeklyPercent_90').state, AchievementState.unlocked);
    expect(
      rule(observed(null, 100), 'weeklyPercent_90').state,
      AchievementState.awaitingData,
    );
  });
  test('minimal counts survive storage and deduplicate; local identity stays local', () {
    final s = sample(observations: {'enabledSkills': 95});
    final j = s.toJson();
    expect(j, isNot(contains('accountKey')));
    expect(j['observations'], {'enabledSkills': 95});
    expect(UsageSnapshot.fromJson(j).observations, s.observations);
    expect(
      s.fingerprint,
      sample(observations: {'enabledSkills': 95}).fingerprint,
    );
    expect(
      s.fingerprint,
      isNot(sample(observations: {'enabledSkills': 96}).fingerprint),
    );
  });
}
