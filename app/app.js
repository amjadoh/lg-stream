(function () {
  'use strict';
  var api = window.LGStream;
  var playlistApi = window.LGPlaylist;
  var catalogStore = window.LGCatalogStore.createStore();
  var $ = function (id) { return document.getElementById(id); };
  var sources = [];
  var activePlaylistUrl = null;
  var activeCatalogRevision = null;
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
  var groupsCacheKey = '';
  var groupsCache = [];
  var nameCollator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('ar') : null;
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
  function visibleIndexes() {
    var cacheKey = [catalogViewRevision, favoritesRevision, activeSection, activeGroup, contentSort].join('\u0001');
    if (cacheKey === visibleCacheKey) return visibleCache;
    var group = activeGroup;
    var indexes = sources.map(function (_, index) { return index; }).filter(function (index) {
      if (activeSection === 'favorites' ? !favorites[index] : entrySection(index) !== activeSection) return false;
      if (group && sources[index].group !== group) return false;
      return true;
    });
    if ((activeSection === 'movies' || activeSection === 'series') && contentSort !== 'provider') {
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
    searchPanel.hidden = true; $('channel-search').value = ''; $('search-results').replaceChildren(); $('search-status').textContent = 'اكتب حرفين على الأقل.';
    setPrimary(false); var group = $('groups').querySelector('.group-button.active') || $('groups button'); if (group) group.focus();
  }
  function renderSearch() {
    var query = $('channel-search').value.trim().toLocaleLowerCase(); $('search-results').replaceChildren();
    if (query.length < 2) { $('search-status').textContent = 'اكتب حرفين على الأقل.'; return; }
    var sections = [['tv', 'البث المباشر'], ['movies', 'الأفلام'], ['series', 'المسلسلات']]; var total = 0;
    sections.forEach(function (section) {
      var matches = []; var count = 0;
      sources.forEach(function (entry, index) {
        if (entrySection(index) !== section[0] || (entry.name || '').toLocaleLowerCase().indexOf(query) < 0) return;
        count += 1; if (matches.length < 12) matches.push(index);
      });
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
  function applyCatalog(entries, source, revision, restored) {
    sources = entries;
    catalogViewRevision += 1; favoritesRevision += 1; activePlaylistUrl = source; activeCatalogRevision = revision; sourceMode = 'playlist'; favorites = {}; playingIndex = null;
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
  function sectionGroups() {
    var cacheKey = [catalogViewRevision, favoritesRevision, activeSection].join('\u0001');
    if (cacheKey === groupsCacheKey) return groupsCache;
    var groups = [];
    sources.forEach(function (entry, index) { var group = entry.group || '';
      if (group && (activeSection === 'favorites' ? favorites[index] : entrySection(index) === activeSection) && groups.indexOf(group) < 0) groups.push(group);
    });
    groupsCacheKey = cacheKey; groupsCache = groups; return groups;
  }
  function renderGroups() {
    var groups = sectionGroups();
    var sectionLabels = { tv: 'كل قنوات البث', movies: 'كل الأفلام', series: 'كل المسلسلات', favorites: 'كل المفضلة' };
    var items = [['', sectionLabels[activeSection]]].concat(groups.map(function (group) { return [group, group]; }));
    if (!items.some(function (item) { return item[0] === activeGroup; })) activeGroup = '';
    $('groups').replaceChildren();
    items.forEach(function (item) {
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
    $('details-status').textContent = details.trailer ? 'إعلان المزود متوفر.' : 'سيُفتح بحث YouTube باسم العمل فقط.';
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
    mountVideo: function (video) { $('video-host').appendChild(video); },
    unmountVideo: function (video) { video.remove(); },
    onState: function (state) {
      lastState = state.state;
      document.body.dataset.state = state.state;
      $('status').textContent = labels[state.state] || 'جاهز';
      if (state.state === 'error' && state.errorCode) $('status').textContent += ' (' + state.errorCode + ')';
      $('toggle-button').textContent = state.state === 'paused' ? 'متابعة البث' : 'إيقاف مؤقت';
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
    if (next === position) return false;
    if (next >= contentWindowStart && next < contentWindowStart + contentWindowSize) {
      if (rawNext === next) return false;
      var edgeCard = $('movie-grid').querySelector('[data-index="' + indexes[next] + '"]'); if (edgeCard) edgeCard.focus(); return !!edgeCard;
    }
    contentWindowStart = step > 0 ? Math.floor(Math.max(0, next - (contentWindowSize - 4)) / 4) * 4 : Math.floor(next / 4) * 4;
    contentWindowStart = Math.min(contentMaxStart(indexes.length), contentWindowStart); renderChannels();
    var card = $('movie-grid').querySelector('[data-index="' + indexes[next] + '"]'); if (card) card.focus(); return true;
  }
  function moveChannelWindow(step) {
    if (activeSection === 'movies' || activeSection === 'series' || !document.activeElement.classList.contains('channel-button')) return false;
    var indexes = visibleIndexes(); var position = indexes.indexOf(selected); var next = position + step;
    if (next < 0 || next >= indexes.length) return false;
    if (next >= channelWindowStart && next < channelWindowStart + channelWindowSize) return false;
    channelWindowStart = Math.max(0, next - (step > 0 ? 4 : channelWindowSize - 5)); renderChannels(); focusChannel(indexes[next]); return true;
  }
  function playChannel(intent) {
    var index = intent.index;
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
  var lastConfirmIndex = null;
  var lastConfirmAt = 0;
  function activateChannel(index) {
    var now = performance.now();
    if (playingIndex === index && lastConfirmIndex === index && now - lastConfirmAt <= 700) {
      scheduler.cancel(); setWatchMode(true); lastConfirmIndex = null; lastConfirmAt = 0; return;
    }
    lastConfirmIndex = index; lastConfirmAt = now; requestChannel(index, false);
  }
  function requestChannel(index, coalesce, retry) {
    var intent = { index: index, requestedAt: performance.now(), retry: !!retry };
    if (coalesce) scheduler.request(intent); else scheduler.immediate(intent);
  }
  function stop() {
    scheduler.cancel();
    setWatchMode(false);
    playingIndex = null;
    player.stop();
    updateChannelStates();
    $('channel-title').textContent = 'لا يوجد بث محدد';
    $('empty-state').hidden = false;
    $('retry-button').disabled = true;
  }
  function setWatchMode(enabled) {
    watchMode = enabled;
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
  $('fullscreen-button').addEventListener('click', function () { scheduler.cancel(); setWatchMode(true); });
  $('fit-button').addEventListener('click', function () {
    fitIndex = (fitIndex + 1) % fitModes.length;
    $('video-host').dataset.fit = fitModes[fitIndex].value;
    $('fit-button').textContent = 'الصورة: ' + fitModes[fitIndex].label;
  });
  $('video-host').addEventListener('click', function () { if (watchMode) { setWatchMode(false); focusSelected(); } });
  function playlistControls(running) {
    playlistRunning = running;
    if (!running) playlistSaving = false;
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
    playlistRevision += 1;
    playlistLoader.cancel();
    if (!playlistSaving) catalogStore.cancel();
    if (playlistRunning) $('playlist-status').textContent = 'أُلغي تحميل القائمة.';
    playlistControls(false);
    return true;
  }
  function openSetup() {
    scheduler.cancel();
    setWatchMode(false);
    diagnostics.hidden = true;
    $('diagnostics-button').setAttribute('aria-expanded', 'false');
    $('playlist-url').value = '';
    inputs.forEach(function (input, index) { input.value = sourceMode === 'manual' && sources[index] ? sources[index].url : ''; });
    $('playlist-status').textContent = sourceMode === 'playlist' ? 'القائمة الحالية محفوظة محليًا. يمكنك تحديثها أو لصق رابط جديد.' : '';
    $('saved-catalog-status').textContent = activeCatalogRevision ? 'قائمة محفوظة: ' + sources.length + ' عنصرًا.' : 'لا توجد قائمة محفوظة.';
    $('refresh-saved').hidden = !activePlaylistUrl;
    $('form-error').textContent = '';
    playlistControls(false);
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
    activePlaylistUrl = null; activeCatalogRevision = null; favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0;
    renderPrimary(); renderGroups(); renderChannels(); closeSetup();
    $('status').textContent = 'تم حفظ المصادر للجلسة — اختر قناة للتشغيل';
  });
  function loadPlaylist(url) {
    if (playlistRunning) return;
    sourceGeneration += 1; stop();
    var revision = ++playlistRevision;
    playlistControls(true);
    $('playlist-status').textContent = 'جارٍ تحميل القائمة…';
    $('cancel-playlist').focus();
    playlistLoader.start(url).then(function (result) {
      if (revision !== playlistRevision || setup.hidden || document.hidden) return;
      if (result.state !== 'complete' || result.truncated) {
        playlistControls(false);
        var messages = {
          timeout: 'انتهت مهلة تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.',
          empty: 'لم نجد روابط قنوات صالحة داخل القائمة.',
          unsupported: 'محرك التلفزيون لا يدعم طريقة تحميل القائمة.',
          invalid: 'رابط القائمة غير صالح.'
        };
        $('playlist-status').textContent = result.truncated ? 'لم تكتمل القائمة، لذلك احتفظنا بالنسخة المحفوظة السابقة.' : (messages[result.state] || 'تعذر تحميل القائمة. احتفظنا بالنسخة المحفوظة السابقة.');
        $('load-playlist').focus(); return;
      }
      $('playlist-status').textContent = 'اكتمل التنزيل، جارٍ حفظ القائمة محليًا…';
      playlistSaving = true;
      $('cancel-playlist').disabled = false;
      catalogStore.save(url, result.entries).then(function (saved) {
        if (revision !== playlistRevision || setup.hidden || document.hidden) return;
        if (saved.state !== 'complete') {
          playlistControls(false); $('playlist-status').textContent = saved.state === 'quota' ? 'مساحة التخزين لا تكفي. احتفظنا بالقائمة السابقة.' : 'تعذر حفظ القائمة. احتفظنا بالقائمة السابقة.'; $('load-playlist').focus(); return;
        }
        stop(); applyCatalog(result.entries, url, saved.revision, false);
        var totals = { tv: 0, movies: 0, series: 0 }; sources.forEach(function (_, index) { totals[entrySection(index)] += 1; });
        $('status').textContent = 'تم حفظ ' + sources.length + ' عنصرًا — بث ' + totals.tv + ' · أفلام ' + totals.movies + ' · مسلسلات ' + totals.series;
        closeSetup();
      });
    });
  }
  $('load-playlist').addEventListener('click', function () {
    var url = api.validateSource($('playlist-url').value);
    if (!url) { $('playlist-status').textContent = 'أدخل رابط M3U كاملًا يبدأ بـ HTTP أو HTTPS.'; $('playlist-url').focus(); return; }
    loadPlaylist(url);
  });
  $('refresh-saved').addEventListener('click', function () { if (activePlaylistUrl) loadPlaylist(activePlaylistUrl); });
  $('cancel-playlist').addEventListener('click', function () { cancelPlaylist(); $('load-playlist').focus(); });
  $('clear-sources').addEventListener('click', function () {
    if (playlistRunning) return;
    sourceGeneration += 1; if (!cancelPlaylist()) return; stop(); $('clear-sources').disabled = true; $('playlist-status').textContent = 'جارٍ مسح القائمة المحفوظة…';
    catalogStore.clear().then(function (result) {
      $('clear-sources').disabled = false;
      if (result.state !== 'complete') { $('playlist-status').textContent = 'تعذر مسح القائمة المحفوظة. لم نغيّرها.'; return; }
      try { localStorage.removeItem(VIEW_KEY); } catch (_) {}
      catalogViewRevision += 1; favoritesRevision += 1; sources = []; activePlaylistUrl = null; activeCatalogRevision = null; favorites = {}; activeGroup = ''; activeSection = 'tv'; sourceMode = 'manual'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
      $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
      $('saved-catalog-status').textContent = 'لا توجد قائمة محفوظة.'; $('refresh-saved').hidden = true; $('playlist-status').textContent = 'مُسحت القائمة المحفوظة.'; $('form-error').textContent = ''; inputs[0].focus();
    });
  });
  $('channel-search').addEventListener('input', renderSearch);
  $('clear-search').addEventListener('click', function () { $('channel-search').value = ''; renderSearch(); $('channel-search').focus(); });
  $('nav-search').addEventListener('click', openSearch);
  $('close-search').addEventListener('click', closeSearch);
  $('close-details').addEventListener('click', closeDetails);
  $('details-poster').addEventListener('error', function () { this.hidden = true; this.removeAttribute('src'); });
  $('details-play').addEventListener('click', function () { var index = detailsIndex; detailsPanel.hidden = true; detailsIndex = null; if (index !== null) activateChannel(index); });
  $('details-trailer').addEventListener('click', function () {
    var index = detailsIndex; var details = sources[index] || {};
    saveViewState(true);
    if (details.trailer) {
      detailsPanel.hidden = true; detailsIndex = null; playingIndex = null; $('movie-browser').hidden = true; $('empty-state').hidden = true;
      $('channel-title').textContent = 'الإعلان'; player.start(details.trailer, 'trailer', performance.now()); setWatchMode(true); return;
    }
    stop();
    var query = (details.name || '') + (details.year ? ' ' + details.year : '') + ' trailer';
    var target = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query.trim());
    if (typeof window.PalmServiceBridge === 'function') {
      try {
        var bridge = new window.PalmServiceBridge();
        bridge.onservicecallback = function (raw) { try { if (JSON.parse(raw).returnValue === false) $('details-status').textContent = 'تعذر فتح متصفح LG.'; } catch (_) {} };
        bridge.call('luna://com.webos.applicationManager/launch', JSON.stringify({ id: 'com.webos.app.browser', params: { target: target } }));
        return;
      } catch (_) {}
    }
    var opened = window.open(target, '_blank');
    if (!opened) $('details-status').textContent = 'تعذر فتح متصفح LG.';
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
    scheduler.cancel();
    diagnostics.hidden = !diagnostics.hidden;
    $('diagnostics-button').setAttribute('aria-expanded', String(!diagnostics.hidden));
    if (!diagnostics.hidden) $('close-diagnostics').focus();
  });
  $('close-diagnostics').addEventListener('click', closeDiagnostics);
  $('toggle-button').addEventListener('click', function () { scheduler.cancel(); player.toggle(); });
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
    scheduler.cancel(); setWatchMode(false);
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
      else if (watchMode) { setWatchMode(false); focusSelected(); }
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
    if (isSelect || (isInput && key !== 'ArrowUp' && key !== 'ArrowDown')) return;
    if ((key === 'ArrowDown' && (moveChannelWindow(1) || moveContentWindow(4))) || (key === 'ArrowUp' && (moveChannelWindow(-1) || moveContentWindow(-4)))) { event.preventDefault(); return; }
    if (watchMode && (key === 'Enter' || key === 'Tab' || /^Arrow/.test(key))) {
      setWatchMode(false); focusSelected(); event.preventDefault(); return;
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
    if (code === 19) { scheduler.cancel(); player.pause(); event.preventDefault(); return; }
    if (code === 415) { scheduler.cancel(); player.resume(); event.preventDefault(); return; }
    if (code === 413) { stop(); focusSelected(); event.preventDefault(); return; }
    if (key === ' ' || code === 10252) { scheduler.cancel(); player.toggle(); event.preventDefault(); return; }
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
    if (document.hidden) { cancelSpeed(); stop(); if (!setup.hidden) closeSetup(); }
    else if (!speedPanel.hidden) $('speed-wired').focus();
    else if (!detailsPanel.hidden) $('details-trailer').focus();
    else if (setup.hidden && diagnostics.hidden) focusSelected();
  });
  window.addEventListener('pageshow', function () { unloading = false; });
  window.addEventListener('pagehide', function () {
    unloading = true; clearTimeout(viewTimer); saveViewState(detailsIndex !== null); cancelPlaylist(); cancelSpeed(); speedResults = []; $('speed-results').replaceChildren(); stop();
    sources = []; favorites = {}; activeGroup = ''; activeSection = 'tv'; selected = 0; contentWindowStart = 0; channelWindowStart = 0; renderPrimary(); renderGroups(); renderChannels();
    $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
  });
  var restoreGeneration = sourceGeneration;
  renderPrimary(); renderGroups(); renderChannels(); $('start-button').focus();
  catalogStore.load().then(function (saved) {
    if (restoreGeneration !== sourceGeneration) return;
    if (saved.state === 'complete') {
      applyCatalog(saved.entries, saved.source, saved.revision, true);
      if (pendingViewState && pendingViewState.detailsOpen && sources[selected]) openDetails(selected); else focusSelected();
    }
  });
}());
