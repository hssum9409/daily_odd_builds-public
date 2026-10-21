import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:token_arena_core/token_arena_core.dart';

void main() {
  test('profile changes go only through authenticated API, preserving customization', () async {
    final requests = <http.Request>[];
    final r = ArenaRepository(
      uid: 'fixture',
      apiEndpoint: 'https://fixture.invalid',
      tokenProvider: () async => 'fixture-token',
      client: MockClient((q) async {
        requests.add(q);
        if (q.method == 'GET') {
          return http.Response(
            jsonEncode({
              'fields': {
                'bio': encodeValue('Saved'),
                'github': encodeValue('octocat'),
              },
              'updateTime': '2026-10-10T12:00:00Z',
            }),
            200,
          );
        }
        return http.Response('{"saved":true}', 200);
      }),
    );
    addTearDown(r.close);
    await r.saveProfile(nickname: 'Renamed', locale: 'ko_KR', isPublic: false);
    final q = requests.last, body = jsonDecode(q.body);
    expect(q.url.path, '/v1/profile');
    expect(q.headers['Authorization'], 'Bearer fixture-token');
    expect(body['bio'], 'Saved');
    expect(body['github'], 'octocat');
    expect(body['locale'], 'ko');
    expect(requests.where((q) => q.url.path.endsWith(':commit')), isEmpty);
  });
  test('upload sends allowlisted data with challenge; local account identity is excluded', () async {
    final bodies = <Map>[];
    final r = ArenaRepository(
      uid: 'fixture',
      apiEndpoint: 'https://fixture.invalid',
      tokenProvider: () async => 'fixture',
      client: MockClient((q) async {
        bodies.add(jsonDecode(q.body) as Map);
        return http.Response(
          q.url.path.endsWith('/challenge')
              ? '{"nonce":"nonce"}'
              : '{"changed":true}',
          200,
        );
      }),
    );
    addTearDown(r.close);
    final u = UsageSnapshot.fromApi(
      {
        'summary': {'lifetimeTokens': 100},
      },
      fetchedAt: DateTime.now().toUtc(),
      accountKey: 'local-only',
    );
    await r.upload(
      u,
      sourceId: 'a' * 32,
      proof: {'transport': 'stdio', 'version': 'fixture', 'methods': []},
    );
    expect(bodies.last['nonce'], 'nonce');
    expect((bodies.last['usage'] as Map).containsKey('accountKey'), false);
    expect(bodies.last.containsKey('ranking'), false);
  });
  test(
    'server receipt error is preserved for quota and account-switch UI',
    () async {
      final r = ArenaRepository(
        apiEndpoint: 'https://fixture.invalid',
        tokenProvider: () async => 'fixture',
        client: MockClient(
          (_) async => http.Response('{"error":"daily-sync-limit"}', 429),
        ),
      );
      addTearDown(r.close);
      expect(
        () => r.api('challenge'),
        throwsA(
          isA<ArenaFailure>().having((e) => e.code, 'code', 'daily-sync-limit'),
        ),
      );
    },
  );
}
