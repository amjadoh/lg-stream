(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGStream = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function validateSource(raw) {
    var value = String(raw || '').trim();
    if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      var parsed = new URL(value);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) return null;
      // Preserve signed path/query bytes; URL is used only to validate the scheme and authority.
      return value;
    } catch (_) { return null; }
  }

  function qualityLabel(width, height) {
    var edge = Math.max(Number(width) || 0, Number(height) || 0);
    var shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
    if (!edge || !shortEdge) return '';
    if (shortEdge >= 2160 || edge >= 3840) return '4K';
    if (shortEdge >= 1440 || edge >= 2560) return 'QHD';
    if (shortEdge >= 1080 || edge >= 1920) return 'FHD';
    if (shortEdge >= 720 || edge >= 1280) return 'HD';
    return 'SD';
  }

  function buildSectionIndex(entries, include) {
    var all = [];
    var groups = [];
    var byGroup = Object.create(null);
    entries.forEach(function (entry, index) {
      if (!include(entry, index)) return;
      all.push(index);
      var group = entry.group || '';
      if (!group) return;
      if (!byGroup[group]) { byGroup[group] = []; groups.push(group); }
      byGroup[group].push(index);
    });
    return { all: all, groups: groups, byGroup: byGroup };
  }

  function searchCatalog(entries, query, sectionForIndex, limit) {
    var counts = { tv: 0, movies: 0, series: 0 };
    var matches = { tv: [], movies: [], series: [] };
    entries.forEach(function (entry, index) {
      if ((entry.name || '').toLocaleLowerCase().indexOf(query) < 0) return;
      var section = sectionForIndex(index);
      if (!matches[section]) return;
      counts[section] += 1;
      if (matches[section].length < limit) matches[section].push(index);
    });
    return { counts: counts, matches: matches };
  }

  function youtubeSearchTarget(name, year) {
    var title = String(name || '').trim().replace(/\s+/g, ' ');
    var releaseYear = String(year || '').trim();
    if (!title) return null;
    var titleAndYear = title;
    if (releaseYear && !(new RegExp('(^|\\D)' + releaseYear.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\D|$)')).test(title)) titleAndYear += ' ' + releaseYear;
    return 'https://www.youtube.com/tv?launch=voice&vq=' + encodeURIComponent('Search for ' + titleAndYear + ' on YouTube');
  }

  function createSwitchScheduler(commit, timers, delay) {
    timers = timers || {
      setTimeout: function (callback, delay) { return setTimeout(callback, delay); },
      clearTimeout: function (handle) { clearTimeout(handle); }
    };
    delay = delay === undefined ? 120 : delay;
    var pending = null;
    var revision = 0;
    function cancel() {
      revision += 1;
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
    }
    return {
      request: function (value) {
        cancel();
        var ownRevision = revision;
        pending = timers.setTimeout(function () {
          if (revision !== ownRevision) return;
          pending = null;
          commit(value);
        }, delay);
      },
      immediate: function (value) { cancel(); commit(value); },
      cancel: cancel
    };
  }

  function createPlayer(options) {
    var generation = 0;
    var active = null;
    var now = options.now || function () { return performance.now(); };
    var emit = options.onState || function () {};
    var timers = options.timers || {
      setTimeout: function (callback, delay) { return setTimeout(callback, delay); },
      clearTimeout: function (handle) { clearTimeout(handle); }
    };
    var startupTimeoutMs = options.startupTimeoutMs || 15000;
    function snapshot(entry) {
      return {
        channel: entry.channel,
        state: entry.state,
        playingMs: entry.playingMs,
        progressMs: entry.progressMs,
        firstFrameMs: entry.firstFrameMs,
        frameApi: entry.frameApi,
        stalls: entry.stalls,
        stallMs: Math.round(entry.stallMs),
        width: entry.video.videoWidth || 0,
        height: entry.video.videoHeight || 0,
        errorCode: entry.errorCode || 0
      };
    }
    function notify(entry) { if (active === entry) emit(snapshot(entry)); }
    function clearStartup(entry) {
      if (entry.startupTimer !== null) timers.clearTimeout(entry.startupTimer);
      entry.startupTimer = null;
    }
    function finishWait(entry) {
      if (entry.waitingSince !== null) {
        entry.stallMs += now() - entry.waitingSince;
        entry.waitingSince = null;
      }
    }
    function fail(entry, state) {
      finishWait(entry);
      entry.state = state;
      var failed = snapshot(entry);
      release();
      emit(failed);
    }
    function play(entry) {
      var revision = ++entry.playRevision;
      var promise = entry.video.play();
      if (promise && promise.catch) promise.catch(function () {
        if (active !== entry || entry.playRevision !== revision) return;
        fail(entry, 'play-rejected');
      });
    }
    function armStartup(entry) {
      clearStartup(entry);
      if (entry.progressMs !== null || entry.firstFrameMs !== null) return;
      var revision = ++entry.startupRevision;
      entry.startupTimer = timers.setTimeout(function () {
        if (active !== entry || entry.startupRevision !== revision || entry.startupTimer === null || entry.progressMs !== null || entry.firstFrameMs !== null) return;
        fail(entry, 'startup-timeout');
      }, startupTimeoutMs);
    }
    function release() {
      generation += 1;
      var old = active;
      active = null;
      if (!old) return;
      clearStartup(old);
      old.listeners.forEach(function (item) { old.video.removeEventListener(item[0], item[1]); });
      if (old.frameHandle !== null && old.video.cancelVideoFrameCallback) old.video.cancelVideoFrameCallback(old.frameHandle);
      old.video.pause();
      old.video.removeAttribute('src');
      old.video.load();
      options.unmountVideo(old.video);
    }
    function start(source, channel, requestedAt) {
      var valid = validateSource(source);
      if (!valid) return false;
      release();
      var ownGeneration = generation;
      var video = options.createVideo();
      var started = now();
      var entry = {
        video: video, channel: channel, state: 'loading', started: started, playingMs: null,
        requested: typeof requestedAt === 'number' && isFinite(requestedAt) && requestedAt <= started ? requestedAt : started,
        progressMs: null, lastMediaTime: 0, startupTimer: null, startupRevision: 0, playRevision: 0,
        firstFrameMs: null, frameApi: typeof video.requestVideoFrameCallback === 'function',
        frameHandle: null, listeners: [], stalls: 0, stallMs: 0, waitingSince: null, seekInProgress: false, seekMediaTime: null, errorCode: 0
      };
      active = entry;
      function validEntry() { return active === entry && generation === ownGeneration; }
      function on(name, callback) {
        var guarded = function () { if (validEntry()) callback(); };
        video.addEventListener(name, guarded);
        entry.listeners.push([name, guarded]);
      }
      on('playing', function () {
        entry.seekInProgress = false; entry.seekMediaTime = null;
        if (entry.playingMs === null) {
          entry.playingMs = Math.round(now() - entry.requested);
          entry.lastMediaTime = video.currentTime || 0;
        }
        finishWait(entry); entry.state = 'playing'; notify(entry);
      });
      on('timeupdate', function () {
        var mediaTime = video.currentTime;
        if (entry.seekInProgress && entry.seekMediaTime !== null && !video.paused && !video.seeking && isFinite(mediaTime) && mediaTime > entry.seekMediaTime) {
          entry.seekInProgress = false; entry.seekMediaTime = null;
        }
        if (entry.playingMs === null || entry.progressMs !== null || video.paused || video.seeking || !isFinite(mediaTime)) return;
        if (mediaTime > entry.lastMediaTime) {
          entry.progressMs = Math.round(now() - entry.requested);
          clearStartup(entry); notify(entry);
        }
        entry.lastMediaTime = mediaTime;
      });
      on('seeking', function () {
        // Seeking and its refill are user-requested work, not playback stalls.
        finishWait(entry); entry.seekInProgress = true; entry.seekMediaTime = null;
      });
      on('seeked', function () { if (entry.seekInProgress) entry.seekMediaTime = video.currentTime; });
      on('waiting', function () {
        if (!entry.seekInProgress && !video.seeking && entry.playingMs !== null && entry.waitingSince === null) {
          entry.waitingSince = now(); entry.stalls += 1;
        }
        entry.state = 'waiting'; notify(entry);
      });
      on('pause', function () {
        if (!video.paused) return;
        clearStartup(entry); finishWait(entry); entry.state = 'paused'; notify(entry);
      });
      on('ended', function () { clearStartup(entry); finishWait(entry); entry.state = 'ended'; notify(entry); });
      on('loadedmetadata', function () { notify(entry); });
      on('resize', function () { notify(entry); });
      on('error', function () {
        var code = video.error && video.error.code;
        entry.errorCode = typeof code === 'number' && code >= 1 && code <= 4 ? code : 0;
        fail(entry, 'error');
      });
      options.mountVideo(video);
      video.src = valid;
      if (entry.frameApi) {
        entry.frameHandle = video.requestVideoFrameCallback(function () {
          if (!validEntry()) return;
          entry.firstFrameMs = Math.round(now() - entry.requested);
          clearStartup(entry);
          notify(entry);
        });
      }
      notify(entry);
      armStartup(entry);
      video.load();
      play(entry);
      return true;
    }
    return {
      start: start,
      stop: function () { release(); emit({ state: 'idle' }); },
      pause: function () {
        if (!active) return;
        active.playRevision += 1;
        clearStartup(active);
        active.video.pause();
      },
      resume: function () {
        var entry = active;
        if (!entry) return;
        armStartup(entry);
        play(entry);
      },
      toggle: function () { if (active) { if (active.video.paused) this.resume(); else this.pause(); } }
    };
  }
  function groupCategory(name) {
    var text = String(name || '').toLowerCase();
    // Conservative group-name hints only; provider brands/countries are not genres.
    var rules = [['sports', /(?:^|[\s|:_-])(?:ال)?رياض(?:ة|ية)(?=$|[\s|:_-])|\bsports?\b/], ['movies', /أفلام|افلام|سينما|\bmovies?\b|\bcinema\b/], ['news', /أخبار|اخبار|\bnews\b/], ['kids', /أطفال|اطفال|كرتون|\bkids?\b|\bchildren\b/], ['documentary', /وثائق|\bdocumentar(?:y|ies)\b/]];
    var matches = rules.filter(function (rule) { return rule[1].test(text); });
    return matches.length === 1 ? matches[0][0] : 'other';
  }
  return { groupCategory: groupCategory, validateSource: validateSource, qualityLabel: qualityLabel, buildSectionIndex: buildSectionIndex, searchCatalog: searchCatalog, youtubeSearchTarget: youtubeSearchTarget, createSwitchScheduler: createSwitchScheduler, createPlayer: createPlayer };
}));
