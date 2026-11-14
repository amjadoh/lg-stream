'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseM3U, createLoader, TIMEOUT_MS } = require('../app/playlist.js');

test('parses named M3U entries, resolves relative URLs and ignores unsafe lines', () => {
  const parsed = parseM3U(`#EXTM3U url-tvg="https://provider.example/epg.xml"
#EXTINF:-1 tvg-id="news.1" tvg-name="Fallback" group-title="News" rating="8.4" added="1731542400",Arabic News
live/101.ts
#EXTINF:-1 group-title="Movies" release-date="2023-05-01",Movie One
https://media.example/movie.m3u8?token=private
#EXTINF:-1,Bad
file:///private`, 'https://provider.example/get.php?token=private');
  assert.deepEqual(parsed, { entries: [
    { name: 'Arabic News', group: 'News', id: 'news.1', url: 'https://provider.example/live/101.ts', poster: null, year: '', rating: '8.4', added: '1731542400', description: '', trailer: null },
    { name: 'Movie One', group: 'Movies', id: '', url: 'https://media.example/movie.m3u8?token=private', poster: null, year: '2023', rating: '', added: '', description: '', trailer: null }
  ], truncated: false, truncatedReason: null });
});

test('keeps every live item and finds real movie and series paths afterward', () => {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < 3001; index++) lines.push(`#EXTINF:-1 group-title="أفلام مباشرة",بث ${index}\nhttps://media.example/live/${index}.ts`);
  lines.push('#EXTINF:-1 group-title="أفلام VOD",فيلم حقيقي\nhttps://media.example/movie/u/p/1.mp4');
  lines.push('#EXTINF:-1 group-title="مسلسلات VOD",حلقة حقيقية\nhttps://media.example/series/u/p/2.mp4');
  const parsed = parseM3U(lines.join('\n'), 'https://provider.example/list.m3u');
  assert.equal(parsed.entries.filter(entry => entry.url.includes('/live/')).length, 3001);
  assert.equal(parsed.entries.some(entry => entry.url.includes('/movie/') && entry.name === 'فيلم حقيقي'), true);
  assert.equal(parsed.entries.some(entry => entry.url.includes('/series/') && entry.name === 'حلقة حقيقية'), true);
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

test('streams a catalogue beyond the former 5000-entry ceiling and keeps its last item', async () => {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < 6001; index++) lines.push(`#EXTINF:-1 group-title="مجموعة ${Math.floor(index / 100)}",قناة ${index}\nhttps://stream.example/live/${index}.ts`);
  lines.push('#EXTINF:-1 group-title="آخر المسلسلات",آخر حلقة\nhttps://stream.example/series/u/p/999.mp4');
  const body = new TextEncoder().encode(lines.join('\n'));
  const loader = createLoader({ fetch: async () => ({ ok: true, headers: { get: () => String(body.byteLength) }, body: controlledStream([body]) }) });
  const result = await loader.start('https://provider.example/large.m3u');
  assert.equal(result.state, 'complete');
  assert.equal(result.entries.length, 6002);
  assert.equal(result.entries.at(-1).name, 'آخر حلقة');
  assert.equal(result.truncated, false);
});

test('parses a synthetic catalogue with 331666 declared entries through its final item', () => {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < 331666; index++) lines.push(`#EXTINF:-1,عنصر ${index}\nhttps://stream.invalid/live/${index}`);
  const parsed = parseM3U(lines.join('\n'), 'https://provider.invalid/list.m3u');
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.entries.length, 331666);
  assert.equal(parsed.entries.at(-1).name, 'عنصر 331665');
});
