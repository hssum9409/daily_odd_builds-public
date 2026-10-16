/* 같은 에셋·레이아웃·글자 크기를 쓰는 AppKit 설정창. Mac 실기기 QA는 별도 기록한다. */
var settingsPage = 'settings', settingsPages = {}, navButtons = {};
var designRanges={},speedPopup=null,advancedExpanded=false;
ObjC.registerSubclass({name: 'UsageScriptsFlippedView', superclass: 'NSView', methods: {
    isFlipped: {types: ['bool', []], implementation: function () { return true; }}
}});
function uiView(rect, background, radius) {
    var v = $.UsageScriptsFlippedView.alloc.initWithFrame(rect); v.wantsLayer = true;
    if (background) v.layer.backgroundColor = color(background).CGColor;
    if (radius) v.layer.cornerRadius = radius;
    return v;
}
function uiText(parent, value, x, y, width, height, size, muted, bold) {
    var v = label(value, $.NSMakeRect(x, y, width, height), size || 11.5, color(muted ? '#99aeaa' : '#edf4f1'), !!bold);
    parent.addSubview(v); return v;
}
function uiButton(parent, value, x, y, width, callback, active) {
    var b = button(value, $.NSMakeRect(x, y, width, 36), callback); b.bordered = false; b.wantsLayer = true;
    b.layer.cornerRadius = 9; b.layer.backgroundColor = color(active ? '#a5e4ce' : '#233236').CGColor;
    b.font = $.NSFont.boldSystemFontOfSize(12); b.contentTintColor = color(active ? '#101617' : '#edf4f1'); parent.addSubview(b); return b;
}
function uiSwitch(parent, key, name, x, y, width, callback) {
    var title = uiText(parent, name, x, y + 10, width - 50, 26, 11.5);
    var b = button('', $.NSMakeRect(x + width - 43, y + 9, 35, 20), function () {
        b.state = Number(b.state) === 1 ? 0 : 1;
        if (callback) callback(Number(b.state) === 1); else { settings[key] = Number(b.state) === 1; saveSettings(); syncSettings(); render(true); }
        paintSwitch(fields[key]);
    });
    b.bordered = false; b.wantsLayer = true; b.layer.cornerRadius = 10;
    var thumb = uiView($.NSMakeRect(settings[key] ? 18 : 3, 3, 14, 14), '#edf4f1', 7); thumb.layer.masksToBounds = true; b.addSubview(thumb); b.state = settings[key] ? 1 : 0;
    fields[key] = {button: b, thumb: thumb, title: title}; parent.addSubview(b); paintSwitch(fields[key]); return b;
}
function paintSwitch(f) {
    var on = Number(f.button.state) === 1;
    f.button.layer.backgroundColor = color(on ? '#a5e4ce' : '#405258').CGColor;
    f.thumb.layer.backgroundColor = color(on ? '#101617' : '#edf4f1').CGColor;
    $.NSAnimationContext.beginGrouping; $.NSAnimationContext.currentContext.duration = 0.16;
    f.thumb.animator.setFrameOrigin($.NSMakePoint(on ? 18 : 3, 3)); $.NSAnimationContext.endGrouping;
    f.button.alphaValue = f.button.enabled ? 1 : 0.4; f.title.alphaValue = f.button.enabled ? 1 : 0.4;
}
function uiChoice(parent, key, name, values, labels, y, x, width) {
    x = x || 16; width = width || 566;
    uiText(parent, name, x, y + 5, width - 175, 26, 11.5, true);
    var p = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(x + width - 160, y, 160, 30), false);
    p.addItemsWithTitles(nsArray(labels)); p.selectItemAtIndex(Math.max(0, values.indexOf(key==='speedPreset' ? core.speedPreset(settings,uiSpec.timing.presets) : settings[key]))); p.font = $.NSFont.systemFontOfSize(11.5);
    p.tag = ++actionId; p.target = delegate; p.action = 'action:';
    actions[actionId] = function () {
        if(key==='speedPreset') {
            var preset=uiSpec.timing.presets[values[Number(p.indexOfSelectedItem)]];
            if(preset)Object.keys(preset).forEach(function(k){settings[k]=preset[k];designRanges[k].slider.doubleValue=preset[k];designRanges[k].value.stringValue=$(preset[k]+' ms');});
            p.selectItemAtIndex(values.indexOf(core.speedPreset(settings,uiSpec.timing.presets)));saveSettings();scanAt=0;syncReactionTimer();render(true);return;
        }
        settings[key] = values[Number(p.indexOfSelectedItem)]; words = strings[settings.language]; saveSettings(); syncSettings(); render(true);
        if (key === 'language') buildSettings();
    };
    parent.addSubview(p); fields[key] = {popup: p, values: values}; return p;
}
function uiRange(parent,key,name,y,min,max,step,unit) {
    uiText(parent,name,16,y,445,22,11.5,true);
    var value=uiText(parent,settings[key]+unit,475,y,107,22,11);value.textColor=color('#a5e4ce');value.alignment=$.NSTextAlignmentRight;
    var slider=$.NSSlider.alloc.initWithFrame($.NSMakeRect(16,y+25,566,22));slider.minValue=min;slider.maxValue=max;slider.doubleValue=settings[key];slider.continuous=true;
    slider.tag=++actionId;slider.target=delegate;slider.action='action:';
    actions[actionId]=function(){
        settings[key]=Math.max(min,Math.min(max,min+Math.round((Number(slider.doubleValue)-min)/step)*step));
        slider.doubleValue=settings[key];value.stringValue=$(settings[key]+unit);
        if(speedPopup)speedPopup.selectItemAtIndex(['fast','default','relaxed','custom'].indexOf(core.speedPreset(settings,uiSpec.timing.presets)));
        saveSettings();scanAt=0;syncReactionTimer();render(true);
    };
    parent.addSubview(slider);designRanges[key]={slider:slider,value:value};return slider;
}
function uiSection(parent, title, y, height) {
    var v = uiView($.NSMakeRect(0, y, 598, height), '#1c2628'); v.layer.borderWidth = 1; v.layer.borderColor = color('#2b393c').CGColor;
    uiText(v, title, 16, 13, 566, 22, 11, false, true).textColor = color('#a5e4ce'); parent.addSubview(v); return v;
}
function uiRule(parent, y) { parent.addSubview(uiView($.NSMakeRect(16, y, 566, 1), '#2b393c')); }
function syncPetAvailability() {
    if (!navButtons.above || !navButtons.below) return;
    // 열린 설정창의 감지 상태만 갱신한다. 사용자의 위/아래 선호값은 보존한다.
    var available = alive && !!pet;
    ['above', 'below'].forEach(function (key) {
        var button = navButtons[key];
        if (Boolean(button.enabled) !== available) {
            button.enabled = available; button.alphaValue = available ? 1 : 0.4;
        }
    });
}
function syncSettings() {
    [['short', 'shortReset'], ['weekly', 'weeklyReset'], ['tickets', 'expiry'], ['resetNotice', 'resetSound'], ['creditNotice', 'creditSound']].forEach(function (p) {
        fields[p[1]].button.enabled = !!settings[p[0]];
        if (!settings[p[0]]) {settings[p[1]]=false;fields[p[1]].button.state=0;}
        paintSwitch(fields[p[1]]);
    });
    fields.short.button.enabled = !core.pro(data); if (core.pro(data)) fields.shortReset.button.enabled = false;
    paintSwitch(fields.short); paintSwitch(fields.shortReset); settingsProOverlay.hidden = !core.pro(data);
    syncPetAvailability();
    ['above', 'below', 'free', 'hidden'].forEach(function (key) { var b = navButtons[key]; b.layer.backgroundColor = color(settings.placement === key ? '#a5e4ce' : '#233236').CGColor; b.contentTintColor = color(settings.placement === key ? '#101617' : '#edf4f1'); b.alphaValue = b.enabled ? 1 : 0.4; });
}
var settingsProOverlay;
var updateStatus;
function syncUpdateStatus(){
    if(!updateStatus)return;var status=(readJSON(home+'/updates.json')||{}).status;
    var key=!alive?'sleeping':status==='installed'?'update_latest':status==='applying'?'update_downloading':status==='recovery_required'?'update_failed':strings.ko[status]?status:'update_idle';
    updateStatus.stringValue=$(t(key));
}
function selectSettingsPage(name) {
    settingsPage = name;
    ['settings', 'style', 'creator'].forEach(function (key) { settingsPages[key].hidden = key !== name; navButtons[key].layer.backgroundColor = color(key === name ? '#2b393c' : '#151d1f').CGColor; navButtons[key].contentTintColor = color(key === name ? '#a5e4ce' : '#99aeaa'); });
}
function buildSettings() {
    fields = {}; styleFields = {}; navButtons = {}; settingsPages = {};designRanges={};speedPopup=null;
    var outer = uiView($.NSMakeRect(0, 0, 840, 720), '#101617'); settingsWindow.contentView = outer;
    var sidebar = uiView($.NSMakeRect(0, 0, 154, 720), '#151d1f'); outer.addSubview(sidebar);
    var art = $.NSImageView.alloc.initWithFrame($.NSMakeRect(17, 22, 120, 180)); art.image = $.NSImage.alloc.initWithContentsOfFile($(root + '/assets/gp-chan-monitor.png')); art.imageScaling = $.NSImageScaleProportionallyUpOrDown; sidebar.addSubview(art);
    ['settings', 'style', 'creator'].forEach(function (key, i) { navButtons[key] = uiButton(sidebar, t(key), 12, 226 + i * 50, 130, function () { selectSettingsPage(key); }); navButtons[key].font = $.NSFont.boldSystemFontOfSize(13); });
    uiButton(sidebar, t('refresh'), 22, 575, 110, function () { nextUsage = 0; nextFeed = 0; });
    uiButton(sidebar, t('quit'), 22, 619, 110, shutdown); uiText(sidebar, 'DAY 001\nv' + defaults.version, 24, 677, 110, 34, 10, true);
    uiText(outer, t('appearance'), 182, 26, 630, 36, 23, false, true);
    uiText(outer, t('saved'), 182, 694, 630, 20, 10, true);
    ['settings', 'style', 'creator'].forEach(function (key) {
        var scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(182, 82, 630, 598)); scroll.hasVerticalScroller = true; scroll.drawsBackground = false;
        var document = uiView($.NSMakeRect(0, 0, 610, key === 'settings' ? 1460 : key === 'style' ? (advancedExpanded?1370:1048) : 520)); scroll.documentView = document; outer.addSubview(scroll); settingsPages[key] = scroll;
    });
    var general = settingsPages.settings.documentView, section = uiSection(general, t('position'), 0, 150);
    uiText(section, t('position_hint'), 16, 38, 566, 28, 10, true);
    ['above', 'below', 'free', 'hidden'].forEach(function (key, i) {
        navButtons[key] = uiButton(section, t(key), 16 + (i % 2) * 289, 68 + Math.floor(i / 2) * 42, 277, function () {
            if (key === 'free') { settings.x = cards.main.x; settings.y = cards.main.y; }
            settings.placement = key; if (key === 'above' || key === 'below') settings.attachedPlacement = key;
            saveSettings(); syncSettings(); render(true);
        });
    });
    section = uiSection(general, t('data'), 162, 546); uiChoice(section, 'usageDisplay', t('usage_group'), ['used', 'remaining'], [t('displayUsed'), t('displayRemaining')], 38);
    ['short', 'weekly'].forEach(function (key, i) {
        var box = uiView($.NSMakeRect(16 + i * 289, 76, 277, 114), '#1c2628'); box.layer.borderWidth = 1; box.layer.borderColor = color('#2b393c').CGColor;
        uiText(box, t(key + '_group'), 12, 9, 253, 22, 11, false, true).textColor = color('#a5e4ce');
        uiSwitch(box, key, t(key), 12, 34, 253); uiSwitch(box, key + 'Reset', t(key + '_reset'), 12, 72, 253); section.addSubview(box);
        if (key === 'short') { settingsProOverlay = uiView($.NSMakeRect(0, 0, 277, 114), '#1c2628'); uiText(settingsProOverlay, t('pro_short_hint'), 12, 32, 253, 64, 11, true); box.addSubview(settingsProOverlay); }
    });
    uiRule(section, 200); uiText(section, t('reset_group'), 16, 216, 566, 22, 11, true, true);
    uiSwitch(section, 'tickets', t('ticket_count'), 16, 240, 277); uiSwitch(section, 'expiry', t('nearest_expiry'), 305, 240, 277);
    uiSwitch(section, 'resetNotice', t('resetNotice'), 16, 278, 277); uiSwitch(section, 'resetSound', t('announcement_sound'), 305, 278, 277);
    uiChoice(section, 'resetMinutes', t('reset_interval_minutes'), [10,30,60,120], [t('interval_minutes').replace('{n}','10'),t('interval_minutes').replace('{n}','30'),t('interval_hours').replace('{n}','1'),t('interval_hours').replace('{n}','2')], 320);
    uiText(section, t('reset_interval_hint') + '\n' + t('reset_provider'), 16, 359, 566, 42, 9.5, true); uiRule(section, 407);
    uiSwitch(section, 'balance', t('credit_data'), 16, 420, 277); uiSwitch(section, 'creditNotice', t('credit_warning'), 305, 420, 277); uiSwitch(section, 'creditSound', t('credit_sound'), 305, 458, 277);
    uiChoice(section, 'creditStep', t('credit_interval'), [1000,3000,5000,10000], ['1,000','3,000','5,000','10,000'].map(function(n){return t('interval_credits').replace('{n}',n);}), 502);
    section = uiSection(general, t('startup_group'), 720, 148);
    settings.startupEnabled = $.NSFileManager.defaultManager.fileExistsAtPath($(unwrap($.NSHomeDirectory()) + '/Library/LaunchAgents/com.dailyoddbuilds.codex-usage-scripts.plist'));
    uiSwitch(section, 'startupEnabled', t('startup_register'), 16, 38, 566, function (value) { settings.startupEnabled = value; setStartup(value); });
    uiSwitch(section, 'startupPromptDismissed', t('startup_never'), 16, 76, 566);
    uiText(section, t('startupHint'), 16, 114, 566, 28, 10, true);
    section = uiSection(general, t('regional'), 880, 162);
    uiChoice(section, 'language', t('language'), ['ko','en','zh','ja'], ['한국어','English','中文','日本語'], 38);
    var zones = ['system','UTC','Asia/Seoul','Asia/Tokyo','Asia/Shanghai','America/Los_Angeles','America/New_York','Europe/London','Europe/Berlin']; uiChoice(section, 'timezone', t('timezone'), zones, zones, 80);
    uiText(section, t('region_hint'), 16, 125, 566, 26, 10, true);
    section = uiSection(general, t('rpc_path'), 1054, 132);
    var path = $.NSTextField.alloc.initWithFrame($.NSMakeRect(16, 38, 566, 32)); path.stringValue = $(settings.codexPath); path.backgroundColor = color('#101617'); path.textColor = color('#edf4f1'); path.font = $.NSFont.systemFontOfSize(12); section.addSubview(path);
    uiButton(section, t('save'), 16, 82, 125, function () { settings.codexPath = unwrap(path.stringValue); saveSettings(); stopRPC(); nextUsage = 0; });
    section = uiSection(general, t('update_group'), 1198, 250);
    uiSwitch(section,'autoUpdate',t('auto_update'),16,38,566);
    uiText(section,t('update_policy'),16,76,566,60,10,true);
    uiButton(section,t('update_check'),16,140,180,function(){startUpdate(true);});
    updateStatus=uiText(section,t('update_idle'),16,185,566,52,10,true);syncUpdateStatus();
    var style = settingsPages.style.documentView;
    ['main','credit','reset'].forEach(function (g, i) {
        var box = uiSection(style, t('style_' + g), i * 242, 230);
        var preview = uiView($.NSMakeRect(305, 56, 277, 104), settings.styles[g].color, 30); preview.layer.backgroundColor=color(settings.styles[g].color,settings.styles[g].opacity).CGColor; preview.layer.borderWidth = 1; preview.layer.borderColor = color('#FFFFFF',48/255).CGColor;
        var sampleText = g === 'main' ? t('week')+' 27% ('+t('reset')+' 5d 18:53) '+t('used')+'\n'+t('tickets')+' 3 · '+t('expires')+' 14d 12h\n'+t('balance')+' 62,500' : g === 'credit' ? t('credit_started') + '\n' + t('balance') + ' 62,500' : t('reset_stored')+' '+t('notice_reset')+' · '+t('notice_after').replace('{value}', '2h 30m')+' '+t('estimated');
        var sample = uiText(preview, sampleText, 16, 8, 245, 88, 11.5); sample.textColor = color(core.styleInk(settings.styles[g],g)); box.addSubview(preview);
        ['color','text'].forEach(function (key, j) {
            uiText(box, t(key === 'color' ? 'background_color' : 'text_color'), 16, 38 + j * 64, 265, 20, 10.5, true);
            var input = $.NSTextField.alloc.initWithFrame($.NSMakeRect(16, 60 + j * 64, 265, 32)); input.stringValue = $(settings.styles[g][key]); input.backgroundColor = color('#101617'); input.textColor = color('#edf4f1'); input.font = $.NSFont.systemFontOfSize(10.5); box.addSubview(input);
            input.tag = ++actionId; input.target = delegate; input.action = 'action:';
            styleFields[g+'.'+key]=input;if(key==='text')input.enabled=!settings.styles[g].autoText;
            actions[actionId] = function () { var value = unwrap(input.stringValue); if (!/^#[0-9a-f]{6}$/i.test(value)) { alert(t('invalid_color')); return; } settings.styles[g][key] = value; preview.layer.backgroundColor = color(settings.styles[g].color, settings.styles[g].opacity).CGColor; sample.textColor = color(core.styleInk(settings.styles[g],g)); saveSettings(); render(true); };
        });
        var auto=button(t('auto_contrast'),$.NSMakeRect(305,178,277,26),function(){settings.styles[g].autoText=Number(auto.state)===1;styleFields[g+'.text'].enabled=!settings.styles[g].autoText;sample.textColor=color(core.styleInk(settings.styles[g],g));saveSettings();render(true);},true);auto.state=settings.styles[g].autoText?1:0;auto.font=$.NSFont.systemFontOfSize(10.5);box.addSubview(auto);
        uiText(box, t('background_transparency'), 16, 172, 265, 20, 11.5, true);
        var slider = $.NSSlider.alloc.initWithFrame($.NSMakeRect(16, 196, 265, 22)); slider.minValue = 0; slider.maxValue = 90; slider.doubleValue = (1-settings.styles[g].opacity)*100; slider.continuous = true;
        slider.tag = ++actionId; slider.target = delegate; slider.action = 'action:'; actions[actionId] = function () { settings.styles[g].opacity = 1-Number(slider.doubleValue)/100; preview.layer.backgroundColor = color(settings.styles[g].color,settings.styles[g].opacity).CGColor; saveSettings(); render(true); }; box.addSubview(slider);
    });
    var spacing=uiSection(style,t('spacing_group'),726,250);
    ['gapAbove','gapBelow','noticeGap'].forEach(function(k,i){uiRange(spacing,k,t(k),38+i*60,uiSpec.spacing.min,uiSpec.spacing.max,1,'');});
    uiText(spacing,t('spacing_hint'),16,219,566,26,10,true);
    var advanced=uiView($.NSMakeRect(0,988,598,advancedExpanded?370:48),'#1c2628');advanced.layer.borderWidth=1;advanced.layer.borderColor=color('#2b393c').CGColor;style.addSubview(advanced);
    var advancedBody=uiView($.NSMakeRect(0,48,598,322));advancedBody.hidden=!advancedExpanded;advanced.addSubview(advancedBody);
    var fold=uiButton(advanced,(advancedExpanded?'⌄ ':'› ')+t('advanced_settings'),16,6,566,function(){
        advancedExpanded=!advancedExpanded;fold.title=$((advancedExpanded?'⌄ ':'› ')+t('advanced_settings'));
        advancedBody.hidden=!advancedExpanded;advanced.setFrameSize($.NSMakeSize(598,advancedExpanded?370:48));style.setFrameSize($.NSMakeSize(610,advancedExpanded?1370:1048));
    });fold.contentTintColor=color('#a5e4ce');fold.layer.backgroundColor=color('#1c2628').CGColor;
    speedPopup=uiChoice(advancedBody,'speedPreset',t('response_preset'),['fast','default','relaxed','custom'],[t('speed_fast'),t('speed_default'),t('speed_relaxed'),t('speed_custom')],0);
    ['dragMs','idleMs','chromeMs','motionMs'].forEach(function(k,i){var limit=uiSpec.timing.limits[k];uiRange(advancedBody,k,t(k),36+i*54,limit.min,limit.max,limit.step,' ms');});
    uiText(advancedBody,t('response_hint'),16,251,566,34,9.5,true);
    uiText(advancedBody,t('response_warning'),16,293,566,22,11).textColor=color('#f3cc86');
    var about = uiSection(settingsPages.creator.documentView, t('creator'), 0, 478);
    uiButton(about, 'hssum9409 ↗', 16, 38, 220, function () {openLink('https://github.com/hssum9409');}, true).font = $.NSFont.boldSystemFontOfSize(24);
    uiText(about, t('creator_info'), 16, 96, 566, 150, 13, true);
    uiButton(about, 'GitHub ↗', 16, 254, 125, function () {openLink('https://github.com/hssum9409/daily_odd_builds-public/issues');}); uiButton(about, 'Daily Odd Builds ↗', 153, 254, 190, function () {openLink('https://daily-odd-builds-portal.web.app');});
    uiText(about, 'Day 001 · Codex Usage Monitor Scripts\nv' + defaults.version, 16, 314, 566, 42, 11);
    uiText(about, t('source_note') + '\n' + t('reset_provider'), 16, 368, 566, 54, 10, true); uiButton(about, 'Data from Codex Resets ↗', 16, 427, 235, function () {openLink('https://codex-resets.com/');});
    settingsSync = syncSettings; syncSettings(); selectSettingsPage(settingsPage);
}
function showSettings() {
    if (!settingsWindow) {
        settingsWindow = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0,0,840,720), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable | $.NSWindowStyleMaskMiniaturizable, $.NSBackingStoreBuffered, false);
        settingsWindow.title = $('Codex Usage Monitor'); settingsWindow.releasedWhenClosed = false; settingsWindow.center; buildSettings();
    }
    syncPetAvailability(); settingsWindow.makeKeyAndOrderFront(null); app.activateIgnoringOtherApps(true);
}

// 모니터의 주기 갱신에서도 같은 설정창 클로저를 사용한다. 전역 함수에 의존하지 않는다.
({show: showSettings, syncPetAvailability: syncPetAvailability, syncUpdateStatus: syncUpdateStatus});
