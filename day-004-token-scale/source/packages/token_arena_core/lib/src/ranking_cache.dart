import 'dart:convert';

import 'arena_repository.dart';
import 'usage.dart';

/// Only public top-50 snapshots persist. Personal summaries stay in memory.
abstract interface class RankingCache {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> clear();
}

class MemoryRankingCache implements RankingCache {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> clear() async => values.clear();
}

class RankingReader {
  RankingReader(this.repository, this.cache);
  final ArenaRepository repository;
  final RankingCache cache;
  static final pending = <String, Future<List<Map<String, dynamic>>>>{};
  Future<List<Map<String, dynamic>>> read(
    Map<String, dynamic> meta,
    ArenaPeriod period,
    String plan,
  ) async {
    final batchId = meta['batchId'] as String;
    if (!RegExp(r'^[A-Za-z0-9TZ]+$').hasMatch(batchId) ||
        !['all', ...detectedPlans, 'pro_5x', 'pro_20x'].contains(plan)) {
      throw const ArenaFailure('invalid-ranking');
    }
    final key = '${repository.base}/$batchId/${meta['revision']}/${period.name}/$plan';
    final stored = await cache.read(key);
    if (stored != null) return _rows(stored);
    return pending.putIfAbsent(key, () async {
      try {
        final doc = await repository.read(
          'rankingSnapshots/${batchId}_${period.name}_$plan',
        );
        final rows = doc?.data['rows'] as List? ?? [];
        if (doc != null) await cache.write(key, jsonEncode(rows));
        return rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      } finally {
        pending.remove(key);
      }
    });
  }

  List<Map<String, dynamic>> _rows(String json) => (jsonDecode(json) as List)
      .map((r) => Map<String, dynamic>.from(r as Map))
      .toList();
}
