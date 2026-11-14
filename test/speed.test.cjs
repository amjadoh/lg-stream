'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTest, MAX_BYTES, DURATION_MS } = require('../app/speed-test.js');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  const callbacks = [];
  return {
    time: 0, callbacks,
    timers: {
      setTimeout(callback, delay) { callbacks.push({ callback, delay, cancelled: false }); return callbacks.length; },
      clearTimeout(id) { callbacks[id - 1].cancelled = true; }
    }
  };
}
function stream(read) {
  return { read, cancellations: 0, releases: 0, cancel() { this.cancellations++; return Promise.resolve(); }, releaseLock() { this.releases++; } };
}

test('measures download including HTTP latency and uses one private, uncached request', async () => {
  const time = clock(); let request;
  const reader = stream(async () => {
    if (time.time === 200) { time.time = 1000; return { value: { byteLength: 500000 }, done: false }; }
    time.time = 2000; return { done: true };
  });
  const probe = createTest({ now: () => time.time, timers: time.timers, fetch: async (url, options) => {
    request = { url, options }; time.time = 200; return { ok: true, body: { getReader: () => reader } };
  } });
  assert.deepEqual(await probe.start(), { state: 'complete', mbps: 2, httpMs: 200, bytes: 500000, durationMs: 2000, limited: false });
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://speed.cloudflare.com/__down');
  assert.equal(url.searchParams.get('bytes'), String(MAX_BYTES)); assert.ok(url.searchParams.get('nonce'));
  for (const [key, value] of Object.entries({ method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', mode: 'cors' })) assert.equal(request.options[key], value);
  assert.equal(request.options.signal.aborted, true);
  assert.equal(time.callbacks[0].delay, DURATION_MS); assert.equal(time.callbacks[0].cancelled, true);
  assert.equal(reader.cancellations, 1); assert.equal(reader.releases, 1);
});

test('deadline includes a stalled tail and resolves without waiting for a pending read', async () => {
  const time = clock(); const pending = deferred(); let reads = 0;
  const reader = stream(() => {
    if (reads++ === 0) { time.time = 500; return Promise.resolve({ value: { byteLength: 1000000 }, done: false }); }
    return pending.promise;
  });
  const probe = createTest({ now: () => time.time, timers: time.timers, fetch: async () => {
    time.time = 100; return { ok: true, body: { getReader: () => reader } };
  } });
  const result = probe.start(); await flush();
  time.time = DURATION_MS; time.callbacks[0].callback();
  assert.deepEqual(await result, { state: 'complete', mbps: 1, httpMs: 100, bytes: 1000000, durationMs: 8000, limited: true });
  assert.equal(reader.cancellations, 1);
  pending.resolve({ value: { byteLength: MAX_BYTES }, done: false }); await flush();
  assert.equal(reads, 2); assert.equal(reader.cancellations, 1);
});

test('caps counted bytes and stops on an oversized final chunk', async () => {
  const time = clock(); let reads = 0;
  const reader = stream(async () => { reads++; time.time = 2000; return { value: { byteLength: MAX_BYTES + 1000 }, done: false }; });
  const probe = createTest({ now: () => time.time, timers: time.timers, fetch: async () => ({ ok: true, body: { getReader: () => reader } }) });
  const result = await probe.start();
  assert.equal(result.bytes, MAX_BYTES); assert.equal(result.mbps, 256); assert.equal(result.limited, true);
  assert.equal(reads, 1); assert.equal(reader.cancellations, 1);
});

test('cancel and replacement settle immediately and late responses cannot affect the new run', async () => {
  const time = clock(); const responses = [deferred(), deferred()]; const pendingRead = deferred(); const signals = [];
  let calls = 0;
  const probe = createTest({ now: () => time.time, timers: time.timers, fetch: (_, options) => { signals.push(options.signal); return responses[calls++].promise; } });
  const first = probe.start(); const second = probe.start();
  assert.deepEqual(await first, { state: 'cancelled' }); assert.equal(signals[0].aborted, true);
  const staleBody = stream(() => { throw new Error('A stale response must not be read'); });
  responses[0].resolve({ ok: true, body: staleBody }); await flush();
  assert.equal(staleBody.cancellations, 1);
  const reader = stream(() => pendingRead.promise);
  responses[1].resolve({ ok: true, body: { getReader: () => reader } }); await flush();
  time.callbacks[0].callback(); // Even a queued timeout from the old run is inert.
  assert.equal(signals[1].aborted, false);
  probe.cancel(); assert.equal(signals[1].aborted, true);
  assert.deepEqual(await second, { state: 'cancelled' }); assert.equal(reader.cancellations, 1);
  pendingRead.resolve({ value: { byteLength: MAX_BYTES }, done: false }); await flush();
  assert.equal(reader.cancellations, 1);
});

test('empty deadline, HTTP errors, missing streaming support and thrown errors are bounded and sanitized', async () => {
  const time = clock(); const pending = deferred(); let signal;
  const probe = createTest({ now: () => time.time, timers: time.timers, fetch: (_, options) => { signal = options.signal; return pending.promise; } });
  const result = probe.start(); time.time = DURATION_MS; time.callbacks[0].callback();
  assert.deepEqual(await result, { state: 'error' }); assert.equal(signal.aborted, true);
  const lateBody = stream(() => {}); pending.resolve({ ok: true, body: lateBody }); await flush();
  assert.equal(lateBody.cancellations, 1);
  const body = { calls: 0, cancel() { this.calls++; } };
  for (const [response, expected] of [[{ ok: false, body }, 'error'], [{ ok: true, body }, 'unsupported']]) {
    const check = createTest({ fetch: async () => response, now: () => time.time, timers: time.timers });
    assert.deepEqual(await check.start(), { state: expected });
  }
  assert.equal(body.calls, 2);
  assert.deepEqual(await createTest({ fetch: null }).start(), { state: 'unsupported' });
  assert.deepEqual(await createTest({ AbortController: null }).start(), { state: 'unsupported' });
  assert.deepEqual(await createTest({ AbortController: function () { throw new Error('unsupported'); } }).start(), { state: 'unsupported' });
  const failed = createTest({ fetch: async () => { throw new Error('private detail'); }, now: () => time.time, timers: time.timers });
  assert.deepEqual(await failed.start(), { state: 'error' });
});
