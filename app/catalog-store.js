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
        var metaStore = metaTransaction.objectStore('meta');
        var records = await Promise.all([requestResult(metaStore.get('active')), requestResult(metaStore.get('group-visibility')), requestResult(metaStore.get('live-transport'))]);
        var meta = records[0]; var preferences = records[1]; var transport = records[2];
        if (!meta) return { state: 'empty' };
        if (!meta.revision || !meta.source || !Number.isSafeInteger(meta.count) || meta.count <= 0 || meta.chunkCount !== Math.ceil(meta.count / CHUNK_SIZE)) return { state: 'corrupt' };
        var transaction = database.transaction('chunks', 'readonly');
        var done = transactionDone(transaction);
        var store = transaction.objectStore('chunks');
        var requests = [];
        for (var index = 0; index < meta.chunkCount; index += 1) requests.push(requestResult(store.get(meta.revision + ':' + index)));
        var loaded = await Promise.all([Promise.all(requests), done]); var chunks = loaded[0];
        var entries = new Array(meta.count); var offset = 0;
        for (var chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          if (!chunks[chunkIndex] || chunks[chunkIndex].revision !== meta.revision) return { state: 'corrupt' };
          var ownEntries = chunks[chunkIndex].entries;
          if (!Array.isArray(ownEntries) || ownEntries.length !== Math.min(CHUNK_SIZE, meta.count - offset)) return { state: 'corrupt' };
          for (var entryIndex = 0; entryIndex < ownEntries.length; entryIndex += 1) entries[offset++] = ownEntries[entryIndex];
        }
        if (offset !== meta.count) return { state: 'corrupt' };
        return { state: 'complete', source: meta.source, entries: entries, revision: meta.revision, savedAt: meta.savedAt, hiddenGroups: preferences && preferences.source === meta.source ? copyHiddenGroups(preferences.hiddenGroups) : null, liveTransport: transport && transport.source === meta.source && transport.value === 'hls' ? 'hls' : 'original' };
      } catch (_) { return { state: 'error' }; }
    }
    async function cleanup(database, revision) {
      try {
        var transaction = database.transaction('chunks', 'readwrite');
        var store = transaction.objectStore('chunks');
        var request = store.openKeyCursor();
        request.onsuccess = function () { var cursor = request.result; if (!cursor) return; if (String(cursor.primaryKey).indexOf(revision + ':') !== 0) store.delete(cursor.primaryKey); cursor.continue(); };
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
        var savedAt = Date.now();
        var chunkCount = Math.ceil(entries.length / CHUNK_SIZE);
        var transaction = database.transaction(['meta', 'chunks'], 'readwrite');
        activeWrite = transaction;
        var chunks = transaction.objectStore('chunks');
        var metaStore = transaction.objectStore('meta');
        var preferencesRequest = requestResult(metaStore.get('group-visibility'));
        var transportRequest = requestResult(metaStore.get('live-transport'));
        for (var index = 0; index < chunkCount; index += 1) {
          chunks.put({ key: revision + ':' + index, revision: revision, index: index, entries: entries.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE) });
        }
        metaStore.put({ key: 'active', revision: revision, source: source, count: entries.length, chunkCount: chunkCount, savedAt: savedAt });
        var completed = await Promise.all([preferencesRequest, transportRequest, transactionDone(transaction)]); activeWrite = null;
        var preferences = completed[0]; var transport = completed[1];
        cleanup(database, revision);
        return { state: 'complete', revision: revision, count: entries.length, savedAt: savedAt, hiddenGroups: preferences && preferences.source === source ? copyHiddenGroups(preferences.hiddenGroups) : null, liveTransport: transport && transport.source === source && transport.value === 'hls' ? 'hls' : 'original' };
      } catch (error) { activeWrite = null; return { state: generation !== writeGeneration || error && error.name === 'AbortError' ? 'cancelled' : error && error.name === 'QuotaExceededError' ? 'quota' : 'error' }; }
    }
    function copyHiddenGroups(hiddenGroups) {
      if (!hiddenGroups || typeof hiddenGroups !== 'object') return null;
      var copy = {};
      var sections = ['tv', 'movies', 'series'];
      for (var index = 0; index < sections.length; index += 1) {
        var section = sections[index]; var groups = hiddenGroups[section];
        if (!Array.isArray(groups) || !groups.every(function (group) { return typeof group === 'string'; })) return null;
        copy[section] = groups.slice();
      }
      return copy;
    }
    async function saveHiddenGroups(source, hiddenGroups) {
      var copy = copyHiddenGroups(hiddenGroups);
      if (!source || !copy) return { state: 'error' };
      try {
        var database = await open(); var transaction = database.transaction('meta', 'readwrite');
        transaction.objectStore('meta').put({ key: 'group-visibility', source: source, hiddenGroups: copy });
        await transactionDone(transaction); return { state: 'complete' };
      } catch (_) { return { state: 'error' }; }
    }

    async function saveLiveTransport(source, value) {
      if (!source || (value !== 'original' && value !== 'hls')) return { state: 'error' };
      try {
        var database = await open();
        var transaction = database.transaction('meta', 'readwrite');
        var completed = transactionDone(transaction);
        completed.catch(function () {});
        var store = transaction.objectStore('meta');
        var active = await requestResult(store.get('active'));
        if (!active || active.source !== source) {
          await completed;
          return { state: 'stale' };
        }
        store.put({ key: 'live-transport', source: source, value: value });
        await completed;
        return { state: 'complete' };
      } catch (_) { return { state: 'error' }; }
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
    return { load: load, save: save, clear: clear, cancel: cancel, saveHiddenGroups: saveHiddenGroups, saveLiveTransport: saveLiveTransport };
  }
  return { createStore: createStore, CHUNK_SIZE: CHUNK_SIZE };
}));
