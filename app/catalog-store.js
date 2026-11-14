(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGCatalogStore = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var DB_NAME = 'lg-stream-catalog';
  var DB_VERSION = 1;
  var CHUNK_SIZE = 500;

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('storage request failed')); };
    });
  }
  function transactionDone(transaction) {
    return new Promise(function (resolve, reject) {
      var failure = null;
      transaction.oncomplete = resolve;
      transaction.onerror = function (event) { failure = event.target && event.target.error || transaction.error || failure; };
      transaction.onabort = function () { reject(failure || transaction.error || new Error('storage transaction failed')); };
    });
  }
  function createStore(options) {
    options = options || {};
    var indexed = options.indexedDB !== undefined ? options.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
    var databasePromise = null;
    var activeWrite = null;
    var writeGeneration = 0;
    function open() {
      if (!indexed) return Promise.reject(new Error('unsupported'));
      if (databasePromise) return databasePromise;
      databasePromise = new Promise(function (resolve, reject) {
        var request = indexed.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function () {
          var database = request.result;
          if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
          if (!database.objectStoreNames.contains('chunks')) database.createObjectStore('chunks', { keyPath: 'key' });
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { databasePromise = null; reject(request.error || new Error('storage open failed')); };
      });
      return databasePromise;
    }
    async function load() {
      try {
        var database = await open();
        var metaTransaction = database.transaction('meta', 'readonly');
        var meta = await requestResult(metaTransaction.objectStore('meta').get('active'));
        if (!meta || !meta.revision || !meta.source || !meta.chunkCount) return { state: 'empty' };
        var transaction = database.transaction('chunks', 'readonly');
        var done = transactionDone(transaction);
        var store = transaction.objectStore('chunks');
        var requests = [];
        for (var index = 0; index < meta.chunkCount; index += 1) requests.push(requestResult(store.get(meta.revision + ':' + index)));
        var chunks = await Promise.all(requests); await done;
        var entries = new Array(meta.count); var offset = 0;
        for (var chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          if (!chunks[chunkIndex] || chunks[chunkIndex].revision !== meta.revision) return { state: 'corrupt' };
          var ownEntries = chunks[chunkIndex].entries || [];
          for (var entryIndex = 0; entryIndex < ownEntries.length; entryIndex += 1) entries[offset++] = ownEntries[entryIndex];
        }
        if (offset !== meta.count) return { state: 'corrupt' };
        return { state: 'complete', source: meta.source, entries: entries, revision: meta.revision, savedAt: meta.savedAt };
      } catch (_) { return { state: 'error' }; }
    }
    async function cleanup(database, revision) {
      try {
        var transaction = database.transaction('chunks', 'readwrite');
        var store = transaction.objectStore('chunks');
        var request = store.openCursor();
        request.onsuccess = function () { var cursor = request.result; if (!cursor) return; if (cursor.value.revision !== revision) cursor.delete(); cursor.continue(); };
        await transactionDone(transaction);
      } catch (_) {}
    }
    async function save(source, entries) {
      if (!source || !entries || !entries.length) return { state: 'invalid' };
      var generation = ++writeGeneration;
      try {
        var database = await open();
        if (generation !== writeGeneration) return { state: 'cancelled' };
        var revision = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        var chunkCount = Math.ceil(entries.length / CHUNK_SIZE);
        var transaction = database.transaction(['meta', 'chunks'], 'readwrite');
        activeWrite = transaction;
        var chunks = transaction.objectStore('chunks');
        for (var index = 0; index < chunkCount; index += 1) {
          chunks.put({ key: revision + ':' + index, revision: revision, index: index, entries: entries.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE) });
        }
        transaction.objectStore('meta').put({ key: 'active', revision: revision, source: source, count: entries.length, chunkCount: chunkCount, savedAt: Date.now() });
        await transactionDone(transaction); activeWrite = null;
        cleanup(database, revision);
        return { state: 'complete', revision: revision, count: entries.length };
      } catch (error) { activeWrite = null; return { state: generation !== writeGeneration || error && error.name === 'AbortError' ? 'cancelled' : error && error.name === 'QuotaExceededError' ? 'quota' : 'error' }; }
    }
    async function clear() {
      try {
        var database = await open(); var transaction = database.transaction(['meta', 'chunks'], 'readwrite');
        transaction.objectStore('meta').clear(); transaction.objectStore('chunks').clear(); await transactionDone(transaction); return { state: 'complete' };
      } catch (_) { return { state: 'error' }; }
    }
    function cancel() {
      if (!activeWrite) { writeGeneration += 1; return true; }
      try { activeWrite.abort(); writeGeneration += 1; activeWrite = null; return true; } catch (_) { return false; }
    }
    return { load: load, save: save, clear: clear, cancel: cancel };
  }
  return { createStore: createStore, CHUNK_SIZE: CHUNK_SIZE };
}));
