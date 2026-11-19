'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeHlsPlaylist, nativeHlsSource, validateSource, qualityLabel, channelTitle, pictureScale, buildSectionIndex, orderedCatalogGroups, arabicCatalogName, arabicGroupName, searchCatalog, youtubeSearchTarget, createSwitchScheduler, createPlayer } = require('../app/core.js');

test('accepts signed HTTP media URLs without rewriting and rejects non-network sources', () => {
  const source = 'https://example.test/a%2Fb.m3u8?token=a%2Bb&x=1';
  assert.equal(validateSource(source), source);
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:video/mp4;base64,', '/relative', 'https://good.test/\nsecret']) assert.equal(validateSource(value), null);
});

test('labels decoded video dimensions without trusting channel names', () => {
  assert.equal(qualityLabel(0, 0), '');
  assert.equal(qualityLabel(720, 576), 'SD');
  assert.equal(qualityLabel(1280, 720), 'HD');
  assert.equal(qualityLabel(1920, 1080), 'FHD');
  assert.equal(qualityLabel(2560, 1440), 'QHD');
  assert.equal(qualityLabel(3840, 2160), '4K');
});

test('collects groups from a full-size catalogue in one pass and preserves provider order', () => {
  const entries = Array.from({ length: 331681 }, (_, index) => ({ group: `مجموعة ${index % 6000}`, name: `عنوان ${index}` }));
  const index = buildSectionIndex(entries, (_, itemIndex) => itemIndex % 2 === 0);
  assert.equal(index.all.length, 165841);
  assert.equal(index.groups.length, 3000);
  assert.deepEqual(index.groups.slice(0, 4), ['مجموعة 0', 'مجموعة 2', 'مجموعة 4', 'مجموعة 6']);
  assert.deepEqual(index.byGroup['مجموعة 2'].slice(0, 3), [2, 6002, 12002]);
  assert.deepEqual(orderedCatalogGroups(index.groups), index.groups);
  const results = searchCatalog(entries, 'عنوان 33168', index => ['tv', 'movies', 'series'][index % 3], 12);
  assert.equal(results.counts.tv + results.counts.movies + results.counts.series, 2);
  assert.ok(results.matches.tv.length <= 12 && results.matches.movies.length <= 12 && results.matches.series.length <= 12);
  // Narrowing a query from the previous direct matches gives the same answer as a full scan.
  const section = index => ['tv', 'movies', 'series'][index % 3];
  const broad = searchCatalog(entries, 'عنوان 3316', section, 12);
  const narrowed = searchCatalog(entries, 'عنوان 33168', section, 12, null, broad.matched);
  assert.deepEqual(narrowed.counts, results.counts); assert.deepEqual(narrowed.matches, results.matches);
  assert.ok(broad.matched.length < 200, 'Narrowing rescans only the earlier matches');
});

test('builds a YouTube TV voice search with title and year exactly once', () => {
  const target = new URL(youtubeSearchTarget('فيلم تجريبي 2024', '2024'));
  assert.equal(target.origin + target.pathname, 'https://www.youtube.com/tv');
  assert.equal(target.searchParams.get('launch'), 'voice');
  assert.equal(target.searchParams.get('vq'), 'Search for فيلم تجريبي 2024 on YouTube');
  assert.equal(youtubeSearchTarget('', '2024'), null);
});

test('Arabic display names retain provider variants, numbers and unrecognized titles', () => {
  assert.equal(arabicCatalogName('AR | beIN SPORTS 1 FHD'), 'AR | beIN سبورت 1 FHD');
  assert.equal(arabicCatalogName('BEIN2 UHD BACKUP'), 'BEIN2 UHD احتياط');
  assert.equal(arabicCatalogName('beIN MOVIES 1'), 'beIN موفيز 1');
  assert.equal(arabicCatalogName('beIN SPORTS MAX 1 FHD BACKUP'), 'beIN سبورت MAX 1 FHD احتياط');
  assert.equal(arabicCatalogName('MBC ACTION HD'), 'MBC أكشن HD');
  assert.equal(arabicCatalogName('SSC 1 HD'), '');
  assert.equal(arabicCatalogName('MBC2'), '');
  for (const name of ['Being Human', 'BEINNING', 'UNBEIN', 'بي إن سبورت 1', 'المفضلة', 'قناة خاصة']) {
    assert.equal(arabicCatalogName(name), '');
  }
  assert.equal(arabicGroupName('NEWS HD'), 'أخبار HD');
  assert.equal(arabicGroupName('Documentary 4K'), 'وثائقي 4K');
  assert.equal(arabicGroupName('Movies about news'), '');
  const groups = ['رياضة', 'BEIN SPORTS HD', 'أخبار', 'SSC', 'MBC', 'BEIN SPORTS FHD', 'أطفال', 'بي إن سبورت 4K', 'SSC HD'];
  const original = groups.slice();
  const ordered = orderedCatalogGroups(groups);
  assert.deepEqual(ordered, ['رياضة', 'BEIN SPORTS HD', 'BEIN SPORTS FHD', 'بي إن سبورت 4K', 'أخبار', 'SSC', 'SSC HD', 'MBC', 'أطفال']);
  assert.deepEqual(groups, original);
  assert.deepEqual(orderedCatalogGroups(ordered), ordered);
  assert.deepEqual(orderedCatalogGroups(['CUSTOM HD', 'OTHER', 'CUSTOM FHD', 'CUSTOM 4K', 'CUSTOM UK HD']), ['CUSTOM HD', 'CUSTOM FHD', 'CUSTOM 4K', 'OTHER', 'CUSTOM UK HD']);
  assert.deepEqual(orderedCatalogGroups(['', '4K', 'HD']), ['', '4K', 'HD']);
  assert.deepEqual(orderedCatalogGroups(['BEIN SPORTS HD', 'BEIN MOVIES HD', 'BEIN SPORTS FHD']), ['BEIN SPORTS HD', 'BEIN SPORTS FHD', 'BEIN MOVIES HD']);
  assert.deepEqual(orderedCatalogGroups(['AR BEIN SPORTS HD', 'أخبار', 'FR BEIN SPORTS FHD', 'MBC HD', 'UK MBC FHD']), ['AR BEIN SPORTS HD', 'FR BEIN SPORTS FHD', 'أخبار', 'MBC HD', 'UK MBC FHD']);
  const {compactChannelName} = require('../app/core.js');
  assert.equal(arabicGroupName('AR | BEIN SPORTS FHD 4K'), 'beIN · FHD/4K');
  assert.equal(compactChannelName('AR | BEIN SPORTS 6 FHD', 'AR | BEIN SPORTS FHD'), 'beIN 6');
  assert.equal(compactChannelName('FR | BEIN SPORTS 6 FHD', 'AR | BEIN SPORTS FHD'), 'FR beIN 6');
  assert.equal(compactChannelName('AR | BEIN SPORTS 6 FHD', 'BEIN SPORTS FHD'), 'AR beIN 6');
  assert.equal(compactChannelName('beIN SPORTS 6 PREMIUM FHD', 'BEIN SPORTS FHD'), 'beIN 6 بريميوم');
  assert.equal(compactChannelName('beIN SPORTS 6 HD', 'BEIN SPORTS FHD'), 'beIN 6 HD');
  assert.equal(compactChannelName('beIN SPORTS 6 FHD', 'BEIN SPORTS FHD 4K'), 'beIN 6 FHD');
  assert.equal(compactChannelName('beIN SPORTS 6 4K', 'BEIN SPORTS FHD 4K'), 'beIN 6 4K');
  assert.equal(arabicCatalogName('AL FAJER NEWS'), 'الفجر الإخبارية');
  assert.equal(arabicGroupName('ARABIC ENTERTAINMENT HD'), 'ترفيه عربي HD');
  assert.equal(arabicCatalogName('BBC WORLD NEWS'), 'BBC وورلد نيوز');
  assert.equal(arabicCatalogName('KANAL D'), 'كانال D');
  assert.equal(arabicCatalogName('PROGRAM HD'), 'برنامج HD');
  assert.equal(arabicCatalogName('Custom News HD'), '');
  assert.equal(arabicGroupName('مسلسلات رمضان | شاهد'), 'مسلسلات رمضان · شاهد');
  assert.equal(arabicGroupName('MOVIES | OSN 4K'), 'أفلام · OSN · 4K');
  assert.equal(arabicGroupName('SP | MBC HD'), 'MBC · رياضة · HD');
  const resolved = require('../app/core.js').groupDisplayNames(['UK | SKY HD', 'UK | SKY SPORTS HD', 'UK | MBC MOVIE HD', 'UK | MBC MOVIES HD']);
  assert.equal(new Set(resolved.values()).size,4);
  assert.equal(arabicCatalogName('بيان HD'), '');
  assert.equal(arabicCatalogName('MBC constructor HD'), '');
  const displayNames = require('../app/core.js').groupDisplayNames(['SPORTS', 'Sport', 'رياضة']);
  assert.equal(displayNames.get('SPORTS'), 'رياضة (1)');
  assert.equal(displayNames.get('Sport'), 'رياضة (2)');
  assert.equal(displayNames.get('رياضة'), 'رياضة (3)');
  assert.equal(arabicCatalogName('JORDAN الأردن'), 'الأردن');
  assert.equal(arabicCatalogName('أطفال اطفال'), 'أطفال');
  assert.equal(arabicCatalogName('مصر - مصر HD'), 'مصر HD');
  assert.equal(arabicCatalogName('مصر، مصر'), 'مصر');
  assert.equal(arabicCatalogName('JORDAN (الأردن)'), 'الأردن');
  assert.equal(arabicCatalogName('بي بي سي عربي'), '');
  assert.equal(arabicCatalogName('سي إن إن'), '');
  assert.equal(arabicCatalogName('إس إس سي 1'), '');
  assert.equal(compactChannelName('إس إس سي 1', ''), 'SSC 1');
  assert.equal(arabicCatalogName('MBC 1 1'), '');
  assert.deepEqual(orderedCatalogGroups(['BEIN MOVIES HD', 'أخبار', 'SP | BEIN HD', 'AR | BEIN SPORTS FHD']), ['SP | BEIN HD', 'AR | BEIN SPORTS FHD', 'BEIN MOVIES HD', 'أخبار']);
  assert.deepEqual(orderedCatalogGroups(['BEIN MOVIES HD', 'SP | BEIN NEWS HD', 'BEIN SPORTS HD']), ['SP | BEIN NEWS HD', 'BEIN SPORTS HD', 'BEIN MOVIES HD']);
  const entries = [{ name: 'beIN SPORTS 1 FHD' }, { name: 'MBC2' }, { name: 'beIN SPORTS 1 film' }];
  assert.deepEqual(searchCatalog(entries, 'سبورت 1', i => i === 2 ? 'movies' : 'tv', 12).matches.tv, [0]);
  assert.deepEqual(searchCatalog(entries, 'سبورت', () => 'tv', 12).matches.tv, [0, 2]);
  assert.deepEqual(searchCatalog(entries, 'سبورتس 1', () => 'tv', 12).matches.tv, [0, 2]);
  assert.deepEqual(searchCatalog(entries, 'سبورتس ١', () => 'tv', 12).matches.tv, [0, 2]);
  assert.equal(searchCatalog(entries, 'سبورت 1', i => i === 2 ? 'movies' : 'tv', 12).counts.movies, 0);
  assert.deepEqual(searchCatalog(entries, 'bein sports 1', () => 'tv', 12).matches.tv, [0, 2]);
  assert.deepEqual(searchCatalog(entries, 'bein 1', () => 'tv', 12).matches.tv, [0, 2]);
  const compactEntries = [{name:'beIN SPORTS MAX 1'},{name:'beIN MOVIES 1'},{name:'أفلام 1'}];
  assert.deepEqual(searchCatalog(compactEntries,'bein max',()=>'tv',12,[0,1,2]).matches.tv,[0]);
  assert.deepEqual(searchCatalog(compactEntries,'أفلام 1',()=>'tv',12,[0,1,2]).matches.tv,[1,2]);
});

test('channel-name classification takes precedence over a mixed or misleading group', () => {
  const {channelCategory, groupCategory} = require('../app/core.js');
  for (const name of ['beIN SPORTS1 FHD', 'BEIN 2 HD', 'SSC1 FHD', 'بي إن سبورت 1']) assert.equal(channelCategory(name), 'sports');
  for (const name of ['beIN MOVIES1', 'MBC2', 'MBC ACTION HD', 'إم بي سي ماكس', 'روتانا سينما']) assert.equal(channelCategory(name), 'movies');
  assert.equal(channelCategory('BEIN'), null);
  assert.equal(channelCategory('Sports News'), null);
  assert.equal(channelCategory('قناة خاصة'), null);
  assert.equal(groupCategory('SPORTS MOVIES'), 'other');
  assert.equal(groupCategory('SP | قنوات مباشرة'), 'sports');
});

test('search omits hidden entries from both results and totals', () => {
  const entries = [{ name: 'عنوان مخفي' }, { name: 'عنوان ظاهر' }];
  const result = searchCatalog(entries, 'عنوان', index => index === 0 ? null : 'tv', 12);
  assert.deepEqual(result.matches, { tv: [1], movies: [], series: [] });
  assert.deepEqual(result.counts, { tv: 1, movies: 0, series: 0 });
});

test('rapid channel requests commit only the latest and cancelled callbacks remain harmless', () => {
  const callbacks = []; const selected = [];
  const scheduler = createSwitchScheduler(value => selected.push(value), {
    setTimeout: fn => { callbacks.push(fn); return callbacks.length; }, clearTimeout: () => {}
  });
  scheduler.request(0); scheduler.request(1); scheduler.request(2);
  callbacks.forEach(fn => fn()); assert.deepEqual(selected, [2]);
  scheduler.request(1); scheduler.cancel(); callbacks.at(-1)(); assert.deepEqual(selected, [2]);
  scheduler.request(0); scheduler.immediate(1); callbacks.at(-1)(); assert.deepEqual(selected, [2, 1]);
});

function fakeVideo() {
  const handlers = new Map(); const historic = new Map();
  return {
    paused: false, seeking: false, currentTime: 0, videoWidth: 1920, videoHeight: 1080, handlers, historic,
    addEventListener(name, callback) { handlers.set(name, callback); historic.set(name, callback); },
    removeEventListener(name) { handlers.delete(name); },
    fire(name) { handlers.get(name)?.(); },
    pause() { this.paused = true; this.fire('pause'); },
    play() { this.paused = false; return { catch: callback => { this.rejectPlay = callback; } }; },
    load() {}, removeAttribute(name) { if (name === 'src') delete this.src; }
  };
}
function fakeTimers() {
  const entries = [];
  return {
    entries,
    setTimeout(callback, delay) { entries.push({ callback, delay, cancelled: false }); return entries.length; },
    clearTimeout(id) { entries[id - 1].cancelled = true; }
  };
}

test('switch releases old media and ignores stale events and promise rejection without exposing URLs', () => {
  const videos = []; const mounted = []; const states = []; const lifecycle = [];
  const timers = fakeTimers();
  const player = createPlayer({
    createVideo: () => { const video = fakeVideo(); videos.push(video); return video; },
    mountVideo: video => { assert.equal(mounted.length, 0); mounted.push(video); lifecycle.push('mount'); },
    unmountVideo: video => { assert.equal(video.src, undefined); mounted.splice(mounted.indexOf(video), 1); lifecycle.push('release'); },
    now: () => 100, onState: state => states.push(state), timers
  });
  player.start('https://example.test/private-password-token', 1);
  player.start('https://example.test/second', 2);
  const count = states.length;
  videos[0].historic.get('playing')(); videos[0].rejectPlay(); timers.entries[0].callback();
  assert.equal(states.length, count);
  assert.deepEqual(lifecycle, ['mount', 'release', 'mount']);
  assert.equal(mounted.length, 1);
  assert.equal(JSON.stringify(states).includes('example.test'), false);
  assert.equal(JSON.stringify(states).includes('private-password-token'), false);
  videos[1].error = { code: 3, message: 'https://example.test/private-password-token' };
  videos[1].fire('error');
  assert.equal(states.at(-1).errorCode, 3);
  assert.equal(mounted.length, 0);
  assert.equal(videos[1].src, undefined);
  const failed = states.at(-1);
  videos[1].historic.get('playing')(); videos[1].rejectPlay();
  assert.equal(states.at(-1), failed);
  assert.equal(JSON.stringify(states).includes('private-password-token'), false);
  player.stop(); assert.equal(mounted.length, 0);
});

test('pause and newer play intents invalidate old rejections within the same media element', () => {
  const timers = fakeTimers();
  let video; let state; let mounted = 0;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => { mounted++; }, unmountVideo: () => { mounted--; },
    now: () => 100, onState: next => { state = next; }, timers
  });
  player.start('https://example.test/live', 1);
  const initialRejection = video.rejectPlay;
  player.pause();
  initialRejection(); timers.entries[0].callback();
  assert.equal(state.state, 'paused'); assert.equal(mounted, 1);
  assert.equal(timers.entries[0].cancelled, true);

  player.resume();
  const firstResumeRejection = video.rejectPlay;
  player.pause(); player.resume();
  video.fire('pause'); // A delayed pause event must not cancel a newer resume deadline.
  assert.equal(timers.entries.at(-1).cancelled, false);
  video.fire('playing');
  firstResumeRejection();
  assert.equal(state.state, 'playing'); assert.equal(mounted, 1);
  player.stop();
});

test('a current play rejection releases the source and ignores later events', () => {
  const timers = fakeTimers();
  let video; let state; let mounted = 0;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => { mounted++; }, unmountVideo: () => { mounted--; },
    now: () => 100, onState: next => { state = next; }, timers
  });
  player.start('https://example.test/private-token', 1);
  video.rejectPlay();
  assert.equal(state.state, 'play-rejected');
  assert.equal(mounted, 0); assert.equal(video.src, undefined);
  assert.equal(timers.entries[0].cancelled, true);
  const rejected = state;
  video.historic.get('playing')(); timers.entries[0].callback(); player.resume();
  assert.equal(state, rejected);
  assert.equal(JSON.stringify(state).includes('private-token'), false);
});

test('measures intent-to-start/progress including switch delay and aborts a stalled startup safely', () => {
  let time = 120; let video; let state; let mounted = 0;
  const timers = fakeTimers();
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => { mounted++; }, unmountVideo: () => { mounted--; },
    now: () => time, onState: next => { state = next; }, timers
  });
  player.start('https://example.test/live', 1, 0);
  assert.equal(state.sourceMs, 120);
  assert.equal(state.metadataMs, null);
  time = 130; video.fire('loadedmetadata');
  assert.equal(state.metadataMs, 130);
  time = 135; video.fire('loadedmetadata');
  assert.equal(state.metadataMs, 130);
  assert.equal(timers.entries[0].delay, 15000);
  time = 140; video.fire('waiting'); assert.equal(state.stalls, 0);
  time = 520; video.fire('playing'); assert.equal(state.playingMs, 520);
  assert.equal(state.firstFrameMs, null); assert.equal(state.frameApi, false);
  video.fire('timeupdate'); assert.equal(state.progressMs, null);
  time = 580; video.currentTime = 0.04; video.fire('timeupdate'); assert.equal(state.progressMs, 580);
  assert.equal(timers.entries[0].cancelled, true);
  timers.entries[0].callback(); assert.equal(mounted, 1); // A queued expired callback is harmless after progress.
  time = 1000; video.fire('waiting'); time = 1100; video.fire('waiting');
  assert.equal(state.stalls, 1);
  time = 1300; video.fire('playing'); assert.equal(state.stallMs, 300);
  assert.equal(state.playingMs, 520);
  player.stop();
  time = 2000; player.start('https://example.test/stuck', 2, 1880);
  time = 17000; timers.entries.at(-1).callback();
  assert.equal(state.state, 'startup-timeout'); assert.equal(mounted, 0); assert.equal(video.src, undefined);
  const timedOut = state;
  video.historic.get('playing')(); video.rejectPlay();
  assert.equal(state, timedOut);
});

test('stall watchdog reports a live stream that stops progressing, but not pauses, seeks or short waits', () => {
  let time = 0; let video; let state; let mounted = 0;
  const timers = fakeTimers();
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo: () => { mounted++; }, unmountVideo: () => { mounted--; },
    now: () => time, onState: next => { state = next; }, timers
  });
  const runDue = () => { const due = timers.entries.filter(entry => !entry.cancelled && !entry.ran); due.forEach(entry => { entry.ran = true; entry.callback(); }); };
  player.start('https://example.test/live', 1, 0, { watchStall: true });
  time = 100; video.fire('playing');
  time = 200; video.currentTime = 0.1; video.fire('timeupdate');
  assert.equal(state.progressMs, 200);
  // A 9.5s wait that recovers must not fail.
  time = 1000; video.fire('waiting');
  for (time = 2700; time <= 10500; time += 2500) runDue();
  video.currentTime = 1; video.fire('timeupdate'); video.fire('playing');
  assert.equal(state.state, 'playing');
  // User pause keeps the stream alive regardless of duration.
  video.pause(); for (time = 13000; time <= 60000; time += 2500) runDue();
  assert.equal(state.state, 'paused'); assert.equal(mounted, 1);
  video.paused = false; video.fire('playing');
  // Seeking backwards is progress, not a stall.
  time = 61000; video.seeking = true; video.fire('seeking'); video.currentTime = 0.5; video.seeking = false; video.fire('seeked'); video.fire('timeupdate'); video.fire('playing');
  runDue(); assert.equal(state.state, 'playing');
  // No media-time change for 15s while not paused fails exactly once and releases the element.
  for (time = 63500; time < 76000; time += 2500) runDue();
  assert.notEqual(state.state, 'stall-timeout');
  time = 76100; runDue();
  assert.equal(state.state, 'stall-timeout'); assert.equal(mounted, 0); assert.equal(video.src, undefined);
  assert.equal(timers.entries.filter(entry => !entry.cancelled && !entry.ran).length, 0, 'No timer remains armed after release');
  // On-demand playback (no watchStall) is never failed by the watchdog.
  time = 80000; player.start('https://example.test/movie', 2, 80000);
  video.fire('playing'); time = 80100; video.currentTime = 3; video.fire('timeupdate');
  for (time = 82600; time < 200000; time += 2500) runDue();
  assert.equal(state.state, 'playing'); assert.equal(mounted, 1);
});

test('seeking and its refill do not inflate playback stall measurements', () => {
  let time = 0; let video; let state;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo() {}, unmountVideo() {},
    now: () => time, onState: next => { state = next; }, timers: fakeTimers()
  });
  player.start('https://example.test/movie', 1);
  video.fire('playing');
  time = 100; video.fire('waiting');
  assert.equal(state.stalls, 1);
  time = 150; video.seeking = true; video.fire('seeking');
  time = 200; video.fire('waiting');
  assert.equal(state.state, 'waiting', 'Seeking still exposes the waiting state');
  assert.equal(state.stalls, 1);
  assert.equal(state.stallMs, 50, 'Only the wait before seeking counts');
  video.seeking = false; video.fire('seeked');
  time = 300; video.fire('waiting');
  assert.equal(state.stalls, 1, 'Refill after seeked still belongs to the seek');
  time = 500; video.fire('playing');
  assert.equal(state.stallMs, 50);
  time = 600; video.fire('waiting');
  assert.equal(state.stalls, 2, 'A new stall after playback resumes still counts');
  time = 700; video.fire('playing');
  assert.equal(state.stallMs, 150);
  player.stop();
});

test('buffered seeking ends on media progress even without another playing event', () => {
  let video; let state;
  const player = createPlayer({
    createVideo: () => (video = fakeVideo()), mountVideo() {}, unmountVideo() {},
    onState: next => { state = next; }, timers: fakeTimers()
  });
  player.start('https://example.test/movie', 1);
  video.fire('playing'); video.currentTime = 10; video.fire('timeupdate');
  video.seeking = true; video.fire('seeking'); video.currentTime = 30;
  video.seeking = false; video.fire('seeked'); video.fire('timeupdate');
  video.fire('waiting');
  assert.equal(state.stalls, 0, 'The seek jump and a stationary update do not end refill');
  video.currentTime = 30.1; video.fire('timeupdate');
  video.fire('waiting');
  assert.equal(state.stalls, 1, 'Actual progress ends seeking even without playing');
  player.stop();
});

// Unknown and mixed groups must not silently acquire an incorrect genre.
assert.equal(require('../app/core.js').groupCategory('beIN'), 'other');
assert.equal(require('../app/core.js').groupCategory('RU 4K'), 'other');
assert.equal(require('../app/core.js').groupCategory('رياضة HD'), 'sports');
assert.equal(require('../app/core.js').groupCategory('Sports / News'), 'other');
assert.equal(require('../app/core.js').groupCategory('قنوات أفلام'), 'movies');
assert.equal(require('../app/core.js').groupCategory('بي إن سبورت FHD'), 'sports');
assert.equal(require('../app/core.js').groupCategory('بي إن موفيز HD'), 'movies');
assert.equal(require('../app/core.js').groupCategory('الرياض'), 'other');


test('an invalid next source releases the previous media and reports failure without source data', () => {
  const videos = []; let mounted = 0; const states = [];
  const player = createPlayer({
    createVideo: () => { const video = fakeVideo(); videos.push(video); return video; },
    mountVideo: () => mounted++, unmountVideo: () => mounted--,
    onState: value => states.push(value), timers: fakeTimers()
  });
  assert.equal(player.start('https://example.test/first', 1), true);
  assert.equal(player.start('https://example.test/' + 'x'.repeat(4096), 2), false);
  assert.equal(mounted, 0); assert.equal(videos[0].src, undefined);
  assert.equal(states.at(-1).state, 'error'); assert.equal(states.at(-1).channel, 2);
  assert.ok(!JSON.stringify(states).includes('example.test'));
  const count = states.length; videos[0].historic.get('playing')(); videos[0].rejectPlay();
  assert.equal(states.length, count, 'Old events cannot revive the rejected selection');
  assert.equal(player.start('https://example.test/next', 3), true); assert.equal(mounted, 1);
});

test('native HLS resolves only matching provider live paths and preserves all other sources', () => {
  const playlist = 'https://provider.example.test/get.php?username=user&password=pass&type=m3u_plus&output=mpegts';
  for (const source of ['https://provider.example.test/user/pass/42', 'https://provider.example.test/live/user/pass/42.ts']) {
    assert.equal(nativeHlsSource(source, playlist), 'https://provider.example.test/live/user/pass/42.m3u8');
  }
  for (const source of [
    'https://other.example.test/user/pass/42',
    'http://provider.example.test/user/pass/42',
    'https://provider.example.test:9443/user/pass/42',
    'https://user:pass@provider.example.test/user/pass/42',
    'https://provider.example.test/user/pass/42?token=signed',
    'https://provider.example.test/user/pass/42#time',
    'https://provider.example.test/user/other/42',
    'https://provider.example.test/live/user/pass/42.m3u8',
    'https://provider.example.test/movie/user/pass/42.mp4',
    'https://provider.example.test/series/user/pass/42.mkv',
    'https://provider.example.test/timeshift/user/pass/42.ts',
    'https://provider.example.test/user/pass/not-a-number',
    'https://provider.example.test/%ZZ/pass/42',
    'file:///user/pass/42',
    null
  ]) assert.equal(nativeHlsSource(source, playlist), source);
  const source = 'https://provider.example.test/user/pass/42';
  for (const other of [
    null,
    'https://provider.example.test/list',
    'https://provider.example.test/get.php?username=user',
    playlist + '&username=other',
    playlist + '#extra',
    playlist.replace('https://', 'https://admin:secret@')
  ]) {
    assert.equal(nativeHlsPlaylist(other), null);
    assert.equal(nativeHlsSource(source, other), source);
  }
  const encoded = 'https://provider.example.test/u%2Bser/p%26ass/42';
  const encodedList = 'https://provider.example.test/get.php?username=u%2Bser&password=p%26ass';
  assert.equal(nativeHlsSource(encoded, encodedList), 'https://provider.example.test/live/u%2Bser/p%26ass/42.m3u8');
});

test('presentation removes provider quality and scales the same native video rectangle', () => {
  assert.equal(channelTitle('beIN SPORTS 1 FHD'), 'beIN SPORTS 1');
  assert.equal(channelTitle('SSC 1 [HD]'), 'SSC 1');
  assert.equal(channelTitle('SSC 1 (HD/FHD)'), 'SSC 1');
  assert.equal(channelTitle('MBC2'), 'MBC2');
  assert.equal(channelTitle('Sport 4K HEVC BACKUP'), 'Sport BACKUP');
  assert.equal(pictureScale('contain', 1920, 800, 1920, 1080), 1);
  assert.equal(pictureScale('cover', 1920, 800, 1920, 1080), 1.35);
  assert.equal(pictureScale('cover', 1440, 1080, 1920, 1080), 4 / 3);
  assert.equal(pictureScale('zoom125', 1920, 1080, 1920, 1080), 1.25);
  assert.equal(pictureScale('zoom135', 1920, 1080, 1920, 1080), 1.35);
  assert.equal(pictureScale('cover', 0, 0, 0, 0), 1);
});

test('stable keys, new-item flags, block moves and the master order', () => {
  const api = require('../app/core.js');
  const live = api.entryKey('http://provider.invalid/live/user/pass/42.ts');
  assert.equal(api.entryKey('http://other.invalid/live/user2/pass2/42.ts'), live, 'The stream id survives a credential or host change');
  assert.notEqual(api.entryKey('http://provider.invalid/movie/user/pass/42.mkv'), live, 'Sections do not collide');
  assert.equal(String(api.entryKey('https://cdn.invalid/a.m3u8?token=x')).includes('token'), false);
  const previous = api.sortedKeys([3, 1, 2]);
  const flags = api.newItemFlags(Float64Array.from([1, 4, 2, 5]), previous);
  assert.deepEqual(Array.from(flags.flags), [0, 1, 0, 1]); assert.equal(flags.count, 2);
  assert.equal(api.newItemFlags(Float64Array.from([9]), null).count, 0, 'No comparison on the first load');
  assert.deepEqual(api.moveBlock(['a', 'b', 'c', 'd', 'e'], ['d', 'b'], 0), ['b', 'd', 'a', 'c', 'e']);
  assert.deepEqual(api.moveBlock(['a', 'b', 'c'], ['a'], 9), ['b', 'c', 'a']);
  const entries = [
    { url: 'http://p/live/u/p/1.ts', group: 'G1' }, { url: 'http://p/live/u/p/2.ts', group: 'G2' }, { url: 'http://p/live/u/p/3.ts', group: 'G1' },
    { url: 'http://p/live/u/p/4.ts', group: 'G3' }, { url: 'http://p/movie/u/p/5.mp4', group: 'M' }
  ];
  const keys = Float64Array.from(entries.map(entry => api.entryKey(entry.url)));
  const sectionOf = index => /movie/.test(entries[index].url) ? 'movies' : 'tv';
  let order = api.buildDisplayOrder(entries, sectionOf, { keys });
  assert.deepEqual(order.tv.groups, ['G1', 'G2', 'G3']);
  assert.deepEqual(Array.from(order.tv.order), [0, 2, 1, 3], 'All follows the group order');
  const custom = { groupOrder: { tv: ['G2'] }, channelOrder: { 'tv\u0001G1': [keys[2]] } };
  order = api.buildDisplayOrder(entries, sectionOf, { keys, custom });
  assert.deepEqual(order.tv.groups, ['G2', 'G1', 'G3']);
  assert.deepEqual(Array.from(order.tv.order), [1, 2, 0, 3]);
  const fresh = new Uint8Array([0, 0, 1, 1, 0]);
  order = api.buildDisplayOrder(entries, sectionOf, { keys, custom, newFlags: fresh });
  assert.deepEqual(order.tv.groups, ['G3', 'G2', 'G1'], 'A wholly new group comes first');
  assert.deepEqual(Array.from(order.tv.order), [3, 1, 2, 0], 'New items lead their group');
  assert.equal(order.tv.newCount, 2); assert.equal(order.movies.newCount, 0);
});

test('Xtream login builds the same get.php playlist link', () => {
  const api = require('../app/core.js');
  assert.equal(api.xtreamPlaylistUrl('server.invalid:8080', 'user', 'p&ss'), 'http://server.invalid:8080/get.php?username=user&password=p%26ss&type=m3u_plus&output=ts');
  assert.equal(api.xtreamPlaylistUrl('https://server.invalid/some/path', 'u', 'p'), 'https://server.invalid/get.php?username=u&password=p&type=m3u_plus&output=ts');
  assert.equal(api.xtreamPlaylistUrl('', 'u', 'p'), null);
  assert.equal(api.xtreamPlaylistUrl('server.invalid', '', 'p'), null);
  assert.equal(api.xtreamPlaylistUrl('ftp://server.invalid', 'u', 'p'), null);
  assert.ok(api.nativeHlsPlaylist(api.xtreamPlaylistUrl('server.invalid', 'u', 'p')), 'Native HLS still recognises the built link');
});

test('newest sort uses the provider stream id and titles give a release year', () => {
  const api = require('../app/core.js');
  const movie = id => api.providerSerial(api.entryKey(`http://provider.invalid/movie/user/pass/${id}.mkv`));
  assert.equal(movie(9001), 9001);
  assert.ok(movie(9001) > movie(12), 'A later provider id sorts as newer');
  assert.equal(api.providerSerial(api.entryKey('http://provider.invalid/series/user/pass/77.mp4')), 77);
  assert.equal(api.providerSerial(api.entryKey('http://provider.invalid/live/user/pass/77.ts')), null, 'Live channels have no newest order');
  assert.equal(api.providerSerial(api.entryKey('http://provider.invalid/movie/no-number.mp4')), null, 'Hashed keys are not ids');
  const now = new Date('2026-11-19T00:00:00Z');
  assert.equal(api.titleYear('Some Film (2021)', now), 2021);
  assert.equal(api.titleYear('EN - Some Film [1999] 4K', now), 1999);
  assert.equal(api.titleYear('فيلم عربي - 2024', now), 2024);
  assert.equal(api.titleYear('Some Film 2023', now), 2023);
  assert.equal(api.titleYear('Blade Runner 2049', now), 0, 'A number beyond next year is a title, not a year');
  assert.equal(api.titleYear('Ocean 11', now), 0);
  assert.equal(api.titleYear('2012 Remastered', now), 0, 'A leading number is not taken as the year');
});

test('movie details come from the provider get_vod_info for the saved Xtream source only', () => {
  const api = require('../app/core.js');
  const source = 'http://server.invalid:8080/get.php?username=viewer&password=s3cret%26x&type=m3u_plus&output=ts';
  const info = new URL(api.vodInfoUrl(source, 'http://cdn.invalid/movie/viewer/s3cret/123456.mkv?x=1'));
  assert.equal(info.origin, 'http://server.invalid:8080', 'The request goes to the saved source server, not a CDN host');
  assert.equal(info.pathname, '/player_api.php');
  assert.equal(info.searchParams.get('action'), 'get_vod_info');
  assert.equal(info.searchParams.get('vod_id'), '123456');
  assert.equal(info.searchParams.get('password'), 's3cret&x');
  assert.equal(api.vodInfoUrl(source, 'http://cdn.invalid/series/viewer/s3cret/77.mp4'), null, 'Episodes have no movie id');
  assert.equal(api.vodInfoUrl('https://lists.invalid/my.m3u', 'http://cdn.invalid/movie/u/p/5.mkv'), null, 'A plain M3U link has no Xtream API');
  assert.equal(api.vodInfoUrl(source, 'http://cdn.invalid/live/viewer/s3cret/5.ts'), null);

  const details = api.vodDetails({ info: { plot: '  A\nplot  ', rating: '7.46', releasedate: '2021-05-01', genre: 'Drama', duration: '01:52:10', director: '', cast: 42, mpaa: { x: 1 } } });
  assert.deepEqual(details, { plot: 'A plot', rating: '7.5', year: '2021', genre: 'Drama', minutes: 112, director: '', cast: '42', tmdb: '' });
  assert.equal(api.vodDetails({ info: { plot: 'x', tmdb_id: '603' } }).tmdb, '603');
  assert.equal(api.vodDetails({ info: { plot: 'x', tmdb_id: 'abc' } }).tmdb, '');
  assert.equal(api.vodDetails({ info: { plot: '', rating: '0', year: '', genre: '' } }), null, 'Empty provider info shows nothing');
  assert.equal(api.vodDetails({ info: { rating: '57' } }), null, 'A rating outside 0-10 is ignored');
  assert.equal(api.vodDetails({ info: [] }), null);
  assert.equal(api.vodDetails('not json'), null);
  assert.equal(api.vodDetails({ info: { plot: 'x'.repeat(2000) } }).plot.length, 900, 'Long text is capped');
});

test('OMDb lookups use a plain title, the year and only a valid key', () => {
  const api = require('../app/core.js');
  assert.equal(api.omdbTitle('EN - The Matrix (1999)'), 'The Matrix');
  assert.equal(api.omdbTitle('|AR| Inception [MULTI-SUB] 4K'), 'Inception');
  assert.equal(api.omdbTitle('4K - Dune: Part Two - 2024'), 'Dune: Part Two');
  assert.equal(api.omdbTitle('فيلم عربي (2020)'), '', 'Arabic-only titles are not sent');
  assert.equal(api.validOmdbKey('abc12345'), true);
  assert.equal(api.validOmdbKey('abc 12345'), false);
  assert.equal(api.validOmdbKey(''), false);
  const url = new URL(api.omdbUrl('abc12345', 'The Matrix', 1999));
  assert.equal(url.origin, 'https://www.omdbapi.com');
  assert.deepEqual([url.searchParams.get('t'), url.searchParams.get('y'), url.searchParams.get('type')], ['The Matrix', '1999', 'movie']);
  assert.equal(api.omdbUrl('bad key', 'The Matrix', 1999), null);
  assert.equal(api.omdbUrl('abc12345', '', 1999), null);
  assert.deepEqual(api.omdbDetails({ Response: 'True', imdbRating: '8.7', Plot: 'A hacker learns.', imdbID: 'tt0133093' }), { rating: '8.7', plot: 'A hacker learns.', id: 'tt0133093' });
  assert.deepEqual(api.omdbDetails({ Response: 'True', imdbRating: 'N/A', Plot: 'Only plot', imdbID: 'x' }), { rating: '', plot: 'Only plot', id: '' });
  assert.equal(api.omdbDetails({ Response: 'False', Error: 'Movie not found!' }), null);
  assert.equal(api.omdbFailure({ Response: 'False', Error: 'Request limit reached!' }), 'limit');
  assert.equal(api.omdbFailure({ Response: 'False', Error: 'Invalid API key!' }), 'key');
  assert.equal(api.omdbFailure({ Response: 'False', Error: 'Movie not found!' }), '', 'Not found is an answer, not a failure');
});

test('Arabic descriptions come from TMDB by id with a valid key only', () => {
  const api = require('../app/core.js');
  const key = '0123456789abcdef0123456789abcdef';
  const url = new URL(api.tmdbUrl(key, '603'));
  assert.equal(url.origin + url.pathname, 'https://api.themoviedb.org/3/movie/603');
  assert.equal(url.searchParams.get('language'), 'ar');
  assert.equal(api.tmdbUrl('short', '603'), null);
  assert.equal(api.tmdbUrl(key, '60a'), null);
  assert.equal(api.tmdbArabicPlot({ overview: '  مبرمج يكتشف\nالحقيقة ' }), 'مبرمج يكتشف الحقيقة');
  assert.equal(api.tmdbArabicPlot({ overview: 'English fallback only' }), '', 'An untranslated overview is not shown as Arabic');
  assert.equal(api.tmdbArabicPlot(null), '');
});
