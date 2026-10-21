import 'dart:convert';

import 'package:test/test.dart';
import 'package:token_arena_core/token_arena_core.dart';

void main() {
  test('legacy profiles render defaults without needing a migration', () {
    final p = ProfileCustomization.fromProfile({'nickname': 'Fixture'});
    expect(p.avatar.shape, 'round');
    expect(p.bio, '');
    expect(p.githubUrl, isNull);
  });
  test('avatar round-trips IDs and canonical colors without files', () {
    final a = const AvatarSpec().copyWith(
      shape: 'flame',
      eyes: 'star',
      accessory: 'crown',
      body: '#abcdef',
    );
    expect(AvatarSpec.fromJson(a.toJson()).toJson(), a.toJson());
    expect(a.body, '#ABCDEF');
    expect(utf8.encode(jsonEncode(a.toJson())).length, lessThan(180));
  });
  test('avatar rejects unexpected assets, URLs, keys, versions and colors', () {
    for (final patch in [
      {'url': 'https://example.invalid/avatar'},
      {'v': 2},
      {'shape': 'remote'},
      {'eyes': 'script'},
      {'body': '#123'},
      {'accent': 'red'},
      {'background': '#FFFFFFFF'},
    ]) {
      expect(
        () => AvatarSpec.fromJson({...const AvatarSpec().toJson(), ...patch}),
        throwsFormatException,
      );
    }
    expect(() => AvatarSpec.fromJson({'v': 1}), throwsFormatException);
  });
  test('bio accepts four languages and respects server UTF16 limit', () {
    expect(normalizeBio('  안녕 hello 你好 こんにちは  '), '안녕 hello 你好 こんにちは');
    expect(normalizeBio('😀' * 50).length, 100);
    expect(() => normalizeBio('😀' * 51), throwsFormatException);
    for (final value in ['<script>', 'line\nbreak', 'bad\u007f']) {
      expect(() => normalizeBio(value), throwsFormatException);
    }
  });
  test('GitHub stores username only and constructs a fixed HTTPS host', () {
    expect(normalizeGithub(' https://github.com/Octocat/ '), 'Octocat');
    expect(
      const ProfileCustomization(github: 'octocat').githubUrl.toString(),
      'https://github.com/octocat',
    );
    expect(normalizeGithub(''), '');
  });
  test(
    'GitHub rejects arbitrary redirects, credentials, query and path injection',
    () {
      for (final value in [
        'javascript:alert(1)',
        'https://evil.invalid/octocat',
        'https://github.com.evil.invalid/x',
        'https://github.com/a/b',
        'https://github.com/a?tab=repositories',
        'https://user@github.com/a',
        'https://github.com:8443/a',
        '-abc',
        'abc--def',
        'a' * 40,
      ]) {
        expect(
          () => normalizeGithub(value),
          throwsFormatException,
          reason: value,
        );
      }
    },
  );
  test('public projection copies only chosen customization fields', () {
    final s = UsageSnapshot.fromApi(
      {
        'summary': {'lifetimeTokens': 0},
      },
      fetchedAt: DateTime.utc(2026, 10, 11),
      accountKey: 'fixture',
    );
    final profile = {
      'nickname': 'Fixture',
      ...const ProfileCustomization(
        bio: 'Synthetic profile',
        github: 'octocat',
      ).toJson(),
      'email': 'private@example.invalid',
    };
    final p = publicProjection(
      'fixture',
      profile,
      s,
      DateTime.utc(2026, 10, 11),
    );
    expect(p['avatar'], profile['avatar']);
    expect(p['bio'], 'Synthetic profile');
    expect(p['github'], 'octocat');
    expect(p.containsKey('email'), false);
  });
}
