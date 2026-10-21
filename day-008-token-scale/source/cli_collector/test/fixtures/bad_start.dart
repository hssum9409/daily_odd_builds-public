import 'dart:io';

// Native or AOT fixture passes version probing, then deliberately fails readiness.
void main(List<String> args) {
  if (args.contains('version')) {
    stdout.writeln('0.2.2');
  } else {
    exitCode = 1;
  }
}
