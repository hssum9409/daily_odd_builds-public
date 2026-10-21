import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'usage.dart';
import 'profile.dart';

class ArenaFailure implements Exception {
  const ArenaFailure(this.code);
  final String code;
  @override
  String toString() => code;
}

class FirebaseSession {
  FirebaseSession({
    required this.uid,
    required this.idToken,
    required this.refreshToken,
    DateTime? expiresAt,
  }) : expiresAt = expiresAt ?? DateTime.now().add(const Duration(minutes: 50));
  final String uid;
  String idToken;
  String refreshToken;
  DateTime expiresAt;
  Map<String, dynamic> toJson() => {
    'uid': uid,
    'idToken': idToken,
    'refreshToken': refreshToken,
    'expiresAt': expiresAt.toUtc().toIso8601String(),
  };
  factory FirebaseSession.fromJson(Map<String, dynamic> j) => FirebaseSession(
    uid: j['uid'],
    idToken: j['idToken'],
    refreshToken: j['refreshToken'],
    expiresAt: DateTime.parse(j['expiresAt']),
  );
  Future<String> token(http.Client client) async {
    if (DateTime.now().isBefore(expiresAt)) return idToken;
    final root = ArenaConfig.emulator
        ? 'http://127.0.0.1:9099/securetoken.googleapis.com'
        : 'https://securetoken.googleapis.com';
    final response = await client
        .post(
          Uri.parse('$root/v1/token?key=${ArenaConfig.apiKey}'),
          body: {'grant_type': 'refresh_token', 'refresh_token': refreshToken},
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw const ArenaFailure('arena-sign-in-required');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    if (data['user_id'] != uid) {
      throw const ArenaFailure('arena-sign-in-required');
    }
    idToken = data['id_token'];
    refreshToken = data['refresh_token'];
    expiresAt = DateTime.now().add(
      Duration(seconds: int.parse(data['expires_in']) - 120),
    );
    return idToken;
  }

  static Future<FirebaseSession> verify(
    Map<String, dynamic> input,
    http.Client client,
  ) async {
    if (input.keys.toSet().difference({
          'uid',
          'idToken',
          'refreshToken',
        }).isNotEmpty ||
        input.values.any((v) => v is! String)) {
      throw const ArenaFailure('invalid-connection');
    }
    final root = ArenaConfig.emulator
        ? 'http://127.0.0.1:9099/identitytoolkit.googleapis.com'
        : 'https://identitytoolkit.googleapis.com';
    final response = await client
        .post(
          Uri.parse('$root/v1/accounts:lookup?key=${ArenaConfig.apiKey}'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'idToken': input['idToken']}),
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw const ArenaFailure('invalid-connection');
    }
    final users = (jsonDecode(response.body)['users'] as List?) ?? [];
    if (users.length != 1 ||
        users.first['localId'] != input['uid'] ||
        !(users.first['providerUserInfo'] as List? ?? []).any(
          (p) => p['providerId'] == 'google.com',
        )) {
      throw const ArenaFailure('invalid-connection');
    }
    return FirebaseSession(
      uid: input['uid'],
      idToken: input['idToken'],
      refreshToken: input['refreshToken'],
    );
  }
}

Map<String, dynamic> encodeValue(Object? v) {
  if (v == null) return {'nullValue': null};
  if (v is DateTime) return {'timestampValue': v.toUtc().toIso8601String()};
  if (v is bool) return {'booleanValue': v};
  if (v is int) return {'integerValue': '$v'};
  if (v is num) return {'doubleValue': v};
  if (v is String) return {'stringValue': v};
  if (v is List) {
    return {
      'arrayValue': {'values': v.map(encodeValue).toList()},
    };
  }
  if (v is Map) {
    return {
      'mapValue': {
        'fields': v.map((k, v) => MapEntry(k.toString(), encodeValue(v))),
      },
    };
  }
  throw const FormatException('unsupported-field');
}

dynamic decodeValue(Map<String, dynamic> v) {
  if (v.containsKey('nullValue')) return null;
  if (v.containsKey('timestampValue')) {
    return DateTime.parse(v['timestampValue']);
  }
  if (v.containsKey('integerValue')) return int.parse(v['integerValue']);
  if (v.containsKey('doubleValue')) return v['doubleValue'];
  if (v.containsKey('booleanValue')) return v['booleanValue'];
  if (v.containsKey('stringValue')) return v['stringValue'];
  if (v.containsKey('arrayValue')) {
    return (v['arrayValue']['values'] as List? ?? [])
        .map((x) => decodeValue(Map<String, dynamic>.from(x)))
        .toList();
  }
  if (v.containsKey('mapValue')) {
    return (v['mapValue']['fields'] as Map<String, dynamic>? ?? {}).map(
      (k, v) => MapEntry(k, decodeValue(Map<String, dynamic>.from(v))),
    );
  }
  throw const FormatException('unsupported-field');
}

class ArenaDocument {
  const ArenaDocument(this.data, this.updateTime);
  final Map<String, dynamic> data;
  final String updateTime;
}

class ArenaRepository {
  ArenaRepository({
    required this.tokenProvider,
    this.uid,
    this.apiEndpoint,
    http.Client? client,
  }) : client = client ?? http.Client();
  final Future<String?> Function() tokenProvider;
  final String? uid;
  final String? apiEndpoint;
  final http.Client client;
  String get base =>
      '${ArenaConfig.emulator ? 'http://127.0.0.1:8788' : 'https://firestore.googleapis.com'}/v1/projects/${ArenaConfig.projectId}/databases/(default)/documents';
  String name(String path) =>
      'projects/${ArenaConfig.projectId}/databases/(default)/documents/$path';
  Future<http.Response> _request(
    String method,
    String path, [
    Object? body,
  ]) async {
    final token = await tokenProvider();
    final request = http.Request(method, Uri.parse('$base$path'));
    request.headers['Content-Type'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) request.body = jsonEncode(body);
    final http.Response response;
    try {
      response = await http.Response.fromStream(await client.send(request))
          .timeout(const Duration(seconds: 25));
    } on http.ClientException {
      throw const ArenaFailure('network-error');
    } on TimeoutException {
      throw const ArenaFailure('network-error');
    }
    if (response.statusCode >= 400 && response.statusCode != 404) {
      throw ArenaFailure(switch (response.statusCode) {
        401 => 'arena-sign-in-required',
        403 => 'permission-or-cooldown',
        409 => 'sync-conflict',
        429 => 'quota-exceeded',
        _ => 'network-error',
      });
    }
    return response;
  }

  Future<ArenaDocument?> read(String path) async {
    final r = await _request('GET', '/$path');
    if (r.statusCode == 404) return null;
    final j = jsonDecode(r.body) as Map<String, dynamic>;
    return ArenaDocument(
      (j['fields'] as Map<String, dynamic>? ?? {}).map(
        (k, v) => MapEntry(k, decodeValue(Map<String, dynamic>.from(v))),
      ),
      j['updateTime'],
    );
  }

  Map<String, dynamic> _write(
    String path,
    Map<String, dynamic> values, {
    ArenaDocument? previous,
    List<String> timestamps = const [],
  }) => {
    'update': {
      'name': name(path),
      'fields': values.map((k, v) => MapEntry(k, encodeValue(v))),
    },
    'currentDocument': previous == null
        ? {'exists': false}
        : {'updateTime': previous.updateTime},
    if (timestamps.isNotEmpty)
      'updateTransforms': [
        for (final field in timestamps)
          {'fieldPath': field, 'setToServerValue': 'REQUEST_TIME'},
      ],
  };
  Future<void> _commit(List<Map<String, dynamic>> writes) async {
    await _request('POST', ':commit', {'writes': writes});
  }

  Future<Map<String, dynamic>?> profile() =>
      read('users/$uid').then((d) => d?.data);
  Future<UsageSnapshot?> privateUsage() async {
    final doc = await personalSnapshot();
    return doc == null
        ? null
        : UsageSnapshot.fromJson(doc.data['usage'] as Map<String, dynamic>);
  }

  // Only requested for the signed-in owner's profile. Rankings stay batch-cached.
  Future<ArenaDocument?> personalSnapshot() async {
    var saved = await read('users/$uid/private/snapshot');
    if (ArenaConfig.effectiveDatabaseUrl.isEmpty) return saved;
    final token = await tokenProvider();
    if (token == null) throw const ArenaFailure('arena-sign-in-required');
    final root = ArenaConfig.emulator
        ? 'http://127.0.0.1:9004'
        : ArenaConfig.effectiveDatabaseUrl;
    final uri = Uri.parse('$root/ingest/$uid.json').replace(
      queryParameters: {
        'auth': token,
        if (ArenaConfig.emulator) 'ns': '${ArenaConfig.projectId}-default-rtdb',
      },
    );
    final response = await client.get(uri).timeout(const Duration(seconds: 25));
    if (response.statusCode != 200) throw const ArenaFailure('network-error');
    final live = jsonDecode(response.body);
    if (live is! Map ||
        live['head'] is! Map ||
        live['head']['fetchedAt'] == null) {
      return saved;
    }
    if (saved != null &&
        saved.data['fastEpoch'] == live['epoch'] &&
        (saved.data['fastRevision'] as num? ?? 0) <
            (live['flushedRevision'] as num? ?? 0)) {
      saved = await read('users/$uid/private/snapshot');
    }
    return ArenaDocument(
      mergeLiveUsage(saved?.data, Map<String, dynamic>.from(live)),
      saved?.updateTime ?? '',
    );
  }

  static Map<String, dynamic> mergeLiveUsage(
    Map<String, dynamic>? saved,
    Map<String, dynamic> live,
  ) {
    final head = Map<String, dynamic>.from(live['head'] ?? {});
    if (head['fetchedAt'] == null) return saved ?? {};
    final Map? old = saved != null && saved['sourceId'] == live['sourceId']
        ? saved['usage'] as Map?
        : null;
    return {
      ...?saved,
      'sourceId': live['sourceId'],
      'uploadedAt': live['uploadedAt'],
      'usage': {
        ...head,
        'summary': Map<String, dynamic>.from(head['summary'] ?? {}),
        'daily': <String, dynamic>{
          ...?(old?['daily'] as Map?),
          ...?((live['pending'] as Map?)?['daily'] as Map?),
        },
        'observations': Map<String, dynamic>.from(head['observations'] ?? {}),
        'rateLimits': Map<String, dynamic>.from(head['rateLimits'] ?? {}),
      },
    };
  }

  Future<Map<String, dynamic>> api(
    String action, [
    Map<String, dynamic> body = const {},
  ]) async {
    final root = apiEndpoint ?? ArenaConfig.effectiveApiUrl;
    if (root.isEmpty) throw const ArenaFailure('backend-not-configured');
    final uri = Uri.parse('$root/v1/$action');
    if (uri.scheme != 'https' &&
        !(ArenaConfig.emulator &&
            uri.scheme == 'http' &&
            ['127.0.0.1', 'localhost'].contains(uri.host))) {
      throw const ArenaFailure('configuration');
    }
    final token = await tokenProvider();
    if (token == null) throw const ArenaFailure('arena-sign-in-required');
    http.Response r;
    try {
      r = await client
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 120));
    } on http.ClientException {
      throw const ArenaFailure('network-error');
    } on TimeoutException {
      throw const ArenaFailure('network-error');
    }
    final json = jsonDecode(r.body) as Map<String, dynamic>;
    if (r.statusCode != 200) {
      throw ArenaFailure(json['error'] as String? ?? 'server-unavailable');
    }
    return json;
  }

  Future<void> saveProfile({
    required String nickname,
    required String locale,
    required bool isPublic,
    String declaredPlan = 'unknown',
    ProfileCustomization? customization,
  }) async {
    if (uid == null) throw const ArenaFailure('arena-sign-in-required');
    final old = customization == null ? await profile() : null;
    final normalizedLocale = locale.startsWith('zh')
        ? 'zh_CN'
        : locale.split('_').first;
    await api('profile', {
      'nickname': normalizeNickname(nickname),
      'locale': normalizedLocale,
      'isPublic': isPublic,
      'declaredPlan': declaredPlan,
      ...(customization ?? ProfileCustomization.fromProfile(old)).toJson(),
    });
  }

  Future<bool> upload(
    UsageSnapshot snapshot, {
    required String sourceId,
    required Map<String, dynamic> proof,
    bool resetSource = false,
  }) async {
    final nonce = (await api('challenge'))['nonce'];
    final body = {
      'nonce': nonce,
      'sourceId': sourceId,
      'proof': proof,
      'usage': snapshot.toJson(),
      'resetSource': resetSource,
    };
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        return (await api('submit', body))['changed'] == true;
      } on ArenaFailure catch (e) {
        if (![
              'network-error',
              'server-unavailable',
              'publication-busy',
            ].contains(e.code) ||
            attempt == 2) {
          rethrow;
        }
        await Future<void>.delayed(Duration(seconds: 1 << attempt));
      }
    }
    return false;
  }

  Future<void> deleteData() async {
    await api('delete');
  }

  Future<void> report(String subject, String reason) async {
    if (uid == null || subject == uid || reason.length > 200) {
      throw const ArenaFailure('invalid-report');
    }
    await _commit([
      _write(
        'reports/${uid}_$subject',
        {'reporter': uid, 'subject': subject, 'reason': reason},
        timestamps: ['createdAt'],
      ),
    ]);
  }

  void close() => client.close();
}
