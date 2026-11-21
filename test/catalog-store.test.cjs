'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, sameAccount } = require('../app/catalog-store.js');

function fakeIndexedDB({ openDelay = 0, commitDelay = 30, abortThrows = false, failWrite = () => false, seed = {} } = {}) {
  const records = { meta: new Map(seed.meta || []), chunks: new Map(seed.chunks || []) };
  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      let finished = false;
      const writes = [];
      function requestValue(value) {
        const request = {};
        queueMicrotask(() => { request.result = structuredClone(value); request.onsuccess && request.onsuccess(); });
        return request;
      }
      const transaction = {
        error: null,
        objectStore(name) {
          return {
            get(key) { return requestValue(records[name].get(key)); },
            put(value) {
              if (failWrite(value)) throw new Error('Synthetic storage failure');
              const copy = structuredClone(value); writes.push(() => records[name].set(copy.key, copy));
            },
            delete(key) { writes.push(() => records[name].delete(key)); },
            clear() { writes.push(() => records[name].clear()); },
            openKeyCursor() {
              const request = {}; const keys = Array.from(records[name].keys()); let index = 0;
              function next() { queueMicrotask(() => { request.result = index < keys.length ? { primaryKey: keys[index++], continue: next } : null; request.onsuccess(); }); }
              next(); return request;
            }
          };
        },
        abort() {
          if (abortThrows) throw Object.assign(new Error('already committing'), { name: 'InvalidStateError' });
          if (finished) return;
          finished = true;
          transaction.error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
          queueMicrotask(() => transaction.onabort && transaction.onabort());
        }
      };
      setTimeout(() => { if (!finished) { finished = true; writes.forEach(write => write()); transaction.oncomplete && transaction.oncomplete(); } }, commitDelay);
      return transaction;
    }
  };
  return { open() { const request = {}; setTimeout(() => { request.result = database; request.onsuccess(); }, openDelay); return request; } };
}

test('cancels a catalogue save while IndexedDB is still opening', async () => {
  const store = createStore({ indexedDB: fakeIndexedDB({ openDelay: 10 }) });
  const saving = store.save('https://private.invalid/list', [{ url: 'https://private.invalid/1', name: 'one' }]);
  assert.equal(store.cancel(), true);
  assert.deepEqual(await saving, { state: 'cancelled' });
});

test('does not report cancellation after IndexedDB commit can no longer abort', async () => {
  const store = createStore({ indexedDB: fakeIndexedDB({ abortThrows: true }) });
  const saving = store.save('https://private.invalid/list', [{ url: 'https://private.invalid/1', name: 'one' }]);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(store.cancel(), false);
  assert.equal((await saving).state, 'complete');
});


test('persists group visibility per section across same-source refresh and excludes another source', async () => {
  const indexed = fakeIndexedDB({ commitDelay: 1 });
  const store = createStore({ indexedDB: indexed });
  const source = 'https://provider.invalid/list';
  const entries = [{ url: 'https://media.invalid/one', name: 'One', group: 'News' }];
  const hiddenGroups = { tv: ['News'], movies: ['Drama'], series: [] };
  assert.equal((await store.save(source, entries)).state, 'complete');
  assert.equal((await store.saveHiddenGroups(source, hiddenGroups)).state, 'complete');
  const cold = createStore({ indexedDB: indexed });
  assert.deepEqual((await cold.load()).hiddenGroups, hiddenGroups);
  const refresh = await store.save(source, entries.concat({ url: 'https://media.invalid/two', name: 'Two' }));
  assert.equal(refresh.state, 'complete');
  assert.deepEqual(refresh.hiddenGroups, hiddenGroups, 'Save returns the preferences from the same committed source snapshot');
  const updated = await cold.load();
  assert.deepEqual(updated.hiddenGroups, hiddenGroups);
  assert.equal(updated.entries.length, 2, 'Cleanup by key preserves every current chunk');
  const anotherSource = await store.save('https://other.invalid/list', entries);
  assert.equal(anotherSource.state, 'complete');
  assert.equal(anotherSource.hiddenGroups, null);
  assert.equal((await cold.load()).hiddenGroups, null);
  const backToOriginal = await store.save(source, entries);
  assert.deepEqual(backToOriginal.hiddenGroups, hiddenGroups, 'A → B → A returns the same matching settings immediately and after reload');
  assert.deepEqual((await cold.load()).hiddenGroups, backToOriginal.hiddenGroups);
  assert.equal((await store.clear()).state, 'complete');
  assert.deepEqual(await cold.load(), { state: 'empty' });
});

test('failed or invalid group preferences leave the last good preferences and catalogue intact', async () => {
  let fail = false;
  const store = createStore({ indexedDB: fakeIndexedDB({ commitDelay: 1, failWrite: value => fail && value.key === 'group-visibility' }) });
  const source = 'https://provider.invalid/list';
  const groups = { tv: ['News'], movies: [], series: [] };
  await store.save(source, [{ url: 'https://media.invalid/one', name: 'One' }]);
  await store.saveHiddenGroups(source, groups);
  assert.deepEqual(await store.saveHiddenGroups(source, { tv: ['News'], movies: [], series: [123] }), { state: 'error' });
  fail = true;
  assert.deepEqual(await store.saveHiddenGroups(source, { tv: [], movies: [], series: [] }), { state: 'error' });
  const loaded = await store.load();
  assert.equal(loaded.state, 'complete');
  assert.equal(loaded.entries.length, 1);
  assert.deepEqual(loaded.hiddenGroups, groups);
});

test('distinguishes missing catalogue from corrupt metadata or chunks without exposing sources', async () => {
  const revision = 'test'; const source = 'https://provider.invalid/private';
  for (const seed of [
    { meta: [['active', { key: 'active', revision, source, count: 2, chunkCount: 0 }]] },
    { meta: [['active', { key: 'active', revision, source, count: 2, chunkCount: 1 }]], chunks: [['test:0', { key: 'test:0', revision, entries: [{}] }]] }
  ]) {
    const store = createStore({ indexedDB: fakeIndexedDB({ commitDelay: 1, seed }) });
    assert.deepEqual(await store.load(), { state: 'corrupt' });
  }
  assert.deepEqual(await createStore({ indexedDB: null }).load(), { state: 'error' });
});

test('native transport preferences preserve catalogue identity and survive refresh and reload', async () => {
  let fail = false;
  const indexed = fakeIndexedDB({ commitDelay: 1, failWrite: value => fail && value.key === 'live-transport' });
  const store = createStore({ indexedDB: indexed });
  const source = 'https://provider.example.test/get.php?username=user&password=pass';
  const entries = [{ url: 'https://provider.example.test/user/pass/42', name: 'Synthetic live' }];
  await store.save(source, entries);
  assert.equal((await store.load()).liveTransport, 'original', 'Old catalogues keep their original transport');
  assert.deepEqual(await store.saveLiveTransport(source, 'hls'), { state: 'complete' });
  const cold = createStore({ indexedDB: indexed });
  assert.equal((await cold.load()).liveTransport, 'hls');
  const refreshed = await store.save(source, entries);
  assert.equal(refreshed.liveTransport, 'hls');
  assert.deepEqual((await cold.load()).entries, entries, 'Transport choice never rewrites catalogue URLs');
  fail = true;
  assert.deepEqual(await store.saveLiveTransport(source, 'original'), { state: 'error' });
  assert.equal((await cold.load()).liveTransport, 'hls');
  fail = false;
  await store.save('https://other.example.test/list', entries);
  assert.equal((await cold.load()).liveTransport, 'original');
  assert.deepEqual(await store.saveLiveTransport(source, 'original'), { state: 'stale' });
  await store.save(source, entries);
  assert.equal((await cold.load()).liveTransport, 'hls', 'A stale save cannot overwrite matching source preferences');
  assert.deepEqual(await store.saveLiveTransport(source, 'invalid'), { state: 'error' });
  await store.clear();
  assert.deepEqual(await cold.load(), { state: 'empty' });
});

test('reopens IndexedDB after the platform closes the cached connection', async () => {
  const innerRequest = fakeIndexedDB().open();
  const database = await new Promise(resolve => { innerRequest.onsuccess = () => resolve(innerRequest.result); });
  let opens = 0; let closed = false; let firstDatabase = null;
  const indexedDB = {
    open() {
      const ownOpen = ++opens; const request = {};
      const wrapped = Object.create(database);
      wrapped.transaction = (...args) => {
        if (ownOpen === 1 && closed) throw Object.assign(new Error('connection is closing'), { name: 'InvalidStateError' });
        return database.transaction(...args);
      };
      if (ownOpen === 1) firstDatabase = wrapped;
      setTimeout(() => { request.result = wrapped; request.onsuccess(); }, 0);
      return request;
    }
  };
  const store = createStore({ indexedDB });
  const entries = [{ url: 'https://private.invalid/1', name: 'one' }];
  assert.equal((await store.save('https://private.invalid/list', entries)).state, 'complete');
  closed = true;
  assert.equal((await store.load()).state, 'complete', 'A closed connection is replaced instead of failing until restart');
  assert.equal(opens, 2);
  closed = false; firstDatabase.onclose();
  assert.equal((await store.load()).state, 'complete');
  assert.equal(opens, 2, 'A close event from a connection that is no longer cached is ignored');
});

test('large saves are split into batches yet switch the active catalogue atomically', async () => {
  const indexed = fakeIndexedDB({ commitDelay: 1 });
  const yields = [];
  const store = createStore({ indexedDB: indexed, batchChunks: 2, yieldTask: () => { yields.push(1); return Promise.resolve(); } });
  const source = 'https://provider.invalid/list';
  const first = Array.from({ length: 1200 }, (_, index) => ({ url: 'https://media.invalid/live/u/p/' + index + '.ts', name: 'C' + index }));
  const progress = [];
  const saved = await store.save(source, first, { onProgress: (done, total) => progress.push([done, total]), meta: [{ key: 'known-keys', source, keys: Float64Array.from([1, 2]) }] });
  assert.equal(saved.state, 'complete');
  assert.ok(yields.length >= 1, 'The store yields to the event loop between batches');
  assert.deepEqual(progress.at(-1), [3, 3]);
  assert.equal((await createStore({ indexedDB: indexed }).load()).entries.length, 1200);
  assert.deepEqual(Array.from((await store.loadMeta(['known-keys'])).records['known-keys'].keys), [1, 2], 'Meta records commit with the catalogue');
  // Cancelling between batches keeps the previous catalogue active.
  let cancelAfterFirst = true;
  const slow = createStore({ indexedDB: indexed, batchChunks: 1, yieldTask: () => { if (cancelAfterFirst) { cancelAfterFirst = false; slow.cancel(); } return Promise.resolve(); } });
  const second = first.concat(first).map((entry, index) => ({ ...entry, name: 'N' + index }));
  assert.equal((await slow.save(source, second)).state, 'cancelled');
  const kept = await createStore({ indexedDB: indexed }).load();
  assert.equal(kept.entries.length, 1200);
  assert.equal(kept.entries[0].name, 'C0');
});

test('meta records for sources and customization survive clearCatalog but not clear', async () => {
  const indexed = fakeIndexedDB({ commitDelay: 1 });
  const store = createStore({ indexedDB: indexed });
  await store.save('https://provider.invalid/list', [{ url: 'https://media.invalid/1', name: 'one' }]);
  assert.equal((await store.saveMeta([{ key: 'sources', list: [{ id: 's1', name: 'Main', url: 'https://provider.invalid/list' }], activeId: 's1' }])).state, 'complete');
  assert.equal((await store.clearCatalog()).state, 'complete');
  assert.deepEqual(await store.load(), { state: 'empty' });
  assert.equal((await store.loadMeta(['sources'])).records.sources.activeId, 's1');
  await store.clear();
  assert.equal((await store.loadMeta(['sources'])).records.sources, null);
});

test('a new server address for the same account keeps HLS and hidden groups', async () => {
  const indexed = fakeIndexedDB({ commitDelay: 1 });
  const store = createStore({ indexedDB: indexed });
  const oldServer = 'http://old.example.test:8080/get.php?username=user&password=pass&type=m3u_plus&output=ts';
  const newServer = 'http://new.example.test:2095/get.php?username=user&password=pass&type=m3u_plus&output=ts';
  const entries = [{ url: 'http://old.example.test:8080/user/pass/42', name: 'Synthetic live', group: 'News' }];
  const hiddenGroups = { tv: ['News'], movies: [], series: [] };
  await store.save(oldServer, entries);
  await store.saveLiveTransport(oldServer, 'hls');
  await store.saveHiddenGroups(oldServer, hiddenGroups);
  const moved = await store.save(newServer, entries);
  assert.equal(moved.liveTransport, 'hls', 'HLS follows the account to the new server');
  assert.deepEqual(moved.hiddenGroups, hiddenGroups, 'Hidden groups follow the account to the new server');
  const cold = await createStore({ indexedDB: indexed }).load();
  assert.equal(cold.liveTransport, 'hls');
  assert.deepEqual(cold.hiddenGroups, hiddenGroups);
  const otherAccount = await store.save('http://new.example.test:2095/get.php?username=user&password=other', entries);
  assert.equal(otherAccount.liveTransport, 'original', 'Another password is another source');
  assert.equal(otherAccount.hiddenGroups, null);
});

test('same account means same path, username and password on any host', () => {
  const link = (host, user = 'u', pass = 'p', path = '/get.php') => `http://${host}${path}?username=${user}&password=${pass}`;
  assert.equal(sameAccount(link('a.test:80'), link('b.test:2095')), true);
  assert.equal(sameAccount(link('a.test'), link('a.test', 'u', 'x')), false);
  assert.equal(sameAccount(link('a.test'), link('a.test', 'v', 'p')), false);
  assert.equal(sameAccount(link('a.test'), link('b.test', 'u', 'p', '/other.php')), false);
  assert.equal(sameAccount('https://a.test/list.m3u', 'https://b.test/list.m3u'), false, 'Plain links without an account must match exactly');
  assert.equal(sameAccount('https://a.test/list.m3u', 'https://a.test/list.m3u'), true);
  assert.equal(sameAccount('', link('a.test')), false);
});
