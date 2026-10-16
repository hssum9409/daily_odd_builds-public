/* Native JXA/AppKit app. Run at top level with osascript; never eval the app. */
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('Security');
ObjC.import('CoreText');
var root, home, core, widget, startupUI, config, app, panel, delegate, statusItem, ticker, lock, updateTask, releaseVersion='0.6.4', nextUpdateCheck=Date.now()+20000;
var session = null, snapshot = null, pending = null, rememberedEmail = '', busy = false, message = '', jobs = [], controls = {}, stream = null, streamOffset = 0, streamText = '', reconnectAt = 0, backoff = 1;
var verifyHiddenUntil=0,verifyHiddenWork=0;
var serverAnchor = Date.now(), monoAnchor = 0, stopping = false, ticks = 0, verifyMode = false, verifyPhase = 0, verifyDeadline = 0, verifyRevision = 0, signalRevision = 0, keychainOK = false, verifyReport = { passed: false, checks: [] }, diagnostic = false;
function unwrap(value) { return value ? ObjC.unwrap(value) : ''; }
function textFile(path) { var text = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, $()); return text ? unwrap(text) : ''; }
function write(path, value) { if (!$(typeof value === 'string' ? value : JSON.stringify(value)).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, $())) throw new Error('Cannot write private state'); }
function read(path) { try { return JSON.parse(textFile(path)); } catch (_) { return null; } }
function mkdir(path) { if (!$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(path), true, $(), $())) throw new Error('Cannot create profile directory'); }
function remove(path) { if ($.NSFileManager.defaultManager.fileExistsAtPath($(path))) $.NSFileManager.defaultManager.removeItemAtPathError($(path), $()); }
function now() { return serverAnchor + (Number($.NSProcessInfo.processInfo.systemUptime) - monoAnchor) * 1000; }
function checkUpdates(force) {
    if(diagnostic||verifyMode||unwrap($.NSProcessInfo.processInfo.environment.objectForKey('WORKLOG_DISABLE_UPDATE_CHECK'))==='1')return;
    try{if(updateTask&&updateTask.running)return;var task=$.NSTask.alloc.init;task.launchPath=$('/usr/bin/osascript');task.arguments=$(['-l','JavaScript',root+'/desktop/macos/Update.js',root,home].concat(force?['--force']:[]));task.currentDirectoryPath=$('/tmp');task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath($('/dev/null'));task.standardOutput=task.standardError=$.NSFileHandle.fileHandleForWritingAtPath($('/dev/null'));task.launch;updateTask=task;}catch(_){message='업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';}
}
function trace(stage) { if (diagnostic || verifyMode) console.log('[Worklog] ' + stage); }
function keyQuery(name) {
    var query = $.NSMutableDictionary.alloc.init;
    query.setObjectForKey($.kSecClassGenericPassword, $.kSecClass);
    query.setObjectForKey($('com.dailyoddbuilds.worklog.scripts'), $.kSecAttrService);
    query.setObjectForKey($(home + ':' + name), $.kSecAttrAccount);
    return query;
}
function keyRead(name) {
    var query = keyQuery(name), result = Ref(); query.setObjectForKey($.kCFBooleanTrue, $.kSecReturnData); query.setObjectForKey($.kSecMatchLimitOne, $.kSecMatchLimit);
    var status = Number($.SecItemCopyMatching(query, result)); if (status === -25300) return null; if (status !== 0) throw new Error('Keychain read failed (' + status + ')');
    return JSON.parse(unwrap($.NSString.alloc.initWithDataEncoding(ObjC.cast(result[0], 'NSData'), $.NSUTF8StringEncoding)));
}
function keySave(name, value) {
    var data = $(JSON.stringify(value)).dataUsingEncoding($.NSUTF8StringEncoding), changes = $.NSMutableDictionary.alloc.init; changes.setObjectForKey(data, $.kSecValueData);
    var status = Number($.SecItemUpdate(keyQuery(name), changes));
    if (status === -25300) { var query = keyQuery(name); query.setObjectForKey(data, $.kSecValueData); status = Number($.SecItemAdd(query, $())); }
    if (status !== 0) throw new Error('Keychain save failed (' + status + ')');
}
function keyRemove(name) { var status = Number($.SecItemDelete(keyQuery(name))); if (status !== 0 && status !== -25300) throw new Error('Keychain removal failed (' + status + ')'); }
function rememberEmail(email) { if (email && email.trim()) { rememberedEmail = email.trim(); keySave('account', {email: rememberedEmail}); } }
function startHTTP(url, method, body, token, callback, streaming, form) {
    // Secrets enter curl only over a private stdin pipe, never argv or logs.
    var id = unwrap($.NSUUID.UUID.UUIDString), output = home + '/http-' + id, task = $.NSTask.alloc.init, pipe = $.NSPipe.pipe, errors = $.NSPipe.pipe;
    var options = ['url = ' + core.curlValue(url), 'silent', 'show-error', 'connect-timeout = 10', 'max-time = ' + (streaming ? '2700' : '25'), 'output = ' + core.curlValue(output)];
    if (streaming) options.push('no-buffer', 'header = "Accept: text/event-stream"');
    else options.push('write-out = "\\n__WORKLOG_STATUS__%{http_code}"');
    if (token) options.push('header = ' + core.curlValue('Authorization: Bearer ' + token));
    if (method !== 'GET') { options.push('request = ' + core.curlValue(method), 'header = ' + core.curlValue(form ? 'Content-Type: application/x-www-form-urlencoded' : 'Content-Type: application/json'), 'data = ' + core.curlValue(form ? body : JSON.stringify(body))); }
    task.launchPath = '/usr/bin/curl'; task.arguments = ['--disable', '--config', '-']; task.standardInput = pipe; task.standardError = errors;
    var statusPipe = $.NSPipe.pipe; task.standardOutput = statusPipe;
    task.launch; pipe.fileHandleForWriting.writeData($(options.join('\n') + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); pipe.fileHandleForWriting.closeFile;
    var job = { task: task, output: output, statusPipe: statusPipe, errors: errors, callback: callback, started: Date.now(), streaming: streaming };
    if (!streaming) jobs.push(job); return job;
}
function pumpHTTP() {
    jobs.slice().forEach(function (job) {
        if (Date.now() - job.started > 30000 && job.task.running) job.task.terminate;
        if (job.task.running) return;
        jobs.splice(jobs.indexOf(job), 1);
        var trailer = unwrap($.NSString.alloc.initWithDataEncoding(job.statusPipe.fileHandleForReading.readDataToEndOfFile, $.NSUTF8StringEncoding));
        var match = /__WORKLOG_STATUS__(\d{3})/.exec(trailer), code = match ? Number(match[1]) : 0, value = read(job.output);
        remove(job.output); job.statusPipe.fileHandleForReading.closeFile; job.errors.fileHandleForReading.closeFile;
        try { job.callback(code, value); } catch (_) { busy = false; message = '요청을 마치지 못했습니다. 진단 도구로 확인해 주세요.'; trace('request-callback-failed'); }
    });
}
function withToken(callback) {
    if (!session) { busy = false; message = '로그인이 필요합니다.'; return; }
    if (session.expiresAt > Date.now() + 60000) { callback(session.idToken); return; }
    var expected = session.uid;
    startHTTP('https://securetoken.googleapis.com/v1/token?key=' + config.apiKey, 'POST', 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken), null, function (code, data) {
        if (!session || session.uid !== expected) return;
        if (code !== 200) { busy = false; message = '로그인이 만료되었거나 연결되지 않았습니다. 다시 로그인해 주세요.'; return; }
        session.idToken = data.id_token; session.refreshToken = data.refresh_token; session.expiresAt = Date.now() + 3500000; keySave('session', session); trace('token-refreshed'); callback(session.idToken);
    }, false, true);
}
function api(path, body, callback) { withToken(function (token) { startHTTP('https://asia-northeast3-' + config.projectId + '.cloudfunctions.net/api' + path, body ? 'POST' : 'GET', body, token, callback); }); }
function refresh(done) {
    if (!session) { if (done) done(false); return; }
    var uid = session.uid, day = core.date(now(), snapshot ? snapshot.state.timeZone : 'Asia/Seoul');
    api('/snapshot?from=' + day + '&to=' + day, null, function (code, data) {
        if (!session || uid !== session.uid) return;
        if (code === 200) { if (!snapshot || snapshot.state.revision <= data.state.revision) { snapshot = data; serverAnchor = data.serverNow; monoAnchor = Number($.NSProcessInfo.processInfo.systemUptime); } trace('snapshot-loaded'); }
        else message = '기록을 불러오지 못했습니다. 연결을 확인해 주세요.';
        if (done) done(code === 200);
    });
}
function login(email, password, done) {
    busy = true; message = '';
    startHTTP('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + config.apiKey, 'POST', { email: email, password: password, returnSecureToken: true }, null, function (code, data) {
        if (code !== 200) { busy = false; message = '이메일·비밀번호와 연결을 확인해 주세요.'; if (done) done(false); return; }
        session = { uid: data.localId, email: data.email || email.trim(), idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: Date.now() + 3500000 }; keySave('session', session); rememberEmail(session.email); pending = keyRead('pending'); if (pending && pending.uid !== session.uid) pending = null;
        if (controls.password) controls.password.stringValue = $(''); trace('authenticated'); refresh(function (ok) { busy = false; if (ok) startSignal(); if (done) done(ok); });
    });
}
function send(action, dayId, done, dailyGoalMs) {
    if (busy || pending || !snapshot) return; busy = true; message = '';
    var command = { action: action, expectedRevision: snapshot.state.revision, requestId: unwrap($.NSUUID.UUID.UUIDString) }; if (dayId) command.dayId = dayId;if(action === "setDailyGoal")command.dailyGoalMs=dailyGoalMs;
    pending = { uid: session.uid, command: command }; keySave('pending', pending); retry(done);
}
function retry(done) {
    if (!pending) { refresh(function (ok) { busy = false; if (ok) startSignal(); if (done) done(ok); }); return; }
    if (!session || pending.uid !== session.uid) { busy = false; message = '저장 요청 계정이 다릅니다.'; return; }
    busy = true; api('/command', pending.command, function (code, data) {
        if (code > 0 && code < 500) { keyRemove('pending'); pending = null; }
        if (code !== 200) { busy = false; message = data && data.error && /[^\x00-\x7f]/.test(data.error.message) ? data.error.message : '저장 결과를 확인하지 못했습니다. 같은 요청을 다시 확인해 주세요.'; if (code === 409) refresh(); if (done) done(false); return; }
        refresh(function (ok) { busy = false; if (done) done(ok); });
    });
}
function stopSignal() { if (stream) { if (stream.task.running) stream.task.terminate; remove(stream.output); stream = null; } }
function startSignal() { stopSignal(); if (!session) return; withToken(function (token) { if (!session) return; stream = startHTTP(config.databaseURL + '/signals/' + session.uid + '.json?auth=' + encodeURIComponent(token), 'GET', null, null, null, true); streamOffset = 0; streamText = ''; }); }
function pumpSignal() {
    if (!session) return;
    if (!stream) { if (Date.now() >= reconnectAt && !busy) startSignal(); return; }
    if (!stream.task.running) { stopSignal(); reconnectAt = Date.now() + backoff * 1000; backoff = Math.min(30, backoff * 2); return; }
    if (Date.now() - stream.started > 2600000) { stopSignal(); return; }
    var handle = $.NSFileHandle.fileHandleForReadingAtPath($(stream.output)); if (!handle) return;
    handle.seekToFileOffset(streamOffset); var bytes = handle.readDataToEndOfFile; streamOffset += Number(bytes.length); handle.closeFile;
    if (streamOffset > 1048576) { stopSignal(); return; }
    streamText += unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)); var events = streamText.split('\n\n'); streamText = events.pop();
    events.forEach(function (event) { if (/event: auth_revoked/.test(event)) { session.expiresAt = 0; stopSignal(); } if (/event: (put|patch)/.test(event)) { var match=/^data: (.+)$/m.exec(event);if(match){try{var data=JSON.parse(match[1]).data;signalRevision=Math.max(signalRevision,Number(data && data.revision || 0));}catch(_){}} backoff = 1; if (!busy) refresh(function (ok) { if (ok) trace('signal-snapshot-refreshed'); }); } });
}
function label(value, frame, size) { var v = $.NSTextField.alloc.initWithFrame(frame); v.stringValue = $(value); v.editable = false; v.selectable = false; v.bezeled = false; v.drawsBackground = false; v.font = $.NSFont.systemFontOfSize(size || 13); return v; }
function button(value, frame, action) { var b = $.NSButton.alloc.initWithFrame(frame); b.title = $(value); b.target = delegate; b.action = action; b.bezelStyle = $.NSBezelStyleRounded; return b; }
function show() { panel.makeKeyAndOrderFront($()); app.activateIgnoringOtherApps(true); if(widget)widget.refreshHover(); }
function logout() { if (busy || pending) { message = '저장 결과를 확인한 뒤 로그아웃해 주세요.'; return; } stopSignal(); keyRemove('session'); keyRemove('pending'); session = snapshot = pending = null; message = ''; }
var dashboardAttempt=0;
function dashboard() {
    if(Date.now()-dashboardAttempt<1500)return;dashboardAttempt=Date.now();
    var base=config.appUrl||('https://'+config.projectId+'.web.app/');
    if(!session){$.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString($(base)));return;}
    if(busy)return;busy=true;message='';
    var expected=session;
    api('/desktop-login/issue',{},function(code,data){
        busy=false;if(session!==expected)return;
        if(code!==200||!data||!/^[A-Za-z0-9_-]{43}$/.test(data.ticket)){message='대시보드 로그인을 연결하지 못했습니다. 잠시 후 다시 열어 주세요.';return;}
        $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString($(base+'#desktop-login='+data.ticket)));
    });
}
ObjC.registerSubclass({ name: 'WorklogScriptPanel', superclass: 'NSPanel', methods: { canBecomeKeyWindow: { types: ['bool', []], implementation: function () { return true; } }, canBecomeMainWindow: { types: ['bool', []], implementation: function () { return false; } } } });
ObjC.registerSubclass({ name: 'WorklogScriptDelegate', superclass: 'NSObject', methods: {
    'mouseEntered:': { types: ['void', ['id']], implementation: function () { if(widget)widget.hover(true); } },
    'mouseExited:': { types: ['void', ['id']], implementation: function () { if(widget)widget.hover(false); } },
    'tick:': { types: ['void', ['id']], implementation: function () { tick(); } },
    'login:': { types: ['void', ['id']], implementation: function () { widget.login(); } },
    'primary:': { types: ['void', ['id']], implementation: function () { widget.start(); } },
    'preferences:': {types:['void',['id']],implementation:function(sender){widget.preferences(sender);}},
    'windowWillClose:': {types:['void',['id']],implementation:function(){if(widget)widget.preferencesClosed();}},
    'secondary:': { types: ['void', ['id']], implementation: function () { if(snapshot)send(core.view(snapshot, now()).secondary); } },
    'goal:': { types: ['void', ['id']], implementation: function () { widget.goal(); } },
    'retry:': { types: ['void', ['id']], implementation: function () { if (!busy) { busy = true; retry(); } } },
    'settings:': { types: ['void', ['id']], implementation: function () { widget.settings(); } },
    'style:': { types: ['void', ['id']], implementation: function () { widget.apply(); } },
    'theme:': { types: ['void', ['id']], implementation: function () { widget.chooseTheme(); } },
    'resetStyle:': { types: ['void', ['id']], implementation: function () { widget.reset(); } },
    'show:': { types: ['void', ['id']], implementation: show }, 'dashboard:': { types: ['void', ['id']], implementation: dashboard },
    'hide:': { types: ['void', ['id']], implementation: function () { widget.hide(); } },
    'pin:': { types: ['void', ['id']], implementation: function () { panel.level = Number(controls.pin.state) === 1 ? $.NSFloatingWindowLevel : $.NSNormalWindowLevel; } },
    'logout:': { types: ['void', ['id']], implementation: logout }, 'quit:': { types: ['void', ['id']], implementation: function () { shutdown(); app.stop($()); } }
} });
function createUI() { widget = eval(textFile(root + '/desktop/macos/Widget.js')); widget.create(); }
function render() { widget.render(); }
function status() { return { product: 'WorklogScripts', version:releaseVersion, ready: ticks > 1, pid: Number($.NSProcessInfo.processInfo.processIdentifier), root: root, signedIn: !!session, revision: snapshot ? snapshot.state.revision : 0, status: snapshot ? snapshot.state.status : '', updatedAt: Date.now(), panelVisible: !!panel.visible, startupPromptVisible:!!startupUI&&startupUI.visible(), ticks: ticks, widget: widget.metrics() }; }
function commands() { var files = ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError($(home + '/commands'), $())) || []; files.forEach(function (file) { if (!/^[a-zA-Z0-9-]+\.json$/.test(file)) return; var path = home + '/commands/' + file, c = read(path); remove(path); if (!c || Math.abs(Date.now() - c.createdAt) > 30000) return; if (c.action === 'show') show(); if (c.action === 'stop') { shutdown(); app.stop($()); } if (c.action === 'refresh' && !busy) refresh(); }); }
function verifyTick() {
    if(ticks<20)return; // Finish isolated native-layout checks before starting asynchronous UI login.
    if (Date.now() > verifyDeadline) throw new Error('Verification timed out');
    if (busy || jobs.length) return;
    if (verifyPhase === 0) { verifyPhase = 1; session = null; snapshot = null; pending = null; var env = $.NSProcessInfo.processInfo.environment; widget.verifyLogin(unwrap(env.objectForKey('WORKLOG_QA_EMAIL')), unwrap(env.objectForKey('WORKLOG_QA_PASSWORD')), function (ok) { if (!ok) throw new Error('QA UI login failed'); if (snapshot.state.revision !== 1 || snapshot.state.status !== 'working') throw new Error('QA account must be fresh and UI login must start work once'); verifyRevision=0;render();if(widget.metrics().firstStart)throw new Error('Login/start did not leave greeting');if(!widget.metrics().settingsVisible)throw new Error('Login must keep settings open');verifyHiddenWork=core.view(snapshot,now()).work;verifyHiddenUntil=Date.now()+1500;widget.hide();verifyReport.checks.push('native login starts work once and keeps settings open'); session.expiresAt = 0; keySave('session', session); verifyReport.checks.push('Firebase Auth and Keychain'); verifyPhase = 20; }); }
    else if(verifyPhase===20){if(Date.now()<verifyHiddenUntil)return;if(panel.visible||core.view(snapshot,now()).work<verifyHiddenWork+1000||snapshot.state.status!=='working')throw new Error('Hidden widget must continue working');show();render();verifyReport.checks.push('hidden widget keeps tracking and restores from status menu');verifyPhase=3;}
    else if (verifyPhase >= 2 && verifyPhase < 10) { var action = ['clockIn', 'pause', 'resume', 'clockOut', 'clockIn', 'pause', 'resume', 'clockOut'][verifyPhase - 2]; var next = verifyPhase + 1; busy = false; verifyPhase = -1; send(action, null, function (ok) { if (!ok) throw new Error('Timer transition failed'); verifyPhase = next; }); }
    else if (verifyPhase === 10) { if (snapshot.state.status !== 'off' || snapshot.state.revision !== verifyRevision + 8) throw new Error('Final state mismatch');if(signalRevision<snapshot.state.revision)return;render();if(!widget.metrics().afterWork||!widget.metrics().quitVisible||widget.metrics().clockOutVisible)throw new Error('Completed workday controls mismatch');verifyReport.checks.push('completed workday restart card and red X tray hide'); verifyReport.checks.push('refresh token', 'eight timer transitions', 'RTDB SSE revision', 'AppKit panel and heartbeat');verifyPhase=11;api('/desktop-login/issue',{},function(code,data){if(code!==200||!data||!/^[A-Za-z0-9_-]{43}$/.test(data.ticket))throw new Error('Desktop dashboard bridge failed');verifyReport.checks.push('authenticated one-time dashboard link');verifyPhase=12;}); }
    else if(verifyPhase===12){ var savedSession=keyRead('session'),savedAccount=keyRead('account');if(!savedSession||savedSession.uid!==session.uid||!savedAccount||savedAccount.email!==session.email||Object.keys(savedAccount).length!==1)throw new Error('Keychain session or remembered email mismatch');verifyReport.checks.push('Keychain persists session and last successful email without a password');busy=false;pending=null;logout();if(keyRead('session')!==null||keyRead('pending')!==null||keyRead('account').email!==rememberedEmail)throw new Error('Logout persistence mismatch');verifyReport.checks.push('logout removes authentication and preserves the email');verifyReport.passed = true; write(home + '/verification.json', verifyReport); keyRemove('account'); shutdown(); app.stop($()); }
}
function tick() { if (stopping) return; try { ticks++; if(ticks===2&&startupUI){try{startupUI.showIfNeeded();}catch(_){trace('startup-prompt-failed');}} if(Date.now()>=nextUpdateCheck){nextUpdateCheck=Date.now()+21600000;checkUpdates(false);} if((diagnostic||verifyMode)&&ticks===20){widget.verifyNative();startupUI.verify();verifyReport.checks.push('startup consent UI and later/never/register choices (registration callback only; no OS login item changed)');verifyReport.checks.push("native cream/dark/custom themes, bundled Korean and numeral fonts, signed-out login/design/creator navigation, email/password field-editor focus and Tab order");} pumpHTTP(); commands(); if(stopping)return; pumpSignal(); render(); if (ticks % 4 === 0) { write(home + '/instance.json', status()); write(home + '/status.json', status()); } if (verifyMode) verifyTick();if(diagnostic&&ticks>=40){write(home+'/verification.json',{passed:keychainOK&&!!panel.visible,checks:['profile directory','AppKit panel visible','event loop heartbeat','Keychain roundtrip','cream/dark/custom themes, bundled Korean/numeral fonts, signed-out login/design/creator tabs, hover opacity and local greeting/rest layout','startup consent controls and decisions (injected registration; OS login startup untested)'],ticks:ticks,environment:'macOS native',networkTested:false});shutdown();app.stop($());} } catch (_) { message = '검증 또는 실행 단계가 실패했습니다. 진단 결과를 확인해 주세요.'; trace('tick-failed'); if (verifyMode||diagnostic) { verifyReport.error = 'native-runtime-stage-failed'; write(home + '/verification.json', verifyReport); shutdown(); app.stop($()); } } }
function shutdown() { if (stopping) return; stopping = true; if(startupUI)startupUI.close(); if (widget) { widget.save(); widget.close(); } if (ticker) ticker.invalidate; stopSignal(); jobs.forEach(function (j) { if (j.task.running) j.task.terminate; remove(j.output); }); jobs = []; remove(home + '/instance.json'); remove(home + '/status.json'); if (lock) lock.unlock; if (panel) panel.orderOut($()); }
function run(argv) {
    var env = $.NSProcessInfo.processInfo.environment; root = unwrap(env.objectForKey('WORKLOG_SCRIPTS_ROOT')); home = unwrap(env.objectForKey('WORKLOG_SCRIPTS_HOME')) || unwrap($.NSHomeDirectory()) + '/Library/Application Support/DailyOddBuilds/WorklogScripts';
    diagnostic = argv.indexOf('--diagnose') >= 0; verifyMode = argv.indexOf('--verify') >= 0;
    if (verifyMode && !/^qa-[a-f0-9-]{36}@worklog\.test$/.test(unwrap(env.objectForKey('WORKLOG_QA_EMAIL')))) throw new Error('Explicit disposable QA fixture required');
    mkdir(home); mkdir(home + '/commands'); trace('profile-created'); core = eval(textFile(root + '/desktop/macos/Core.js')); config = read(root + '/config/firebase.json'); releaseVersion=(read(root+'/release.json')||{}).version||'0.6.4'; if (!core || !config) throw new Error('Incomplete release');
    lock = $.NSDistributedLock.lockWithPath($(home + '/instance.lock')); if (!lock.tryLock) { var old = read(home + '/instance.json'); if (!old || Date.now() - old.updatedAt > 10000) { lock.breakLock; } if (!lock.tryLock) throw new Error('Worklog is already running'); }
    app = $.NSApplication.sharedApplication; app.setActivationPolicy($.NSApplicationActivationPolicyAccessory); delegate = $.WorklogScriptDelegate.alloc.init; createUI(); startupUI=eval(textFile(root+'/desktop/macos/StartupConsent.js'))({root:root,home:home,text:textFile,read:read,write:write,color:widget.color,font:widget.font,isDark:function(){return widget.metrics().theme==='dark';},disabled:diagnostic||verifyMode||unwrap(env.objectForKey('WORKLOG_DISABLE_STARTUP_PROMPT'))==='1'||!!unwrap(env.objectForKey('WORKLOG_QA_EMAIL'))}); monoAnchor = Number($.NSProcessInfo.processInfo.systemUptime);
    try { var probe = unwrap($.NSUUID.UUID.UUIDString); keySave('probe', { value: probe }); if (keyRead('probe').value !== probe) throw new Error('Keychain roundtrip mismatch'); keyRemove('probe'); keychainOK=true;trace('keychain-roundtrip-ok'); if (!diagnostic && !verifyMode) { rememberedEmail = (keyRead('account') || {}).email || ''; session = keyRead('session'); if (session) rememberEmail(session.email); pending = keyRead('pending'); } if (pending && (!session || pending.uid !== session.uid)) pending = null; }
    catch (_) { message = 'Keychain을 사용할 수 없습니다. 진단 도구에서 권한과 오류 단계를 확인해 주세요.'; if (verifyMode) throw new Error('Keychain verification failed'); }
    if (session && !verifyMode && !diagnostic) refresh(function (ok) { if (ok) startSignal(); }); verifyDeadline = Date.now() + 120000;
    ticker = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(0.25, delegate, 'tick:', $(), true); trace('event-loop-enter'); app.run; shutdown(); return verifyMode ? JSON.stringify(verifyReport) : '';
}
