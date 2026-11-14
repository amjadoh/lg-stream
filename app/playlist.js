(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGPlaylist = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var MAX_BYTES = 8000000;
  var MAX_ENTRIES = 5000;
  var TIMEOUT_MS = 20000;

  function safeText(value, fallback, limit) {
    var text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return (text || fallback).slice(0, limit);
  }

  function resolveHttpUrl(raw, baseUrl) {
    try {
      var parsed = new URL(String(raw || '').trim(), baseUrl);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname ? parsed.href : null;
    } catch (_) { return null; }
  }

  function parseM3U(text, baseUrl) {
    var lines = String(text || '').split(/\r?\n/);
    var entries = [];
    var metadata = null;
    var truncated = false;
    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF:') === 0) {
        var comma = line.indexOf(',');
        var group = /group-title="([^"]*)"/i.exec(line);
        var tvgName = /tvg-name="([^"]*)"/i.exec(line);
        metadata = {
          name: safeText(comma >= 0 ? line.slice(comma + 1) : (tvgName && tvgName[1]), 'قناة', 120),
          group: safeText(group && group[1], '', 80)
        };
        continue;
      }
      if (line.charAt(0) === '#') continue;
      var url = resolveHttpUrl(line, baseUrl);
      if (!url) { metadata = null; continue; }
      if (entries.length >= MAX_ENTRIES) { truncated = true; break; }
      entries.push({ url: url, name: metadata ? metadata.name : 'قناة ' + (entries.length + 1), group: metadata ? metadata.group : '' });
      metadata = null;
    }
    return { entries: entries, truncated: truncated };
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

    function finish(entry, result) {
      if (entry.done) return;
      entry.done = true;
      if (active === entry) active = null;
      timers.clearTimeout(entry.timer);
      entry.controller.abort();
      if (entry.reader) {
        try { Promise.resolve(entry.reader.cancel()).catch(function () {}); } catch (_) {}
      }
      entry.resolve(result);
    }

    function cancel() { if (active) finish(active, { state: 'cancelled' }); }

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
        var declared = response.headers && Number(response.headers.get('content-length'));
        if (declared > MAX_BYTES) { finish(entry, { state: 'too-large' }); return; }
        entry.reader = response.body.getReader();
        var decoder = new Decoder('utf-8');
        var text = '';
        while (!entry.done) {
          var chunk = await entry.reader.read();
          if (entry.done) return;
          if (chunk.done) break;
          entry.bytes += chunk.value.byteLength;
          if (entry.bytes > MAX_BYTES) { finish(entry, { state: 'too-large' }); return; }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        var parsed = parseM3U(text, url);
        finish(entry, parsed.entries.length ? { state: 'complete', entries: parsed.entries, truncated: parsed.truncated } : { state: 'empty' });
      } catch (_) { if (!entry.done) finish(entry, { state: 'error' }); }
    }

    return {
      start: function (rawUrl) {
        cancel();
        var url = resolveHttpUrl(rawUrl);
        if (!url) return Promise.resolve({ state: 'invalid' });
        if (typeof fetcher !== 'function' || typeof Abort !== 'function' || typeof Decoder !== 'function') return Promise.resolve({ state: 'unsupported' });
        var controller;
        try { controller = new Abort(); } catch (_) { return Promise.resolve({ state: 'unsupported' }); }
        return new Promise(function (resolve) {
          var entry = { controller: controller, reader: null, timer: null, bytes: 0, done: false, resolve: resolve };
          active = entry;
          entry.timer = timers.setTimeout(function () { finish(entry, { state: 'timeout' }); }, TIMEOUT_MS);
          load(entry, url);
        });
      },
      cancel: cancel
    };
  }

  return { createLoader: createLoader, parseM3U: parseM3U, MAX_BYTES: MAX_BYTES, MAX_ENTRIES: MAX_ENTRIES, TIMEOUT_MS: TIMEOUT_MS };
}));
