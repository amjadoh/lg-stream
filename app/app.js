(function () {
  'use strict';
  var api = window.LGStream;
  var playlistApi = window.LGPlaylist;
  var $ = function (id) { return document.getElementById(id); };
  var sources = [];
  var sourceNames = [];
  var sourceGroups = [];
  var favorites = {};
  var activeGroup = '';
  var sourceMode = 'manual';
  var selected = 0;
  var channelPage = 0;
  var pageSize = 4;
  var playingIndex = null;
  var lastState = 'idle';
  var keyboardVisible = false;
  var watchMode = false;
  var hintTimer = null;
  var fitIndex = 0;
  var fitModes = [{ value: 'contain', label: 'ملائم' }, { value: 'cover', label: 'ملء' }, { value: 'fill', label: 'تمديد' }];
  var setup = $('setup-panel');
  var diagnostics = $('diagnostics-panel');
  var speedPanel = $('speed-panel');
  var speedTest = window.LGSpeedTest.createTest();
  var speedConnection = null;
  var speedRunning = false;
  var speedRevision = 0;
  var speedResults = [];
  var playlistLoader = playlistApi.createLoader();
  var playlistRevision = 0;
  var playlistRunning = false;
  var inputs = [$('source-1'), $('source-2'), $('source-3')];
  var labels = {
    idle: 'جاهز', loading: 'جارٍ فتح البث…', playing: 'يعمل', waiting: 'بانتظار البث…',
    paused: 'متوقف مؤقتًا', ended: 'انتهى البث', error: 'تعذر تشغيل المصدر — جرّب إعادة المحاولة',
    'play-rejected': 'لم يبدأ التشغيل — اضغط إعادة المحاولة',
    'startup-timeout': 'انتهت مهلة بدء البث — اضغط إعادة المحاولة'
  };
  function isMovieGroup(group) { return /movie|film|cinema|vod|أفلام|افلام|سينما/i.test(group || ''); }
  function visibleIndexes() {
    var group = activeGroup;
    var query = $('channel-search').value.trim().toLocaleLowerCase();
    return sources.map(function (_, index) { return index; }).filter(function (index) {
      if (group === '__favorites' && !favorites[index]) return false;
      if (group && group !== '__favorites' && sourceGroups[index] !== group) return false;
      return !query || (sourceNames[index] || '').toLocaleLowerCase().indexOf(query) >= 0;
    });
  }
  function renderGroups() {
    var groups = [];
    sourceGroups.forEach(function (group) { if (group && groups.indexOf(group) < 0) groups.push(group); });
    var items = [['', 'كل القنوات'], ['__favorites', '★ المفضلة']].concat(groups.map(function (group) { return [group, group]; }));
    if (!items.some(function (item) { return item[0] === activeGroup; })) activeGroup = '';
    $('groups').replaceChildren();
    items.forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'group-button' + (item[0] === activeGroup ? ' active' : '');
      button.dataset.group = item[0]; button.textContent = item[1];
      button.addEventListener('click', function (event) {
        activeGroup = event.currentTarget.dataset.group; channelPage = 0; renderGroups(); renderChannels();
        var first = $('channels').querySelector('.channel-button'); if (first) first.focus();
      });
      $('groups').appendChild(button);
    });
  }
  function renderMovies(indexes) {
    var movies = isMovieGroup(activeGroup);
    $('movie-browser').hidden = !movies;
    if (!movies) return;
    $('movie-title').textContent = activeGroup;
    $('movie-grid').replaceChildren();
    indexes.slice(0, 8).forEach(function (index) {
      var card = document.createElement('button'); card.type = 'button'; card.className = 'movie-card'; card.dataset.index = index;
      var name = document.createElement('span'); name.textContent = sourceNames[index] || 'فيلم'; card.appendChild(name);
      card.addEventListener('click', function () { activateChannel(index); }); $('movie-grid').appendChild(card);
    });
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
      button.querySelector('.channel-state').textContent = current ? (labels[lastState] || '') : (sourceGroups[index] || 'اضغط موافق');
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
    var pageCount = Math.max(1, Math.ceil(indexes.length / pageSize));
    channelPage = Math.max(0, Math.min(channelPage, pageCount - 1));
    var start = channelPage * pageSize;
    var end = Math.min(start + pageSize, indexes.length);
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
      label.className = 'channel-label'; label.textContent = sourceNames[index] || 'المصدر ' + (index + 1);
      var state = document.createElement('span'); state.className = 'channel-state';
      state.textContent = sourceGroups[index] || 'اضغط موافق';
      button.appendChild(number); button.appendChild(label); button.appendChild(state);
      button.setAttribute('aria-pressed', playingIndex === index ? 'true' : 'false');
      button.addEventListener('focus', function (event) { selected = Number(event.currentTarget.dataset.index); });
      button.addEventListener('click', function (event) { activateChannel(Number(event.currentTarget.dataset.index)); });
      var favorite = document.createElement('button');
      favorite.type = 'button'; favorite.className = 'favorite-button'; favorite.dataset.favoriteIndex = index;
      favorite.textContent = favorites[index] ? '★' : '☆'; favorite.setAttribute('aria-pressed', String(!!favorites[index]));
      favorite.setAttribute('aria-label', (favorites[index] ? 'إزالة من المفضلة: ' : 'إضافة إلى المفضلة: ') + (sourceNames[index] || 'القناة'));
      favorite.addEventListener('click', function (event) {
        var ownIndex = Number(event.currentTarget.dataset.favoriteIndex);
        favorites[ownIndex] = !favorites[ownIndex];
        if (!favorites[ownIndex]) delete favorites[ownIndex];
        renderChannels();
        var target = $('channels').querySelector('[data-favorite-index="' + ownIndex + '"]');
        if (target) target.focus(); else if ($('channels').querySelector('button')) $('channels').querySelector('button').focus();
      });
      row.appendChild(button); row.appendChild(favorite); $('channels').appendChild(row);
    }
    $('channel-paging').hidden = indexes.length <= pageSize;
    $('page-label').textContent = (channelPage + 1) + ' من ' + pageCount;
    $('previous-page').disabled = channelPage === 0;
    $('next-page').disabled = channelPage >= pageCount - 1;
    updateChannelStates();
  }
  function focusChannel(index) {
    var indexes = visibleIndexes();
    var position = indexes.indexOf(index);
    if (position < 0) { if ($('channels').querySelector('button')) $('channels').querySelector('button').focus(); else if ($('groups button')) $('groups button').focus(); return; }
    var targetPage = Math.floor(position / pageSize);
    if (targetPage !== channelPage) { channelPage = targetPage; renderChannels(); }
    var button = $('channels').querySelector('[data-index="' + index + '"]');
    if (button) button.focus();
    else $('start-button').focus();
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
    $('channel-title').textContent = sourceNames[index] || 'المصدر ' + (index + 1);
    if (!watchMode) focusChannel(index);
    player.start(sources[index], index + 1, intent.requestedAt);
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
  $('video-host').addEventListener('click', function () { if (watchMode) { setWatchMode(false); focusChannel(selected); } });
  function playlistControls(running) {
    playlistRunning = running;
    $('load-playlist').disabled = running;
    $('cancel-playlist').disabled = !running;
    $('playlist-url').disabled = running;
  }
  function cancelPlaylist() {
    playlistRevision += 1;
    playlistLoader.cancel();
    if (playlistRunning) $('playlist-status').textContent = 'أُلغي تحميل القائمة.';
    playlistControls(false);
  }
  function openSetup() {
    scheduler.cancel();
    setWatchMode(false);
    diagnostics.hidden = true;
    $('diagnostics-button').setAttribute('aria-expanded', 'false');
    $('playlist-url').value = '';
    inputs.forEach(function (input, index) { input.value = sourceMode === 'manual' ? (sources[index] || '') : ''; });
    $('playlist-status').textContent = sourceMode === 'playlist' ? 'القائمة الحالية محمّلة في الذاكرة. الصق رابطًا جديدًا لاستبدالها.' : '';
    $('form-error').textContent = '';
    playlistControls(false);
    setup.hidden = false;
    // Keep the field unfocused until the user selects it. On webOS, focusing
    // an input while opening the dialog can leave it active without invoking
    // the system keyboard when it is selected afterward.
    $('source-form').focus();
  }
  function closeSetup() {
    cancelPlaylist();
    setup.hidden = true;
    $('playlist-url').value = '';
    inputs.forEach(function (input) { input.value = ''; });
    if (sources.length) focusChannel(selected); else $('start-button').focus();
  }
  function closeDiagnostics() {
    diagnostics.hidden = true;
    $('diagnostics-button').setAttribute('aria-expanded', 'false');
    $('diagnostics-button').focus();
  }
  $('source-form').addEventListener('submit', function (event) {
    event.preventDefault();
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
    stop(); sources = result; sourceNames = result.map(function (_, index) { return 'المصدر ' + (index + 1); });
    sourceGroups = result.map(function () { return ''; }); favorites = {}; activeGroup = ''; sourceMode = 'manual'; selected = 0; channelPage = 0;
    renderGroups(); renderChannels(); closeSetup();
    $('status').textContent = 'تم حفظ المصادر للجلسة — اختر قناة للتشغيل';
  });
  $('load-playlist').addEventListener('click', function () {
    if (playlistRunning) return;
    var url = api.validateSource($('playlist-url').value);
    if (!url) { $('playlist-status').textContent = 'أدخل رابط M3U كاملًا يبدأ بـ HTTP أو HTTPS.'; $('playlist-url').focus(); return; }
    stop();
    var revision = ++playlistRevision;
    playlistControls(true);
    $('playlist-status').textContent = 'جارٍ تحميل القائمة…';
    $('cancel-playlist').focus();
    playlistLoader.start(url).then(function (result) {
      if (revision !== playlistRevision || setup.hidden || document.hidden) return;
      playlistControls(false);
      if (result.state !== 'complete') {
        var messages = {
          timeout: 'انتهت مهلة تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.',
          empty: 'لم نجد روابط قنوات صالحة داخل القائمة.',
          unsupported: 'محرك التلفزيون لا يدعم طريقة تحميل القائمة.',
          invalid: 'رابط القائمة غير صالح.'
        };
        $('playlist-status').textContent = messages[result.state] || 'تعذر تحميل القائمة. قد يمنع المزود الطلب من تطبيق التلفزيون.';
        $('load-playlist').focus(); return;
      }
      sources = result.entries.map(function (entry) { return entry.url; });
      sourceNames = result.entries.map(function (entry) { return entry.name; });
      sourceGroups = result.entries.map(function (entry) { return entry.group; });
      favorites = {}; activeGroup = ''; sourceMode = 'playlist'; selected = 0; channelPage = 0; playingIndex = null;
      renderGroups(); renderChannels();
      $('status').textContent = 'تم تحميل ' + sources.length + ' عنصرًا للجلسة' + (result.truncated ? ' — اكتملت عينة القائمة' : '');
      closeSetup();
    });
  });
  $('cancel-playlist').addEventListener('click', function () { cancelPlaylist(); $('load-playlist').focus(); });
  $('clear-sources').addEventListener('click', function () {
    cancelPlaylist(); stop(); sources = []; sourceNames = []; sourceGroups = []; favorites = {}; activeGroup = ''; sourceMode = 'manual'; selected = 0; channelPage = 0; renderGroups(); renderChannels();
    $('playlist-url').value = '';
    inputs.forEach(function (input) { input.value = ''; });
    $('form-error').textContent = ''; inputs[0].focus();
  });
  $('previous-page').addEventListener('click', function () {
    var indexes = visibleIndexes();
    if (channelPage > 0) { channelPage -= 1; renderChannels(); focusChannel(indexes[channelPage * pageSize]); }
  });
  $('next-page').addEventListener('click', function () {
    var indexes = visibleIndexes();
    if ((channelPage + 1) * pageSize < indexes.length) { channelPage += 1; renderChannels(); focusChannel(indexes[channelPage * pageSize]); }
  });
  $('channel-search').addEventListener('input', function () { channelPage = 0; renderChannels(); });
  $('clear-search').addEventListener('click', function () { $('channel-search').value = ''; channelPage = 0; renderChannels(); $('channel-search').focus(); });
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
  $('stop-button').addEventListener('click', function () { stop(); if (sources.length) focusChannel(selected); else $('start-button').focus(); });

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
      if (!setup.hidden) closeSetup();
      else if (!diagnostics.hidden) closeDiagnostics();
      else if (!speedPanel.hidden) closeSpeed();
      else if (watchMode) { setWatchMode(false); focusChannel(selected); }
      else if (lastState !== 'idle') { stop(); if (sources.length) focusChannel(selected); }
      else if (typeof window.webOS !== 'undefined' && window.webOS.platformBack) window.webOS.platformBack();
      else window.close();
      return;
    }
    var dialog = !setup.hidden ? setup : !diagnostics.hidden ? diagnostics : !speedPanel.hidden ? speedPanel : null;
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
    if (watchMode && (key === 'Enter' || key === 'Tab' || /^Arrow/.test(key))) {
      setWatchMode(false); focusChannel(selected); event.preventDefault(); return;
    }
    if ((code === 33 || code === 34 || code === 427 || code === 428 || key === 'PageUp' || key === 'PageDown') && sources.length) {
      var indexes = visibleIndexes();
      if (!indexes.length) return;
      var position = indexes.indexOf(selected);
      if (position < 0) position = 0;
      selected = indexes[(position + (code === 33 || code === 427 || key === 'PageUp' ? 1 : -1) + indexes.length) % indexes.length];
      if (!watchMode) focusChannel(selected);
      requestChannel(selected, true); event.preventDefault(); return;
    }
    if (code === 19) { scheduler.cancel(); player.pause(); event.preventDefault(); return; }
    if (code === 415) { scheduler.cancel(); player.resume(); event.preventDefault(); return; }
    if (code === 413) { stop(); focusChannel(selected); event.preventDefault(); return; }
    if (key === ' ' || code === 10252) { scheduler.cancel(); player.toggle(); event.preventDefault(); return; }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      moveFocus(document.querySelector('.shell'), key);
      event.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelSpeed(); stop(); if (!setup.hidden) closeSetup(); }
    else if (!speedPanel.hidden) $('speed-wired').focus();
    else if (setup.hidden && diagnostics.hidden) focusChannel(selected);
  });
  window.addEventListener('pagehide', function () {
    cancelPlaylist(); cancelSpeed(); speedResults = []; $('speed-results').replaceChildren(); stop();
    sources = []; sourceNames = []; sourceGroups = []; favorites = {}; activeGroup = ''; selected = 0; channelPage = 0; renderGroups(); renderChannels();
    $('playlist-url').value = ''; inputs.forEach(function (input) { input.value = ''; });
  });
  renderGroups(); renderChannels();
  $('start-button').focus();
}());
