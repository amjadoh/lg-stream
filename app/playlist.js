(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGPlaylist = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var MAX_BYTES = 64000000;
  var MAX_ENTRIES = 50000;
  var TIMEOUT_MS = 120000;

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
    var truncated = false;
    var truncatedReason = null;
    function push(rawLine) {
      var line = String(rawLine || '').trim();
      if (!line) return;
      if (line.indexOf('#EXTM3U') === 0) return;
      if (line.indexOf('#EXTINF:') === 0) {
        var comma = line.indexOf(',');
        var group = /group-title="([^"]*)"/i.exec(line);
        var tvgName = /tvg-name="([^"]*)"/i.exec(line);
        var tvgId = /tvg-id="([^"]*)"/i.exec(line);
        var poster = /(?:tvg-logo|poster)="([^"]*)"/i.exec(line);
        var year = /(?:year|release[-_]?date)="([^"]*)"/i.exec(line);
        var rating = /(?:rating|tvg-rating)="([^"]*)"/i.exec(line);
        var added = /(?:added|added[-_]at|date[-_]added)="([^"]*)"/i.exec(line);
        var description = /(?:description|plot)="([^"]*)"/i.exec(line);
        var trailer = /(?:trailer|trailer-url)="([^"]*)"/i.exec(line);
        metadata = {
          name: safeText(comma >= 0 ? line.slice(comma + 1) : (tvgName && tvgName[1]), 'قناة', 120),
          group: safeText(group && group[1], '', 80),
          id: safeText(tvgId && tvgId[1], '', 160),
          poster: resolveHttpUrl(poster && poster[1]),
          year: safeYear(year && year[1]),
          rating: safeText(rating && rating[1], '', 24),
          added: safeText(added && added[1], '', 32),
          description: safeText(description && description[1], '', 600),
          trailer: resolveHttpUrl(trailer && trailer[1])
        };
        return;
      }
      if (line.charAt(0) === '#') return;
      var url = resolveHttpUrl(line, baseUrl);
      if (!url) { metadata = null; return; }
      if (entries.length >= MAX_ENTRIES) { truncated = true; truncatedReason = 'entries'; metadata = null; return; }
      entries.push({ url: url, name: metadata ? metadata.name : 'قناة ' + (entries.length + 1), group: metadata ? metadata.group : '', id: metadata ? metadata.id : '', poster: metadata ? metadata.poster : null, year: metadata ? metadata.year : '', rating: metadata ? metadata.rating : '', added: metadata ? metadata.added : '', description: metadata ? metadata.description : '', trailer: metadata ? metadata.trailer : null });
      metadata = null;
    }
    return { push: push, truncate: function (reason) { truncated = true; truncatedReason = reason; }, result: function () { return { entries: entries, truncated: truncated, truncatedReason: truncatedReason }; } };
  }

  function parseM3U(text, baseUrl) {
    var parser = createM3UParser(baseUrl);
    String(text || '').split(/\r?\n/).forEach(parser.push);
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
        entry.reader = response.body.getReader();
        var decoder = new Decoder('utf-8');
        var parser = createM3UParser(url); entry.parser = parser;
        var pending = '';
        while (!entry.done) {
          var chunk = await entry.reader.read();
          if (entry.done) return;
          if (chunk.done) break;
          var remaining = MAX_BYTES - entry.bytes;
          var value = chunk.value.byteLength > remaining ? chunk.value.slice(0, remaining) : chunk.value;
          entry.bytes += value.byteLength;
          var lines = (pending + decoder.decode(value, { stream: true })).split(/\r?\n/);
          pending = lines.pop() || '';
          lines.forEach(parser.push);
          if (value.byteLength < chunk.value.byteLength || entry.bytes >= MAX_BYTES) { parser.truncate('bytes'); break; }
        }
        pending += decoder.decode(); if (pending) parser.push(pending);
        var parsed = parser.result();
        finish(entry, parsed.entries.length ? { state: 'complete', entries: parsed.entries, truncated: parsed.truncated, truncatedReason: parsed.truncatedReason } : { state: 'empty' });
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
          var entry = { controller: controller, reader: null, parser: null, timer: null, bytes: 0, done: false, resolve: resolve };
          active = entry;
          entry.timer = timers.setTimeout(function () {
            var partial = entry.parser && entry.parser.result();
            finish(entry, partial && partial.entries.length ? { state: 'complete', entries: partial.entries, truncated: true, truncatedReason: 'timeout' } : { state: 'timeout' });
          }, TIMEOUT_MS);
          load(entry, url);
        });
      },
      cancel: cancel
    };
  }

  return { createLoader: createLoader, parseM3U: parseM3U, MAX_BYTES: MAX_BYTES, MAX_ENTRIES: MAX_ENTRIES, TIMEOUT_MS: TIMEOUT_MS };
}));
