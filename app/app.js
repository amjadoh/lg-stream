(function () {
  'use strict';
  var api = window.LGStream;
  var playlistApi = window.LGPlaylist;
  var catalogStore = window.LGCatalogStore.createStore();
  var $ = function (id) { return document.getElementById(id); };
  var sources = [];
  var activePlaylistUrl = null;
  var activeCatalogRevision = null;
  var activeCatalogSavedAt = 0;
  var favorites = {};
  var hiddenGroups = { tv: new Set(), movies: new Set(), series: new Set() };
  var groupSettingsSaving = false;
  var managedSection = 'tv';
  var managedGroups = [];
  var managedWindowStart = 0;
  var activeCategory = 'all';
  var categoryPositions = {};
  var categories = [['all', 'الكل'], ['sports', 'رياضة'], ['movies', 'قنوات أفلام'], ['news', 'أخبار'], ['kids', 'أطفال'], ['documentary', 'وثائقي'], ['other', 'غير مصنّف']];
  var appearance = { theme: 'editorial', layout: 'compact', controls: 'compact' };
  var settingsReturn = null;
  var categoryReturn = 'header';
  var activeGroup = '';
  var activeSection = 'tv';
  var sourceMode = 'manual';
  var liveTransport = 'original';
  var transportSaving = false;
  var selected = 0;
  var contentSort = 'provider'; var sortRevision = 0;
  var contentWindowStart = 0;
  var contentWindowSize = 24;
  var channelWindowStart = 0;
  var channelWindowSize = 40;
  var groupWindowStart = 0;
  var groupWindowSize = 40;
  var playingIndex = null;
  var lastState = 'idle';
  var keyboardVisible = false;
  var watchMode = false;
  var watchChannels = null;
  var watchChannelsWindow = 0;
  var hintTimer = null;
  var announcementIndex = null;
  var announcementQualityReady = false;
  var fitIndex = 0;
  var fitModes = [{ value: 'contain', label: 'ملائم' }, { value: 'cover', label: 'ملء' }, { value: 'zoom125', label: 'تكبير 125%' }, { value: 'zoom135', label: 'تكبير 135%' }];
  var setup = $('setup-panel');
  var searchPanel = $('search-panel');
  var diagnostics = $('diagnostics-panel');
  var speedPanel = $('speed-panel');
  var detailsPanel = $('details-panel');
  var detailsIndex = null;
  var speedTest = window.LGSpeedTest.createTest();
  var speedConnection = null;
  var speedRunning = false;
  var speedRevision = 0;
  var speedResults = [];
  var playlistLoader = playlistApi.createLoader();
  var playlistRevision = 0;
  var playlistRunning = false;
  var playlistSaving = false;
  var playlistAutomatic = false;
  var automaticReleasedView = null;
  // After a failed local restore, wait before reading the whole saved
  // catalogue again (each attempt loads every chunk); returning to the app
  // retries immediately.
  var RESTORE_RETRY_MS = 60000;
  var restoreRetryAt = 0;
  var automaticRestoreMessage = '';
  var automaticRestorePromise = null;
  var pendingViewState = null;
  var VIEW_KEY = 'lg-stream-view-v1';
  var sourceGeneration = 0;
  var posterFrame = null;
  var viewTimer = null;
  var unloading = false;
  var catalogViewRevision = 0;
  var favoritesRevision = 0;
  var visibleCacheKey = '';
  var visibleCache = [];
  var sectionCacheKey = '';
  var sectionCache = null;
  var groupLabelCacheKey = '';
  var groupLabelCache = new Map();
  var searchTimer = null;
  var searchLiveRevision = -1;
  var searchLiveIndexes = [];
  var lastSearch = null;
  // Sources and the owner's customization, kept in IndexedDB meta records.
  // Items are identified by api.entryKey (stream id), never by URL or list
  // position. Everything below is applied once per catalogue or edit and is
  // never touched on the playback path.
  var sourceList = []; var activeSourceId = null; var sourcesLoaded = false;
  var catalogMeta = { customization: null, knownKeys: null, newKeys: null };
  var custom = emptyCustomization();
  var entryKeys = null; var newFlags = null; var hiddenFlags = null; var displayOrder = null; var catalogTotals = { tv: 0, movies: 0, series: 0 };
  var NEW_GROUP = '\u0002new';
  var DEFAULT_SOURCE_NAME = 'المصدر الرئيسي';
  var addMode = 'link'; var sourceConfirmAction = null;
  function emptyCustomization() { return { groupOrder: { tv: [], movies: [], series: [] }, channelOrder: {}, hidden: [], names: {} }; }
  var nameCollator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('ar') : null;
  var AUTO_UPDATE_MS = 24 * 60 * 60 * 1000;
  var AUTO_UPDATE_IDLE_MS = 60000;
  var lastUserActivityAt = Date.now();
  var autoUpdateTimer = null;
  var autoNextAttemptAt = 0;
  var switchPending = false;
  var youtubeBridge = null;
  var inputs = [$('source-1'), $('source-2'), $('source-3')];
  var labels = {
    idle: 'جاهز', loading: 'جارٍ فتح البث…', playing: 'يعمل', waiting: 'بانتظار البث…',
    paused: 'متوقف مؤقتًا', ended: 'انتهى البث', error: 'تعذر تشغيل المصدر — جرّب إعادة المحاولة',
    'play-rejected': 'لم يبدأ التشغيل — اضغط إعادة المحاولة',
    'startup-timeout': 'انتهت مهلة بدء البث — اضغط إعادة المحاولة',
    'stall-timeout': 'توقف البث — اضغط إعادة المحاولة'
  };
  // Bounded automatic reconnect for live channels: at most three consecutive
  // attempts and six per channel selection. On the owner's TV the provider
  // rejected (code 4) or delayed a new connection for 12-20s after another
  // one, so the waits grow (5s, 12s, 25s). Any user channel request or stop
  // cancels it; on-demand items are never restarted automatically.
  var RECONNECT_DELAYS = [5000, 12000, 25000];
  var RECONNECT_SESSION_LIMIT = 6;
  var RECONNECT_STABLE_MS = 60000;
  var reconnect = { index: null, consecutive: 0, total: 0, timer: null, lastAttemptAt: 0 };
  // In-memory interruption log for diagnostics: clock time, list position,
  // event kind, duration and numeric error code only. Never URLs or names;
  // never persisted; capped at the last 20 events.
  var interruptions = []; var interruptionTrack = { channel: null, stalls: 0, stallMs: 0, failedAt: 0 };
  var interruptionLabels = { stall: 'انتظار مكتمل', error: 'خطأ المشغّل', 'startup-timeout': 'انتهت مهلة البدء', 'stall-timeout': 'توقف بلا تقدم', reconnect: 'إعادة اتصال تلقائية', recovered: 'عاد البث' };
  function logInterruption(kind, ms, code, attempt) {
    var clock = new Date(); var pad = function (value) { return (value < 10 ? '0' : '') + value; };
    interruptions.push({ at: pad(clock.getHours()) + ':' + pad(clock.getMinutes()) + ':' + pad(clock.getSeconds()), channel: playingIndex === null ? 0 : playingIndex + 1, kind: kind, ms: ms || 0, code: code || 0, attempt: attempt || 0 });
    if (interruptions.length > 20) interruptions.shift();
    if (!diagnostics.hidden) renderInterruptions();
  }
  function trackInterruptions(state) {
    if (state.channel !== interruptionTrack.channel || state.state === 'loading' && !state.playingMs) {
      if (state.channel !== interruptionTrack.channel) interruptionTrack.failedAt = 0;
      interruptionTrack.channel = state.channel; interruptionTrack.stalls = state.stalls || 0; interruptionTrack.stallMs = state.stallMs || 0;
    }
    if ((state.stallMs || 0) > interruptionTrack.stallMs) logInterruption('stall', state.stallMs - interruptionTrack.stallMs);
    interruptionTrack.stalls = state.stalls || 0; interruptionTrack.stallMs = state.stallMs || 0;
    if (['error', 'startup-timeout', 'stall-timeout'].indexOf(state.state) >= 0) { logInterruption(state.state, 0, state.errorCode); interruptionTrack.failedAt = Date.now(); }
    else if (state.state === 'playing' && interruptionTrack.failedAt) { logInterruption('recovered', Date.now() - interruptionTrack.failedAt); interruptionTrack.failedAt = 0; }
  }
  function renderInterruptions() {
    var list = $('interruption-log'); list.replaceChildren();
    $('interruption-empty').hidden = interruptions.length > 0;
    interruptions.slice().reverse().forEach(function (item) {
      var row = document.createElement('li');
      var label = document.createElement('span'); LGI18n.text(label, interruptionLabels[item.kind] + (item.attempt ? ' ' + item.attempt + '/' + RECONNECT_DELAYS.length : ''));
      var detail = document.createElement('bdi');
      detail.textContent = item.at + ' · #' + item.channel + (item.ms ? ' · ' + item.ms + ' ms' : '') + (item.code ? ' · (' + item.code + ')' : '');
      row.append(label, detail); list.appendChild(row);
    });
  }
  function cancelReconnect(reset) {
    clearTimeout(reconnect.timer); reconnect.timer = null;
    if (reset) { reconnect.index = null; reconnect.consecutive = 0; reconnect.total = 0; reconnect.lastAttemptAt = 0; }
  }
  function scheduleReconnect(state) {
    if (reconnect.timer !== null || playingIndex === null || document.hidden || unloading || entrySection(playingIndex) !== 'tv') return false;
    if (['error', 'startup-timeout', 'stall-timeout'].indexOf(state.state) < 0) return false;
    var index = playingIndex;
    if (reconnect.index !== index) { cancelReconnect(true); reconnect.index = index; }
    if (state.progressMs != null && Date.now() - reconnect.lastAttemptAt >= RECONNECT_STABLE_MS) reconnect.consecutive = 0;
    if (reconnect.consecutive >= RECONNECT_DELAYS.length || reconnect.total >= RECONNECT_SESSION_LIMIT) return false;
    var delay = RECONNECT_DELAYS[reconnect.consecutive];
    reconnect.consecutive += 1; reconnect.total += 1;
    logInterruption('reconnect', delay, 0, reconnect.consecutive);
    LGI18n.text($('status'), 'جارٍ إعادة الاتصال… (' + reconnect.consecutive + '/' + RECONNECT_DELAYS.length + ')');
    reconnect.timer = setTimeout(function () {
      reconnect.timer = null;
      if (playingIndex !== index || !retryablePlayback() || document.hidden || unloading) return;
      reconnect.lastAttemptAt = Date.now();
      scheduler.immediate({ index: index, requestedAt: performance.now(), retry: true, auto: true });
    }, delay);
    return true;
  }
  function finishLaunch() { var splash = $('launch-splash'); if (splash) splash.remove(); }
  $('launch-splash').addEventListener('animationend', function (event) { if (event.animationName === 'launchExit') finishLaunch(); });
  setTimeout(finishLaunch, 1900);
  // Per-catalogue memo: section and name category are pure functions of each
  // entry, so compute them once per loaded catalogue instead of re-running
  // regexes over every entry on each filter or visibility change.
  var entryMetaSources = null; var entrySectionCodes = null; var entryCategoryCodes = null;
  var sectionCodeNames = ['', 'tv', 'movies', 'series'];
  var categoryCodeNames = ['', null, 'sports', 'movies', 'news', 'kids', 'documentary'];
  function ensureEntryMeta() {
    if (entryMetaSources === sources) return;
    entryMetaSources = sources; entrySectionCodes = new Uint8Array(sources.length); entryCategoryCodes = new Uint8Array(sources.length);
  }
  function entrySection(index) {
    ensureEntryMeta();
    var code = entrySectionCodes[index];
    if (code) return sectionCodeNames[code];
    if (entryKeys && entryKeys.length === sources.length && index >= 0 && index < entryKeys.length) {
      // The stable key already encodes the section (see api.entryKey).
      code = Math.floor(entryKeys[index] / 4294967296); if (code > 3) code -= 3;
    } else {
      var url = sources[index] && sources[index].url || '';
      code = /\/series\//i.test(url) ? 3 : /\/movie\//i.test(url) ? 2 : 1;
    }
    if (index >= 0 && index < entrySectionCodes.length) entrySectionCodes[index] = code;
    return sectionCodeNames[code];
  }
  function entryChannelCategory(index) {
    ensureEntryMeta();
    var code = entryCategoryCodes[index];
    if (code) return categoryCodeNames[code];
    var category = api.channelCategory(sources[index] && sources[index].name);
    code = category === null ? 1 : categoryCodeNames.indexOf(category);
    if (code < 1) return category;
    if (index >= 0 && index < entryCategoryCodes.length) entryCategoryCodes[index] = code;
    return category;
  }
  function sectionIndex() {
    var cacheKey = [catalogViewRevision, activeSection === 'favorites' ? favoritesRevision : 0, activeSection, activeCategory].join('\u0001');
    if (cacheKey === sectionCacheKey) return sectionCache;
    var groupCategories = new Map();
    var allGroups = new Set();
    function matchesCategory(entry, index) {
      var category = entryChannelCategory(index);
      if (category) return category === activeCategory;
      var group = entry.group;
      if (!groupCategories.has(group)) groupCategories.set(group, api.groupCategory(group));
      return groupCategories.get(group) === activeCategory;
    }
    sectionCache = api.buildSectionIndex(sources, function (entry, index) {
      var ownSection = activeSection === 'favorites' ? favorites[index] : entrySection(index) === activeSection;
      if (ownSection) allGroups.add(entry.group || '');
      return ownSection && entryVisible(index) && (activeSection !== 'tv' || activeCategory === 'all' || matchesCategory(entry, index));
    }, masterOrder(activeSection));
    sectionCache.orderedGroups = masterOrder(activeSection) ? sectionCache.groups : api.orderedCatalogGroups(sectionCache.groups);
    sectionCache.fresh = newFlags ? sectionCache.all.filter(function (index) { return newFlags[index]; }) : [];
    sectionCache.groupLabels = groupLabels(activeSection, Array.from(allGroups));
    sectionCacheKey = cacheKey; return sectionCache;
  }
  function groupLabels(section, groups) {
    var key = [catalogViewRevision, section, section === 'favorites' ? favoritesRevision : 0].join('\u0001');
    if (key !== groupLabelCacheKey) { groupLabelCache = api.groupDisplayNames(groups); groupLabelCacheKey = key; }
    return groupLabelCache;
  }
  function visibleIndexes() {
    if (watchChannels !== null) return watchChannels;
    var cacheKey = [catalogViewRevision, activeSection === 'favorites' ? favoritesRevision : 0, activeSection, activeGroup, activeCategory, contentSort, contentSort === 'rating' ? sortRevision : 0].join('\u0001');
    if (cacheKey === visibleCacheKey) return visibleCache;
    var ownSection = sectionIndex();
    var indexes = activeGroup === NEW_GROUP ? ownSection.fresh : activeGroup ? (ownSection.byGroup[activeGroup] || []) : ownSection.all;
    if ((activeSection === 'movies' || activeSection === 'series') && contentSort !== 'provider') {
      if (contentSort === 'alpha') {
        indexes = indexes.slice();
        indexes.sort(function (left, right) {
          var a = sources[left] || {}; var b = sources[right] || {};
          return (nameCollator ? nameCollator.compare(a.name || '', b.name || '') : (a.name || '').localeCompare(b.name || '')) || left - right;
        });
      } else {
        // Each sort value is computed once per item, not once per comparison.
        var keyed = indexes.map(function (index) { return { index: index, value: sortValue(index, contentSort) }; });
        keyed.sort(function (a, b) {
          if (a.value === null && b.value === null) return a.index - b.index;
          if (a.value === null) return 1; if (b.value === null) return -1;
          return b.value - a.value || a.index - b.index;
        });
        indexes = keyed.map(function (item) { return item.index; });
      }
    }
    visibleCacheKey = cacheKey; visibleCache = indexes; return indexes;
  }
  function itemYear(index) {
    var entry = sources[index]; if (!entry) return 0;
    return Number(entry.year) || api.titleYear(entry.originalName !== undefined ? entry.originalName : entry.name);
  }
  function sortValue(index, sort) {
    var entry = sources[index] || {};
    if (sort === 'year') return itemYear(index) || null;
    if (sort === 'rating') { var rating = bestRating(index); return rating ? Number(rating.value) || null : null; }
    if (sort === 'added') return Number(entry.added) || Date.parse(entry.added) || null;
    if (sort === 'newest') return entryKeys && entryKeys.length === sources.length ? api.providerSerial(entryKeys[index]) : null;
    return null;
  }
  // Which optional sorts have data in this list; computed once per list, not per key press.
  var sortAvailability = { key: null, fields: null };
  function availableSorts(indexes) {
    var key = [catalogViewRevision, activeSection, activeGroup, activeCategory, indexes.length, ratingSource].join('\u0001');
    if (sortAvailability.key === key) return sortAvailability.fields;
    var fields = { year: false, rating: false, added: false, newest: false }; var missing = 4;
    for (var position = 0; position < indexes.length && missing; position += 1) {
      var index = indexes[position];
      for (var field in fields) if (!fields[field] && sortValue(index, field) !== null) { fields[field] = true; missing -= 1; }
    }
    if (!fields.rating && activeSection === 'movies' && ((omdbKey && showsImdb()) || (tmdbKey && showsTmdb()) || (providerRatingsWanted() && api.nativeHlsPlaylist(activePlaylistUrl)))) fields.rating = true;
    if (ratingSource === 'off') fields.rating = false;
    sortAvailability = { key: key, fields: fields }; return fields;
  }
  function contentMaxStart(length) { return Math.max(0, Math.ceil(Math.max(0, length - contentWindowSize) / 4) * 4); }
  function setPrimary(open) {
    document.querySelector('.library-panel').classList.toggle('primary-open', open); applyPictureFit();
  }
  function closeSearch() { lastSearch = null;
    clearTimeout(searchTimer); searchTimer = null;
    searchPanel.hidden = true; $('channel-search').value = ''; $('search-results').replaceChildren(); LGI18n.text($('search-status'), 'اكتب حرفين على الأقل.');
    setPrimary(false); var group = $('groups').querySelector('.group-button.active') || $('groups').querySelector('button'); if (group) group.focus();
  }
  function renderSearch() {
    var query = $('channel-search').value.trim().toLocaleLowerCase(); $('search-results').replaceChildren();
    if (query.length < 2) { LGI18n.text($('search-status'), 'اكتب حرفين على الأقل.'); return; }
    var sections = [['tv', 'البث المباشر'], ['movies', 'الأفلام'], ['series', 'المسلسلات']]; var total = 0;
    if (searchLiveRevision !== catalogViewRevision) {
      searchLiveIndexes = [];
      sources.forEach(function (_, index) { if (entrySection(index) === 'tv') searchLiveIndexes.push(index); });
      searchLiveRevision = catalogViewRevision;
    }
    var narrowing = lastSearch && lastSearch.revision === catalogViewRevision && lastSearch.sources === sources && query.indexOf(lastSearch.query) === 0;
    var results = api.searchCatalog(sources, query, function (index) { return entryVisible(index) ? entrySection(index) : null; }, 12, searchLiveIndexes, narrowing ? lastSearch.matched : null);
    lastSearch = { query: query, revision: catalogViewRevision, sources: sources, matched: results.matched };
    sections.forEach(function (section) {
      var matches = results.matches[section[0]]; var count = results.counts[section[0]];
      total += count;
      var box = document.createElement('section'); box.className = 'search-section';
      var title = document.createElement('h3'); LGI18n.text(title, section[1] + ' (' + count + ')'); box.appendChild(title);
      matches.forEach(function (index) {
        var button = document.createElement('button'); button.type = 'button'; LGI18n.provider(button, sources[index].name, 'عنصر', arabicChannelName(index, ''));
        button.addEventListener('click', function () { closeSearch(); if (section[0] !== 'tv') stop(); activeCategory = 'all'; activeSection = section[0]; activeGroup = sources[index].group || ''; renderPrimary(); renderGroups(); renderChannels(); if (section[0] === 'tv') activateChannel(index); else openDetails(index); });
        box.appendChild(button);
      });
      $('search-results').appendChild(box);
    });
    LGI18n.text($('search-status'), total ? 'وُجد ' + total + ' نتيجة. تظهر أول 12 نتيجة في كل قسم.' : 'لا توجد نتائج.');
  }
  function openSearch() { lastSearch = null; cancelSwitch(); setPrimary(false); searchPanel.hidden = false; renderSearch(); $('channel-search').focus(); }
  function renderPrimary() {
    document.querySelector('.library-panel').classList.toggle('content-mode', activeSection === 'movies' || activeSection === 'series'); applyPictureFit();
    Array.prototype.forEach.call(document.querySelectorAll('.primary-button'), function (button) {
      button.classList.toggle('active', button.dataset.section === activeSection);
    });
  }
  function saveViewState(detailsOpen) {
    if (!activeCatalogRevision || !sources.length) return;
    try {
      // Persist the provider-order index so existing saved views survive display reordering.
      localStorage.setItem(VIEW_KEY, JSON.stringify({ revision: activeCatalogRevision, section: activeSection, category: activeCategory, filterVersion: 3, groupIndex: sectionIndex().groups.indexOf(activeGroup), sort: contentSort, selected: selected, favorites: Object.keys(favorites).map(Number), channelWindowStart: watchChannels === null ? channelWindowStart : watchChannelsWindow, contentWindowStart: contentWindowStart, groupScrollTop: $('groups').scrollTop, channelScrollTop: $('channels').scrollTop, contentScrollTop: $('movie-browser').scrollTop, detailsOpen: !!detailsOpen }));
    } catch (_) {}
  }
  function scheduleViewSave() { if (unloading) return; clearTimeout(viewTimer); viewTimer = setTimeout(function () { saveViewState(detailsIndex !== null); }, 120); }
  function readViewState(revision) {
    try {
      var state = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      return state && state.revision === revision ? state : null;
    } catch (_) { return null; }
  }
  function normalizeCustomization(record) {
    var value = emptyCustomization(); if (!record) return value;
    ['tv', 'movies', 'series'].forEach(function (section) { if (record.groupOrder && Array.isArray(record.groupOrder[section])) value.groupOrder[section] = record.groupOrder[section].filter(function (name) { return typeof name === 'string'; }); });
    if (record.channelOrder && typeof record.channelOrder === 'object') Object.keys(record.channelOrder).forEach(function (key) { if (Array.isArray(record.channelOrder[key])) value.channelOrder[key] = record.channelOrder[key].filter(function (item) { return typeof item === 'number'; }); });
    if (Array.isArray(record.hidden)) value.hidden = record.hidden.filter(function (item) { return typeof item === 'number'; });
    if (record.names && typeof record.names === 'object') Object.keys(record.names).forEach(function (key) { if (typeof record.names[key] === 'string' && record.names[key].trim()) value.names[key] = record.names[key].slice(0, 80); });
    return value;
  }
  function customizationFor(source) { return catalogMeta.customization && catalogMeta.customization.source === source ? catalogMeta.customization : null; }
  // Once per catalogue: stable keys, new-item flags from the last refresh,
  // hidden channels, renamed channels and the master display order.
  function prepareCatalog(source, keys) {
    var count = sources.length;
    if (!keys || keys.length !== count) {
      // Saved entries carry their key (k) from the refresh that stored them.
      keys = new Float64Array(count);
      for (var index = 0; index < count; index += 1) { var stored = sources[index].k; keys[index] = typeof stored === 'number' ? stored : api.entryKey(sources[index].url); }
    }
    entryKeys = keys;
    custom = normalizeCustomization(customizationFor(source));
    var fresh = catalogMeta.newKeys && catalogMeta.newKeys.source === source ? catalogMeta.newKeys.keys : null;
    newFlags = null;
    if (fresh && fresh.length) {
      var flags = new Uint8Array(count); var marked = 0;
      for (var at = 0; at < count; at += 1) if (api.hasSortedKey(fresh, keys[at])) { flags[at] = 1; marked += 1; }
      if (marked) newFlags = flags;
    }
    applyItemCustomization();
    rebuildOrder();
  }
  function applyItemCustomization() {
    hiddenFlags = null;
    var hidden = new Set(custom.hidden); var names = new Map();
    Object.keys(custom.names).forEach(function (key) { names.set(Number(key), custom.names[key]); });
    if (hidden.size) hiddenFlags = new Uint8Array(sources.length);
    for (var index = 0; index < sources.length; index += 1) {
      var entry = sources[index];
      if (hidden.size && hidden.has(entryKeys[index])) hiddenFlags[index] = 1;
      if (entry.originalName !== undefined && !names.has(entryKeys[index])) { entry.name = entry.originalName; delete entry.originalName; }
      if (names.size && names.has(entryKeys[index])) { if (entry.originalName === undefined) entry.originalName = entry.name; entry.name = names.get(entryKeys[index]); }
    }
  }
  function rebuildOrder() {
    displayOrder = api.buildDisplayOrder(sources, entrySection, { keys: entryKeys, newFlags: newFlags, custom: custom, orderGroups: api.orderedCatalogGroups });
    catalogTotals = { tv: displayOrder.tv.order.length, movies: displayOrder.movies.order.length, series: displayOrder.series.order.length };
    visibleCacheKey = ''; sectionCacheKey = ''; groupLabelCacheKey = '';
  }
  function clearCatalogMeta() { entryKeys = null; newFlags = null; hiddenFlags = null; displayOrder = null; custom = emptyCustomization(); }
  function applyCatalog(entries, source, revision, savedAt, restored, visibility, transport, keys) {
    setHiddenGroups(visibility);
    liveTransport = transport === 'hls' ? 'hls' : 'original';
    sources = entries; prepareCatalog(source, keys);
    catalogViewRevision += 1; favoritesRevision += 1; activePlaylistUrl = source; activeCatalogRevision = revision; activeCatalogSavedAt = savedAt || Date.now(); sourceMode = 'playlist'; favorites = {}; playingIndex = null;
    var state = readViewState(revision);
    activeSection = state && ['tv', 'movies', 'series', 'favorites'].indexOf(state.section) >= 0 ? state.section : 'tv';
    if (state && Array.isArray(state.favorites)) state.favorites.forEach(function (index) { if (sources[index]) favorites[index] = true; });
    activeCategory = state && categories.some(function (item) { return item[0] === state.category; }) ? state.category : 'all';
    categoryPositions = {};
    var groups = sectionIndex().groups;
    activeGroup = state && (activeSection !== 'tv' || activeCategory === 'all' || state.filterVersion === 3) && state.groupIndex >= 0 && groups[state.groupIndex] ? groups[state.groupIndex] : '';
    contentSort = state && ['provider', 'newest', 'year', 'rating', 'added', 'alpha'].indexOf(state.sort) >= 0 ? state.sort : 'provider';
    selected = state ? Number(state.selected) || 0 : 0; channelWindowStart = state ? Number(state.channelWindowStart) || 0 : 0; contentWindowStart = state ? Number(state.contentWindowStart) || 0 : 0;
    pendingViewState = state; renderPrimary(); renderGroups(); renderChannels();
    if (state) requestAnimationFrame(function () { $('groups').scrollTop = Number(state.groupScrollTop) || 0; $('channels').scrollTop = Number(state.channelScrollTop) || 0; $('movie-browser').scrollTop = Number(state.contentScrollTop) || 0; });
    renderSourceCard();
    $('manage-groups-button').disabled = playlistRunning || groupSettingsSaving;
    if (restored) LGI18n.text($('status'), 'استُعيدت القائمة المحفوظة — اختر ما تريد تشغيله');
  }
  function captureRuntimeView() {
    return { section: activeSection, category: activeCategory, group: activeGroup, sort: contentSort, selectedUrl: sources[selected] && sources[selected].url, favoriteUrls: Object.keys(favorites).map(function (index) { return sources[index] && sources[index].url; }).filter(Boolean), contentWindowStart: contentWindowStart, channelWindowStart: channelWindowStart, detailsOpen: detailsIndex !== null };
  }
  function releaseCatalogForAutomaticUpdate(view) {
    automaticReleasedView = view;
    catalogViewRevision += 1; favoritesRevision += 1; sources = []; clearCatalogMeta(); favorites = {}; activeGroup = ''; activeSection = 'tv'; selected = 0; contentWindowStart = 0; channelWindowStart = 0;
    visibleCacheKey = ''; visibleCache = []; sectionCacheKey = ''; sectionCache = null;
    renderPrimary(); renderGroups(); renderChannels();
  }
  function restoreReleasedCatalog(message, shouldFocus) {
    if (message) automaticRestoreMessage = message;
    if (automaticRestorePromise) return automaticRestorePromise;
    if (!automaticReleasedView) {
      if (automaticRestoreMessage) LGI18n.text($('status'), automaticRestoreMessage);
      automaticRestoreMessage = '';
      return Promise.resolve(true);
    }
    if (document.hidden || unloading) return Promise.resolve(false);
    var view = automaticReleasedView; var generation = sourceGeneration;
    automaticRestorePromise = catalogStore.load().then(function (saved) {
      if (generation !== sourceGeneration) return false;
      if (document.hidden || unloading) return false;
      if (saved.state !== 'complete') {
        restoreRetryAt = Date.now() + RESTORE_RETRY_MS;
        LGI18n.text($('status'), 'تعذر استعادة القائمة الآن — ستُعاد المحاولة عند الرجوع للتطبيق.');
        return false;
      }
      restoreRetryAt = 0;
      applyCatalog(saved.entries, saved.source, saved.revision, saved.savedAt, true, saved.hiddenGroups, saved.liveTransport); restoreRuntimeView(view, shouldFocus);
      automaticReleasedView = null;
      if (automaticRestoreMessage) LGI18n.text($('status'), automaticRestoreMessage);
      automaticRestoreMessage = '';
      return true;
    });
    automaticRestorePromise = automaticRestorePromise.then(function (restored) {
      automaticRestorePromise = null;
      if (!restored && generation !== sourceGeneration && automaticReleasedView && !playlistRunning && !document.hidden && !unloading) return restoreReleasedCatalog('', shouldFocus);
      return restored;
    }, function (error) {
      automaticRestorePromise = null;
      throw error;
    });
    return automaticRestorePromise;
  }
  function restoreRuntimeView(state, shouldFocus) {
    if (!state) return;
    activeCategory = categories.some(function (item) { return item[0] === state.category; }) ? state.category : 'all';
    activeSection = state.section; contentSort = state.sort; favorites = {}; favoritesRevision += 1;
    var favoriteUrls = {}; state.favoriteUrls.forEach(function (url) { favoriteUrls[url] = true; });
    sources.forEach(function (entry, index) { if (favoriteUrls[entry.url]) favorites[index] = true; });
    activeGroup = state.group; selected = Math.max(0, sources.findIndex(function (entry) { return entry.url === state.selectedUrl; }));
    contentWindowStart = state.contentWindowStart; channelWindowStart = state.channelWindowStart; renderPrimary(); renderGroups(); renderChannels(); saveViewState(state.detailsOpen);
    if (shouldFocus === false || document.hidden || unloading || !setup.hidden || !searchPanel.hidden || !speedPanel.hidden || !diagnostics.hidden || !$('group-manager').hidden || extraDialog()) return;
    if (state.detailsOpen && sources[selected]) openDetails(selected); else focusSelected();
  }
  function sectionGroups() {
    return sectionIndex().orderedGroups;
  }
  function groupKeys() { return [''].concat(sectionIndex().fresh.length ? [NEW_GROUP] : [], sectionGroups()); }
  function arabicChannelName(index, group) { return entrySection(index) === 'tv' && sources[index].originalName === undefined ? api.compactChannelName(sources[index].name, group === undefined ? activeGroup : group) : ''; }
  function setHiddenGroups(value) {
    ['tv', 'movies', 'series'].forEach(function (section) {
      hiddenGroups[section] = new Set(value && Array.isArray(value[section]) ? value[section].filter(function (name) { return typeof name === 'string'; }) : []);
    });
  }
  function entryVisible(index) { return !(hiddenFlags && hiddenFlags[index]) && !hiddenGroups[entrySection(index)].has(sources[index].group || ''); }
  function masterOrder(section) { return section !== 'favorites' && displayOrder && displayOrder[section] ? displayOrder[section].order : null; }
  function collectManagedGroups() {
    if (managedSection === 'hidden') {
      // Hidden channels by stable key; rows can be shown again one by one.
      var wanted = new Map(); custom.hidden.forEach(function (key, position) { wanted.set(key, position); });
      var rows = [];
      if (entryKeys && wanted.size) for (var index = 0; index < entryKeys.length; index += 1) if (wanted.has(entryKeys[index])) rows.push({ name: entryKeys[index], index: index, label: null, count: '', order: wanted.get(entryKeys[index]) });
      rows.sort(function (left, right) { return left.order - right.order; });
      managedGroups = rows; managedWindowStart = 0; return;
    }
    var counts = new Map();
    sources.forEach(function (entry, index) {
      if (entrySection(index) !== managedSection) return;
      var name = entry.group || ''; counts.set(name, (counts.get(name) || 0) + 1);
    });
    var originalGroups = Array.from(counts.keys());
    var groups = api.orderedCatalogGroups(originalGroups);
    var names = groupLabels(managedSection, originalGroups);
    managedGroups = groups.map(function (name) { return { name: name, label: names.get(name), count: counts.get(name) }; });
    managedWindowStart = 0;
  }
  function renderManagedGroups() {
    var list = $('managed-groups'); list.replaceChildren();
    managedWindowStart = Math.max(0, Math.min(managedWindowStart, Math.max(0, managedGroups.length - 40)));
    managedGroups.slice(managedWindowStart, managedWindowStart + 40).forEach(function (item, offset) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'group-switch';
      button.dataset.position = managedWindowStart + offset; button.setAttribute('role', 'switch');
      var channelRow = managedSection === 'hidden';
      var enabled = channelRow ? !(hiddenFlags && hiddenFlags[item.index]) : !hiddenGroups[managedSection].has(item.name);
      button.setAttribute('aria-checked', String(enabled)); button.disabled = groupSettingsSaving;
      var label = document.createElement('span'); label.className = 'group-switch-name';
      if (channelRow) LGI18n.provider(label, sources[item.index].name, 'قناة'); else LGI18n.provider(label, item.name, 'بدون مجموعة', item.label);
      var count = document.createElement('span'); count.className = 'group-switch-count';
      if (channelRow) LGI18n.provider(count, sources[item.index].group, 'بدون مجموعة'); else LGI18n.text(count, item.count + ' عنصر');
      var state = document.createElement('span'); state.className = 'switch-state'; LGI18n.text(state, enabled ? 'ON · ظاهر' : 'OFF · مخفي');
      button.appendChild(label); button.appendChild(count); button.appendChild(state);
      button.addEventListener('focus', function () { button.scrollIntoView({ block: 'nearest' }); });
      button.addEventListener('click', function () { toggleManagedGroup(Number(button.dataset.position)); });
      list.appendChild(button);
    });
    if (managedSection === 'hidden') LGI18n.text($('managed-summary'), managedGroups.length ? managedGroups.length + ' قناة مخفية — اضغط موافق لإظهارها.' : 'لا توجد قنوات مخفية.');
    else LGI18n.text($('managed-summary'), managedGroups.length ? managedGroups.length + ' مجموعة — المخفي يبقى محفوظًا ويمكن إظهاره مجددًا.' : 'لا توجد مجموعات في هذا القسم.');
    ['organize-groups', 'organize-channels', 'reset-customization'].forEach(function (id) { $(id).disabled = groupSettingsSaving || !customizable(); });
    Array.prototype.forEach.call($('group-manager').querySelectorAll('[data-manage-section]'), function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.manageSection === managedSection)); button.disabled = groupSettingsSaving;
    });
  }
  function focusManagedGroup(position) {
    if (!managedGroups.length) return;
    position = Math.max(0, Math.min(managedGroups.length - 1, position));
    if (position < managedWindowStart || position >= managedWindowStart + 40) {
      managedWindowStart = Math.max(0, position - 20); renderManagedGroups();
    }
    var button = $('managed-groups').querySelector('[data-position="' + position + '"]'); if (button) button.focus();
  }
  function toggleManagedGroup(position) {
    if (groupSettingsSaving || !activePlaylistUrl || !managedGroups[position]) return;
    if (managedSection === 'hidden') {
      var row = managedGroups[position]; if (!hiddenFlags) hiddenFlags = new Uint8Array(sources.length);
      var showing = !!hiddenFlags[row.index];
      hiddenFlags[row.index] = showing ? 0 : 1;
      custom.hidden = showing ? custom.hidden.filter(function (key) { return key !== row.name; }) : custom.hidden.concat([row.name]);
      invalidateViews(); renderGroups(); renderChannels(); renderManagedGroups(); focusManagedGroup(position);
      saveCustomization(showing ? 'ظهرت القناة من جديد.' : 'أُخفيت القناة.');
      LGI18n.text($('manager-status'), showing ? 'ظهرت القناة من جديد.' : 'أُخفيت القناة.');
      return;
    }
    var item = managedGroups[position]; var next = {};
    ['tv', 'movies', 'series'].forEach(function (section) { next[section] = Array.from(hiddenGroups[section]); });
    var index = next[managedSection].indexOf(item.name);
    if (index < 0) next[managedSection].push(item.name); else next[managedSection].splice(index, 1);
    var source = activePlaylistUrl;
    groupSettingsSaving = true; LGI18n.text($('manager-status'), 'جارٍ الحفظ…'); renderManagedGroups();
    catalogStore.saveHiddenGroups(source, next).then(function (result) {
      groupSettingsSaving = false;
      if (unloading) return;
      if (result.state === 'complete' && source === activePlaylistUrl) {
        setHiddenGroups(next); catalogViewRevision += 1;
        if (playingIndex !== null && !entryVisible(playingIndex)) stop();
        renderGroups(); renderChannels(); saveViewState(false);
        LGI18n.text($('manager-status'), index < 0 ? 'أُخفيت المجموعة. عناصرها محفوظة ويمكن إظهارها مجددًا.' : 'ظهرت المجموعة من جديد.');
      } else LGI18n.text($('manager-status'), 'تعذر حفظ التغيير. بقيت المجموعة كما كانت.');
      renderManagedGroups(); if (!$('group-manager').hidden && !document.hidden) focusManagedGroup(position);
    });
  }
  function openGroupManager() {
    if (playlistRunning || !activePlaylistUrl || !sources.length) return;
    cancelSwitch(); managedSection = /^(tv|movies|series)$/.test(activeSection) ? activeSection : 'tv';
    collectManagedGroups(); renderManagedGroups(); $('manager-status').textContent = '';
    $('group-manager').hidden = false; showManagerView(false);
  }
  // The manager opens on option cards; «إخفاء وإظهار» shows the section lists.
  function showManagerView(visibility) {
    $('manager-home').hidden = visibility; $('manager-visibility').hidden = !visibility; $('reset-confirm').hidden = true;
    if (visibility) { collectManagedGroups(); renderManagedGroups(); $('group-manager').querySelector('[data-manage-section="' + managedSection + '"]').focus(); }
    else if ($('organize-channels').disabled) $('manage-visibility').focus(); else $('organize-channels').focus();
  }
  function closeGroupManager() {
    if (groupSettingsSaving) return;
    if (!$('reset-confirm').hidden) { $('reset-confirm').hidden = true; $('reset-customization').focus(); return; }
    if (!$('manager-visibility').hidden) { $('manager-status').textContent = ''; showManagerView(false); $('manage-visibility').focus(); return; }
    $('group-manager').hidden = true; managedGroups = []; $('managed-groups').replaceChildren(); if (!returnToSettings()) $('setup-button').focus();
  }
  function renderGroups() {
    renderCategories();
    var groups = sectionGroups();
    var sectionLabels = { tv: 'كل قنوات البث', movies: 'كل الأفلام', series: 'كل المسلسلات', favorites: 'كل المفضلة' };
    var fresh = sectionIndex().fresh;
    var items = [['', activeSection === 'tv' && activeCategory !== 'all' ? 'كل قنوات التصنيف' : sectionLabels[activeSection]]].concat(fresh.length ? [[NEW_GROUP, 'جديد']] : [], groups.map(function (group) { return [group, group]; }));
    if (!items.some(function (item) { return item[0] === activeGroup; })) activeGroup = '';
    var activePosition = Math.max(0, items.findIndex(function (item) { return item[0] === activeGroup; }));
    groupWindowStart = Math.max(0, Math.min(groupWindowStart, Math.max(0, items.length - groupWindowSize)));
    if (activePosition < groupWindowStart || activePosition >= groupWindowStart + groupWindowSize) {
      groupWindowStart = Math.max(0, Math.min(activePosition - 4, Math.max(0, items.length - groupWindowSize)));
    }
    $('groups').replaceChildren();
    items.slice(groupWindowStart, groupWindowStart + groupWindowSize).forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'group-button' + (item[0] === activeGroup ? ' active' : '');
      button.dataset.group = item[0];
      if (selectState && selectState.kind === 'group' && selectState.items.has(item[0])) markSelected(button, true);
      if (moveState && moveState.kind === 'group' && moveState.items.indexOf(item[0]) >= 0) button.classList.add('is-moving');
      if (item[0] === NEW_GROUP) { button.classList.add('new-group'); LGI18n.text(button, 'جديد (' + fresh.length + ')'); }
      else LGI18n.provider(button, item[0], item[1], sectionIndex().groupLabels.get(item[0]));
      button.addEventListener('focus', function (event) {
        event.currentTarget.scrollIntoView({ block: 'nearest' });
        if (activeGroup === event.currentTarget.dataset.group) return;
        activeGroup = event.currentTarget.dataset.group; contentWindowStart = 0; channelWindowStart = 0;
        Array.prototype.forEach.call($('groups').querySelectorAll('.group-button'), function (own) { own.classList.toggle('active', own === event.currentTarget); });
        renderChannels(); saveViewState(false);
      });
      button.addEventListener('click', function (event) {
        activeGroup = event.currentTarget.dataset.group; contentWindowStart = 0; channelWindowStart = 0; renderGroups(); renderChannels(); saveViewState(false);
        var first = (activeSection === 'movies' || activeSection === 'series') ? $('movie-grid').querySelector('.movie-card') : $('channels').querySelector('.channel-button');
        if (first) first.focus();
      });
      $('groups').appendChild(button);
    });
  }
  function updateVisiblePosters() {
    posterFrame = null; var browser = $('movie-browser'); if (browser.hidden) return;
    var bounds = browser.getBoundingClientRect();
    Array.prototype.forEach.call($('movie-grid').querySelectorAll('img[data-src]'), function (poster) {
      var card = poster.parentNode.getBoundingClientRect();
      if (card.bottom <= bounds.top || card.top >= bounds.bottom || card.right <= bounds.left || card.left >= bounds.right) return;
      poster.src = poster.dataset.src; poster.removeAttribute('data-src');
    });
  }
  function schedulePosterCheck() { if (!posterFrame) posterFrame = requestAnimationFrame(updateVisiblePosters); }
  function renderMovies(indexes) {
    var cards = activeSection === 'movies' || activeSection === 'series';
    $('movie-browser').hidden = !cards;
    $('empty-state').hidden = cards || playingIndex !== null;
    if (!cards) return;
    LGI18n.text($('movie-count'), indexes.length + (activeSection === 'movies' ? ' فيلم' : ' حلقة أو فيديو'));
    if (activeGroup === NEW_GROUP) LGI18n.text($('movie-title'), 'جديد'); else LGI18n.provider($('movie-title'), activeGroup, activeSection === 'movies' ? 'الأفلام' : 'المسلسلات', sectionIndex().groupLabels.get(activeGroup));
    $('movie-grid').replaceChildren();
    contentWindowStart = Math.max(0, Math.min(contentWindowStart, contentMaxStart(indexes.length)));
    indexes.slice(contentWindowStart, contentWindowStart + contentWindowSize).forEach(function (index) { $('movie-grid').appendChild(movieCard(index)); });
    movieGridKey = visibleCacheKey;
    renderSortMenu(indexes); schedulePosterCheck(); scheduleRatingFill();
  }
  // Scrolling the same list: keep the cards still in view and add only the new
  // row, instead of rebuilding all cards (and reloading their posters).
  var movieGridKey = null;
  function renderMovieWindow() {
    var indexes = visibleIndexes(); var grid = $('movie-grid');
    if (movieGridKey === null || movieGridKey !== visibleCacheKey || watchChannels !== null) { renderChannels(); return; }
    contentWindowStart = Math.max(0, Math.min(contentWindowStart, contentMaxStart(indexes.length)));
    var wanted = indexes.slice(contentWindowStart, contentWindowStart + contentWindowSize); var keep = {};
    wanted.forEach(function (index) { keep[index] = true; });
    Array.prototype.slice.call(grid.children).forEach(function (card) { if (!keep[card.dataset.index]) grid.removeChild(card); });
    var current = grid.firstElementChild;
    wanted.forEach(function (index) {
      if (current && current.dataset.index === String(index)) { current = current.nextElementSibling; return; }
      grid.insertBefore(movieCard(index), current);
    });
    schedulePosterCheck(); scheduleRatingFill();
  }
  function movieCard(index) {
      var card = document.createElement('button'); card.type = 'button'; card.className = 'movie-card'; card.dataset.index = index;
      var details = sources[index] || {};
      if (details.poster) { var poster = document.createElement('img'); poster.className = 'movie-poster'; poster.alt = ''; poster.dataset.src = details.poster; poster.addEventListener('error', function () { this.remove(); }); card.appendChild(poster); }
      var name = document.createElement('span'); LGI18n.provider(name, sources[index].name, activeSection === 'movies' ? 'فيلم' : 'مسلسل'); card.appendChild(name);
      card.addEventListener('focus', function (event) { selected = Number(event.currentTarget.dataset.index); saveViewState(false); event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      card.addEventListener('click', function () { openDetails(index); });
      if (activeSection === 'movies') applyCardRating(card, index);
      return card;
  }
  function renderSortMenu(indexes) {
    Array.prototype.forEach.call($('sort-menu').querySelectorAll('button'), function (button) {
      var sort = button.dataset.sort; var available = availableSorts(indexes);
      button.disabled = Object.prototype.hasOwnProperty.call(available, sort) && !available[sort];
      button.classList.toggle('active', sort === contentSort); button.setAttribute('aria-pressed', String(sort === contentSort));
    });
    LGI18n.text($('sort-button'), 'ترتيب: ' + ({ provider: 'المزوّد', newest: 'الأحدث', alpha: 'أبجدي', year: 'السنة', rating: 'التقييم', added: 'تاريخ الإضافة' }[contentSort] || 'المزوّد'));
  }
  // Movie details from the provider (get_vod_info) and, with the owner's OMDb
  // key, the IMDb rating. Fetched only when details open: at most one request
  // to each, no retry, cancelled on close or play, cached in memory.
  var OMDB_KEY_STORE = 'lg-stream-omdb-key-v1';
  var omdbKey = ''; try { omdbKey = localStorage.getItem(OMDB_KEY_STORE) || ''; } catch (_) {}
  if (!api.validOmdbKey(omdbKey)) omdbKey = '';
  var TMDB_KEY_STORE = 'lg-stream-tmdb-key-v1';
  var tmdbKey = ''; try { tmdbKey = localStorage.getItem(TMDB_KEY_STORE) || ''; } catch (_) {}
  if (!api.validTmdbKey(tmdbKey)) tmdbKey = '';
  var detailsRequest = null; var detailsCache = new Map();
  // Saved ratings per movie (IMDb, provider, TMDB), kept on this TV in IndexedDB
  // so each movie is looked up once. Value [imdb, provider, tmdb, tmdbId]:
  // null = not looked up yet, '' = none. The daily OMDb count lives in localStorage.
  var RATING_META = 'lg-stream-ratings-meta-v1'; var OMDB_DAILY = 900; var PREFETCH_DAILY = 800;
  var ratings = { day: '', omdb: 0 };
  try { var storedMeta = JSON.parse(localStorage.getItem(RATING_META) || 'null'); if (storedMeta) ratings = { day: String(storedMeta.day || ''), omdb: Number(storedMeta.omdb) || 0 }; } catch (_) {}
  var ratingItems = new Map(); var ratingsLoaded = false; var ratingDb = null; var ratingWrites = new Map(); var ratingWriteTimer = null; var imdbKnown = 0; var tmdbKnown = 0;
  var RATING_SOURCES = ['both', 'web', 'imdb', 'tmdb', 'provider', 'off'];
  var ratingSource = 'both'; try { ratingSource = localStorage.getItem('lg-stream-rating-source-v1') || 'both'; } catch (_) {}
  if (RATING_SOURCES.indexOf(ratingSource) < 0) ratingSource = 'both';
  var prefetchOn = true; try { prefetchOn = localStorage.getItem('lg-stream-imdb-prefetch-v1') !== 'off'; } catch (_) {}
  function saveRatingMeta() { try { localStorage.setItem(RATING_META, JSON.stringify(ratings)); } catch (_) {} }
  function flushRatingWrites() {
    ratingWriteTimer = null; if (!ratingDb || !ratingWrites.size) return;
    var writes = ratingWrites; ratingWrites = new Map();
    try { var store = ratingDb.transaction('items', 'readwrite').objectStore('items'); writes.forEach(function (value, key) { store.put(value, key); }); } catch (_) {}
  }
  function queueRatingWrite(key, value) { ratingWrites.set(key, value); if (!ratingWriteTimer) ratingWriteTimer = setTimeout(flushRatingWrites, 2000); }
  function setRatingItem(key, item) {
    var before = ratingItems.get(key); if (before && before.i) imdbKnown -= 1; if (item.i) imdbKnown += 1;
    if (before && before.t !== undefined) tmdbKnown -= 1; if (item.t !== undefined) tmdbKnown += 1;
    var known = function (value) { return value === undefined ? null : value; };
    ratingItems.set(key, item); queueRatingWrite(key, [known(item.i), known(item.p), known(item.t), known(item.d)]);
  }
  function loadRatings() {
    var finish = function () {
      // One-time move of ratings saved by the first 0.9.2 builds.
      try {
        var legacy = JSON.parse(localStorage.getItem('lg-stream-ratings-v1') || 'null');
        if (legacy && legacy.items) { Object.keys(legacy.items).forEach(function (key) { var old = legacy.items[key] || {}; if (!ratingItems.has(key)) setRatingItem(key, { i: old.i, p: old.p }); }); if (!localStorage.getItem(RATING_META)) { ratings = { day: String(legacy.day || ''), omdb: Number(legacy.omdb) || 0 }; saveRatingMeta(); } }
        localStorage.removeItem('lg-stream-ratings-v1');
      } catch (_) {}
      ratingsLoaded = true;
      Array.prototype.forEach.call($('movie-grid').querySelectorAll('.movie-card'), function (card) { applyCardRating(card, Number(card.dataset.index)); });
      renderImdbSettings(); scheduleAllPrefetch(30000);
    };
    try {
      var request = indexedDB.open('lg-stream-ratings', 1);
      request.onupgradeneeded = function () { request.result.createObjectStore('items'); };
      request.onerror = function () { finish(); };
      request.onsuccess = function () {
        ratingDb = request.result;
        var transaction = ratingDb.transaction('items', 'readonly'); var store = transaction.objectStore('items');
        var keys = store.getAllKeys(); var values = store.getAll();
        transaction.oncomplete = function () {
          var keyList = keys.result || []; var valueList = values.result || [];
          for (var position = 0; position < keyList.length; position += 1) {
            var value = valueList[position] || []; var item = {};
            if (typeof value[0] === 'string') item.i = value[0]; if (typeof value[1] === 'string') item.p = value[1];
            if (typeof value[2] === 'string') item.t = value[2]; if (typeof value[3] === 'string') item.d = value[3];
            ratingItems.set(String(keyList[position]), item); if (item.i) imdbKnown += 1; if (item.t !== undefined) tmdbKnown += 1;
          }
          finish();
        };
        transaction.onerror = function () { finish(); };
      };
    } catch (_) { finish(); }
  }
  function ratingDay() { var now = new Date(); return now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate(); }
  function omdbAllowed(limit) { if (ratings.day !== ratingDay()) { ratings.day = ratingDay(); ratings.omdb = 0; saveRatingMeta(); } return !!omdbKey && showsImdb() && ratings.omdb < (limit || OMDB_DAILY); }
  function noteOmdbUse() { omdbAllowed(); ratings.omdb += 1; saveRatingMeta(); }
  function providerRatingsWanted() { return ratingSource === 'both' || ratingSource === 'provider'; }
  function showsImdb() { return ratingSource === 'both' || ratingSource === 'web' || ratingSource === 'imdb'; }
  function showsTmdb() { return ratingSource === 'both' || ratingSource === 'web' || ratingSource === 'tmdb'; }
  function tmdbWanted() { return !!tmdbKey && showsTmdb(); }
  function entryTitle(entry) { return entry.originalName !== undefined ? entry.originalName : entry.name; }
  function appLanguage() { return document.documentElement.lang === 'en' ? 'en' : 'ar'; }
  function ratingKey(index) { return entryKeys && entryKeys.length === sources.length && index >= 0 && index < entryKeys.length ? String(entryKeys[index]) : null; }
  function storedRating(index) { var key = ratingKey(index); return key ? ratingItems.get(key) || null : null; }
  function rememberRating(index, provider, imdb, tmdb) {
    var key = ratingKey(index); if (!key) return;
    var old = ratingItems.get(key) || {}; var item = { i: old.i, p: old.p, t: old.t, d: old.d };
    if (provider !== undefined) item.p = provider || '';
    if (imdb !== undefined) item.i = imdb || '';
    if (tmdb !== undefined) { item.t = tmdb ? tmdb.rating || '' : ''; item.d = tmdb ? tmdb.id || '' : ''; }
    setRatingItem(key, item);
    var card = $('movie-grid').querySelector('.movie-card[data-index="' + index + '"]'); if (card) applyCardRating(card, index);
  }
  // Which rating is shown follows the owner's choice in Settings.
  function bestRating(index) {
    if (ratingSource === 'off') return null;
    var item = storedRating(index) || {}; var own = sources[index] && Number(sources[index].rating) ? String(sources[index].rating) : '';
    if (showsImdb() && item.i) return { value: item.i, kind: 'imdb' };
    if (showsTmdb() && item.t) return { value: item.t, kind: 'tmdb' };
    if (!providerRatingsWanted()) return null;
    var provider = item.p || own; return provider ? { value: provider, kind: 'provider' } : null;
  }
  // While the app is open and idle (no playback, no key press for 20 s),
  // look up IMDb ratings for every movie, newest first, one every 1.5 s, at
  // most PREFETCH_DAILY a day. Any key press cancels the request in flight.
  var prefetchTimer = null; var prefetchRequest = null; var prefetchQueue = null; var prefetchQueueKey = null; var prefetchPosition = 0; var prefetchStopped = '';
  function prefetchEnabled() { return prefetchOn && !!omdbKey && showsImdb(); }
  function schedulePrefetch(delay) { clearTimeout(prefetchTimer); prefetchTimer = null; if (prefetchEnabled() && ratingsLoaded) prefetchTimer = setTimeout(runPrefetch, delay); }
  function cancelPrefetchRequest() {
    if (prefetchRequest) { var request = prefetchRequest; prefetchRequest = null; request.abort(); }
    if (tmdbPrefetchRequest) { var tmdbRequest = tmdbPrefetchRequest; tmdbPrefetchRequest = null; tmdbRequest.abort(); }
  }
  function scheduleAllPrefetch(delay) { schedulePrefetch(delay); scheduleTmdbPrefetch(delay); }
  function stopAllPrefetch() { cancelPrefetchRequest(); clearTimeout(prefetchTimer); prefetchTimer = null; clearTimeout(tmdbPrefetchTimer); tmdbPrefetchTimer = null; }
  function prefetchProgress() { if (!$('imdb-panel').hidden) renderPrefetchStatus(); }
  function prefetchBlocked() {
    return document.hidden || unloading || playingIndex !== null || watchMode || playlistRunning || !detailsPanel.hidden || !!detailsRequest || !!ratingFillRequest || typeof AbortController !== 'function' || Date.now() - lastUserActivityAt < 20000;
  }
  function buildPrefetchQueue() {
    var key = catalogViewRevision + ':' + sources.length;
    if (prefetchQueueKey === key && prefetchQueue) return;
    var movies = [];
    for (var index = 0; index < sources.length; index += 1) if (entrySection(index) === 'movies' && ratingKey(index)) movies.push(index);
    movies.sort(function (a, b) { return (api.providerSerial(entryKeys[b]) || 0) - (api.providerSerial(entryKeys[a]) || 0) || a - b; });
    prefetchQueue = movies; prefetchQueueKey = key; prefetchPosition = 0; tmdbPrefetchPosition = 0;
  }
  function runPrefetch() {
    prefetchTimer = null; if (!prefetchEnabled()) return;
    if (!omdbAllowed(PREFETCH_DAILY)) { prefetchStopped = 'daily'; prefetchProgress(); schedulePrefetch(30 * 60 * 1000); return; }
    if (prefetchBlocked()) { schedulePrefetch(5000); return; }
    buildPrefetchQueue();
    var target = -1; var title = ''; var checked = 0;
    while (prefetchPosition < prefetchQueue.length && checked < 3000) {
      var index = prefetchQueue[prefetchPosition]; var item = storedRating(index) || {}; checked += 1;
      if (item.i !== undefined) { prefetchPosition += 1; continue; }
      title = api.omdbTitle(entryTitle(sources[index]));
      if (!title) { rememberRating(index, undefined, ''); prefetchPosition += 1; continue; }
      target = index; break;
    }
    if (target < 0) { if (prefetchPosition >= prefetchQueue.length) { prefetchStopped = 'done'; prefetchProgress(); } else schedulePrefetch(50); return; }
    var controller = new AbortController(); prefetchRequest = controller;
    var timer = setTimeout(function () { controller.abort(); }, 8000); var retryLater = false;
    noteOmdbUse();
    fetchJson(api.omdbUrl(omdbKey, title, itemYear(target)), controller).then(function (reply) {
      clearTimeout(timer); if (prefetchRequest === controller) prefetchRequest = null;
      if (controller.signal.aborted) { schedulePrefetch(5000); return; }
      var failure = api.omdbFailure(reply);
      if (reply === null || failure) {
        // No retry burst: wait, then try the same movie again later.
        if (failure === 'limit') ratings.omdb = OMDB_DAILY;
        prefetchStopped = failure === 'key' ? 'key' : 'network'; retryLater = true;
      } else {
        var imdb = api.omdbDetails(reply); rememberRating(target, undefined, imdb ? imdb.rating : ''); prefetchPosition += 1; prefetchStopped = '';
      }
      prefetchProgress();
      schedulePrefetch(retryLater ? 10 * 60 * 1000 : 1500);
    });
  }
  // TMDB has no daily limit: the same idle rule, one search every 0.4 s.
  var tmdbPrefetchTimer = null; var tmdbPrefetchRequest = null; var tmdbPrefetchPosition = 0; var tmdbPrefetchStopped = '';
  function tmdbPrefetchEnabled() { return prefetchOn && tmdbWanted(); }
  function scheduleTmdbPrefetch(delay) { clearTimeout(tmdbPrefetchTimer); tmdbPrefetchTimer = null; if (tmdbPrefetchEnabled() && ratingsLoaded) tmdbPrefetchTimer = setTimeout(runTmdbPrefetch, delay); }
  function runTmdbPrefetch() {
    tmdbPrefetchTimer = null; if (!tmdbPrefetchEnabled()) return;
    if (prefetchBlocked()) { scheduleTmdbPrefetch(5000); return; }
    buildPrefetchQueue();
    var target = -1; var title = ''; var checked = 0;
    while (tmdbPrefetchPosition < prefetchQueue.length && checked < 3000) {
      var index = prefetchQueue[tmdbPrefetchPosition]; var item = storedRating(index) || {}; checked += 1;
      if (item.t !== undefined) { tmdbPrefetchPosition += 1; continue; }
      title = api.tmdbTitle(entryTitle(sources[index]));
      if (!title) { rememberRating(index, undefined, undefined, null); tmdbPrefetchPosition += 1; continue; }
      target = index; break;
    }
    if (target < 0) { if (tmdbPrefetchPosition >= prefetchQueue.length) { tmdbPrefetchStopped = 'done'; prefetchProgress(); } else scheduleTmdbPrefetch(50); return; }
    var controller = new AbortController(); tmdbPrefetchRequest = controller;
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    fetchJson(api.tmdbSearchUrl(tmdbKey, title, itemYear(target), appLanguage()), controller).then(function (reply) {
      clearTimeout(timer); if (tmdbPrefetchRequest === controller) tmdbPrefetchRequest = null;
      if (controller.signal.aborted) { scheduleTmdbPrefetch(5000); return; }
      // No retry burst: wait 5 minutes, then try the same movie again.
      if (reply === null) { tmdbPrefetchStopped = 'network'; prefetchProgress(); scheduleTmdbPrefetch(5 * 60 * 1000); return; }
      rememberRating(target, undefined, undefined, api.tmdbSearchResult(reply, itemYear(target), appLanguage()));
      tmdbPrefetchPosition += 1; tmdbPrefetchStopped = ''; prefetchProgress();
      scheduleTmdbPrefetch(400);
    });
  }
  function renderPrefetchStatus() {
    if (!$('prefetch-status')) return;
    LGI18n.text($('prefetch-toggle'), prefetchOn ? 'مفعّل — إيقاف' : 'متوقف — تشغيل');
    $('prefetch-toggle').setAttribute('aria-pressed', String(prefetchOn));
    var total = prefetchQueue ? prefetchQueue.length : 0; var lines = [];
    if (prefetchEnabled()) lines.push('تقييمات IMDb المحفوظة: ' + imdbKnown + (total ? ' من ' + total + ' فيلم' : '') + ' · اليوم ' + Math.min(ratings.omdb, OMDB_DAILY) + ' من ' + PREFETCH_DAILY +
      (prefetchStopped === 'daily' ? ' · اكتمل حد اليوم، يكمل غدًا' : prefetchStopped === 'done' ? ' · اكتمل كل الأفلام' : prefetchStopped === 'key' ? ' · رفض OMDb المفتاح' : prefetchStopped === 'network' ? ' · تعذر الاتصال، يعيد لاحقًا' : ''));
    if (tmdbPrefetchEnabled()) lines.push('أفلام بحثها TMDB: ' + tmdbKnown + (total ? ' من ' + total + ' فيلم' : '') +
      (tmdbPrefetchStopped === 'done' ? ' · اكتمل كل الأفلام' : tmdbPrefetchStopped === 'network' ? ' · تعذر الاتصال، يعيد لاحقًا' : ''));
    var text = lines.length ? lines.join('\n') : !omdbKey && !tmdbKey ? 'يحتاج مفتاح OMDb أو TMDB.' : 'متوقف.';
    LGI18n.text($('prefetch-status'), text);
  }
  function applyCardRating(card, index) {
    var rating = bestRating(index); var badge = card.querySelector('.card-rating');
    card.classList.toggle('rated', !!rating);
    if (!rating) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('b'); badge.className = 'card-rating'; badge.setAttribute('aria-hidden', 'true'); card.appendChild(badge); }
    badge.textContent = (rating.kind === 'imdb' ? 'IMDb ' : rating.kind === 'tmdb' ? 'TMDB ' : '★ ') + rating.value;
    badge.classList.toggle('imdb', rating.kind === 'imdb'); badge.classList.toggle('tmdb', rating.kind === 'tmdb');
  }
  // After the remote rests on a page, look up ratings for the visible cards
  // one at a time; any navigation, playback or open details stops it.
  var ratingFillTimer = null; var ratingFillGeneration = 0; var ratingFillRequest = null;
  function scheduleRatingFill() {
    ratingFillGeneration += 1; clearTimeout(ratingFillTimer);
    if (ratingFillRequest) { var request = ratingFillRequest; ratingFillRequest = null; request.abort(); }
    ratingFillTimer = setTimeout(runRatingFill, 900);
  }
  function ratingFillBlocked() {
    return document.hidden || $('movie-browser').hidden || activeSection !== 'movies' || playingIndex !== null || watchMode || !detailsPanel.hidden || !!detailsRequest || typeof AbortController !== 'function';
  }
  // TMDB lookup by the provider's tmdb_id when known, else by title and year.
  function tmdbLookup(index, info, controller, lang) {
    var stored = storedRating(index) || {}; var id = (info && info.tmdb) || stored.d || '';
    var year = itemYear(index) || (info && info.year);
    var url = id ? api.tmdbUrl(tmdbKey, id, lang) : stored.t === undefined ? api.tmdbSearchUrl(tmdbKey, api.tmdbTitle(entryTitle(sources[index])), year, lang) : null;
    if (!url) { if (stored.t === undefined) rememberRating(index, undefined, undefined, null); return Promise.resolve({ movie: null }); }
    return fetchJson(url, controller).then(function (reply) {
      if (controller.signal.aborted || reply === null) return null;
      var movie = id ? api.tmdbMovie(reply, lang) : api.tmdbSearchResult(reply, year, lang);
      rememberRating(index, undefined, undefined, movie);
      return { movie: movie };
    });
  }
  function runRatingFill() {
    var generation = ratingFillGeneration; if (ratingFillBlocked()) return;
    var target = null; var cards = $('movie-grid').querySelectorAll('.movie-card');
    for (var position = 0; position < cards.length && !target; position += 1) {
      var index = Number(cards[position].dataset.index); var entry = sources[index]; var item = storedRating(index);
      if (!entry || !ratingKey(index) || entrySection(index) !== 'movies') continue;
      item = item || {};
      var infoUrl = item.p === undefined && providerRatingsWanted() ? api.vodInfoUrl(activePlaylistUrl, entry.url) : null;
      var title = item.i === undefined && omdbAllowed() ? api.omdbTitle(entryTitle(entry)) : '';
      if (item.i === undefined && omdbKey && !title && omdbAllowed()) { rememberRating(index, undefined, ''); continue; }
      var wantTmdb = item.t === undefined && tmdbWanted();
      if (infoUrl || title || wantTmdb) target = { index: index, infoUrl: infoUrl, title: title, tmdb: wantTmdb };
    }
    if (!target) return;
    var controller = new AbortController(); ratingFillRequest = controller;
    var timer = setTimeout(function () { controller.abort(); }, 8000); var failed = false; var info = null;
    (target.infoUrl ? fetchJson(target.infoUrl, controller) : Promise.resolve(undefined)).then(function (reply) {
      if (controller.signal.aborted) return;
      if (target.infoUrl) { if (reply === null) { failed = true; return; } info = api.vodDetails(reply); rememberRating(target.index, info ? info.rating : '', undefined); }
      if (!target.title) return;
      var url = api.omdbUrl(omdbKey, target.title, itemYear(target.index) || (info && info.year));
      noteOmdbUse();
      return fetchJson(url, controller).then(function (imdbReply) {
        if (controller.signal.aborted) return;
        if (imdbReply === null || api.omdbFailure(imdbReply)) { failed = true; if (api.omdbFailure(imdbReply) === 'limit') ratings.omdb = OMDB_DAILY; return; }
        var imdb = api.omdbDetails(imdbReply); rememberRating(target.index, undefined, imdb ? imdb.rating : '');
      });
    }).then(function () {
      if (failed || controller.signal.aborted || !target.tmdb) return;
      return tmdbLookup(target.index, info, controller, appLanguage()).then(function (result) { if (!result) failed = true; });
    }).then(function () {
      clearTimeout(timer);
      if (ratingFillRequest === controller) ratingFillRequest = null;
      // A failed request is not retried; the next page change tries again.
      if (!failed && !controller.signal.aborted && generation === ratingFillGeneration) ratingFillTimer = setTimeout(runRatingFill, 250);
    });
  }
  function cancelDetailsRequest() { if (detailsRequest) { var request = detailsRequest; detailsRequest = null; request.abort(); } }
  function showDetailsText(index, info, imdb, tmdb) {
    var details = sources[index] || {}; info = info || {}; imdb = imdb || {};
    var lang = appLanguage(); var stored = storedRating(index) || {};
    // The description follows the app language: TMDB's in that language first.
    var tmdbPlot = tmdb && tmdb.lang === lang ? tmdb.plot : '';
    var plot = lang === 'en' ? tmdbPlot || imdb.plot || details.description || info.plot : tmdbPlot || details.description || info.plot || imdb.plot;
    var year = itemYear(index) || info.year; var rating = details.rating || info.rating;
    LGI18n.text($('details-year'), year ? 'الإنتاج: ' + year : 'تاريخ الإنتاج غير متوفر');
    var shown = [];
    if (imdb.rating && showsImdb()) shown.push('IMDb ' + imdb.rating + '/10');
    if (stored.t && showsTmdb()) shown.push('TMDB ' + stored.t + '/10');
    if (rating && providerRatingsWanted()) shown.push((shown.length ? 'المزود ' : 'التقييم: ') + rating + '/10');
    $('details-rating').hidden = ratingSource === 'off';
    LGI18n.text($('details-rating-text'), shown.length ? shown.join(' · ') : 'التقييم غير متوفر');
    LGI18n.provider($('details-description'), plot, 'الوصف غير متوفر لدى المزود.');
    var extra = [];
    if (info.genre) extra.push(info.genre);
    if (info.minutes) extra.push(info.minutes + (lang === 'ar' ? ' دقيقة' : ' min'));
    if (info.director) extra.push(info.director);
    if (info.cast) extra.push(info.cast);
    LGI18n.provider($('details-extra'), extra.join(' · '), '');
    $('details-extra').hidden = !extra.length;
  }
  // Key checks need the provider's reason even when it answers 401.
  function fetchKeyCheck(url, controller) {
    return fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
      .then(function (response) { return response.json().then(function (body) { return { reached: true, status: response.status, body: body }; }, function () { return { reached: true, status: response.status, body: null }; }); })
      .catch(function () { return { reached: false, status: 0, body: null }; });
  }
  function fetchJson(url, controller) {
    return fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
      .then(function (response) { return response && response.ok && typeof response.json === 'function' ? response.json() : null; })
      .catch(function () { return null; });
  }
  function detailsCacheKey(index) { return entryKeys && entryKeys.length === sources.length ? entryKeys[index] : sources[index].url; }
  // The official trailer from TMDB, looked up when the trailer button is
  // pressed: one videos request (plus a title search if the movie's TMDB id is
  // still unknown). Resolves '' when there is none, null when cancelled.
  var trailerRequest = null;
  function cancelTrailerRequest() { if (trailerRequest) { var request = trailerRequest; trailerRequest = null; request.abort(); } }
  function findTmdbTrailer(index) {
    if (!tmdbKey || entrySection(index) !== 'movies' || typeof AbortController !== 'function') return Promise.resolve('');
    var cacheKey = detailsCacheKey(index); var cached = detailsCache.get(cacheKey);
    if (!cached) { cached = { info: undefined, imdb: undefined, tmdb: undefined }; detailsCache.set(cacheKey, cached); }
    if (cached.trailer !== undefined) return Promise.resolve(cached.trailer);
    cancelTrailerRequest();
    var controller = new AbortController(); trailerRequest = controller;
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    var stored = storedRating(index) || {}; var known = (cached.info && cached.info.tmdb) || stored.d;
    var findId = known ? Promise.resolve(known) : tmdbLookup(index, cached.info, controller, appLanguage()).then(function (result) { return result && result.movie ? result.movie.id : ''; });
    return findId.then(function (id) {
      if (!id || controller.signal.aborted) return '';
      return fetchJson(api.tmdbVideosUrl(tmdbKey, id), controller).then(function (reply) {
        var key = api.tmdbTrailer(reply, appLanguage());
        if (reply !== null && !controller.signal.aborted) cached.trailer = key;
        return key;
      });
    }).then(function (key) {
      clearTimeout(timer); if (trailerRequest === controller) trailerRequest = null;
      return controller.signal.aborted ? null : key;
    });
  }
  function loadProviderDetails(index) {
    cancelDetailsRequest();
    var entry = sources[index]; if (!entry || entrySection(index) !== 'movies') return;
    var cacheKey = detailsCacheKey(index);
    var cached = detailsCache.get(cacheKey) || { info: undefined, imdb: undefined, tmdb: undefined };
    var infoUrl = cached.info === undefined ? api.vodInfoUrl(activePlaylistUrl, entry.url) : null;
    var stored = storedRating(index) || {}; var lang = appLanguage();
    if (cached.imdb === undefined && stored.i !== undefined) cached.imdb = stored.i ? { rating: stored.i, plot: '' } : null;
    var wantImdb = cached.imdb === undefined && omdbAllowed();
    var wantTmdb = !!tmdbKey && (!cached.tmdb || cached.tmdb.lang !== lang);
    if (cached.info !== undefined || cached.imdb !== undefined || cached.tmdb) showDetailsText(index, cached.info, cached.imdb, cached.tmdb);
    if ((!infoUrl && !wantImdb && !wantTmdb) || typeof AbortController !== 'function') return;
    var controller = new AbortController(); detailsRequest = controller;
    var timer = setTimeout(function () { controller.abort(); }, 10000);
    LGI18n.text($('details-status-info'), 'جارٍ جلب التفاصيل…'); $('details-status-info').hidden = false;
    var remember = function () {
      if (detailsCache.size >= 200 && !detailsCache.has(cacheKey)) detailsCache.delete(detailsCache.keys().next().value);
      detailsCache.set(cacheKey, cached);
      if (detailsIndex === index) showDetailsText(index, cached.info, cached.imdb, cached.tmdb);
    };
    (infoUrl ? fetchJson(infoUrl, controller) : Promise.resolve(undefined)).then(function (reply) {
      if (controller.signal.aborted) return;
      if (infoUrl) { cached.info = api.vodDetails(reply); remember(); if (reply !== null) rememberRating(index, cached.info ? cached.info.rating : '', undefined); }
      return (wantTmdb ? tmdbLookup(index, cached.info, controller, lang) : Promise.resolve(undefined)).then(function (result) {
        if (controller.signal.aborted) return;
        if (wantTmdb && result) { cached.tmdb = { lang: lang, plot: result.movie ? result.movie.plot : '' }; remember(); }
        var title = api.omdbTitle(entryTitle(entry));
        var imdbUrl = wantImdb ? api.omdbUrl(omdbKey, title, itemYear(index) || (cached.info && cached.info.year)) : null;
        if (!imdbUrl) { if (wantImdb) { cached.imdb = null; remember(); } return; }
        noteOmdbUse();
        return fetchJson(imdbUrl, controller).then(function (imdbReply) {
          if (controller.signal.aborted) return;
          if (api.omdbFailure(imdbReply) === 'limit') ratings.omdb = OMDB_DAILY;
          cached.imdb = api.omdbDetails(imdbReply); remember();
          if (imdbReply !== null && !api.omdbFailure(imdbReply)) rememberRating(index, undefined, cached.imdb ? cached.imdb.rating : '');
        });
      });
    }).then(function () {
      clearTimeout(timer);
      if (detailsRequest === controller) detailsRequest = null;
      if (detailsIndex === index) $('details-status-info').hidden = true;
    });
  }
  // OMDb key panel (Settings → تقييم IMDb). The key stays on this TV and is never shown.
  function renderImdbSettings() {
    LGI18n.text($('imdb-state'), omdbKey ? 'مفعّل — المفتاح محفوظ على هذا التلفزيون' : 'غير مفعّل');
    LGI18n.text($('settings-imdb').querySelector('span'), omdbKey ? 'مفعّل · تقييم IMDb في تفاصيل الأفلام' : 'أضف مفتاح OMDb لعرض تقييم IMDb');
    $('imdb-remove').disabled = !omdbKey;
    // The saved state shows in the field itself, since the typed key is cleared after saving.
    LGI18n.attribute($('imdb-key'), 'placeholder', omdbKey ? '✓ محفوظ — اكتب مفتاحًا جديدًا للاستبدال' : 'اكتب مفتاح OMDb');
    LGI18n.attribute($('tmdb-key'), 'placeholder', tmdbKey ? '✓ محفوظ — اكتب مفتاحًا جديدًا للاستبدال' : 'اكتب مفتاح TMDB');
    $('imdb-state').classList.toggle('key-on', !!omdbKey); $('tmdb-state').classList.toggle('key-on', !!tmdbKey);
    Array.prototype.forEach.call(document.querySelectorAll('[data-rating-source]'), function (button) { var on = button.dataset.ratingSource === ratingSource; button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); });
    renderPrefetchStatus();
    LGI18n.text($('tmdb-state'), tmdbKey ? 'TMDB مفعّل — المفتاح محفوظ على هذا التلفزيون' : 'TMDB غير مفعّل');
    $('tmdb-remove').disabled = !tmdbKey;
    if (omdbKey || tmdbKey) LGI18n.text($('settings-imdb').querySelector('span'), (omdbKey ? 'IMDb مفعّل' : 'IMDb غير مفعّل') + ' · ' + (tmdbKey ? 'TMDB مفعّل' : 'TMDB غير مفعّل'));
  }
  var tmdbCheck = null;
  function saveTmdbKey() {
    var key = $('tmdb-key').value.trim();
    if (!api.validTmdbKey(key)) { LGI18n.text($('imdb-status'), 'مفتاح TMDB (API Key) من 32 حرفًا ورقمًا.'); $('tmdb-key').focus(); return; }
    if (tmdbCheck) tmdbCheck.abort();
    var controller = new AbortController(); tmdbCheck = controller; var timer = setTimeout(function () { controller.abort(); }, 10000);
    LGI18n.text($('imdb-status'), 'جارٍ التحقق من المفتاح…'); $('tmdb-save').disabled = true;
    fetchKeyCheck(api.tmdbUrl(key, 603), controller).then(function (check) {
      clearTimeout(timer); $('tmdb-save').disabled = false; if (tmdbCheck === controller) tmdbCheck = null;
      if (!check.reached) { LGI18n.text($('imdb-status'), 'تعذر الوصول إلى TMDB. تحقق من اتصال التلفزيون ثم أعد المحاولة.'); return; }
      var reply = check.body;
      if (!reply || reply.id !== 603) { LGI18n.text($('imdb-status'), 'لم يقبل TMDB المفتاح. تأكد أنه API Key وليس Read Access Token.'); return; }
      tmdbKey = key; $('tmdb-key').value = ''; detailsCache.forEach(function (item) { item.tmdb = undefined; });
      try { localStorage.setItem(TMDB_KEY_STORE, key); LGI18n.text($('imdb-status'), 'تم الحفظ. تقييم TMDB ووصفه يظهران في الأفلام عند توفرهما.'); }
      catch (_) { LGI18n.text($('imdb-status'), 'يعمل لهذه الجلسة فقط؛ تعذر الحفظ.'); }
      renderImdbSettings(); scheduleTmdbPrefetch(30000); $('close-imdb').focus();
    });
  }
  function removeTmdbKey() {
    stopAllPrefetch(); schedulePrefetch(30000);
    tmdbKey = ''; detailsCache.forEach(function (item) { item.tmdb = undefined; }); try { localStorage.removeItem(TMDB_KEY_STORE); } catch (_) {}
    LGI18n.text($('imdb-status'), 'حُذف المفتاح من هذا التلفزيون.'); renderImdbSettings(); $('tmdb-key').focus();
  }
  var imdbCheck = null;
  function saveImdbKey() {
    var key = $('imdb-key').value.trim();
    if (!api.validOmdbKey(key)) { LGI18n.text($('imdb-status'), 'المفتاح أحرف وأرقام إنجليزية فقط (عادة 8).'); $('imdb-key').focus(); return; }
    if (imdbCheck) imdbCheck.abort();
    var controller = new AbortController(); imdbCheck = controller; var timer = setTimeout(function () { controller.abort(); }, 10000);
    LGI18n.text($('imdb-status'), 'جارٍ التحقق من المفتاح…'); $('imdb-save').disabled = true;
    fetchKeyCheck(api.omdbUrl(key, 'The Matrix', '1999'), controller).then(function (check) {
      clearTimeout(timer); $('imdb-save').disabled = false; if (imdbCheck === controller) imdbCheck = null;
      if (controller.signal.aborted && !check.reached) { LGI18n.text($('imdb-status'), 'تعذر الوصول إلى OMDb. تحقق من اتصال التلفزيون ثم أعد المحاولة.'); return; }
      var reply = check.body;
      if (!check.reached) { LGI18n.text($('imdb-status'), 'تعذر الوصول إلى OMDb. تحقق من اتصال التلفزيون ثم أعد المحاولة.'); return; }
      if (api.omdbFailure(reply) === 'limit') { LGI18n.text($('imdb-status'), 'وصل المفتاح للحد اليومي في OMDb. جرّب غدًا.'); return; }
      if (!api.omdbDetails(reply)) { LGI18n.text($('imdb-status'), 'رفض OMDb المفتاح: غير مفعّل أو فيه حرف خطأ. افتح رابط التفعيل في إيميل OMDb، وتأكد من الأحرف (مثل 0 و o) ثم أعد المحاولة.'); return; }
      omdbKey = key; $('imdb-key').value = ''; detailsCache.forEach(function (item) { item.imdb = undefined; });
      try { localStorage.setItem(OMDB_KEY_STORE, key); LGI18n.text($('imdb-status'), 'تم الحفظ. تقييم IMDb يظهر في تفاصيل الأفلام.'); }
      catch (_) { LGI18n.text($('imdb-status'), 'يعمل لهذه الجلسة فقط؛ تعذر الحفظ.'); }
      renderImdbSettings(); schedulePrefetch(30000); $('close-imdb').focus();
    });
  }
  function removeImdbKey() {
    stopAllPrefetch(); scheduleTmdbPrefetch(30000);
    omdbKey = ''; detailsCache.forEach(function (item) { item.imdb = undefined; }); try { localStorage.removeItem(OMDB_KEY_STORE); } catch (_) {}
    LGI18n.text($('imdb-status'), 'حُذف المفتاح من هذا التلفزيون.'); renderImdbSettings(); $('imdb-key').focus();
  }
  function closeImdbPanel() {
    if (imdbCheck) { imdbCheck.abort(); imdbCheck = null; $('imdb-save').disabled = false; }
    if (tmdbCheck) { tmdbCheck.abort(); tmdbCheck = null; $('tmdb-save').disabled = false; }
    $('imdb-key').value = ''; $('tmdb-key').value = '';
  }
  function closeDetails() { cancelDetailsRequest(); cancelTrailerRequest(); detailsPanel.hidden = true; $('details-poster').removeAttribute('src'); detailsIndex = null; saveViewState(false); focusSelected(); }
  function openDetails(index) {
    cancelSwitch();
    selected = index; detailsIndex = index; var details = sources[index] || {};
    LGI18n.provider($('details-title'), details.name, activeSection === 'series' ? 'مسلسل' : 'فيلم');
    $('details-status-info').hidden = true; showDetailsText(index, null);
    $('details-poster').hidden = !details.poster; detailsPanel.querySelector('.details-card').classList.toggle('no-poster', !details.poster);
    if (details.poster) $('details-poster').src = details.poster; else $('details-poster').removeAttribute('src');
    var officialTrailer = !!tmdbKey && activeSection === 'movies';
    LGI18n.text($('details-status'), officialTrailer ? 'يُفتح الإعلان الرسمي في تطبيق YouTube، أو البحث عنه إن لم يوجد. قد يعيدك زر الرجوع إلى الرئيسية؛ افتح LG Stream للعودة لنفس التفاصيل.' : details.trailer ? 'إعلان المزود متوفر.' : 'سيُفتح بحث YouTube بالاسم والسنة. قد يعيدك زر الرجوع إلى الرئيسية؛ افتح LG Stream للعودة لنفس التفاصيل.');
    LGI18n.text($('details-trailer'), officialTrailer || details.trailer ? 'مشاهدة الإعلان' : 'بحث الإعلان في YouTube');
    detailsPanel.hidden = false; saveViewState(true); $('details-play').focus();
    loadProviderDetails(index);
  }
  var player = api.createPlayer({
    createVideo: function () {
      var video = document.createElement('video');
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      LGI18n.attribute(video, 'aria-label', 'البث الحالي');
      return video;
    },
    mountVideo: function (video) {
      $('video-host').appendChild(video);
      ['loadedmetadata', 'resize'].forEach(function (name) { video.addEventListener(name, applyPictureFit); });
      requestAnimationFrame(applyPictureFit);
      ['loadedmetadata', 'durationchange', 'timeupdate', 'progress'].forEach(function (name) { video.addEventListener(name, function () { if (video.parentNode && !$('media-controls').hidden) updatePlaybackControls(); }); });
      [video.audioTracks, video.textTracks].forEach(function (tracks) {
        if (tracks && tracks.addEventListener) ['addtrack', 'removetrack', 'change'].forEach(function (name) { tracks.addEventListener(name, function () { if (video.parentNode && !$('media-controls').hidden) updateTrackOptions(); }); });
      });
      updateTrackOptions();
    },
    unmountVideo: function (video) { cancelSeek(); closeTrackPicker(false); video.remove(); },
    onState: function (state) {
      if (state.channel) trackInterruptions(state);
      lastState = state.state;
      document.body.dataset.state = state.state;
      LGI18n.text($('status'), labels[state.state] || 'جاهز');
      if (state.state === 'error' && state.errorCode) LGI18n.text($('status'), LGI18n.original($('status')) + ' (' + state.errorCode + ')');
      LGI18n.text($('toggle-button'), state.state === 'paused' ? 'متابعة البث' : 'إيقاف مؤقت');
      LGI18n.text($('media-toggle'), retryablePlayback() ? 'إعادة المحاولة' : state.state === 'paused' ? 'متابعة' : 'إيقاف مؤقت');
      $('toggle-button').disabled = ['playing', 'waiting', 'paused'].indexOf(state.state) < 0;
      $('stop-button').disabled = state.state === 'idle';
      $('retry-button').disabled = playingIndex === null;
      $('display-button').disabled = ['playing', 'waiting', 'paused', 'loading'].indexOf(state.state) < 0;
      $('display-fullscreen').disabled = $('display-button').disabled;
      updateChannelStates();
      if (['error', 'play-rejected', 'startup-timeout', 'stall-timeout', 'ended'].indexOf(state.state) >= 0) {
        if (playingIndex === null) { stop(); focusSelected(); LGI18n.text($('status'), labels[state.state]); return; }
        if (watchMode && entrySection(playingIndex) === 'tv') {
          if (watchChannels === null) setWatchMode(true);
          $('fullscreen-hint').hidden = true;
          LGI18n.text($('status'), watchChannels === null ? 'البث مقطوع — أكمل بالسهم فوق أو تحت، أو اضغط رجوع' : 'البث مقطوع — اختر قناة واضغط موافق');
        } else if (watchMode || isOnDemand()) { setWatchMode(false); if (isOnDemand()) renderChannels(); $('retry-button').focus(); }
        scheduleReconnect(state);
      }
      if (!watchMode && setup.hidden && searchPanel.hidden && detailsPanel.hidden && diagnostics.hidden && speedPanel.hidden && $('group-manager').hidden && !extraDialog() && document.activeElement.disabled) focusSelected();
      $('playing-ms').textContent = state.playingMs === null || state.playingMs === undefined ? '—' : state.playingMs + ' ms';
      $('source-ms').textContent = state.sourceMs == null ? '—' : state.sourceMs + ' ms';
      $('metadata-ms').textContent = state.metadataMs == null ? '—' : state.metadataMs + ' ms';
      $('progress-ms').textContent = state.progressMs === null || state.progressMs === undefined ? '—' : state.progressMs + ' ms';
      LGI18n.text($('frame-ms'), state.firstFrameMs === null || state.firstFrameMs === undefined ? (state.frameApi ? 'بانتظار الإشارة' : 'غير متاح') : state.firstFrameMs + ' ms');
      $('stall-count').textContent = state.stalls || 0;
      $('stall-ms').textContent = (state.stallMs || 0) + ' ms';
      $('video-size').textContent = state.width ? state.width + ' × ' + state.height : '—';
      var failed = ['error', 'play-rejected', 'startup-timeout', 'stall-timeout'].indexOf(state.state) >= 0;
      var quality = failed ? '' : measuredQuality(state.width, state.height);
      LGI18n.text($('quality-badge'), quality || (failed || state.state === 'idle' ? 'غير متاحة' : 'بانتظار القياس'));
      $('actual-quality').hidden = playingIndex === null;
      if (watchMode && announcementIndex === playingIndex && !switchPending && quality) {
        LGI18n.text($('watch-quality-value'), quality);
        if (!announcementQualityReady) {
          announcementQualityReady = true;
          $('fullscreen-hint').hidden = false;
          $('fullscreen-hint').classList.add('channel-announcement');
          scheduleAnnouncementHide();
        }
      }
      $('error-code').textContent = state.errorCode || '—';
    }
  });
  function updateChannelStates() {
    Array.prototype.forEach.call($('channels').querySelectorAll('.channel-button'), function (button) {
      var index = Number(button.dataset.index);
      var current = playingIndex === index;
      button.classList.toggle('active', current);
      button.setAttribute('aria-pressed', String(current));
    });
  }
  function renderChannels() {
    var indexes = visibleIndexes();
    LGI18n.text($('channel-count'), indexes.length + ' قناة');
    renderMovies(indexes);
    $('channels').replaceChildren();
    $('channel-empty').hidden = indexes.length > 0;
    LGI18n.html($('channel-empty'), sources.length ? 'لا توجد قنوات مطابقة<br><span>غيّر المجموعة أو البحث</span>' : 'قنواتك تظهر هنا<br><span>أضف مصدرًا للبدء</span>');
    LGI18n.text($('empty-title'), sources.length ? 'اختر قناة وابدأ المشاهدة' : 'مساحتك للمشاهدة');
    LGI18n.text($('empty-description'), sources.length ? 'تم تحميل ' + sources.length + ' قناة أو فيديو. تنقّل بالأسهم ثم اضغط موافق.' : 'أضف رابط M3U كاملًا أو روابط مباشرة.');
    LGI18n.text($('start-button'), sources.length ? 'تغيير القائمة' : 'إضافة قائمة M3U');
    var contentMode = activeSection === 'movies' || activeSection === 'series';
    channelWindowStart = Math.max(0, Math.min(channelWindowStart, Math.max(0, indexes.length - channelWindowSize)));
    var start = contentMode ? 0 : channelWindowStart;
    var end = contentMode ? 0 : Math.min(start + channelWindowSize, indexes.length);
    for (var position = start; position < end; position += 1) {
      var index = indexes[position];
      var row = document.createElement('div'); row.className = 'channel-row';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-button' + (playingIndex === index ? ' active' : '');
      button.dataset.index = index;
      var number = document.createElement('span');
      number.className = 'channel-number'; number.textContent = String(position + 1);
      var label = document.createElement('span');
      var name = sources[index].name; var arabic = arabicChannelName(index);
      label.className = 'channel-label'; LGI18n.provider(label, name, 'المصدر ' + (index + 1), arabic);
      button.appendChild(number); button.appendChild(label);
      if (selectState && selectState.kind === 'channel' && selectState.items.has(index)) markSelected(button, true);
      if (moveState && moveState.kind === 'channel' && moveState.items.indexOf(index) >= 0) button.classList.add('is-moving');
      if (newFlags && newFlags[index]) { var badge = document.createElement('span'); badge.className = 'new-badge'; LGI18n.text(badge, 'جديد'); button.appendChild(badge); }
      button.setAttribute('aria-pressed', playingIndex === index ? 'true' : 'false');
      button.addEventListener('focus', function (event) { selected = Number(event.currentTarget.dataset.index); event.currentTarget.scrollIntoView({ block: 'nearest' }); });
      button.addEventListener('click', function (event) { activateChannel(Number(event.currentTarget.dataset.index)); });
      var favorite = document.createElement('button');
      favorite.type = 'button'; favorite.className = 'favorite-button'; favorite.dataset.favoriteIndex = index;
      favorite.textContent = favorites[index] ? '★' : '☆'; favorite.setAttribute('aria-pressed', String(!!favorites[index]));
      LGI18n.attribute(favorite, 'aria-label', (favorites[index] ? 'إزالة من المفضلة: ' : 'إضافة إلى المفضلة: ') + (name ? '' : 'القناة'), name, arabic);
      favorite.addEventListener('focus', function (event) { selected = Number(event.currentTarget.dataset.favoriteIndex); event.currentTarget.scrollIntoView({ block: 'nearest' }); });
      favorite.addEventListener('click', function (event) {
        var ownIndex = Number(event.currentTarget.dataset.favoriteIndex);
        favorites[ownIndex] = !favorites[ownIndex];
        if (!favorites[ownIndex]) delete favorites[ownIndex];
        favoritesRevision += 1;
        saveViewState(false);
        renderGroups(); renderChannels();
        var target = $('channels').querySelector('[data-favorite-index="' + ownIndex + '"]');
        if (target) target.focus(); else focusSelected();
      });
      row.appendChild(button); row.appendChild(favorite); $('channels').appendChild(row);
    }
    updateChannelStates();
  }
  function focusChannel(index) {
    var indexes = visibleIndexes();
    var position = indexes.indexOf(index);
    if (position < 0) { var fallback = $('channels').querySelector('button') || $('groups').querySelector('.group-button.active'); if (fallback) fallback.focus(); return; }
    if (position < channelWindowStart || position >= channelWindowStart + channelWindowSize) { channelWindowStart = Math.max(0, position - 4); renderChannels(); }
    var button = $('channels').querySelector('[data-index="' + index + '"]');
    if (button) button.focus();
    else $('start-button').focus();
  }
  function focusSelected() {
    if (activeSection !== 'movies' && activeSection !== 'series') { focusChannel(selected); return; }
    var indexes = visibleIndexes(); var position = indexes.indexOf(selected);
    if (position >= 0 && (position < contentWindowStart || position >= contentWindowStart + contentWindowSize)) contentWindowStart = Math.floor(Math.max(0, position - 4) / 4) * 4;
    renderChannels();
    var card = $('movie-grid').querySelector('[data-index="' + selected + '"]') || $('movie-grid').querySelector('.movie-card');
    if (card) card.focus(); else { var group = $('groups').querySelector('.group-button.active'); if (group) group.focus(); }
  }
  function moveContentWindow(step) {
    if ((activeSection !== 'movies' && activeSection !== 'series') || !document.activeElement.classList.contains('movie-card')) return false;
    var indexes = visibleIndexes(); var position = indexes.indexOf(selected);
    if (position < 0) return true;
    if (step === -4 && position < 4) { $('sort-button').focus(); return true; }
    if (step === 4 && Math.floor(position / 4) === Math.floor((indexes.length - 1) / 4)) return true;
    if (step === -1 && position % 4 === 0) {
      if (document.documentElement.dir === 'ltr') { var leftGroup = $('groups').querySelector('.group-button.active'); if (leftGroup) leftGroup.focus(); }
      return true;
    }
    if (step === 1 && (position % 4 === 3 || position === indexes.length - 1)) {
      if (document.documentElement.dir !== 'ltr') { var group = $('groups').querySelector('.group-button.active'); if (group) group.focus(); }
      return true;
    }
    var next = Math.max(0, Math.min(indexes.length - 1, position + step));
    if (next === position) return true;
    if (next < contentWindowStart || next >= contentWindowStart + contentWindowSize) {
      contentWindowStart = step > 0 ? Math.floor(Math.max(0, next - (contentWindowSize - 4)) / 4) * 4 : Math.floor(next / 4) * 4;
      contentWindowStart = Math.min(contentMaxStart(indexes.length), contentWindowStart); renderMovieWindow();
    }
    var card = $('movie-grid').querySelector('[data-index="' + indexes[next] + '"]'); if (card) card.focus(); return true;
  }
  function moveGroupFocus(step) {
    var current = document.activeElement;
    if (!current.classList.contains('group-button') || current.parentNode !== $('groups')) return false;
    var target = step > 0 ? current.nextElementSibling : current.previousElementSibling;
    if (!target) {
      var groups = groupKeys();
      var position = groups.indexOf(current.dataset.group); var next = position + step;
      if (next < 0) {
        var shortcuts = $('category-shortcuts');
        (appearance.layout === 'vertical' && !shortcuts.hidden ? shortcuts.lastElementChild : $('groups-filter')).focus(); return true;
      }
      if (next >= groups.length) return true;
      groupWindowStart = Math.max(0, Math.min(next - (step > 0 ? groupWindowSize - 1 : 0), Math.max(0, groups.length - groupWindowSize)));
      renderGroups();
      Array.prototype.some.call($('groups').querySelectorAll('.group-button'), function (button) {
        if (button.dataset.group !== groups[next]) return false;
        target = button; return true;
      });
    }
    if (!target) return false;
    target.focus(); return true;
  }
  function moveChannelWindow(step) {
    var current = document.activeElement; var favorite = current.classList.contains('favorite-button');
    if (activeSection === 'movies' || activeSection === 'series' || (!favorite && !current.classList.contains('channel-button'))) return false;
    var index = Number(favorite ? current.dataset.favoriteIndex : current.dataset.index);
    var indexes = visibleIndexes(); var position = indexes.indexOf(index); var next = position + step;
    if (next < 0 || next >= indexes.length) return true;
    if (next < channelWindowStart || next >= channelWindowStart + channelWindowSize) { channelWindowStart = Math.max(0, next - (step > 0 ? 4 : channelWindowSize - 5)); renderChannels(); }
    var target = $('channels').querySelector(favorite ? '[data-favorite-index="' + indexes[next] + '"]' : '.channel-button[data-index="' + indexes[next] + '"]');
    if (target) target.focus(); return true;
  }
  function playChannel(intent) {
    var index = intent.index;
    switchPending = false;
    if (!prepareForegroundAction()) return;
    if (!sources[index] || !speedPanel.hidden || speedRunning) return;
    selected = index;
    if (!intent.retry && playingIndex === index && ['loading', 'playing', 'waiting', 'paused'].indexOf(lastState) >= 0) {
      if (lastState === 'paused') player.resume();
      return;
    }
    playingIndex = index;
    $('movie-browser').hidden = true;
    $('empty-state').hidden = true;
    var title = api.channelTitle(sources[index].name);
    LGI18n.provider($('channel-title'), title, 'المصدر ' + (index + 1), entrySection(index) === 'tv' ? api.compactChannelName(title, '') : '');
    if (!watchMode && activeSection === 'tv' && !intent.auto) focusChannel(index);
    var playbackSource = sources[index].url;
    if (liveTransport === 'hls' && sourceMode === 'playlist' && entrySection(index) === 'tv') {
      playbackSource = api.nativeHlsSource(playbackSource, activePlaylistUrl);
    }
    if (!player.start(playbackSource, index + 1, intent.requestedAt, { watchStall: entrySection(index) === 'tv' })) return;
    if (entrySection(index) === 'movies' || entrySection(index) === 'series') setWatchMode(true);
  }
  var scheduler = api.createSwitchScheduler(playChannel);
  function cancelSwitch() {
    switchPending = false; scheduler.cancel();
    clearTimeout(hintTimer);
    $('fullscreen-hint').hidden = true;
    $('fullscreen-hint').classList.remove('channel-announcement');
    announcementIndex = null; announcementQualityReady = false;
  }
  var lastConfirmIndex = null;
  var lastConfirmAt = 0;
  function activateChannel(index) {
    if (watchChannels !== null) {
      if (playingIndex === index && !retryablePlayback()) { closeWatchChannels(); return; }
      requestChannel(index, false, playingIndex === index);
      return;
    }
    var now = performance.now();
    if (playingIndex === index && lastConfirmIndex === index && now - lastConfirmAt <= 700 && ['loading', 'playing', 'waiting', 'paused'].indexOf(lastState) >= 0) {
      cancelSwitch(); setWatchMode(true); lastConfirmIndex = null; lastConfirmAt = 0; return;
    }
    lastConfirmIndex = index; lastConfirmAt = now; requestChannel(index, false);
  }
  function requestChannel(index, coalesce, retry) {
    cancelReconnect(true);
    var intent = { index: index, requestedAt: performance.now(), retry: !!retry };
    if (watchMode && coalesce && sources[index]) {
      announcementIndex = index; announcementQualityReady = false;
      $('fullscreen-hint').classList.add('channel-announcement');
      var title = api.channelTitle(sources[index].name);
      LGI18n.provider($('watch-channel-name'), title, 'المصدر ' + (index + 1), api.compactChannelName(title, ''));
      var position = visibleIndexes().indexOf(index);
      $('watch-channel-number').textContent = position >= 0 ? String(position + 1) : '';
      $('watch-channel-number').hidden = position < 0;
      var video = $('video-host').querySelector('video');
      var quality = index === playingIndex && video ? measuredQuality(video.videoWidth, video.videoHeight) : '';
      announcementQualityReady = !!quality;
      LGI18n.text($('watch-quality-value'), quality || 'بانتظار القياس');
      $('watch-quality-row').hidden = false;
      $('fullscreen-hint').hidden = false;
      scheduleAnnouncementHide();
    }
    switchPending = !!coalesce; if (coalesce) scheduler.request(intent); else scheduler.immediate(intent);
  }
  function measuredQuality(width, height) { var label = api.qualityLabel(width, height); return label ? label + ' · ' + width + '×' + height : ''; }
  function scheduleAnnouncementHide() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      $('fullscreen-hint').hidden = true;
      $('fullscreen-hint').classList.remove('channel-announcement');
      if (announcementQualityReady) announcementIndex = null;
    }, 6000);
  }
  function stop() {
    cancelReconnect(true);
    cancelSwitch();
    setWatchMode(false);
    playingIndex = null;
    lastConfirmIndex = null; lastConfirmAt = 0;
    player.stop();
    updateChannelStates();
    LGI18n.provider($('channel-title'), null, 'لا يوجد بث محدد');
    $('empty-state').hidden = false;
    $('retry-button').disabled = true;
    if (activeSection === 'movies' || activeSection === 'series') renderChannels();
    setTimeout(scheduleAutoUpdate, 0);
  }
  function setWatchMode(enabled) {
    closeWatchChannels();
    cancelSeek();
    closeTrackPicker(false);
    watchMode = enabled;
    $('media-controls').hidden = true;
    document.body.classList.toggle('watch-mode', enabled);
    clearTimeout(hintTimer);
    $('fullscreen-hint').hidden = !enabled;
    $('fullscreen-hint').classList.remove('channel-announcement');
    announcementIndex = null; announcementQualityReady = false;
    $('watch-channel-number').hidden = true; $('watch-quality-row').hidden = true;
    LGI18n.provider($('watch-channel-name'), '', isOnDemand() ? 'موافق للتحكم · رجوع للخروج' : 'موافق للقنوات · يمين للتحكم');
    requestAnimationFrame(applyPictureFit);
    if (enabled) {
      document.body.tabIndex = -1;
      document.body.focus();
      hintTimer = setTimeout(function () { $('fullscreen-hint').hidden = true; }, 3000);
    }
  }
  $('video-host').addEventListener('click', function () { if (watchMode) showPlaybackControls(); });
  var seekTimer = null;
  var pendingSeek = null;
  function cancelSeek() { clearTimeout(seekTimer); seekTimer = null; pendingSeek = null; }
  function isOnDemand() { return playingIndex !== null && /^(movies|series)$/.test(entrySection(playingIndex)); }
  function exitPlayback() {
    if (switchPending && playingIndex !== null) selected = playingIndex;
    cancelSwitch();
    LGI18n.text($('status'), labels[lastState] || 'جاهز');
    if (isOnDemand() || (playingIndex === null && lastState !== 'idle')) stop(); else setWatchMode(false);
    focusSelected();
  }
  function timeLabel(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '—';
    var minutes = Math.floor(seconds / 60); return Math.floor(minutes / 60) + ':' + ('0' + minutes % 60).slice(-2) + ':' + ('0' + Math.floor(seconds % 60)).slice(-2);
  }
  function updatePlaybackControls() {
    var video = $('video-host').querySelector('video');
    var seekable = !!(video && isOnDemand() && isFinite(video.duration) && video.duration > 0 && video.seekable.length);
    $('seek-controls').hidden = !isOnDemand();
    var seekFocused = $('seek-controls').contains(document.activeElement);
    ['seek-back', 'seek-forward', 'seek-position'].forEach(function (id) { $(id).disabled = !seekable; });
    if (!seekable && seekFocused && !extraDialog()) $('media-toggle').focus();
    $('seek-position').max = video && isFinite(video.duration) ? video.duration : 0;
    $('seek-position').step = 'any';
    if (pendingSeek === null && document.activeElement !== $('seek-position')) $('seek-position').value = video ? video.currentTime : 0;
    $('playback-time').textContent = video ? timeLabel(pendingSeek === null ? video.currentTime : pendingSeek) + ' / ' + timeLabel(video.duration) : '—';
    if (!seekable) LGI18n.text($('seek-status'), 'التقديم غير متاح حاليًا لهذا المصدر.');
    else if (LGI18n.original($('seek-status')) === 'التقديم غير متاح حاليًا لهذا المصدر.') $('seek-status').textContent = '';
  }
  function seekTo(seconds) {
    var video = $('video-host').querySelector('video');
    if (!video || !isOnDemand() || !isFinite(seconds) || !isFinite(video.duration)) return;
    if (!video.seekable.length) return;
    seconds = Math.max(video.seekable.start(0), Math.min(video.seekable.end(video.seekable.length - 1), seconds));
    for (var i = 0; i < video.seekable.length; i += 1) {
      if (seconds < video.seekable.start(i) || seconds > video.seekable.end(i)) continue;
      try { video.currentTime = seconds; } catch (_) { LGI18n.text($('seek-status'), 'تعذر الانتقال في هذا المصدر.'); return; }
      $('seek-status').textContent = ''; updatePlaybackControls(); return;
    }
    LGI18n.text($('seek-status'), 'هذا الموضع غير متاح في المصدر حاليًا.');
  }
  function queueSeek(seconds) {
    var video = $('video-host').querySelector('video'); if (!video || !isOnDemand() || !isFinite(seconds)) return;
    clearTimeout(seekTimer); pendingSeek = Math.max(0, Math.min(video.duration, seconds));
    $('seek-position').value = pendingSeek; $('playback-time').textContent = timeLabel(pendingSeek) + ' / ' + timeLabel(video.duration);
    seekTimer = setTimeout(function () { var target = pendingSeek; cancelSeek(); if (video === $('video-host').querySelector('video')) seekTo(target); }, 400);
  }
  var trackPicker = null;
  function trackChoices(video, audio) {
    var tracks = video && (audio ? video.audioTracks : video.textTracks); var choices = [];
    if (tracks) for (var i = 0; i < tracks.length; i += 1) {
      var track = tracks[i];
      if (!audio && track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      choices.push({ index: i, track: track, label: track.label || track.language || (audio ? 'صوت ' : 'ترجمة ') + (i + 1), active: audio ? track.enabled : track.mode === 'showing' });
    }
    if (!audio) choices.unshift({ index: -1, track: null, label: 'إيقاف الترجمة', active: !choices.some(function (choice) { return choice.active; }) });
    return choices;
  }
  function closeTrackPicker(restoreFocus) {
    var opener = trackPicker && $(trackPicker.id);
    trackPicker = null; $('track-picker').hidden = true; $('track-list').replaceChildren();
    if (opener) opener.setAttribute('aria-expanded', 'false');
    if (restoreFocus && watchMode && !$('media-controls').hidden) (opener && !opener.disabled ? opener : $('media-toggle')).focus();
  }
  function updateTrackOptions() {
    var video = $('video-host').querySelector('video');
    ['audio-language', 'subtitle-language'].forEach(function (id) {
      var button = $(id); var audio = id === 'audio-language'; var choices = trackChoices(video, audio);
      var active = choices.find(function (choice) { return choice.active; });
      var label = audio ? choices.length === 1 ? choices[0].label + ' (مسار واحد)' : active ? active.label : 'اختيار المسار' : active.label;
      if (choices.length === (audio ? 0 : 1)) label = audio ? 'لا توجد مسارات متاحة' : 'غير متاحة';
      LGI18n.text(button, (audio ? 'لغة الصوت: ' : 'الترجمة: ') + label);
      button.disabled = choices.length < 2;
      if (button.disabled && document.activeElement === button && !$('media-controls').hidden) $('media-toggle').focus();
    });
    if (trackPicker) {
      var choices = trackChoices(video, trackPicker.id === 'audio-language');
      if (video !== trackPicker.video || choices.length !== trackPicker.choices.length || choices.some(function (choice, i) { return choice.index !== trackPicker.choices[i].index || choice.track !== trackPicker.choices[i].track; })) { closeTrackPicker(true); return; }
      Array.prototype.forEach.call($('track-list').children, function (button, i) { button.setAttribute('aria-pressed', String(!!choices[i].active)); });
    }
  }
  function openTrackPicker(id) {
    updateTrackOptions(); if ($(id).disabled || !watchMode || $('media-controls').hidden) return;
    cancelSwitch();
    var video = $('video-host').querySelector('video'); var audio = id === 'audio-language'; var choices = trackChoices(video, audio);
    closeTrackPicker(false); trackPicker = { id: id, video: video, choices: choices };
    LGI18n.text($('track-picker-title'), audio ? 'لغة الصوت' : 'الترجمة');
    choices.forEach(function (choice) {
      var button = document.createElement('button'); button.type = 'button'; button.dataset.trackIndex = choice.index;
      LGI18n.text(button, choice.label); button.setAttribute('aria-pressed', String(!!choice.active));
      button.addEventListener('focus', function () { button.scrollIntoView({ block: 'nearest' }); });
      button.addEventListener('click', function () {
        var current = trackChoices(video, audio).find(function (item) { return item.index === choice.index; });
        if (video !== $('video-host').querySelector('video') || !current || current.track !== choice.track) { closeTrackPicker(true); updateTrackOptions(); return; }
        try {
          if (audio) choice.track.enabled = true;
          trackChoices(video, audio).forEach(function (item) { if (item.track) { if (audio) item.track.enabled = item.track === choice.track; else item.track.mode = item.track === choice.track ? 'showing' : 'disabled'; } });
          $('track-status').textContent = '';
        } catch (_) { LGI18n.text($('track-status'), 'تعذر تغيير المسار على هذا الجهاز.'); }
        closeTrackPicker(true); updateTrackOptions();
      });
      $('track-list').appendChild(button);
    });
    $(id).setAttribute('aria-expanded', 'true'); $('track-picker').hidden = false;
    ($('track-list').querySelector('[aria-pressed="true"]') || $('track-list').firstElementChild).focus();
  }
  function retryablePlayback() { return playingIndex !== null && ['error', 'play-rejected', 'startup-timeout', 'stall-timeout', 'ended'].indexOf(lastState) >= 0; }
  function showWatchChannels() {
    if (playingIndex === null || isOnDemand()) { showPlaybackControls(); return; }
    cancelSwitch();
    var indexes = visibleIndexes().filter(function (index) { return entrySection(index) === 'tv'; });
    if (indexes.indexOf(playingIndex) < 0) {
      indexes = [];
      sources.forEach(function (entry, index) {
        if (entry.group === sources[playingIndex].group && entryVisible(index) && entrySection(index) === 'tv') indexes.push(index);
      });
    }
    watchChannelsWindow = channelWindowStart;
    watchChannels = indexes;
    $('media-controls').hidden = true;
    document.body.classList.add('watch-channels');
    renderChannels();
    focusChannel(playingIndex);
  }
  function closeWatchChannels() {
    if (watchChannels === null) return;
    watchChannels = null;
    channelWindowStart = watchChannelsWindow;
    if (playingIndex !== null) selected = playingIndex;
    document.body.classList.remove('watch-channels');
    renderChannels();
    document.body.focus();
  }
  function showPlaybackControls() {
    if (!$('track-picker').hidden) return;
    closeWatchChannels();
    if (switchPending && playingIndex !== null) selected = playingIndex;
    cancelSwitch();
    $('seek-status').textContent = ''; $('track-status').textContent = '';
    $('media-controls').hidden = false; updatePlaybackControls(); updateTrackOptions();
    LGI18n.text($('media-toggle'), retryablePlayback() ? 'إعادة المحاولة' : lastState === 'paused' ? 'متابعة' : 'إيقاف مؤقت');
    $('media-toggle').focus();
  }
  $('media-toggle').addEventListener('click', function () { cancelSwitch(); if (retryablePlayback()) requestChannel(playingIndex, false, true); else player.toggle(); });
  $('media-close').addEventListener('click', function () { cancelSeek(); closeTrackPicker(false); $('media-controls').hidden = true; document.body.focus(); });
  $('media-exit').addEventListener('click', exitPlayback);
  $('seek-back').addEventListener('click', function () { var video = $('video-host').querySelector('video'); if (video) queueSeek((pendingSeek === null ? video.currentTime : pendingSeek) - 30); });
  $('seek-forward').addEventListener('click', function () { var video = $('video-host').querySelector('video'); if (video) queueSeek((pendingSeek === null ? video.currentTime : pendingSeek) + 30); });
  $('seek-position').addEventListener('input', function () { queueSeek(Number(this.value)); });
  ['audio-language', 'subtitle-language'].forEach(function (id) {
    $(id).addEventListener('click', function () { openTrackPicker(id); });
  });
  $('close-track-picker').addEventListener('click', function () { closeTrackPicker(true); });
  function noteUserActivity() {
    lastUserActivityAt = Date.now(); cancelPrefetchRequest();
    if (playlistRunning && playlistAutomatic) prepareForegroundAction();
  }
  function scheduleAutoUpdate() {
    clearTimeout(autoUpdateTimer); autoUpdateTimer = null;
    if (playlistRunning) return;
    if (automaticReleasedView) {
      var restoreWait = restoreRetryAt - Date.now();
      if (restoreWait > 0) { if (!document.hidden && !unloading) autoUpdateTimer = setTimeout(scheduleAutoUpdate, restoreWait); return; }
      if (!document.hidden && !unloading) restoreReleasedCatalog('', true).then(function (restored) { if (restored) scheduleAutoUpdate(); });
      return;
    }
    if (!activePlaylistUrl || !activeCatalogSavedAt || document.hidden || unloading) return;
    var remaining = activeCatalogSavedAt + AUTO_UPDATE_MS - Date.now();
    if (remaining > 0) { autoUpdateTimer = setTimeout(scheduleAutoUpdate, Math.min(remaining, 2147483647)); return; }
    if (autoNextAttemptAt > Date.now()) { autoUpdateTimer = setTimeout(scheduleAutoUpdate, autoNextAttemptAt - Date.now()); return; }
    var idleRemaining = lastUserActivityAt + AUTO_UPDATE_IDLE_MS - Date.now();
    if (idleRemaining > 0) { autoUpdateTimer = setTimeout(scheduleAutoUpdate, idleRemaining); return; }
    var browsing = lastState === 'idle' && playingIndex === null && !switchPending && setup.hidden && searchPanel.hidden && detailsPanel.hidden && diagnostics.hidden && speedPanel.hidden && $('group-manager').hidden && !extraDialog() && !groupSettingsSaving && !watchMode;
    if (!browsing) { autoUpdateTimer = setTimeout(scheduleAutoUpdate, 60000); return; }
    loadPlaylist(activePlaylistUrl, true);
  }
  function prepareForegroundAction() {
    if (!playlistRunning || !playlistAutomatic) return true;
    autoNextAttemptAt = Date.now() + 5 * 60 * 1000;
    if (cancelPlaylist()) { LGI18n.text($('status'), 'جارٍ استعادة القائمة السابقة… أعد المحاولة بعد لحظة'); return false; }
    LGI18n.text($('status'), 'جارٍ إتمام حفظ القائمة… أعد المحاولة بعد لحظة'); return false;
  }
  function playlistControls(running) {
    playlistRunning = running;
    if (!running) { playlistSaving = false; playlistAutomatic = false; }
    var busy = running || transportSaving;
    $('load-playlist').disabled = busy;
    $('cancel-playlist').disabled = !running;
    $('playlist-url').disabled = busy;
    $('refresh-saved').disabled = busy;
    $('manage-groups-button').disabled = running || !activePlaylistUrl || !sources.length;
    inputs.forEach(function (input) { input.disabled = busy; });
    $('source-form').querySelector('button[type="submit"]').disabled = busy;
    $('clear-sources').disabled = busy;
    ['xtream-server', 'xtream-username', 'xtream-password', 'load-xtream', 'rename-source', 'toggle-source', 'add-source', 'save-source-name', 'source-name-input'].forEach(function (id) { $(id).disabled = busy; });
    if (!running) $('playlist-progress').hidden = true;
    renderLiveTransport();
  }
  function cancelPlaylist() {
    if (playlistSaving && !catalogStore.cancel()) { LGI18n.text($('playlist-status'), 'جارٍ إتمام الحفظ المحلي…'); return false; }
    var wasAutomatic = playlistAutomatic;
    playlistRevision += 1;
    playlistLoader.cancel();
    if (!playlistSaving) catalogStore.cancel();
    if (playlistRunning) LGI18n.text($('playlist-status'), 'أُلغي تحميل القائمة.');
    playlistControls(false);
    if (wasAutomatic) {
      autoNextAttemptAt = Math.max(autoNextAttemptAt, Date.now() + 5 * 60 * 1000);
      restoreReleasedCatalog('أُلغي التحديث التلقائي — عادت القائمة السابقة', !document.hidden).then(function (restored) { if (restored) scheduleAutoUpdate(); });
    }
    return true;
  }

  function currentSource() {
    return sourceList.find(function (item) { return item.id === activeSourceId; }) || sourceList[0] || null;
  }
  function sourceRecord() { return { key: 'sources', list: sourceList.map(function (item) { return { id: item.id, name: item.name, url: item.url, addedAt: item.addedAt }; }), activeId: activeSourceId }; }
  function saveSources() { return catalogStore.saveMeta([sourceRecord()]); }
  function sourceTimeLabel(time) {
    if (!time) return '';
    var date = new Date(time); var pad = function (value) { return (value < 10 ? '0' : '') + value; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
  function renderSourceCard() {
    var source = currentSource();
    $('source-card').hidden = !source;
    if (!source) return;
    var active = source.id === activeSourceId;
    LGI18n.provider($('source-name'), source.name, DEFAULT_SOURCE_NAME);
    LGI18n.text($('source-badge'), active ? 'نشط' : 'متوقف');
    $('source-badge').classList.toggle('stopped', !active);
    LGI18n.text($('toggle-source'), active ? 'إيقاف' : 'تفعيل');
    $('refresh-saved').hidden = !active;
    var loaded = active && activePlaylistUrl === source.url && sources.length;
    LGI18n.text($('source-counts'), loaded ? 'بث ' + catalogTotals.tv + ' · أفلام ' + catalogTotals.movies + ' · مسلسلات ' + catalogTotals.series : active ? 'القائمة غير محملة الآن' : 'المصدر متوقف — قنواته لا تظهر حتى تفعّله');
    LGI18n.text($('saved-catalog-status'), active && activeCatalogSavedAt ? 'آخر تحديث: ' + sourceTimeLabel(activeCatalogSavedAt) : '');
  }
  function setAddMode(mode) {
    addMode = mode;
    Array.prototype.forEach.call($('add-source-panel').querySelectorAll('[data-add-mode]'), function (button) { button.setAttribute('aria-pressed', String(button.dataset.addMode === mode)); });
    Array.prototype.forEach.call($('add-source-panel').querySelectorAll('[data-add-section]'), function (section) { section.hidden = section.dataset.addSection !== mode; });
  }
  function showAddSource(open) {
    $('add-source-panel').hidden = !open; $('add-source').setAttribute('aria-expanded', String(open));
    if (open) setAddMode(addMode);
  }
  function askSource(text, action) {
    sourceConfirmAction = action; LGI18n.text($('source-confirm-text'), text);
    $('source-confirm').hidden = false; $('source-confirm-no').focus();
  }
  function closeSourceConfirm(focus) {
    sourceConfirmAction = null; $('source-confirm').hidden = true;
    if (focus) (focus.offsetParent ? focus : $('close-setup')).focus();
  }
  function stopActiveSource() {
    if (playlistRunning) return;
    sourceGeneration += 1; if (!cancelPlaylist()) return; stop();
    automaticReleasedView = null; automaticRestoreMessage = ''; clearTimeout(autoUpdateTimer);
    catalogViewRevision += 1; favoritesRevision += 1; sources = []; clearCatalogMeta(); activePlaylistUrl = null; activeCatalogRevision = null; activeCatalogSavedAt = 0; favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0;
    activeSourceId = null; renderPrimary(); renderGroups(); renderChannels(); renderSourceCard(); playlistControls(false);
    saveSources().then(function (result) { LGI18n.text($('playlist-status'), result.state === 'complete' ? 'أُوقف المصدر. قائمته محفوظة ويمكن تفعيله في أي وقت.' : 'أُوقف المصدر لهذه الجلسة؛ تعذر حفظ الحالة.'); });
    $('toggle-source').focus();
  }
  function activateSource(source) {
    if (playlistRunning || !source) return;
    activeSourceId = source.id; saveSources(); renderSourceCard();
    var generation = ++sourceGeneration;
    LGI18n.text($('playlist-status'), 'جارٍ تفعيل المصدر…');
    catalogStore.load().then(function (saved) {
      if (generation !== sourceGeneration || unloading) return;
      if (saved.state === 'complete' && saved.source === source.url) {
        applyCatalog(saved.entries, saved.source, saved.revision, saved.savedAt, true, saved.hiddenGroups, saved.liveTransport);
        LGI18n.text($('playlist-status'), 'المصدر نشط.'); renderSourceCard(); $('refresh-saved').focus(); scheduleAutoUpdate();
      } else loadPlaylist(source.url, false);
    });
  }
  function deleteSource() {
    if (playlistRunning) return;
    sourceGeneration += 1; if (!cancelPlaylist()) return; stop(); $('clear-sources').disabled = true; LGI18n.text($('playlist-status'), 'جارٍ حذف المصدر…');
    catalogStore.clear().then(function (result) {
      $('clear-sources').disabled = false;
      if (result.state !== 'complete') { LGI18n.text($('playlist-status'), 'تعذر حذف المصدر. لم نغيّر شيئًا.'); return; }
      try { localStorage.removeItem(VIEW_KEY); } catch (_) {}
      automaticReleasedView = null; automaticRestoreMessage = '';
      setHiddenGroups(null); sourceList = []; activeSourceId = null; catalogMeta = { customization: null, knownKeys: null, newKeys: null };
      catalogViewRevision += 1; favoritesRevision += 1; sources = []; clearCatalogMeta(); activePlaylistUrl = null; activeCatalogRevision = null; activeCatalogSavedAt = 0; clearTimeout(autoUpdateTimer); favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
      $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
      $('manage-groups-button').disabled = true;
      renderSourceCard(); showAddSource(true); LGI18n.text($('playlist-status'), 'حُذف المصدر وقائمته وتخصيصاته من التلفزيون.'); $('form-error').textContent = '';
      $('add-source-panel').querySelector('[data-add-mode="' + addMode + '"]').focus();
    });
  }
  function renderLiveTransport() {
    var button = $('live-transport');
    button.hidden = !api.nativeHlsPlaylist(activePlaylistUrl);
    button.disabled = playlistRunning;
    button.setAttribute('aria-pressed', String(liveTransport === 'hls'));
    LGI18n.text(button, liveTransport === 'hls' ? 'البث المباشر: HLS من المزود' : 'البث المباشر: رابط القائمة الأصلي');
  }
  $('live-transport').addEventListener('click', function () {
    if (playlistRunning || transportSaving || !api.nativeHlsPlaylist(activePlaylistUrl)) return;
    var source = activePlaylistUrl;
    var generation = sourceGeneration;
    var next = liveTransport === 'hls' ? 'original' : 'hls';
    transportSaving = true;
    LGI18n.text($('transport-status'), 'جارٍ حفظ طريقة البث…');
    playlistControls(false);
    catalogStore.saveLiveTransport(source, next).then(function (result) {
      transportSaving = false;
      if (unloading) return;
      if (generation !== sourceGeneration || source !== activePlaylistUrl) {
        $('transport-status').textContent = '';
        playlistControls(playlistRunning);
        return;
      }
      if (result.state === 'complete') {
        liveTransport = next;
        LGI18n.text($('transport-status'), 'حُفظت طريقة البث. تُطبق عند اختيار قناة أخرى أو إعادة المحاولة يدويًا.');
      } else LGI18n.text($('transport-status'), 'تعذر حفظ طريقة البث. بقي الاختيار السابق.');
      playlistControls(playlistRunning);
    });
  });
  function openSetup() {
    cancelSwitch();
    setWatchMode(false);
    diagnostics.hidden = true;
    $('settings-info').setAttribute('aria-expanded', 'false');
    clearSourceInputs();
    inputs.forEach(function (input, index) { input.value = sourceMode === 'manual' && sources[index] ? sources[index].url : ''; });
    if (!playlistRunning) $('playlist-status').textContent = '';
    $('form-error').textContent = '';
    $('transport-status').textContent = '';
    closeSourceConfirm(); $('rename-row').hidden = true;
    renderSourceCard();
    var source = currentSource();
    if (!source && sourceMode === 'manual' && sources.length) addMode = 'direct';
    showAddSource(!source);
    playlistControls(playlistRunning);
    setup.hidden = false;
    // Never focus a text field on open: the TV keyboard appears only after
    // the owner chooses to add a source and selects a field. On webOS,
    // focusing an input while opening the dialog can also leave it active
    // without invoking the system keyboard when it is selected afterward.
    if (source && playlistRunning) $('cancel-playlist').focus();
    else if (source) (source.id === activeSourceId ? $('refresh-saved') : $('toggle-source')).focus();
    else $('add-source-panel').querySelector('[data-add-mode="' + addMode + '"]').focus();
  }
  function clearSourceInputs() {
    ['playlist-url', 'xtream-server', 'xtream-username', 'xtream-password', 'source-name-input'].forEach(function (id) { $(id).value = ''; });
  }
  // Back inside the sources screen closes the innermost open part first.
  function setupBack() {
    if (!$('source-confirm').hidden) { closeSourceConfirm(sourceConfirmReturn); return true; }
    if (!$('rename-row').hidden) { $('rename-row').hidden = true; $('source-name-input').value = ''; $('rename-source').focus(); return true; }
    if (!$('add-source-panel').hidden && currentSource() && !playlistRunning) { showAddSource(false); clearSourceInputs(); $('add-source').focus(); return true; }
    return false;
  }
  function closeSetup() {
    if (transportSaving || !cancelPlaylist()) return;
    setup.hidden = true;
    clearSourceInputs(); closeSourceConfirm(); $('rename-row').hidden = true; showAddSource(false);
    inputs.forEach(function (input) { input.value = ''; });
    if (!returnToSettings()) { if (sources.length) focusSelected(); else $('start-button').focus(); }
    setTimeout(scheduleAutoUpdate, 0);
  }
  function closeDiagnostics() {
    diagnostics.hidden = true;
    $('settings-info').setAttribute('aria-expanded', 'false');
    if (!returnToSettings()) $('nav-settings').focus();
  }
  $('source-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (playlistRunning) return;
    var result = [];
    for (var index = 0; index < inputs.length; index += 1) {
      if (!inputs[index].value.trim()) continue;
      var url = api.validateSource(inputs[index].value);
      if (!url) {
        LGI18n.text($('form-error'), 'المصدر ' + (index + 1) + ': أدخل رابط HTTP أو HTTPS صالحًا.');
        inputs[index].focus(); return;
      }
      result.push(url);
    }
    if (!result.length) { LGI18n.text($('form-error'), 'أضف مصدرًا واحدًا على الأقل.'); inputs[0].focus(); return; }
    sourceGeneration += 1; catalogViewRevision += 1; favoritesRevision += 1; stop(); activeCategory = 'all'; categoryPositions = {}; clearCatalogMeta(); sources = result.map(function (url, index) { return { url: url, name: 'المصدر ' + (index + 1), group: '' }; });
    automaticReleasedView = null; automaticRestoreMessage = '';
    setHiddenGroups(null);
    activePlaylistUrl = null; activeCatalogRevision = null; activeCatalogSavedAt = 0; clearTimeout(autoUpdateTimer); favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0;
    renderPrimary(); renderGroups(); renderChannels(); closeSetup();
    LGI18n.text($('status'), 'تم حفظ المصادر للجلسة — اختر قناة للتشغيل');
  });
  function setPlaylistProgress(fraction) {
    var bar = $('playlist-progress-bar');
    bar.classList.toggle('indeterminate', fraction === null);
    if (fraction !== null) bar.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  }
  function playlistFocus() {
    if (document.hidden || setup.hidden) return;
    var target = currentSource() && $('add-source-panel').hidden ? $('refresh-saved') : addMode === 'xtream' ? $('load-xtream') : addMode === 'link' ? $('load-playlist') : null;
    if (target && target.offsetParent && !target.disabled) target.focus(); else $('close-setup').focus();
  }
  // Stable keys, the comparison with the previous refresh and the meta
  // records saved with the catalogue. Keys are computed in ~30ms slices so the
  // remote stays responsive; a newer load or cancel abandons the work.
  function prepareCatalogSave(url, entries, revision) {
    var keys = new Float64Array(entries.length); var index = 0;
    return new Promise(function (resolve) {
      function step() {
        if (revision !== playlistRevision) { resolve(null); return; }
        var until = performance.now() + 30;
        while (index < entries.length && performance.now() < until) {
          for (var count = 0; count < 400 && index < entries.length; count += 1, index += 1) { keys[index] = api.entryKey(entries[index].url); entries[index].k = keys[index]; }
        }
        if (index < entries.length) { setTimeout(step, 0); return; }
        var previous = catalogMeta.knownKeys && catalogMeta.knownKeys.source === url && catalogMeta.knownKeys.keys && catalogMeta.knownKeys.keys.length ? catalogMeta.knownKeys.keys : null;
        var compared = api.newItemFlags(keys, previous);
        var freshKeys = [];
        if (compared.count) for (var at = 0; at < keys.length; at += 1) if (compared.flags[at]) freshKeys.push(keys[at]);
        var known = { key: 'known-keys', source: url, keys: api.sortedKeys(keys) };
        var fresh = { key: 'new-keys', source: url, keys: api.sortedKeys(freshKeys), at: Date.now() };
        var existing = sourceList.find(function (item) { return item.url === url; });
        // One source for now: a new source replaces the current one.
        var source = existing || { id: 's' + Date.now().toString(36), name: DEFAULT_SOURCE_NAME, url: url, addedAt: Date.now() };
        var list = [source];
        var record = { key: 'sources', list: list.map(function (item) { return { id: item.id, name: item.name, url: item.url, addedAt: item.addedAt }; }), activeId: source.id };
        resolve({ keys: keys, compared: !!previous, known: known, fresh: fresh, source: source, list: list, meta: [known, fresh, record] });
      }
      step();
    });
  }
  function loadPlaylist(url, automatic) {
    if (playlistRunning || transportSaving) return;
    var runtimeView = automatic || (sourceMode === 'playlist' && url === activePlaylistUrl) ? (automaticReleasedView || captureRuntimeView()) : null;
    sourceGeneration += 1; stop();
    // Free the current catalogue before downloading the next one, for manual
    // loads too: holding the old array, the new parse and the save copies at
    // once can exhaust the TV renderer. Failure, cancel or closing setup
    // restores the saved copy through scheduleAutoUpdate/restoreReleasedCatalog.
    if (automatic) releaseCatalogForAutomaticUpdate(runtimeView);
    else if (sourceMode === 'playlist' && activeCatalogRevision && sources.length) releaseCatalogForAutomaticUpdate(runtimeView || captureRuntimeView());
    var revision = ++playlistRevision;
    playlistAutomatic = !!automatic;
    playlistControls(true);
    if (automatic) LGI18n.text($('status'), 'جارٍ تحديث القائمة تلقائيًا…'); else { LGI18n.text($('playlist-status'), 'جارٍ تحميل القائمة…'); $('playlist-progress').hidden = false; setPlaylistProgress(0); $('cancel-playlist').focus(); }
    var progressShownAt = 0;
    playlistLoader.start(url, { onProgress: function (progress) {
      if (automatic || revision !== playlistRevision) return;
      var now = performance.now(); if (now - progressShownAt < 250) return; progressShownAt = now;
      if (progress.total) setPlaylistProgress(0.8 * Math.min(1, progress.bytes / progress.total)); else setPlaylistProgress(null);
      LGI18n.text($('playlist-status'), 'جارٍ التنزيل: ' + (progress.bytes / 1000000).toFixed(1) + ' MB · ' + progress.entries + ' عنصر');
    } }).then(function (result) {
      if (revision !== playlistRevision || document.hidden || (!automatic && setup.hidden)) return;
      if (result.state !== 'complete' || result.truncated) {
        playlistControls(false);
        var messages = {
          timeout: 'انتهت مهلة تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.',
          empty: 'لم نجد روابط قنوات صالحة داخل القائمة.',
          unsupported: 'محرك التلفزيون لا يدعم طريقة تحميل القائمة.',
          invalid: 'الرد ليس قائمة M3U مكتملة وصالحة. احتفظنا بالقائمة السابقة.',
          limit: 'تجاوزت القائمة حد التحميل الآمن. لم نحفظ قائمة ناقصة؛ بقيت القائمة السابقة.'
        };
        var failure = result.truncated ? 'لم تكتمل القائمة، لذلك احتفظنا بالنسخة المحفوظة السابقة.' : (messages[result.state] || 'تعذر تحميل القائمة. احتفظنا بالنسخة المحفوظة السابقة.');
        if (automatic) {
          autoNextAttemptAt = Date.now() + 60 * 60 * 1000;
          restoreReleasedCatalog('تعذر التحديث التلقائي — عادت القائمة السابقة', !document.hidden).then(function (restored) { if (restored) scheduleAutoUpdate(); });
        } else { LGI18n.text($('playlist-status'), failure); playlistFocus(); scheduleAutoUpdate(); }
        return;
      }
      if (automatic) LGI18n.text($('status'), 'اكتمل التنزيل، جارٍ حفظ القائمة…'); else { LGI18n.text($('playlist-status'), 'اكتمل التنزيل، جارٍ حفظ القائمة محليًا…'); setPlaylistProgress(0.8); }
      playlistSaving = true;
      $('cancel-playlist').disabled = false;
      var prepared = null;
      prepareCatalogSave(url, result.entries, revision).then(function (ready) {
        prepared = ready;
        if (!ready || revision !== playlistRevision) return { state: 'cancelled' };
        if (!automatic) setPlaylistProgress(0.85);
        return catalogStore.save(url, result.entries, { meta: ready.meta, onProgress: function (done, total) { if (!automatic && revision === playlistRevision) setPlaylistProgress(0.85 + 0.15 * done / total); } });
      }).then(function (saved) {
        if (revision !== playlistRevision) return;
        if (saved.state !== 'complete') {
          playlistControls(false); var saveFailure = saved.state === 'quota' ? 'مساحة التخزين لا تكفي لحفظ نسخة جديدة بجانب الحالية. احتفظنا بالقائمة السابقة. لتحديثها: «مسح المصادر» ثم حمّل الرابط من جديد.' : 'تعذر حفظ القائمة. احتفظنا بالقائمة السابقة.';
          if (automatic) {
            result.entries = [];
            autoNextAttemptAt = Date.now() + 60 * 60 * 1000;
            restoreReleasedCatalog(saveFailure, !document.hidden).then(function (restored) { if (restored) scheduleAutoUpdate(); });
          } else { LGI18n.text($('playlist-status'), saveFailure); if (!document.hidden) playlistFocus(); scheduleAutoUpdate(); }
          return;
        }
        automaticReleasedView = null;
        automaticRestoreMessage = '';
        sourceList = prepared.list; activeSourceId = prepared.source.id; catalogMeta.knownKeys = prepared.known; catalogMeta.newKeys = prepared.fresh;
        stop(); applyCatalog(result.entries, url, saved.revision, saved.savedAt, false, saved.hiddenGroups, saved.liveTransport, prepared.keys); if (runtimeView) restoreRuntimeView(runtimeView, automatic && !document.hidden);
        var totals = catalogTotals;
        var summary = (automatic ? 'تم تحديث القائمة تلقائيًا: ' : 'تم حفظ ') + sources.length + ' عنصرًا — بث ' + totals.tv + ' · أفلام ' + totals.movies + ' · مسلسلات ' + totals.series;
        if (prepared.compared) {
          var fresh = { tv: displayOrder.tv.newCount, movies: displayOrder.movies.newCount, series: displayOrder.series.newCount };
          summary += fresh.tv + fresh.movies + fresh.series ? ' — الجديد: ' + fresh.tv + ' قناة · ' + fresh.movies + ' فيلم · ' + fresh.series + ' مسلسل (تظهر أولًا)' : ' — لا جديد منذ آخر تحديث';
        }
        LGI18n.text($('status'), summary); LGI18n.text($('playlist-status'), summary);
        playlistControls(false); autoNextAttemptAt = 0;
        if (!automatic) { if (document.hidden) { setup.hidden = true; $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; }); } else closeSetup(); }
        scheduleAutoUpdate();
      });
    });
  }
  $('load-playlist').addEventListener('click', function () {
    var url = api.validateSource($('playlist-url').value);
    if (!url) { LGI18n.text($('playlist-status'), 'أدخل رابط M3U كاملًا يبدأ بـ HTTP أو HTTPS.'); $('playlist-url').focus(); return; }
    $('form-error').textContent = '';
    loadPlaylist(url, false);
  });
  $('refresh-saved').addEventListener('click', function () { if (activePlaylistUrl) loadPlaylist(activePlaylistUrl, false); });
  $('cancel-playlist').addEventListener('click', function () { if (cancelPlaylist()) scheduleAutoUpdate(); playlistFocus(); });
  var sourceConfirmReturn = null;
  $('clear-sources').addEventListener('click', function () {
    if (playlistRunning) return;
    sourceConfirmReturn = $('clear-sources');
    askSource('حذف المصدر يمسح قائمته وترتيبك والقنوات المخفية والأسماء المخصصة من التلفزيون. هل تريد الحذف؟', deleteSource);
  });
  $('toggle-source').addEventListener('click', function () {
    var source = currentSource(); if (playlistRunning || !source) return;
    if (source.id !== activeSourceId) { activateSource(source); return; }
    sourceConfirmReturn = $('toggle-source');
    askSource('هذا هو المصدر الوحيد: إيقافه يُخفي كل القنوات حتى تعيد تفعيله. قائمته وتخصيصاتك تبقى محفوظة. هل تريد الإيقاف؟', stopActiveSource);
  });
  $('source-confirm-yes').addEventListener('click', function () { var action = sourceConfirmAction; closeSourceConfirm(); if (action) action(); });
  $('source-confirm-no').addEventListener('click', function () { closeSourceConfirm(sourceConfirmReturn); });
  $('rename-source').addEventListener('click', function () {
    var source = currentSource(); if (!source || playlistRunning) return;
    $('source-name-input').value = source.name || DEFAULT_SOURCE_NAME; $('rename-row').hidden = false;
    // Focus the save button; the keyboard opens only when the field is selected.
    $('save-source-name').focus();
  });
  $('cancel-source-name').addEventListener('click', function () { $('rename-row').hidden = true; $('source-name-input').value = ''; $('rename-source').focus(); });
  $('save-source-name').addEventListener('click', function () {
    var source = currentSource(); if (!source) return;
    source.name = $('source-name-input').value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || DEFAULT_SOURCE_NAME;
    $('rename-row').hidden = true; $('source-name-input').value = ''; renderSourceCard(); $('rename-source').focus();
    saveSources().then(function (result) { LGI18n.text($('playlist-status'), result.state === 'complete' ? 'حُفظ اسم المصدر.' : 'تغيّر الاسم لهذه الجلسة؛ تعذر حفظه.'); });
  });
  $('add-source').addEventListener('click', function () {
    var open = $('add-source-panel').hidden; showAddSource(open);
    if (open) $('add-source-panel').querySelector('[data-add-mode="' + addMode + '"]').focus(); else clearSourceInputs();
  });
  Array.prototype.forEach.call($('add-source-panel').querySelectorAll('[data-add-mode]'), function (button) {
    button.addEventListener('click', function () { setAddMode(button.dataset.addMode); $('form-error').textContent = ''; });
  });
  $('load-xtream').addEventListener('click', function () {
    var url = api.xtreamPlaylistUrl($('xtream-server').value, $('xtream-username').value, $('xtream-password').value);
    if (!url) { LGI18n.text($('form-error'), 'أكمل السيرفر واسم المستخدم وكلمة المرور. مثال السيرفر: http://server:8080'); ($('xtream-server').value.trim() ? $('xtream-username') : $('xtream-server')).focus(); return; }
    $('form-error').textContent = ''; loadPlaylist(url, false);
  });
  $('channel-search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 180); });
  $('manage-groups-button').addEventListener('click', openGroupManager);
  $('close-group-manager').addEventListener('click', closeGroupManager);
  Array.prototype.forEach.call($('group-manager').querySelectorAll('[data-manage-section]'), function (button) {
    button.addEventListener('click', function () {
      managedSection = button.dataset.manageSection; collectManagedGroups(); renderManagedGroups(); $('manager-status').textContent = '';
      if (managedGroups.length) focusManagedGroup(0);
    });
  });
  $('managed-groups').addEventListener('wheel', function (event) {
    if (groupSettingsSaving) { event.preventDefault(); return; }
    var list = $('managed-groups'); var down = event.deltaY > 0;
    if ((down && list.scrollTop + list.clientHeight < list.scrollHeight - 4) || (!down && list.scrollTop > 4)) return;
    var next = Math.max(0, Math.min(Math.max(0, managedGroups.length - 40), managedWindowStart + (down ? 20 : -20)));
    if (next !== managedWindowStart) { managedWindowStart = next; renderManagedGroups(); focusManagedGroup(next + (down ? 20 : 0)); }
    event.preventDefault();
  }, { passive: false });
  $('clear-search').addEventListener('click', function () { $('channel-search').value = ''; renderSearch(); $('channel-search').focus(); });
  $('nav-search').addEventListener('click', openSearch);
  $('close-search').addEventListener('click', closeSearch);
  $('close-details').addEventListener('click', closeDetails);
  $('details-poster').addEventListener('error', function () { this.hidden = true; this.removeAttribute('src'); detailsPanel.querySelector('.details-card').classList.add('no-poster'); });
  $('details-play').addEventListener('click', function () { cancelDetailsRequest(); var index = detailsIndex; detailsPanel.hidden = true; detailsIndex = null; if (index !== null) activateChannel(index); });
  // YouTube refuses its embedded player inside a local webOS app (error 153,
  // measured on the TV), so trailers open in the YouTube app.
  function openYoutube(target, video) {
    stop();
    if (!target || typeof window.PalmServiceBridge !== 'function') { LGI18n.text($('details-status'), 'تعذر فتح تطبيق YouTube مباشرة على هذا الجهاز.'); return; }
    LGI18n.text($('details-status'), video ? 'جارٍ فتح الإعلان في تطبيق YouTube…' : 'جارٍ إرسال البحث إلى تطبيق YouTube…');
    try {
      youtubeBridge = new window.PalmServiceBridge();
      youtubeBridge.onservicecallback = function (raw) {
        var accepted = false;
        try { accepted = JSON.parse(raw).returnValue === true; } catch (_) {}
        LGI18n.text($('details-status'), !accepted ? 'تعذر فتح تطبيق YouTube.' : video ? 'فُتح الإعلان في تطبيق YouTube.' : 'أُرسل طلب البحث إلى تطبيق YouTube.');
        youtubeBridge = null;
      };
      youtubeBridge.call('luna://com.webos.applicationManager/launch', JSON.stringify({ id: 'youtube.leanback.v4', params: { contentTarget: target } }));
    } catch (_) { youtubeBridge = null; LGI18n.text($('details-status'), 'تعذر فتح تطبيق YouTube.'); }
  }
  // Order: the official TMDB trailer, the provider's trailer, then a YouTube search.
  $('details-trailer').addEventListener('click', function () {
    if (trailerRequest || !prepareForegroundAction()) return;
    cancelDetailsRequest();
    var index = detailsIndex; var details = sources[index] || {};
    if (index === null) return;
    saveViewState(true);
    if (tmdbKey && entrySection(index) === 'movies') LGI18n.text($('details-status'), 'جارٍ البحث عن الإعلان الرسمي…');
    findTmdbTrailer(index).then(function (key) {
      if (key === null || detailsIndex !== index) return;
      if (key) { openYoutube(api.youtubeVideoTarget(key), true); return; }
      if (details.trailer) {
        detailsPanel.hidden = true; detailsIndex = null; playingIndex = null; $('movie-browser').hidden = true; $('empty-state').hidden = true;
        LGI18n.provider($('channel-title'), null, 'الإعلان'); if (player.start(details.trailer, 'trailer', performance.now())) setWatchMode(true); return;
      }
      var cached = detailsCache.get(detailsCacheKey(index)); var providerVideo = cached && cached.info ? cached.info.youtube : '';
      if (providerVideo) { openYoutube(api.youtubeVideoTarget(providerVideo), true); return; }
      openYoutube(api.youtubeSearchTarget(details.name, details.year), false);
    });
  });
  $('sort-button').addEventListener('click', function () {
    var open = $('sort-menu').hidden; $('sort-menu').hidden = !open; $('sort-button').setAttribute('aria-expanded', String(open));
    if (open) { var active = $('sort-menu').querySelector('button.active:not(:disabled)') || $('sort-menu').querySelector('button:not(:disabled)'); if (active) active.focus(); }
  });
  Array.prototype.forEach.call($('sort-menu').querySelectorAll('button'), function (button) {
    button.addEventListener('click', function (event) {
      contentSort = event.currentTarget.dataset.sort; sortRevision += 1; contentWindowStart = 0; $('sort-menu').hidden = true; $('sort-button').setAttribute('aria-expanded', 'false'); renderChannels(); saveViewState(false); $('sort-button').focus();
    });
  });
  $('movie-browser').addEventListener('scroll', function () { schedulePosterCheck(); scheduleViewSave(); });
  $('groups').addEventListener('scroll', scheduleViewSave);
  $('channels').addEventListener('scroll', scheduleViewSave);
  $('channels').addEventListener('wheel', function (event) {
    if (!event.deltaY || activeSection === 'movies' || activeSection === 'series') return;
    var list = $('channels'); var down = event.deltaY > 0;
    if ((down && list.scrollTop + list.clientHeight < list.scrollHeight - 12) || (!down && list.scrollTop > 12)) return;
    var indexes = visibleIndexes(); var target = down ? channelWindowStart + channelWindowSize : channelWindowStart - 1;
    if (target < 0 || target >= indexes.length) return;
    channelWindowStart = Math.max(0, Math.min(channelWindowStart + (down ? 12 : -12), Math.max(0, indexes.length - channelWindowSize)));
    renderChannels(); focusChannel(indexes[target]); saveViewState(false); event.preventDefault();
  }, { passive: false });
  $('groups').addEventListener('wheel', function (event) {
    var list = $('groups'); var down = event.deltaY > 0;
    if ((down && list.scrollTop + list.clientHeight < list.scrollHeight - 12) || (!down && list.scrollTop > 12)) return;
    var groups = groupKeys(); var position = groups.indexOf(activeGroup);
    if (position < 0) position = 0;
    var next = Math.max(0, Math.min(groups.length - 1, position + (down ? 12 : -12)));
    if (next === position) return;
    activeGroup = groups[next]; contentWindowStart = 0; channelWindowStart = 0;
    groupWindowStart = Math.max(0, Math.min(next - (down ? 4 : groupWindowSize - 5), Math.max(0, groups.length - groupWindowSize)));
    renderGroups(); renderChannels();
    Array.prototype.some.call($('groups').querySelectorAll('.group-button'), function (button) {
      if (button.dataset.group !== activeGroup) return false;
      button.focus(); return true;
    });
    list.scrollTop = down ? 0 : list.scrollHeight; saveViewState(false); event.preventDefault();
  }, { passive: false });
  $('movie-browser').addEventListener('wheel', function (event) {
    if (activeSection !== 'movies' && activeSection !== 'series') return;
    var browser = $('movie-browser'); var indexes = visibleIndexes(); var next = contentWindowStart;
    if (event.deltaY > 0 && browser.scrollTop + browser.clientHeight >= browser.scrollHeight - 12) next = Math.min(contentMaxStart(indexes.length), contentWindowStart + 12);
    if (event.deltaY < 0 && browser.scrollTop <= 12) next = Math.max(0, contentWindowStart - 12);
    if (next === contentWindowStart) return;
    contentWindowStart = next; selected = indexes[event.deltaY > 0 ? next : Math.min(indexes.length - 1, next + contentWindowSize - 1)] || selected; renderMovieWindow(); browser.scrollTop = event.deltaY > 0 ? 0 : browser.scrollHeight;
    var card = $('movie-grid').querySelector('[data-index="' + selected + '"]'); if (card) card.focus(); saveViewState(false); event.preventDefault();
  }, { passive: false });
  Array.prototype.forEach.call(document.querySelectorAll('.primary-button'), function (button) {
    button.addEventListener('click', function (event) {
      if (editSession || moveState || selectState) { showOrganizeStatus('أنهِ التعديل أولًا: رجوع للحفظ أو الإلغاء.'); return; }
      cancelSwitch();
      if (event.currentTarget.dataset.section === 'movies' || event.currentTarget.dataset.section === 'series') stop();
      activeSection = event.currentTarget.dataset.section; activeGroup = ''; contentWindowStart = 0; channelWindowStart = 0;
      setPrimary(false); renderPrimary(); renderGroups(); renderChannels();
      saveViewState(false);
      var first = $('groups').querySelector('button'); if (first) first.focus();
    });
  });
  $('nav-settings').addEventListener('click', openSettings);
  ['groups', 'channels'].forEach(function (id) { $(id).addEventListener('focusin', function () { setPrimary(false); }); });
  $('setup-button').addEventListener('click', openSetup);
  $('start-button').addEventListener('click', openSetup);
  $('close-setup').addEventListener('click', closeSetup);
  function openDiagnostics() {
    cancelSwitch();
    diagnostics.hidden = !diagnostics.hidden;
    $('settings-info').setAttribute('aria-expanded', String(!diagnostics.hidden));
    if (!diagnostics.hidden) { renderInterruptions(); $('close-diagnostics').focus(); }
  }
  $('close-diagnostics').addEventListener('click', closeDiagnostics);
  $('toggle-button').addEventListener('click', function () { cancelSwitch(); player.toggle(); });
  $('retry-button').addEventListener('click', function () { if (playingIndex !== null) requestChannel(playingIndex, false, true); });
  $('stop-button').addEventListener('click', function () { stop(); if (sources.length) focusSelected(); else $('start-button').focus(); });

  function speedControls(running) {
    speedRunning = running;
    $('speed-start').disabled = running || !speedConnection;
    $('speed-cancel').disabled = !running;
    $('speed-wired').disabled = running;
    $('speed-wifi').disabled = running;
  }
  function cancelSpeed() {
    speedRevision += 1;
    speedTest.cancel();
    if (speedRunning) LGI18n.text($('speed-status'), 'أُلغي الاختبار. البث متوقف؛ اختر قناة لتشغيله.');
    speedControls(false);
  }
  function closeSpeed() {
    cancelSpeed();
    speedPanel.hidden = true;
    $('settings-speed').setAttribute('aria-expanded', 'false');
    if (!returnToSettings()) $('nav-settings').focus();
  }
  function openSpeed() {
    cancelSwitch(); setWatchMode(false);
    if (!setup.hidden) closeSetup();
    diagnostics.hidden = true;
    $('settings-info').setAttribute('aria-expanded', 'false');
    speedConnection = null;
    $('speed-wired').setAttribute('aria-pressed', 'false');
    $('speed-wifi').setAttribute('aria-pressed', 'false');
    speedControls(false);
    LGI18n.text($('speed-status'), 'اختر نوع الاتصال لبدء الاختبار.');
    speedPanel.hidden = false;
    $('settings-speed').setAttribute('aria-expanded', 'true');
    $('speed-wired').focus();
  }
  ['wired', 'wifi'].forEach(function (connection) {
    $('speed-' + connection).addEventListener('click', function () {
      if (speedRunning) return;
      speedConnection = connection;
      $('speed-wired').setAttribute('aria-pressed', String(connection === 'wired'));
      $('speed-wifi').setAttribute('aria-pressed', String(connection === 'wifi'));
      speedControls(false);
    });
  });
  $('close-speed').addEventListener('click', closeSpeed);
  $('speed-cancel').addEventListener('click', function () { cancelSpeed(); $('speed-start').focus(); });
  $('speed-start').addEventListener('click', function () {
    if (!speedConnection || speedRunning || document.hidden) return;
    if (!prepareForegroundAction()) return;
    stop();
    var revision = ++speedRevision;
    var connection = speedConnection;
    speedControls(true);
    LGI18n.text($('speed-status'), 'جارٍ قياس التنزيل… حتى 8 ثوانٍ. البث متوقف.');
    $('speed-cancel').focus();
    speedTest.start().then(function (result) {
      if (revision !== speedRevision || document.hidden || speedPanel.hidden) return;
      speedControls(false);
      if (result.state === 'complete') {
        speedResults.unshift({ connection: connection, result: result });
        speedResults = speedResults.slice(0, 2);
        $('speed-results').replaceChildren();
        speedResults.forEach(function (item) {
          var row = document.createElement('li');
          var speed = document.createElement('strong');
          LGI18n.text(speed, (item.connection === 'wired' ? 'كيبل' : 'واي فاي') + ' — ' + item.result.mbps.toFixed(1) + ' Mbps');
          var details = document.createElement('p');
          LGI18n.text(details, 'استجابة HTTP: ' + Math.round(item.result.httpMs) + ' ms · ' +
            (item.result.bytes / 1000000).toFixed(1) + ' MB خلال ' + (item.result.durationMs / 1000).toFixed(1) + ' ثانية');
          row.appendChild(speed); row.appendChild(details); $('speed-results').appendChild(row);
        });
        LGI18n.text($('speed-status'), 'اكتمل التقدير. آخر نتيجتين أدناه؛ البث يبقى متوقفًا.');
      } else {
        LGI18n.text($('speed-status'), result.state === 'unsupported' ?
          'هذا النظام لا يتيح طريقة القياس المطلوبة.' : result.state === 'cancelled' ? 'أُلغي الاختبار.' :
          'تعذر القياس. قد يكون خادم الاختبار أو الاتصال غير متاح؛ لا توجد نتيجة جديدة.');
      }
      $('speed-start').focus();
    });
  });


  function extraDialog() {
    return ['exit-confirm', 'category-picker', 'appearance-panel', 'imdb-panel', 'settings-home', 'item-menu', 'rename-panel', 'edit-confirm'].map($).find(function (panel) { return !panel.hidden; }) || null;
  }
  var exitReturn = null;
  function focusSection() {
    setPrimary(true);
    (document.querySelector('.primary-button.active') || $('nav-search')).focus();
  }
  function focusActiveGroup() {
    if (!$('groups').querySelector('.group-button.active')) {
      var previousGroup = activeGroup; renderGroups();
      if (previousGroup !== activeGroup) { renderChannels(); saveViewState(false); }
    }
    var group = $('groups').querySelector('.group-button.active');
    if (group) { setPrimary(false); group.focus(); } else focusSection();
  }
  function backToLibrary() {
    var focused = document.activeElement;
    if (focused.closest('.primary-panel') || focused.closest('.header-actions')) {
      exitReturn = focused; $('exit-confirm').hidden = false; $('exit-cancel').focus();
    } else if (focused.closest('.groups-panel') || focused.closest('#category-shortcuts')) {
      focusSection();
    } else {
      // Rebuild the bounded group window around the active group if it was scrolled away.
      focusActiveGroup();
    }
  }
  $('exit-cancel').addEventListener('click', closeExtraDialog);
  $('exit-accept').addEventListener('click', function () {
    closeExtraDialog(); cancelSwitch(); stop(); window.close();
  });
  function returnToSettings() {
    if (!settingsReturn || document.hidden || unloading) return false;
    $('settings-home').hidden = false; $(settingsReturn).focus(); return true;
  }
  function openSettings() {
    cancelSwitch(); setWatchMode(false); setPrimary(false);
    settingsReturn = null; playlistControls(playlistRunning);
    $('settings-home').hidden = false;
    ( $('manage-groups-button').disabled ? $('settings-speed') : $('manage-groups-button') ).focus();
  }
  function closeExtraDialog() {
    var panel = extraDialog(); if (!panel) return;
    panel.hidden = true;
    if (panel.id === 'exit-confirm') { if (exitReturn && exitReturn.isConnected && exitReturn.offsetParent) exitReturn.focus(); else focusSection(); exitReturn = null; }
    else if (panel.id === 'settings-home') { settingsReturn = null; setPrimary(false); $('nav-settings').focus(); }
    else if (panel.id === 'appearance-panel') returnToSettings();
    else if (panel.id === 'imdb-panel') { closeImdbPanel(); returnToSettings(); }
    else if (panel.id === 'category-picker') focusCategoryReturn();
    else if (panel.id === 'item-menu') closeItemMenu(true);
    else if (panel.id === 'rename-panel') closeRename();
    else if (panel.id === 'edit-confirm') { panel.hidden = false; if (editSession && editSession.origin === 'settings') $('edit-continue').click(); else $('edit-discard').click(); }
  }
  function renderAppearance() {
    document.body.dataset.theme = appearance.theme; document.body.dataset.layout = appearance.layout; document.body.dataset.controls = appearance.controls;
    Array.prototype.forEach.call($('appearance-panel').querySelectorAll('[data-layout], [data-controls], [data-theme-choice]'), function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice ? button.dataset.themeChoice === appearance.theme : button.dataset.layout ? button.dataset.layout === appearance.layout : button.dataset.controls === appearance.controls));
    });
    var shortcuts = $('category-shortcuts');
    if (appearance.layout === 'tabs') document.querySelector('.library-panel').appendChild(shortcuts);
    else $('groups-filter').after(shortcuts);
    renderCategories();
    requestAnimationFrame(applyPictureFit);
  }
  function renderCategories() {
    var live = activeSection === 'tv';
    var label = categories.find(function (item) { return item[0] === activeCategory; })[1];
    LGI18n.text($('groups-filter'), live ? (activeCategory === 'all' ? 'المجموعات ▾' : 'المجموعات: ' + label + ' ▾') : 'المجموعات');
    $('groups-filter').setAttribute('aria-haspopup', live ? 'dialog' : 'false');
    var shortcuts = $('category-shortcuts'); shortcuts.hidden = !live || appearance.layout === 'compact';
    shortcuts.replaceChildren();
    if (shortcuts.hidden) return;
    var choices = appearance.layout === 'tabs' ? categories.slice(0, 3).concat([['more', 'المزيد ▾']]) : categories;
    choices.forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; LGI18n.text(button, item[1]); button.dataset.category = item[0];
      var moreActive = item[0] === 'more' && !categories.slice(0, 3).some(function (choice) { return choice[0] === activeCategory; });
      if (moreActive) LGI18n.text(button, label + ' ▾');
      button.setAttribute('aria-pressed', String(item[0] === activeCategory || moreActive));
      button.addEventListener('click', function () { if (item[0] === 'more') openCategories(); else selectCategory(item[0]); });
      shortcuts.appendChild(button);
    });
  }
  function focusCategoryReturn() {
    var button = categoryReturn !== 'header' && !$('category-shortcuts').hidden ? $('category-shortcuts').querySelector('[data-category="' + categoryReturn + '"]') : null;
    (button || $('groups-filter')).focus();
  }
  function selectCategory(category) {
    if ($('category-shortcuts').contains(document.activeElement)) categoryReturn = document.activeElement.dataset.category;
    cancelSwitch(); categoryPositions[activeCategory] = { group: activeGroup, selected: selected };
    activeCategory = category; var position = categoryPositions[category];
    activeGroup = position ? position.group : ''; if (position) selected = position.selected;
    groupWindowStart = 0; channelWindowStart = 0; $('category-picker').hidden = true;
    renderGroups(); renderChannels(); saveViewState(false); focusCategoryReturn();
  }
  function openCategories() {
    if (activeSection !== 'tv') { var first = $('groups').querySelector('button'); if (first) first.focus(); return; }
    categoryReturn = $('category-shortcuts').contains(document.activeElement) ? document.activeElement.dataset.category : 'header';
    cancelSwitch(); $('category-list').replaceChildren();
    categories.forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; LGI18n.text(button, item[1]); button.dataset.category = item[0];
      button.setAttribute('aria-pressed', String(item[0] === activeCategory));
      button.addEventListener('click', function () { selectCategory(item[0]); }); $('category-list').appendChild(button);
    });
    $('category-picker').hidden = false; $('category-list').querySelector('[aria-pressed="true"]').focus();
  }
  function applyPictureFit() {
    var host = $('video-host'); var video = host.querySelector('video');
    if (!video) return;
    var mode = fitModes[fitIndex].value;
    var hostWidth = host.clientWidth; var hostHeight = host.clientHeight; var width = hostWidth; var height = hostHeight;
    var videoWidth = video.videoWidth; var videoHeight = video.videoHeight;
    if (videoWidth > 0 && videoHeight > 0 && hostWidth > 0 && hostHeight > 0) {
      // webOS ignores object-fit, so the element itself gets the source aspect ratio (uniform scale, centred).
      var fit = Math.min(hostWidth / videoWidth, hostHeight / videoHeight) * api.pictureScale(mode, videoWidth, videoHeight, hostWidth, hostHeight);
      width = videoWidth * fit; height = videoHeight * fit;
    }
    video.style.width = width + 'px'; video.style.height = height + 'px';
    video.style.left = ((hostWidth - width) / 2) + 'px'; video.style.top = ((hostHeight - height) / 2) + 'px';
  }
  function cyclePictureFit() {
    if (switchPending && playingIndex !== null) selected = playingIndex;
    cancelSwitch(); fitIndex = (fitIndex + 1) % fitModes.length;
    $('video-host').dataset.fit = fitModes[fitIndex].value;
    ['display-button', 'media-display'].forEach(function (id) { LGI18n.text($(id), 'ملاءمة العرض · ' + fitModes[fitIndex].label); });
    applyPictureFit();
  }
  window.addEventListener('resize', applyPictureFit);
  $('groups-filter').addEventListener('click', openCategories);
  ['close-settings', 'close-appearance', 'close-category', 'close-imdb'].forEach(function (id) { $(id).addEventListener('click', closeExtraDialog); });
  $('imdb-form').addEventListener('submit', function (event) { event.preventDefault(); saveImdbKey(); });
  $('imdb-remove').addEventListener('click', removeImdbKey);
  $('tmdb-form').addEventListener('submit', function (event) { event.preventDefault(); saveTmdbKey(); });
  $('tmdb-remove').addEventListener('click', removeTmdbKey);
  Array.prototype.forEach.call(document.querySelectorAll('[data-rating-source]'), function (button) {
    button.addEventListener('click', function () {
      ratingSource = button.dataset.ratingSource; try { localStorage.setItem('lg-stream-rating-source-v1', ratingSource); } catch (_) {}
      sortRevision += 1; renderImdbSettings();
      Array.prototype.forEach.call($('movie-grid').querySelectorAll('.movie-card'), function (card) { applyCardRating(card, Number(card.dataset.index)); });
      stopAllPrefetch(); scheduleAllPrefetch(30000);
    });
  });
  $('prefetch-toggle').addEventListener('click', function () {
    prefetchOn = !prefetchOn; try { localStorage.setItem('lg-stream-imdb-prefetch-v1', prefetchOn ? 'on' : 'off'); } catch (_) {}
    if (!prefetchOn) stopAllPrefetch(); else scheduleAllPrefetch(30000);
    renderImdbSettings();
  });
  loadRatings();
  renderImdbSettings();
  ['settings-speed', 'settings-info', 'settings-appearance', 'settings-imdb', 'manage-groups-button'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      settingsReturn = id; $('settings-home').hidden = true;
      if (id === 'settings-speed') openSpeed();
      else if (id === 'settings-info') openDiagnostics();
      else if (id === 'settings-imdb') { LGI18n.text($('imdb-status'), ''); renderImdbSettings(); $('imdb-panel').hidden = false; $('imdb-key').focus(); }
      else if (id === 'settings-appearance') { $('appearance-panel').hidden = false; $('appearance-panel').querySelector('[data-theme-choice="' + appearance.theme + '"]').focus(); }
    });
  });
  Array.prototype.forEach.call($('appearance-panel').querySelectorAll('[data-layout], [data-controls], [data-theme-choice]'), function (button) {
    button.addEventListener('click', function () {
      if (button.dataset.themeChoice) appearance.theme = button.dataset.themeChoice; else if (button.dataset.layout) appearance.layout = button.dataset.layout; else appearance.controls = button.dataset.controls;
      renderAppearance();
      try { localStorage.setItem('lg-stream-appearance-v1', JSON.stringify(appearance)); LGI18n.text($('appearance-status'), 'حُفظ المظهر. المشاهدة مستمرة.'); }
      catch (_) { LGI18n.text($('appearance-status'), 'تغيّر المظهر لهذه الجلسة؛ تعذر حفظ الاختيار.'); }
    });
  });
  ['display-button', 'media-display'].forEach(function (id) { $(id).addEventListener('click', cyclePictureFit); });
  $('display-fullscreen').addEventListener('click', function () {
    if (watchMode) { exitPlayback(); return; }
    setWatchMode(true);
  });
  try {
    var savedAppearance = JSON.parse(localStorage.getItem('lg-stream-appearance-v1') || 'null');
    if (savedAppearance && ['editorial', 'cinema'].indexOf(savedAppearance.theme) >= 0) appearance.theme = savedAppearance.theme;
    if (savedAppearance && ['compact', 'tabs', 'vertical'].indexOf(savedAppearance.layout) >= 0) appearance.layout = savedAppearance.layout;
    if (savedAppearance && ['compact', 'comfortable'].indexOf(savedAppearance.controls) >= 0) appearance.controls = savedAppearance.controls;
  } catch (_) {}
  renderAppearance();

  // ---- Customization: long-press menu, select, move, hide, rename. ----
  // Edits change the in-memory master order (displayOrder) and the
  // customization record only; playback is never restarted by them.
  var HOLD_MS = 4000; var RING_MS = 500; var REPEAT_GAP_MS = 450;
  var hold = null; var menuContext = null; var menuReturn = null; var selectState = null; var moveState = null; var renameIndex = null;
  var customSaving = Promise.resolve();
  function customizable() { return sourceMode === 'playlist' && !!activePlaylistUrl && !!displayOrder && !!entryKeys && sources.length > 0; }
  function holdTarget(element) {
    if (!element || watchMode || watchChannels !== null || !customizable()) return null;
    if (element.classList.contains('channel-button') && element.parentNode && element.parentNode.parentNode === $('channels') && activeSection !== 'favorites') return element;
    if (element.classList.contains('group-button') && element.parentNode === $('groups') && element.dataset.group && element.dataset.group !== NEW_GROUP && activeSection !== 'favorites') return element;
    return null;
  }
  function placeRing(target) {
    var ring = $('hold-ring'); var rect = target.getBoundingClientRect();
    ring.style.top = Math.round(rect.top + rect.height / 2 - 28) + 'px';
    ring.style.left = Math.round((document.documentElement.dir === 'ltr' ? rect.right - 64 : rect.left + 8)) + 'px';
  }
  function drawRing() {
    if (!hold) return;
    var fraction = Math.min(1, (performance.now() - hold.start - RING_MS) / (HOLD_MS - RING_MS));
    $('hold-progress').style.strokeDashoffset = String(119.4 * (1 - Math.max(0, fraction)));
    hold.frame = requestAnimationFrame(drawRing);
  }
  function startHold(target) {
    var now = performance.now();
    hold = { target: target, start: now, lastEvent: now, repeats: 0, ring: false, frame: null };
    hold.ringTimer = setTimeout(function () { if (!hold) return; hold.ring = true; placeRing(target); $('hold-progress').style.strokeDashoffset = '119.4'; $('hold-ring').hidden = false; drawRing(); }, RING_MS);
    hold.doneTimer = setTimeout(function () { var own = hold; if (own && own.pointer) pointerSwallowClick = true; endHold(); if (own) openItemMenu(own.target); }, HOLD_MS);
    // Release fallback when keyup is missing: auto-repeat stops.
    hold.watch = setInterval(function () {
      if (!hold) return; var idle = performance.now() - hold.lastEvent;
      if (hold.repeats && idle > REPEAT_GAP_MS) releaseHold();
    }, 100);
  }
  function endHold() {
    if (!hold) return;
    clearTimeout(hold.ringTimer); clearTimeout(hold.doneTimer); clearInterval(hold.watch); cancelAnimationFrame(hold.frame);
    $('hold-ring').hidden = true; hold = null;
  }
  function releaseHold() {
    if (!hold) return;
    var own = hold; var short = performance.now() - own.start < RING_MS && !own.ring; endHold();
    // A short press acts as OK; releasing while the ring shows cancels.
    if (short && own.target.isConnected) own.target.click();
  }
  // Magic Remote pointer: OK arrives as mouse events instead of keys. A press
  // held past the ring never becomes a click (no playback); a short one does.
  var pointerSwallowClick = false;
  document.addEventListener('mousedown', function (event) {
    pointerSwallowClick = false;
    if (event.button !== 0 || hold || selectState || moveState) return;
    var target = holdTarget(event.target && event.target.closest ? event.target.closest('.channel-button, .group-button') : null);
    if (!target) return;
    startHold(target); hold.pointer = true;
  }, true);
  document.addEventListener('mouseup', function () {
    if (hold && hold.pointer) { if (hold.ring) pointerSwallowClick = true; endHold(); }
  }, true);
  document.addEventListener('click', function (event) {
    if (!pointerSwallowClick) return;
    pointerSwallowClick = false; event.preventDefault(); event.stopPropagation();
  }, true);
  function showOrganizeStatus(text) {
    var status = $('organize-status'); LGI18n.text(status, text); status.hidden = false;
    clearTimeout(showOrganizeStatus.timer); showOrganizeStatus.timer = setTimeout(function () { status.hidden = true; }, 5000);
  }
  function itemName(target) {
    if (target.classList.contains('group-button')) return target.textContent;
    var index = Number(target.dataset.index); return sources[index] ? sources[index].name : '';
  }
  function openItemMenu(target) {
    if (!target || !target.isConnected || !customizable()) return;
    var channel = target.classList.contains('channel-button');
    menuContext = { kind: channel ? 'channel' : 'group', index: channel ? Number(target.dataset.index) : null, group: channel ? null : target.dataset.group };
    menuReturn = target; cancelSwitch();
    LGI18n.provider($('item-menu-title'), itemName(target), channel ? 'القناة' : 'المجموعة');
    $('menu-rename').hidden = !channel;
    $('item-menu').hidden = false; $('menu-select').focus();
  }
  function closeItemMenu(restoreFocus) {
    $('item-menu').hidden = true; menuContext = null;
    if (restoreFocus) returnToList();
  }
  function returnToList() {
    var target = menuReturn; menuReturn = null;
    if (target && target.isConnected && target.offsetParent) { target.focus(); return; }
    focusSelected();
  }
  // ---- Edit session: edits stay in memory until the owner confirms saving. ----
  // From the long-press menu one edit ends the session; from Settings the
  // owner keeps editing until Back, then chooses save, discard or continue.
  var editSession = null; var editReturn = null;
  function hiddenGroupsCopy() { var copy = {}; ['tv', 'movies', 'series'].forEach(function (own) { copy[own] = Array.from(hiddenGroups[own]); }); return copy; }
  function beginEdit(origin) {
    if (editSession) return;
    editSession = { origin: origin, dirty: false, groupsDirty: false, source: activePlaylistUrl, custom: JSON.parse(JSON.stringify(custom)), hiddenGroups: hiddenGroupsCopy() };
  }
  function endEditIfClean() { if (editSession && !editSession.dirty) editSession = null; }
  function editDone(kind, groups) {
    if (!editSession) beginEdit('menu');
    editSession.dirty = true; if (groups) editSession.groupsDirty = true;
    if (editSession.origin === 'settings') {
      enterSelect(kind); if (kind === 'group') focusActiveGroup(); else focusSelected();
      showOrganizeStatus('تم. تابع التعديل، أو اضغط رجوع للحفظ.');
    } else askSaveEdits();
  }
  function askSaveEdits() {
    editReturn = document.activeElement;
    $('edit-continue').hidden = !(editSession && editSession.origin === 'settings');
    $('edit-confirm').hidden = false; $('edit-save').focus();
  }
  function closeEditConfirm() {
    $('edit-confirm').hidden = true; var target = editReturn; editReturn = null;
    if (target && target.isConnected && target.offsetParent) target.focus(); else focusSelected();
  }
  function commitEdits() {
    var session = editSession; editSession = null;
    if (!session || !session.dirty || session.source !== activePlaylistUrl) return;
    var source = activePlaylistUrl;
    saveCustomization('حُفظت التغييرات.');
    if (session.groupsDirty) catalogStore.saveHiddenGroups(source, hiddenGroupsCopy()).then(function (result) {
      if (source === activePlaylistUrl && result.state !== 'complete') showOrganizeStatus('تغيّر العرض لهذه الجلسة؛ تعذر حفظ إخفاء المجموعات.');
    });
  }
  function discardEdits() {
    var session = editSession; editSession = null;
    if (!session || !session.dirty || session.source !== activePlaylistUrl) return;
    custom = session.custom; applyItemCustomization(); setHiddenGroups(session.hiddenGroups); rebuildOrder(); catalogViewRevision += 1; invalidateViews();
    renderGroups(); renderChannels();
    showOrganizeStatus('أُلغيت التغييرات وعاد كل شيء كما كان.');
  }
  function finishEditing(save) {
    closeEditConfirm();
    if (selectState) finishSelect();
    if (save) commitEdits(); else discardEdits();
  }
  $('edit-save').addEventListener('click', function () { finishEditing(true); });
  $('edit-discard').addEventListener('click', function () { finishEditing(false); });
  $('edit-continue').addEventListener('click', closeEditConfirm);
  function saveCustomization(message) {
    var source = activePlaylistUrl;
    var record = { key: 'customization', source: source, groupOrder: custom.groupOrder, channelOrder: custom.channelOrder, hidden: custom.hidden.slice(), names: Object.assign({}, custom.names) };
    catalogMeta.customization = record;
    customSaving = customSaving.then(function () { return catalogStore.saveMeta([record]); }).then(function (result) {
      if (source !== activePlaylistUrl) return;
      showOrganizeStatus(result.state === 'complete' ? message : 'تغيّر العرض لهذه الجلسة؛ تعذر حفظ التخصيص.');
    });
  }
  function invalidateViews() { sectionCacheKey = ''; visibleCacheKey = ''; lastSearch = null; searchLiveRevision = -1; }
  function rebuildSectionOrder(section) {
    var own = displayOrder[section]; var order = [];
    own.groups.forEach(function (group) { var members = own.byGroup.get(group) || []; for (var i = 0; i < members.length; i += 1) order.push(members[i]); });
    own.order = Int32Array.from(order); invalidateViews();
  }
  // ---- Multi-select ----
  function enterSelect(kind, first) {
    if (!customizable()) return;
    selectState = { kind: kind, items: new Set() }; if (first !== undefined && first !== null) selectState.items.add(first);
    document.body.classList.add('select-mode'); renderSelectBar(); renderGroups(); renderChannels();
  }
  function exitSelect() {
    if (!selectState) return;
    if (editSession && editSession.dirty) { askSaveEdits(); return; }
    editSession = null; finishSelect();
  }
  function finishSelect() {
    if (!selectState) return;
    var kind = selectState.kind; selectState = null; document.body.classList.remove('select-mode'); $('select-bar').hidden = true;
    renderGroups(); renderChannels();
    if (kind === 'group') focusActiveGroup(); else focusSelected();
  }
  function renderSelectBar() {
    if (!selectState) { $('select-bar').hidden = true; return; }
    $('select-bar').hidden = false;
    LGI18n.text($('select-count'), (selectState.kind === 'group' ? 'ترتيب المجموعات — المحدد: ' : 'ترتيب القنوات — المحدد: ') + selectState.items.size);
    $('select-move').disabled = !selectState.items.size; $('select-hide').disabled = !selectState.items.size;
  }
  function toggleSelected(target) {
    var key = selectState.kind === 'group' ? target.dataset.group : Number(target.dataset.index);
    if (selectState.items.has(key)) selectState.items.delete(key); else selectState.items.add(key);
    markSelected(target, selectState.items.has(key)); renderSelectBar();
  }
  function markSelected(element, on) { element.classList.toggle('is-selected', on); element.setAttribute('aria-checked', String(on)); }
  function selectedItems() {
    if (!selectState) return [];
    if (selectState.kind === 'group') { var order = displayOrder[activeSection] ? displayOrder[activeSection].groups : []; return order.filter(function (group) { return selectState.items.has(group); }); }
    var list = masterOrder(activeSection); var chosen = []; if (!list) return chosen;
    for (var i = 0; i < list.length; i += 1) if (selectState.items.has(list[i])) chosen.push(list[i]);
    return chosen;
  }
  // ---- Move ----
  function startMove(kind, items) {
    if (!customizable() || !items.length || !displayOrder[activeSection]) return;
    var section = activeSection; var own = displayOrder[section];
    if (kind === 'channel') {
      if (activeGroup === NEW_GROUP) { showOrganizeStatus('للنقل افتح مجموعة القناة نفسها أو «الكل».'); return; }
      var group = sources[items[0]].group || '';
      if (items.some(function (index) { return (sources[index].group || '') !== group; })) { showOrganizeStatus('للنقل حدد قنوات من مجموعة واحدة.'); return; }
      moveState = { kind: kind, section: section, items: items, group: group, snapshot: (own.byGroup.get(group) || []).slice() };
    } else moveState = { kind: kind, section: section, items: items, snapshot: own.groups.slice() };
    if (selectState) { selectState = null; document.body.classList.remove('select-mode'); $('select-bar').hidden = true; }
    document.body.classList.add('move-mode'); $('move-bar').hidden = false;
    LGI18n.text($('move-text'), 'نقل ' + items.length + (kind === 'group' ? ' مجموعة' : ' قناة') + ': ↑ ↓ للتحريك · موافق للحفظ · رجوع للإلغاء');
    if (kind === 'group') { activeGroup = items[0]; channelWindowStart = 0; }
    renderGroups(); renderChannels(); focusMoving();
  }
  function focusMoving() {
    if (!moveState) return;
    if (moveState.kind === 'group') {
      var groups = groupKeys(); var position = groups.indexOf(moveState.items[0]);
      if (position >= 0 && (position < groupWindowStart || position >= groupWindowStart + groupWindowSize)) { groupWindowStart = Math.max(0, position - 4); renderGroups(); }
      var button = Array.prototype.find.call($('groups').querySelectorAll('.group-button'), function (item) { return item.dataset.group === moveState.items[0]; });
      if (button) button.focus();
    } else { selected = moveState.items[0]; focusChannel(moveState.items[0]); }
  }
  function moveStep(direction) {
    var state = moveState; var own = displayOrder[state.section]; var block = new Set(state.items);
    var visible = state.kind === 'group' ? sectionGroups() : visibleIndexes();
    var positions = []; visible.forEach(function (item, position) { if (block.has(item)) positions.push(position); });
    if (!positions.length) return;
    var at = direction < 0 ? positions[0] - 1 : positions[positions.length - 1] + 1;
    while (at >= 0 && at < visible.length && block.has(visible[at])) at += direction;
    var neighbour = visible[at];
    if (neighbour === undefined || (state.kind === 'channel' && (sources[neighbour].group || '') !== state.group)) { showOrganizeStatus(direction < 0 ? 'وصلت إلى بداية القائمة.' : 'وصلت إلى نهاية القائمة.'); return; }
    var list = state.kind === 'group' ? own.groups : own.byGroup.get(state.group);
    var rest = list.filter(function (item) { return !block.has(item); });
    var next = api.moveBlock(list, state.items, rest.indexOf(neighbour) + (direction > 0 ? 1 : 0));
    if (state.kind === 'group') own.groups = next; else own.byGroup.set(state.group, next);
    rebuildSectionOrder(state.section);
    if (state.kind === 'group') { activeGroup = state.items[0]; renderGroups(); renderChannels(); }
    else renderChannels();
    focusMoving();
  }
  function finishMove(save) {
    var state = moveState; if (!state) return; moveState = null;
    document.body.classList.remove('move-mode'); $('move-bar').hidden = true;
    var own = displayOrder[state.section];
    if (!save) {
      if (state.kind === 'group') own.groups = state.snapshot; else own.byGroup.set(state.group, state.snapshot);
      rebuildSectionOrder(state.section); renderGroups(); renderChannels();
      showOrganizeStatus('أُلغي النقل.');
    } else {
      if (state.kind === 'group') custom.groupOrder[state.section] = own.groups.filter(function (group) { return group; });
      else custom.channelOrder[state.section + '\u0001' + state.group] = own.byGroup.get(state.group).map(function (index) { return entryKeys[index]; });
    }
    if (state.kind === 'group') { var button = Array.prototype.find.call($('groups').querySelectorAll('.group-button'), function (item) { return item.dataset.group === state.items[0]; }); if (button) button.focus(); else focusActiveGroup(); }
    else { selected = state.items[0]; focusChannel(state.items[0]); }
    if (save) editDone(state.kind, false);
    else if (editSession && editSession.origin === 'settings') { enterSelect(state.kind); if (state.kind === 'group') focusActiveGroup(); else focusSelected(); }
    else endEditIfClean();
  }
  // ---- Hide ----
  function hideItems(kind, items) {
    if (!customizable() || !items.length) return;
    if (kind === 'channel') {
      if (!hiddenFlags) hiddenFlags = new Uint8Array(sources.length);
      var known = new Set(custom.hidden);
      items.forEach(function (index) { hiddenFlags[index] = 1; if (!known.has(entryKeys[index])) { known.add(entryKeys[index]); custom.hidden.push(entryKeys[index]); } });
      invalidateViews(); renderGroups(); renderChannels(); focusSelected();
      editDone('channel', false);
      return;
    }
    var section = activeSection; var next = {};
    ['tv', 'movies', 'series'].forEach(function (own) { next[own] = Array.from(hiddenGroups[own]); });
    items.forEach(function (group) { if (next[section].indexOf(group) < 0) next[section].push(group); });
    setHiddenGroups(next); invalidateViews(); if (items.indexOf(activeGroup) >= 0) activeGroup = ''; renderGroups(); renderChannels(); focusActiveGroup();
    editDone('group', true);
  }
  // ---- Rename ----
  function openRename(index) {
    renameIndex = index; var entry = sources[index];
    var original = entry.originalName !== undefined ? entry.originalName : entry.name;
    LGI18n.provider($('rename-original'), original, '', null); $('rename-original').hidden = entry.originalName === undefined;
    if (!$('rename-original').hidden) LGI18n.provider($('rename-original'), 'الاسم الأصلي: ' + original, '');
    $('channel-name-input').value = entry.name; $('restore-channel-name').hidden = entry.originalName === undefined;
    $('rename-panel').hidden = false; $('save-channel-name').focus();
  }
  function closeRename() { $('rename-panel').hidden = true; $('channel-name-input').value = ''; renameIndex = null; returnToList(); endEditIfClean(); }
  function applyRename(index, name) {
    var entry = sources[index]; var key = entryKeys[index];
    if (name === null) { if (entry.originalName !== undefined) { entry.name = entry.originalName; delete entry.originalName; } delete custom.names[key]; }
    else { if (entry.originalName === undefined) entry.originalName = entry.name; entry.name = name; custom.names[key] = name; }
    catalogViewRevision += 1; invalidateViews(); renderChannels();
  }
  // ---- Reset ----
  function resetCustomization() {
    if (!customizable()) return;
    var source = activePlaylistUrl;
    custom = emptyCustomization(); applyItemCustomization(); setHiddenGroups(null); rebuildOrder(); catalogViewRevision += 1;
    catalogMeta.customization = null;
    Promise.all([catalogStore.saveMeta([], ['customization']), catalogStore.saveHiddenGroups(source, { tv: [], movies: [], series: [] })]).then(function (results) {
      if (source !== activePlaylistUrl) return;
      LGI18n.text($('manager-status'), results.every(function (result) { return result.state === 'complete'; }) ? 'أُعيد الضبط: ظهر كل شيء بترتيب المزود وأسمائه.' : 'أُعيد الضبط لهذه الجلسة؛ تعذر حفظه.');
    });
    renderGroups(); renderChannels(); collectManagedGroups(); renderManagedGroups();
  }
  $('menu-select').addEventListener('click', function () { var context = menuContext; closeItemMenu(true); if (context) { beginEdit('menu'); enterSelect(context.kind, context.kind === 'group' ? context.group : context.index); } });
  $('menu-move').addEventListener('click', function () { var context = menuContext; closeItemMenu(false); if (context) { beginEdit('menu'); startMove(context.kind, [context.kind === 'group' ? context.group : context.index]); if (!moveState) { endEditIfClean(); returnToList(); } } });
  $('menu-hide').addEventListener('click', function () { var context = menuContext; closeItemMenu(false); menuReturn = null; if (context) { beginEdit('menu'); hideItems(context.kind, [context.kind === 'group' ? context.group : context.index]); } });
  $('menu-rename').addEventListener('click', function () { var context = menuContext; closeItemMenu(false); if (context && context.kind === 'channel') { beginEdit('menu'); openRename(context.index); } });
  $('close-item-menu').addEventListener('click', function () { closeItemMenu(true); });
  $('select-move').addEventListener('click', function () { var kind = selectState && selectState.kind; var items = selectedItems(); if (kind && items.length) startMove(kind, items); });
  $('select-hide').addEventListener('click', function () { var kind = selectState && selectState.kind; var items = selectedItems(); if (!kind || !items.length) return; selectState = null; document.body.classList.remove('select-mode'); $('select-bar').hidden = true; hideItems(kind, items); });
  $('select-cancel').addEventListener('click', exitSelect);
  $('save-channel-name').addEventListener('click', function () {
    var index = renameIndex; if (index === null) return;
    var name = $('channel-name-input').value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
    var original = sources[index].originalName !== undefined ? sources[index].originalName : sources[index].name;
    var changed = (!name || name === original) ? sources[index].originalName !== undefined : name !== sources[index].name;
    applyRename(index, !name || name === original ? null : name); closeRename();
    if (changed) editDone('channel', false); else endEditIfClean();
  });
  $('restore-channel-name').addEventListener('click', function () { var index = renameIndex; if (index === null) return; applyRename(index, null); closeRename(); editDone('channel', false); });
  $('close-rename').addEventListener('click', closeRename);
  function leaveSettingsForOrganize(kind) {
    $('group-manager').hidden = true; managedGroups = []; $('managed-groups').replaceChildren(); settingsReturn = null; $('settings-home').hidden = true;
    if (managedSection !== 'hidden' && managedSection !== activeSection) { activeSection = managedSection; activeGroup = ''; activeCategory = 'all'; renderPrimary(); }
    beginEdit('settings');
    if (kind === 'group') { activeGroup = ''; renderGroups(); renderChannels(); enterSelect('group'); focusActiveGroup(); var first = $('groups').querySelector('.group-button:not([data-group=""]):not(.new-group)'); if (first) first.focus(); }
    else { renderGroups(); renderChannels(); enterSelect('channel'); focusSelected(); }
    showOrganizeStatus('موافق لتحديد العناصر، ثم اصعد لأعلى القائمة لاختيار نقل أو إخفاء. رجوع عند الانتهاء.');
  }
  $('organize-groups').addEventListener('click', function () { if (customizable()) leaveSettingsForOrganize('group'); });
  $('organize-channels').addEventListener('click', function () { if (customizable()) leaveSettingsForOrganize('channel'); });
  $('reset-customization').addEventListener('click', function () { $('reset-confirm').hidden = false; $('reset-confirm-no').focus(); });
  $('manage-visibility').addEventListener('click', function () { showManagerView(true); });
  $('reset-confirm-no').addEventListener('click', function () { $('reset-confirm').hidden = true; $('reset-customization').focus(); });
  $('reset-confirm-yes').addEventListener('click', function () { $('reset-confirm').hidden = true; resetCustomization(); $('reset-customization').focus(); });
  // webOS delivers OK as an instant press (no hold, no repeat), so the item
  // menu opens with the blue colour key; OK keeps playing immediately.
  var BLUE_KEY = 406; var blueTipKey = 'lg-stream-blue-tip-v1';
  var selectReturn = null;
  function returnFromSelectBar() {
    var target = selectReturn; selectReturn = null;
    if (target && target.isConnected && target.offsetParent) target.focus(); else if (selectState && selectState.kind === 'group') focusActiveGroup(); else focusSelected();
  }
  function updateBlueHint() {
    if (selectState && !watchMode) { LGI18n.text($('blue-hint-text'), 'الزر الأزرق: نقل أو إخفاء المحدد، أو إلغاء'); $('blue-hint').hidden = false; $('footer-note').hidden = true; return; }
    LGI18n.text($('blue-hint-text'), 'الزر الأزرق: خيارات (ترتيب، نقل، إعادة تسمية، إخفاء)');
    var show = !watchMode && !selectState && !moveState && !!holdTarget(document.activeElement);
    $('blue-hint').hidden = !show; $('footer-note').hidden = show;
    if (!show) return;
    var seen = false; try { seen = localStorage.getItem(blueTipKey) === '1'; localStorage.setItem(blueTipKey, '1'); } catch (_) { seen = updateBlueHint.shown; }
    if (!seen && !updateBlueHint.shown) showOrganizeStatus('جديد: اضغط الزر الأزرق على أي قناة أو مجموعة لترتيبها أو نقلها أو إخفائها.');
    updateBlueHint.shown = true;
  }
  document.addEventListener('focusin', updateBlueHint);
  // Returns true when the key was handled by a customization mode.
  function customizationKey(event, key, code) {
    if (hold) {
      if (key === 'Enter') { event.preventDefault(); hold.lastEvent = performance.now(); if (event.repeat) hold.repeats += 1; return true; }
      endHold();
    }
    if (moveState) {
      event.preventDefault();
      if (key === 'ArrowUp' || key === 'ArrowDown') moveStep(key === 'ArrowDown' ? 1 : -1);
      else if (key === 'Enter' && !event.repeat) finishMove(true);
      return true;
    }
    if (selectState) {
      var focused = document.activeElement;
      // Blue jumps between the list and the bar's actions, wherever the list is scrolled.
      if (code === BLUE_KEY) {
        event.preventDefault(); if (event.repeat) return true;
        if ($('select-bar').contains(focused)) returnFromSelectBar();
        else { selectReturn = focused; var actions = visibleControls($('select-bar')).filter(function (button) { return !button.disabled; }); (actions[0] || $('select-cancel')).focus(); }
        return true;
      }
      if ($('select-bar').contains(focused)) {
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          var bar = visibleControls($('select-bar')); var at = bar.indexOf(focused); var step = (key === 'ArrowLeft') === (document.documentElement.dir !== 'ltr') ? 1 : -1;
          if (bar[at + step]) bar[at + step].focus(); event.preventDefault(); return true;
        }
        if (key === 'ArrowDown') { event.preventDefault(); returnFromSelectBar(); return true; }
        return false;
      }
      var kindMatches = selectState.kind === 'group' ? focused.classList.contains('group-button') && focused.parentNode === $('groups') : focused.classList.contains('channel-button');
      if (key === 'Enter') {
        event.preventDefault();
        if (!event.repeat && kindMatches && (selectState.kind !== 'group' || (focused.dataset.group && focused.dataset.group !== NEW_GROUP))) toggleSelected(focused);
        return true;
      }
      if (key === 'ArrowUp' && kindMatches) {
        var first = selectState.kind === 'group' ? groupKeys().indexOf(focused.dataset.group) <= (sectionIndex().fresh.length ? 2 : 1) : visibleIndexes().indexOf(Number(focused.dataset.index)) === 0;
        if (first) { event.preventDefault(); (visibleControls($('select-bar'))[0] || $('select-cancel')).focus(); return true; }
      }
      return false;
    }
    if (code === BLUE_KEY) {
      if (event.repeat || watchMode) return false;
      event.preventDefault();
      var target = holdTarget(document.activeElement);
      if (target) openItemMenu(target);
      else showOrganizeStatus('الزر الأزرق يفتح خيارات القناة أو المجموعة المحددة في القائمة.');
      return true;
    }
    return false;
  }
  function visibleControls(container) {
    return Array.prototype.filter.call(container.querySelectorAll('button,input,select'), function (item) {
      return !item.disabled && item.offsetParent !== null;
    });
  }
  // Rank only controls in the pressed direction; aligned controls win.
  // This keeps RTL rows and the vertical channel list consistent with the screen.
  function moveFocus(container, key) {
    var controls = visibleControls(container);
    var current = document.activeElement;
    if (controls.indexOf(current) < 0) { if (controls.length) controls[0].focus(); return; }
    var origin = current.getBoundingClientRect();
    var horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    var sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    var best = null; var score = Infinity;
    controls.forEach(function (item) {
      if (item === current) return;
      var rect = item.getBoundingClientRect();
      var dx = (rect.left + rect.right - origin.left - origin.right) / 2;
      var dy = (rect.top + rect.bottom - origin.top - origin.bottom) / 2;
      var forward = (horizontal ? dx : dy) * sign;
      if (forward <= 1) return;
      var aligned = horizontal ? rect.top < origin.bottom && rect.bottom > origin.top : rect.left < origin.right && rect.right > origin.left;
      // Vertical moves prefer the nearest row; horizontal moves the nearest column.
      var distance = (horizontal ? forward + Math.abs(dy) * 3 : forward * 4 + Math.abs(dx)) + (aligned ? 0 : 10000);
      if (distance < score) { score = distance; best = item; }
    });
    if (best) best.focus();
  }
  // LG documents this event from webOS 3.0. Never move focus merely because
  // it disappears: voice input also hides the keyboard temporarily.
  document.addEventListener('keyboardStateChange', function (event) {
    keyboardVisible = !!(event.detail && event.detail.visibility);
  });
  document.addEventListener('click', noteUserActivity, true);
  document.addEventListener('wheel', noteUserActivity, { capture: true, passive: true });
  document.addEventListener('pointermove', noteUserActivity, { capture: true, passive: true });
  document.addEventListener('keydown', function (event) {
    noteUserActivity();
    var code = event.keyCode;
    var key = event.key;
    if (!key || key === 'Unidentified') key = { 13: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' }[code];
    var isInput = event.target.tagName === 'INPUT';
    if (isInput && keyboardVisible) return;
    var anyDialog = !$('track-picker').hidden || !$('group-manager').hidden || !$('sort-menu').hidden || !detailsPanel.hidden || !setup.hidden || !searchPanel.hidden || !diagnostics.hidden || !speedPanel.hidden || !!extraDialog();
    var backKey = code === 461 || key === 'Escape';
    if (!backKey && !anyDialog && !isInput && customizationKey(event, key, code)) return;
    if (key === 'Enter' && event.repeat && !isInput) { event.preventDefault(); return; }
    var back = code === 461 || key === 'Escape';
    if (back) {
      event.preventDefault();
      if (hold) endHold();
      if (event.repeat) return;
      if (switchPending && playingIndex !== null) selected = playingIndex;
      cancelSwitch();
      if (watchChannels !== null) { closeWatchChannels(); exitPlayback(); focusActiveGroup(); return; }
      if (!$('track-picker').hidden) { closeTrackPicker(true); return; }
      if (!$('group-manager').hidden) { closeGroupManager(); return; }
      if (!$('sort-menu').hidden) { $('sort-menu').hidden = true; $('sort-button').setAttribute('aria-expanded', 'false'); $('sort-button').focus(); }
      else if (!detailsPanel.hidden) closeDetails();
      else if (!setup.hidden) { if (!setupBack()) closeSetup(); }
      else if (!searchPanel.hidden) closeSearch();
      else if (!diagnostics.hidden) closeDiagnostics();
      else if (!speedPanel.hidden) closeSpeed();
      else if (extraDialog()) closeExtraDialog();
      else if (moveState) finishMove(false);
      else if (selectState) { if ($('select-bar').contains(document.activeElement)) exitSelect(); else { selectReturn = document.activeElement; var barActions = visibleControls($('select-bar')).filter(function (button) { return !button.disabled; }); (barActions[0] || $('select-cancel')).focus(); } }
      else if (watchMode) { if (!$('media-controls').hidden) { cancelSeek(); $('media-controls').hidden = true; document.body.focus(); } else exitPlayback(); }
      else backToLibrary();
      return;
    }
    if (!$('track-picker').hidden) {
      var trackButtons = visibleControls($('track-picker')); var trackPosition = trackButtons.indexOf(document.activeElement);
      if (code === 413) { event.preventDefault(); stop(); focusSelected(); }
      else if (code === 19) { event.preventDefault(); player.pause(); }
      else if (code === 415) { event.preventDefault(); player.resume(); }
      else if (code === 10252) { event.preventDefault(); player.toggle(); }
      else if (key === 'Enter') { event.preventDefault(); if (!event.repeat && trackPosition >= 0) trackButtons[trackPosition].click(); }
      else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Tab') {
        var step = key === 'ArrowUp' || (key === 'Tab' && event.shiftKey) ? -1 : 1;
        trackButtons[Math.max(0, Math.min(trackButtons.length - 1, trackPosition + step))].focus(); event.preventDefault();
      } else if (/^Arrow/.test(key) || [33, 34, 427, 428].indexOf(code) >= 0) event.preventDefault();
      return;
    }
    var dialog = !$('group-manager').hidden ? $('group-manager') : !$('sort-menu').hidden ? $('sort-menu') : !detailsPanel.hidden ? detailsPanel : !setup.hidden ? setup : !searchPanel.hidden ? searchPanel : !diagnostics.hidden ? diagnostics : !speedPanel.hidden ? speedPanel : extraDialog();
    if (dialog) {
      if (key === 'Enter' && event.repeat && !isInput) { event.preventDefault(); return; }
      if (dialog === $('group-manager') && key === 'ArrowUp' && document.activeElement === $('close-group-manager') && !$('manager-visibility').hidden) {
        if (managedGroups.length) focusManagedGroup(managedGroups.length - 1);
        else dialog.querySelector('[data-manage-section="' + managedSection + '"]').focus();
        event.preventDefault(); return;
      }
      if (dialog === $('group-manager') && document.activeElement.classList.contains('group-switch') && (key === 'ArrowUp' || key === 'ArrowDown')) {
        event.preventDefault();
        var position = Number(document.activeElement.dataset.position);
        if (key === 'ArrowUp' && position === 0) $('group-manager').querySelector('[data-manage-section="' + managedSection + '"]').focus();
        else if (key === 'ArrowDown' && position === managedGroups.length - 1) $('close-group-manager').focus();
        else focusManagedGroup(position + (key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (key === 'Tab') {
        var controls = visibleControls(dialog);
        var position = controls.indexOf(document.activeElement);
        if (controls.length) controls[(position + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
        event.preventDefault(); return;
      }
      // Keep native text editing and the TV keyboard intact.
      if (isInput && key !== 'ArrowUp' && key !== 'ArrowDown') return;
      if (/^Arrow/.test(key)) { moveFocus(dialog, key); event.preventDefault(); }
      return;
    }
    if (document.activeElement.closest && document.activeElement.closest('.header-actions')) {
      var headerButtons = visibleControls(document.querySelector('.header-actions'));
      var headerPosition = headerButtons.indexOf(document.activeElement);
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        var headerNext = headerPosition + (key === 'ArrowRight' ? 1 : -1);
        if (headerButtons[headerNext]) headerButtons[headerNext].focus();
        event.preventDefault(); return;
      }
      if (key === 'ArrowDown') { setPrimary(true); $('nav-search').focus(); event.preventDefault(); return; }
    }
    if (key === 'ArrowUp' && document.activeElement.closest && document.activeElement.closest('.primary-panel') && (appearance.theme === 'editorial' || document.activeElement === $('nav-search'))) {
      $('nav-settings').focus(); event.preventDefault(); return;
    }
    if (appearance.theme === 'editorial' && document.activeElement.closest && document.activeElement.closest('.primary-panel')) {
      var mainButtons = visibleControls(document.querySelector('.primary-panel'));
      var mainPosition = mainButtons.indexOf(document.activeElement);
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        var mainNext = mainPosition + (key === 'ArrowRight' ? 1 : -1);
        if (mainButtons[mainNext]) mainButtons[mainNext].focus();
        event.preventDefault(); return;
      }
      if (key === 'ArrowDown') {
        var chosenGroup = $('groups').querySelector('.group-button.active') || $('groups').querySelector('button');
        if (chosenGroup) chosenGroup.focus(); else focusSelected();
        event.preventDefault(); return;
      }
    }
    if (watchChannels !== null) {
      if (key === 'Enter') { event.preventDefault(); if (document.activeElement.classList.contains('channel-button')) document.activeElement.click(); return; }
      if (key === 'ArrowUp' || key === 'ArrowDown') { moveChannelWindow(key === 'ArrowDown' ? 1 : -1); event.preventDefault(); return; }
      if (key === 'ArrowRight') { showPlaybackControls(); event.preventDefault(); return; }
      if (key === 'ArrowLeft' || key === 'Tab' || [33, 34, 427, 428].indexOf(code) >= 0 || key === 'PageUp' || key === 'PageDown') { event.preventDefault(); return; }
    }
    if (watchMode && $('media-controls').hidden && key === 'Enter') { showWatchChannels(); event.preventDefault(); return; }
    if (watchMode && $('media-controls').hidden && playingIndex !== null && entrySection(playingIndex) === 'tv' && (key === 'ArrowUp' || key === 'ArrowDown')) {
      var liveIndexes = visibleIndexes();
      var livePosition = liveIndexes.indexOf(switchPending ? selected : playingIndex);
      if (livePosition < 0) { showPlaybackControls(); event.preventDefault(); return; }
      var nextPosition = livePosition + (key === 'ArrowDown' ? 1 : -1);
      while (nextPosition >= 0 && nextPosition < liveIndexes.length && entrySection(liveIndexes[nextPosition]) !== 'tv') nextPosition += key === 'ArrowDown' ? 1 : -1;
      if (livePosition >= 0 && nextPosition >= 0 && nextPosition < liveIndexes.length) {
        selected = liveIndexes[nextPosition];
        requestChannel(selected, true);
      }
      event.preventDefault(); return;
    }
    if (watchMode && !$('media-controls').hidden && /^Arrow/.test(key)) {
      var media = $('media-controls'); var current = document.activeElement;
      var seekRow = [$('seek-back'), $('seek-position'), $('seek-forward')].filter(function (button) { return !button.disabled && button.offsetParent; });
      var seekIndex = seekRow.indexOf(current);
      if (seekIndex >= 0) {
        if (current === $('seek-position') && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          var increment = Math.max(10, Math.round(Number(current.max) / 100 / 10) * 10);
          queueSeek(Math.max(0, Math.min(Number(current.max), Number(current.value) + (key === 'ArrowRight' ? increment : -increment))));
          event.preventDefault(); return;
        }
        if (key === 'ArrowDown' && current !== $('seek-position')) $('media-toggle').focus();
        else if (key === 'ArrowUp' && current === $('seek-position')) $('seek-back').focus();
        else if (key === 'ArrowDown' && current === $('seek-position')) $('seek-forward').focus();
        else if (key === 'ArrowLeft' || key === 'ArrowRight') seekRow[Math.max(0, Math.min(seekRow.length - 1, seekIndex + (key === 'ArrowRight' ? 1 : -1)))].focus();
      } else if (key === 'ArrowUp' && seekRow.length) $('seek-position').focus();
      else moveFocus(media, key);
      event.preventDefault(); return;
    }
    if ($('category-shortcuts').contains(document.activeElement) && /^Arrow/.test(key)) {
      var categoryButtons = visibleControls($('category-shortcuts'));
      var categoryPosition = categoryButtons.indexOf(document.activeElement);
      if (appearance.layout === 'vertical' && (key === 'ArrowUp' || key === 'ArrowDown')) {
        var nextCategory = categoryPosition + (key === 'ArrowDown' ? 1 : -1);
        var categoryTarget = nextCategory < 0 ? $('groups-filter') : nextCategory >= categoryButtons.length ? $('groups').querySelector('button') : categoryButtons[nextCategory];
        if (categoryTarget) categoryTarget.focus(); event.preventDefault(); return;
      }
      if (appearance.layout === 'tabs' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        var nextTab = categoryPosition + (key === 'ArrowLeft' ? 1 : -1);
        if (nextTab >= categoryButtons.length) { setPrimary(true); (document.querySelector('.primary-button.active') || $('nav-search')).focus(); }
        else if (nextTab >= 0) categoryButtons[nextTab].focus();
        event.preventDefault(); return;
      }
      if (appearance.layout === 'tabs' && key === 'ArrowDown') { $('groups-filter').focus(); event.preventDefault(); return; }
      if (appearance.layout === 'vertical' && key === 'ArrowRight') { focusSelected(); event.preventDefault(); return; }
    }
    if (document.activeElement === $('groups-filter') && key === 'ArrowUp' && appearance.layout === 'tabs' && !$('category-shortcuts').hidden) {
      $('category-shortcuts').lastElementChild.focus(); event.preventDefault(); return;
    }
    if (document.activeElement === $('groups-filter') && key === 'ArrowDown') {
      var firstGroup = appearance.layout === 'vertical' && !$('category-shortcuts').hidden ? $('category-shortcuts').querySelector('button') : $('groups').querySelector('button');
      if (firstGroup) firstGroup.focus(); event.preventDefault(); return;
    }
    if (isInput && key !== 'ArrowUp' && key !== 'ArrowDown') return;
    // Up stops at the sort button above movie/series cards; Back or the groups side leaves them.
    if (key === 'ArrowUp' && document.activeElement === $('sort-button') && (activeSection === 'movies' || activeSection === 'series')) { event.preventDefault(); return; }
    if ((key === 'ArrowDown' && (moveChannelWindow(1) || moveContentWindow(4) || moveGroupFocus(1))) || (key === 'ArrowUp' && (moveChannelWindow(-1) || moveContentWindow(-4) || moveGroupFocus(-1)))) { event.preventDefault(); return; }
    if (watchMode && !$('media-controls').hidden && key === 'Enter' && $('media-controls').contains(document.activeElement)) {
      if (event.repeat && (document.activeElement.id === 'audio-language' || document.activeElement.id === 'subtitle-language' || document.activeElement.id === 'media-display')) event.preventDefault();
      return;
    }
    if (watchMode && (key === 'Enter' || key === 'Tab' || /^Arrow/.test(key))) {
      if ($('media-controls').hidden) showPlaybackControls(); else if (key === 'Tab') { var mediaButtons = visibleControls($('media-controls')); var mediaPosition = mediaButtons.indexOf(document.activeElement); mediaButtons[(mediaPosition + (event.shiftKey ? -1 : 1) + mediaButtons.length) % mediaButtons.length].focus(); } else if (/^Arrow/.test(key)) moveFocus($('media-controls'), key);
      event.preventDefault(); return;
    }
    if ((code === 33 || code === 34 || code === 427 || code === 428 || key === 'PageUp' || key === 'PageDown') && sources.length) {
      if (isOnDemand() || activeSection === 'movies' || activeSection === 'series') { event.preventDefault(); return; }
      var indexes = visibleIndexes();
      if (!indexes.length) return;
      var position = indexes.indexOf(watchMode && !switchPending ? playingIndex : selected);
      if (position < 0) position = 0;
      var step = code === 33 || code === 427 || key === 'PageUp' ? 1 : -1;
      var next = (position + step + indexes.length) % indexes.length;
      while (next !== position && entrySection(indexes[next]) !== 'tv') next = (next + step + indexes.length) % indexes.length;
      if (entrySection(indexes[next]) !== 'tv') { event.preventDefault(); return; }
      selected = indexes[next];
      if (!watchMode) focusSelected();
      requestChannel(selected, true); event.preventDefault(); return;
    }
    if (code === 19) { cancelSwitch(); player.pause(); event.preventDefault(); return; }
    if (code === 415) { cancelSwitch(); player.resume(); event.preventDefault(); return; }
    if (code === 413) { stop(); focusSelected(); event.preventDefault(); return; }
    if (key === ' ' || code === 10252) { cancelSwitch(); player.toggle(); event.preventDefault(); return; }
    if (key === 'ArrowDown' && document.activeElement === $('sort-button')) { focusSelected(); event.preventDefault(); return; }
    var contentDirection = document.documentElement.dir === 'ltr' ? -1 : 1;
    if ((key === 'ArrowLeft' && moveContentWindow(contentDirection)) || (key === 'ArrowRight' && moveContentWindow(-contentDirection))) { event.preventDefault(); return; }
    if (key === 'ArrowLeft' && document.activeElement.closest && document.activeElement.closest('.channels-panel')) {
      if (document.activeElement.classList.contains('channel-button')) { document.activeElement.parentNode.querySelector('.favorite-button').focus(); event.preventDefault(); return; }
      var groupButton = $('groups').querySelector('.group-button.active');
      if (groupButton) groupButton.focus(); event.preventDefault(); return;
    }
    if (key === 'ArrowRight' && document.activeElement.classList.contains('favorite-button')) { document.activeElement.parentNode.querySelector('.channel-button').focus(); event.preventDefault(); return; }
    if (key === 'ArrowRight' && document.activeElement.classList.contains('group-button')) {
      focusSelected(); event.preventDefault(); return;
    }
    if (key === 'ArrowRight' && document.activeElement.closest && document.activeElement.closest('.primary-panel')) {
      setPrimary(false); var activeGroupButton = $('groups').querySelector('.group-button.active') || $('groups').querySelector('button');
      if (activeGroupButton) activeGroupButton.focus(); event.preventDefault(); return;
    }
    if (key === 'ArrowLeft' && document.activeElement.closest && document.activeElement.closest('.groups-panel') && !document.querySelector('.library-panel').classList.contains('primary-open')) {
      setPrimary(true); (document.querySelector('.primary-button.active') || $('nav-search')).focus(); event.preventDefault(); return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      moveFocus(document.querySelector('.shell'), key);
      event.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { ['exit-confirm', 'settings-home', 'appearance-panel', 'category-picker'].forEach(function (id) { $(id).hidden = true; }); exitReturn = null; settingsReturn = null; $('group-manager').hidden = true; managedGroups = []; $('managed-groups').replaceChildren(); cancelSpeed(); if (playlistAutomatic) { autoNextAttemptAt = Date.now() + 5 * 60 * 1000; cancelPlaylist(); } stop(); if (!setup.hidden) closeSetup(); }
    else if (!speedPanel.hidden) $('speed-wired').focus();
    else if (!detailsPanel.hidden) $('details-trailer').focus();
    else if (setup.hidden && diagnostics.hidden) focusSelected();
    if (!document.hidden) { restoreRetryAt = 0; scheduleAutoUpdate(); }
  });
  window.addEventListener('pageshow', function () { unloading = false; restoreRetryAt = 0; scheduleAutoUpdate(); });
  window.addEventListener('pagehide', function () {
    unloading = true; ['exit-confirm', 'settings-home', 'appearance-panel', 'category-picker'].forEach(function (id) { $(id).hidden = true; }); exitReturn = null; settingsReturn = null; clearTimeout(viewTimer); saveViewState(detailsIndex !== null); cancelPlaylist(); cancelSpeed(); speedResults = []; $('speed-results').replaceChildren(); stop();
    if (!automaticReleasedView && sourceMode === 'playlist' && sources.length) automaticReleasedView = captureRuntimeView();
    catalogViewRevision += 1; favoritesRevision += 1; sources = []; clearCatalogMeta(); favorites = {}; activeGroup = ''; activeSection = 'tv'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
    $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
  });
  var restoreGeneration = sourceGeneration;
  renderPrimary(); renderGroups(); renderChannels(); $('start-button').focus();
  Promise.all([catalogStore.load(), catalogStore.loadMeta(['sources', 'customization', 'known-keys', 'new-keys'])]).then(function (loaded) {
    var saved = loaded[0]; var records = loaded[1].records || {};
    catalogMeta = { customization: records.customization, knownKeys: records['known-keys'], newKeys: records['new-keys'] };
    if (records.sources && Array.isArray(records.sources.list)) {
      sourceList = records.sources.list.filter(function (item) { return item && typeof item.id === 'string' && typeof item.url === 'string'; }).map(function (item) { return { id: item.id, name: typeof item.name === 'string' && item.name.trim() ? item.name : DEFAULT_SOURCE_NAME, url: item.url, addedAt: item.addedAt || 0 }; });
      activeSourceId = sourceList.some(function (item) { return item.id === records.sources.activeId; }) ? records.sources.activeId : null;
    } else if (saved.state === 'complete') {
      // Catalogues saved before 0.9 become the named main source.
      sourceList = [{ id: 's1', name: DEFAULT_SOURCE_NAME, url: saved.source, addedAt: saved.savedAt || 0 }]; activeSourceId = 's1'; saveSources();
    }
    sourcesLoaded = true;
    if (restoreGeneration !== sourceGeneration || unloading) return;
    var activeSource = currentSource();
    if (saved.state === 'complete' && !(activeSource && activeSource.id === activeSourceId && activeSource.url === saved.source)) { renderSourceCard(); LGI18n.text($('status'), 'المصدر متوقف — فعّله من «مصادر البث»'); return; }
    if (saved.state === 'complete') {
      applyCatalog(saved.entries, saved.source, saved.revision, saved.savedAt, true, saved.hiddenGroups, saved.liveTransport);
      // First start after the upgrade: remember today's items so the next
      // refresh can tell which ones are new.
      if (!(catalogMeta.knownKeys && catalogMeta.knownKeys.source === saved.source) && entryKeys) {
        catalogMeta.knownKeys = { key: 'known-keys', source: saved.source, keys: api.sortedKeys(entryKeys) };
        catalogStore.saveMeta([catalogMeta.knownKeys]);
      }
      if (!document.hidden && !extraDialog() && setup.hidden && searchPanel.hidden && speedPanel.hidden && diagnostics.hidden) { if (pendingViewState && pendingViewState.detailsOpen && sources[selected] && entryVisible(selected)) openDetails(selected); else focusSelected(); }
      scheduleAutoUpdate();
    } else if (saved.state !== 'empty') {
      LGI18n.text($('status'), 'تعذر استعادة القائمة المحفوظة — أعد فتح التطبيق للمحاولة مجددًا.');
      LGI18n.text($('saved-catalog-status'), 'تعذرت قراءة القائمة المحفوظة. لم تُحذف بياناتها؛ أعد فتح التطبيق أو حمّل القائمة من جديد.');
    }
  });
}());
