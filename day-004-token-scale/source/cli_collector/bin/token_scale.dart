// CLI entry point intentionally lives outside Flutter apps in this workspace.
// ignore: avoid_relative_lib_imports
import '../lib/collector.dart';

Future<void> main(List<String> args) => runCollector(args);
