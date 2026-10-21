ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  var packageRoot = argv[0];
  if (!packageRoot || packageRoot[0] !== '/') throw Error('invalid-package');
  var app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  app.activateIgnoringOtherApps(true);
  var consent = $.NSAlert.alloc.init;
  consent.messageText = $('Token Scale Is All You Need');
  consent.informativeText = $('Install a menu-bar daemon for this user? Enables login startup, 30-second local token checks, changed-only uploads and GitHub updates. OpenAI credentials stay on this Mac. Finish Google connection in the browser. Public rankings are opt-in on the website.');
  consent.addButtonWithTitle($('Install')); consent.addButtonWithTitle($('Cancel'));
  if (Number(consent.runModal) !== 1000) return 'cancelled';
  var progress = $.NSAlert.alloc.init;
  progress.messageText = $('Installing Token Scale…');
  progress.informativeText = $('Preparing the background daemon. The development package may download the Dart runtime. This can take several minutes.');
  progress.layout;
  progress.window.center;
  progress.window.orderFrontRegardless;
  var task = $.NSTask.alloc.init;
  task.launchPath = $('/bin/bash'); task.arguments = $([packageRoot + '/install.command', '--consent']);
  task.currentDirectoryPath = $(packageRoot);
  task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath($('/dev/null'));
  task.standardOutput = $.NSFileHandle.fileHandleForWritingAtPath($('/dev/null'));
  task.standardError = $.NSFileHandle.fileHandleForWritingAtPath($('/dev/null'));
  try {
    task.launch;
    while (task.running) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
    task.waitUntilExit;
    if (Number(task.terminationStatus) !== 0) throw Error('installation-failed');
  } catch (_) {
    progress.window.orderOut($());
    var error = $.NSAlert.alloc.init;
    error.messageText = $('Token Scale installation failed');
    error.informativeText = $('The installation did not finish. Open ~/Library/Logs/Token Scale/install.log for the failing step (package checksum, architecture, runtime download or login startup). If the installer never opened, check macOS Privacy & Security. No global security setting was changed.');
    error.runModal;
    return 'installation-failed';
  }
  progress.window.orderOut($());
  return 'installed';
}
