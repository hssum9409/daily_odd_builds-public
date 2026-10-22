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
        if (!finite(now)) now = Date.now() / 1000;
        var a = payload && payload.data && payload.data.scheduled_reset;
        // 예고가 있으면 우선한다. 조짐의 유효기간은 초기화 예정 시각으로 쓰지 않는다.
        if (a && a.status === 'scheduled' && /^[a-z0-9_-]{1,64}$/i.test(a.id || '') && ['regular', 'banked'].indexOf(a.reset_type) >= 0) {
            var announced = utcSeconds(a.announced_at), latest = payload.data.latest_reset;
            var done = utcSeconds(latest && latest.announced_at);
            if (finite(announced) && finite(done) && done >= announced && latest.reset_type === a.reset_type) return null;
            return {id: a.id, type: a.reset_type, at: utcSeconds(a.scheduled_for), url: resetSource(a.source), announcedAt: announced};
        }
        var w = payload && payload.data && payload.data.active_watch;
        if (!w) return null;
        var url = resetSource(w.source), until = utcSeconds(w.expires_at), observed = utcSeconds(w.observed_at);
        if (!url || !finite(until) || until <= now) return null;
        // 후속 리셋 완료가 확인됐으면 이전 게시물의 조짐은 다시 띄우지 않는다.
        var completed = utcSeconds(payload.data.latest_reset && payload.data.latest_reset.announced_at);
        if (finite(observed) && finite(completed) && completed >= observed) return null;
        return {id: 'watch-' + /\/status\/(\d+)/.exec(url)[1], type: 'watch', at: null, until: until, url: url};
    }
    function utcSeconds(value) {
        var at = typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) / 1000 : NaN;
        return isFinite(at) ? at : null;
    }
    function resetSource(source) {
        return source && source.author === 'thsottiaux' && /^https:\/\/(?:x|twitter)\.com\/thsottiaux\/status\/\d+(?:\?.*)?$/.test(source.url || '') ? source.url : '';
    }
    function noticeActive(a, now) {
        if (!a) return false;
        if (a.type === 'watch') return finite(a.until) && now < a.until;
        // 예정 시각은 보장이 아니다. 6시간은 '확인 중'으로 두고, 무기한 예고를 방지한다.
        if (finite(a.at)) return now < a.at + 21600;
        var since = finite(a.announcedAt) ? a.announcedAt : a.seenAt;
        return !finite(since) || now < since + 172800;
    }
    function noticeTitle(a, now, words) {
        // forecast_window는 최초 범위다. 캐시된 응답도 매 렌더링마다 종료 시각에서 남은 시간을 계산한다.
        if (a && a.type === 'watch') return words.reset_watch + ' · ' + (finite(a.until) && a.until > now ? words.watch_within.replace('{value}', forecastUntil(a.until, now, words)) : words.watch_pending);
        var detail = a && finite(a.at) && now >= a.at ? words.reset_verifying : words.notice_after.replace('{value}', forecast(a, now, words)) + ' ' + words.estimated;
        return (a && a.type === 'banked' ? words.reset_stored : words.reset_normal) + ' ' + words.notice_reset + ' · ' + detail;
    }
    function reminderKey(a, now, minutes) {
        if (!noticeActive(a, now)) return '';
        // 조짐에는 실제 예정 시각이 없다. 설정된 간격에만 다시 알리고 시각 임계값은 적용하지 않는다.
        if (a.type === 'watch') return a.id + ':watch:' + Math.floor(now / (minutes * 60));
        if (!finite(a.at)) return a.id + ':pending:' + Math.floor(now / (minutes * 60));
        var remain = Math.max(0, a.at - now), milestones = [3600, 1800, 600, 300, 60, 0], key = Math.ceil(remain / (minutes * 60));
        // 선택 주기와 필수 임계값을 결합한다. 임계값으로 주기를 덮어쓰면 50/40/20분이 빠진다.
        var milestone = null;
        for (var i = 0; i < milestones.length; i++) if (remain <= milestones[i]) milestone = milestones[i];
        if (milestone !== null) key += ':m' + milestone;
        return a.id + ':' + key;
    }
    function legacyReminderKey(a, now, minutes) {
        if (!noticeActive(a, now)) return '';
        if (a.type === 'watch') return reminderKey(a, now, minutes);
        if (!finite(a.at)) return a.id + ':pending';
        var remain = Math.max(0, a.at - now), key = Math.ceil(remain / (minutes * 60));
        [3600,1800,600,300,60,0].forEach(function (m) { if (remain <= m) key = 'm' + m; });
        return a.id + ':' + key;
    }
    function feedValue(payload, now, previous) {
        var d = payload && payload.data, own = Object.prototype.hasOwnProperty;
        if (!d || typeof d !== 'object' || Array.isArray(d) || (!own.call(d, 'scheduled_reset') && !own.call(d, 'active_watch'))) throw new Error('feed_schema');
        var a = d.scheduled_reset, w = d.active_watch;
        if (a != null && (typeof a !== 'object' || !/^[a-z0-9_-]{1,64}$/i.test(a.id || '') || ['regular','banked'].indexOf(a.reset_type) < 0 || ['scheduled','completed','cancelled'].indexOf(a.status) < 0 || !resetSource(a.source) || (a.scheduled_for != null && !finite(utcSeconds(a.scheduled_for))))) throw new Error('feed_schema');
        if (w != null && (typeof w !== 'object' || !resetSource(w.source) || !finite(utcSeconds(w.expires_at)))) throw new Error('feed_schema');
        var value = scheduled(payload, now);
        if (value) value.seenAt = previous && previous.id === value.id && finite(previous.seenAt) ? previous.seenAt : now;
        return value;
    }
    function feedCache(record, now) {
        if (!record || record.version !== 1 || !finite(record.checkedAt) || record.checkedAt > now + 300 || now - record.checkedAt >= 172800 || !Object.prototype.hasOwnProperty.call(record, 'announcement')) return null;
        var a = record.announcement;
        if (a !== null && (!a || typeof a !== 'object' || !/^[a-z0-9_-]{1,80}$/i.test(a.id || '') || ['regular','banked','watch'].indexOf(a.type) < 0 || !resetSource({author:'thsottiaux',url:a.url}) || (a.type === 'watch' ? !finite(a.until) : a.at !== null && !finite(a.at)))) return null;
        return {version:1, checkedAt:record.checkedAt, etag:typeof record.etag === 'string' && record.etag.length <= 512 && !/[\r\n]/.test(record.etag) ? record.etag : '', announcement:a};
    }
    function noticeReason(a, checkedAt, now, enabled, show, dismissed) {
        if (!enabled) return 'disabled';
        if (!show) return 'monitor-hidden';
        if (!noticeActive(a, now)) return 'inactive';
        if (!finite(checkedAt) || checkedAt <= 0 || now - checkedAt >= 172800) return 'cache-expired';
        return dismissed ? 'dismissed' : 'visible';
    }
    function forecast(a, now, words) {
        return forecastUntil(a && a.at, now, words);
    }
    function forecastUntil(until, now, words) {
        var mins = finite(until) ? Math.max(0, Math.ceil((until - now) / 60)) : null, days, hours;
        if (mins === null) return words.pending;
        if (!mins) return words.due;
        days = Math.floor(mins / 1440); hours = Math.floor(mins % 1440 / 60);
        if (days === 1 && hours === 0) return '24' + words.hour;
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
    function positionSelection(settings, mode) {
        // 실행 중인 위치를 보여주되 대기/절전은 저장한 선호값을 유지한다. 설정을 변경하지 않는다.
        return ['above', 'below', 'free', 'hidden'].indexOf(mode) >= 0 ? mode : settings.placement;
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
    function fallbackLayout(pet, blockers, screen, sizes, preferred, gap) {
        // 합친 높이가 안 맞을 때 각 카드를 화면 안의 빈 영역으로 나눈다. 선호 설정은 변경하지 않는다.
        var occupied = (blockers || []).slice(), result = {}, overlap = false;
        if (pet) occupied.push(pet);
        ['main','reset','credit'].forEach(function (kind) {
            var size = sizes[kind]; if (!size) return;
            var w = Math.min(size.w, screen.w), h = Math.min(size.h, screen.h), anchor = result.main || pet || screen;
            var xs = [anchor.x + anchor.w / 2 - w / 2, anchor.x, screen.x, screen.x + screen.w - w];
            var ys = preferred === 'below' ? [anchor.y + anchor.h + gap, anchor.y - h - gap] : [anchor.y - h - gap, anchor.y + anchor.h + gap];
            ys.push(screen.y, screen.y + screen.h - h);
            occupied.forEach(function (b) { xs.push(b.x - w - gap, b.x + b.w + gap); ys.push(b.y - h - gap, b.y + b.h + gap); });
            var candidates = [];
            xs.forEach(function (x) { ys.forEach(function (y) {
                x = Math.max(screen.x, Math.min(screen.x + screen.w - w, x)); y = Math.max(screen.y, Math.min(screen.y + screen.h - h, y));
                var collisions = occupied.filter(function (b) { return x < b.x+b.w && x+w > b.x && y < b.y+b.h && y+h > b.y; }).length;
                candidates.push({x:x,y:y,w:w,h:h,collisions:collisions,score:Math.pow(x+w/2-anchor.x-anchor.w/2,2)+Math.pow(y+h/2-anchor.y-anchor.h/2,2)});
            }); });
            candidates.sort(function(a,b) { return a.collisions-b.collisions || a.score-b.score; });
            var chosen = candidates[0]; overlap = overlap || chosen.collisions > 0;
            result[kind] = chosen; occupied.push(chosen);
        });
        result.overlap = overlap; return result;
    }
    return {finite: finite, wrapFooter: wrapFooter, styleInk: styleInk, normalize: normalize, buckets: buckets, pro: pro, duration: duration, credit: credit, tickets: tickets, render: render, scheduled: scheduled, noticeActive: noticeActive, noticeTitle: noticeTitle, reminderKey: reminderKey, legacyReminderKey:legacyReminderKey, feedValue:feedValue, feedCache:feedCache, noticeReason:noticeReason, fallbackLayout:fallbackLayout, forecast: forecast, creditEvent: creditEvent, retryDelay: retryDelay, lifecycle: lifecycle, positionSelection: positionSelection, place: place, speedPreset: speedPreset, reactionInterval: reactionInterval};
}());
if (typeof module !== 'undefined') module.exports = MonitorCore;
