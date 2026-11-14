(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGPlaylist = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var MAX_BYTES = 64000000;
  var MAX_ENTRIES = 5000;
  var TIMEOUT_MS = 30000;
  var EPG_MAX_BYTES = 4000000;

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

  function sourceType(url) {
    if (/\/series\//i.test(url)) return 'series';
    if (/\/movie\//i.test(url)) return 'movies';
    return 'tv';
  }

  function createM3UParser(baseUrl) {
    var entries = [];
    var metadata = null;
    var truncated = false;
    var epgUrl = null;
    var counts = { tv: 0, movies: 0, series: 0 };
    var limits = { tv: 3000, movies: 1000, series: 1000 };
    function push(rawLine) {
      var line = String(rawLine || '').trim();
      if (!line) return;
      if (line.indexOf('#EXTM3U') === 0) {
        var epg = /(?:x-tvg-url|url-tvg)=["']([^"']+)["']/i.exec(line);
        epgUrl = epg ? resolveHttpUrl(epg[1], baseUrl) : null;
        return;
      }
      if (line.indexOf('#EXTINF:') === 0) {
        var comma = line.indexOf(',');
        var group = /group-title="([^"]*)"/i.exec(line);
        var tvgName = /tvg-name="([^"]*)"/i.exec(line);
        var tvgId = /tvg-id="([^"]*)"/i.exec(line);
        var year = /(?:year|release-date|releasedate)="([^"]*)"/i.exec(line);
        var description = /(?:description|plot)="([^"]*)"/i.exec(line);
        var trailer = /(?:trailer|trailer-url)="([^"]*)"/i.exec(line);
        metadata = {
          name: safeText(comma >= 0 ? line.slice(comma + 1) : (tvgName && tvgName[1]), 'قناة', 120),
          group: safeText(group && group[1], '', 80),
          id: safeText(tvgId && tvgId[1], '', 160),
          year: safeText(year && year[1], '', 24),
          description: safeText(description && description[1], '', 1200),
          trailer: resolveHttpUrl(trailer && trailer[1])
        };
        return;
      }
      if (line.charAt(0) === '#') return;
      var url = resolveHttpUrl(line, baseUrl);
      if (!url) { metadata = null; return; }
      var type = sourceType(url);
      if (entries.length >= MAX_ENTRIES || counts[type] >= limits[type]) { truncated = true; metadata = null; return; }
      entries.push({ url: url, name: metadata ? metadata.name : 'قناة ' + (entries.length + 1), group: metadata ? metadata.group : '', id: metadata ? metadata.id : '', year: metadata ? metadata.year : '', description: metadata ? metadata.description : '', trailer: metadata ? metadata.trailer : null });
      counts[type] += 1;
      metadata = null;
    }
    return { push: push, truncate: function () { truncated = true; }, result: function () { return { entries: entries, truncated: truncated, epgUrl: epgUrl }; } };
  }

  function parseM3U(text, baseUrl) {
    var parser = createM3UParser(baseUrl);
    String(text || '').split(/\r?\n/).forEach(parser.push);
    return parser.result();
  }

  function decodeXml(value) {
    return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function xmlTime(value) {
    var match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s+([+-])(\d{2})(\d{2}))?/.exec(value || '');
    if (!match) return NaN;
    var time = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
    if (match[7]) time -= (match[7] === '+' ? 1 : -1) * ((+match[8] * 60 + +match[9]) * 60000);
    return time;
  }
  function parseEpg(text, ids, now) {
    var wanted = {}; ids.forEach(function (id) { if (id) wanted[id] = true; });
    var programmes = {}; var regex = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi; var match;
    while ((match = regex.exec(String(text || '')))) {
      var channel = /\bchannel=["']([^"']+)["']/i.exec(match[1]);
      if (!channel || !wanted[decodeXml(channel[1])]) continue;
      var start = /\bstart=["']([^"']+)["']/i.exec(match[1]); var stop = /\bstop=["']([^"']+)["']/i.exec(match[1]);
      if (!start || !stop || xmlTime(start[1]) > now || xmlTime(stop[1]) <= now) continue;
      var title = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(match[2]);
      if (title) programmes[decodeXml(channel[1])] = safeText(decodeXml(title[1].replace(/<[^>]+>/g, '')), 'لا توجد معلومات', 140);
    }
    return programmes;
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
        var reachedLimit = false;
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
          if (value.byteLength < chunk.value.byteLength || entry.bytes === MAX_BYTES) { reachedLimit = true; break; }
        }
        pending += decoder.decode(); if (pending) parser.push(pending);
        if (reachedLimit) parser.truncate();
        var parsed = parser.result();
        finish(entry, parsed.entries.length ? { state: 'complete', entries: parsed.entries, truncated: reachedLimit || parsed.truncated, epgUrl: parsed.epgUrl } : { state: 'empty' });
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
            finish(entry, partial && partial.entries.length ? { state: 'complete', entries: partial.entries, truncated: true, epgUrl: partial.epgUrl } : { state: 'timeout' });
          }, TIMEOUT_MS);
          load(entry, url);
        });
      },
      cancel: cancel
    };
  }

  function createEpgLoader(options) {
    options = options || {};
    var fetcher = options.fetch !== undefined ? options.fetch : (typeof fetch === 'function' ? fetch : null);
    var Abort = options.AbortController !== undefined ? options.AbortController : (typeof AbortController === 'function' ? AbortController : null);
    var Decoder = options.TextDecoder !== undefined ? options.TextDecoder : (typeof TextDecoder === 'function' ? TextDecoder : null);
    var active = null;
    function cancel() { if (active) { active.abort(); active = null; } }
    return {
      start: async function (rawUrl, ids) {
        cancel(); var url = resolveHttpUrl(rawUrl); if (!url || !ids || !ids.length) return { state: 'empty', programmes: {} };
        if (typeof fetcher !== 'function' || typeof Abort !== 'function' || typeof Decoder !== 'function') return { state: 'unsupported', programmes: {} };
        var controller = new Abort(); active = controller; var timer = setTimeout(function () { controller.abort(); }, 12000);
        try {
          var response = await fetcher(url, { method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', signal: controller.signal });
          if (!response.ok || !response.body || typeof response.body.getReader !== 'function') return { state: 'error', programmes: {} };
          var reader = response.body.getReader(); var decoder = new Decoder('utf-8'); var text = ''; var bytes = 0;
          while (bytes < EPG_MAX_BYTES) {
            var chunk = await reader.read(); if (chunk.done) break;
            var remaining = EPG_MAX_BYTES - bytes; var value = chunk.value.byteLength > remaining ? chunk.value.slice(0, remaining) : chunk.value;
            bytes += value.byteLength; text += decoder.decode(value, { stream: true });
            if (value.byteLength < chunk.value.byteLength) { try { await reader.cancel(); } catch (_) {} break; }
          }
          text += decoder.decode();
          if (active !== controller) return { state: 'cancelled', programmes: {} };
          return { state: 'complete', programmes: parseEpg(text, ids, Date.now()) };
        } catch (_) { return { state: controller.signal.aborted ? 'cancelled' : 'error', programmes: {} }; }
        finally { clearTimeout(timer); if (active === controller) active = null; }
      },
      cancel: cancel
    };
  }

  return { createLoader: createLoader, createEpgLoader: createEpgLoader, parseM3U: parseM3U, parseEpg: parseEpg, MAX_BYTES: MAX_BYTES, MAX_ENTRIES: MAX_ENTRIES, TIMEOUT_MS: TIMEOUT_MS };
}));
