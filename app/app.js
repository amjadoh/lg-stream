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
  var displayReturn = null;
  var categoryReturn = 'header';
  var activeGroup = '';
  var activeSection = 'tv';
  var sourceMode = 'manual';
  var liveTransport = 'original';
  var transportSaving = false;
  var selected = 0;
  var contentSort = 'provider';
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
  var fitIndex = 0;
  var fitModes = [{ value: 'contain', label: 'ملائم' }, { value: 'cover', label: 'ملء' }, { value: 'fill', label: 'تمديد' }];
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
  var searchTimer = null;
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
    'startup-timeout': 'انتهت مهلة بدء البث — اضغط إعادة المحاولة'
  };
  function finishLaunch() { var splash = $('launch-splash'); if (splash) splash.remove(); }
  $('launch-splash').addEventListener('animationend', function (event) { if (event.animationName === 'launchExit') finishLaunch(); });
  setTimeout(finishLaunch, 1900);
  function entrySection(index) {
    var url = sources[index] && sources[index].url || '';
    if (/\/series\//i.test(url)) return 'series';
    if (/\/movie\//i.test(url)) return 'movies';
    return 'tv';
  }
  function sectionIndex() {
    var cacheKey = [catalogViewRevision, activeSection === 'favorites' ? favoritesRevision : 0, activeSection, activeCategory].join('\u0001');
    if (cacheKey === sectionCacheKey) return sectionCache;
    var groupCategories = new Map();
    function matchesCategory(entry) {
      var category = api.channelCategory(entry.name);
      if (category) return category === activeCategory;
      var group = entry.group;
      if (!groupCategories.has(group)) groupCategories.set(group, api.groupCategory(group));
      return groupCategories.get(group) === activeCategory;
    }
    sectionCache = api.buildSectionIndex(sources, function (entry, index) {
      return entryVisible(index) && (activeSection === 'favorites' ? favorites[index] : entrySection(index) === activeSection) && (activeSection !== 'tv' || activeCategory === 'all' || matchesCategory(entry));
    });
    sectionCache.orderedGroups = api.orderedCatalogGroups(sectionCache.groups);
    sectionCache.groupLabels = api.groupDisplayNames(sectionCache.groups);
    sectionCacheKey = cacheKey; return sectionCache;
  }
  function visibleIndexes() {
    if (watchChannels !== null) return watchChannels;
    var cacheKey = [catalogViewRevision, activeSection === 'favorites' ? favoritesRevision : 0, activeSection, activeGroup, activeCategory, contentSort].join('\u0001');
    if (cacheKey === visibleCacheKey) return visibleCache;
    var ownSection = sectionIndex();
    var indexes = activeGroup ? (ownSection.byGroup[activeGroup] || []) : ownSection.all;
    if ((activeSection === 'movies' || activeSection === 'series') && contentSort !== 'provider') {
      indexes = indexes.slice();
      indexes.sort(function (left, right) {
        var a = sources[left] || {}; var b = sources[right] || {}; var av; var bv;
        if (contentSort === 'alpha') return (nameCollator ? nameCollator.compare(a.name || '', b.name || '') : (a.name || '').localeCompare(b.name || '')) || left - right;
        if (contentSort === 'year') { av = Number(a.year) || null; bv = Number(b.year) || null; }
        if (contentSort === 'rating') { av = Number(a.rating) || null; bv = Number(b.rating) || null; }
        if (contentSort === 'added') { av = Number(a.added) || Date.parse(a.added) || null; bv = Number(b.added) || Date.parse(b.added) || null; }
        if (av === null && bv === null) return left - right;
        if (av === null) return 1; if (bv === null) return -1;
        return bv - av || left - right;
      });
    }
    visibleCacheKey = cacheKey; visibleCache = indexes; return indexes;
  }
  function contentMaxStart(length) { return Math.max(0, Math.ceil(Math.max(0, length - contentWindowSize) / 4) * 4); }
  function setPrimary(open) {
    document.querySelector('.library-panel').classList.toggle('primary-open', open);
  }
  function closeSearch() {
    clearTimeout(searchTimer); searchTimer = null;
    searchPanel.hidden = true; $('channel-search').value = ''; $('search-results').replaceChildren(); LGI18n.text($('search-status'), 'اكتب حرفين على الأقل.');
    setPrimary(false); var group = $('groups').querySelector('.group-button.active') || $('groups').querySelector('button'); if (group) group.focus();
  }
  function renderSearch() {
    var query = $('channel-search').value.trim().toLocaleLowerCase(); $('search-results').replaceChildren();
    if (query.length < 2) { LGI18n.text($('search-status'), 'اكتب حرفين على الأقل.'); return; }
    var sections = [['tv', 'البث المباشر'], ['movies', 'الأفلام'], ['series', 'المسلسلات']]; var total = 0;
    var results = api.searchCatalog(sources, query, function (index) { return entryVisible(index) ? entrySection(index) : null; }, 12);
    sections.forEach(function (section) {
      var matches = results.matches[section[0]]; var count = results.counts[section[0]];
      total += count;
      var box = document.createElement('section'); box.className = 'search-section';
      var title = document.createElement('h3'); LGI18n.text(title, section[1] + ' (' + count + ')'); box.appendChild(title);
      matches.forEach(function (index) {
        var button = document.createElement('button'); button.type = 'button'; LGI18n.provider(button, sources[index].name, 'عنصر', arabicChannelName(index));
        button.addEventListener('click', function () { closeSearch(); if (section[0] !== 'tv') stop(); activeCategory = 'all'; activeSection = section[0]; activeGroup = sources[index].group || ''; renderPrimary(); renderGroups(); renderChannels(); if (section[0] === 'tv') activateChannel(index); else openDetails(index); });
        box.appendChild(button);
      });
      $('search-results').appendChild(box);
    });
    LGI18n.text($('search-status'), total ? 'وُجد ' + total + ' نتيجة. تظهر أول 12 نتيجة في كل قسم.' : 'لا توجد نتائج.');
  }
  function openSearch() { cancelSwitch(); setPrimary(false); searchPanel.hidden = false; renderSearch(); $('channel-search').focus(); }
  function renderPrimary() {
    document.querySelector('.library-panel').classList.toggle('content-mode', activeSection === 'movies' || activeSection === 'series');
    Array.prototype.forEach.call(document.querySelectorAll('.primary-button'), function (button) {
      button.classList.toggle('active', button.dataset.section === activeSection);
    });
  }
  function saveViewState(detailsOpen) {
    if (!activeCatalogRevision || !sources.length) return;
    try {
      // Persist the provider-order index so existing saved views survive display reordering.
      localStorage.setItem(VIEW_KEY, JSON.stringify({ revision: activeCatalogRevision, section: activeSection, category: activeCategory, filterVersion: 2, groupIndex: sectionIndex().groups.indexOf(activeGroup), sort: contentSort, selected: selected, favorites: Object.keys(favorites).map(Number), channelWindowStart: watchChannels === null ? channelWindowStart : watchChannelsWindow, contentWindowStart: contentWindowStart, groupScrollTop: $('groups').scrollTop, channelScrollTop: $('channels').scrollTop, contentScrollTop: $('movie-browser').scrollTop, detailsOpen: !!detailsOpen }));
    } catch (_) {}
  }
  function scheduleViewSave() { if (unloading) return; clearTimeout(viewTimer); viewTimer = setTimeout(function () { saveViewState(detailsIndex !== null); }, 120); }
  function readViewState(revision) {
    try {
      var state = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      return state && state.revision === revision ? state : null;
    } catch (_) { return null; }
  }
  function applyCatalog(entries, source, revision, savedAt, restored, visibility, transport) {
    setHiddenGroups(visibility);
    liveTransport = transport === 'hls' ? 'hls' : 'original';
    sources = entries;
    catalogViewRevision += 1; favoritesRevision += 1; activePlaylistUrl = source; activeCatalogRevision = revision; activeCatalogSavedAt = savedAt || Date.now(); sourceMode = 'playlist'; favorites = {}; playingIndex = null;
    var state = readViewState(revision);
    activeSection = state && ['tv', 'movies', 'series', 'favorites'].indexOf(state.section) >= 0 ? state.section : 'tv';
    if (state && Array.isArray(state.favorites)) state.favorites.forEach(function (index) { if (sources[index]) favorites[index] = true; });
    activeCategory = state && categories.some(function (item) { return item[0] === state.category; }) ? state.category : 'all';
    categoryPositions = {};
    var groups = sectionIndex().groups;
    activeGroup = state && (activeCategory === 'all' || state.filterVersion === 2) && state.groupIndex >= 0 && groups[state.groupIndex] ? groups[state.groupIndex] : '';
    contentSort = state && ['provider', 'year', 'rating', 'added', 'alpha'].indexOf(state.sort) >= 0 ? state.sort : 'provider';
    selected = state ? Number(state.selected) || 0 : 0; channelWindowStart = state ? Number(state.channelWindowStart) || 0 : 0; contentWindowStart = state ? Number(state.contentWindowStart) || 0 : 0;
    pendingViewState = state; renderPrimary(); renderGroups(); renderChannels();
    if (state) requestAnimationFrame(function () { $('groups').scrollTop = Number(state.groupScrollTop) || 0; $('channels').scrollTop = Number(state.channelScrollTop) || 0; $('movie-browser').scrollTop = Number(state.contentScrollTop) || 0; });
    LGI18n.text($('saved-catalog-status'), 'قائمة محفوظة: ' + sources.length + ' عنصرًا.'); $('refresh-saved').hidden = false;
    $('manage-groups-button').disabled = playlistRunning || groupSettingsSaving;
    if (restored) LGI18n.text($('status'), 'استُعيدت القائمة المحفوظة — اختر ما تريد تشغيله');
  }
  function captureRuntimeView() {
    return { section: activeSection, category: activeCategory, group: activeGroup, sort: contentSort, selectedUrl: sources[selected] && sources[selected].url, favoriteUrls: Object.keys(favorites).map(function (index) { return sources[index] && sources[index].url; }).filter(Boolean), contentWindowStart: contentWindowStart, channelWindowStart: channelWindowStart, detailsOpen: detailsIndex !== null };
  }
  function releaseCatalogForAutomaticUpdate(view) {
    automaticReleasedView = view;
    catalogViewRevision += 1; favoritesRevision += 1; sources = []; favorites = {}; activeGroup = ''; activeSection = 'tv'; selected = 0; contentWindowStart = 0; channelWindowStart = 0;
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
        LGI18n.text($('status'), 'تعذر استعادة القائمة الآن — ستُعاد المحاولة عند الرجوع للتطبيق.');
        return false;
      }
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
  function arabicChannelName(index) { return entrySection(index) === 'tv' ? api.arabicCatalogName(sources[index].name) : ''; }
  function setHiddenGroups(value) {
    ['tv', 'movies', 'series'].forEach(function (section) {
      hiddenGroups[section] = new Set(value && Array.isArray(value[section]) ? value[section].filter(function (name) { return typeof name === 'string'; }) : []);
    });
  }
  function entryVisible(index) { return !hiddenGroups[entrySection(index)].has(sources[index].group || ''); }
  function collectManagedGroups() {
    var counts = new Map();
    sources.forEach(function (entry, index) {
      if (entrySection(index) !== managedSection) return;
      var name = entry.group || ''; counts.set(name, (counts.get(name) || 0) + 1);
    });
    var groups = api.orderedCatalogGroups(Array.from(counts.keys()));
    var names = api.groupDisplayNames(groups);
    managedGroups = groups.map(function (name) { return { name: name, label: names.get(name), count: counts.get(name) }; });
    managedWindowStart = 0;
  }
  function renderManagedGroups() {
    var list = $('managed-groups'); list.replaceChildren();
    managedWindowStart = Math.max(0, Math.min(managedWindowStart, Math.max(0, managedGroups.length - 40)));
    managedGroups.slice(managedWindowStart, managedWindowStart + 40).forEach(function (item, offset) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'group-switch';
      button.dataset.position = managedWindowStart + offset; button.setAttribute('role', 'switch');
      var enabled = !hiddenGroups[managedSection].has(item.name);
      button.setAttribute('aria-checked', String(enabled)); button.disabled = groupSettingsSaving;
      var label = document.createElement('span'); label.className = 'group-switch-name'; LGI18n.provider(label, item.name, 'بدون مجموعة', item.label);
      var count = document.createElement('span'); count.className = 'group-switch-count'; LGI18n.text(count, item.count + ' عنصر');
      var state = document.createElement('span'); state.className = 'switch-state'; LGI18n.text(state, enabled ? 'ON · ظاهر' : 'OFF · مخفي');
      button.appendChild(label); button.appendChild(count); button.appendChild(state);
      button.addEventListener('focus', function () { button.scrollIntoView({ block: 'nearest' }); });
      button.addEventListener('click', function () { toggleManagedGroup(Number(button.dataset.position)); });
      list.appendChild(button);
    });
    LGI18n.text($('managed-summary'), managedGroups.length ? managedGroups.length + ' مجموعة — المخفي يبقى محفوظًا ويمكن إظهاره مجددًا.' : 'لا توجد مجموعات في هذا القسم.');
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
    $('group-manager').hidden = false;
    $('group-manager').querySelector('[data-manage-section="' + managedSection + '"]').focus();
  }
  function closeGroupManager() {
    if (groupSettingsSaving) return;
    $('group-manager').hidden = true; managedGroups = []; $('managed-groups').replaceChildren(); if (!returnToSettings()) $('setup-button').focus();
  }
  function renderGroups() {
    renderCategories();
    var groups = sectionGroups();
    var sectionLabels = { tv: 'كل قنوات البث', movies: 'كل الأفلام', series: 'كل المسلسلات', favorites: 'كل المفضلة' };
    var items = [['', activeSection === 'tv' && activeCategory !== 'all' ? 'كل قنوات التصنيف' : sectionLabels[activeSection]]].concat(groups.map(function (group) { return [group, group]; }));
    if (!items.some(function (item) { return item[0] === activeGroup; })) activeGroup = '';
    var activePosition = groups.indexOf(activeGroup) + 1;
    if (!activeGroup) activePosition = 0;
    groupWindowStart = Math.max(0, Math.min(groupWindowStart, Math.max(0, items.length - groupWindowSize)));
    if (activePosition < groupWindowStart || activePosition >= groupWindowStart + groupWindowSize) {
      groupWindowStart = Math.max(0, Math.min(activePosition - 4, Math.max(0, items.length - groupWindowSize)));
    }
    $('groups').replaceChildren();
    items.slice(groupWindowStart, groupWindowStart + groupWindowSize).forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'group-button' + (item[0] === activeGroup ? ' active' : '');
      button.dataset.group = item[0]; LGI18n.provider(button, item[0], item[1], sectionIndex().groupLabels.get(item[0]));
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
    LGI18n.provider($('movie-title'), activeGroup, activeSection === 'movies' ? 'الأفلام' : 'المسلسلات');
    $('movie-grid').replaceChildren();
    contentWindowStart = Math.max(0, Math.min(contentWindowStart, contentMaxStart(indexes.length)));
    indexes.slice(contentWindowStart, contentWindowStart + contentWindowSize).forEach(function (index) {
      var card = document.createElement('button'); card.type = 'button'; card.className = 'movie-card'; card.dataset.index = index;
      var details = sources[index] || {};
      if (details.poster) { var poster = document.createElement('img'); poster.className = 'movie-poster'; poster.alt = ''; poster.dataset.src = details.poster; poster.addEventListener('error', function () { this.remove(); }); card.appendChild(poster); }
      var name = document.createElement('span'); LGI18n.provider(name, sources[index].name, activeSection === 'movies' ? 'فيلم' : 'مسلسل'); card.appendChild(name);
      card.addEventListener('focus', function (event) { selected = Number(event.currentTarget.dataset.index); saveViewState(false); event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      card.addEventListener('click', function () { openDetails(index); }); $('movie-grid').appendChild(card);
    });
    renderSortMenu(indexes); schedulePosterCheck();
  }
  function renderSortMenu(indexes) {
    Array.prototype.forEach.call($('sort-menu').querySelectorAll('button'), function (button) {
      var sort = button.dataset.sort; var field = sort === 'year' ? 'year' : sort === 'rating' ? 'rating' : sort === 'added' ? 'added' : null;
      button.disabled = !!field && !indexes.some(function (index) { return sources[index] && sources[index][field]; });
      button.classList.toggle('active', sort === contentSort); button.setAttribute('aria-pressed', String(sort === contentSort));
    });
    LGI18n.text($('sort-button'), 'ترتيب: ' + ({ provider: 'المزوّد', alpha: 'أبجدي', year: 'السنة', rating: 'التقييم', added: 'تاريخ الإضافة' }[contentSort] || 'المزوّد'));
  }
  function closeDetails() { detailsPanel.hidden = true; $('details-poster').removeAttribute('src'); detailsIndex = null; saveViewState(false); focusSelected(); }
  function openDetails(index) {
    cancelSwitch();
    selected = index; detailsIndex = index; var details = sources[index] || {};
    LGI18n.provider($('details-title'), details.name, activeSection === 'series' ? 'مسلسل' : 'فيلم');
    LGI18n.text($('details-year'), details.year ? 'الإنتاج: ' + details.year : 'تاريخ الإنتاج غير متوفر');
    LGI18n.text($('details-rating'), details.rating ? 'التقييم: ' + details.rating : 'التقييم غير متوفر في بيانات القائمة');
    LGI18n.provider($('details-description'), details.description, 'الوصف غير متوفر في بيانات القائمة.');
    $('details-poster').hidden = !details.poster; detailsPanel.querySelector('.details-card').classList.toggle('no-poster', !details.poster);
    if (details.poster) $('details-poster').src = details.poster; else $('details-poster').removeAttribute('src');
    LGI18n.text($('details-status'), details.trailer ? 'إعلان المزود متوفر.' : 'سيُفتح بحث YouTube بالاسم والسنة. قد يعيدك زر الرجوع إلى الرئيسية؛ افتح LG Stream للعودة لنفس التفاصيل.');
    LGI18n.text($('details-trailer'), details.trailer ? 'مشاهدة الإعلان' : 'بحث الإعلان في YouTube');
    detailsPanel.hidden = false; saveViewState(true); $('details-play').focus();
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
      ['loadedmetadata', 'durationchange', 'timeupdate', 'progress'].forEach(function (name) { video.addEventListener(name, function () { if (video.parentNode && !$('media-controls').hidden) updatePlaybackControls(); }); });
      [video.audioTracks, video.textTracks].forEach(function (tracks) {
        if (tracks && tracks.addEventListener) ['addtrack', 'removetrack', 'change'].forEach(function (name) { tracks.addEventListener(name, function () { if (video.parentNode && !$('media-controls').hidden) updateTrackOptions(); }); });
      });
      updateTrackOptions();
    },
    unmountVideo: function (video) { cancelSeek(); closeTrackPicker(false); if (!$('display-picker').hidden) closeExtraDialog(); video.remove(); },
    onState: function (state) {
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
      updateChannelStates();
      if (['error', 'play-rejected', 'startup-timeout', 'ended'].indexOf(state.state) >= 0) {
        if (playingIndex === null) { stop(); focusSelected(); LGI18n.text($('status'), labels[state.state]); return; }
        if (watchMode && entrySection(playingIndex) === 'tv') {
          if (watchChannels === null) setWatchMode(true);
          $('fullscreen-hint').hidden = true;
          LGI18n.text($('status'), watchChannels === null ? 'البث مقطوع — أكمل بالسهم فوق أو تحت، أو اضغط رجوع' : 'البث مقطوع — اختر قناة واضغط موافق');
        } else if (watchMode || isOnDemand()) { setWatchMode(false); if (isOnDemand()) renderChannels(); $('retry-button').focus(); }
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
      var quality = api.qualityLabel(state.width, state.height);
      $('quality-badge').textContent = quality;
      $('quality-badge').hidden = !quality;
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
      number.className = 'channel-number'; number.textContent = String(index + 1);
      var label = document.createElement('span');
      var name = sources[index].name; var arabic = arabicChannelName(index);
      label.className = 'channel-label'; LGI18n.provider(label, name, 'المصدر ' + (index + 1), arabic);
      button.appendChild(number); button.appendChild(label);
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
      contentWindowStart = Math.min(contentMaxStart(indexes.length), contentWindowStart); renderChannels();
    }
    var card = $('movie-grid').querySelector('[data-index="' + indexes[next] + '"]'); if (card) card.focus(); return true;
  }
  function moveGroupFocus(step) {
    var current = document.activeElement;
    if (!current.classList.contains('group-button') || current.parentNode !== $('groups')) return false;
    var target = step > 0 ? current.nextElementSibling : current.previousElementSibling;
    if (!target) {
      var groups = [''].concat(sectionGroups());
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
    LGI18n.provider($('channel-title'), sources[index].name, 'المصدر ' + (index + 1), arabicChannelName(index));
    if (!watchMode && activeSection === 'tv') focusChannel(index);
    var playbackSource = sources[index].url;
    if (liveTransport === 'hls' && sourceMode === 'playlist' && entrySection(index) === 'tv') {
      playbackSource = api.nativeHlsSource(playbackSource, activePlaylistUrl);
    }
    if (!player.start(playbackSource, index + 1, intent.requestedAt)) return;
    if (entrySection(index) === 'movies' || entrySection(index) === 'series') setWatchMode(true);
  }
  var scheduler = api.createSwitchScheduler(playChannel);
  function cancelSwitch() {
    switchPending = false; scheduler.cancel();
    clearTimeout(hintTimer);
    $('fullscreen-hint').hidden = true;
    $('fullscreen-hint').classList.remove('channel-announcement');
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
    var intent = { index: index, requestedAt: performance.now(), retry: !!retry };
    if (watchMode && coalesce && sources[index]) {
      clearTimeout(hintTimer);
      $('fullscreen-hint').classList.add('channel-announcement');
      LGI18n.provider($('fullscreen-hint'), sources[index].name, 'المصدر ' + (index + 1), arabicChannelName(index));
      $('fullscreen-hint').hidden = false;
      hintTimer = setTimeout(function () {
        $('fullscreen-hint').hidden = true;
        $('fullscreen-hint').classList.remove('channel-announcement');
      }, 3000);
    }
    switchPending = !!coalesce; if (coalesce) scheduler.request(intent); else scheduler.immediate(intent);
  }
  function stop() {
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
    $('display-picker').hidden = true;
    watchMode = enabled;
    $('media-controls').hidden = true;
    document.body.classList.toggle('watch-mode', enabled);
    clearTimeout(hintTimer);
    $('fullscreen-hint').hidden = !enabled;
    $('fullscreen-hint').classList.remove('channel-announcement');
    LGI18n.provider($('fullscreen-hint'), '', isOnDemand() ? 'موافق للتحكم · رجوع للخروج' : 'موافق للقنوات · يمين للتحكم');
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
  function retryablePlayback() { return playingIndex !== null && ['error', 'play-rejected', 'startup-timeout', 'ended'].indexOf(lastState) >= 0; }
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
    lastUserActivityAt = Date.now();
    if (playlistRunning && playlistAutomatic) prepareForegroundAction();
  }
  function scheduleAutoUpdate() {
    clearTimeout(autoUpdateTimer); autoUpdateTimer = null;
    if (playlistRunning) return;
    if (automaticReleasedView) {
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
    $('playlist-url').value = '';
    inputs.forEach(function (input, index) { input.value = sourceMode === 'manual' && sources[index] ? sources[index].url : ''; });
    LGI18n.text($('playlist-status'), sourceMode === 'playlist' ? 'القائمة الحالية محفوظة محليًا. يمكنك تحديثها أو لصق رابط جديد.' : '');
    LGI18n.text($('saved-catalog-status'), activeCatalogRevision ? 'قائمة محفوظة: ' + sources.length + ' عنصرًا.' : 'لا توجد قائمة محفوظة.');
    $('refresh-saved').hidden = !activePlaylistUrl;
    $('form-error').textContent = '';
    $('transport-status').textContent = '';
    playlistControls(playlistRunning);
    setup.hidden = false;
    // Keep the field unfocused until the user selects it. On webOS, focusing
    // an input while opening the dialog can leave it active without invoking
    // the system keyboard when it is selected afterward.
    $('source-form').focus();
  }
  function closeSetup() {
    if (transportSaving || !cancelPlaylist()) return;
    setup.hidden = true;
    $('playlist-url').value = '';
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
    sourceGeneration += 1; catalogViewRevision += 1; favoritesRevision += 1; stop(); activeCategory = 'all'; categoryPositions = {}; sources = result.map(function (url, index) { return { url: url, name: 'المصدر ' + (index + 1), group: '' }; });
    automaticReleasedView = null; automaticRestoreMessage = '';
    setHiddenGroups(null);
    activePlaylistUrl = null; activeCatalogRevision = null; activeCatalogSavedAt = 0; clearTimeout(autoUpdateTimer); favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0;
    renderPrimary(); renderGroups(); renderChannels(); closeSetup();
    LGI18n.text($('status'), 'تم حفظ المصادر للجلسة — اختر قناة للتشغيل');
  });
  function loadPlaylist(url, automatic) {
    if (playlistRunning || transportSaving) return;
    var runtimeView = automatic || (sourceMode === 'playlist' && url === activePlaylistUrl) ? (automaticReleasedView || captureRuntimeView()) : null;
    sourceGeneration += 1; stop();
    if (automatic) releaseCatalogForAutomaticUpdate(runtimeView);
    var revision = ++playlistRevision;
    playlistAutomatic = !!automatic;
    playlistControls(true);
    if (automatic) LGI18n.text($('status'), 'جارٍ تحديث القائمة تلقائيًا…'); else { LGI18n.text($('playlist-status'), 'جارٍ تحميل القائمة…'); $('cancel-playlist').focus(); }
    playlistLoader.start(url).then(function (result) {
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
        } else { LGI18n.text($('playlist-status'), failure); $('load-playlist').focus(); scheduleAutoUpdate(); }
        return;
      }
      if (automatic) LGI18n.text($('status'), 'اكتمل التنزيل، جارٍ حفظ القائمة…'); else LGI18n.text($('playlist-status'), 'اكتمل التنزيل، جارٍ حفظ القائمة محليًا…');
      playlistSaving = true;
      $('cancel-playlist').disabled = false;
      catalogStore.save(url, result.entries).then(function (saved) {
        if (revision !== playlistRevision) return;
        if (saved.state !== 'complete') {
          playlistControls(false); var saveFailure = saved.state === 'quota' ? 'مساحة التخزين لا تكفي. احتفظنا بالقائمة السابقة.' : 'تعذر حفظ القائمة. احتفظنا بالقائمة السابقة.';
          if (automatic) {
            result.entries = [];
            autoNextAttemptAt = Date.now() + 60 * 60 * 1000;
            restoreReleasedCatalog(saveFailure, !document.hidden).then(function (restored) { if (restored) scheduleAutoUpdate(); });
          } else { LGI18n.text($('playlist-status'), saveFailure); if (!document.hidden) $('load-playlist').focus(); scheduleAutoUpdate(); }
          return;
        }
        automaticReleasedView = null;
        automaticRestoreMessage = '';
        stop(); applyCatalog(result.entries, url, saved.revision, saved.savedAt, false, saved.hiddenGroups, saved.liveTransport); if (runtimeView) restoreRuntimeView(runtimeView, automatic && !document.hidden);
        var totals = { tv: 0, movies: 0, series: 0 }; sources.forEach(function (_, index) { totals[entrySection(index)] += 1; });
        LGI18n.text($('status'), (automatic ? 'تم تحديث القائمة تلقائيًا: ' : 'تم حفظ ') + sources.length + ' عنصرًا — بث ' + totals.tv + ' · أفلام ' + totals.movies + ' · مسلسلات ' + totals.series);
        playlistControls(false); autoNextAttemptAt = 0;
        if (!automatic) { if (document.hidden) { setup.hidden = true; $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; }); } else closeSetup(); }
        scheduleAutoUpdate();
      });
    });
  }
  $('load-playlist').addEventListener('click', function () {
    var url = api.validateSource($('playlist-url').value);
    if (!url) { LGI18n.text($('playlist-status'), 'أدخل رابط M3U كاملًا يبدأ بـ HTTP أو HTTPS.'); $('playlist-url').focus(); return; }
    loadPlaylist(url, false);
  });
  $('refresh-saved').addEventListener('click', function () { if (activePlaylistUrl) loadPlaylist(activePlaylistUrl, false); });
  $('cancel-playlist').addEventListener('click', function () { cancelPlaylist(); $('load-playlist').focus(); });
  $('clear-sources').addEventListener('click', function () {
    if (playlistRunning) return;
    sourceGeneration += 1; if (!cancelPlaylist()) return; stop(); $('clear-sources').disabled = true; LGI18n.text($('playlist-status'), 'جارٍ مسح القائمة المحفوظة…');
    catalogStore.clear().then(function (result) {
      $('clear-sources').disabled = false;
      if (result.state !== 'complete') { LGI18n.text($('playlist-status'), 'تعذر مسح القائمة المحفوظة. لم نغيّرها.'); return; }
      try { localStorage.removeItem(VIEW_KEY); } catch (_) {}
      automaticReleasedView = null; automaticRestoreMessage = '';
      setHiddenGroups(null);
      catalogViewRevision += 1; favoritesRevision += 1; sources = []; activePlaylistUrl = null; activeCatalogRevision = null; activeCatalogSavedAt = 0; clearTimeout(autoUpdateTimer); favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
      $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
      $('manage-groups-button').disabled = true;
      LGI18n.text($('saved-catalog-status'), 'لا توجد قائمة محفوظة.'); $('refresh-saved').hidden = true; LGI18n.text($('playlist-status'), 'مُسحت القائمة المحفوظة.'); $('form-error').textContent = ''; inputs[0].focus();
    });
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
  $('details-play').addEventListener('click', function () { var index = detailsIndex; detailsPanel.hidden = true; detailsIndex = null; if (index !== null) activateChannel(index); });
  $('details-trailer').addEventListener('click', function () {
    if (!prepareForegroundAction()) return;
    var index = detailsIndex; var details = sources[index] || {};
    saveViewState(true);
    if (details.trailer) {
      detailsPanel.hidden = true; detailsIndex = null; playingIndex = null; $('movie-browser').hidden = true; $('empty-state').hidden = true;
      LGI18n.provider($('channel-title'), null, 'الإعلان'); if (player.start(details.trailer, 'trailer', performance.now())) setWatchMode(true); return;
    }
    stop();
    var target = api.youtubeSearchTarget(details.name, details.year);
    if (!target || typeof window.PalmServiceBridge !== 'function') { LGI18n.text($('details-status'), 'تعذر فتح تطبيق YouTube مباشرة على هذا الجهاز.'); return; }
    LGI18n.text($('details-status'), 'جارٍ إرسال البحث إلى تطبيق YouTube…');
    try {
      youtubeBridge = new window.PalmServiceBridge();
      youtubeBridge.onservicecallback = function (raw) {
        var accepted = false;
        try { accepted = JSON.parse(raw).returnValue === true; } catch (_) {}
        LGI18n.text($('details-status'), accepted ? 'أُرسل طلب البحث إلى تطبيق YouTube.' : 'تعذر فتح تطبيق YouTube.');
        youtubeBridge = null;
      };
      youtubeBridge.call('luna://com.webos.applicationManager/launch', JSON.stringify({ id: 'youtube.leanback.v4', params: { contentTarget: target } }));
    } catch (_) { youtubeBridge = null; LGI18n.text($('details-status'), 'تعذر فتح تطبيق YouTube.'); }
  });
  $('sort-button').addEventListener('click', function () {
    var open = $('sort-menu').hidden; $('sort-menu').hidden = !open; $('sort-button').setAttribute('aria-expanded', String(open));
    if (open) { var active = $('sort-menu').querySelector('button.active:not(:disabled)') || $('sort-menu').querySelector('button:not(:disabled)'); if (active) active.focus(); }
  });
  Array.prototype.forEach.call($('sort-menu').querySelectorAll('button'), function (button) {
    button.addEventListener('click', function (event) {
      contentSort = event.currentTarget.dataset.sort; contentWindowStart = 0; $('sort-menu').hidden = true; $('sort-button').setAttribute('aria-expanded', 'false'); renderChannels(); saveViewState(false); $('sort-button').focus();
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
    var groups = [''].concat(sectionGroups()); var position = groups.indexOf(activeGroup);
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
    contentWindowStart = next; selected = indexes[event.deltaY > 0 ? next : Math.min(indexes.length - 1, next + contentWindowSize - 1)] || selected; renderChannels(); browser.scrollTop = event.deltaY > 0 ? 0 : browser.scrollHeight;
    var card = $('movie-grid').querySelector('[data-index="' + selected + '"]'); if (card) card.focus(); saveViewState(false); event.preventDefault();
  }, { passive: false });
  Array.prototype.forEach.call(document.querySelectorAll('.primary-button'), function (button) {
    button.addEventListener('click', function (event) {
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
    if (!diagnostics.hidden) $('close-diagnostics').focus();
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
    return ['exit-confirm', 'display-picker', 'category-picker', 'appearance-panel', 'settings-home'].map($).find(function (panel) { return !panel.hidden; }) || null;
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
    ( $('manage-groups-button').disabled ? $('settings-sources') : $('manage-groups-button') ).focus();
  }
  function closeExtraDialog() {
    var panel = extraDialog(); if (!panel) return;
    panel.hidden = true;
    if (panel.id === 'exit-confirm') { if (exitReturn && exitReturn.isConnected && exitReturn.offsetParent) exitReturn.focus(); else focusSection(); exitReturn = null; }
    else if (panel.id === 'settings-home') { settingsReturn = null; setPrimary(false); $('nav-settings').focus(); }
    else if (panel.id === 'appearance-panel') returnToSettings();
    else if (panel.id === 'category-picker') focusCategoryReturn();
    else if (panel.id === 'display-picker') {
      if (displayReturn && displayReturn.offsetParent && !displayReturn.disabled) displayReturn.focus();
      else if (watchMode) showPlaybackControls(); else focusSelected();
    }
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
      if (item[0] === 'all') LGI18n.text(button, 'الكل');
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
  function openDisplay() {
    cancelSwitch(); displayReturn = document.activeElement;
    LGI18n.text($('display-fullscreen'), watchMode ? 'العودة للقائمة' : 'ملء الشاشة');
    Array.prototype.forEach.call($('display-picker').querySelectorAll('[data-fit]'), function (button) { button.setAttribute('aria-pressed', String(Number(button.dataset.fit) === fitIndex)); });
    $('display-picker').hidden = false; $('display-fullscreen').focus();
  }
  $('groups-filter').addEventListener('click', openCategories);
  ['close-settings', 'close-appearance', 'close-category', 'close-display'].forEach(function (id) { $(id).addEventListener('click', closeExtraDialog); });
  ['settings-sources', 'settings-speed', 'settings-info', 'settings-appearance', 'manage-groups-button'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      settingsReturn = id; $('settings-home').hidden = true;
      if (id === 'settings-sources') openSetup();
      else if (id === 'settings-speed') openSpeed();
      else if (id === 'settings-info') openDiagnostics();
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
  ['display-button', 'media-display'].forEach(function (id) { $(id).addEventListener('click', openDisplay); });
  $('display-fullscreen').addEventListener('click', function () {
    if (watchMode) { exitPlayback(); return; }
    setWatchMode(true);
  });
  Array.prototype.forEach.call($('display-picker').querySelectorAll('[data-fit]'), function (button) {
    button.addEventListener('click', function () { fitIndex = Number(button.dataset.fit); $('video-host').dataset.fit = fitModes[fitIndex].value; closeExtraDialog(); });
  });
  try {
    var savedAppearance = JSON.parse(localStorage.getItem('lg-stream-appearance-v1') || 'null');
    if (savedAppearance && ['editorial', 'cinema'].indexOf(savedAppearance.theme) >= 0) appearance.theme = savedAppearance.theme;
    if (savedAppearance && ['compact', 'tabs', 'vertical'].indexOf(savedAppearance.layout) >= 0) appearance.layout = savedAppearance.layout;
    if (savedAppearance && ['compact', 'comfortable'].indexOf(savedAppearance.controls) >= 0) appearance.controls = savedAppearance.controls;
  } catch (_) {}
  renderAppearance();

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
      var distance = forward + Math.abs(horizontal ? dy : dx) * 3 + (aligned ? 0 : 10000);
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
    if (key === 'Enter' && event.repeat && !isInput) { event.preventDefault(); return; }
    var back = code === 461 || key === 'Escape';
    if (back) {
      event.preventDefault();
      if (event.repeat) return;
      if (switchPending && playingIndex !== null) selected = playingIndex;
      cancelSwitch();
      if (watchChannels !== null) { closeWatchChannels(); exitPlayback(); focusActiveGroup(); return; }
      if (!$('track-picker').hidden) { closeTrackPicker(true); return; }
      if (!$('group-manager').hidden) { closeGroupManager(); return; }
      if (!$('sort-menu').hidden) { $('sort-menu').hidden = true; $('sort-button').setAttribute('aria-expanded', 'false'); $('sort-button').focus(); }
      else if (!detailsPanel.hidden) closeDetails();
      else if (!setup.hidden) closeSetup();
      else if (!searchPanel.hidden) closeSearch();
      else if (!diagnostics.hidden) closeDiagnostics();
      else if (!speedPanel.hidden) closeSpeed();
      else if (extraDialog()) closeExtraDialog();
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
      if (dialog === $('group-manager') && key === 'ArrowUp' && document.activeElement === $('close-group-manager')) {
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
    if (document.hidden) { ['exit-confirm', 'settings-home', 'appearance-panel', 'category-picker', 'display-picker'].forEach(function (id) { $(id).hidden = true; }); exitReturn = null; settingsReturn = null; $('group-manager').hidden = true; managedGroups = []; $('managed-groups').replaceChildren(); cancelSpeed(); if (playlistAutomatic) { autoNextAttemptAt = Date.now() + 5 * 60 * 1000; cancelPlaylist(); } stop(); if (!setup.hidden) closeSetup(); }
    else if (!speedPanel.hidden) $('speed-wired').focus();
    else if (!detailsPanel.hidden) $('details-trailer').focus();
    else if (setup.hidden && diagnostics.hidden) focusSelected();
    if (!document.hidden) scheduleAutoUpdate();
  });
  window.addEventListener('pageshow', function () { unloading = false; scheduleAutoUpdate(); });
  window.addEventListener('pagehide', function () {
    unloading = true; ['exit-confirm', 'settings-home', 'appearance-panel', 'category-picker', 'display-picker'].forEach(function (id) { $(id).hidden = true; }); exitReturn = null; settingsReturn = null; clearTimeout(viewTimer); saveViewState(detailsIndex !== null); cancelPlaylist(); cancelSpeed(); speedResults = []; $('speed-results').replaceChildren(); stop();
    if (!automaticReleasedView && sourceMode === 'playlist' && sources.length) automaticReleasedView = captureRuntimeView();
    catalogViewRevision += 1; favoritesRevision += 1; sources = []; favorites = {}; activeGroup = ''; activeSection = 'tv'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
    $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
  });
  var restoreGeneration = sourceGeneration;
  renderPrimary(); renderGroups(); renderChannels(); $('start-button').focus();
  catalogStore.load().then(function (saved) {
    if (restoreGeneration !== sourceGeneration || unloading) return;
    if (saved.state === 'complete') {
      applyCatalog(saved.entries, saved.source, saved.revision, saved.savedAt, true, saved.hiddenGroups, saved.liveTransport);
      if (!document.hidden && !extraDialog() && setup.hidden && searchPanel.hidden && speedPanel.hidden && diagnostics.hidden) { if (pendingViewState && pendingViewState.detailsOpen && sources[selected] && entryVisible(selected)) openDetails(selected); else focusSelected(); }
      scheduleAutoUpdate();
    } else if (saved.state !== 'empty') {
      LGI18n.text($('status'), 'تعذر استعادة القائمة المحفوظة — أعد فتح التطبيق للمحاولة مجددًا.');
      LGI18n.text($('saved-catalog-status'), 'تعذرت قراءة القائمة المحفوظة. لم تُحذف بياناتها؛ أعد فتح التطبيق أو حمّل القائمة من جديد.');
    }
  });
}());
