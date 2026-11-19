(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGPlaylist = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var TIMEOUT_MS = 30000;
  // Fail the whole import above these limits; never save a clipped catalogue.
  // The accepted 331,681-item catalogue fits well below the item ceiling.
  var MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
  var MAX_LINE_LENGTH = 64 * 1024;
  var MAX_ENTRIES = 1000000;
  var TOTAL_TIMEOUT_MS = 10 * 60 * 1000;

  function safeText(value, fallback, limit) {
    var text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return (text || fallback).slice(0, limit);
  }
  function safeYear(value) { var match = /(?:19|20)\d{2}/.exec(String(value || '')); return match ? match[0] : ''; }

  function resolveHttpUrl(raw, baseUrl) {
    try {
      var parsed = new URL(String(raw || '').trim(), baseUrl);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname ? parsed.href : null;
    } catch (_) { return null; }
  }

  function createM3UParser(baseUrl) {
    var entries = [];
    var metadata = null;
    var header = false;
    var failure = null;
    function reject(reason) { failure = reason; entries = []; metadata = null; return false; }
    function push(rawLine) {
      if (failure) return false;
      if (rawLine.length > MAX_LINE_LENGTH) return reject('line-limit');
      var line = String(rawLine || '').trim();
      if (!line) return true;
      if (!header) {
        if (!/^#EXTM3U(?:\s|$)/.test(line)) return reject('invalid-format');
        header = true; return true;
      }
      if (/^#EXT-X-/.test(line)) return reject('hls-manifest');
      if (/^#EXTM3U(?:\s|$)/.test(line)) return reject('invalid-format');
      if (line.indexOf('#EXTINF') === 0 && line.indexOf('#EXTINF:') !== 0) return reject('invalid-metadata');
      if (line.indexOf('#EXTINF:') === 0) {
        if (metadata) return reject('missing-uri');
        var comma = -1; var quoted = false;
        for (var at = 8; at < line.length; at += 1) {
          if (line.charAt(at) === '"') quoted = !quoted;
          if (line.charAt(at) === ',' && !quoted) { comma = at; break; }
        }
        if (comma < 0 || !/^#EXTINF:\s*-?\d+(?:\.\d+)?(?:\s|,)/.test(line)) return reject('invalid-metadata');
        var attributes = line.slice(0, comma);
        var group = /(?:^|\s)group-title="([^"]*)"/i.exec(attributes);
        var tvgName = /(?:^|\s)tvg-name="([^"]*)"/i.exec(attributes);
        var tvgId = /(?:^|\s)tvg-id="([^"]*)"/i.exec(attributes);
        var poster = /(?:^|\s)(?:tvg-logo|poster)="([^"]*)"/i.exec(attributes);
        var year = /(?:^|\s)(?:year|release[-_]?date)="([^"]*)"/i.exec(attributes);
        var rating = /(?:^|\s)(?:rating|tvg-rating)="([^"]*)"/i.exec(attributes);
        var added = /(?:^|\s)(?:added|added[-_]at|date[-_]added)="([^"]*)"/i.exec(attributes);
        var description = /(?:^|\s)(?:description|plot)="([^"]*)"/i.exec(attributes);
        var trailer = /(?:^|\s)(?:trailer|trailer-url)="([^"]*)"/i.exec(attributes);
        metadata = {
          name: safeText(line.slice(comma + 1) || (tvgName && tvgName[1]), 'قناة', MAX_LINE_LENGTH),
          group: safeText(group && group[1], '', MAX_LINE_LENGTH),
          id: safeText(tvgId && tvgId[1], '', 160),
          poster: resolveHttpUrl(poster && poster[1]),
          year: safeYear(year && year[1]),
          rating: safeText(rating && rating[1], '', 24),
          added: safeText(added && added[1], '', 32),
          description: safeText(description && description[1], '', 600),
          trailer: resolveHttpUrl(trailer && trailer[1])
        };
        return true;
      }
      if (line.charAt(0) === '#') return true;
      if (!metadata || /[\s<>"{}\u0000-\u001f\u007f]/.test(line)) return reject('invalid-uri');
      var url = resolveHttpUrl(line, baseUrl);
      if (!url) return reject('invalid-uri');
      if (entries.length >= MAX_ENTRIES) return reject('entry-limit');
      metadata.url = url; entries.push(metadata); metadata = null;
      return true;
    }
    return {
      push: push,
      count: function () { return entries.length; },
      result: function () {
        if (!failure && (!header || metadata)) reject(metadata ? 'missing-uri' : 'invalid-format');
        return { entries: entries, truncated: !!failure, truncatedReason: failure };
      }
    };
  }

  function parseM3U(text, baseUrl) {
    var parser = createM3UParser(baseUrl);
    var lines = String(text || '').split(/\r?\n/);
    for (var index = 0; index < lines.length; index += 1) if (!parser.push(lines[index])) break;
    return parser.result();
  }

  function createLoader(options) {
    options = options || {};
    var fetcher = options.fetch !== undefined ? options.fetch : (typeof fetch === 'function' ? fetch : null);
    var Abort = options.AbortController !== undefined ? options.AbortController : (typeof AbortController === 'function' ? AbortController : null);
    var Decoder = options.TextDecoder !== undefined ? options.TextDecoder : (typeof TextDecoder === 'function' ? TextDecoder : null);
    var timers = options.timers || {
      setTimeout: function (callback, delay) { return setTimeout(callback, delay); },
      clearTimeout: function (handle) { clearTimeout(handle); }
    };
    var active = null;
    // The network can deliver chunks faster than they are parsed; awaiting an
    // already-resolved read keeps running in microtasks and starves remote
    // input. Give the event loop a macrotask after each ~30ms of parsing.
    var SLICE_MS = 30;
    var now = options.now || function () { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };
    var yieldTask = options.yieldTask || function () { return new Promise(function (resolve) { setTimeout(resolve, 0); }); };

    function finish(entry, result) {
      if (entry.done) return;
      entry.done = true;
      if (active === entry) active = null;
      timers.clearTimeout(entry.timer); timers.clearTimeout(entry.totalTimer);
      entry.controller.abort();
      if (entry.reader) {
        try { Promise.resolve(entry.reader.cancel()).catch(function () {}); } catch (_) {}
      }
      entry.resolve(result);
    }

    function cancel() { if (active) finish(active, { state: 'cancelled' }); }
    function armTimeout(entry) {
      timers.clearTimeout(entry.timer);
      entry.timer = timers.setTimeout(function () {
        finish(entry, { state: 'timeout' });
      }, TIMEOUT_MS);
    }

    async function load(entry, url) {
      try {
        var response = await fetcher(url, {
          method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
          redirect: 'follow', mode: 'cors', signal: entry.controller.signal
        });
        if (entry.done) {
          if (response.body && typeof response.body.cancel === 'function') {
            try { Promise.resolve(response.body.cancel()).catch(function () {}); } catch (_) {}
          }
          return;
        }
        if (!response.ok || !response.body || typeof response.body.getReader !== 'function') {
          finish(entry, { state: 'error' }); return;
        }
        entry.reader = response.body.getReader();
        var decoder = new Decoder('utf-8');
        var parser = createM3UParser(response.url || url);
        function invalidResult() { var reason = parser.result().truncatedReason; return { state: /-limit$/.test(reason) ? 'limit' : 'invalid', reason: reason }; }
        var pending = '';
        var total = 0;
        try { total = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0; } catch (_) { total = 0; }
        var sliceStart = now();
        while (!entry.done) {
          var chunk = await entry.reader.read();
          if (entry.done) return;
          if (chunk.done) break;
          var value = chunk.value;
          entry.bytes += value.byteLength;
          if (entry.bytes > MAX_DOWNLOAD_BYTES) { finish(entry, { state: 'limit', reason: 'download-limit' }); return; }
          armTimeout(entry);
          var lines = (pending + decoder.decode(value, { stream: true })).split(/\r?\n/);
          pending = lines.pop() || '';
          if (pending.length > MAX_LINE_LENGTH) { finish(entry, { state: 'limit', reason: 'line-limit' }); return; }
          for (var index = 0; index < lines.length; index += 1) {
            if (!parser.push(lines[index])) { finish(entry, invalidResult()); return; }
            // A single network chunk can hold thousands of lines.
            if ((index & 255) === 255 && now() - sliceStart >= SLICE_MS) { await yieldTask(); if (entry.done) return; sliceStart = now(); }
          }
          if (now() - sliceStart >= SLICE_MS) {
            if (entry.onProgress) { try { entry.onProgress({ bytes: entry.bytes, total: total, entries: parser.count() }); } catch (_) {} }
            await yieldTask(); if (entry.done) return; sliceStart = now();
          }
        }
        pending += decoder.decode(); if (pending) parser.push(pending);
        var parsed = parser.result();
        finish(entry, parsed.truncated ? invalidResult() : parsed.entries.length ? { state: 'complete', entries: parsed.entries, truncated: false, truncatedReason: null } : { state: 'empty' });
      } catch (_) { if (!entry.done) finish(entry, { state: 'error' }); }
    }

    return {
      start: function (rawUrl, startOptions) {
        cancel();
        var url = resolveHttpUrl(rawUrl);
        if (!url) return Promise.resolve({ state: 'invalid' });
        if (typeof fetcher !== 'function' || typeof Abort !== 'function' || typeof Decoder !== 'function') return Promise.resolve({ state: 'unsupported' });
        var controller;
        try { controller = new Abort(); } catch (_) { return Promise.resolve({ state: 'unsupported' }); }
        return new Promise(function (resolve) {
          var entry = { controller: controller, reader: null, timer: null, totalTimer: null, bytes: 0, done: false, resolve: resolve, onProgress: startOptions && startOptions.onProgress };
          active = entry;
          armTimeout(entry);
          entry.totalTimer = timers.setTimeout(function () { finish(entry, { state: 'timeout' }); }, TOTAL_TIMEOUT_MS);
          load(entry, url);
        });
      },
      cancel: cancel
    };
  }

  return { createLoader: createLoader, parseM3U: parseM3U, TIMEOUT_MS: TIMEOUT_MS, TOTAL_TIMEOUT_MS: TOTAL_TIMEOUT_MS, MAX_DOWNLOAD_BYTES: MAX_DOWNLOAD_BYTES, MAX_LINE_LENGTH: MAX_LINE_LENGTH, MAX_ENTRIES: MAX_ENTRIES };
}));
