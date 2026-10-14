(() => {
  'use strict';

  const ns = globalThis.DCScrollHelper ??= {};
  const DEFAULTS = Object.freeze({
    moveDurationMs: 200,
    sampleMs: 50,
    stableMs: 1600,
    stableSamples: 6,
    missingMs: 5000,
    timeoutMs: 120000,
    tolerance: 4,
    inset: 16,
  });

  // One navigator owns one cancellable job. Resolvers always query the current DOM.
  function createNavigator({ doc = document, win = window, resolveTarget, onState = () => {}, config = {} }) {
    const options = { ...DEFAULTS, ...config };
    let active = null;
    const now = () => win.performance.now();
    const abortError = () => new DOMException('Navigation cancelled', 'AbortError');
    function check(signal) { if (signal.aborted) throw abortError(); }
    const scroller = () => doc.scrollingElement ?? doc.documentElement;
    const position = () => scroller().scrollTop;
    const viewport = () => scroller().clientHeight || win.innerHeight;
    const bottom = () => Math.max(0, scroller().scrollHeight - viewport());

    function move(top) {
      // 'instant' also interrupts any site/browser smooth scroll already in progress.
      win.scrollTo({ top: Math.max(0, Math.min(top, bottom())), left: win.scrollX, behavior: 'instant' });
    }

    async function moveQuickly(top, signal) {
      check(signal);
      const start = position(), distance = top - start;
      if (win.matchMedia('(prefers-reduced-motion: reduce)').matches || options.moveDurationMs <= 0) {
        move(top);
        return;
      }
      // Animate the full distance in a fixed, very short duration, regardless of
      // document length. Native smooth scrolling can take much longer on long posts.
      await new Promise((resolve, reject) => {
        const began = now();
        let frame;
        const cleanup = () => { win.cancelAnimationFrame(frame); signal.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(abortError()); };
        const tick = () => {
          if (signal.aborted) return abort();
          const progress = Math.min(1, (now() - began) / options.moveDurationMs);
          const eased = (1 - Math.cos(Math.PI * progress)) / 2;
          move(start + distance * eased);
          if (progress >= 1) { cleanup(); resolve(); }
          else frame = win.requestAnimationFrame(tick);
        };
        signal.addEventListener('abort', abort, { once: true });
        frame = win.requestAnimationFrame(tick);
      });
    }

    function watchLayout(signal) {
      const listeners = new Set();
      const notify = () => listeners.forEach(listener => listener());
      const resize = win.ResizeObserver ? new win.ResizeObserver(notify) : null;
      resize?.observe(doc.documentElement);
      if (doc.body) resize?.observe(doc.body);
      const mutation = new win.MutationObserver(notify);
      mutation.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, attributes: true });
      doc.addEventListener('load', notify, true);
      doc.addEventListener('error', notify, true);
      const dispose = () => {
        resize?.disconnect(); mutation.disconnect(); listeners.clear();
        doc.removeEventListener('load', notify, true); doc.removeEventListener('error', notify, true);
      };
      return {
        dispose,
        wait: () => new Promise((resolve, reject) => {
          check(signal);
          // Check promptly after a layout event, coalescing changes within a frame.
          // Even quiet pages are sampled repeatedly;
          // an ad's unrelated mutations cannot starve the geometry checks.
          let timer;
          const began = now();
          const cleanup = () => { win.clearTimeout(timer); listeners.delete(changed); signal.removeEventListener('abort', abort); };
          const finish = () => { cleanup(); resolve(); };
          const abort = () => { cleanup(); reject(abortError()); };
          const changed = () => { if (now() - began >= 16) finish(); };
          listeners.add(changed);
          signal.addEventListener('abort', abort, { once: true });
          timer = win.setTimeout(finish, options.sampleMs);
        }),
      };
    }

    function pendingImages(limit) {
      // Unfinished images above the destination can still push it out of view.
      // Ignore hidden assets and lazy images below the portion being traversed.
      return [...doc.images].some(image => {
        if (image.complete || !image.currentSrc || !image.getClientRects().length) return false;
        const top = image.getBoundingClientRect().top + position();
        return top <= limit;
      });
    }

    function cancel(reason = 'cancelled') {
      if (!active) return;
      const job = active;
      active = null;
      job.controller.abort();
      move(position());
      onState({ action: job.action, status: 'cancelled', reason });
    }

    async function run(action) {
      cancel('superseded');
      const job = { action, controller: new AbortController() };
      active = job;
      const signal = job.controller.signal;
      const layout = watchLayout(signal);
      const started = now();
      let previous = null;
      let stableSince = null;
      let stableCount = 0;
      let result;
      onState({ action, status: 'seeking' });
      try {
        while (now() - started < options.timeoutMs) {
          check(signal);
          const element = ['top', 'bottom'].includes(action) ? null : resolveTarget(action);
          const height = scroller().scrollHeight;
          const viewHeight = viewport();
          const max = bottom();
          const rect = element?.getBoundingClientRect();
          const anchor = rect ? rect.top + position() : null;
          let destination;
          if (action === 'top') destination = 0;
          else if (action === 'bottom' || !rect) destination = max;
          else if (action === 'commentWrite' && rect.height <= viewHeight - options.inset * 2) {
            destination = anchor + rect.height - viewHeight + options.inset;
          } else destination = anchor - options.inset;
          destination = Math.max(0, Math.min(destination, max));
          const arrived = Math.abs(position() - destination) <= options.tolerance;
          const inView = !rect || (rect.bottom > 0 && rect.top < viewHeight &&
            (action !== 'commentWrite' || rect.height > viewHeight - options.inset * 2 ||
             (rect.top >= 0 && rect.bottom <= viewHeight)));
          const geometry = { height, anchor, destination, viewHeight, element };
          const unchanged = previous && previous.element === element &&
            height === previous.height && viewHeight === previous.viewHeight &&
            ['anchor', 'destination'].every(key =>
              geometry[key] === previous[key] ||
              (geometry[key] !== null && previous[key] !== null && Math.abs(geometry[key] - previous[key]) <= options.tolerance));
          const loading = action !== 'top' && pendingImages(rect ? anchor : height);

          if (arrived && inView && unchanged && !loading) {
            stableSince ??= now();
            stableCount++;
            const hasTarget = element || ['top', 'bottom'].includes(action);
            const stableFor = hasTarget ? (action === 'top' ? options.sampleMs : options.stableMs) : options.missingMs;
            if (stableCount >= (action === 'top' ? 2 : options.stableSamples) && now() - stableSince >= stableFor) {
              result = { action, status: hasTarget ? 'complete' : 'not-found' };
              break;
            }
          } else { stableSince = null; stableCount = 0; }
          previous = geometry;
          if (!arrived) {
            // Cover the full known distance. Only layout/loading changes cause
            // subsequent corrections; traversing every viewport feels sluggish.
            await moveQuickly(destination, signal);
          }
          await layout.wait();
        }
        check(signal);
        result ??= { action, status: 'timeout' };
      } catch (error) {
        if (error.name !== 'AbortError') {
          result = { action, status: 'error' };
          console.warn('[DC Scroll Helper] Navigation failed', error);
        } else result = { action, status: 'cancelled' };
      } finally {
        layout.dispose();
        if (active === job) { active = null; onState(result); }
      }
      return result;
    }

    return { run, cancel, get running() { return !!active; } };
  }

  Object.assign(ns, { createNavigator });
})();
