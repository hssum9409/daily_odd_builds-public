import 'dart:convert';
import 'dart:io';

import 'package:token_arena_core/token_arena_core.dart';

import 'runtime.dart';

const tokenPollInterval = Duration(seconds: 30);
const metadataPollInterval = Duration(hours: 1);

// Cache only allowlisted statistics and acknowledgements, never raw RPC results.
UsageSnapshot retainObserved(UsageSnapshot next, UsageSnapshot? previous) {
  if (previous == null || previous.accountKey != next.accountKey) return next;
  return UsageSnapshot(
    summary: next.summary,
    daily: next.merge(previous).daily,
    fetchedAt: next.fetchedAt,
    detectedPlan: next.detectedPlan,
    accountKey: next.accountKey,
    observations: {...previous.observations, ...next.observations},
    rateLimits: {...previous.rateLimits, ...next.rateLimits},
  );
}

Map<String, dynamic>? usagePatch(UsageSnapshot next, UsageSnapshot? previous) {
  final summary = <String, dynamic>{
    for (final k in UsageSnapshot.metrics)
      if (previous == null || next.summary[k] != previous.summary[k])
        k: next.summary[k],
  };
  final daily = <String, dynamic>{
    for (final e in next.daily.entries)
      if (previous?.daily[e.key]?.tokens != e.value.tokens)
        e.key: e.value.toJson(),
  };
  final observations = <String, dynamic>{
    for (final e in next.observations.entries)
      if (previous == null ||
          !previous.observations.containsKey(e.key) ||
          previous.observations[e.key] != e.value)
        e.key: e.value,
  };
  Map<String, dynamic> meaningfulRates(UsageSnapshot? s) {
    final w = s?.rateLimits['weekly'];
    return w is Map
        ? {'usedPercent': w['usedPercent'], 'resetsAt': w['resetsAt']}
        : {};
  }

  final rateChanged =
      jsonEncode(meaningfulRates(next)) !=
      jsonEncode(meaningfulRates(previous));
  final patch = <String, dynamic>{
    if (summary.isNotEmpty) 'summary': summary,
    if (daily.isNotEmpty) 'daily': daily,
    if (previous == null || next.detectedPlan != previous.detectedPlan)
      'detectedPlan': next.detectedPlan,
    if (observations.isNotEmpty) 'observations': observations,
    if (rateChanged &&
        next.rateLimits['weekly'] is Map &&
        next.fetchedAt.difference(
              DateTime.parse(next.rateLimits['weekly']['observedAt']),
            ) <
            const Duration(days: 7))
      'rateLimits': next.rateLimits,
  };
  if (patch.isEmpty) return null;
  return {...patch, 'fetchedAt': next.fetchedAt.toUtc().toIso8601String()};
}

class StreamUploader {
  StreamUploader(this.file, this.repo);
  final File file;
  final ArenaRepository repo;

  Future<bool> upload(
    UsageSnapshot sample, {
    required String uid,
    required String sourceId,
    required Map<String, dynamic> proof,
    bool resetSource = false,
  }) async {
    // Serializes terminal sync and daemon sync, including the durable pending request.
    await file.parent.create(recursive: true);
    final lock = await File('${file.path}.lock').open(mode: FileMode.append);
    try {
      try {
        await lock.lock(FileLock.exclusive);
      } on FileSystemException {
        throw const ArenaFailure('collector-already-running');
      }
      var cache = await readJson(file);
      if (cache['uid'] != uid || cache['sourceId'] != sourceId || resetSource) {
        cache = {};
      }
      if (cache['pending'] != null) {
        final pending = Map<String, dynamic>.from(cache['pending']);
        try {
          final result = await repo.api(
            'stream-patch',
            Map<String, dynamic>.from(pending['body']),
          );
          cache = {
            ...cache,
            'sequence': result['sequence'],
            'usage': pending['usage'],
          }..remove('pending');
          await atomicText(file, jsonEncode(cache));
          return result['changed'] == true;
        } on ArenaFailure catch (e) {
          if (![
            'sync-conflict',
            'collector-connection-required',
            'stale-observation',
            'invalid-observation-time',
          ].contains(e.code)) {
            rethrow;
          }
          // Server reset or an expired observation: start from a full current sample.
          cache = {};
        }
      }
      UsageSnapshot? previous;
      if (cache['usage'] is Map) {
        previous = UsageSnapshot.fromJson(
          Map<String, dynamic>.from(cache['usage']),
        );
      }
      final next = retainObserved(sample, previous);
      var patch = usagePatch(next, previous);
      if (patch == null && cache['epoch'] != null) return false;
      if (cache['epoch'] == null) {
        final opened = await repo.api('stream-open', {
          'sourceId': sourceId,
          'proof': proof,
          'resetSource': resetSource,
        });
        cache = {
          'uid': uid,
          'sourceId': sourceId,
          'epoch': opened['epoch'],
          'sequence': opened['sequence'],
        };
        patch = usagePatch(next, null)!;
      }
      final body = {
        'sourceId': sourceId,
        'epoch': cache['epoch'],
        'sequence': (cache['sequence'] as int) + 1,
        'patch': patch,
      };
      cache['pending'] = {'body': body, 'usage': next.toJson(local: true)};
      // Persist before send: response loss and process restart reuse the exact sequence/body.
      await atomicText(file, jsonEncode(cache));
      final result = await repo.api('stream-patch', body);
      cache = {
        ...cache,
        'sequence': result['sequence'],
        'usage': next.toJson(local: true),
      }..remove('pending');
      await atomicText(file, jsonEncode(cache));
      return result['changed'] == true;
    } finally {
      try {
        await lock.unlock();
      } finally {
        await lock.close();
      }
    }
  }
}
