// JXA/AppKit companion. Day 001's no-argument selectors use property access.
ObjC.import('AppKit');
ObjC.import('Foundation');
var root, dataHome, owner, app, statusItem, timer, delegate, words, items = {}, actions = {};
function readText(path) {
  try { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, $())) || ''; }
  catch (_) { return ''; }
}
function readJSON(path) { try { return JSON.parse(readText(path)); } catch (_) { return {}; } }
function writeText(path, value) {
  if (!$(value).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, $())) throw Error('desktop-command-failed');
}
function logEvent(code) {
  try {
    var old = readText(dataHome + '/desktop.log');
    if (old.length > 65536) { writeText(dataHome + '/desktop.previous.log', old); old = ''; }
    writeText(dataHome + '/desktop.log', old + new Date().toISOString() + ' ' + code + '\n');
  } catch (_) { /* Logging cannot disable the status menu. */ }
}
function command(name) {
  if (['connect','sync','pause','resume','web','update','startup-enable','startup-disable','stop'].indexOf(name) < 0) return;
  writeText(root + '/' + name + (name === 'stop' ? '' : '.request'), name);
}
function stopMenu() {
  if (timer) timer.invalidate;
  if (statusItem) $.NSStatusBar.systemStatusBar.removeStatusItem(statusItem);
  app.terminate($());
}
function refresh() {
  if (readText(root + '/host-active').trim() !== owner) { stopMenu(); return; }
  var state = readJSON(dataHome + '/daemon-status.json');
  var phase = ['starting','running','syncing','paused','connection-needed','error','stopped'].indexOf(state.phase) >= 0 ? state.phase : 'starting';
  items.status.title = $(words[phase]);
  if (phase === 'error' && /^[a-z0-9-]{1,80}$/.test(state.lastEvent || '')) items.status.title = $(words.error + ' (' + state.lastEvent + ')');
  statusItem.button.title = $(phase === 'error' || phase === 'connection-needed' ? 'TS !' : state.autoSync === false ? 'TS ‖' : 'TS');
  statusItem.button.toolTip = $('Token Scale: ' + words[phase]);
  var last = words.never;
  if (state.lastSync && Number.isFinite(Date.parse(state.lastSync))) last = new Date(state.lastSync).toLocaleString();
  items.lastSync.title = $(words.lastSync + ': ' + last);
  var action = state.autoSync === false ? 'resume' : 'pause';
  items.pause.title = $(words[action]); actions.pause = action;
}
ObjC.registerSubclass({name: 'TokenScaleStatusDelegate', methods: {
  'action:': {types: ['void', ['id']], implementation: function(sender) {
    try {
      var key = ObjC.unwrap(sender.representedObject);
      command(actions[key] || key);
    } catch (_) { logEvent('menu-command-failed'); }
  }},
  'tick:': {types: ['void', ['id']], implementation: function() {
    try { refresh(); } catch (_) { logEvent('menu-refresh-failed'); }
  }},
}});
function run(argv) {
  root = argv[0]; dataHome = argv[1]; owner = argv[2];
  if (!root || root[0] !== '/' || !dataHome || dataHome[0] !== '/' || !/^[0-9]+$/.test(owner || '') ||
      readText(root + '/product-id').trim() !== 'DailyOddBuilds.TokenScale') throw Error('invalid-installation');
  logEvent('menu-starting');
  var language = String(ObjC.unwrap($.NSLocale.preferredLanguages.objectAtIndex(0)) || 'en').slice(0, 2);
  var all = readJSON(root + '/desktop-strings.json'); words = all[language] || all.en;
  if (!words) throw Error('desktop-resources-missing');
  app = $.NSApplication.sharedApplication; app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  logEvent('menu-appkit-ready');
  delegate = $.TokenScaleStatusDelegate.alloc.init;
  statusItem = $.NSStatusBar.systemStatusBar.statusItemWithLength($.NSVariableStatusItemLength);
  statusItem.button.title = $('TS');
  var menu = $.NSMenu.alloc.init; menu.autoenablesItems = false;
  ['daemon','status','lastSync','connect','sync','pause','web','update','startup-enable','startup-disable','quit'].forEach(function(key) {
    var enabled = ['daemon','status','lastSync'].indexOf(key) < 0;
    var title = key === 'daemon' ? 'Token Scale · ' + words.daemon : words[key] || words.starting;
    var item = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($(title), enabled ? 'action:' : $(), $(''));
    item.enabled = enabled; item.target = delegate; item.representedObject = $(key);
    items[key] = item; if (key === 'quit') actions[key] = 'stop';
    menu.addItem(item);
  });
  statusItem.menu = menu;
  logEvent('menu-created');
  refresh();
  timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(2, delegate, 'tick:', $(), true);
  writeText(dataHome + '/desktop-ui.json', JSON.stringify({pid: Number($.NSProcessInfo.processInfo.processIdentifier), kind: 'macos-menu', ready: true}));
  logEvent('menu-ready');
  app.run;
  if (timer) timer.invalidate;
  return '';
}
