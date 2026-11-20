'use strict';
// Decides when a trailer opened in YouTube has ended, from the media service's
// foreground playback lists. Pure logic, so it can be tested off the TV.
//   playing  -> remembered
//   then the YouTube video unloads/stops, or no media is left at all
//            -> after a short gap (an ad ending, the next stream), call onEnd once
//   paused for two minutes -> onEnd too: Back on a paused video leaves YouTube
//            on a black screen with the video still paused (seen on the TV)
//   another app plays media -> give up without returning
var YOUTUBE_APP = 'youtube.leanback.v4';

function createTrailerWatch(options) {
  var timers = options.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
  var gap = options.gap === undefined ? 1500 : options.gap;
  var pauseLimit = options.pauseLimit === undefined ? 2 * 60 * 1000 : options.pauseLimit;
  var state = { active: true, sawPlaying: false, events: 0, last: '', result: '' };
  var pending = null; var pendingKind = '';
  function clearPending() { if (pending !== null) { timers.clearTimeout(pending); pending = null; pendingKind = ''; } }
  function schedule(kind, delay, result) {
    clearPending(); pendingKind = kind;
    pending = timers.setTimeout(function () { pending = null; pendingKind = ''; finish(result); }, delay);
  }
  function finish(result) {
    if (!state.active) return;
    state.active = false; state.result = result;
    clearPending();
    if (result === 'ended' || result === 'paused-too-long') options.onEnd();
    if (options.onStop) options.onStop(result);
  }
  function handle(list) {
    if (!state.active || !Array.isArray(list)) return;
    state.events += 1;
    var youtube = null; var other = false;
    list.forEach(function (item) { if (item && item.appId === YOUTUBE_APP) youtube = item; else if (item && item.appId) other = true; });
    state.last = youtube ? String(youtube.playState || '') : other ? 'other' : list.length ? 'unknown' : 'none';
    if (other) { finish('other-app'); return; }
    var paused = !!youtube && youtube.playState === 'paused';
    // A repeated paused report keeps the original two-minute count.
    if (paused && pendingKind === 'pause') return;
    clearPending();
    if (youtube && youtube.playState === 'playing') { state.sawPlaying = true; return; }
    if (!state.sawPlaying) return;
    if (paused) { schedule('pause', pauseLimit, 'paused-too-long'); return; }
    var ended = youtube ? /^(?:unloaded|stopped|endofstream|ended)$/i.test(String(youtube.playState)) : !list.length;
    if (ended) schedule('end', gap, 'ended');
  }
  return { handle: handle, stop: function (reason) { finish(reason || 'stopped'); }, state: function () { return { active: state.active, sawPlaying: state.sawPlaying, events: state.events, last: state.last, result: state.result }; } };
}

module.exports = { createTrailerWatch: createTrailerWatch, YOUTUBE_APP: YOUTUBE_APP };
