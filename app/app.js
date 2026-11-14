(function () {
  'use strict';
  var api = window.LGStream;
  var $ = function (id) { return document.getElementById(id); };
  var sources = [];
  var selected = 0;
  var playingIndex = null;
  var lastState = 'idle';
  var keyboardVisible = false;
  var setup = $('setup-panel');
  var diagnostics = $('diagnostics-panel');
  var inputs = [$('source-1'), $('source-2'), $('source-3')];
  var labels = {
    idle: 'جاهز', loading: 'جارٍ فتح البث…', playing: 'يعمل', waiting: 'بانتظار البث…',
    paused: 'متوقف مؤقتًا', ended: 'انتهى البث', error: 'تعذر تشغيل المصدر — جرّب إعادة المحاولة',
    'play-rejected': 'لم يبدأ التشغيل — اضغط إعادة المحاولة'
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
      $('status').textContent = labels[state.state] || 'جاهز';
      $('toggle-button').textContent = state.state === 'paused' ? 'متابعة البث' : 'إيقاف مؤقت';
      $('toggle-button').disabled = ['idle', 'error', 'play-rejected', 'ended'].indexOf(state.state) >= 0;
      $('stop-button').disabled = state.state === 'idle';
      $('retry-button').disabled = playingIndex === null;
      $('playing-ms').textContent = state.playingMs === null || state.playingMs === undefined ? '—' : state.playingMs + ' ms';
      $('frame-ms').textContent = state.firstFrameMs === null || state.firstFrameMs === undefined ? (state.frameApi ? 'بانتظار الإشارة' : 'غير متاح') : state.firstFrameMs + ' ms';
      $('stall-count').textContent = state.stalls || 0;
      $('stall-ms').textContent = (state.stallMs || 0) + ' ms';
      $('video-size').textContent = state.width ? state.width + ' × ' + state.height : '—';
    }
  });
  function renderChannels() {
    $('channels').replaceChildren();
    sources.forEach(function (_, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-button' + (playingIndex === index ? ' active' : '');
      button.dataset.index = index;
      button.textContent = (index + 1) + '   المصدر ' + (index + 1);
      button.setAttribute('aria-pressed', playingIndex === index ? 'true' : 'false');
      button.addEventListener('focus', function () { selected = index; });
      button.addEventListener('click', function () { scheduler.immediate(index); });
      $('channels').appendChild(button);
    });
  }
  function focusChannel(index) {
    var button = $('channels').children[index];
    if (button) button.focus();
  }
  function playChannel(index) {
    if (!sources[index]) return;
    selected = index; playingIndex = index;
    $('empty-state').hidden = true;
    $('channel-title').textContent = 'المصدر ' + (index + 1);
    renderChannels(); focusChannel(index);
    player.start(sources[index], index + 1);
  }
  var scheduler = api.createSwitchScheduler(playChannel);
  function stop() {
    scheduler.cancel();
    playingIndex = null;
    player.stop();
    renderChannels();
    $('channel-title').textContent = 'لا يوجد بث محدد';
    $('empty-state').hidden = false;
    $('retry-button').disabled = true;
  }
  function openSetup() {
    scheduler.cancel();
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
    diagnostics.hidden = !diagnostics.hidden;
    $('diagnostics-button').setAttribute('aria-expanded', String(!diagnostics.hidden));
    if (!diagnostics.hidden) $('close-diagnostics').focus();
  });
  $('close-diagnostics').addEventListener('click', closeDiagnostics);
  $('toggle-button').addEventListener('click', function () { player.toggle(); });
  $('retry-button').addEventListener('click', function () { if (playingIndex !== null) scheduler.immediate(playingIndex); });
  $('stop-button').addEventListener('click', function () { stop(); if (sources.length) focusChannel(selected); else $('start-button').focus(); });

  function visibleControls(container) {
    return Array.prototype.filter.call(container.querySelectorAll('button,input'), function (item) {
      return !item.disabled && item.offsetParent !== null;
    });
  }
  // LG documents this event from webOS 3.0. Never move focus merely because
  // it disappears: voice input also hides the keyboard temporarily.
  document.addEventListener('keyboardStateChange', function (event) {
    keyboardVisible = !!(event.detail && event.detail.visibility);
  });
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    var key = event.key;
    var isInput = event.target.tagName === 'INPUT';
    if (!setup.hidden && keyboardVisible) return;
    var back = code === 461 || key === 'Escape';
    if (back) {
      event.preventDefault();
      if (!setup.hidden) closeSetup();
      else if (!diagnostics.hidden) closeDiagnostics();
      else if (lastState !== 'idle') { stop(); if (sources.length) focusChannel(selected); }
      else if (typeof window.webOS !== 'undefined' && window.webOS.platformBack) window.webOS.platformBack();
      else window.close();
      return;
    }
    if (!setup.hidden) {
      // Left/right, Backspace, typing and Enter retain native input behavior.
      // With the TV keyboard closed, up/down can reach the next field or Save.
      if (isInput && key !== 'ArrowUp' && key !== 'ArrowDown') return;
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        var formControls = visibleControls($('source-form'));
        var position = formControls.indexOf(document.activeElement);
        var direction = key === 'ArrowUp' || key === 'ArrowRight' ? -1 : 1;
        formControls[(position + direction + formControls.length) % formControls.length].focus();
        event.preventDefault();
      }
      return;
    }
    if (!diagnostics.hidden) return;
    if ((code === 427 || code === 428 || key === 'PageUp' || key === 'PageDown') && sources.length) {
      selected = (selected + (code === 427 || key === 'PageUp' ? 1 : -1) + sources.length) % sources.length;
      focusChannel(selected); scheduler.request(selected); event.preventDefault(); return;
    }
    if (code === 19) { player.pause(); event.preventDefault(); return; }
    if (code === 415) { player.resume(); event.preventDefault(); return; }
    if (code === 413) { stop(); focusChannel(selected); event.preventDefault(); return; }
    if (key === ' ' || code === 10252) { player.toggle(); event.preventDefault(); return; }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      var controls = visibleControls(document.querySelector('.shell'));
      var current = controls.indexOf(document.activeElement);
      var delta = key === 'ArrowUp' || key === 'ArrowRight' ? -1 : 1;
      if (controls.length) controls[(current + delta + controls.length) % controls.length].focus();
      event.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { scheduler.cancel(); player.pause(); }
  });
  window.addEventListener('pagehide', function () { scheduler.cancel(); player.stop(); sources = []; inputs.forEach(function (input) { input.value = ''; }); });
  $('start-button').focus();
}());
