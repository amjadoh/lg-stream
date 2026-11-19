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
    var BATCH_CHUNKS = options.batchChunks || 4;
    var LOAD_BATCH_CHUNKS = options.loadBatchChunks || 8;
    var yieldTask = options.yieldTask || function () { return new Promise(function (resolve) { setTimeout(resolve, 0); }); };
    var databasePromise = null;
    var activeWrite = null;
    var writingRevision = null;
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
        request.onsuccess = function () {
          var database = request.result;
          // A connection closed by the platform (eviction, storage pressure)
          // or by a newer version must not be reused; the next call reopens.
          database.onclose = function () { if (databasePromise === ownPromise) databasePromise = null; };
          database.onversionchange = function () { database.close(); if (databasePromise === ownPromise) databasePromise = null; };
          resolve(database);
        };
        request.onerror = function () { if (databasePromise === ownPromise) databasePromise = null; reject(request.error || new Error('storage open failed')); };
      });
      var ownPromise = databasePromise;
      return databasePromise;
    }
    // Start a transaction, reopening once when the cached connection has closed.
    async function begin(storeNames, mode, database) {
      database = database || await open();
      try { return { database: database, transaction: database.transaction(storeNames, mode) }; } catch (error) {
        if (!error || error.name !== 'InvalidStateError') throw error;
        databasePromise = null; database = await open();
        return { database: database, transaction: database.transaction(storeNames, mode) };
      }
    }
    async function load() {
      try {
        var started = await begin('meta', 'readonly');
        var database = started.database; var metaTransaction = started.transaction;
        var metaStore = metaTransaction.objectStore('meta');
        var records = await Promise.all([requestResult(metaStore.get('active')), requestResult(metaStore.get('group-visibility')), requestResult(metaStore.get('live-transport'))]);
        var meta = records[0]; var preferences = records[1]; var transport = records[2];
        if (!meta) return { state: 'empty' };
        if (!meta.revision || !meta.source || !Number.isSafeInteger(meta.count) || meta.count <= 0 || meta.chunkCount !== Math.ceil(meta.count / CHUNK_SIZE)) return { state: 'corrupt' };
        // Read in small batches with a macrotask between them: reading every
        // chunk at once deserialised the whole catalogue in one long task.
        var chunks = [];
        for (var first = 0; first < meta.chunkCount; first += LOAD_BATCH_CHUNKS) {
          var transaction = (await begin('chunks', 'readonly', database)).transaction;
          var done = transactionDone(transaction);
          var store = transaction.objectStore('chunks');
          var requests = [];
          for (var index = first; index < Math.min(meta.chunkCount, first + LOAD_BATCH_CHUNKS); index += 1) requests.push(requestResult(store.get(meta.revision + ':' + index)));
          var loaded = await Promise.all([Promise.all(requests), done]);
          for (var item = 0; item < loaded[0].length; item += 1) chunks.push(loaded[0][item]);
          if (first + LOAD_BATCH_CHUNKS < meta.chunkCount) await yieldTask();
        }
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
        request.onsuccess = function () { var cursor = request.result; if (!cursor) return; var key = String(cursor.primaryKey); if (key.indexOf(revision + ':') !== 0 && !(writingRevision && key.indexOf(writingRevision + ':') === 0)) store.delete(cursor.primaryKey); cursor.continue(); };
        await transactionDone(transaction);
      } catch (_) {}
    }
    // Chunks of a new revision are written in several short transactions with
    // a macrotask between them, so remote keys stay responsive while a large
    // catalogue is stored. Nothing references the new revision until the final
    // transaction switches the 'active' record, so a cancel or failure keeps
    // the previous catalogue; orphan chunks are removed by the next cleanup.
    async function save(source, entries, saveOptions) {
      if (!source || !entries || !entries.length) return { state: 'invalid' };
      saveOptions = saveOptions || {};
      var generation = ++writeGeneration;
      try {
        var database = await open();
        if (generation !== writeGeneration) return { state: 'cancelled' };
        var revision = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        var savedAt = Date.now(); writingRevision = revision;
        var chunkCount = Math.ceil(entries.length / CHUNK_SIZE);
        var written = 0;
        while (written < chunkCount - BATCH_CHUNKS) {
          var batch = await begin('chunks', 'readwrite', database);
          if (generation !== writeGeneration) { try { batch.transaction.abort(); } catch (_) {} return { state: 'cancelled' }; }
          database = batch.database; activeWrite = batch.transaction;
          var batchStore = batch.transaction.objectStore('chunks'); var batchEnd = Math.min(chunkCount - 1, written + BATCH_CHUNKS);
          for (; written < batchEnd; written += 1) batchStore.put({ key: revision + ':' + written, revision: revision, index: written, entries: entries.slice(written * CHUNK_SIZE, (written + 1) * CHUNK_SIZE) });
          await transactionDone(batch.transaction); activeWrite = null;
          if (saveOptions.onProgress) saveOptions.onProgress(written, chunkCount);
          await yieldTask();
          if (generation !== writeGeneration) return { state: 'cancelled' };
        }
        var opened = await begin(['meta', 'chunks'], 'readwrite', database);
        if (generation !== writeGeneration) { try { opened.transaction.abort(); } catch (_) {} return { state: 'cancelled' }; }
        database = opened.database; var transaction = opened.transaction;
        activeWrite = transaction;
        var chunks = transaction.objectStore('chunks');
        var metaStore = transaction.objectStore('meta');
        var preferencesRequest = requestResult(metaStore.get('group-visibility'));
        var transportRequest = requestResult(metaStore.get('live-transport'));
        for (var index = written; index < chunkCount; index += 1) {
          chunks.put({ key: revision + ':' + index, revision: revision, index: index, entries: entries.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE) });
        }
        metaStore.put({ key: 'active', revision: revision, source: source, count: entries.length, chunkCount: chunkCount, savedAt: savedAt });
        (saveOptions.meta || []).forEach(function (record) { metaStore.put(record); });
        var completed = await Promise.all([preferencesRequest, transportRequest, transactionDone(transaction)]); activeWrite = null;
        if (saveOptions.onProgress) saveOptions.onProgress(chunkCount, chunkCount);
        writingRevision = null;
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
        var transaction = (await begin('meta', 'readwrite')).transaction;
        transaction.objectStore('meta').put({ key: 'group-visibility', source: source, hiddenGroups: copy });
        await transactionDone(transaction); return { state: 'complete' };
      } catch (_) { return { state: 'error' }; }
    }

    async function saveLiveTransport(source, value) {
      if (!source || (value !== 'original' && value !== 'hls')) return { state: 'error' };
      try {
        var transaction = (await begin('meta', 'readwrite')).transaction;
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
    // Small preference records (sources, customization, known/new keys).
    async function loadMeta(keys) {
      try {
        var transaction = (await begin('meta', 'readonly')).transaction; var store = transaction.objectStore('meta');
        var values = await Promise.all(keys.map(function (key) { return requestResult(store.get(key)); }));
        var result = {}; keys.forEach(function (key, index) { result[key] = values[index] || null; });
        return { state: 'complete', records: result };
      } catch (_) { return { state: 'error', records: {} }; }
    }
    async function saveMeta(records, removeKeys) {
      try {
        var transaction = (await begin('meta', 'readwrite')).transaction; var store = transaction.objectStore('meta');
        (records || []).forEach(function (record) { store.put(record); });
        (removeKeys || []).forEach(function (key) { store.delete(key); });
        await transactionDone(transaction); return { state: 'complete' };
      } catch (_) { return { state: 'error' }; }
    }
    // Remove the stored catalogue while keeping the sources list and the
    // owner's customization records.
    async function clearCatalog() {
      try {
        var transaction = (await begin(['meta', 'chunks'], 'readwrite')).transaction;
        transaction.objectStore('meta').delete('active'); transaction.objectStore('chunks').clear(); await transactionDone(transaction); return { state: 'complete' };
      } catch (_) { return { state: 'error' }; }
    }
    async function clear() {
      try {
        var transaction = (await begin(['meta', 'chunks'], 'readwrite')).transaction;
        transaction.objectStore('meta').clear(); transaction.objectStore('chunks').clear(); await transactionDone(transaction); return { state: 'complete' };
      } catch (_) { return { state: 'error' }; }
    }
    function cancel() {
      if (!activeWrite) { writeGeneration += 1; return true; }
      try { activeWrite.abort(); writeGeneration += 1; activeWrite = null; return true; } catch (_) { return false; }
    }
    return { load: load, save: save, clear: clear, clearCatalog: clearCatalog, cancel: cancel, saveHiddenGroups: saveHiddenGroups, saveLiveTransport: saveLiveTransport, loadMeta: loadMeta, saveMeta: saveMeta };
  }
  return { createStore: createStore, CHUNK_SIZE: CHUNK_SIZE };
}));
