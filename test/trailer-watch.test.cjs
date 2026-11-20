'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrailerWatch } = require('../service/trailer-watch.js');

function fakeTimers() {
  let next = 1; const queue = new Map();
  return {
    setTimeout: (fn, delay) => { const id = next++; queue.set(id, { fn, delay }); return id; },
    clearTimeout: id => queue.delete(id),
    run: () => { const all = Array.from(queue.values()); queue.clear(); all.forEach(item => item.fn()); },
    delays: () => Array.from(queue.values()).map(item => item.delay)
  };
}
const yt = state => [{ appId: 'youtube.leanback.v4', playState: state }];

test('Trailer watch: returns once after the YouTube video stops', () => {
  const timers = fakeTimers(); let returns = 0; const stops = [];
  const watch = createTrailerWatch({ timers, onEnd: () => returns++, onStop: reason => stops.push(reason) });
  watch.handle([]); watch.handle(yt('starting')); watch.handle(yt('loaded'));
  assert.deepEqual(timers.delays(), [], 'Nothing before the trailer plays');
  watch.handle(yt('playing')); watch.handle([]);
  assert.deepEqual(timers.delays(), [1500]);
  watch.handle(yt('starting'));
  assert.deepEqual(timers.delays(), [], 'A short gap (an ad, the next stream) cancels the return');
  watch.handle(yt('playing')); watch.handle(yt('unloaded'));
  timers.run();
  assert.equal(returns, 1);
  assert.deepEqual(stops, ['ended']);
  watch.handle(yt('playing')); watch.handle([]); timers.run();
  assert.equal(returns, 1, 'One-shot');
  assert.deepEqual(watch.state(), { active: false, sawPlaying: true, events: 8, last: 'unloaded', result: 'ended' }, 'Events after the end are ignored');
});

test('Trailer watch: a pause returns only after two minutes', () => {
  const timers = fakeTimers(); let returns = 0;
  const watch = createTrailerWatch({ timers, onEnd: () => returns++ });
  watch.handle(yt('playing')); watch.handle(yt('paused'));
  assert.deepEqual(timers.delays(), [120000], 'Paused: wait two minutes');
  watch.handle(yt('paused'));
  assert.deepEqual(timers.delays(), [120000], 'A repeated paused report keeps the same count');
  watch.handle(yt('playing'));
  assert.deepEqual(timers.delays(), [], 'Playing again cancels the count');
  watch.handle(yt('paused')); watch.handle([]);
  assert.deepEqual(timers.delays(), [1500], 'Stopping while paused returns after the short gap');
  watch.handle(yt('paused'));
  timers.run();
  assert.equal(returns, 1);
  assert.equal(watch.state().result, 'paused-too-long');
});

test('Trailer watch: another app playing or a stop request never returns', () => {
  const timers = fakeTimers(); let returns = 0;
  const watch = createTrailerWatch({ timers, onEnd: () => returns++ });
  watch.handle(yt('playing')); watch.handle(yt('paused')); watch.handle([{ appId: 'netflix', playState: 'playing' }]); watch.handle([]); timers.run();
  assert.equal(returns, 0); assert.equal(watch.state().result, 'other-app');
  const second = createTrailerWatch({ timers, onEnd: () => returns++ });
  second.handle(yt('playing')); second.handle([]); second.stop('app-shown'); timers.run();
  assert.equal(returns, 0); assert.equal(second.state().result, 'app-shown');
});
