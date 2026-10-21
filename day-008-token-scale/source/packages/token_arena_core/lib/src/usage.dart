import 'dart:convert';

import 'package:characters/characters.dart';
import 'package:crypto/crypto.dart';

import 'achievements.dart';

const maxTokens = 9000000000000000; // Exact integer range on Flutter Web.
const detectedPlans = [
  'free',
  'go',
  'plus',
  'pro',
  'business',
  'team',
  'enterprise',
  'edu',
  'other',
  'unknown',
];
// Pro 10x/25x are not asserted to be official plans. Detected `pro` has no multiplier.
const declaredPlans = [
  'unknown',
  'free',
  'go',
  'plus',
  'pro',
  'pro_5x',
  'pro_20x',
  'business',
  'enterprise',
  'edu',
  'other',
];

int? metric(Object? value) {
  if (value == null) return null;
  if (value is! num ||
      !value.isFinite ||
      value < 0 ||
      value > maxTokens ||
      value != value.round()) {
    throw const FormatException('invalid-metric');
  }
  return value.toInt();
}

String dateKey(DateTime value) => value.toIso8601String().substring(0, 10);
DateTime parseDate(String value) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) {
    throw const FormatException('invalid-date');
  }
  final date = DateTime.parse('${value}T00:00:00Z');
  if (dateKey(date) != value) throw const FormatException('invalid-date');
  return date;
}

String normalizeNickname(String value) {
  final nickname = value.trim().replaceAll(RegExp(r' +'), ' ');
  if (nickname.characters.isEmpty ||
      nickname.characters.length > 20 ||
      nickname.runes.length > 20 ||
      RegExp(r'[<>\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]')
          .hasMatch(nickname)) {
    throw const FormatException('invalid-nickname');
  }
  return nickname;
}

class DailyValue {
  const DailyValue(this.tokens, this.fetchedAt);
  final int tokens;
  final DateTime fetchedAt;
  Map<String, Object> toJson() => {
    'tokens': tokens,
    'fetchedAt': fetchedAt.toUtc().toIso8601String(),
  };
  factory DailyValue.fromJson(Map<String, dynamic> json) =>
      DailyValue(metric(json['tokens'])!, DateTime.parse(json['fetchedAt']));
}

class UsageSnapshot {
  const UsageSnapshot({
    required this.summary,
    required this.daily,
    required this.fetchedAt,
    this.detectedPlan = 'unknown',
    this.accountKey = '',
    this.rateLimits = const {},
    this.observations = const {},
  });
  final Map<String, int?> summary;
  final Map<String, DailyValue> daily;
  final DateTime fetchedAt;
  final String detectedPlan;
  // Local only. Never included in Firestore/public JSON. Used only to prevent cache mixing.
  final String accountKey;
  final Map<String, dynamic> rateLimits;
  // Counts only: no skill names, app names, paths or reset-credit IDs.
  final Map<String, int?> observations;
  static const observationKeys = [
    'enabledSkills',
    'callableApps',
    'availableResetCredits',
  ];
  static const metrics = [
    'lifetimeTokens',
    'peakDailyTokens',
    'longestRunningTurnSec',
    'currentStreakDays',
    'longestStreakDays',
  ];

  factory UsageSnapshot.fromApi(
    Map<String, dynamic> json, {
    required DateTime fetchedAt,
    String detectedPlan = 'unknown',
    String accountKey = '',
    Map<String, dynamic> rateLimits = const {},
    Map<String, int?> observations = const {},
  }) {
    final rawSummary = json['summary'] as Map<String, dynamic>? ?? {};
    final values = <String, DailyValue>{};
    for (final raw in json['dailyUsageBuckets'] as List? ?? []) {
      final row = Map<String, dynamic>.from(raw as Map);
      final key = row['startDate'] as String;
      parseDate(key);
      final tokens = metric(row['tokens']);
      if (tokens == null) continue;
      if (values.containsKey(key)) {
        throw const FormatException('duplicate-source-date');
      }
      values[key] = DailyValue(tokens, fetchedAt);
    }
    return UsageSnapshot(
      summary: {for (final key in metrics) key: metric(rawSummary[key])},
      daily: values,
      fetchedAt: fetchedAt,
      detectedPlan: detectedPlans.contains(detectedPlan)
          ? detectedPlan
          : 'other',
      accountKey: accountKey,
      rateLimits: rateLimits,
      observations: observations,
    );
  }

  UsageSnapshot merge(UsageSnapshot? previous) {
    if (previous == null ||
        accountKey.isEmpty ||
        accountKey != previous.accountKey) {
      return this;
    }
    final merged = {...previous.daily};
    for (final entry in daily.entries) {
      final old = merged[entry.key];
      // Unchanged buckets retain their own observation timestamp.
      if (old == null || old.tokens != entry.value.tokens) {
        merged[entry.key] = entry.value;
      }
    }
    return UsageSnapshot(
      summary: summary,
      daily: merged,
      fetchedAt: fetchedAt,
      detectedPlan: detectedPlan,
      accountKey: accountKey,
      rateLimits: rateLimits,
      observations: observations,
    );
  }

  Map<String, dynamic> toJson({bool local = false}) => {
    'summary': summary,
    'daily': {for (final e in daily.entries) e.key: e.value.toJson()},
    'fetchedAt': fetchedAt.toUtc().toIso8601String(),
    'detectedPlan': detectedPlan,
    'sourceTimezone': 'unconfirmed', if (local) 'accountKey': accountKey,
    // Only allowlisted weekly window observations, no credits, account or auth objects.
    'rateLimits': rateLimits,
    if (observations.isNotEmpty) 'observations': observations,
  };
  factory UsageSnapshot.fromJson(Map<String, dynamic> json) => UsageSnapshot(
    summary: {for (final k in metrics) k: metric((json['summary'] as Map)[k])},
    daily: (json['daily'] as Map<String, dynamic>).map(
      (k, v) => MapEntry(k, DailyValue.fromJson(Map<String, dynamic>.from(v))),
    ),
    fetchedAt: DateTime.parse(json['fetchedAt']),
    detectedPlan: json['detectedPlan'] ?? 'unknown',
    accountKey: json['accountKey'] ?? '',
    rateLimits: Map<String, dynamic>.from(json['rateLimits'] ?? {}),
    observations: {
      for (final k in observationKeys)
        if ((json['observations'] as Map?)?.containsKey(k) ?? false)
          k: metric(json['observations'][k]),
    },
  );

  double? get weeklyUsedPercent {
    final window = rateLimits['weekly'];
    if (window is! Map) return null;
    final value = window['usedPercent'];
    return value is num && value.isFinite && value >= 0 && value <= 100
        ? value.toDouble()
        : null;
  }

  String get fingerprint {
    final keys = daily.keys.toList()..sort();
    return sha256
        .convert(
          utf8.encode(
            jsonEncode({
              'summary': summary,
              'daily': {for (final key in keys) key: daily[key]!.tokens},
              'detectedPlan': detectedPlan,
              // Quota progress is now an achievement metric. Observed time and
              // reset timestamps alone still never cause another upload.
              if (weeklyUsedPercent != null)
                'weeklyUsedPercent': weeklyUsedPercent,
              if (observations.isNotEmpty)
                'observations': {
                  for (final k in observationKeys)
                    if (observations.containsKey(k)) k: observations[k],
                },
            }),
          ),
        )
        .toString();
  }

  List<String> achievements() => [
    for (final p in evaluateAchievements(this))
      if (p.state == AchievementState.unlocked) p.definition.id,
  ];
}

enum ArenaPeriod { daily, weekly, monthly, lifetime }

class PeriodTotal {
  const PeriodTotal(
    this.tokens,
    this.observedDays,
    this.expectedDays,
    this.key,
  );
  final int? tokens;
  final int observedDays;
  final int expectedDays;
  final String key;
  bool get complete => observedDays == expectedDays && tokens != null;
}

PeriodTotal totalFor(
  UsageSnapshot snapshot,
  ArenaPeriod period,
  DateTime clock,
) {
  final end = DateTime.utc(
    clock.toUtc().year,
    clock.toUtc().month,
    clock.toUtc().day,
  );
  if (period == ArenaPeriod.lifetime) {
    return PeriodTotal(snapshot.summary['lifetimeTokens'], 0, 0, 'lifetime');
  }
  final start = switch (period) {
    ArenaPeriod.daily => end,
    ArenaPeriod.weekly => end.subtract(Duration(days: end.weekday - 1)),
    ArenaPeriod.monthly => DateTime.utc(end.year, end.month),
    ArenaPeriod.lifetime => end,
  };
  var sum = 0;
  var count = 0;
  for (var d = start; !d.isAfter(end); d = d.add(const Duration(days: 1))) {
    final row = snapshot.daily[dateKey(d)];
    if (row != null) {
      if (sum > maxTokens - row.tokens) {
        throw const FormatException('invalid-metric');
      }
      sum += row.tokens;
      count++;
    }
  }
  return PeriodTotal(
    count == 0 ? null : sum,
    count,
    end.difference(start).inDays + 1,
    period == ArenaPeriod.daily
        ? dateKey(start)
        : '${dateKey(start)}/${dateKey(end)}',
  );
}

Map<String, dynamic> publicProjection(
  String uid,
  Map<String, dynamic> profile,
  UsageSnapshot snapshot,
  DateTime now,
) {
  final result = <String, dynamic>{
    'uid': uid,
    'nickname': profile['nickname'],
    for (final key in ['avatar', 'bio', 'github'])
      if (profile.containsKey(key)) key: profile[key],
    'declaredPlan': profile['declaredPlan'] ?? 'unknown',
    'detectedPlan': snapshot.detectedPlan,
    'verificationStatus': 'community_reported',
    'sourceTimezone': 'unconfirmed', 'fetchedAt': snapshot.fetchedAt.toUtc(),
    'sourceDate': snapshot.daily.isEmpty
        ? null
        : (snapshot.daily.keys.toList()..sort()).last,
    // Five representative badges; the full album uses the owner's private data.
    'achievements': representativeAchievements(snapshot, profile),
    // Limited graph only; full daily history stays private.
    'recentDaily': {
      for (final key in (snapshot.daily.keys.toList()..sort()).reversed.take(
        30,
      ))
        key: snapshot.daily[key]!.tokens,
    },
    'peakDailyTokens': snapshot.summary['peakDailyTokens'],
    'currentStreakDays': snapshot.summary['currentStreakDays'],
    'longestStreakDays': snapshot.summary['longestStreakDays'],
  };
  for (final period in ArenaPeriod.values) {
    final total = totalFor(snapshot, period, now);
    final name = period.name;
    result['${name}Tokens'] = total.complete ? total.tokens : null;
    result['${name}ObservedTokens'] = total.tokens;
    result['${name}Key'] = total.key;
    result['${name}Complete'] = total.complete;
    result['${name}ObservedDays'] = total.observedDays;
    result['${name}ExpectedDays'] = total.expectedDays;
  }
  return result;
}

List<String> representativeAchievements(
  UsageSnapshot s,
  Map<String, dynamic> profile,
) {
  final representatives = <String, AchievementProgress>{};
  for (final p in evaluateAchievements(
    s,
    nicknameSet: (profile['nickname'] as String? ?? '').isNotEmpty,
  )) {
    if (p.state == AchievementState.unlocked) {
      final key = '${p.definition.metric.name}/${p.definition.plan ?? ''}';
      representatives[key] = p;
    }
  }
  return representatives.values.take(5).map((p) => p.definition.id).toList();
}

class SyncSchedule {
  // Startup occupies the current slot. Missed slots are not replayed.
  static String slot(DateTime local) => '${dateKey(local)}-${local.hour ~/ 6}';
  String? lastSlot;
  bool shouldRun(DateTime local) => slot(local) != lastSlot;
  void mark(DateTime local) => lastSlot = slot(local);
}
