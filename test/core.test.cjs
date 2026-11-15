'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSource, qualityLabel, buildSectionIndex, searchCatalog, youtubeSearchTarget, createSwitchScheduler, createPlayer } = require('../app/core.js');

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

test('collects groups from a full-size catalogue in one pass and preserves provider order', () => {
  const entries = Array.from({ length: 331681 }, (_, index) => ({ group: `مجموعة ${index % 6000}`, name: `عنوان ${index}` }));
  const index = buildSectionIndex(entries, (_, itemIndex) => itemIndex % 2 === 0);
  assert.equal(index.all.length, 165841);
  assert.equal(index.groups.length, 3000);
  assert.deepEqual(index.groups.slice(0, 4), ['مجموعة 0', 'مجموعة 2', 'مجموعة 4', 'مجموعة 6']);
  assert.deepEqual(index.byGroup['مجموعة 2'].slice(0, 3), [2, 6002, 12002]);
  const results = searchCatalog(entries, 'عنوان 33168', index => ['tv', 'movies', 'series'][index % 3], 12);
  assert.equal(results.counts.tv + results.counts.movies + results.counts.series, 2);
  assert.ok(results.matches.tv.length <= 12 && results.matches.movies.length <= 12 && results.matches.series.length <= 12);
});

test('builds a YouTube TV voice search with title and year exactly once', () => {
  const target = new URL(youtubeSearchTarget('فيلم تجريبي 2024', '2024'));
  assert.equal(target.origin + target.pathname, 'https://www.youtube.com/tv');
  assert.equal(target.searchParams.get('launch'), 'voice');
  assert.equal(target.searchParams.get('vq'), 'Search for فيلم تجريبي 2024 on YouTube');
  assert.equal(youtubeSearchTarget('', '2024'), null);
});

test('search omits hidden entries from both results and totals', () => {
  const entries = [{ name: 'عنوان مخفي' }, { name: 'عنوان ظاهر' }];
  const result = searchCatalog(entries, 'عنوان', index => index === 0 ? null : 'tv', 12);
  assert.deepEqual(result.matches, { tv: [1], movies: [], series: [] });
  assert.deepEqual(result.counts, { tv: 1, movies: 0, series: 0 });
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

test('seeking and its refill do not inflate playback stall measurements', () => {
  let time = 0; let video; let state;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo() {}, unmountVideo() {},
    now: () => time, onState: next => { state = next; }, timers: fakeTimers()
  });
  player.start('https://example.test/movie', 1);
  video.fire('playing');
  time = 100; video.fire('waiting');
  assert.equal(state.stalls, 1);
  time = 150; video.seeking = true; video.fire('seeking');
  time = 200; video.fire('waiting');
  assert.equal(state.state, 'waiting', 'Seeking still exposes the waiting state');
  assert.equal(state.stalls, 1);
  assert.equal(state.stallMs, 50, 'Only the wait before seeking counts');
  video.seeking = false; video.fire('seeked');
  time = 300; video.fire('waiting');
  assert.equal(state.stalls, 1, 'Refill after seeked still belongs to the seek');
  time = 500; video.fire('playing');
  assert.equal(state.stallMs, 50);
  time = 600; video.fire('waiting');
  assert.equal(state.stalls, 2, 'A new stall after playback resumes still counts');
  time = 700; video.fire('playing');
  assert.equal(state.stallMs, 150);
  player.stop();
});

test('buffered seeking ends on media progress even without another playing event', () => {
  let video; let state;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo() {}, unmountVideo() {},
    onState: next => { state = next; }, timers: fakeTimers()
  });
  player.start('https://example.test/movie', 1);
  video.fire('playing'); video.currentTime = 10; video.fire('timeupdate');
  video.seeking = true; video.fire('seeking'); video.currentTime = 30;
  video.seeking = false; video.fire('seeked'); video.fire('timeupdate');
  video.fire('waiting');
  assert.equal(state.stalls, 0, 'The seek jump and a stationary update do not end refill');
  video.currentTime = 30.1; video.fire('timeupdate');
  video.fire('waiting');
  assert.equal(state.stalls, 1, 'Actual progress ends seeking even without playing');
  player.stop();
});

// Unknown and mixed groups must not silently acquire an incorrect genre.
assert.equal(require('../app/core.js').groupCategory('beIN'), 'other');
assert.equal(require('../app/core.js').groupCategory('RU 4K'), 'other');
assert.equal(require('../app/core.js').groupCategory('رياضة HD'), 'sports');
assert.equal(require('../app/core.js').groupCategory('Sports / News'), 'other');
assert.equal(require('../app/core.js').groupCategory('قنوات أفلام'), 'movies');
assert.equal(require('../app/core.js').groupCategory('الرياض'), 'other');


test('an invalid next source releases the previous media and reports failure without source data', () => {
  const videos = []; let mounted = 0; const states = [];
  const player = createPlayer({
    createVideo: () => { const video = fakeVideo(); videos.push(video); return video; },
    mountVideo: () => mounted++, unmountVideo: () => mounted--,
    onState: value => states.push(value), timers: fakeTimers()
  });
  assert.equal(player.start('https://example.test/first', 1), true);
  assert.equal(player.start('https://example.test/' + 'x'.repeat(4096), 2), false);
  assert.equal(mounted, 0); assert.equal(videos[0].src, undefined);
  assert.equal(states.at(-1).state, 'error'); assert.equal(states.at(-1).channel, 2);
  assert.ok(!JSON.stringify(states).includes('example.test'));
  const count = states.length; videos[0].historic.get('playing')(); videos[0].rejectPlay();
  assert.equal(states.length, count, 'Old events cannot revive the rejected selection');
  assert.equal(player.start('https://example.test/next', 3), true); assert.equal(mounted, 1);
});
