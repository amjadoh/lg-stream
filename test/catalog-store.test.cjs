'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../app/catalog-store.js');

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
