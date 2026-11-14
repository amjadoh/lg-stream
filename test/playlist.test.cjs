'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseM3U, createLoader, MAX_BYTES, TIMEOUT_MS } = require('../app/playlist.js');

test('parses named M3U entries, resolves relative URLs and ignores unsafe lines', () => {
  const parsed = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Fallback" group-title="News",Arabic News
live/101.ts
#EXTINF:-1 group-title="Movies",Movie One
https://media.example/movie.m3u8?token=private
#EXTINF:-1,Bad
file:///private`, 'https://provider.example/get.php?token=private');
  assert.deepEqual(parsed, { entries: [
    { name: 'Arabic News', group: 'News', url: 'https://provider.example/live/101.ts' },
    { name: 'Movie One', group: 'Movies', url: 'https://media.example/movie.m3u8?token=private' }
  ], truncated: false });
});

function controlledStream(chunks) {
  let index = 0;
  return { getReader: () => ({
    read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
    cancel: () => Promise.resolve()
  }) };
}

test('loads one bounded private playlist request without exposing its URL in results', async () => {
  const body = new TextEncoder().encode('#EXTM3U\n#EXTINF:-1 group-title="رياضة",قناة 1\nhttps://stream.example/1.m3u8?secret=x');
  let request;
  const loader = createLoader({ fetch: async (url, options) => {
    request = { url, options };
    return { ok: true, headers: { get: () => String(body.byteLength) }, body: controlledStream([body]) };
  } });
  const result = await loader.start('https://provider.example/get.php?username=u&password=p&type=m3u_plus');
  assert.equal(result.state, 'complete');
  assert.equal(result.entries[0].name, 'قناة 1');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(JSON.stringify(result).includes('username=u'), false);
});

test('cancels pending loads and times out stalled playlists', async () => {
  const callbacks = [];
  const timers = { setTimeout(fn, delay) { callbacks.push({ fn, delay }); return callbacks.length; }, clearTimeout() {} };
  let signal;
  const loader = createLoader({ timers, fetch: (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  const pending = loader.start('https://provider.example/list.m3u');
  assert.equal(callbacks[0].delay, TIMEOUT_MS);
  callbacks[0].fn();
  assert.deepEqual(await pending, { state: 'timeout' });
  assert.equal(signal.aborted, true);
});

test('reads a bounded prefix of a large playlist instead of rejecting it', async () => {
  const first = new TextEncoder().encode('#EXTM3U\n#EXTINF:-1,قناة اختبار\nhttps://stream.example/live.ts\n');
  const padding = new Uint8Array(MAX_BYTES - first.byteLength);
  padding.fill(35);
  const overflow = new Uint8Array(32);
  let cancelled = false;
  const body = { getReader: () => {
    const chunks = [first, padding, overflow];
    let index = 0;
    return {
      read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
      cancel: () => { cancelled = true; return Promise.resolve(); }
    };
  } };
  const loader = createLoader({ fetch: async () => ({
    ok: true, headers: { get: () => String(MAX_BYTES * 4) }, body
  }) });
  const result = await loader.start('https://provider.example/large.m3u');
  assert.equal(result.state, 'complete');
  assert.equal(result.entries[0].name, 'قناة اختبار');
  assert.equal(result.truncated, true);
  assert.equal(cancelled, true);
});
