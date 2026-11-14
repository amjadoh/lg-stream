(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGSpeedTest = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var MAX_BYTES = 64000000;
  var DURATION_MS = 8000;
  var nonce = 0;

  function cancelStream(stream) {
    if (!stream || typeof stream.cancel !== 'function') return;
    try { Promise.resolve(stream.cancel()).catch(function () {}); } catch (_) {}
    if (typeof stream.releaseLock === 'function') {
      try { stream.releaseLock(); } catch (_) {}
    }
  }
  function createTest(options) {
    options = options || {};
    var fetcher = options.fetch !== undefined ? options.fetch : (typeof fetch === 'function' ? fetch : null);
    var Abort = options.AbortController !== undefined ? options.AbortController : (typeof AbortController === 'function' ? AbortController : null);
    var now = options.now || function () { return performance.now(); };
    var timers = options.timers || {
      setTimeout: function (callback, delay) { return setTimeout(callback, delay); },
      clearTimeout: function (handle) { clearTimeout(handle); }
    };
    var active = null;

    function finish(entry, state, limited) {
      if (entry.done) return;
      entry.done = true;
      if (active === entry) active = null;
      var duration = Math.max(0, now() - entry.started);
      var result = { state: state };
      if (state === 'complete') {
        result = entry.bytes > 0 && duration > 0 ? {
          state: 'complete', mbps: entry.bytes * 8 / (duration * 1000),
          httpMs: entry.httpMs, bytes: entry.bytes, durationMs: duration, limited: !!limited
        } : { state: 'error' };
      }
      timers.clearTimeout(entry.timer);
      entry.controller.abort();
      cancelStream(entry.reader);
      entry.resolve(result);
    }
    function expire(entry) { finish(entry, entry.bytes > 0 ? 'complete' : 'error', true); }
    async function download(entry) {
      try {
        var response = await fetcher('https://speed.cloudflare.com/__down?bytes=' + MAX_BYTES + '&nonce=' + Date.now() + '-' + (++nonce), {
          method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
          redirect: 'error', mode: 'cors', signal: entry.controller.signal
        });
        if (entry.done) { cancelStream(response.body); return; }
        entry.httpMs = Math.max(0, now() - entry.started);
        if (!response.ok) { cancelStream(response.body); finish(entry, 'error'); return; }
        if (!response.body || typeof response.body.getReader !== 'function') {
          cancelStream(response.body); finish(entry, 'unsupported'); return;
        }
        entry.reader = response.body.getReader();
        while (!entry.done) {
          if (now() - entry.started >= DURATION_MS) { expire(entry); return; }
          var chunk = await entry.reader.read();
          if (entry.done) return;
          if (now() - entry.started >= DURATION_MS) { expire(entry); return; }
          if (chunk.done) { finish(entry, 'complete', false); return; }
          entry.bytes = Math.min(MAX_BYTES, entry.bytes + chunk.value.byteLength);
          if (entry.bytes >= MAX_BYTES) { finish(entry, 'complete', true); return; }
        }
      } catch (_) { finish(entry, 'error'); }
    }
    function cancel() { if (active) finish(active, 'cancelled'); }
    return {
      start: function () {
        cancel();
        if (typeof fetcher !== 'function' || typeof Abort !== 'function') return Promise.resolve({ state: 'unsupported' });
        var controller;
        try { controller = new Abort(); } catch (_) { return Promise.resolve({ state: 'unsupported' }); }
        return new Promise(function (resolve) {
          var entry = {
            controller: controller, started: now(), reader: null, timer: null,
            bytes: 0, httpMs: 0, done: false, resolve: resolve
          };
          active = entry;
          entry.timer = timers.setTimeout(function () { expire(entry); }, DURATION_MS);
          download(entry);
        });
      },
      cancel: cancel
    };
  }
  return { createTest: createTest, MAX_BYTES: MAX_BYTES, DURATION_MS: DURATION_MS };
}));
