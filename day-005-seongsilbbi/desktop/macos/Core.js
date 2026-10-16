// Pure calculation and protocol helpers. No globals are installed by eval.
(function () {
    function duration(ms, seconds) { var s = Math.floor(Math.max(0, ms) / 1000); function p(n) { return String(n).length < 2 ? '0' + n : String(n); } return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + (seconds ? ':' + p(s % 60) : ''); }
    function date(ms, zone) { return new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms); }
    function view(snapshot, now) {
        var state = snapshot.state, today = date(now, state.timeZone), activeDay = snapshot.activeDay;
        var active = activeDay && activeDay.segments.filter(function (s) { return s.id === state.segmentId && s.deletedAt === null; })[0];
        var day = activeDay && activeDay.date === today ? activeDay : snapshot.days.filter(function (d) { return d.date === today; })[0];
        var work = 0, rest = 0;
        ((day && day.segments) || []).forEach(function (s) { if (s.deletedAt !== null) return; var length = Math.max(0, (s.end === null ? now : s.end) - s.start); if (s.kind === 'break') rest += length; else { work += length; } });
        var status = !active && state.dayId !== today ? 'idle' : state.status;
        var firstStart = !state.segmentId && !active && (!day || !day.segments.some(function (s) { return s.kind === 'work'; }));
        return { today: today, day: day, active: active, firstStart: firstStart, status: status, work: work, rest: rest, clock: duration(work, true), restClock: active && active.kind === 'break' ? duration(now - active.start, true) : null, timeline: timeline(day, now, state.dailyGoalMs), primary: active ? active.kind === 'break' ? 'resume' : 'pause' : 'clockIn', secondary: 'clockOut' };
    }
    function timeline(day, now, goal) {
        var rows = ((day && day.segments) || []).filter(function (s) { return s.deletedAt === null; }).slice().sort(function (a, b) { return a.start - b.start; });
        var total = 0, work = 0, cursor = 0;
        rows.forEach(function (s) { var length = Math.max(0, (s.end === null ? now : s.end) - s.start); total += length; if (s.kind === 'work') work += length; });
        var progress = goal > 0 ? Math.min(1, work / goal) : rows.length ? 1 : 0;
        var fallback = rows.filter(function (s) { return s.end === null; })[0] || rows[0];
        return { total: total, progress: progress, rows: rows.map(function (s) { var length = Math.max(0, (s.end === null ? now : s.end) - s.start), width = total > 0 ? length / total * progress : s === fallback ? progress : 0; var row = { id: s.id, kind: s.kind, title: s.title, length: length, left: cursor, width: width }; cursor += width; return row; }) };
    }
    function curlValue(value) { return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"'; }
    function appearance(saved) {
        saved = saved || {};
        function bounded(value, fallback) { return typeof value === 'number' && isFinite(value) ? Math.max(.1, Math.min(1, value)) : fallback; }
        return { idle: bounded(saved.opacityIdle, .45), hover: bounded(saved.opacityHover, bounded(saved.opacity, .95)) };
    }
    function design(saved, themes) {
        saved = saved || {};
        var theme = /^(cream|dark|custom)$/.test(saved.theme) ? saved.theme : 'cream';
        var legacy = !saved.theme && (saved.color || saved.text);
        // Move untouched old defaults to cream, but never discard a custom palette.
        if (legacy && ((saved.color || '#202020').toUpperCase() !== '#202020' || (saved.text || '#F8F8F8').toUpperCase() !== '#F8F8F8')) theme = 'custom';
        var base = themes[theme === 'dark' ? 'dark' : 'cream'], alpha = appearance(saved);
        function valid(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value.toUpperCase() : fallback; }
        var result = { theme: theme, color: theme === 'custom' ? valid(saved.color, base.color) : base.color, text: theme === 'custom' ? valid(saved.text, base.text) : base.text, opacityIdle: alpha.idle, opacityHover: alpha.hover, autoText: true, showStatus: false, showRest: false, showTitle: false, pinned: true };
        ['autoText', 'showStatus', 'showRest', 'showTitle', 'pinned'].forEach(function (key) { if (typeof saved[key] === 'boolean') result[key] = saved[key]; });
        ['x', 'y'].forEach(function (key) { if (typeof saved[key] === 'number' && isFinite(saved[key])) result[key] = saved[key]; });
        return result;
    }
    function palette(prefs, themes) {
        var rgb = prefs.color, bright = parseInt(rgb.slice(1, 3), 16) * .299 + parseInt(rgb.slice(3, 5), 16) * .587 + parseInt(rgb.slice(5, 7), 16) * .114;
        var base = themes[prefs.theme === 'custom' ? bright > 150 ? 'cream' : 'dark' : prefs.theme];
        return { color: prefs.color, text: prefs.autoText ? base.text : prefs.text, button: base.button, icon: base.icon, border: base.border, work: base.work, rest: base.rest, track: base.track };
    }
    return { duration: duration, date: date, view: view, timeline: timeline, appearance: appearance, design: design, palette: palette, curlValue: curlValue };
}());
