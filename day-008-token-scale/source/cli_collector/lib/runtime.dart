import 'dart:async';
import 'dart:convert';
import 'dart:io';

const collectorVersion = String.fromEnvironment(
  'COLLECTOR_VERSION',
  defaultValue: '0.4.0',
);
const productId = 'DailyOddBuilds.TokenScale';
const releaseRepo = 'hssum9409/daily_odd_builds-public';

String? option(List<String> args, String name) {
  final index = args.indexOf(name);
  if (index < 0) return null;
  if (index + 1 == args.length) throw FormatException('missing-$name');
  return args[index + 1];
}

Future<void> atomicText(File file, String text) async {
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.$pid.tmp');
  await tmp.writeAsString(text, flush: true);
  if (!Platform.isWindows) await Process.run('chmod', ['600', tmp.path]);
  await tmp.rename(file.path);
}

Future<Map<String, dynamic>> readJson(File file) async => await file.exists()
    ? Map<String, dynamic>.from(jsonDecode(await file.readAsString()) as Map)
    : {};

// Only fixed event codes go to disk. Never exception payloads, account names,
// usage, paths, tokens, pairing URLs or HTTP bodies.
class EventLog {
  EventLog(this.home);
  final Directory home;
  Future<void> event(String code) async {
    if (!RegExp(r'^[a-z0-9-]{1,80}$').hasMatch(code)) code = 'collector-failed';
    await home.create(recursive: true);
    final file = File('${home.path}/collector.log');
    if (await file.exists() && await file.length() > 262144) {
      final old = File('${file.path}.1');
      if (await old.exists()) await old.delete();
      await file.rename(old.path);
    }
    await file.writeAsString(
      '${DateTime.now().toUtc().toIso8601String()} $code\n',
      mode: FileMode.append,
    );
    if (!Platform.isWindows) await Process.run('chmod', ['600', file.path]);
  }
}

Directory installRoot(List<String> args) {
  final path = option(args, '--install-root');
  if (path == null) throw const FormatException('installation-required');
  final root = Directory(path).absolute;
  final marker = File('${root.path}/product-id');
  if (!marker.existsSync() || marker.readAsStringSync().trim() != productId) {
    throw const FormatException('invalid-installation');
  }
  return root;
}

Future<void> stopInstallation(Directory root) async {
  await File('${root.path}/stop').writeAsString('stop', flush: true);
  final deadline = DateTime.now().add(const Duration(seconds: 90));
  while (await File('${root.path}/host-active').exists()) {
    if (DateTime.now().isAfter(deadline)) {
      throw const FormatException('stop-timeout');
    }
    await Future<void>.delayed(const Duration(milliseconds: 200));
  }
}

class WorkerLease {
  WorkerLease._(this.file);
  final RandomAccessFile file;
  static Future<WorkerLease?> acquire(Directory home) async {
    await home.create(recursive: true);
    final file = await File('${home.path}/worker.lock')
        .open(mode: FileMode.append);
    try {
      await file.lock(FileLock.exclusive);
      return WorkerLease._(file);
    } on FileSystemException {
      await file.close();
      return null;
    }
  }

  Future<void> close() async {
    await file.unlock();
    await file.close();
  }
}

class RetryPolicy {
  int failures = 0;
  Duration failed() {
    failures++;
    return Duration(seconds: 60 * (1 << (failures - 1).clamp(0, 6)));
  }

  void success() => failures = 0;
}

Future<void> cleanupManagedVersions(Directory root) async {
  final versions = Directory('${root.path}/versions');
  if (!await versions.exists()) return;
  final canonical = await versions.resolveSymbolicLinks();
  final prefix = '$canonical${Platform.pathSeparator}';
  final keep = <String>{};
  for (final name in ['current.txt', 'previous.txt']) {
    final file = File('${root.path}/$name');
    if (await file.exists()) keep.add((await file.readAsString()).trim());
  }
  final blocked = await readJson(File('${root.path}/blocked-update.json'));
  if (blocked['version'] is String) keep.add(blocked['version'] as String);
  await for (final entity in versions.list(followLinks: false)) {
    if (entity is! Directory) continue;
    final name = entity.uri.pathSegments.where((s) => s.isNotEmpty).last;
    if (keep.contains(name) || !RegExp(r'^\d+\.\d+\.\d+$').hasMatch(name)) {
      continue;
    }
    final path = await entity.resolveSymbolicLinks();
    final inside = Platform.isWindows
        ? path.toLowerCase().startsWith(prefix.toLowerCase())
        : path.startsWith(prefix);
    if (!inside) continue;
    for (final name in [
      'token-scale.exe',
      'token-scale.aot',
      'token-scale.aot.download',
      'token-scale',
      'collector.dill',
      'sha256',
    ]) {
      final file = File('$path${Platform.pathSeparator}$name');
      if (await FileSystemEntity.type(file.path, followLinks: false) ==
          FileSystemEntityType.file) {
        await file.delete();
      }
    }
    // Never recursively delete computed paths or remove unexpected user files.
    if (await entity.list().isEmpty) await entity.delete();
  }
}
