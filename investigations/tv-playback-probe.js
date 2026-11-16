/* Paste into the TV app's Web Inspector console only when a short native
 * observation is needed. No source/track names, URLs, network, storage, UI
 * changes or playback commands. Automatically detaches after 20 seconds.
 * The result is observations, NOT a diagnosis of network, GPU or A/V sync. */
(function () {
  'use strict';
  if (typeof window.__lgPlaybackProbeStop === 'function') window.__lgPlaybackProbeStop();
  var video = document.querySelector('video');
  if (!video) { console.log('LG playback probe: no active video'); return; }
  var started = performance.now(); var timer = null; var done = false;
  var events = {}; var samples = [];
  var eventNames = ['playing', 'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'resize', 'ratechange', 'emptied', 'abort', 'error', 'pause', 'ended'];
  function number(value) { return typeof value === 'number' && isFinite(value) ? Math.round(value * 1000) / 1000 : null; }
  function read(getter) { try { return getter(); } catch (_) { return null; } }
  function sample() {
    var position = read(function () { return video.currentTime; });
    var ahead = read(function () {
      if (typeof position !== 'number' || !isFinite(position)) return null;
      var ranges = video.buffered;
      for (var i = 0; i < ranges.length; i++) if (position >= ranges.start(i) && position <= ranges.end(i)) return number(ranges.end(i) - position);
      return 0;
    });
    var quality = read(function () {
      if (typeof video.getVideoPlaybackQuality !== 'function') return null;
      var value = video.getVideoPlaybackQuality();
      return { total: number(value.totalVideoFrames), dropped: number(value.droppedVideoFrames) };
    });
    var rect = read(function () { var value = video.getBoundingClientRect(); return { width: number(value.width), height: number(value.height) }; });
    return {
      elapsedMs: number(performance.now() - started), time: number(position), bufferedAhead: ahead,
      readyState: number(read(function () { return video.readyState; })), networkState: number(read(function () { return video.networkState; })),
      paused: read(function () { return !!video.paused; }), seeking: read(function () { return !!video.seeking; }),
      rate: number(read(function () { return video.playbackRate; })),
      width: number(read(function () { return video.videoWidth; })), height: number(read(function () { return video.videoHeight; })),
      errorCode: number(read(function () { return video.error ? video.error.code : null; })),
      quality: quality, rect: rect, videoCount: document.querySelectorAll('video').length,
      sameVideo: document.querySelector('video') === video,
      controlsVisible: !!(document.getElementById('media-controls') && !document.getElementById('media-controls').hidden)
    };
  }
  function onEvent(event) { events[event.type] = (events[event.type] || 0) + 1; }
  function stop(reason) {
    if (done) return window.__lgPlaybackProbeResult;
    done = true; clearTimeout(timer);
    eventNames.forEach(function (name) { video.removeEventListener(name, onEvent); });
    var result = { schema: 1, reason: reason === 'changed-video' ? reason : reason === 'complete' ? reason : 'manual', events: events, samples: samples };
    window.__lgPlaybackProbeResult = result;
    delete window.__lgPlaybackProbeStop;
    console.log('LG playback probe (observations only): ' + JSON.stringify(result));
    return result;
  }
  function tick() {
    if (done) return;
    var value = sample(); samples.push(value);
    if (!value.sameVideo) { stop('changed-video'); return; }
    if (value.elapsedMs >= 20000 || samples.length >= 21) { stop('complete'); return; }
    timer = setTimeout(tick, 1000);
  }
  eventNames.forEach(function (name) { video.addEventListener(name, onEvent); });
  window.__lgPlaybackProbeStop = function () { return stop('manual'); };
  tick();
}());
