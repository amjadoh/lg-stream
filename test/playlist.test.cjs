'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseM3U, createLoader, TIMEOUT_MS, TOTAL_TIMEOUT_MS, MAX_DOWNLOAD_BYTES, MAX_LINE_LENGTH } = require('../app/playlist.js');

test('parses named M3U entries and resolves relative URLs', () => {
  const parsed = parseM3U(`#EXTM3U url-tvg="https://provider.example/epg.xml"
#EXTINF:-1 tvg-id="news.1" tvg-name="Fallback" group-title="News" rating="8.4" added="1731542400",Arabic News
live/101.ts
#EXTINF:-1 group-title="Movies" release-date="2023-05-01",Movie One
https://media.example/movie.m3u8?token=private`, 'https://provider.example/get.php?token=private');
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

test('parses a synthetic catalogue with 331681 declared entries through its final item', () => {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < 331681; index++) lines.push(`#EXTINF:-1,عنصر ${index}\nhttps://stream.invalid/live/${index}`);
  const parsed = parseM3U(lines.join('\n'), 'https://provider.invalid/list.m3u');
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.entries.length, 331681);
  assert.equal(parsed.entries.at(-1).name, 'عنصر 331680');
});


test('reads the title delimiter outside quoted attributes and preserves distinct long groups', () => {
  const group = 'مجموعة طويلة '.repeat(12);
  const title = 'عنوان طويل '.repeat(20);
  const parsed = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="News, World" tvg-logo="https://poster.invalid/secret" description="first, second",Actual title
https://media.invalid/one
#EXTINF:-1 group-title="${group}A",${title}
https://media.invalid/two
#EXTINF:-1 group-title="${group}B",Other title
https://media.invalid/three`, 'https://provider.invalid/list');
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.entries[0].name, 'Actual title');
  assert.equal(parsed.entries[0].group, 'News, World');
  assert.equal(parsed.entries[0].description, 'first, second');
  assert.equal(parsed.entries[1].name, title.trim());
  assert.notEqual(parsed.entries[1].group, parsed.entries[2].group);
});

test('rejects invalid documents and incomplete items without returning a partial catalogue', async () => {
  const goodItem = '#EXTM3U\n#EXTINF:-1,Valid\nhttps://media.invalid/one\n';
  const invalid = [
    '<html>\n<body>Subscription expired</body>\n</html>',
    '{"error":"expired"}', 'Subscription expired',
    '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts',
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8',
    goodItem + '#EXTINF:-1,Missing URI',
    goodItem + '#EXTINF',
    goodItem + '#EXTINF:-1,Bad URI\nfile:///private',
    goodItem + '#EXTINF:-1,Missing URI\n#EXTINF:-1,Next\nhttps://media.invalid/next',
    goodItem + '#EXTINF:-1,Invalid URI\nsubscription expired',
    goodItem + '#EXTINF:-1 group-title="unterminated,Wrong\nhttps://media.invalid/next'
  ];
  for (const text of invalid) {
    const bytes = new TextEncoder().encode(text);
    const loader = createLoader({ fetch: async () => ({ ok: true, body: controlledStream([bytes]) }) });
    const result = await loader.start('https://provider.invalid/list');
    assert.equal(result.state, 'invalid');
    assert.equal(Object.hasOwn(result, 'entries'), false, 'Invalid data cannot be accidentally saved as partial success');
    const parsed = parseM3U(text, 'https://provider.invalid/list');
    assert.equal(parsed.truncated, true);
    assert.deepEqual(parsed.entries, []);
  }
});

test('rejects oversized responses and lines, including lines split across chunks', async () => {
  for (const chunks of [
    [{ byteLength: MAX_DOWNLOAD_BYTES + 1 }],
    [new TextEncoder().encode('#EXTM3U\n#EXTINF:-1,' + 'a'.repeat(MAX_LINE_LENGTH / 2)), new TextEncoder().encode('a'.repeat(MAX_LINE_LENGTH / 2))],
    [new TextEncoder().encode('#EXTM3U\n#EXTINF:-1,' + 'a'.repeat(MAX_LINE_LENGTH) + '\nhttps://media.invalid/one')]
  ]) {
    const loader = createLoader({ fetch: async () => ({ ok: true, body: controlledStream(chunks) }) });
    const result = await loader.start('https://provider.invalid/list');
    assert.equal(result.state, 'limit');
    assert.equal(Object.hasOwn(result, 'entries'), false);
  }
});

test('uses the final response URL for relative entries and bounds trickling downloads', async () => {
  const callbacks = [];
  const cleared = [];
  const timers = { setTimeout(fn, delay) { callbacks.push({ fn, delay }); return callbacks.length; }, clearTimeout(id) { cleared.push(id); } };
  const body = new TextEncoder().encode('#EXTM3U\n#EXTINF:-1,One\nitem.ts');
  const completed = createLoader({ fetch: async () => ({ ok: true, url: 'https://redirect.invalid/nested/list', body: controlledStream([body]) }) });
  const result = await completed.start('https://provider.invalid/list');
  assert.equal(result.entries[0].url, 'https://redirect.invalid/nested/item.ts');
  const pending = createLoader({ timers, fetch: async () => ({ ok: true, body: { getReader() { let first = true; return { read() { if (first) { first = false; return Promise.resolve({ done: false, value: body }); } return new Promise(() => {}); }, cancel() { return Promise.resolve(); } }; } } }) });
  const loading = pending.start('https://provider.invalid/list');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(callbacks.filter(item => item.delay === TIMEOUT_MS).length > 1, 'Received data renews only the idle timeout');
  assert.equal(callbacks.filter(item => item.delay === TOTAL_TIMEOUT_MS).length, 1);
  callbacks.find(item => item.delay === TOTAL_TIMEOUT_MS).fn();
  assert.deepEqual(await loading, { state: 'timeout' });
  assert.ok(cleared.length > 0);
});
