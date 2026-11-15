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
  var activeGroup = '';
  var activeSection = 'tv';
  var sourceMode = 'manual';
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
    var cacheKey = [catalogViewRevision, favoritesRevision, activeSection].join('\u0001');
    if (cacheKey === sectionCacheKey) return sectionCache;
    sectionCache = api.buildSectionIndex(sources, function (_, index) {
      return activeSection === 'favorites' ? favorites[index] : entrySection(index) === activeSection;
    });
    sectionCacheKey = cacheKey; return sectionCache;
  }
  function visibleIndexes() {
    var cacheKey = [catalogViewRevision, favoritesRevision, activeSection, activeGroup, contentSort].join('\u0001');
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
    searchPanel.hidden = true; $('channel-search').value = ''; $('search-results').replaceChildren(); $('search-status').textContent = 'اكتب حرفين على الأقل.';
    setPrimary(false); var group = $('groups').querySelector('.group-button.active') || $('groups button'); if (group) group.focus();
  }
  function renderSearch() {
    var query = $('channel-search').value.trim().toLocaleLowerCase(); $('search-results').replaceChildren();
    if (query.length < 2) { $('search-status').textContent = 'اكتب حرفين على الأقل.'; return; }
    var sections = [['tv', 'البث المباشر'], ['movies', 'الأفلام'], ['series', 'المسلسلات']]; var total = 0;
    var results = api.searchCatalog(sources, query, entrySection, 12);
    sections.forEach(function (section) {
      var matches = results.matches[section[0]]; var count = results.counts[section[0]];
      total += count;
      var box = document.createElement('section'); box.className = 'search-section';
      var title = document.createElement('h3'); title.textContent = section[1] + ' (' + count + ')'; box.appendChild(title);
      matches.forEach(function (index) {
        var button = document.createElement('button'); button.type = 'button'; button.textContent = sources[index].name || 'عنصر';
        button.addEventListener('click', function () { closeSearch(); activeSection = section[0]; activeGroup = sources[index].group || ''; renderPrimary(); renderGroups(); renderChannels(); if (section[0] === 'tv') activateChannel(index); else openDetails(index); });
        box.appendChild(button);
      });
      $('search-results').appendChild(box);
    });
    $('search-status').textContent = total ? 'وُجد ' + total + ' نتيجة. تظهر أول 12 نتيجة في كل قسم.' : 'لا توجد نتائج.';
  }
  function openSearch() { setPrimary(false); searchPanel.hidden = false; renderSearch(); $('channel-search').focus(); }
  function renderPrimary() {
    document.querySelector('.library-panel').classList.toggle('content-mode', activeSection === 'movies' || activeSection === 'series');
    Array.prototype.forEach.call(document.querySelectorAll('.primary-button'), function (button) {
      button.classList.toggle('active', button.dataset.section === activeSection);
    });
  }
  function saveViewState(detailsOpen) {
    if (!activeCatalogRevision) return;
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ revision: activeCatalogRevision, section: activeSection, groupIndex: sectionGroups().indexOf(activeGroup), sort: contentSort, selected: selected, favorites: Object.keys(favorites).map(Number), channelWindowStart: channelWindowStart, contentWindowStart: contentWindowStart, groupScrollTop: $('groups').scrollTop, channelScrollTop: $('channels').scrollTop, contentScrollTop: $('movie-browser').scrollTop, detailsOpen: !!detailsOpen }));
    } catch (_) {}
  }
  function scheduleViewSave() { if (unloading) return; clearTimeout(viewTimer); viewTimer = setTimeout(function () { saveViewState(detailsIndex !== null); }, 120); }
  function readViewState(revision) {
    try {
      var state = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      return state && state.revision === revision ? state : null;
    } catch (_) { return null; }
  }
  function applyCatalog(entries, source, revision, savedAt, restored) {
    sources = entries;
    catalogViewRevision += 1; favoritesRevision += 1; activePlaylistUrl = source; activeCatalogRevision = revision; activeCatalogSavedAt = savedAt || Date.now(); sourceMode = 'playlist'; favorites = {}; playingIndex = null;
    var state = readViewState(revision);
    activeSection = state && ['tv', 'movies', 'series', 'favorites'].indexOf(state.section) >= 0 ? state.section : 'tv';
    if (state && Array.isArray(state.favorites)) state.favorites.forEach(function (index) { if (sources[index]) favorites[index] = true; });
    var groups = sectionGroups(); activeGroup = state && state.groupIndex >= 0 && groups[state.groupIndex] ? groups[state.groupIndex] : '';
    contentSort = state && ['provider', 'year', 'rating', 'added', 'alpha'].indexOf(state.sort) >= 0 ? state.sort : 'provider';
    selected = state ? Number(state.selected) || 0 : 0; channelWindowStart = state ? Number(state.channelWindowStart) || 0 : 0; contentWindowStart = state ? Number(state.contentWindowStart) || 0 : 0;
    pendingViewState = state; renderPrimary(); renderGroups(); renderChannels();
    if (state) requestAnimationFrame(function () { $('groups').scrollTop = Number(state.groupScrollTop) || 0; $('channels').scrollTop = Number(state.channelScrollTop) || 0; $('movie-browser').scrollTop = Number(state.contentScrollTop) || 0; });
    $('saved-catalog-status').textContent = 'قائمة محفوظة: ' + sources.length + ' عنصرًا.'; $('refresh-saved').hidden = false;
    if (restored) $('status').textContent = 'استُعيدت القائمة المحفوظة — اختر ما تريد تشغيله';
  }
  function captureRuntimeView() {
    return { section: activeSection, group: activeGroup, sort: contentSort, selectedUrl: sources[selected] && sources[selected].url, favoriteUrls: Object.keys(favorites).map(function (index) { return sources[index] && sources[index].url; }).filter(Boolean), contentWindowStart: contentWindowStart, channelWindowStart: channelWindowStart, detailsOpen: detailsIndex !== null };
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
      if (automaticRestoreMessage) $('status').textContent = automaticRestoreMessage;
      automaticRestoreMessage = '';
      return Promise.resolve(true);
    }
    if (document.hidden || unloading) return Promise.resolve(false);
    var view = automaticReleasedView; var generation = sourceGeneration;
    automaticRestorePromise = catalogStore.load().then(function (saved) {
      if (generation !== sourceGeneration) { automaticReleasedView = null; automaticRestoreMessage = ''; return false; }
      if (saved.state !== 'complete') {
        $('status').textContent = 'تعذر استعادة القائمة الآن — ستُعاد المحاولة عند الرجوع للتطبيق.';
        return false;
      }
      applyCatalog(saved.entries, saved.source, saved.revision, saved.savedAt, true); restoreRuntimeView(view, shouldFocus);
      automaticReleasedView = null;
      if (automaticRestoreMessage) $('status').textContent = automaticRestoreMessage;
      automaticRestoreMessage = '';
      return true;
    });
    automaticRestorePromise = automaticRestorePromise.then(function (restored) {
      automaticRestorePromise = null;
      return restored;
    }, function (error) {
      automaticRestorePromise = null;
      throw error;
    });
    return automaticRestorePromise;
  }
  function restoreRuntimeView(state, shouldFocus) {
    if (!state) return;
    activeSection = state.section; contentSort = state.sort; favorites = {}; favoritesRevision += 1;
    var favoriteUrls = {}; state.favoriteUrls.forEach(function (url) { favoriteUrls[url] = true; });
    sources.forEach(function (entry, index) { if (favoriteUrls[entry.url]) favorites[index] = true; });
    activeGroup = state.group; selected = Math.max(0, sources.findIndex(function (entry) { return entry.url === state.selectedUrl; }));
    contentWindowStart = state.contentWindowStart; channelWindowStart = state.channelWindowStart; renderPrimary(); renderGroups(); renderChannels(); saveViewState(state.detailsOpen);
    if (shouldFocus === false) return;
    if (state.detailsOpen && sources[selected]) openDetails(selected); else focusSelected();
  }
  function sectionGroups() {
    return sectionIndex().groups;
  }
  function renderGroups() {
    var groups = sectionGroups();
    var sectionLabels = { tv: 'كل قنوات البث', movies: 'كل الأفلام', series: 'كل المسلسلات', favorites: 'كل المفضلة' };
    var items = [['', sectionLabels[activeSection]]].concat(groups.map(function (group) { return [group, group]; }));
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
      button.dataset.group = item[0]; button.textContent = item[1];
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
    if (!cards) return;
    $('movie-title').textContent = activeGroup || (activeSection === 'movies' ? 'الأفلام' : 'المسلسلات');
    $('movie-grid').replaceChildren();
    contentWindowStart = Math.max(0, Math.min(contentWindowStart, contentMaxStart(indexes.length)));
    indexes.slice(contentWindowStart, contentWindowStart + contentWindowSize).forEach(function (index) {
      var card = document.createElement('button'); card.type = 'button'; card.className = 'movie-card'; card.dataset.index = index;
      var details = sources[index] || {};
      if (details.poster) { var poster = document.createElement('img'); poster.className = 'movie-poster'; poster.alt = ''; poster.dataset.src = details.poster; poster.addEventListener('error', function () { this.remove(); }); card.appendChild(poster); }
      var name = document.createElement('span'); name.textContent = sources[index].name || (activeSection === 'movies' ? 'فيلم' : 'مسلسل'); card.appendChild(name);
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
    $('sort-button').textContent = 'ترتيب: ' + ({ provider: 'المزوّد', alpha: 'أبجدي', year: 'السنة', rating: 'التقييم', added: 'تاريخ الإضافة' }[contentSort] || 'المزوّد');
  }
  function closeDetails() { detailsPanel.hidden = true; $('details-poster').removeAttribute('src'); detailsIndex = null; saveViewState(false); focusSelected(); }
  function openDetails(index) {
    selected = index; detailsIndex = index; var details = sources[index] || {};
    $('details-title').textContent = details.name || (activeSection === 'series' ? 'مسلسل' : 'فيلم');
    $('details-year').textContent = details.year ? 'الإنتاج: ' + details.year : 'تاريخ الإنتاج غير متوفر';
    $('details-description').textContent = details.description || 'الوصف غير متوفر في بيانات القائمة.';
    $('details-poster').hidden = !details.poster; if (details.poster) $('details-poster').src = details.poster; else $('details-poster').removeAttribute('src');
    $('details-status').textContent = details.trailer ? 'إعلان المزود متوفر.' : 'سيُفتح بحث YouTube بالاسم والسنة. قد يعيدك زر الرجوع إلى الرئيسية؛ افتح LG Stream للعودة لنفس التفاصيل.';
    $('details-trailer').textContent = details.trailer ? 'مشاهدة الإعلان' : 'بحث الإعلان في YouTube';
    detailsPanel.hidden = false; saveViewState(true); $('details-play').focus();
  }
  var player = api.createPlayer({
    createVideo: function () {
      var video = document.createElement('video');
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-label', 'البث الحالي');
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
    unmountVideo: function (video) { cancelSeek(); video.remove(); },
    onState: function (state) {
      lastState = state.state;
      document.body.dataset.state = state.state;
      $('status').textContent = labels[state.state] || 'جاهز';
      if (state.state === 'error' && state.errorCode) $('status').textContent += ' (' + state.errorCode + ')';
      $('toggle-button').textContent = state.state === 'paused' ? 'متابعة البث' : 'إيقاف مؤقت';
      $('media-toggle').textContent = state.state === 'paused' ? 'متابعة' : 'إيقاف مؤقت';
      $('toggle-button').disabled = ['playing', 'waiting', 'paused'].indexOf(state.state) < 0;
      $('stop-button').disabled = state.state === 'idle';
      $('retry-button').disabled = playingIndex === null;
      $('fullscreen-button').disabled = ['playing', 'waiting', 'paused', 'loading'].indexOf(state.state) < 0;
      $('fit-button').disabled = $('fullscreen-button').disabled;
      updateChannelStates();
      if (watchMode && ['error', 'play-rejected', 'startup-timeout', 'ended'].indexOf(state.state) >= 0) {
        setWatchMode(false); $('retry-button').focus();
      }
      if (!watchMode && setup.hidden && diagnostics.hidden && speedPanel.hidden && document.activeElement.disabled) focusChannel(selected);
      $('playing-ms').textContent = state.playingMs === null || state.playingMs === undefined ? '—' : state.playingMs + ' ms';
      $('progress-ms').textContent = state.progressMs === null || state.progressMs === undefined ? '—' : state.progressMs + ' ms';
      $('frame-ms').textContent = state.firstFrameMs === null || state.firstFrameMs === undefined ? (state.frameApi ? 'بانتظار الإشارة' : 'غير متاح') : state.firstFrameMs + ' ms';
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
    renderMovies(indexes);
    $('channels').replaceChildren();
    $('channel-empty').hidden = indexes.length > 0;
    $('channel-empty').innerHTML = sources.length ? 'لا توجد قنوات مطابقة<br><span>غيّر المجموعة أو البحث</span>' : 'قنواتك تظهر هنا<br><span>أضف مصدرًا للبدء</span>';
    $('empty-title').textContent = sources.length ? 'اختر قناة وابدأ المشاهدة' : 'مساحتك للمشاهدة';
    $('empty-description').textContent = sources.length ? 'تم تحميل ' + sources.length + ' قناة أو فيديو. تنقّل بالأسهم ثم اضغط موافق.' : 'أضف رابط M3U كاملًا أو روابط مباشرة.';
    $('start-button').textContent = sources.length ? 'تغيير القائمة' : 'إضافة قائمة M3U';
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
      label.className = 'channel-label'; label.textContent = sources[index].name || 'المصدر ' + (index + 1);
      button.appendChild(number); button.appendChild(label);
      button.setAttribute('aria-pressed', playingIndex === index ? 'true' : 'false');
      button.addEventListener('focus', function (event) { selected = Number(event.currentTarget.dataset.index); event.currentTarget.scrollIntoView({ block: 'nearest' }); });
      button.addEventListener('click', function (event) { activateChannel(Number(event.currentTarget.dataset.index)); });
      var favorite = document.createElement('button');
      favorite.type = 'button'; favorite.className = 'favorite-button'; favorite.dataset.favoriteIndex = index;
      favorite.textContent = favorites[index] ? '★' : '☆'; favorite.setAttribute('aria-pressed', String(!!favorites[index]));
      favorite.setAttribute('aria-label', (favorites[index] ? 'إزالة من المفضلة: ' : 'إضافة إلى المفضلة: ') + (sources[index].name || 'القناة'));
      favorite.addEventListener('click', function (event) {
        var ownIndex = Number(event.currentTarget.dataset.favoriteIndex);
        favorites[ownIndex] = !favorites[ownIndex];
        if (!favorites[ownIndex]) delete favorites[ownIndex];
        favoritesRevision += 1;
        saveViewState(false);
        renderGroups(); renderChannels();
        var target = $('channels').querySelector('[data-favorite-index="' + ownIndex + '"]');
        if (target) target.focus(); else if ($('channels').querySelector('button')) $('channels').querySelector('button').focus();
      });
      row.appendChild(button); row.appendChild(favorite); $('channels').appendChild(row);
    }
    updateChannelStates();
  }
  function focusChannel(index) {
    var indexes = visibleIndexes();
    var position = indexes.indexOf(index);
    if (position < 0) { if ($('channels').querySelector('button')) $('channels').querySelector('button').focus(); else if ($('groups button')) $('groups button').focus(); return; }
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
    if (card) card.focus(); else if ($('groups button')) $('groups button').focus();
  }
  function moveContentWindow(step) {
    if ((activeSection !== 'movies' && activeSection !== 'series') || !document.activeElement.classList.contains('movie-card')) return false;
    var indexes = visibleIndexes(); var position = indexes.indexOf(selected); var rawNext = position + step; var next = step > 0 ? Math.min(indexes.length - 1, rawNext) : Math.max(0, rawNext);
    if (next < 0 || next >= indexes.length) return false;
    if (next === position) return true;
    if (next >= contentWindowStart && next < contentWindowStart + contentWindowSize) {
      if (rawNext === next) return false;
      var edgeCard = $('movie-grid').querySelector('[data-index="' + indexes[next] + '"]'); if (edgeCard) edgeCard.focus(); return !!edgeCard;
    }
    contentWindowStart = step > 0 ? Math.floor(Math.max(0, next - (contentWindowSize - 4)) / 4) * 4 : Math.floor(next / 4) * 4;
    contentWindowStart = Math.min(contentMaxStart(indexes.length), contentWindowStart); renderChannels();
    var card = $('movie-grid').querySelector('[data-index="' + indexes[next] + '"]'); if (card) card.focus(); return true;
  }
  function moveGroupFocus(step) {
    var current = document.activeElement;
    if (!current.classList.contains('group-button') || current.parentNode !== $('groups')) return false;
    var target = step > 0 ? current.nextElementSibling : current.previousElementSibling;
    if (!target) {
      var groups = [''].concat(sectionGroups());
      var position = groups.indexOf(current.dataset.group); var next = position + step;
      if (next < 0 || next >= groups.length) return true;
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
    $('channel-title').textContent = sources[index].name || 'المصدر ' + (index + 1);
    if (!watchMode && activeSection === 'tv') focusChannel(index);
    player.start(sources[index].url, index + 1, intent.requestedAt);
    if (entrySection(index) === 'movies' || entrySection(index) === 'series') setWatchMode(true);
  }
  var scheduler = api.createSwitchScheduler(playChannel);
  function cancelSwitch() { switchPending = false; scheduler.cancel(); }
  var lastConfirmIndex = null;
  var lastConfirmAt = 0;
  function activateChannel(index) {
    var now = performance.now();
    if (playingIndex === index && lastConfirmIndex === index && now - lastConfirmAt <= 700) {
      cancelSwitch(); setWatchMode(true); lastConfirmIndex = null; lastConfirmAt = 0; return;
    }
    lastConfirmIndex = index; lastConfirmAt = now; requestChannel(index, false);
  }
  function requestChannel(index, coalesce, retry) {
    var intent = { index: index, requestedAt: performance.now(), retry: !!retry };
    switchPending = !!coalesce; if (coalesce) scheduler.request(intent); else scheduler.immediate(intent);
  }
  function stop() {
    cancelSwitch();
    setWatchMode(false);
    playingIndex = null;
    lastConfirmIndex = null; lastConfirmAt = 0;
    player.stop();
    updateChannelStates();
    $('channel-title').textContent = 'لا يوجد بث محدد';
    $('empty-state').hidden = false;
    $('retry-button').disabled = true;
    if (activeSection === 'movies' || activeSection === 'series') renderChannels();
    setTimeout(scheduleAutoUpdate, 0);
  }
  function setWatchMode(enabled) {
    cancelSeek();
    watchMode = enabled;
    $('media-controls').hidden = true;
    document.body.classList.toggle('watch-mode', enabled);
    $('fullscreen-button').setAttribute('aria-pressed', String(enabled));
    clearTimeout(hintTimer);
    $('fullscreen-hint').hidden = !enabled;
    if (enabled) {
      document.body.tabIndex = -1;
      document.body.focus();
      hintTimer = setTimeout(function () { $('fullscreen-hint').hidden = true; }, 3000);
    }
  }
  $('fullscreen-button').addEventListener('click', function () { cancelSwitch(); setWatchMode(true); });
  $('fit-button').addEventListener('click', function () {
    fitIndex = (fitIndex + 1) % fitModes.length;
    $('video-host').dataset.fit = fitModes[fitIndex].value;
    $('fit-button').textContent = 'الصورة: ' + fitModes[fitIndex].label;
  });
  $('video-host').addEventListener('click', function () { if (watchMode) showPlaybackControls(); });
  var seekTimer = null;
  var pendingSeek = null;
  function cancelSeek() { clearTimeout(seekTimer); seekTimer = null; pendingSeek = null; }
  function isOnDemand() { return playingIndex !== null && /^(movies|series)$/.test(entrySection(playingIndex)); }
  function exitPlayback() {
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
    ['seek-back', 'seek-forward', 'seek-position'].forEach(function (id) { $(id).disabled = !seekable; });
    $('seek-position').max = video && isFinite(video.duration) ? video.duration : 0;
    $('seek-position').step = video && isFinite(video.duration) ? Math.max(30, Math.ceil(video.duration / 100 / 10) * 10) : 30;
    if (pendingSeek === null && document.activeElement !== $('seek-position')) $('seek-position').value = video ? video.currentTime : 0;
    $('playback-time').textContent = video ? timeLabel(video.currentTime) + ' / ' + timeLabel(video.duration) : '—';
    $('seek-status').textContent = seekable ? '' : 'التقديم غير متاح حاليًا لهذا المصدر.';
  }
  function seekTo(seconds) {
    var video = $('video-host').querySelector('video');
    if (!video || !isOnDemand() || !isFinite(seconds) || !isFinite(video.duration)) return;
    if (!video.seekable.length) return;
    seconds = Math.max(video.seekable.start(0), Math.min(video.seekable.end(video.seekable.length - 1), seconds));
    for (var i = 0; i < video.seekable.length; i += 1) {
      if (seconds < video.seekable.start(i) || seconds > video.seekable.end(i)) continue;
      try { video.currentTime = seconds; } catch (_) { $('seek-status').textContent = 'تعذر الانتقال في هذا المصدر.'; return; }
      updatePlaybackControls(); return;
    }
    $('seek-status').textContent = 'هذا الموضع غير متاح في المصدر حاليًا.';
  }
  function queueSeek(seconds) {
    var video = $('video-host').querySelector('video'); if (!video || !isOnDemand() || !isFinite(seconds)) return;
    clearTimeout(seekTimer); pendingSeek = Math.max(0, Math.min(video.duration, seconds));
    $('seek-position').value = pendingSeek; $('playback-time').textContent = timeLabel(pendingSeek) + ' / ' + timeLabel(video.duration);
    seekTimer = setTimeout(function () { var target = pendingSeek; cancelSeek(); if (video === $('video-host').querySelector('video')) seekTo(target); }, 400);
  }
  function updateTrackOptions() {
    var video = $('video-host').querySelector('video');
    [['audio-language', video && video.audioTracks, false], ['subtitle-language', video && video.textTracks, true]].forEach(function (item) {
      var select = $(item[0]); if (document.activeElement === select) return; var tracks = item[1]; var subtitle = item[2]; select.replaceChildren();
      function option(value, label, selected) { var node = document.createElement('option'); node.value = value; node.textContent = label; node.selected = selected; select.appendChild(node); }
      if (subtitle) option('-1', 'إيقاف الترجمة', true);
      if (tracks) for (var i = 0; i < tracks.length; i += 1) {
        if (subtitle && tracks[i].kind !== 'subtitles' && tracks[i].kind !== 'captions') continue;
        option(String(i), tracks[i].label || tracks[i].language || (subtitle ? 'ترجمة ' : 'صوت ') + (i + 1), subtitle ? tracks[i].mode === 'showing' : tracks[i].enabled);
      }
      select.disabled = subtitle ? select.options.length <= 1 : !select.options.length;
      if (!select.options.length) option('-1', 'لا توجد مسارات متاحة', true);
    });
  }
  function showPlaybackControls() {
    $('media-controls').hidden = false; updatePlaybackControls(); updateTrackOptions();
    $('media-toggle').textContent = lastState === 'paused' ? 'متابعة' : 'إيقاف مؤقت';
    $('media-toggle').focus();
  }
  $('media-toggle').addEventListener('click', function () { player.toggle(); });
  $('media-close').addEventListener('click', function () { cancelSeek(); $('media-controls').hidden = true; document.body.focus(); });
  $('media-exit').addEventListener('click', exitPlayback);
  $('seek-back').addEventListener('click', function () { var video = $('video-host').querySelector('video'); if (video) queueSeek((pendingSeek === null ? video.currentTime : pendingSeek) - 30); });
  $('seek-forward').addEventListener('click', function () { var video = $('video-host').querySelector('video'); if (video) queueSeek((pendingSeek === null ? video.currentTime : pendingSeek) + 30); });
  $('seek-position').addEventListener('input', function () { queueSeek(Number(this.value)); });
  ['audio-language', 'subtitle-language'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var video = $('video-host').querySelector('video'); if (!video) return;
      var chosen = Number(this.value); var audio = id === 'audio-language'; var tracks = audio ? video.audioTracks : video.textTracks;
      try { if (audio && tracks && tracks[chosen]) tracks[chosen].enabled = true; if (tracks) for (var i = 0; i < tracks.length; i += 1) { if (audio) tracks[i].enabled = i === chosen; else if (tracks[i].kind === 'subtitles' || tracks[i].kind === 'captions') tracks[i].mode = i === chosen ? 'showing' : 'disabled'; } }
      catch (_) { $('track-status').textContent = 'تعذر تغيير المسار على هذا الجهاز.'; }
    });
  });
  function scheduleAutoUpdate() {
    clearTimeout(autoUpdateTimer); autoUpdateTimer = null;
    if (playlistRunning) return;
    if (automaticReleasedView) {
      if (!document.hidden && !unloading) restoreReleasedCatalog('', true).then(function (restored) { if (restored) scheduleAutoUpdate(); });
      return;
    }
    if (!activePlaylistUrl || !activeCatalogSavedAt || document.hidden) return;
    var remaining = activeCatalogSavedAt + AUTO_UPDATE_MS - Date.now();
    if (remaining > 0) { autoUpdateTimer = setTimeout(scheduleAutoUpdate, Math.min(remaining, 2147483647)); return; }
    if (autoNextAttemptAt > Date.now()) { autoUpdateTimer = setTimeout(scheduleAutoUpdate, autoNextAttemptAt - Date.now()); return; }
    var browsing = lastState === 'idle' && playingIndex === null && !switchPending && setup.hidden && searchPanel.hidden && detailsPanel.hidden && diagnostics.hidden && speedPanel.hidden && !watchMode;
    if (!browsing) { autoUpdateTimer = setTimeout(scheduleAutoUpdate, 60000); return; }
    loadPlaylist(activePlaylistUrl, true);
  }
  function prepareForegroundAction() {
    if (!playlistRunning || !playlistAutomatic) return true;
    autoNextAttemptAt = Date.now() + 5 * 60 * 1000;
    if (cancelPlaylist()) { $('status').textContent = 'جارٍ استعادة القائمة السابقة… أعد المحاولة بعد لحظة'; return false; }
    $('status').textContent = 'جارٍ إتمام حفظ القائمة… أعد المحاولة بعد لحظة'; return false;
  }
  function playlistControls(running) {
    playlistRunning = running;
    if (!running) { playlistSaving = false; playlistAutomatic = false; }
    $('load-playlist').disabled = running;
    $('cancel-playlist').disabled = !running;
    $('playlist-url').disabled = running;
    $('refresh-saved').disabled = running;
    inputs.forEach(function (input) { input.disabled = running; });
    $('source-form').querySelector('button[type="submit"]').disabled = running;
    $('clear-sources').disabled = running;
  }
  function cancelPlaylist() {
    if (playlistSaving && !catalogStore.cancel()) { $('playlist-status').textContent = 'جارٍ إتمام الحفظ المحلي…'; return false; }
    var wasAutomatic = playlistAutomatic;
    playlistRevision += 1;
    playlistLoader.cancel();
    if (!playlistSaving) catalogStore.cancel();
    if (playlistRunning) $('playlist-status').textContent = 'أُلغي تحميل القائمة.';
    playlistControls(false);
    if (wasAutomatic) {
      autoNextAttemptAt = Math.max(autoNextAttemptAt, Date.now() + 5 * 60 * 1000);
      restoreReleasedCatalog('أُلغي التحديث التلقائي — عادت القائمة السابقة', !document.hidden).then(function (restored) { if (restored) scheduleAutoUpdate(); });
    }
    return true;
  }
  function openSetup() {
    cancelSwitch();
    setWatchMode(false);
    diagnostics.hidden = true;
    $('diagnostics-button').setAttribute('aria-expanded', 'false');
    $('playlist-url').value = '';
    inputs.forEach(function (input, index) { input.value = sourceMode === 'manual' && sources[index] ? sources[index].url : ''; });
    $('playlist-status').textContent = sourceMode === 'playlist' ? 'القائمة الحالية محفوظة محليًا. يمكنك تحديثها أو لصق رابط جديد.' : '';
    $('saved-catalog-status').textContent = activeCatalogRevision ? 'قائمة محفوظة: ' + sources.length + ' عنصرًا.' : 'لا توجد قائمة محفوظة.';
    $('refresh-saved').hidden = !activePlaylistUrl;
    $('form-error').textContent = '';
    playlistControls(playlistRunning);
    setup.hidden = false;
    // Keep the field unfocused until the user selects it. On webOS, focusing
    // an input while opening the dialog can leave it active without invoking
    // the system keyboard when it is selected afterward.
    $('source-form').focus();
  }
  function closeSetup() {
    if (!cancelPlaylist()) return;
    setup.hidden = true;
    $('playlist-url').value = '';
    inputs.forEach(function (input) { input.value = ''; });
    if (sources.length) focusSelected(); else $('start-button').focus();
    setTimeout(scheduleAutoUpdate, 0);
  }
  function closeDiagnostics() {
    diagnostics.hidden = true;
    $('diagnostics-button').setAttribute('aria-expanded', 'false');
    $('diagnostics-button').focus();
  }
  $('source-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (playlistRunning) return;
    var result = [];
    for (var index = 0; index < inputs.length; index += 1) {
      if (!inputs[index].value.trim()) continue;
      var url = api.validateSource(inputs[index].value);
      if (!url) {
        $('form-error').textContent = 'المصدر ' + (index + 1) + ': أدخل رابط HTTP أو HTTPS صالحًا.';
        inputs[index].focus(); return;
      }
      result.push(url);
    }
    if (!result.length) { $('form-error').textContent = 'أضف مصدرًا واحدًا على الأقل.'; inputs[0].focus(); return; }
    sourceGeneration += 1; catalogViewRevision += 1; favoritesRevision += 1; stop(); sources = result.map(function (url, index) { return { url: url, name: 'المصدر ' + (index + 1), group: '' }; });
    activePlaylistUrl = null; activeCatalogRevision = null; activeCatalogSavedAt = 0; clearTimeout(autoUpdateTimer); favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0;
    renderPrimary(); renderGroups(); renderChannels(); closeSetup();
    $('status').textContent = 'تم حفظ المصادر للجلسة — اختر قناة للتشغيل';
  });
  function loadPlaylist(url, automatic) {
    if (playlistRunning) return;
    var runtimeView = automatic ? captureRuntimeView() : null;
    sourceGeneration += 1; stop();
    if (automatic) releaseCatalogForAutomaticUpdate(runtimeView);
    var revision = ++playlistRevision;
    playlistAutomatic = !!automatic;
    playlistControls(true);
    if (automatic) $('status').textContent = 'جارٍ تحديث القائمة تلقائيًا…'; else { $('playlist-status').textContent = 'جارٍ تحميل القائمة…'; $('cancel-playlist').focus(); }
    playlistLoader.start(url).then(function (result) {
      if (revision !== playlistRevision || document.hidden || (!automatic && setup.hidden)) return;
      if (result.state !== 'complete' || result.truncated) {
        playlistControls(false);
        var messages = {
          timeout: 'انتهت مهلة تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.',
          empty: 'لم نجد روابط قنوات صالحة داخل القائمة.',
          unsupported: 'محرك التلفزيون لا يدعم طريقة تحميل القائمة.',
          invalid: 'رابط القائمة غير صالح.'
        };
        var failure = result.truncated ? 'لم تكتمل القائمة، لذلك احتفظنا بالنسخة المحفوظة السابقة.' : (messages[result.state] || 'تعذر تحميل القائمة. احتفظنا بالنسخة المحفوظة السابقة.');
        if (automatic) {
          autoNextAttemptAt = Date.now() + 60 * 60 * 1000;
          restoreReleasedCatalog('تعذر التحديث التلقائي — عادت القائمة السابقة', !document.hidden).then(function (restored) { if (restored) scheduleAutoUpdate(); });
        } else { $('playlist-status').textContent = failure; $('load-playlist').focus(); scheduleAutoUpdate(); }
        return;
      }
      if (automatic) $('status').textContent = 'اكتمل التنزيل، جارٍ حفظ القائمة…'; else $('playlist-status').textContent = 'اكتمل التنزيل، جارٍ حفظ القائمة محليًا…';
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
          } else { $('playlist-status').textContent = saveFailure; if (!document.hidden) $('load-playlist').focus(); scheduleAutoUpdate(); }
          return;
        }
        automaticReleasedView = null;
        automaticRestoreMessage = '';
        stop(); applyCatalog(result.entries, url, saved.revision, saved.savedAt, false); if (automatic) restoreRuntimeView(runtimeView, !document.hidden);
        var totals = { tv: 0, movies: 0, series: 0 }; sources.forEach(function (_, index) { totals[entrySection(index)] += 1; });
        $('status').textContent = (automatic ? 'تم تحديث القائمة تلقائيًا: ' : 'تم حفظ ') + sources.length + ' عنصرًا — بث ' + totals.tv + ' · أفلام ' + totals.movies + ' · مسلسلات ' + totals.series;
        playlistControls(false); autoNextAttemptAt = 0;
        if (!automatic) { if (document.hidden) { setup.hidden = true; $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; }); } else closeSetup(); }
        scheduleAutoUpdate();
      });
    });
  }
  $('load-playlist').addEventListener('click', function () {
    var url = api.validateSource($('playlist-url').value);
    if (!url) { $('playlist-status').textContent = 'أدخل رابط M3U كاملًا يبدأ بـ HTTP أو HTTPS.'; $('playlist-url').focus(); return; }
    loadPlaylist(url, false);
  });
  $('refresh-saved').addEventListener('click', function () { if (activePlaylistUrl) loadPlaylist(activePlaylistUrl, false); });
  $('cancel-playlist').addEventListener('click', function () { cancelPlaylist(); $('load-playlist').focus(); });
  $('clear-sources').addEventListener('click', function () {
    if (playlistRunning) return;
    sourceGeneration += 1; if (!cancelPlaylist()) return; stop(); $('clear-sources').disabled = true; $('playlist-status').textContent = 'جارٍ مسح القائمة المحفوظة…';
    catalogStore.clear().then(function (result) {
      $('clear-sources').disabled = false;
      if (result.state !== 'complete') { $('playlist-status').textContent = 'تعذر مسح القائمة المحفوظة. لم نغيّرها.'; return; }
      try { localStorage.removeItem(VIEW_KEY); } catch (_) {}
      catalogViewRevision += 1; favoritesRevision += 1; sources = []; activePlaylistUrl = null; activeCatalogRevision = null; activeCatalogSavedAt = 0; clearTimeout(autoUpdateTimer); favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
      $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
      $('saved-catalog-status').textContent = 'لا توجد قائمة محفوظة.'; $('refresh-saved').hidden = true; $('playlist-status').textContent = 'مُسحت القائمة المحفوظة.'; $('form-error').textContent = ''; inputs[0].focus();
    });
  });
  $('channel-search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 180); });
  $('clear-search').addEventListener('click', function () { $('channel-search').value = ''; renderSearch(); $('channel-search').focus(); });
  $('nav-search').addEventListener('click', openSearch);
  $('close-search').addEventListener('click', closeSearch);
  $('close-details').addEventListener('click', closeDetails);
  $('details-poster').addEventListener('error', function () { this.hidden = true; this.removeAttribute('src'); });
  $('details-play').addEventListener('click', function () { var index = detailsIndex; detailsPanel.hidden = true; detailsIndex = null; if (index !== null) activateChannel(index); });
  $('details-trailer').addEventListener('click', function () {
    if (!prepareForegroundAction()) return;
    var index = detailsIndex; var details = sources[index] || {};
    saveViewState(true);
    if (details.trailer) {
      detailsPanel.hidden = true; detailsIndex = null; playingIndex = null; $('movie-browser').hidden = true; $('empty-state').hidden = true;
      $('channel-title').textContent = 'الإعلان'; player.start(details.trailer, 'trailer', performance.now()); setWatchMode(true); return;
    }
    stop();
    var target = api.youtubeSearchTarget(details.name, details.year);
    if (!target || typeof window.PalmServiceBridge !== 'function') { $('details-status').textContent = 'تعذر فتح تطبيق YouTube مباشرة على هذا الجهاز.'; return; }
    $('details-status').textContent = 'جارٍ إرسال البحث إلى تطبيق YouTube…';
    try {
      youtubeBridge = new window.PalmServiceBridge();
      youtubeBridge.onservicecallback = function (raw) {
        var accepted = false;
        try { accepted = JSON.parse(raw).returnValue === true; } catch (_) {}
        $('details-status').textContent = accepted ? 'أُرسل طلب البحث إلى تطبيق YouTube.' : 'تعذر فتح تطبيق YouTube.';
        youtubeBridge = null;
      };
      youtubeBridge.call('luna://com.webos.applicationManager/launch', JSON.stringify({ id: 'youtube.leanback.v4', params: { contentTarget: target } }));
    } catch (_) { youtubeBridge = null; $('details-status').textContent = 'تعذر فتح تطبيق YouTube.'; }
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
      activeSection = event.currentTarget.dataset.section; activeGroup = ''; contentWindowStart = 0; channelWindowStart = 0;
      setPrimary(false); renderPrimary(); renderGroups(); renderChannels();
      saveViewState(false);
      var first = $('groups').querySelector('button'); if (first) first.focus();
    });
  });
  $('nav-settings').addEventListener('click', function () { setPrimary(false); openSetup(); });
  ['groups', 'channels'].forEach(function (id) { $(id).addEventListener('focusin', function () { setPrimary(false); }); });
  $('setup-button').addEventListener('click', openSetup);
  $('start-button').addEventListener('click', openSetup);
  $('close-setup').addEventListener('click', closeSetup);
  $('diagnostics-button').addEventListener('click', function () {
    cancelSwitch();
    diagnostics.hidden = !diagnostics.hidden;
    $('diagnostics-button').setAttribute('aria-expanded', String(!diagnostics.hidden));
    if (!diagnostics.hidden) $('close-diagnostics').focus();
  });
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
    if (speedRunning) $('speed-status').textContent = 'أُلغي الاختبار. البث متوقف؛ اختر قناة لتشغيله.';
    speedControls(false);
  }
  function closeSpeed() {
    cancelSpeed();
    speedPanel.hidden = true;
    $('speed-button').setAttribute('aria-expanded', 'false');
    $('speed-button').focus();
  }
  $('speed-button').addEventListener('click', function () {
    cancelSwitch(); setWatchMode(false);
    if (!setup.hidden) closeSetup();
    diagnostics.hidden = true;
    $('diagnostics-button').setAttribute('aria-expanded', 'false');
    speedConnection = null;
    $('speed-wired').setAttribute('aria-pressed', 'false');
    $('speed-wifi').setAttribute('aria-pressed', 'false');
    speedControls(false);
    $('speed-status').textContent = 'اختر نوع الاتصال لبدء الاختبار.';
    speedPanel.hidden = false;
    $('speed-button').setAttribute('aria-expanded', 'true');
    $('speed-wired').focus();
  });
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
    $('speed-status').textContent = 'جارٍ قياس التنزيل… حتى 8 ثوانٍ. البث متوقف.';
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
          speed.textContent = (item.connection === 'wired' ? 'كيبل' : 'واي فاي') + ' — ' + item.result.mbps.toFixed(1) + ' Mbps';
          var details = document.createElement('p');
          details.textContent = 'استجابة HTTP: ' + Math.round(item.result.httpMs) + ' ms · ' +
            (item.result.bytes / 1000000).toFixed(1) + ' MB خلال ' + (item.result.durationMs / 1000).toFixed(1) + ' ثانية';
          row.appendChild(speed); row.appendChild(details); $('speed-results').appendChild(row);
        });
        $('speed-status').textContent = 'اكتمل التقدير. آخر نتيجتين أدناه؛ البث يبقى متوقفًا.';
      } else {
        $('speed-status').textContent = result.state === 'unsupported' ?
          'هذا النظام لا يتيح طريقة القياس المطلوبة.' : result.state === 'cancelled' ? 'أُلغي الاختبار.' :
          'تعذر القياس. قد يكون خادم الاختبار أو الاتصال غير متاح؛ لا توجد نتيجة جديدة.';
      }
      $('speed-start').focus();
    });
  });

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
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    var key = event.key;
    if (!key || key === 'Unidentified') key = { 13: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' }[code];
    var isInput = event.target.tagName === 'INPUT';
    var isSelect = event.target.tagName === 'SELECT';
    if (isInput && keyboardVisible) return;
    var back = code === 461 || key === 'Escape';
    if (back) {
      event.preventDefault();
      if (!$('sort-menu').hidden) { $('sort-menu').hidden = true; $('sort-button').setAttribute('aria-expanded', 'false'); $('sort-button').focus(); }
      else if (!detailsPanel.hidden) closeDetails();
      else if (!setup.hidden) closeSetup();
      else if (!searchPanel.hidden) closeSearch();
      else if (!diagnostics.hidden) closeDiagnostics();
      else if (!speedPanel.hidden) closeSpeed();
      else if (watchMode) { if (!$('media-controls').hidden) { cancelSeek(); $('media-controls').hidden = true; document.body.focus(); } else exitPlayback(); }
      else if (lastState !== 'idle') { stop(); if (sources.length) focusSelected(); }
      else if (typeof window.webOS !== 'undefined' && window.webOS.platformBack) window.webOS.platformBack();
      else window.close();
      return;
    }
    var dialog = !$('sort-menu').hidden ? $('sort-menu') : !detailsPanel.hidden ? detailsPanel : !setup.hidden ? setup : !searchPanel.hidden ? searchPanel : !diagnostics.hidden ? diagnostics : !speedPanel.hidden ? speedPanel : null;
    if (dialog) {
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
    if (watchMode && !$('media-controls').hidden && (isInput || isSelect) && (key === 'ArrowUp' || key === 'ArrowDown')) { moveFocus($('media-controls'), key); event.preventDefault(); return; }
    if (watchMode && isSelect && (key === 'ArrowLeft' || key === 'ArrowRight')) { moveFocus($('media-controls'), key); event.preventDefault(); return; }
    if (isSelect || (isInput && key !== 'ArrowUp' && key !== 'ArrowDown')) return;
    if ((key === 'ArrowDown' && (moveChannelWindow(1) || moveContentWindow(4) || moveGroupFocus(1))) || (key === 'ArrowUp' && (moveChannelWindow(-1) || moveContentWindow(-4) || moveGroupFocus(-1)))) { event.preventDefault(); return; }
    if (watchMode && !$('media-controls').hidden && key === 'Enter' && $('media-controls').contains(document.activeElement)) return;
    if (watchMode && (key === 'Enter' || key === 'Tab' || /^Arrow/.test(key))) {
      if ($('media-controls').hidden) showPlaybackControls(); else if (key === 'Tab') { var mediaButtons = visibleControls($('media-controls')); var mediaPosition = mediaButtons.indexOf(document.activeElement); mediaButtons[(mediaPosition + (event.shiftKey ? -1 : 1) + mediaButtons.length) % mediaButtons.length].focus(); } else if (/^Arrow/.test(key)) moveFocus($('media-controls'), key);
      event.preventDefault(); return;
    }
    if ((code === 33 || code === 34 || code === 427 || code === 428 || key === 'PageUp' || key === 'PageDown') && sources.length) {
      var indexes = visibleIndexes();
      if (!indexes.length) return;
      var position = indexes.indexOf(selected);
      if (position < 0) position = 0;
      selected = indexes[(position + (code === 33 || code === 427 || key === 'PageUp' ? 1 : -1) + indexes.length) % indexes.length];
      if (!watchMode) focusSelected();
      requestChannel(selected, true); event.preventDefault(); return;
    }
    if (code === 19) { cancelSwitch(); player.pause(); event.preventDefault(); return; }
    if (code === 415) { cancelSwitch(); player.resume(); event.preventDefault(); return; }
    if (code === 413) { stop(); focusSelected(); event.preventDefault(); return; }
    if (key === ' ' || code === 10252) { cancelSwitch(); player.toggle(); event.preventDefault(); return; }
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
      setPrimary(false); var activeGroupButton = $('groups').querySelector('.group-button.active') || $('groups button');
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
    if (document.hidden) { cancelSpeed(); if (playlistAutomatic) { autoNextAttemptAt = Date.now() + 5 * 60 * 1000; cancelPlaylist(); } stop(); if (!setup.hidden) closeSetup(); }
    else if (!speedPanel.hidden) $('speed-wired').focus();
    else if (!detailsPanel.hidden) $('details-trailer').focus();
    else if (setup.hidden && diagnostics.hidden) focusSelected();
    if (!document.hidden) scheduleAutoUpdate();
  });
  window.addEventListener('pageshow', function () { unloading = false; scheduleAutoUpdate(); });
  window.addEventListener('pagehide', function () {
    unloading = true; clearTimeout(viewTimer); saveViewState(detailsIndex !== null); cancelPlaylist(); cancelSpeed(); speedResults = []; $('speed-results').replaceChildren(); stop();
    catalogViewRevision += 1; favoritesRevision += 1; sources = []; favorites = {}; activeGroup = ''; activeSection = 'tv'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
    $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
  });
  var restoreGeneration = sourceGeneration;
  renderPrimary(); renderGroups(); renderChannels(); $('start-button').focus();
  catalogStore.load().then(function (saved) {
    if (restoreGeneration !== sourceGeneration) return;
    if (saved.state === 'complete') {
      applyCatalog(saved.entries, saved.source, saved.revision, saved.savedAt, true);
      if (pendingViewState && pendingViewState.detailsOpen && sources[selected]) openDetails(selected); else focusSelected();
      scheduleAutoUpdate();
    }
  });
}());
