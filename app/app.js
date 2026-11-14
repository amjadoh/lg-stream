(function () {
  'use strict';
  var api = window.LGStream;
  var $ = function (id) { return document.getElementById(id); };
  var sources = [];
  var selected = 0;
  var playingIndex = null;
  var lastState = 'idle';
  var keyboardVisible = false;
  var watchMode = false;
  var hintTimer = null;
  var setup = $('setup-panel');
  var diagnostics = $('diagnostics-panel');
  var speedPanel = $('speed-panel');
  var speedTest = window.LGSpeedTest.createTest();
  var speedConnection = null;
  var speedRunning = false;
  var speedRevision = 0;
  var speedResults = [];
  var inputs = [$('source-1'), $('source-2'), $('source-3')];
  var labels = {
    idle: 'جاهز', loading: 'جارٍ فتح البث…', playing: 'يعمل', waiting: 'بانتظار البث…',
    paused: 'متوقف مؤقتًا', ended: 'انتهى البث', error: 'تعذر تشغيل المصدر — جرّب إعادة المحاولة',
    'play-rejected': 'لم يبدأ التشغيل — اضغط إعادة المحاولة',
    'startup-timeout': 'انتهت مهلة بدء البث — اضغط إعادة المحاولة'
  };
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
      $('error-code').textContent = state.errorCode || '—';
    }
  });
  function updateChannelStates() {
    Array.prototype.forEach.call($('channels').children, function (button, index) {
      var current = playingIndex === index;
      button.classList.toggle('active', current);
      button.setAttribute('aria-pressed', String(current));
      button.querySelector('.channel-state').textContent = current ? (labels[lastState] || '') : 'اضغط موافق';
    });
  }
  function renderChannels() {
    $('channels').replaceChildren();
    $('channel-empty').hidden = sources.length > 0;
    $('empty-title').textContent = sources.length ? 'اختر قناة وابدأ المشاهدة' : 'مساحتك للمشاهدة';
    $('empty-description').textContent = sources.length ? 'تنقّل بالأسهم، ثم اضغط موافق على القناة.' : 'أضف مصادر البث، وخلك أقرب للمشاهدة.';
    $('start-button').textContent = sources.length ? 'تعديل المصادر' : 'إضافة مصادر البث';
    sources.forEach(function (_, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-button' + (playingIndex === index ? ' active' : '');
      button.dataset.index = index;
      var number = document.createElement('span');
      number.className = 'channel-number'; number.textContent = '0' + (index + 1);
      var label = document.createElement('span');
      label.className = 'channel-label'; label.textContent = 'المصدر ' + (index + 1);
      var state = document.createElement('span'); state.className = 'channel-state';
      button.appendChild(number); button.appendChild(label); button.appendChild(state);
      button.setAttribute('aria-pressed', playingIndex === index ? 'true' : 'false');
      button.addEventListener('focus', function () { selected = index; });
      button.addEventListener('click', function () { requestChannel(index, false); });
      $('channels').appendChild(button);
    });
    updateChannelStates();
  }
  function focusChannel(index) {
    var button = $('channels').children[index];
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
    $('empty-state').hidden = true;
    $('channel-title').textContent = 'المصدر ' + (index + 1);
    if (!watchMode) focusChannel(index);
    player.start(sources[index], index + 1, intent.requestedAt);
  }
  var scheduler = api.createSwitchScheduler(playChannel);
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
  $('video-host').addEventListener('click', function () { if (watchMode) { setWatchMode(false); focusChannel(selected); } });
  function openSetup() {
    scheduler.cancel();
    setWatchMode(false);
    diagnostics.hidden = true;
    $('diagnostics-button').setAttribute('aria-expanded', 'false');
    inputs.forEach(function (input, index) { input.value = sources[index] || ''; });
    $('form-error').textContent = '';
    setup.hidden = false;
    inputs[0].focus();
  }
  function closeSetup() {
    setup.hidden = true;
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
    stop(); sources = result; selected = 0;
    renderChannels(); closeSetup();
    $('status').textContent = 'تم حفظ المصادر للجلسة — اختر قناة للتشغيل';
  });
  $('clear-sources').addEventListener('click', function () {
    stop(); sources = []; selected = 0; renderChannels();
    inputs.forEach(function (input) { input.value = ''; });
    $('form-error').textContent = ''; inputs[0].focus();
  });
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
    return Array.prototype.filter.call(container.querySelectorAll('button,input'), function (item) {
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
    if (!setup.hidden && keyboardVisible) return;
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
    if (watchMode && (key === 'Enter' || key === 'Tab' || /^Arrow/.test(key))) {
      setWatchMode(false); focusChannel(selected); event.preventDefault(); return;
    }
    if ((code === 33 || code === 34 || code === 427 || code === 428 || key === 'PageUp' || key === 'PageDown') && sources.length) {
      selected = (selected + (code === 33 || code === 427 || key === 'PageUp' ? 1 : -1) + sources.length) % sources.length;
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
  window.addEventListener('pagehide', function () { cancelSpeed(); speedResults = []; $('speed-results').replaceChildren(); stop(); sources = []; selected = 0; renderChannels(); inputs.forEach(function (input) { input.value = ''; }); });
  renderChannels();
  $('start-button').focus();
}());
