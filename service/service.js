'use strict';
// Background helper for LG Stream. webOS suspends the web app a few seconds
// after YouTube comes to the front (measured on the TV), so this small service
// watches YouTube's playback instead and brings LG Stream back to the same
// movie details when the trailer stops (Back in YouTube) or ends.
// One watch at a time, ended by LG Stream showing again, another app playing
// media, or 30 minutes. It reads only app ids and play states.
var Service = require('webos-service');
var createTrailerWatch = require('./trailer-watch.js').createTrailerWatch;

var APP_ID = 'com.amjadoh.lgstream';
var service = new Service(APP_ID + '.service');
var current = null; // { watch, subscription, activity, limit }
var lastState = null;

function release() {
  if (!current) return;
  var item = current; current = null;
  clearTimeout(item.limit);
  try { item.subscription.cancel(); } catch (_) {}
  // The activity keeps the service process alive while a watch is armed.
  try { service.activityManager.complete(item.activity, function () {}); } catch (_) {}
}

function returnToApp() {
  service.call('luna://com.webos.applicationManager/launch', { id: APP_ID, params: { from: 'trailer' } }, function () {});
}

service.register('watchTrailer', function (message) {
  if (current) current.watch.stop('replaced');
  release();
  var item = {};
  item.watch = createTrailerWatch({ onEnd: returnToApp, onStop: function () { lastState = item.watch.state(); release(); } });
  current = item;
  service.activityManager.create('trailer-watch', function (activity) {
    if (current !== item) { try { service.activityManager.complete(activity, function () {}); } catch (_) {} return; }
    item.activity = activity;
  });
  item.limit = setTimeout(function () { if (current === item) item.watch.stop('time-limit'); }, 30 * 60 * 1000);
  item.subscription = service.subscribe('luna://com.webos.media/getForegroundAppInfo', { subscribe: true });
  item.subscription.on('response', function (reply) {
    var payload = reply && reply.payload;
    if (payload && payload.returnValue === false) { item.watch.stop('denied'); return; }
    if (payload && Array.isArray(payload.foregroundAppInfo)) item.watch.handle(payload.foregroundAppInfo);
  });
  message.respond({ returnValue: true });
});

service.register('stopWatch', function (message) {
  if (current) current.watch.stop('app-shown');
  release();
  message.respond({ returnValue: true });
});

// For checks on the TV: counts and states only.
service.register('status', function (message) {
  message.respond({ returnValue: true, armed: !!current, current: current ? current.watch.state() : null, last: lastState });
});
