/* 순수 로직: AppKit/네트워크 없이도 양 플랫폼에서 같은 경계값을 검증한다. */
var MonitorCore = (function () {
    'use strict';
    function finite(n) { return typeof n === 'number' && isFinite(n); }
    function number(n) { return n !== null && n !== '' && typeof n !== 'boolean' && isFinite(Number(n)); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function styleInk(style,kind) {
        if (!style.autoText) return style.text;
        var bases={main:'#202020',credit:'#802b31',reset:'#fae297'};
        if (style.color.toLowerCase()===bases[kind]) return kind==='reset' ? '#372c16' : '#f8f8f8';
        var weights=[0.2126,0.7152,0.0722], luminance=0;
        for(var i=0;i<3;i++) {var n=parseInt(style.color.substr(1+i*2,2),16)/255; luminance+=(n<=0.04045 ? n/12.92 : Math.pow((n+0.055)/1.055,2.4))*weights[i];}
        return (0.938686+0.05)/(luminance+0.05)>=(luminance+0.05)/(0.0267151659402045+0.05) ? '#f8f8f8' : '#372c16';
    }
    function wrapFooter(text,width,linkWidth,measure) {
        var lines=[], remaining=text;
        while(remaining) {
            var fit=0;
            for(var i=1;i<=remaining.length;i++) {if(measure(remaining.substr(0,i))>width)break;fit=i;}
            if(fit<remaining.length) {var space=remaining.substr(0,Math.max(1,fit)).lastIndexOf(' ');if(space>0)fit=space;}
            fit=Math.max(1,fit);lines.push(remaining.substr(0,fit).trim());remaining=remaining.substr(fit).replace(/^\s+/, '');
        }
        var last=lines[lines.length-1] || '';
        if(measure(last)>width-linkWidth-12) {
            var split=last.length;while(split>0 && measure(last.substr(0,split))>width-linkWidth-12)split--;
            var boundary=last.substr(0,Math.max(1,split)).lastIndexOf(' ');if(boundary>0)split=boundary;split=Math.max(1,split);
            lines[lines.length-1]=last.substr(0,split).trim();lines.push(last.substr(split).trim());
        }
        return lines;
    }
    function normalize(raw, defaults) {
        var s = clone(defaults), k, group, item;
        raw = raw && typeof raw === 'object' ? raw : {};
        for (k in s) {
            if (typeof s[k] === 'boolean' && typeof raw[k] === 'boolean') s[k] = raw[k];
        }
        ['language', 'timezone', 'usageDisplay', 'placement', 'attachedPlacement'].forEach(function (key) {
            var allowed = {language: ['ko', 'en', 'zh', 'ja'], timezone: ['system', 'UTC', 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin'], usageDisplay: ['used', 'remaining'], placement: ['above', 'below', 'free', 'hidden'], attachedPlacement: ['above', 'below']};
            if (allowed[key].indexOf(raw[key]) >= 0) s[key] = raw[key];
        });
        if ([10, 30, 60, 120].indexOf(raw.resetMinutes) >= 0) s.resetMinutes = raw.resetMinutes;
        if ([1000, 3000, 5000, 10000].indexOf(raw.creditStep) >= 0) s.creditStep = raw.creditStep;
        if (finite(raw.pollSeconds)) s.pollSeconds = Math.max(10, Math.min(300, raw.pollSeconds));
        var ranges={gapAbove:[0,40],gapBelow:[0,40],noticeGap:[0,40],dragMs:[16,100],idleMs:[100,500],chromeMs:[250,2000],motionMs:[80,300]};
        Object.keys(ranges).forEach(function(key){if(finite(raw[key]))s[key]=Math.round(Math.max(ranges[key][0],Math.min(ranges[key][1],raw[key])));});
        if (typeof raw.codexPath === 'string') s.codexPath = raw.codexPath;
        ['x', 'y'].forEach(function (key) { if (finite(raw[key])) s[key] = raw[key]; });
        for (group in s.styles) {
            item = raw.styles && raw.styles[group];
            if (!item) continue;
            ['color', 'text'].forEach(function (key) { if (/^#[0-9a-f]{6}$/i.test(item[key] || '')) s.styles[group][key] = item[key]; });
            if (finite(item.opacity)) s.styles[group].opacity = Math.max(0.1, Math.min(1, item.opacity));
            if (typeof item.autoText === 'boolean') s.styles[group].autoText = item.autoText;
        }
        [['short','shortReset'],['weekly','weeklyReset'],['tickets','expiry'],['resetNotice','resetSound'],['creditNotice','creditSound']].forEach(function (p) {if (!s[p[0]]) s[p[1]]=false;});
        return s;
    }
    function buckets(data) {
        data = data || {};
        var multi = data.rateLimitsByLimitId;
        if (multi && Object.keys(multi).length) return Object.keys(multi).filter(function (k) { return multi[k] && typeof multi[k] === 'object'; }).map(function (k) { return multi[k]; });
        return data.rateLimits ? [data.rateLimits] : [];
    }
    function pro(data) { return buckets(data).some(function (b) { return String(b.planType).toLowerCase() === 'pro'; }); }
    function duration(at, now, omitMinutes) {
        if (!finite(at)) return '—';
        var mins = Math.max(0, Math.floor((at - now) / 60)), days = Math.floor(mins / 1440), hours = Math.floor(mins % 1440 / 60);
        return (days ? days + 'd ' : '') + (hours < 10 && days ? '0' : '') + hours + (days && omitMinutes ? 'h' : ':' + ('0' + mins % 60).slice(-2));
    }
    function credit(value) {
        if (!number(value) || Number(value) < 0) return '—';
        // 소수점 9자리의 잔액도 필요한 소수만 남기고 3자리마다 쉼표를 넣는다.
        var raw = String(value).replace(/^\+/, ''), scientific = /^([0-9]+)(?:\.([0-9]*))?[eE]([+-]?[0-9]+)$/.exec(raw);
        if (scientific) {
            var digits = scientific[1] + (scientific[2] || ''), point = scientific[1].length + Number(scientific[3]);
            if (Math.abs(point) > 100) return '—';
            if (point <= 0) raw = '0.' + new Array(1 - point).join('0') + digits;
            else if (point >= digits.length) raw = digits + new Array(point - digits.length + 1).join('0');
            else raw = digits.slice(0, point) + '.' + digits.slice(point);
        }
        var parts = raw.split('.'); parts[0] = parts[0].replace(/^0+(?=\d)/, '');
        var fraction = (parts[1] || '').replace(/0+$/, '');
        return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
    }
    function tickets(data, now) {
        var r = data && data.rateLimitResetCredits, rows = [];
        if (r && Array.isArray(r.credits)) rows = r.credits.filter(function (c) { return c && c.status === 'available' && (!finite(c.expiresAt) || c.expiresAt > now); });
        var dated = rows.filter(function (c) { return finite(c.expiresAt); }).map(function (c) { return c.expiresAt; });
        return {count: r && finite(r.availableCount) ? r.availableCount : null, expiry: dated.length ? Math.min.apply(Math, dated) : null, rows: rows};
    }
    function render(data, s, now, words) {
        var list = buckets(data), windows = [], balance = null, unlimited = false, shortShown = false, rows = [], detail = tickets(data, now);
        list.forEach(function (b) {
            ['primary', 'secondary'].forEach(function (key) {
                var w = b[key];
                if (!w) return;
                var weekly = finite(w.windowDurationMins) && w.windowDurationMins >= 1440;
                if (weekly ? !s.weekly : (!s.short || pro(data))) return;
                windows.push({w: w, weekly: weekly});
                if (!weekly) shortShown = true;
            });
            if (b.credits) { balance = b.credits.balance; unlimited = b.credits.unlimited === true; }
        });
        windows.forEach(function (v) {
            var w = v.w, n = finite(w.usedPercent) ? Math.max(0, Math.min(100, w.usedPercent)) : null;
            if (n !== null && s.usageDisplay === 'remaining') n = 100 - n;
            var text = (v.weekly ? words.weekly : (w.windowDurationMins === 300 ? '5h' : 'Window')) + ' ' + (n === null ? '—' : Math.round(n * 10) / 10 + '%');
            if (v.weekly ? s.weeklyReset : s.shortReset) text += ' (' + words.reset + ' ' + duration(w.resetsAt, now, v.weekly && shortShown) + ')';
            rows.push(text);
        });
        var lines = [];
        if (rows.length) lines.push(rows.join(' · ') + ' ' + (s.usageDisplay === 'remaining' ? words.remaining : words.used));
        if (s.tickets || s.expiry) {
            var ticketLine = s.tickets ? words.tickets + ' ' + (detail.count === null ? '—' : (words.count || '{n}').replace('{n}',detail.count)) : '';
            if (s.expiry) ticketLine += (ticketLine ? ' · ' : '') + words.expires + ' ' + duration(detail.expiry, now, true);
            lines.push(ticketLine);
        }
        if (s.balance) lines.push(words.balance + ' ' + (unlimited ? '∞' : credit(balance)));
        return {lines: lines.length ? lines : [words.noData], tickets: detail, balance: balance, unlimited: unlimited, pro: pro(data)};
    }
    function scheduled(payload, now) {
        var a = payload && payload.data && payload.data.scheduled_reset;
        if (!a || a.status !== 'scheduled' || !/^[a-z0-9_-]{1,64}$/i.test(a.id || '') || ['regular', 'banked'].indexOf(a.reset_type) < 0) return null;
        var at = typeof a.scheduled_for === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(a.scheduled_for) ? Date.parse(a.scheduled_for) / 1000 : NaN;
        var source = a.source || {}, url = source.author === 'thsottiaux' && /^https:\/\/(?:x|twitter)\.com\/thsottiaux\/status\/\d+(?:\?.*)?$/.test(source.url || '') ? source.url : '';
        return {id: a.id, type: a.reset_type, at: isFinite(at) ? at : null, url: url};
    }
    function reminderKey(a, now, minutes) {
        if (!a || !finite(a.at)) return a ? a.id + ':pending' : '';
        var remain = Math.max(0, a.at - now), milestones = [3600, 1800, 600, 300, 60, 0], key = Math.ceil(remain / (minutes * 60));
        for (var i = 0; i < milestones.length; i++) if (remain <= milestones[i]) key = 'm' + milestones[i];
        return a.id + ':' + key;
    }
    function forecast(a, now, words) {
        var mins = a && finite(a.at) ? Math.max(0, Math.ceil((a.at - now) / 60)) : null, days, hours;
        if (mins === null) return words.pending;
        if (!mins) return words.due;
        days = Math.floor(mins / 1440); hours = Math.floor(mins % 1440 / 60);
        return days ? days + words.day + ' ' + hours + words.hour : Math.floor(mins / 60) + words.hour + ' ' + mins % 60 + words.minute;
    }
    function creditEvent(state, data, step) {
        var list = buckets(data), b = list.length ? list[0] : {}, c = b.credits || {}, value = Number(c.balance);
        var cycle = [b.primary && b.primary.resetsAt, b.secondary && b.secondary.resetsAt].join(':');
        if (c.unlimited || !number(c.balance) || value < 0) { state.previous = null; return false; }
        var old = state.previous, changed = old !== null && old !== undefined && state.cycle === cycle && value < old;
        var event = changed && (!state.consuming || Math.ceil(value / step) < Math.ceil(old / step));
        if (old === null || old === undefined || state.cycle !== cycle || value > old) state.consuming = false;
        if (changed) state.consuming = true;
        state.previous = value; state.cycle = cycle;
        return event;
    }
    function retryDelay(header, now, previous) {
        var value = /^\d+$/.test(header || '') ? Number(header) : (Date.parse(header) / 1000 - now);
        return isFinite(value) ? Math.max(60, Math.min(86400, Math.ceil(value))) : Math.min(900, Math.max(60, previous * 2));
    }
    function lifecycle(s, alive, pet, now, state) {
        if (!alive) { state.missingSince = null; return 'idle'; }
        if (s.placement === 'hidden') return 'hidden';
        if (s.placement === 'free') return 'free';
        if (pet) { state.missingSince = null; return s.placement; }
        if (state.missingSince === null || state.missingSince === undefined) state.missingSince = now;
        // 드래그 중 잠깐 사라진 창을 Hide Pet으로 오인하지 않는다. 설정값은 덮어쓰지 않는다.
        return now - state.missingSince < 1 ? 'waiting' : 'free';
    }
    function speedPreset(settings,presets) {
        var names=['fast','default','relaxed'];
        for(var i=0;i<names.length;i++) {var p=presets[names[i]];if(['dragMs','idleMs','chromeMs','motionMs'].every(function(k){return settings[k]===p[k];}))return names[i];}
        return 'custom';
    }
    function reactionInterval(settings,alive,pressed) {return !alive ? 2000 : pressed ? settings.dragMs : settings.idleMs;}
    function place(pet, blockers, screen, width, height, preferred, insets, settings) {
        if (width <= 0 || height <= 0 || width > screen.w || height > screen.h) return null;
        var x = Math.max(screen.x, Math.min(screen.x + screen.w - width, pet.x + pet.w / 2 - width / 2)), above = pet.y, below = pet.y + pet.h;
        blockers.forEach(function (b) { if (b.x + b.w > x && b.x < x + width) { if (b.y + b.h <= pet.y + 3) above = Math.min(above, b.y); if (b.y >= pet.y + pet.h - 3) below = Math.max(below, b.y + b.h); } });
        // Measure the gap from the visible border, excluding transparent window margins.
        insets = insets || {top: 0, bottom: 0};
        var top = above - height - (settings ? settings.gapAbove : 6) + insets.bottom, bottom = below + (settings ? settings.gapBelow : 12) - insets.top, fitsTop = top >= screen.y, fitsBottom = bottom + height <= screen.y + screen.h;
        var side = preferred === 'above' ? (fitsTop ? 'above' : fitsBottom ? 'below' : null) : (fitsBottom ? 'below' : fitsTop ? 'above' : null);
        return side ? {x: x, y: side === 'above' ? top : bottom, side: side} : null;
    }
    return {finite: finite, wrapFooter: wrapFooter, styleInk: styleInk, normalize: normalize, buckets: buckets, pro: pro, duration: duration, credit: credit, tickets: tickets, render: render, scheduled: scheduled, reminderKey: reminderKey, forecast: forecast, creditEvent: creditEvent, retryDelay: retryDelay, lifecycle: lifecycle, place: place, speedPreset: speedPreset, reactionInterval: reactionInterval};
}());
if (typeof module !== 'undefined') module.exports = MonitorCore;
