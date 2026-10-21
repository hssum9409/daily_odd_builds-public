const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const sourceDir = join(__dirname, '../install/macos');
function bridge({consent = 1000, exitCode = 0} = {}) {
  const files = new Map(), events = [], subclasses = {}, alerts = [], tasks = [];
  const unbox = value => value?.value ?? value;
  const $ = value => ({value, writeToFileAtomicallyEncodingError(path) {
    files.set(unbox(path), value); return true;
  }});
  const classOf = factory => ({alloc: {get init() { return factory(); }}});
  const window = {get orderFrontRegardless() { events.push('show'); }, orderOut() { events.push('hide'); }};
  const app = {setActivationPolicy(value) { events.push(['policy', value]); }, activateIgnoringOtherApps() {},
    get run() { events.push('run'); }, terminate() { events.push('terminate'); }};
  const status = {button: {}};
  $.NSApplication = {sharedApplication: app}; $.NSApplicationActivationPolicyAccessory = 1;
  $.NSVariableStatusItemLength = -1; $.NSUTF8StringEncoding = 4;
  $.NSLocale = {preferredLanguages: {objectAtIndex() { return $('ko'); }}};
  $.NSString = {stringWithContentsOfFileEncodingError(path) { return $(files.get(unbox(path)) ?? ''); }};
  $.NSStatusBar = {systemStatusBar: {statusItemWithLength() { return status; }, removeStatusItem() { events.push('remove-item'); }}};
  $.NSMenu = classOf(() => ({items: [], addItem(item) { this.items.push(item); }}));
  $.NSMenuItem = {alloc: {initWithTitleActionKeyEquivalent(title, selector) { return {title, selector}; }}};
  $.NSTimer = {scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats() {
    return {get invalidate() { events.push('timer-invalidated'); }};
  }};
  $.NSProcessInfo = {processInfo: {processIdentifier: 1234}};
  $.NSAlert = classOf(() => {
    const alert = {window, addButtonWithTitle() {}, get runModal() { events.push('modal'); return consent; }};
    alerts.push(alert); return alert;
  });
  $.NSTask = classOf(() => {
    const task = {running: false, terminationStatus: exitCode,
      get launch() { events.push('launch'); }, get waitUntilExit() { events.push('wait'); }};
    tasks.push(task); return task;
  });
  $.NSFileHandle = {fileHandleForReadingAtPath() { return {}; }, fileHandleForWritingAtPath() { return {}; }};
  $.NSRunLoop = {currentRunLoop: {runUntilDate() {}}}; $.NSDate = {dateWithTimeIntervalSinceNow() {}};
  const context = {ObjC: {import() {}, unwrap: unbox, registerSubclass(value) {
    subclasses[value.name] = value.methods; $[value.name] = classOf(() => ({}));
  }}, $, JSON, Date, String, Number, Error};
  vm.createContext(context);
  return {context, files, events, subclasses, status, tasks, alerts, unbox, $};
}

test('menu uses actual JXA getter selectors and only allowlisted file commands', () => {
  const b = bridge(), root = '/Users/test/Token Scale', home = '/Users/test/profile';
  b.files.set(root + '/product-id', 'DailyOddBuilds.TokenScale'); b.files.set(root + '/host-active', '55');
  b.files.set(root + '/desktop-strings.json', readFileSync(join(sourceDir, '../desktop-strings.json'), 'utf8'));
  b.files.set(home + '/daemon-status.json', JSON.stringify({phase: 'running', autoSync: true}));
  vm.runInContext(readFileSync(join(sourceDir, 'status-menu.js'), 'utf8'), b.context);
  b.context.run([root, home, '55']);
  assert(b.events.includes('run')); assert.equal(b.status.menu.items.length, 11);
  assert.equal(b.unbox(b.status.button.title), 'TS');
  const methods = b.subclasses.TokenScaleStatusDelegate;
  methods['action:'].implementation({representedObject: b.$('sync')});
  assert.equal(b.files.get(root + '/sync.request'), 'sync');
  b.files.set(home + '/daemon-status.json', JSON.stringify({phase: 'paused', autoSync: false}));
  methods['tick:'].implementation();
  methods['action:'].implementation({representedObject: b.$('pause')});
  assert.equal(b.files.get(root + '/resume.request'), 'resume');
  methods['action:'].implementation({representedObject: b.$('../credentials')});
  assert(!b.files.has(root + '/../credentials.request'));
  methods['action:'].implementation({representedObject: b.$('quit')}); assert.equal(b.files.get(root + '/stop'), 'stop');
  b.files.set(root + '/host-active', '56'); methods['tick:'].implementation();
  assert(b.events.includes('remove-item')); assert(b.events.includes('terminate'));
});

test('Mac setup cancel never launches installer; consent executes script without Terminal', () => {
  for (const consent of [1000, 1001]) {
    const b = bridge({consent});
    vm.runInContext(readFileSync(join(sourceDir, 'Setup.js'), 'utf8'), b.context);
    assert.equal(b.context.run(['/Users/test/Install Folder']), consent === 1000 ? 'installed' : 'cancelled');
    if (consent === 1000) {
      assert.equal(b.unbox(b.tasks[0].launchPath), '/bin/bash');
      assert.equal(JSON.stringify(b.unbox(b.tasks[0].arguments)), JSON.stringify(['/Users/test/Install Folder/install.command','--consent']));
      assert(b.events.includes('launch')); assert(b.events.includes('wait'));
    } else assert.equal(b.tasks.length, 0);
  }
});

test('Mac installation failure is reported by a dialog instead of becoming an unexplained exit', () => {
  const b = bridge({exitCode: 1});
  vm.runInContext(readFileSync(join(sourceDir, 'Setup.js'), 'utf8'), b.context);
  assert.equal(b.context.run(['/Users/test/package']), 'installation-failed');
  assert.equal(b.alerts.length, 3); assert(b.events.includes('hide'));
  assert.match(b.unbox(b.alerts[2].informativeText), /Library\/Logs\/Token Scale\/install\.log/);
});
