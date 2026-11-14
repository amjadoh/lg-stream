'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../app/catalog-store.js');

function fakeIndexedDB({ openDelay = 0, commitDelay = 30, abortThrows = false } = {}) {
  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      let finished = false;
      const transaction = {
        error: null,
        objectStore: () => ({ put() {} }),
        abort() {
          if (abortThrows) throw Object.assign(new Error('already committing'), { name: 'InvalidStateError' });
          if (finished) return;
          finished = true;
          transaction.error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
          queueMicrotask(() => transaction.onabort && transaction.onabort());
        }
      };
      setTimeout(() => { if (!finished) { finished = true; transaction.oncomplete && transaction.oncomplete(); } }, commitDelay);
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
