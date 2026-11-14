'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSource, createSwitchScheduler, createPlayer } = require('../app/core.js');

test('accepts signed HTTP media URLs without rewriting and rejects non-network sources', () => {
  const source = 'https://example.test/a%2Fb.m3u8?token=a%2Bb&x=1';
  assert.equal(validateSource(source), source);
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:video/mp4;base64,', '/relative', 'https://good.test/\nsecret']) assert.equal(validateSource(value), null);
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
    paused: false, videoWidth: 1920, videoHeight: 1080, handlers, historic,
    addEventListener(name, callback) { handlers.set(name, callback); historic.set(name, callback); },
    removeEventListener(name) { handlers.delete(name); },
    fire(name) { handlers.get(name)?.(); },
    pause() { this.paused = true; this.fire('pause'); },
    play() { this.paused = false; return { catch: callback => { this.rejectPlay = callback; } }; },
    load() {}, removeAttribute(name) { if (name === 'src') delete this.src; }
  };
}

test('switch releases old media and ignores stale events and promise rejection without exposing URLs', () => {
  const videos = []; const mounted = []; const states = []; const lifecycle = [];
  const player = createPlayer({
    createVideo: () => { const video = fakeVideo(); videos.push(video); return video; },
    mountVideo: video => { assert.equal(mounted.length, 0); mounted.push(video); lifecycle.push('mount'); },
    unmountVideo: video => { assert.equal(video.src, undefined); mounted.splice(mounted.indexOf(video), 1); lifecycle.push('release'); },
    now: () => 100, onState: state => states.push(state)
  });
  player.start('https://example.test/private-password-token', 1);
  player.start('https://example.test/second', 2);
  const count = states.length;
  videos[0].historic.get('playing')(); videos[0].rejectPlay();
  assert.equal(states.length, count);
  assert.deepEqual(lifecycle, ['mount', 'release', 'mount']);
  assert.equal(mounted.length, 1);
  assert.equal(JSON.stringify(states).includes('example.test'), false);
  assert.equal(JSON.stringify(states).includes('private-password-token'), false);
  player.stop(); assert.equal(mounted.length, 0);
});

test('measures startup separately from later buffering and does not invent first-frame evidence', () => {
  let time = 0; let video; let state;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => {}, unmountVideo: () => {},
    now: () => time, onState: next => { state = next; }
  });
  player.start('https://example.test/live', 1);
  time = 20; video.fire('waiting'); assert.equal(state.stalls, 0);
  time = 400; video.fire('playing'); assert.equal(state.playingMs, 400);
  assert.equal(state.firstFrameMs, null); assert.equal(state.frameApi, false);
  time = 1000; video.fire('waiting'); time = 1100; video.fire('waiting');
  assert.equal(state.stalls, 1);
  time = 1300; video.fire('playing'); assert.equal(state.stallMs, 300);
  assert.equal(state.playingMs, 400);
});
