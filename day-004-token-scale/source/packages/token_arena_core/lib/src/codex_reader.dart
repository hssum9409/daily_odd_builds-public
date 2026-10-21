// This file is only imported by the Windows collector/tool. The web never calls it.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

import 'usage.dart';

class CodexFailure implements Exception {
  const CodexFailure(this.code);
  final String code;
  @override
  String toString() => code;
}

class CodexReader {
  CodexReader({this.executable = 'codex'});
  final String executable;
  Process? _process;
  final _pending = <int, Completer<Map<String, dynamic>>>{};
  int _id = 0;
  String version = 'installed';
  final methods = <String>[];
  Map<String, dynamic> get proof => {
    'transport': 'stdio',
    'version': version,
    'methods': methods,
  };
  Future<Map<String, dynamic>> _call(
    String method, [
    Map<String, dynamic>? params,
    Duration timeout = const Duration(seconds: 35),
  ]) async {
    final id = ++_id;
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    _process!.stdin.writeln(
      jsonEncode({'id': id, 'method': method, 'params': ?params}),
    );
    try {
      final result = await completer.future.timeout(timeout);
      methods.add(method);
      return result;
    } on TimeoutException {
      throw const CodexFailure('codex-timeout');
    } finally {
      _pending.remove(id);
    }
  }

  Future<UsageSnapshot> fetch() async {
    try {
      methods.clear();
      final detected = await Process.run(executable, [
        '--version',
      ]).timeout(const Duration(seconds: 10));
      final label = detected.stdout.toString().trim();
      if (detected.exitCode != 0 ||
          !RegExp(r'^[\w.+ -]{1,80}$').hasMatch(label)) {
        throw const CodexFailure('codex-version-invalid');
      }
      version = label;
      _process = await Process.start(executable, [
        'app-server',
        '--listen',
        'stdio://',
        '-c',
        'analytics.enabled=false',
      ], runInShell: false);
      _process!.stderr
          .drain<void>(); // Never log raw diagnostics/auth/account payloads.
      _process!.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            try {
              final data = jsonDecode(line) as Map<String, dynamic>;
              final id = data['id'];
              if (id is int &&
                  _pending.containsKey(id) &&
                  !_pending[id]!.isCompleted) {
                if (data.containsKey('error')) {
                  _pending[id]!.completeError(
                    const CodexFailure('codex-request-failed'),
                  );
                } else {
                  _pending[id]!.complete(
                    Map<String, dynamic>.from(data['result'] as Map),
                  );
                }
              } else if (data.containsKey('id') && data.containsKey('method')) {
                // Refuse any unexpected server request; no tools, inference, or credential handoff.
                _process?.stdin.writeln(
                  jsonEncode({
                    'id': id,
                    'error': {'code': -32601, 'message': 'Read-only collector'},
                  }),
                );
              }
            } catch (_) {
              /* Ignore non-protocol lines without exposing them. */
            }
          });
      await _call('initialize', {
        'clientInfo': {
          'name': 'token_arena_collector',
          'title': 'Token Scale Is All You Need',
          'version': '0.1.0',
        },
        'capabilities': {'experimentalApi': true},
      });
      _process!.stdin.writeln('{"method":"initialized"}');
      final account = await _call('account/read', {'refreshToken': false});
      final a = account['account'] as Map<String, dynamic>?;
      if (a == null || a['type'] != 'chatgpt') {
        throw const CodexFailure('codex-sign-in-required');
      }
      // A local-only fingerprint detects account switches without storing the email.
      final identity = a['chatgptAccountId'] ?? a['email'];
      final key = identity is String
          ? sha256.convert(utf8.encode(identity)).toString()
          : '';
      final usage = await _call('account/usage/read');
      final rates = <String, dynamic>{};
      final observations = <String, int?>{};
      try {
        final raw = await _call('account/rateLimits/read');
        final credits = raw['rateLimitResetCredits'];
        if (credits is Map) {
          final count = metric(credits['availableCount']);
          if (count != null && count <= 10000) {
            observations['availableResetCredits'] = count;
          }
        }
        final r = raw['rateLimits'] as Map<String, dynamic>?;
        for (final window in ['primary', 'secondary']) {
          final value = r?[window] as Map<String, dynamic>?;
          if (value?['windowDurationMins'] == 10080 &&
              value?['usedPercent'] is num) {
            rates['weekly'] = {
              'usedPercent': value!['usedPercent'],
              'windowDurationMins': 10080,
              'resetsAt': value['resetsAt'],
              'observedAt': DateTime.now().toUtc().toIso8601String(),
            };
          }
        }
      } catch (_) {
        /* Rate limits are optional and never imply token activity. */
      }
      // Optional inventories: availability, never historical skill invocations.
      // plugin/list is intentionally excluded (documented as under development).
      try {
        final raw = await _call('skills/list', {
          'forceReload': false,
        }, const Duration(seconds: 10));
        final data = raw['data'];
        if (data is List &&
            data.every(
              (e) =>
                  e is Map &&
                  e['errors'] is List &&
                  (e['errors'] as List).isEmpty &&
                  e['skills'] is List,
            )) {
          final identities = <String>{};
          for (final e in data) {
            for (final skill in e['skills'] as List) {
              if (skill is Map &&
                  skill['enabled'] == true &&
                  skill['path'] is String) {
                identities.add(skill['path']);
              }
            }
          }
          if (identities.length <= 10000) {
            observations['enabledSkills'] = identities.length;
          }
        }
      } catch (_) {
        /* An unsupported route stays unknown. */
      }
      try {
        final raw = await _call(
          'app/installed',
          {},
          const Duration(seconds: 10),
        );
        final apps = raw['apps'];
        if (apps is List &&
            apps.every((a) => a is Map && a['callable'] is bool)) {
          final count = apps.where((a) => a['callable'] == true).length;
          if (count <= 10000) observations['callableApps'] = count;
        }
      } catch (_) {
        /* Optional inventory, never block token statistics. */
      }
      return UsageSnapshot.fromApi(
        usage,
        fetchedAt: DateTime.now().toUtc(),
        detectedPlan: a['planType'] as String? ?? 'unknown',
        accountKey: key,
        rateLimits: rates,
        observations: observations,
      );
    } on ProcessException {
      throw const CodexFailure('codex-not-found');
    } finally {
      final child = _process;
      _process = null;
      if (child != null) {
        await child.stdin.close();
        child.kill();
        await child.exitCode.timeout(
          const Duration(seconds: 5),
          onTimeout: () {
            child.kill();
            return -1;
          },
        );
      }
    }
  }
}
