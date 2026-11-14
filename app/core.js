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

  function createSwitchScheduler(commit, timers, delay) {
    timers = timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
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
    function snapshot(entry) {
      return {
        channel: entry.channel,
        state: entry.state,
        playingMs: entry.playingMs,
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
    function release() {
      generation += 1;
      var old = active;
      active = null;
      if (!old) return;
      old.listeners.forEach(function (item) { old.video.removeEventListener(item[0], item[1]); });
      if (old.frameHandle !== null && old.video.cancelVideoFrameCallback) old.video.cancelVideoFrameCallback(old.frameHandle);
      old.video.pause();
      old.video.removeAttribute('src');
      old.video.load();
      options.unmountVideo(old.video);
    }
    function start(source, channel) {
      var valid = validateSource(source);
      if (!valid) return false;
      release();
      var ownGeneration = generation;
      var video = options.createVideo();
      var entry = {
        video: video, channel: channel, state: 'loading', started: now(), playingMs: null,
        firstFrameMs: null, frameApi: typeof video.requestVideoFrameCallback === 'function',
        frameHandle: null, listeners: [], stalls: 0, stallMs: 0, waitingSince: null, errorCode: 0
      };
      active = entry;
      function validEntry() { return active === entry && generation === ownGeneration; }
      function on(name, callback) {
        var guarded = function () { if (validEntry()) callback(); };
        video.addEventListener(name, guarded);
        entry.listeners.push([name, guarded]);
      }
      function finishWait() {
        if (entry.waitingSince !== null) {
          entry.stallMs += now() - entry.waitingSince;
          entry.waitingSince = null;
        }
      }
      on('playing', function () {
        if (entry.playingMs === null) entry.playingMs = Math.round(now() - entry.started);
        finishWait(); entry.state = 'playing'; notify(entry);
      });
      on('waiting', function () {
        if (entry.playingMs !== null && entry.waitingSince === null) {
          entry.waitingSince = now(); entry.stalls += 1;
        }
        entry.state = 'waiting'; notify(entry);
      });
      on('pause', function () { finishWait(); entry.state = 'paused'; notify(entry); });
      on('ended', function () { finishWait(); entry.state = 'ended'; notify(entry); });
      on('loadedmetadata', function () { notify(entry); });
      on('error', function () {
        finishWait(); entry.state = 'error';
        entry.errorCode = video.error && video.error.code || 0;
        notify(entry);
      });
      options.mountVideo(video);
      video.src = valid;
      if (entry.frameApi) {
        entry.frameHandle = video.requestVideoFrameCallback(function () {
          if (!validEntry()) return;
          entry.firstFrameMs = Math.round(now() - entry.started);
          notify(entry);
        });
      }
      notify(entry);
      video.load();
      var promise = video.play();
      if (promise && promise.catch) promise.catch(function () {
        if (!validEntry() || entry.state === 'error') return;
        entry.state = 'play-rejected'; notify(entry);
      });
      return true;
    }
    return {
      start: start,
      stop: function () { release(); emit({ state: 'idle' }); },
      pause: function () { if (active) active.video.pause(); },
      resume: function () {
        var entry = active;
        if (!entry) return;
        var promise = entry.video.play();
        if (promise && promise.catch) promise.catch(function () {
          if (active !== entry) return;
          entry.state = 'play-rejected'; notify(entry);
        });
      },
      toggle: function () { if (active) { if (active.video.paused) this.resume(); else this.pause(); } }
    };
  }
  return { validateSource: validateSource, createSwitchScheduler: createSwitchScheduler, createPlayer: createPlayer };
}));
