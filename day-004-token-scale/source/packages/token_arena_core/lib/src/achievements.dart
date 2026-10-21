import 'usage.dart';

/// Catalog rules are data. IDs are permanent, independent of localized names.
/// Unknown measurements never become zero. All awards remain community reported.
enum AchievementMetric {
  lifetime,
  daily,
  week,
  month,
  streak,
  consecutiveTokens,
  sustainedBurn,
  longTurn,
  activeDays,
  quietDays,
  weeklyPercent,
  resetAvailable,
  enabledSkills,
  callableApps,
  plan,
  nickname,
  visits,
  collection,
  freeTokens,
  uniqueSkills,
  skillCalls,
  skillMastery,
  fastPercent,
  plugins,
  resetUses,
  planMonths,
  paidRest,
  dailyWins,
  weeklyWins,
  monthlyWins,
  planWins,
}

enum AchievementState { unlocked, locked, awaitingData }

enum AchievementEvidence {
  source,
  completeWindow,
  observedDays,
  local,
  unavailable,
}

class AchievementDefinition {
  const AchievementDefinition(
    this.id,
    this.metric,
    this.target, {
    this.plan,
    this.specialTitle,
    this.minimumDailyTokens,
    this.ready = true,
  });
  final String id;
  final AchievementMetric metric;
  final int target;
  final String? plan;
  final String? specialTitle;

  /// Only sustained-burn rules: target counts days above this token threshold.
  final int? minimumDailyTokens;
  final bool ready;
  String get category => switch (metric) {
    AchievementMetric.lifetime => 'lifetime',
    AchievementMetric.daily => 'daily',
    AchievementMetric.week => 'week',
    AchievementMetric.month => 'month',
    AchievementMetric.consecutiveTokens => 'consecutive',
    AchievementMetric.sustainedBurn => 'sustained',
    AchievementMetric.streak ||
    AchievementMetric.activeDays ||
    AchievementMetric.quietDays => 'habits',
    AchievementMetric.longTurn => 'marathon',
    AchievementMetric.weeklyPercent ||
    AchievementMetric.resetAvailable ||
    AchievementMetric.resetUses => 'limits',
    AchievementMetric.plan ||
    AchievementMetric.freeTokens ||
    AchievementMetric.planMonths ||
    AchievementMetric.paidRest => 'plans',
    AchievementMetric.enabledSkills ||
    AchievementMetric.callableApps ||
    AchievementMetric.uniqueSkills ||
    AchievementMetric.skillCalls ||
    AchievementMetric.skillMastery ||
    AchievementMetric.plugins => 'skills',
    AchievementMetric.fastPercent => 'speed',
    AchievementMetric.dailyWins ||
    AchievementMetric.weeklyWins ||
    AchievementMetric.monthlyWins ||
    AchievementMetric.planWins => 'competition',
    _ => 'community',
  };
}

const tokenMilestones = <int>[
  1000000,
  2000000,
  3000000,
  5000000,
  10000000,
  30000000,
  50000000,
  100000000,
  300000000,
  500000000,
  1000000000,
  5000000000,
  8319000000,
  10000000000,
  50000000000,
  100000000000,
  500000000000,
  1000000000000,
];

final List<AchievementDefinition> achievementCatalog = List.unmodifiable([
  for (final m in [
    AchievementMetric.lifetime,
    AchievementMetric.daily,
    AchievementMetric.week,
    AchievementMetric.month,
  ])
    for (final n in tokenMilestones)
      AchievementDefinition(
        _tokenId(m, n),
        m,
        n,
        specialTitle: m == AchievementMetric.lifetime
            ? switch (n) {
                1000000 => 'oneM',
                8319000000 => 'humanity',
                1000000000000 => 'really',
                _ => null,
              }
            : null,
      ),
  ..._tiers(AchievementMetric.streak, [
    1,
    2,
    3,
    5,
    7,
    10,
    14,
    21,
    30,
    45,
    60,
    90,
    100,
    180,
    200,
    365,
    500,
    1000,
  ]),
  ..._tiers(AchievementMetric.longTurn, [
    60,
    120,
    300,
    600,
    900,
    1200,
    1800,
    2700,
    3600,
    5400,
    7200,
    10800,
    14400,
    21600,
    28800,
    43200,
    86400,
    172800,
    259200,
    604800,
  ]),
  ..._tiers(AchievementMetric.consecutiveTokens, tokenMilestones),
  for (final tokens in [1000000, 10000000, 100000000, 1000000000])
    for (final days in [3, 7, 14, 30, 100])
      AchievementDefinition(
        'sustainedBurn_${tokens}_$days',
        AchievementMetric.sustainedBurn,
        days,
        minimumDailyTokens: tokens,
      ),
  ..._tiers(AchievementMetric.activeDays, [
    1,
    3,
    7,
    14,
    30,
    50,
    100,
    150,
    200,
    365,
    500,
    1000,
  ]),
  ..._tiers(AchievementMetric.quietDays, [1, 3, 7, 14, 30, 60, 100, 365]),
  ..._tiers(AchievementMetric.weeklyPercent, [
    10,
    25,
    40,
    50,
    60,
    70,
    80,
    90,
    95,
    99,
  ]),
  ..._tiers(AchievementMetric.resetAvailable, [1, 2, 3, 5, 10, 20]),
  ..._tiers(AchievementMetric.enabledSkills, [
    1,
    3,
    5,
    10,
    20,
    30,
    50,
    75,
    100,
    200,
  ]),
  ..._tiers(AchievementMetric.callableApps, [1, 2, 3, 5, 10, 15, 20, 30]),
  for (final p in [
    'free',
    'go',
    'plus',
    'pro',
    'business',
    'team',
    'enterprise',
    'edu',
  ])
    AchievementDefinition(
      'plan_$p',
      AchievementMetric.plan,
      1,
      plan: p,
      specialTitle: p == 'business' || p == 'team' ? 'businessman' : null,
    ),
  const AchievementDefinition('nickname', AchievementMetric.nickname, 1),
  // A day counts once on this browser. No request/write on every visit.
  ..._tiers(AchievementMetric.visits, [1, 3, 7]),
  ..._tiers(AchievementMetric.collection, [
    1,
    3,
    5,
    10,
    20,
    30,
    50,
    75,
    100,
    125,
    150,
    200,
  ]),
  // Visible ideas, with no fake counters. Enable only with a proven data adapter.
  ..._tiers(AchievementMetric.freeTokens, tokenMilestones, ready: false),
  ..._tiers(AchievementMetric.uniqueSkills, [
    1,
    3,
    5,
    10,
    20,
    30,
    50,
    75,
    100,
    200,
  ], ready: false),
  ..._tiers(AchievementMetric.skillCalls, [
    1,
    5,
    10,
    25,
    50,
    100,
    300,
    500,
    1000,
    3000,
    10000,
    100000,
  ], ready: false),
  ..._tiers(AchievementMetric.skillMastery, [
    2,
    3,
    5,
    10,
    20,
    50,
    100,
    500,
  ], ready: false),
  ..._tiers(AchievementMetric.fastPercent, [
    1,
    10,
    20,
    30,
    40,
    50,
    60,
    75,
    90,
    100,
  ], ready: false),
  ..._tiers(AchievementMetric.plugins, [
    1,
    2,
    3,
    5,
    10,
    20,
    30,
    50,
  ], ready: false),
  ..._tiers(AchievementMetric.resetUses, [
    1,
    2,
    3,
    5,
    10,
    20,
    50,
    100,
  ], ready: false),
  for (final p in ['plus', 'pro', 'business']) ...[
    for (final n in [1, 2, 3, 6, 12, 18, 24, 36])
      AchievementDefinition(
        'planMonths_${p}_$n',
        AchievementMetric.planMonths,
        n,
        plan: p,
        ready: false,
      ),
    for (final n in [7, 14, 30, 60, 90])
      AchievementDefinition(
        'paidRest_${p}_$n',
        AchievementMetric.paidRest,
        n,
        plan: p,
        ready: false,
      ),
  ],
  for (final m in [
    AchievementMetric.dailyWins,
    AchievementMetric.weeklyWins,
    AchievementMetric.monthlyWins,
    AchievementMetric.planWins,
  ])
    AchievementDefinition(m.name, m, 1, ready: false),
]);

List<AchievementDefinition> _tiers(
  AchievementMetric m,
  List<int> values, {
  bool ready = true,
}) => [
  for (final n in values)
    AchievementDefinition(
      m == AchievementMetric.streak
          ? 'streak_$n'
          : m == AchievementMetric.longTurn && n == 3600
          ? 'long_turn'
          : '${m.name}_$n',
      m,
      n,
      ready: ready,
    ),
];
String _tokenId(AchievementMetric m, int n) => switch ((m, n)) {
  (AchievementMetric.lifetime, 1000000) => 'million',
  (AchievementMetric.lifetime, 100000000) => 'hundred_million',
  (AchievementMetric.lifetime, 1000000000) => 'billion',
  (AchievementMetric.daily, 100000000) => 'daily_hundred_million',
  _ => '${m.name}_$n',
};
final achievementsById = {for (final a in achievementCatalog) a.id: a};

class AchievementProgress {
  const AchievementProgress(this.definition, this.value, this.evidence);
  final AchievementDefinition definition;
  final num? value;
  final AchievementEvidence evidence;
  AchievementState get state => value == null
      ? AchievementState.awaitingData
      : value! >= definition.target
      ? AchievementState.unlocked
      : AchievementState.locked;
  double get fraction =>
      value == null ? 0 : (value! / definition.target).clamp(0, 1).toDouble();
}

/// Display server measurements. The dashboard never recalculates source awards.
List<AchievementProgress> serverAchievementProgress(
  Map<String, dynamic> state,
) {
  final values = Map<String, dynamic>.from(state['values'] as Map? ?? {});
  return [
    for (final a in achievementCatalog)
      AchievementProgress(
        a,
        !a.ready
            ? null
            : switch (a.metric) {
                AchievementMetric.plan => values['plan_${a.plan}'] as num?,
                AchievementMetric.sustainedBurn =>
                  values['sustainedBurn_${a.minimumDailyTokens}'] as num?,
                _ => values[a.metric.name] as num?,
              },
        !a.ready
            ? AchievementEvidence.unavailable
            : switch (a.metric) {
                AchievementMetric.week ||
                AchievementMetric.month => AchievementEvidence.completeWindow,
                AchievementMetric.activeDays ||
                AchievementMetric.quietDays ||
                AchievementMetric.consecutiveTokens ||
                AchievementMetric.sustainedBurn =>
                  AchievementEvidence.observedDays,
                AchievementMetric.nickname ||
                AchievementMetric.visits ||
                AchievementMetric.collection => AchievementEvidence.local,
                _ => AchievementEvidence.source,
              },
      ),
  ];
}

/// A historical bucket correction re-evaluates awards. No invented unlock date.
/// Month = a complete calendar month; week = any seven consecutive source dates.
/// Source timezone is unconfirmed, so these remain provisional community awards.
List<AchievementProgress> evaluateAchievements(
  UsageSnapshot? s, {
  bool nicknameSet = false,
  int? visitDays,
}) {
  final windows = s == null
      ? const <AchievementMetric, int?>{}
      : {
          AchievementMetric.week: _bestWindow(s, 7),
          AchievementMetric.month: _bestMonth(s),
          AchievementMetric.consecutiveTokens: _bestConsecutiveTokens(s),
        };
  final sustained = <int, int>{};
  int? observedCount(bool Function(int) predicate) =>
      s == null || s.daily.isEmpty
      ? null
      : s.daily.values.where((d) => predicate(d.tokens)).length;
  num? read(AchievementDefinition a) => !a.ready
      ? null
      : switch (a.metric) {
          AchievementMetric.lifetime => s?.summary['lifetimeTokens'],
          AchievementMetric.daily => s?.summary['peakDailyTokens'] ?? _peak(s),
          AchievementMetric.week ||
          AchievementMetric.month => windows[a.metric],
          AchievementMetric.consecutiveTokens => windows[a.metric],
          AchievementMetric.sustainedBurn =>
            s == null || s.daily.isEmpty
                ? null
                : sustained.putIfAbsent(
                    a.minimumDailyTokens!,
                    () => _bestDailyThresholdStreak(s, a.minimumDailyTokens!),
                  ),
          AchievementMetric.streak => s?.summary['longestStreakDays'],
          AchievementMetric.longTurn => s?.summary['longestRunningTurnSec'],
          AchievementMetric.activeDays => observedCount((n) => n > 0),
          AchievementMetric.quietDays => observedCount((n) => n == 0),
          AchievementMetric.weeklyPercent => _weeklyPercent(s),
          AchievementMetric.resetAvailable =>
            s?.observations['availableResetCredits'],
          AchievementMetric.enabledSkills => s?.observations['enabledSkills'],
          AchievementMetric.callableApps => s?.observations['callableApps'],
          AchievementMetric.plan =>
            s == null || ['unknown', 'other'].contains(s.detectedPlan)
                ? null
                : s.detectedPlan == a.plan
                ? 1
                : 0,
          AchievementMetric.nickname => nicknameSet ? 1 : 0,
          AchievementMetric.visits => visitDays,
          _ => null,
        };
  AchievementEvidence evidence(AchievementDefinition a) => !a.ready
      ? AchievementEvidence.unavailable
      : switch (a.metric) {
          AchievementMetric.week ||
          AchievementMetric.month => AchievementEvidence.completeWindow,
          AchievementMetric.activeDays ||
          AchievementMetric.consecutiveTokens ||
          AchievementMetric.sustainedBurn ||
          AchievementMetric.quietDays => AchievementEvidence.observedDays,
          AchievementMetric.nickname ||
          AchievementMetric.visits => AchievementEvidence.local,
          _ => AchievementEvidence.source,
        };
  final base = [
    for (final a in achievementCatalog.where(
      (a) => a.metric != AchievementMetric.collection,
    ))
      AchievementProgress(a, read(a), evidence(a)),
  ];
  // Meta awards never count themselves, preventing recursive inflation.
  final count = base.where((a) => a.state == AchievementState.unlocked).length;
  final index = {for (final a in base) a.definition.id: a};
  return [
    for (final a in achievementCatalog)
      a.metric == AchievementMetric.collection
          ? AchievementProgress(a, count, AchievementEvidence.local)
          : index[a.id]!,
  ];
}

num? _weeklyPercent(UsageSnapshot? s) => s?.weeklyUsedPercent;

/// Source-date adjacency only. Missing buckets are unknown, so they cannot
/// prove continuity. This never claims uninterrupted foreground/session use.
int _bestDailyThresholdStreak(UsageSnapshot s, int threshold) {
  final days = s.daily.keys.toList()..sort();
  String? previous;
  var run = 0, best = 0;
  for (final key in days) {
    final adjacent =
        previous != null &&
        parseDate(key).difference(parseDate(previous)).inDays == 1;
    run = s.daily[key]!.tokens >= threshold ? (adjacent ? run + 1 : 1) : 0;
    if (run > best) best = run;
    previous = key;
  }
  return best;
}

/// Highest observed sum over a positive run of at least two adjacent dates.
/// Zero and gaps break the proof. Saturation preserves an exact safe lower
/// bound on web; thresholds are all much smaller than maxTokens.
int? _bestConsecutiveTokens(UsageSnapshot s) {
  if (s.daily.isEmpty) return null;
  final days = s.daily.keys.toList()..sort();
  String? previous;
  var length = 0, sum = 0, best = 0;
  for (final key in days) {
    final tokens = s.daily[key]!.tokens;
    final adjacent =
        previous != null &&
        parseDate(key).difference(parseDate(previous)).inDays == 1;
    if (tokens == 0) {
      length = 0;
      sum = 0;
    } else {
      length = adjacent ? length + 1 : 1;
      if (!adjacent) sum = 0;
      sum = sum > maxTokens - tokens ? maxTokens : sum + tokens;
      if (length >= 2 && sum > best) best = sum;
    }
    previous = key;
  }
  return best;
}

int? _peak(UsageSnapshot? s) {
  if (s == null || s.daily.isEmpty) return null;
  return s.daily.values.fold<int>(0, (n, d) => n > d.tokens ? n : d.tokens);
}

int? _sum(UsageSnapshot s, List<String> days) {
  var sum = 0;
  for (final key in days) {
    final d = s.daily[key];
    if (d == null || sum > maxTokens - d.tokens) return null;
    sum += d.tokens;
  }
  return sum;
}

int? _bestWindow(UsageSnapshot s, int length) {
  int? best;
  for (final key in s.daily.keys) {
    final end = parseDate(key);
    final total = _sum(s, [
      for (var i = 0; i < length; i++) dateKey(end.subtract(Duration(days: i))),
    ]);
    if (total != null && (best == null || total > best)) best = total;
  }
  return best;
}

int? _bestMonth(UsageSnapshot s) {
  int? best;
  for (final month in s.daily.keys.map((d) => d.substring(0, 7)).toSet()) {
    final start = parseDate('$month-01');
    final end = DateTime.utc(
      start.year,
      start.month + 1,
    ).subtract(const Duration(days: 1));
    // A future/current partial month never counts as a complete calendar month.
    final fetched = s.fetchedAt.toUtc();
    if (!end.isBefore(DateTime.utc(fetched.year, fetched.month, fetched.day))) {
      continue;
    }
    final total = _sum(s, [
      for (var i = 0; i < end.day; i++) dateKey(start.add(Duration(days: i))),
    ]);
    if (total != null && (best == null || total > best)) best = total;
  }
  return best;
}
