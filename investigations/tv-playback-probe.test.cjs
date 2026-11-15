'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname, 'tv-playback-probe.js'), 'utf8');
function environment() {
  let time = 0; let current; let id = 0; const timers = new Map(); const output = [];
  const listeners = new Map();
  const video = {
    currentTime: 10, buffered: { length: 1, start: () => 0, end: () => 14 },
    paused: false, seeking: false, playbackRate: 1, readyState: 4, networkState: 2, videoWidth: 1920, videoHeight: 1080,
    error: { code: 3, message: 'PRIVATE_ERROR_SENTINEL' },
    get src() { throw new Error('must not read source'); },
    get currentSrc() { throw new Error('must not read source'); },
    getVideoPlaybackQuality() { return { totalVideoFrames: 120, droppedVideoFrames: 2 }; },
    getBoundingClientRect() { return { width: 1920, height: 1080 }; },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name).delete(listener); },
    play() { throw new Error('must not play'); }, pause() { throw new Error('must not pause'); }, load() { throw new Error('must not load'); }
  };
  current = video;
  const context = vm.createContext({
    window: {}, document: { querySelector: () => current, querySelectorAll: () => current ? [current] : [], getElementById: () => ({ hidden: true }) },
    performance: { now: () => time }, console: { log: text => output.push(text) },
    setTimeout: callback => { timers.set(++id, callback); return id; }, clearTimeout: key => timers.delete(key)
  });
  function tick() { time += 1000; const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); }
  return { context, video, listeners, output, timers, tick, run: () => vm.runInContext(code, context), change: () => { current = null; } };
}
const env = environment(); env.run();
for (let i = 0; i < 20; i++) env.tick();
const result = env.context.window.__lgPlaybackProbeResult;
assert.equal(result.reason, 'complete'); assert.equal(result.samples.length, 21);
assert.equal(result.samples[0].bufferedAhead, 4); assert.equal(result.samples[0].errorCode, 3);
assert.equal(result.samples[0].quality.dropped, 2);
assert.equal(env.timers.size, 0); assert.equal([...env.listeners.values()].some(set => set.size), false);
assert.equal(env.context.window.__lgPlaybackProbeStop, undefined);
assert.ok(!env.output.join('').includes('PRIVATE_ERROR_SENTINEL'));
const changed = environment(); changed.run(); changed.change(); changed.tick();
assert.equal(changed.context.window.__lgPlaybackProbeResult.reason, 'changed-video');
assert.equal(changed.timers.size, 0);
const unsupported = environment(); unsupported.video.getVideoPlaybackQuality = () => { throw new Error('private platform error'); };
unsupported.run(); unsupported.context.window.__lgPlaybackProbeStop();
assert.equal(unsupported.context.window.__lgPlaybackProbeResult.samples[0].quality, null);
assert.equal(unsupported.timers.size, 0); assert.ok(!unsupported.output.join('').includes('private platform error'));
const replaced = environment(); replaced.run(); replaced.run();
assert.equal([...replaced.listeners.values()].every(set => set.size === 1), true, 'Re-running cancels the previous observation');
replaced.context.window.__lgPlaybackProbeStop(); assert.equal(replaced.timers.size, 0);
console.log('Read-only probe: finite sampling, listener cleanup, video replacement, unsupported APIs and secret-free output passed. No native playback tested.');
