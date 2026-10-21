import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'runtime.dart';

bool validVersion(String s) =>
    RegExp(r'^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$')
        .hasMatch(s);
int compareVersions(String a, String b) {
  if (!validVersion(a) || !validVersion(b)) {
    throw const FormatException('invalid-version');
  }
  final x = a.split('.').map(int.parse).toList(),
      y = b.split('.').map(int.parse).toList();
  for (var i = 0; i < 3; i++) {
    final d = x[i].compareTo(y[i]);
    if (d != 0) return d;
  }
  return 0;
}

class Release {
  Release(this.version, this.asset, this.checksum);
  final String version;
  final Map<String, dynamic> asset, checksum;
}

String get nativeAsset {
  final arch = Platform.version.contains('arm64') ? 'arm64' : 'x64';
  return 'token-scale-${Platform.isWindows ? 'windows' : 'macos'}-$arch${Platform.isWindows ? '.exe' : ''}';
}

Release? selectRelease(List<dynamic> list, String current, String assetName) {
  final choices = <Release>[];
  for (final item in list.whereType<Map>()) {
    if (item['draft'] != false || item['prerelease'] != false) continue;
    final match = RegExp(r'^day004-cli-v(.+)$')
        .firstMatch(item['tag_name'] as String? ?? '');
    if (match == null ||
        !validVersion(match[1]!) ||
        compareVersions(match[1]!, current) <= 0) {
      continue;
    }
    final assets = (item['assets'] as List? ?? []).whereType<Map>();
    final binary = assets.where((a) => a['name'] == assetName).toList();
    final sums = assets.where((a) => a['name'] == 'SHA256SUMS.txt').toList();
    if (binary.length != 1 || sums.length != 1) continue;
    var valid = true;
    for (final a in [binary.single, sums.single]) {
      final uri = Uri.tryParse(a['browser_download_url'] as String? ?? '');
      if (uri == null ||
          uri.scheme != 'https' ||
          uri.host != 'github.com' ||
          uri.hasQuery ||
          uri.path !=
              '/$releaseRepo/releases/download/${item['tag_name']}/${a['name']}' ||
          a['state'] != 'uploaded' ||
          a['size'] is! int ||
          (a['size'] as int) <= 0 ||
          !RegExp(r'^sha256:[0-9a-f]{64}$')
              .hasMatch(a['digest'] as String? ?? '')) {
        valid = false;
      }
    }
    if (!valid ||
        (binary.single['size'] as int) > 75000000 ||
        (sums.single['size'] as int) > 65536) {
      continue;
    }
    choices.add(
      Release(
        match[1]!,
        Map<String, dynamic>.from(binary.single),
        Map<String, dynamic>.from(sums.single),
      ),
    );
  }
  choices.sort((a, b) => compareVersions(b.version, a.version));
  return choices.isEmpty ? null : choices.first;
}

bool nativeHeader(List<int> data, bool windows) {
  if (data.length < 256) return false;
  if (windows) {
    if (data[0] != 0x4d || data[1] != 0x5a) return false;
    final offset =
        data[60] | (data[61] << 8) | (data[62] << 16) | (data[63] << 24);
    return offset >= 64 &&
        offset + 6 < data.length &&
        data[offset] == 0x50 &&
        data[offset + 1] == 0x45 &&
        data[offset + 2] == 0 &&
        data[offset + 3] == 0 &&
        data[offset + 4] == 0x64 &&
        data[offset + 5] == 0x86;
  }
  final magic = data
      .take(4)
      .map((x) => x.toRadixString(16).padLeft(2, '0'))
      .join();
  return ['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'].contains(magic);
}

bool aotHeader(List<int> data) =>
    data.length >= 256 &&
    data[0] == 0x7f &&
    data[1] == 0x45 &&
    data[2] == 0x4c &&
    data[3] == 0x46 &&
    data[4] == 2 &&
    data[5] == 1 &&
    data[18] == 0x3e &&
    data[19] == 0;

class Updater {
  Updater(this.root, this.home, this.client);
  final Directory root, home;
  final http.Client client;
  bool get snapshotMode =>
      Platform.isWindows &&
      File('${root.path}/runtime-mode').existsSync() &&
      File('${root.path}/runtime-mode').readAsStringSync().trim() == 'aot';
  String get assetName =>
      snapshotMode ? 'token-scale-windows-x64.aot' : nativeAsset;
  Future<List<int>> download(Map<String, dynamic> asset) async {
    var uri = Uri.parse(asset['browser_download_url'] as String);
    for (var hop = 0; hop < 6; hop++) {
      if (uri.scheme != 'https' ||
          !{
            'github.com',
            'release-assets.githubusercontent.com',
            'objects.githubusercontent.com',
          }.contains(uri.host)) {
        throw const FormatException('unsafe-download');
      }
      final request = http.Request('GET', uri)..followRedirects = false;
      request.headers['User-Agent'] = 'TokenScale/$collectorVersion';
      final response = await client
          .send(request)
          .timeout(const Duration(seconds: 30));
      if ([301, 302, 303, 307, 308].contains(response.statusCode)) {
        await response.stream.drain<void>();
        final location = response.headers['location'];
        if (location == null) throw const FormatException('invalid-download');
        uri = uri.resolve(location);
        continue;
      }
      if (response.statusCode != 200) {
        await response.stream.drain<void>();
        throw const FormatException('download-unavailable');
      }
      final size = asset['size'] as int, bytes = <int>[];
      await for (final chunk in response.stream.timeout(
        const Duration(seconds: 30),
      )) {
        if (bytes.length + chunk.length > size) {
          throw const FormatException('download-size');
        }
        bytes.addAll(chunk);
      }
      if (bytes.length != size ||
          'sha256:${sha256.convert(bytes)}' != asset['digest']) {
        throw const FormatException('download-checksum');
      }
      return bytes;
    }
    throw const FormatException('download-redirects');
  }

  Future<bool> check({bool force = false}) async {
    final cacheFile = File('${home.path}/updates.json'),
        cache = await readJson(cacheFile);
    final now = DateTime.now().toUtc();
    final next = DateTime.tryParse(cache['nextCheck'] as String? ?? '');
    // A manual check respects GitHub's Retry-After/rate limit reset too.
    if (next != null &&
        now.isBefore(next) &&
        (!force || cache['rateLimited'] == true)) {
      return false;
    }
    cache['nextCheck'] = now.add(const Duration(hours: 6)).toIso8601String();
    cache['rateLimited'] = false;
    await atomicText(cacheFile, jsonEncode(cache));
    final all = <dynamic>[];
    for (var page = 1; page <= 5; page++) {
      final response = await client
          .get(
            Uri.https('api.github.com', '/repos/$releaseRepo/releases', {
              'per_page': '100',
              'page': '$page',
            }),
            headers: {
              'User-Agent': 'TokenScale/$collectorVersion',
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              if (page == 1 && cache['etag'] is String)
                'If-None-Match': cache['etag'] as String,
            },
          )
          .timeout(const Duration(seconds: 30));
      if (response.statusCode == 403 || response.statusCode == 429) {
        final seconds =
            int.tryParse(response.headers['retry-after'] ?? '') ?? 3600;
        final reset = int.tryParse(response.headers['x-ratelimit-reset'] ?? '');
        final until = now.add(Duration(seconds: seconds.clamp(60, 86400)));
        final resetAt = reset == null
            ? until
            : DateTime.fromMillisecondsSinceEpoch(reset * 1000, isUtc: true);
        cache['nextCheck'] = (resetAt.isAfter(until) ? resetAt : until)
            .toIso8601String();
        cache['rateLimited'] = true;
        await atomicText(cacheFile, jsonEncode(cache));
        return false;
      }
      if (response.statusCode == 304) {
        // Previous failed downloads may retry, without refetching the release list.
        all.addAll(cache['releases'] as List? ?? []);
        break;
      }
      if (response.statusCode != 200 || response.bodyBytes.length > 3000000) {
        throw const FormatException('update-feed-unavailable');
      }
      final list = jsonDecode(response.body) as List;
      all.addAll(list);
      if (page == 1) cache['etag'] = response.headers['etag'];
      if (list.length < 100) break;
    }
    cache['releases'] = all;
    await atomicText(cacheFile, jsonEncode(cache));
    final pointer = File('${root.path}/current.txt');
    final current = await pointer.exists()
        ? (await pointer.readAsString()).trim()
        : collectorVersion;
    if (!validVersion(current)) throw const FormatException('invalid-version');
    final release = selectRelease(all, current, assetName);
    if (release == null) return false;
    final blocked = await readJson(File('${root.path}/blocked-update.json'));
    if (blocked['version'] == release.version) return false;
    final sums = utf8.decode(await download(release.checksum));
    final entries = sums
        .split('\n')
        .where(
          (line) => RegExp(
            r'^([0-9a-f]{64}) [ *]' + RegExp.escape(assetName) + r'\r?$',
          ).hasMatch(line),
        )
        .toList();
    if (entries.length != 1 ||
        'sha256:${entries.single.substring(0, 64)}' !=
            release.asset['digest']) {
      throw const FormatException('checksum-manifest');
    }
    final bytes = await download(release.asset);
    if (!(snapshotMode
        ? aotHeader(bytes)
        : nativeHeader(bytes, Platform.isWindows))) {
      throw const FormatException('invalid-executable');
    }
    final dir = Directory('${root.path}/versions/${release.version}');
    await dir.create(recursive: true);
    final executable = File(
      '${dir.path}/token-scale${snapshotMode
          ? '.aot'
          : Platform.isWindows
          ? '.exe'
          : ''}',
    );
    await atomicText(
      File('${dir.path}/sha256'),
      sha256.convert(bytes).toString(),
    );
    final staging = File('${executable.path}.download');
    await staging.writeAsBytes(bytes, flush: true);
    if (!Platform.isWindows) {
      if ((await Process.run('chmod', ['700', staging.path])).exitCode != 0) {
        throw const FormatException('update-permissions');
      }
    }
    await staging.rename(executable.path);
    // Nothing is installed until the candidate proves it can execute.
    final probe = await Process.run(
      snapshotMode
          ? '${root.path}/runtime/dartaotruntime.exe'
          : executable.path,
      [if (snapshotMode) executable.path, 'version'],
    ).timeout(const Duration(seconds: 20));
    if (probe.exitCode != 0 ||
        probe.stdout.toString().trim() != release.version) {
      throw const FormatException('update-probe');
    }
    await atomicText(File('${root.path}/previous.txt'), current);
    await atomicText(File('${root.path}/current.txt'), release.version);
    await EventLog(home).event('update-staged');
    return true; // Supervisor restarts and rolls back if readiness is not acknowledged.
  }
}
