/* macOS 내장 JXA 실행기. Node/Python/Swift 설치나 .app 번들이 필요하지 않다. */
// 무인수 ObjC selector는 .launch/.run처럼 접근한다. NSHomeDirectory 같은 C 함수는 ()를 유지한다.
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('ApplicationServices');
ObjC.import('Quartz');
var app, root, home, defaults, strings, settings, words, delegate, timer, uiSpec;
var core, rpc = null, feedTask = null, feedETag = '', feedDelay = 60;
var data = {}, lastData = 0, announcement = null, lastFeed = 0, nextFeed = 0, nextUsage = 0;
var alive = false, mode = 'idle', pet = null, blockers = [], life = {}, creditState = {}, noticeState = {};
var cards = {}, fields = {}, styleFields = {}, settingsWindow = null, statusItem = null;
var resetVisible = false, creditVisible = false, stopping = false, once = false, onceResult = null, lastError = null;
var scanAt = 0, scanFailures = 0, startedAt = 0, instanceId, instanceLock = null, tooltip = null;
var petDragging = false;
var settingsSync = null;
var updateTask = null, nextUpdate = 0;
var nextUpdateStatus=0;
var nextLogicAt=0,lastPointerState=false;
function startUpdate(force) {
    if(!alive || (updateTask && updateTask.running))return;
    var cache=readJSON(home+'/updates.json')||{};
    if(!force && cache.nextCheck>now() && cache.nextCheck<=now()+86400){nextUpdate=cache.nextCheck;return;}
    nextUpdate=now()+21600;
    updateTask=task('/usr/bin/osascript',['-l','JavaScript',root+'/macos/Update.js',root,home].concat(force?['--force']:[]));
}
function stopUpdateCheck(){var state=readJSON(home+'/updates.json')||{};if(updateTask && updateTask.running && ['applying','installed'].indexOf(state.status)<0)updateTask.terminate;}
function now() { return Date.now() / 1000; }
function unwrap(v) { return ObjC.unwrap(v); }
function textFile(path) { var v = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null); return v ? unwrap(v) : ''; }
function readJSON(path) { try { return JSON.parse(textFile(path)); } catch (_) { return null; } }
function writeJSON(path, value) {
    if (!$(JSON.stringify(value, null, 2)).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, null)) throw new Error('Cannot save settings');
}
function queueCommand(command) {
    var id = unwrap($.NSUUID.UUID.UUIDString);
    writeJSON(home + '/commands/' + id + '.json', {id: id, command: command, at: now()});
}
function instanceAlive(record) {
    if (!record || !Number.isInteger(Number(record.pid)) || Number(record.pid) <= 0) return false;
    // 오래된 heartbeat만으로 실행 중인 창의 lock을 깨거나 파일을 교체하지 않는다.
    var output = $.NSPipe.pipe, probe = task('/bin/ps', ['-p', String(record.pid), '-o', 'command='], output);
    probe.waitUntilExit;
    var bytes = output.fileHandleForReading.readDataToEndOfFile;
    var command = unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)) || '';
    return Number(probe.terminationStatus) === 0 && command.indexOf((record.root || root) + '/macos/Monitor.js') >= 0;
}
function t(key) { return words[key] || key; }
function nsArray(v) { return $(v); }
function nullFile() { return $.NSFileHandle.fileHandleForWritingAtPath('/dev/null'); }
function task(path, args, output) {
    var p = $.NSTask.alloc.init;
    p.launchPath = $(path); p.arguments = nsArray(args);
    p.standardOutput = output || nullFile(); p.standardError = nullFile();
    p.launch; return p;
}
function findCodex() {
    var fm = $.NSFileManager.defaultManager, candidates = [];
    if (settings.codexPath) candidates.push(settings.codexPath);
    // 앱 내 CLI를 먼저 쓰고, 사용자가 이미 설치한 CLI만 PATH에서 찾는다.
    ['/Applications/Codex.app', '/Applications/ChatGPT.app', unwrap($.NSHomeDirectory()) + '/Applications/Codex.app', unwrap($.NSHomeDirectory()) + '/Applications/ChatGPT.app'].forEach(function (path) {
        candidates.push(path + '/Contents/Resources/codex');
        candidates.push(path + '/Contents/Resources/bin/codex');
    });
    var paths = unwrap($.NSProcessInfo.processInfo.environment.objectForKey('PATH')) || '';
    (paths + ':/opt/homebrew/bin:/usr/local/bin').split(':').forEach(function (path) { if (path) candidates.push(path + '/codex'); });
    for (var i = 0; i < candidates.length; i++) if (fm.isExecutableFileAtPath($(candidates[i]))) return candidates[i];
    throw new Error(t('error'));
}
function stopRPC() {
    if (!rpc) return;
    var old = rpc; rpc = null;
    try { $.NSNotificationCenter.defaultCenter.removeObserverNameObject(delegate, $.NSFileHandleReadCompletionNotification, old.reader); old.writer.closeFile; } catch (_) { }
    try { if (old.process.running) old.process.terminate; } catch (_) { }
    try { old.reader.closeFile; } catch (_) { }
}
function rpcSend(method, params) {
    if (!rpc || rpc.waiting) return;
    if (['initialize', 'account/read', 'account/rateLimits/read'].indexOf(method) < 0) throw new Error('read-only method');
    var id = ++rpc.id, m = {id: id, method: method}; if (params !== undefined) m.params = params;
    rpc.waiting = {id: id, method: method, deadline: now() + 20};
    rpc.writer.writeData($(JSON.stringify(m) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
function startRPC() {
    var input = $.NSPipe.pipe, output = $.NSPipe.pipe, p = $.NSTask.alloc.init;
    p.launchPath = $(findCodex()); p.arguments = nsArray(['app-server', '--listen', 'stdio://']); p.standardInput = input; p.standardOutput = output; p.standardError = nullFile();
    rpc = {process: p, writer: input.fileHandleForWriting, reader: output.fileHandleForReading, partial: '', waiting: null, id: 0, ready: false};
    $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(delegate, 'rpcRead:', $.NSFileHandleReadCompletionNotification, rpc.reader);
    p.launch; rpc.reader.readInBackgroundAndNotify;
    rpcSend('initialize', {clientInfo: {name: 'codex_usage_scripts', title: 'Codex Usage Monitor Scripts', version: defaults.version}});
}
function rpcRead(notification) {
    if (!rpc) return;
    try {
        var bytes = notification.userInfo.objectForKey('NSFileHandleNotificationDataItem');
        if (!bytes || Number(bytes.length) === 0) { stopRPC(); nextUsage = now() + 10; return; }
        rpc.partial += unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)) || '';
        if (rpc.partial.length > 2097152) throw new Error('response size');
        var lines = rpc.partial.split('\n'); rpc.partial = lines.pop();
        for (var i = 0; i < lines.length; i++) {
            if (!lines[i]) continue;
            var response = JSON.parse(lines[i]), request = rpc && rpc.waiting;
            if (response.method === 'account/rateLimits/updated') nextUsage = 0;
            if (!request || response.id !== request.id) continue;
            rpc.waiting = null;
            if (response.error) throw new Error('RPC rejected');
            if (request.method === 'initialize') {
                rpc.writer.writeData($('{"method":"initialized"}\n').dataUsingEncoding($.NSUTF8StringEncoding));
                rpcSend('account/read', {refreshToken: false});
            } else if (request.method === 'account/read') {
                var account = response.result && response.result.account;
                if (!account || account.type === 'apiKey') throw new Error('ChatGPT sign-in required');
                rpc.ready = true; rpcSend('account/rateLimits/read'); nextUsage = now() + settings.pollSeconds;
            } else {
                data = response.result || {}; lastData = now(); lastError = null; if (settingsSync) settingsSync();
                if (core.creditEvent(creditState, data, settings.creditStep) && settings.creditNotice && settings.placement !== 'hidden') { creditVisible = true; play('credit'); }
                if (once) onceResult = {version: defaults.version, lines: core.render(data, settings, now(), words).lines, planPro: core.pro(data), source: 'account/rateLimits/read'};
            }
        }
        if (rpc) rpc.reader.readInBackgroundAndNotify;
    } catch (_) { lastError = 'connection'; stopRPC(); nextUsage = now() + 10; if (once) onceResult = {error: 'connection'}; }
}
function startFeed() {
    var args = ['--silent', '--show-error', '--max-time', '15', '--max-filesize', '2097152', '--proto', '=https', '--dump-header', home + '/feed.headers', '--output', home + '/feed.response', '--header', 'Accept: application/json', '--user-agent', 'CodexUsageMonitorScripts/0.1.0'];
    if (feedETag) args.push('--header', 'If-None-Match: ' + feedETag);
    args.push('https://codex-resets.com/api/v1/status');
    feedTask = task('/usr/bin/curl', args); nextFeed = now() + feedDelay;
}
function finishFeed() {
    if (!feedTask || feedTask.running) return;
    var ok = Number(feedTask.terminationStatus) === 0; feedTask = null;
    var headers = textFile(home + '/feed.headers'), statuses = headers.match(/HTTP\/\S+\s+(\d+)/g) || [], status = statuses.length ? Number(statuses[statuses.length - 1].split(/\s+/)[1]) : 0;
    if (ok && status === 304) { lastFeed = now(); feedDelay = 60; }
    else if (ok && status === 200) {
        var body = textFile(home + '/feed.response');
        if (body.length <= 2097152) {
            try { announcement = core.scheduled(JSON.parse(body), now()); lastFeed = now(); feedDelay = 60; } catch (_) { feedDelay = Math.min(900, feedDelay * 2); }
        } else feedDelay = Math.min(900, feedDelay * 2);
        var tag = /(?:^|\n)etag:\s*([^\r\n]+)/i.exec(headers); feedETag = tag ? tag[1] : '';
    } else {
        var retry = /(?:^|\n)retry-after:\s*([^\r\n]+)/i.exec(headers);
        feedDelay = core.retryDelay(retry ? retry[1] : '', now(), feedDelay);
    }
    nextFeed = now() + feedDelay;
    ['feed.headers', 'feed.response'].forEach(function (f) { $.NSFileManager.defaultManager.removeItemAtPathError($(home + '/' + f), null); });
}
function desktopApps() {
    var out = [], apps = $.NSWorkspace.sharedWorkspace.runningApplications;
    for (var i = 0; i < Number(apps.count); i++) {
        var a = apps.objectAtIndex(i), id = unwrap(a.bundleIdentifier) || '', name = unwrap(a.localizedName) || '';
        if (/^(Codex|ChatGPT)$/i.test(name) || /^(com\.openai\.(chat|codex|chatgpt))$/i.test(id)) out.push(a);
    }
    return out;
}
// AX 권한이 없는 경우 정확하지 않은 Pet 좌표를 추측하지 않고 별도 패널로 전환한다.
function axAttribute(element, name) {
    var value = Ref();
    return Number($.AXUIElementCopyAttributeValue(element, $(name), value)) === 0 ? value[0] : null;
}
function axRect(element) {
    var p = axAttribute(element, 'AXPosition'), s = axAttribute(element, 'AXSize'), point = Ref(), size = Ref();
    if (!p || !s || !$.AXValueGetValue(p, 1, point) || !$.AXValueGetValue(s, 2, size)) return null;
    return {x: Number(point[0].x), y: Number(point[0].y), w: Number(size[0].width), h: Number(size[0].height)};
}
function scanPet(apps) {
    pet = null; blockers = [];
    if (!$.AXIsProcessTrusted()) return;
    try {
        for (var i = 0; i < apps.length; i++) {
            var element = $.AXUIElementCreateApplication(Number(apps[i].processIdentifier));
            var windows = axAttribute(element, 'AXWindows'); if (!windows) continue;
            for (var w = 0; w < Number(windows.count); w++) {
                var window = windows.objectAtIndex(w), frame = axRect(window);
                if (!frame || frame.w > 1100 || frame.h > 850) continue;
                var queue = [window], chrome = [], mascot = null, budget = 140;
                while (queue.length && budget-- > 0) {
                    var e = queue.shift(), role = unwrap(axAttribute(e, 'AXRole')) || '', rect = axRect(e);
                    if (rect && role === 'AXImage' && rect.w >= 30 && rect.w <= 350 && rect.h >= 40 && rect.h <= 350) mascot = rect;
                    if (rect && /^(AXButton|AXGroup|AXRow)$/.test(role) && rect.w > 30 && rect.w < 1000 && rect.h > 10 && rect.h <= 160) chrome.push(rect);
                    var children = axAttribute(e, 'AXChildren');
                    if (children) for (var c = 0; c < Number(children.count); c++) queue.push(children.objectAtIndex(c));
                }
                if (mascot) { pet = mascot; blockers = chrome; return; }
            }
        }
        scanFailures = 0;
    } catch (_) { scanFailures++; pet = null; }
}
function color(hex, alpha) {
    return $.NSColor.colorWithCalibratedRedGreenBlueAlpha(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, alpha === undefined ? 1 : alpha);
}
function label(value, rect, size, tint, bold) {
    var v = $.NSTextField.alloc.initWithFrame(rect);
    v.stringValue = $(value); v.editable = false; v.selectable = false; v.bezeled = false; v.drawsBackground = false;
    v.font = bold ? $.NSFont.boldSystemFontOfSize(size) : ($.NSFont.fontWithNameSize($(settings.language === 'ko' ? 'Apple SD Gothic Neo' : settings.language === 'ja' ? 'Hiragino Sans' : settings.language === 'zh' ? 'PingFang SC' : 'Helvetica Neue'),size) || $.NSFont.systemFontOfSize(size)); v.textColor = tint || $.NSColor.labelColor;
    v.cell.wraps = true; v.cell.usesSingleLineMode = false;
    return v;
}
var actions = {}, actionId = 100;
function button(value, rect, callback, checkbox) {
    var b = $.NSButton.alloc.initWithFrame(rect); b.title = $(value);
    if (checkbox) b.setButtonType($.NSSwitchButton); else b.bezelStyle = $.NSBezelStyleRounded;
    b.tag = ++actionId; actions[actionId] = callback; b.target = delegate; b.action = 'action:';
    return b;
}
function play(kind) { if (settings.placement !== 'hidden' && ((kind === 'reset' && settings.resetSound) || (kind === 'credit' && settings.creditSound))) $.NSSound.beep; }
function openLink(url) { $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString($(url))); }
function createCard(kind) {
    var p = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(80, 80, 350, 90), $.NSWindowStyleMaskBorderless | $.NSWindowStyleMaskNonactivatingPanel, $.NSBackingStoreBuffered, false);
    p.level = $.NSFloatingWindowLevel; p.opaque = false; p.backgroundColor = $.NSColor.clearColor; p.hasShadow = false; p.hidesOnDeactivate = false;
    p.collectionBehavior = $.NSWindowCollectionBehaviorCanJoinAllSpaces | $.NSWindowCollectionBehaviorFullScreenAuxiliary;
    p.releasedWhenClosed = false; p.title = $('Codex Usage Monitor Scripts - ' + kind);
    var v = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 350, 90)); v.wantsLayer = true; v.layer.cornerRadius = 30; v.layer.borderWidth = 1;
    var outer = $.NSView.alloc.initWithFrame($.NSMakeRect(0,0,350,90)); outer.addSubview(v); p.contentView = outer; v.layer.shadowOpacity = 24/255; v.layer.shadowRadius = 4; v.layer.shadowOffset = $.CGSizeMake(0,-3);
    var close = button('×', $.NSMakeRect(3, 64, 28, 24), function () {
        if (kind === 'main') { settings.placement = 'hidden'; saveSettings(); } else if (kind === 'reset') resetVisible = false; else creditVisible = false;
        render(true);
    });
    var more = button(kind === 'main' ? '···' : '→', $.NSMakeRect(469, 64, 28, 24), function () { if (kind === 'main') showSettings(); else if (announcement && announcement.url) openLink(announcement.url); });
    close.hidden = true; more.hidden = true;
    return {window: p, view: v, close: close, more: more, kind: kind, height: 90, width: 350, x: null, y: null, text: ''};
}
function displayCard(card, lines, visible) {
    if (!visible) { card.window.orderOut(null); return; }
    card.lastLines = lines;
    var contentKey = lines.join('\n') + JSON.stringify(settings.styles[card.kind]) + card.forceWidth + settings.language;
    if (contentKey !== card.text) {
        card.text = contentKey;
        var style = settings.styles[card.kind], height = 34, rows = [], widest = 298, ink = core.styleInk(style,card.kind);
        lines.forEach(function (text, i) { if(card.kind === 'reset' && i>0)return;var sample = label(text,$.NSMakeRect(0,0,10000,50),i === 0 ? (card.kind === 'credit' ? 14 : 12) : 11.5,null,i === 0); widest = Math.max(widest,Number(sample.cell.cellSize.width)); });
        card.naturalWidth = Math.max(350,Math.min(660,Math.floor(widest+54))); card.width = card.forceWidth || card.naturalWidth;
        for (var n = 0; n < lines.length; n++) {
            var size = n === 0 ? (card.kind === 'credit' ? 14 : 12) : card.kind === 'reset' ? 9.5 : 11.5;
            var rowWidth = card.width - 52, rowText = lines[n];
            if(card.kind === 'reset' && n===1) {var viaMeasure=label(t('via'),$.NSMakeRect(0,0,10000,30),9.5);rowText=core.wrapFooter(rowText,rowWidth,Number(viaMeasure.cell.cellSize.width),function(text){return Number(label(text,$.NSMakeRect(0,0,10000,30),9.5).cell.cellSize.width);}).join('\n');}
            var row = label(rowText, $.NSMakeRect(16, 0, rowWidth, 24), size, color(ink), n === 0);
            if ((card.kind === 'main' || card.kind === 'reset') && n === 0) {
                var attrs = {}; attrs[unwrap($.NSFontAttributeName)] = $.NSFont.boldSystemFontOfSize(size); attrs[unwrap($.NSForegroundColorAttributeName)] = color(ink);
                var rich = $.NSMutableAttributedString.alloc.initWithStringAttributes($(lines[n]), $(attrs)), matches = /[\(（][^\)）]*[\)）]/g, match;
                while ((match = matches.exec(lines[n])) !== null) { rich.addAttributeValueRange($.NSFontAttributeName, $.NSFont.systemFontOfSize(card.kind === 'reset' ? 10.5 : 11), $.NSMakeRange(match.index, match[0].length)); rich.addAttributeValueRange($.NSForegroundColorAttributeName, color(card.kind === 'reset' ? '#696969' : '#B9B9B9', card.kind === 'reset' ? 240/255 : 220/255), $.NSMakeRange(match.index, match[0].length)); }
                row.attributedStringValue = rich;
            }
            var measured = row.cell.cellSizeForBounds($.NSMakeRect(0, 0, rowWidth, 1000)), rowHeight = (n < lines.length-1 ? (card.kind === 'credit' ? 22 : 18) : Math.max(size+2,Number(measured.height)));
            rows.push({view: row, height: rowHeight, width: rowWidth}); height += rowHeight;
        }
        // 본체 56pt + 투명 여백 20pt. 여분 공간은 내용 위아래에 같은 크기로 분배한다.
        var extraHeight = card.kind === 'main' ? Math.max(0, uiSpec.panel.mainMinHeight + 20 - height) : 0;
        height += extraHeight;
        card.height = height; card.window.setContentSize($.NSMakeSize(card.width, height));
        card.view.setFrame($.NSMakeRect(10,4,card.width-20,height-20));
        card.view.layer.backgroundColor = color(style.color, style.opacity).CGColor;
        card.view.layer.borderColor = color('#FFFFFF', 48/255).CGColor;
        var subviews = card.view.subviews;
        while (Number(subviews.count)) { subviews.objectAtIndex(0).removeFromSuperview; subviews = card.view.subviews; }
        var top = height - 28 - extraHeight / 2;
        for (var i = 0; i < rows.length; i++) { top -= rows[i].height; rows[i].view.setFrame($.NSMakeRect(16, top, rows[i].width, rows[i].height)); card.view.addSubview(rows[i].view); }
        if (card.kind === 'reset') {
            var via = button(t('via'), $.NSMakeRect(card.width - 178, 8, 146, 18), function () { openLink('https://codex-resets.com/'); }); via.bordered = false; via.font = $.NSFont.systemFontOfSize(9.5); card.view.addSubview(via);
        }
        card.close.setFrameOrigin($.NSMakePoint(0, height - 30)); card.more.setFrameOrigin($.NSMakePoint(card.kind === 'main' ? 29 : card.width - 42, height - 30));
        card.view.addSubview(card.close); if (card.kind !== 'credit') card.view.addSubview(card.more);
    }
    if (card.kind === 'main') card.window.movableByWindowBackground = mode === 'free';
    card.window.orderFrontRegardless;
}
function screens() {
    var list = $.NSScreen.screens, result = [], primaryTop = Number(list.objectAtIndex(0).frame.size.height);
    for (var i = 0; i < Number(list.count); i++) { var r = list.objectAtIndex(i).visibleFrame; result.push({x: Number(r.origin.x), y: primaryTop - Number(r.origin.y) - Number(r.size.height), w: Number(r.size.width), h: Number(r.size.height), primaryTop: primaryTop}); }
    return result;
}
function screenFor(point) {
    var list = screens();
    for (var i = 0; i < list.length; i++) if (point.x >= list[i].x && point.x < list[i].x + list[i].w && point.y >= list[i].y && point.y < list[i].y + list[i].h) return list[i];
    return list[0];
}
function moveCard(card, x, y, animate, screen) {
    if (card.x !== null && Math.abs(card.x - x) < 0.5 && Math.abs(card.y - y) < 0.5) return;
    var frame = $.NSMakeRect(x, screen.primaryTop - y - card.height, card.width, card.height);
    if (animate) {
        $.NSAnimationContext.beginGrouping;$.NSAnimationContext.currentContext.duration=settings.motionMs/1000;
        card.window.animator.setFrameDisplay(frame,true);$.NSAnimationContext.endGrouping;
    } else card.window.setFrameDisplay(frame,true);
    card.x = x; card.y = y;
}
function placeCards() {
    var main = cards.main, rh = resetVisible && cards.reset.window.visible ? cards.reset.height - 20 + settings.noticeGap : 0, ch = creditVisible && cards.credit.window.visible ? cards.credit.height - 20 + settings.noticeGap : 0;
    var screen = screenFor(pet || {x: settings.x || 80, y: settings.y || 80}), side = 'above', x, y;
    if (pet && (mode === 'above' || mode === 'below')) {
        var location = core.place(pet, blockers, screen, main.width, main.height + rh + ch, mode, {top: 16, bottom: 4}, settings);
        if (!location) { Object.keys(cards).forEach(function (k) { cards[k].window.orderOut(null); }); return; }
        side = location.side; x = location.x; y = location.y + (side === 'above' ? rh + ch : 0);
    } else {
        var f = main.window.frame;
        // 별도 표시 상태의 드래그 좌표를 현재 NSPanel에서 읽어 덮어쓰지 않는다.
        x = main.x === null && settings.x !== null ? settings.x : Number(f.origin.x);
        y = main.y === null && settings.y !== null ? settings.y : screen.primaryTop - Number(f.origin.y) - Number(f.size.height);
        x = Math.max(screen.x, Math.min(screen.x + screen.w - main.width, x)); y = Math.max(screen.y + rh + ch, Math.min(screen.y + screen.h - main.height, y));
        if (mode === 'free') { settings.x = x; settings.y = y; }
    }
    moveCard(main, x, y, false, screen);
    moveCard(cards.reset, x, side === 'above' ? y - rh - ch : y + main.height - 20 + settings.noticeGap, true, screen);
    moveCard(cards.credit, x, side === 'above' ? y - ch : y + main.height + rh - 20 + settings.noticeGap, true, screen);
}
function render(force) {
    if (!cards.main) return;
    mode = core.lifecycle(settings, alive, !!pet, now(), life);
    var show = ['idle', 'hidden', 'waiting'].indexOf(mode) < 0, view = core.render(data, settings, now(), words), lines = lastData ? view.lines : [lastError ? t('error') : t('connecting')];
    var globalMouse = $.NSEvent.mouseLocation, primary = screens()[0], mx = Number(globalMouse.x), my = primary.primaryTop - Number(globalMouse.y), pressed = (Number($.NSEvent.pressedMouseButtons) & 1) !== 0;
    if (pressed && pet && mx >= pet.x && mx <= pet.x + pet.w && my >= pet.y && my <= pet.y + pet.h) petDragging = true;
    if (!pressed && petDragging) { petDragging = false; scanAt = 0; }
    if (petDragging && (mode === 'above' || mode === 'below')) show = false;
    if (lastData && now() - lastData > 60) lines.push(t('stale'));
    if (!settings.resetNotice || !announcement || now() - lastFeed > 1800) resetVisible = false;
    var key = core.reminderKey(announcement, now(), settings.resetMinutes);
    if (show && settings.resetNotice && announcement && now() - lastFeed < 1800 && key !== noticeState.lastKey) {
        if (!resetVisible) play('reset'); resetVisible = true; noticeState.lastKey = key; writeJSON(home + '/notices.json', noticeState);
    }
    if (!settings.creditNotice) creditVisible = false;
    displayCard(cards.main, lines, show);
    var title = (announcement && announcement.type === 'banked' ? t('reset_stored') : t('reset_normal')) + ' ' + t('notice_reset') + ' · ' + t('notice_after').replace('{value}', core.forecast(announcement, now(), words)) + ' ' + t('estimated');
    displayCard(cards.reset, [title, t('reset_disclaimer')], show && resetVisible);
    displayCard(cards.credit, [t('credit_started'), t('balance') + ' ' + core.credit(view.balance)], show && creditVisible);
    var sharedWidth=350;
    Object.keys(cards).forEach(function(k){if(cards[k].window.visible)sharedWidth=Math.max(sharedWidth,cards[k].naturalWidth);});
    Object.keys(cards).forEach(function(k){var c=cards[k];if(c.window.visible && c.forceWidth!==sharedWidth){c.forceWidth=sharedWidth;displayCard(c,c.lastLines,true);}});
    if (show) placeCards();
    var mouse = $.NSEvent.mouseLocation, screen = screens()[0], pos = {x: Number(mouse.x), y: screen.primaryTop - Number(mouse.y)};
    Object.keys(cards).forEach(function (k) { var c = cards[k], hover = c.window.visible && pos.x >= c.x && pos.x <= c.x + c.width && pos.y >= c.y && pos.y <= c.y + c.height; c.close.hidden = !hover; c.more.hidden = !hover; });
    var overTickets = show && lastData && (settings.tickets || settings.expiry) && pos.x >= cards.main.x && pos.x <= cards.main.x + cards.main.width && pos.y >= cards.main.y + 34 && pos.y <= cards.main.y + 59;
    if (tooltip && !tooltip.shown) tooltip = null;
    if (overTickets) showTickets(view);
    else if (tooltip) {
        var tf = tooltip.contentViewController.view.window.frame;
        var tx = Number(tf.origin.x), ty = screen.primaryTop - Number(tf.origin.y) - Number(tf.size.height);
        if (pos.x < tx || pos.x > tx + Number(tf.size.width) || pos.y < ty || pos.y > ty + Number(tf.size.height)) { tooltip.close; tooltip = null; }
    }
}
function saveSettings() { writeJSON(home + '/settings.json', settings); }
function localDate(at) {
    if (!core.finite(at)) return '—';
    var format = $.NSDateFormatter.alloc.init; format.dateFormat = $('yyyy-MM-dd HH:mm z');
    if (settings.timezone !== 'system') format.timeZone = $.NSTimeZone.timeZoneWithName($(settings.timezone));
    return unwrap(format.stringFromDate($.NSDate.dateWithTimeIntervalSince1970(at)));
}
function showTickets(view) {
    if (tooltip) return;
    var height = Math.max(60, view.tickets.rows.length * 50 + 16), vc = $.NSViewController.alloc.init;
    vc.view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 280, height));
    view.tickets.rows.forEach(function (ticket, i) {
        vc.view.addSubview(label((i + 1) + ' : ' + core.duration(ticket.expiresAt, now(), false) + ' ' + t('expires'), $.NSMakeRect(14, height - 32 - i * 50, 252, 24), 15, null, true));
        vc.view.addSubview(label(localDate(ticket.expiresAt), $.NSMakeRect(14, height - 53 - i * 50, 252, 21), 11));
    });
    if (!view.tickets.rows.length) vc.view.addSubview(label(t('noData'), $.NSMakeRect(14, 18, 252, 24), 13));
    tooltip = $.NSPopover.alloc.init; tooltip.behavior = $.NSPopoverBehaviorTransient; tooltip.contentViewController = vc;
    var screen = screenFor({x: cards.main.x, y: cards.main.y}), edge = cards.main.x - screen.x >= 290 ? $.NSRectEdgeMinX : $.NSRectEdgeMaxX;
    tooltip.showRelativeToRectOfViewPreferredEdge($.NSMakeRect(0, 0, cards.main.width, cards.main.height), cards.main.view, edge);
}
function toggle() { settings.placement = settings.placement === 'hidden' ? settings.attachedPlacement : 'hidden'; saveSettings(); render(true); }
function setStartup(enabled) {
    var path = unwrap($.NSHomeDirectory()) + '/Library/LaunchAgents/com.dailyoddbuilds.codex-usage-scripts.plist';
    if (enabled) {
        $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(unwrap($.NSHomeDirectory()) + '/Library/LaunchAgents'), true, null, null);
        var plist = $({Label: 'com.dailyoddbuilds.codex-usage-scripts', ProgramArguments: ['/usr/bin/osascript', '-l', 'JavaScript', root + '/macos/Monitor.js', '--startup'], WorkingDirectory: root, RunAtLoad: true, ProcessType: 'Interactive'});
        if (!plist.writeToFileAtomically($(path), true)) throw new Error('Cannot write LaunchAgent');
        // 다음 로그인부터 적용. 현재 실행 중인 프로세스의 이중 실행을 피한다.
    } else {
        $.NSFileManager.defaultManager.removeItemAtPathError($(path), null);
    }
}
var settingsUI = null;
function showSettings() { if (!settingsUI) settingsUI = eval(textFile(root + '/macos/Settings.js')); settingsUI.show(); }

function alert(message) { var a = $.NSAlert.alloc.init; a.messageText = $(message); a.runModal; }
function setupMenu() {
    statusItem = $.NSStatusBar.systemStatusBar.statusItemWithLength($.NSVariableStatusItemLength); var icon = $.NSImage.alloc.initWithContentsOfFile($(root + '/assets/gp-chan-face.png')); icon.size = $.NSMakeSize(18,18); statusItem.button.image = icon;
    var menu = $.NSMenu.alloc.init;
    [[t('settings'), showSettings], ['Monitor ON/OFF', toggle], [t('refresh'), function () { nextUsage = 0; nextFeed = 0; }], [t('startup_register'), function () { setStartup(true); }], [t('quit'), shutdown]].forEach(function (row) { var item = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($(row[0]), 'action:', $('')); item.tag = ++actionId; item.target = delegate; actions[actionId] = row[1]; menu.addItem(item); });
    statusItem.menu = menu;
    menu.delegate = delegate;
}
function shutdown() {
    if (stopping) return; stopping = true; stopRPC();
    stopUpdateCheck();
    if (feedTask) { try { if (feedTask.running) feedTask.terminate; } catch (_) { } }
    if (timer) timer.invalidate;
    if (mode === 'free') saveSettings();
    var owned = readJSON(home + '/instance.json'); if (owned && owned.id === instanceId) $.NSFileManager.defaultManager.removeItemAtPathError($(home + '/instance.json'), null);
    if (instanceLock) { instanceLock.unlock; instanceLock = null; }
    if (app) app.stop(null);
}
function tick() {
    try {
        // 빠른 드래그 감지와 파일/프로세스 조회를 분리한다. 대기 주기는 항상 2초다.
        var pressed=(Number($.NSEvent.pressedMouseButtons)&1)!==0;
        syncReactionTimer();
        if(alive && now()<nextLogicAt) {
            if(pressed!==lastPointerState){lastPointerState=pressed;render(false);}
            return;
        }
        nextLogicAt=now()+0.25;lastPointerState=pressed;
        var commandFiles = ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError($(home + '/commands'), null)) || [];
        var commands = commandFiles.filter(function (f) { return /\.json$/.test(f); }).map(function (f) { return {file: f, value: readJSON(home + '/commands/' + f)}; });
        commands.sort(function (a, b) { return (a.value ? a.value.at : 0) - (b.value ? b.value.at : 0); });
        for (var ci = 0; ci < Math.min(16, commands.length); ci++) {
            var control = commands[ci].value;
            $.NSFileManager.defaultManager.removeItemAtPathError($(home + '/commands/' + commands[ci].file), null);
            if (!control || now() - control.at > 60) continue;
            if (control.command === 'stop') { shutdown(); return; }
            if (control.command === 'settings') showSettings();
            if (control.command === 'toggle') toggle();
            if (control.command === 'refresh') { nextUsage = 0; nextFeed = 0; }
        }
        var apps = desktopApps(), present = apps.length > 0;
        if (!present && alive) { stopRPC(); stopUpdateCheck(); nextUsage = 0; pet = null; creditState.previous = null; if (feedTask && feedTask.running) feedTask.terminate; feedTask = null; nextFeed = 0; }
        alive = present;
        if (alive) {
            if(now()>=nextUpdate)startUpdate(false);
            if (now() >= scanAt) { scanPet(apps); scanAt = now() + (scanFailures ? Math.max(2,settings.chromeMs/1000) : settings.chromeMs/1000); }
            if (!rpc && now() >= nextUsage) { nextUsage = now() + 10; try { startRPC(); } catch (_) { lastError = 'path'; } }
            if (rpc && rpc.waiting && now() > rpc.waiting.deadline) { lastError = 'timeout'; stopRPC(); nextUsage = now() + 10; }
            if (rpc && rpc.ready && !rpc.waiting && now() >= nextUsage) { rpcSend('account/rateLimits/read'); nextUsage = now() + settings.pollSeconds; }
            finishFeed();
            if (settings.resetNotice && !feedTask && now() >= nextFeed) startFeed();
        }
        render(false);
        if(settingsWindow && settingsWindow.visible){
            syncPetAvailability();
            if(now()>=nextUpdateStatus){syncUpdateStatus();nextUpdateStatus=now()+1;}
        }
        syncReactionTimer();
        // 인스턴스 heartbeat에는 PID/시각만 저장하며 계정/토큰은 저장하지 않는다.
        if (Math.floor(now()) % 5 === 0) writeJSON(home + '/instance.json', {id: instanceId, heartbeat: now(), pid: Number($.NSProcessInfo.processInfo.processIdentifier), root: root, version:defaults.version, ready:true});
    } catch (_) { /* 일시적인 AX/네트워크 오류로 전체 모니터를 종료하지 않는다. */ }
}
function syncReactionTimer() {
    if(!timer)return;
    var interval=core.reactionInterval(settings,alive,(Number($.NSEvent.pressedMouseButtons)&1)!==0)/1000;
    if(Number(timer.timeInterval)!==interval){timer.invalidate;timer=$.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(interval,delegate,'tick:',null,true);}
}
ObjC.registerSubclass({
    name: 'UsageScriptsDelegate', superclass: 'NSObject', methods: {
        'action:': {types: ['void', ['id']], implementation: function (sender) { var fn = actions[Number(sender.tag)]; if (fn) fn(); }},
        'tick:': {types: ['void', ['id']], implementation: function () { tick(); }},
        'rpcRead:': {types: ['void', ['id']], implementation: function (n) { rpcRead(n); }},
        'menuNeedsUpdate:': {types: ['void', ['id']], implementation: function (menu) {
            menu.itemAtIndex(1).title = $(settings.placement === 'hidden' ? t('monitorOn') : t('monitorOff'));
            menu.itemAtIndex(3).hidden = $.NSFileManager.defaultManager.fileExistsAtPath($(unwrap($.NSHomeDirectory()) + '/Library/LaunchAgents/com.dailyoddbuilds.codex-usage-scripts.plist'));
        }},
        'workspaceChanged:': {types: ['void', ['id']], implementation: function () { scanAt = 0;nextLogicAt=0;tick(); }}
    }
});
function run(argv) {
    var env = $.NSProcessInfo.processInfo.environment;
    root = unwrap(env.objectForKey('CODEX_USAGE_SCRIPTS_ROOT'));
    if (!root) {
        var args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments), script = args.filter(function (a) { return /\/Monitor\.js$/.test(a); })[0];
        if (!script) throw new Error('Run macos/run.command'); root = script.replace(/\/macos\/Monitor\.js$/, '');
    }
    eval(textFile(root + '/common/core.js')); core = MonitorCore;
    defaults = readJSON(root + '/defaults.json'); strings = readJSON(root + '/strings.json'); uiSpec = readJSON(root + '/ui.json'); if (!defaults || !strings || !uiSpec) throw new Error('Incomplete script package');
    home = unwrap(env.objectForKey('CODEX_USAGE_SCRIPTS_HOME')) || unwrap($.NSHomeDirectory()) + '/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts';
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(home), true, null, null);
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(home + '/commands'), true, null, null);
    settings = core.normalize(readJSON(home + '/settings.json'), defaults); words = strings[settings.language]; noticeState = readJSON(home + '/notices.json') || {};
    delegate = $.UsageScriptsDelegate.alloc.init; once = argv.indexOf('--once') >= 0;
    if (argv.indexOf('--register-startup') >= 0) { setStartup(true); return 'Startup registered'; }
    if (argv.indexOf('--remove-startup') >= 0) { setStartup(false); return 'Startup removed'; }
    if (argv.indexOf('--stop') >= 0) {
        var current = readJSON(home + '/instance.json');
        if (instanceAlive(current)) {
            if (current.root && current.root !== root) throw new Error('Stop the monitor running from another folder first');
            queueCommand('stop');
        } else if (current) $.NSFileManager.defaultManager.removeItemAtPathError($(home + '/instance.json'), null);
        return 'Stop requested';
    }
    if (once) {
        startedAt = now(); startRPC();
        while (!onceResult && now() - startedAt < 65) { $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1)); if (rpc && rpc.waiting && now() > rpc.waiting.deadline) { onceResult = {error: 'timeout'}; } }
        stopRPC(); if (!onceResult || onceResult.error) throw new Error(t('error')); return JSON.stringify(onceResult, null, 2);
    }
    var previous = readJSON(home + '/instance.json');
    instanceLock = $.NSDistributedLock.lockWithPath($(home + '/instance.lock'));
    if (!instanceLock.tryLock) {
        var lockDate = instanceLock.lockDate, lockAge = lockDate ? -Number(lockDate.timeIntervalSinceNow) : 0;
        if (instanceAlive(previous) || lockAge < 15) { queueCommand(argv.indexOf('--settings') >= 0 ? 'settings' : 'refresh'); return 'Already running'; }
        instanceLock.breakLock; if (!instanceLock.tryLock) throw new Error('Another monitor is starting');
    }
    instanceId = unwrap($.NSUUID.UUID.UUIDString); writeJSON(home + '/instance.json', {id: instanceId, heartbeat: now(), pid: Number($.NSProcessInfo.processInfo.processIdentifier), root: root});
    app = $.NSApplication.sharedApplication; app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
    ['main', 'reset', 'credit'].forEach(function (kind) { cards[kind] = createCard(kind); }); setupMenu();
    $.NSWorkspace.sharedWorkspace.notificationCenter.addObserverSelectorNameObject(delegate, 'workspaceChanged:', $.NSWorkspaceDidLaunchApplicationNotification, null);
    $.NSWorkspace.sharedWorkspace.notificationCenter.addObserverSelectorNameObject(delegate, 'workspaceChanged:', $.NSWorkspaceDidTerminateApplicationNotification, null);
    timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(2, delegate, 'tick:', null, true);
    if (argv.indexOf('--settings') >= 0) showSettings();
    writeJSON(home + '/instance.json', {id:instanceId,heartbeat:now(),pid:Number($.NSProcessInfo.processInfo.processIdentifier),root:root,version:defaults.version,ready:true});
    app.run; shutdown(); return '';
}
