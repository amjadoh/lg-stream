'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSource, qualityLabel, createSwitchScheduler, createPlayer } = require('../app/core.js');

test('accepts signed HTTP media URLs without rewriting and rejects non-network sources', () => {
  const source = 'https://example.test/a%2Fb.m3u8?token=a%2Bb&x=1';
  assert.equal(validateSource(source), source);
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:video/mp4;base64,', '/relative', 'https://good.test/\nsecret']) assert.equal(validateSource(value), null);
});

test('labels decoded video dimensions without trusting channel names', () => {
  assert.equal(qualityLabel(0, 0), '');
  assert.equal(qualityLabel(720, 576), 'SD');
  assert.equal(qualityLabel(1280, 720), 'HD');
  assert.equal(qualityLabel(1920, 1080), 'FHD');
  assert.equal(qualityLabel(2560, 1440), 'QHD');
  assert.equal(qualityLabel(3840, 2160), '4K');
});

test('rapid channel requests commit only the latest and cancelled callbacks remain harmless', () => {
  const callbacks = []; const selected = [];
  const scheduler = createSwitchScheduler(value => selected.push(value), {
    setTimeout: fn => { callbacks.push(fn); return callbacks.length; }, clearTimeout: () => {}
  });
  scheduler.request(0); scheduler.request(1); scheduler.request(2);
  callbacks.forEach(fn => fn()); assert.deepEqual(selected, [2]);
  scheduler.request(1); scheduler.cancel(); callbacks.at(-1)(); assert.deepEqual(selected, [2]);
  scheduler.request(0); scheduler.immediate(1); callbacks.at(-1)(); assert.deepEqual(selected, [2, 1]);
});

function fakeVideo() {
  const handlers = new Map(); const historic = new Map();
  return {
    paused: false, seeking: false, currentTime: 0, videoWidth: 1920, videoHeight: 1080, handlers, historic,
    addEventListener(name, callback) { handlers.set(name, callback); historic.set(name, callback); },
    removeEventListener(name) { handlers.delete(name); },
    fire(name) { handlers.get(name)?.(); },
    pause() { this.paused = true; this.fire('pause'); },
    play() { this.paused = false; return { catch: callback => { this.rejectPlay = callback; } }; },
    load() {}, removeAttribute(name) { if (name === 'src') delete this.src; }
  };
}
function fakeTimers() {
  const entries = [];
  return {
    entries,
    setTimeout(callback, delay) { entries.push({ callback, delay, cancelled: false }); return entries.length; },
    clearTimeout(id) { entries[id - 1].cancelled = true; }
  };
}

test('switch releases old media and ignores stale events and promise rejection without exposing URLs', () => {
  const videos = []; const mounted = []; const states = []; const lifecycle = [];
  const timers = fakeTimers();
  const player = createPlayer({
    createVideo: () => { const video = fakeVideo(); videos.push(video); return video; },
    mountVideo: video => { assert.equal(mounted.length, 0); mounted.push(video); lifecycle.push('mount'); },
    unmountVideo: video => { assert.equal(video.src, undefined); mounted.splice(mounted.indexOf(video), 1); lifecycle.push('release'); },
    now: () => 100, onState: state => states.push(state), timers
  });
  player.start('https://example.test/private-password-token', 1);
  player.start('https://example.test/second', 2);
  const count = states.length;
  videos[0].historic.get('playing')(); videos[0].rejectPlay(); timers.entries[0].callback();
  assert.equal(states.length, count);
  assert.deepEqual(lifecycle, ['mount', 'release', 'mount']);
  assert.equal(mounted.length, 1);
  assert.equal(JSON.stringify(states).includes('example.test'), false);
  assert.equal(JSON.stringify(states).includes('private-password-token'), false);
  videos[1].error = { code: 3, message: 'https://example.test/private-password-token' };
  videos[1].fire('error');
  assert.equal(states.at(-1).errorCode, 3);
  assert.equal(mounted.length, 0);
  assert.equal(videos[1].src, undefined);
  const failed = states.at(-1);
  videos[1].historic.get('playing')(); videos[1].rejectPlay();
  assert.equal(states.at(-1), failed);
  assert.equal(JSON.stringify(states).includes('private-password-token'), false);
  player.stop(); assert.equal(mounted.length, 0);
});

test('pause and newer play intents invalidate old rejections within the same media element', () => {
  const timers = fakeTimers();
  let video; let state; let mounted = 0;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => { mounted++; }, unmountVideo: () => { mounted--; },
    now: () => 100, onState: next => { state = next; }, timers
  });
  player.start('https://example.test/live', 1);
  const initialRejection = video.rejectPlay;
  player.pause();
  initialRejection(); timers.entries[0].callback();
  assert.equal(state.state, 'paused'); assert.equal(mounted, 1);
  assert.equal(timers.entries[0].cancelled, true);

  player.resume();
  const firstResumeRejection = video.rejectPlay;
  player.pause(); player.resume();
  video.fire('pause'); // A delayed pause event must not cancel a newer resume deadline.
  assert.equal(timers.entries.at(-1).cancelled, false);
  video.fire('playing');
  firstResumeRejection();
  assert.equal(state.state, 'playing'); assert.equal(mounted, 1);
  player.stop();
});

test('a current play rejection releases the source and ignores later events', () => {
  const timers = fakeTimers();
  let video; let state; let mounted = 0;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => { mounted++; }, unmountVideo: () => { mounted--; },
    now: () => 100, onState: next => { state = next; }, timers
  });
  player.start('https://example.test/private-token', 1);
  video.rejectPlay();
  assert.equal(state.state, 'play-rejected');
  assert.equal(mounted, 0); assert.equal(video.src, undefined);
  assert.equal(timers.entries[0].cancelled, true);
  const rejected = state;
  video.historic.get('playing')(); timers.entries[0].callback(); player.resume();
  assert.equal(state, rejected);
  assert.equal(JSON.stringify(state).includes('private-token'), false);
});

test('measures intent-to-start/progress including switch delay and aborts a stalled startup safely', () => {
  let time = 120; let video; let state; let mounted = 0;
  const timers = fakeTimers();
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => { mounted++; }, unmountVideo: () => { mounted--; },
    now: () => time, onState: next => { state = next; }, timers
  });
  player.start('https://example.test/live', 1, 0);
  assert.equal(timers.entries[0].delay, 15000);
  time = 140; video.fire('waiting'); assert.equal(state.stalls, 0);
  time = 520; video.fire('playing'); assert.equal(state.playingMs, 520);
  assert.equal(state.firstFrameMs, null); assert.equal(state.frameApi, false);
  video.fire('timeupdate'); assert.equal(state.progressMs, null);
  time = 580; video.currentTime = 0.04; video.fire('timeupdate'); assert.equal(state.progressMs, 580);
  assert.equal(timers.entries[0].cancelled, true);
  timers.entries[0].callback(); assert.equal(mounted, 1); // A queued expired callback is harmless after progress.
  time = 1000; video.fire('waiting'); time = 1100; video.fire('waiting');
  assert.equal(state.stalls, 1);
  time = 1300; video.fire('playing'); assert.equal(state.stallMs, 300);
  assert.equal(state.playingMs, 520);
  player.stop();
  time = 2000; player.start('https://example.test/stuck', 2, 1880);
  time = 17000; timers.entries.at(-1).callback();
  assert.equal(state.state, 'startup-timeout'); assert.equal(mounted, 0); assert.equal(video.src, undefined);
  const timedOut = state;
  video.historic.get('playing')(); video.rejectPlay();
  assert.equal(state, timedOut);
});
