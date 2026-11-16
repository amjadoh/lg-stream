(function () {
  'use strict';
  if (window.__lgSweepStop) window.__lgSweepStop();
  if (!document.body.classList.contains('watch-mode') || !document.querySelector('video')) return { started: false };
  var stopped = false;
  var rows = [];
  var current = null;
  var timer;
  var eventNames = ['waiting', 'stalled', 'playing', 'error', 'ended'];
  function onEvent(event) {
    if (!current || event.target !== current.video) return;
    current.events[event.type] = (current.events[event.type] || 0) + 1;
  }
  eventNames.forEach(function (name) { document.addEventListener(name, onEvent, true); });
  function cleanup() {
    clearTimeout(timer);
    eventNames.forEach(function (name) { document.removeEventListener(name, onEvent, true); });
    delete window.__lgSweepStop;
  }
  window.__lgSweep = { running: true, requested: 24, rows: rows, ordinal: 0 };
  window.__lgSweepStop = function () { stopped = true; };
  function wait(ms) { return new Promise(function (resolve) { timer = setTimeout(resolve, ms); }); }
  function metric(id) { var text = document.getElementById(id).textContent; return /^[0-9]/.test(text) ? parseInt(text, 10) : null; }
  function round(n) { return Math.round(n * 1000) / 1000; }
  (async function () {
    try {
      for (var ordinal = 1; ordinal <= 24 && !stopped; ordinal++) {
        if (!document.body.classList.contains('watch-mode')) { window.__lgSweep.reason = 'left-watch-mode'; break; }
        if (!document.getElementById('media-controls').hidden) document.getElementById('media-close').click();
        var oldVideo = document.querySelector('video');
        var oldSource = oldVideo && oldVideo.src;
        var started = performance.now();
        current = { video: ordinal === 1 ? oldVideo : null, events: {} };
        if (ordinal > 1) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
        window.__lgSweep.ordinal = ordinal;
        var previousTime = null, firstTime = null, lastTime = null, progressAt = null;
        var backwards = 0, maxFlatMs = 0, flatMs = 0, maxVideos = 0, sampleCount = 0, minReady = 4;
        var oldReleased = ordinal === 1 ? null : false;
        while (!stopped) {
          await wait(500);
          var now = performance.now();
          var videos = document.querySelectorAll('video');
          maxVideos = Math.max(maxVideos, videos.length);
          var video = videos[0] || null;
          if (ordinal > 1 && video === oldVideo) {
            if (now - started >= 2000) { window.__lgSweep.reason = 'no-channel-change'; stopped = true; }
            continue;
          }
          if (video && !current.video) current.video = video;
          if (ordinal > 1) oldReleased = !oldVideo || (!oldVideo.isConnected && oldVideo.paused && !oldVideo.getAttribute('src'));
          if (video) {
            var time = video.currentTime;
            if (firstTime === null) firstTime = time;
            if (previousTime !== null) {
              var delta = time - previousTime;
              if (delta > 0.05 && progressAt === null) progressAt = now;
              if (delta < -0.2) backwards++;
              flatMs = delta < 0.05 ? flatMs + 500 : 0;
              maxFlatMs = Math.max(maxFlatMs, flatMs);
            }
            previousTime = time; lastTime = time; sampleCount++;
            if (progressAt !== null) minReady = Math.min(minReady, video.readyState);
          }
          var state = document.body.dataset.state;
          if (['error', 'ended', 'play-rejected', 'startup-timeout'].indexOf(state) >= 0) break;
          if (progressAt !== null && now - progressAt >= 8000) break;
          if (now - started >= 18000) break;
        }
        var active = document.querySelector('#channels .channel-button.active');
        var finalVideo = document.querySelector('video');
        rows.push({
          ordinal: ordinal, index: active ? Number(active.dataset.index) : null,
          elapsedMs: Math.round(performance.now() - started), state: document.body.dataset.state,
          switched: ordinal === 1 ? null : !!(finalVideo && finalVideo.src !== oldSource),
          oldReleased: oldReleased, maxVideos: maxVideos, samples: sampleCount,
          firstTime: firstTime === null ? null : round(firstTime), lastTime: lastTime === null ? null : round(lastTime),
          measuredProgressMs: progressAt === null ? null : Math.round(progressAt - started),
          playingMs: metric('playing-ms'), progressMs: metric('progress-ms'), frameMs: metric('frame-ms'),
          backwards: backwards, maxFlatMs: maxFlatMs, minReadyAfterProgress: minReady,
          width: finalVideo ? finalVideo.videoWidth : 0, height: finalVideo ? finalVideo.videoHeight : 0,
          nativeHls: finalVideo ? /\.m3u8(?:$|\?)/i.test(finalVideo.src) : null,
          audioTracks: finalVideo && finalVideo.audioTracks ? finalVideo.audioTracks.length : null,
          events: current.events, keptWatchMode: document.body.classList.contains('watch-mode')
        });
      }
    } catch (_) { window.__lgSweep.reason = 'probe-error'; }
    finally { current = null; cleanup(); window.__lgSweep.running = false; }
  }());
  return { started: true, count: 24, dwellAfterProgressMs: 8000 };
}())
