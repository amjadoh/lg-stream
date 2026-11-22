'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

// Synthetic Xtream catalogue, real IndexedDB: series grouped by the
// provider's categories, the series page (seasons, episodes, provider
// details), playing an episode, Back to the page and watched marks.
// No media is decoded.
async function main() {
  const root = path.resolve(__dirname, '..');
  const preview = spawn(process.execPath, ['scripts/preview.cjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview did not start')), 5000);
      preview.once('error', error => { clearTimeout(timeout); reject(error); });
      preview.once('exit', () => { clearTimeout(timeout); reject(new Error('Preview exited before startup')); });
      preview.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173' && route.request().resourceType() !== 'media') return route.continue();
      return route.abort();
    });
    await page.addInitScript(() => {
      const state = new WeakMap();
      const own = video => { if (!state.has(video)) state.set(video, { source: '', paused: true, time: 0, duration: NaN }); return state.get(video); };
      const proto = HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'src', { configurable: true, get() { return own(this).source; }, set(value) { own(this).source = value; } });
      Object.defineProperty(proto, 'paused', { configurable: true, get() { return own(this).paused; } });
      Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return own(this).time; }, set(value) { own(this).time = value; } });
      Object.defineProperty(proto, 'duration', { configurable: true, get() { return own(this).duration; } });
      proto.load = function () {};
      Object.defineProperty(proto, 'error', { configurable: true, get() { return own(this).error || null; } });
      proto.play = function () {
        // __failPlays refusals first, as a provider still holding the last connection would (MEDIA_ERR_SRC_NOT_SUPPORTED).
        if (window.__failPlays > 0) { window.__failPlays -= 1; window.__mediaFails = (window.__mediaFails || 0) + 1; own(this).error = { code: 4 }; queueMicrotask(() => this.dispatchEvent(new Event('error'))); return Promise.resolve(); }
        own(this).paused = false; window.__mediaStarts = (window.__mediaStarts || 0) + 1;
        queueMicrotask(() => { if (!this.isConnected || own(this).paused) return; this.dispatchEvent(new Event('playing')); });
        // Steady progress so the player sees a live picture, as a real decoder would.
        clearInterval(own(this).clock);
        own(this).clock = setInterval(() => { if (!this.isConnected) { clearInterval(own(this).clock); return; } if (own(this).paused) return; own(this).time += 0.5; this.dispatchEvent(new Event('timeupdate')); }, 500);
        return Promise.resolve();
      };
      proto.pause = function () { own(this).paused = true; this.dispatchEvent(new Event('pause')); };
      window.__setMedia = (time, duration) => { const video = document.querySelector('video'); own(video).time = time; own(video).duration = duration; video.dispatchEvent(new Event('timeupdate')); };
      window.__api = [];
      window.fetch = async url => {
        url = String(url);
        if (url.startsWith('https://api.themoviedb.org/')) return { ok: false, status: 401, json: async () => ({}) };
        if (url.includes('/player_api.php')) {
          const params = new URL(url).searchParams; const action = params.get('action'); window.__api.push(action);
          const reply = action === 'get_series_categories' ? [{ category_id: '10', category_name: 'Drama' }, { category_id: '20', category_name: 'Comedy' }]
            : action === 'get_series' ? [{ name: 'Alpha', series_id: 1, category_id: '10' }, { name: 'Beta', series_id: 2, category_id: '20' }, { name: 'Delta', series_id: 4, category_id: '20' }]
            : action === 'get_series_info' ? { info: { plot: 'Alpha provider plot', genre: 'Drama', releaseDate: '2021-03-01', rating: '7.8' }, episodes: { 1: [{ id: '301', info: { duration_secs: 1800 } }, { id: '302', info: { duration_secs: 1700 } }] } }
            : null;
          return { ok: true, json: async () => reply };
        }
        const lines = ['#EXTM3U'];
        const item = (section, group, id, title) => { lines.push('#EXTINF:-1 group-title="' + group + '",' + title); lines.push('https://media.invalid/' + section + '/user/pass/' + id + '.mp4'); };
        item('live', 'News', 1, 'Live One');
        item('movie', 'Films', 700, 'Film One');
        item('series', 'Alpha', 301, 'Alpha.S01.E01'); item('series', 'Alpha', 302, 'Alpha.S01.E02'); item('series', 'Alpha', 303, 'Alpha.S02.E01');
        item('series', 'Beta', 401, 'Beta S01E01');
        item('series', 'Gamma', 501, 'Gamma S01E01');
        for (let episode = 1; episode <= 40; episode++) item('series', 'Delta', 600 + episode, 'Delta S01E' + String(episode).padStart(2, '0'));
        const bytes = new TextEncoder().encode(lines.join('\n'));
        return { ok: true, headers: { get: name => name.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
      };
    });
    await page.goto('http://127.0.0.1:4173');
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://provider.invalid/get.php?username=user&password=pass&type=m3u_plus');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    const chooseSeries = async () => {
      await page.locator('#groups .group-button').first().focus();
      await page.keyboard.press('ArrowLeft');
      await page.locator('.primary-button[data-section="series"]').click();
    };
    await chooseSeries();
    assert.equal(await page.locator('#movie-grid .movie-card').count(), 4, 'One card per series');
    assert.equal(await page.locator('#groups [data-group="Alpha"]').count(), 0, 'A series is never a group');

    // The provider's categories arrive in the background, in provider order;
    // a series the provider does not list falls into "أخرى".
    await page.waitForFunction(() => document.querySelector('#groups [data-group="Drama"]'), null, { timeout: 15000 });
    assert.deepEqual(await page.locator('#groups [data-group]').evaluateAll(nodes => nodes.map(node => node.dataset.group).filter(Boolean)), ['Drama', 'Comedy', 'أخرى']);
    assert.deepEqual(await page.evaluate(() => window.__api.slice().sort()), ['get_series', 'get_series_categories']);
    await page.locator('#groups [data-group="Drama"]').click();
    assert.equal(await page.locator('#movie-grid .movie-card').count(), 1);
    assert.match(await page.locator('#movie-grid').innerText(), /Alpha/);

    // The series page: details, seasons and episodes before anything plays.
    await page.locator('#movie-grid .movie-card').first().click();
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'series-continue');
    assert.equal(await page.locator('video').count(), 0, 'Opening a series does not play');
    assert.equal(await page.locator('#series-title').innerText(), 'Alpha');
    await page.waitForFunction(() => /Alpha provider plot/.test(document.getElementById('series-description').textContent));
    assert.match(await page.locator('#series-meta').innerText(), /2021/);
    assert.equal(await page.locator('#series-seasons button').count(), 2);
    assert.equal(await page.locator('#series-episodes .episode-card').count(), 2, 'Season 1 shows its own episodes');
    assert.match(await page.locator('#series-episodes').innerText(), /30/, 'Provider episode length is shown');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-series-1080.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: path.join(root, 'artifacts/ui-series-720.png') });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.getElementById('series-seasons').contains(document.activeElement)), true);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#series-episodes .episode-card').count(), 1, 'Season 2 replaces the episode row');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.season), '2', 'OK on a season keeps focus on it');
    await page.locator('#series-seasons button').first().click();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('episode-card')), true);

    // Play, watch to the end, Back returns to the page with a watched mark
    // and the next episode offered.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('video'));
    assert.equal(await page.locator('#series-panel').isVisible(), false);
    await page.evaluate(() => window.__setMedia(1700, 1800));
    await page.keyboard.press('Escape');
    if (await page.locator('video').count()) await page.keyboard.press('Escape');
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('video').count(), 0, 'Back releases the episode');
    assert.equal(await page.locator('#series-episodes .episode-card.watched').count(), 1, 'The finished episode is marked');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-series-watched-1080.png') });
    assert.match(await page.locator('#series-continue').innerText(), /2/, 'Continue offers the next episode');
    const stored = await page.evaluate(() => localStorage.getItem('lg-stream-series-progress-v1'));
    assert.doesNotMatch(stored, /media\.invalid|user|pass/, 'Progress stores keys only, never links or credentials');

    // While an episode plays: the episode row, the side list, CH+/CH- and the
    // countdown to the next episode.
    const playing = () => page.evaluate(() => { const video = document.querySelector('video'); return video ? video.src.split('/').pop() : null; });
    const channelKey = code => page.evaluate(code => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true })), code);
    const endEpisode = () => page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('ended')));
    // Episode 1 stopped at 28:20 of 30:00: replaying it asks where to start.
    await page.locator('#series-episodes .episode-card').first().click();
    await page.locator('#resume-prompt').waitFor({ state: 'visible' });
    assert.equal(await page.locator('video').count(), 0, 'Nothing plays until the viewer chooses');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'resume-continue');
    assert.match(await page.locator('#resume-continue').innerText(), /0:28:20/);
    await page.screenshot({ path: path.join(root, 'artifacts/ui-resume-1080.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#resume-prompt').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('episode-card')), true, 'Back on the question returns to the episode');
    await page.locator('#series-episodes .episode-card').first().click();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('video'));
    assert.equal(await playing(), '301.mp4');
    // An arrow opens the controls without pausing (OK pauses).
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'episode-list', 'Episode controls open on the episodes button');
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), false, 'An arrow does not pause');
    assert.equal(await page.locator('#episode-prev').isVisible(), false, 'No previous button on the first episode');
    assert.match(await page.locator('#episode-next').innerText(), /م1 ح2/);
    const order = await page.locator('#episode-controls button:visible').evaluateAll(nodes => nodes.map(node => node.id + ':' + Math.round(node.getBoundingClientRect().x)));
    assert.equal(order[0].split(':')[0], 'episode-list');
    assert.ok(Number(order[0].split(':')[1]) > Number(order[1].split(':')[1]), 'The episodes button is first on the right');
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.evaluate(() => document.getElementById('episode-controls').contains(document.activeElement)), true, 'Down leaves the episode row');
    await page.locator('#seek-back').focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.getElementById('episode-controls').contains(document.activeElement)), true, 'Up from the seek buttons returns to the episode row');
    await page.locator('#episode-list').focus();
    await page.keyboard.press('Enter');
    await page.locator('#episode-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#media-controls').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index === String(document.querySelector('#episode-items .current').dataset.index)), true, 'The list opens on the playing episode');
    assert.match(await page.locator('#episode-items .current').innerText(), /قيد التشغيل/);
    const panelBox = await page.locator('#episode-panel').boundingBox();
    assert.ok(panelBox.x > 1100 && panelBox.width < 700, 'The list is a narrow column on the right; the video stays visible');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-episode-list-1080.png') });
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#episode-items .episode-row').count(), 1, 'Left shows season 2');
    assert.match(await page.locator('#episode-season').innerText(), /2/);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#episode-items .episode-row').count(), 2);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#episode-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'episode-list', 'Back from the list returns to the controls');
    assert.equal(await playing(), '301.mp4', 'Browsing the list does not change the episode');
    await page.locator('#episode-list').click();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('video') && document.querySelector('video').src.endsWith('/302.mp4'));
    assert.equal(await page.locator('video').count(), 1, 'One media element at a time');
    await channelKey(33);
    await page.waitForFunction(() => document.querySelector('video') && document.querySelector('video').src.endsWith('/303.mp4'));
    await channelKey(33);
    assert.equal(await playing(), '303.mp4', 'CH+ on the last episode stays');
    await channelKey(34);
    await page.waitForFunction(() => document.querySelector('video') && document.querySelector('video').src.endsWith('/302.mp4'));
    // The end offers the next episode with a countdown; Play now or the timer starts it.
    await endEpisode();
    await page.locator('#next-episode').waitFor({ state: 'visible' });
    assert.match(await page.locator('#next-episode-text').innerText(), /م2 ح1.*10/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'next-episode-now');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-next-episode-1080.png') });
    await page.waitForFunction(() => document.querySelector('video') && document.querySelector('video').src.endsWith('/303.mp4'), null, { timeout: 13000 });
    assert.equal(await page.locator('#next-episode').isVisible(), false);
    await endEpisode();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#next-episode').isVisible(), false, 'No countdown after the last episode');
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('video').count(), 0, 'The last episode ending returns to the series page');
    await page.locator('#series-seasons button').first().click();
    await page.locator('#series-episodes .episode-card').first().click();
    await page.waitForFunction(() => document.querySelector('video') || !document.getElementById('resume-prompt').hidden);
    if (await page.locator('#resume-prompt').isVisible()) await page.locator('#resume-restart').click();
    await page.waitForFunction(() => document.querySelector('video'));
    await endEpisode();
    await page.locator('#next-episode').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('video').count(), 0, 'Back on the countdown cancels it and returns to the series page');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#series-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('movie-card')), true, 'Back from the page returns to the series card');
    // A long season fills the page as a grid: down/up move a whole row.
    await page.locator('#groups [data-group="Comedy"]').click();
    await page.locator('#movie-grid .movie-card', { hasText: 'Delta' }).click();
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    const cells = page.locator('#series-episodes .episode-card');
    assert.equal(await cells.count(), 40);
    const boxes = await cells.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
    assert.equal(new Set(boxes.map(box => box.y)).size, 8, 'Forty episodes are eight rows of five');
    const layout = await page.evaluate(() => ({ actions: document.querySelector('#series-panel .series-actions').getBoundingClientRect().bottom, list: document.getElementById('series-episodes').getBoundingClientRect().top }));
    assert.ok(layout.list >= layout.actions, 'A long season never covers the buttons');
    assert.ok(boxes[0].y === boxes[4].y && boxes[5].y > boxes[0].y && boxes[1].x < boxes[0].x, 'Rows run right to left in Arabic');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-series-grid-1080.png') });
    const focusedCell = () => page.evaluate(() => Array.from(document.querySelectorAll('#series-episodes .episode-card')).indexOf(document.activeElement));
    await page.keyboard.press('ArrowDown');
    assert.equal(await focusedCell(), 0);
    await page.keyboard.press('ArrowLeft'); assert.equal(await focusedCell(), 1);
    await page.screenshot({ path: path.join(root, 'artifacts/ui-series-grid-focus-1080.png') });
    await page.keyboard.press('ArrowDown'); assert.equal(await focusedCell(), 6);
    for (let row = 2; row < 8; row++) await page.keyboard.press('ArrowDown');
    assert.equal(await focusedCell(), 36);
    await page.keyboard.press('ArrowDown'); assert.equal(await focusedCell(), 36, 'Down on the last row stays');
    const last = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const l = document.getElementById('series-episodes').getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; });
    assert.ok(last, 'The focused episode scrolls into view inside the grid');
    for (let row = 7; row > 0; row--) await page.keyboard.press('ArrowUp');
    assert.equal(await focusedCell(), 1);
    assert.equal(await page.evaluate(() => document.getElementById('series-episodes').scrollTop), 0, 'Back on the first row the whole row shows, not a clipped edge');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'series-continue', 'Up from the first row returns to the buttons');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: path.join(root, 'artifacts/ui-series-grid-720.png') });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.keyboard.press('Escape');

    // While Delta's first episode plays, the controls hide 10 s after the last key.
    await page.locator('#movie-grid .movie-card', { hasText: 'Delta' }).click();
    await page.locator('#series-continue').click();
    await page.waitForFunction(() => document.querySelector('video'));
    // OK pauses the episode and shows the controls on "Resume"; paused, they stay.
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#media-controls').isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true, 'OK paused the episode');
    await page.waitForFunction(() => document.getElementById('media-toggle').textContent === 'متابعة');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'media-toggle');
    await page.waitForTimeout(11000);
    assert.equal(await page.locator('#media-controls').isVisible(), true, 'Paused controls stay');
    // A second OK resumes; then the controls hide 10 s after the last key.
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), false, 'OK resumed the episode');
    await page.waitForTimeout(6000); await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(6000);
    assert.equal(await page.locator('#media-controls').isVisible(), true, 'Each key press restarts the 10 s');
    await page.waitForTimeout(4500);
    assert.equal(await page.locator('#media-controls').isVisible(), false, 'The controls hide 10 s after the last key');
    assert.equal(await page.locator('video').count(), 1, 'Hiding the controls keeps playing');
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), false);
    await page.keyboard.press('Escape');
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');

    // Skip intro: the button shows for 5 s; without a saved intro OK jumps
    // 90 s; "Intro ends here" saves the series' intro; later episodes jump
    // to its end, or skip on their own when automatic skipping is chosen.
    const now = () => page.evaluate(() => document.querySelector('video').currentTime);
    const press = id => page.evaluate(name => document.getElementById(name).click(), id);
    await page.locator('#movie-grid .movie-card', { hasText: 'Delta' }).click();
    await page.locator('#series-continue').click();
    await page.waitForFunction(() => document.querySelector('video'));
    await page.evaluate(() => window.__setMedia(10, 2400));
    await page.locator('#intro-skip').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#intro-skip-button').innerText(), 'تخطي المقدمة');
    await page.screenshot({ path: path.join(root, 'test-results', 'ui-intro-skip.png') });
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#intro-skip').isVisible(), false);
    assert.ok(Math.abs(await now() - 100) < 2, 'No saved intro: 90 s on');
    assert.equal(await page.locator('#media-controls').isVisible(), false, 'OK skipped instead of opening the controls');
    await page.evaluate(() => window.__setMedia(95, 2400));
    await press('intro-mark');
    assert.match(await page.locator('#intro-mark').innerText(), /0:01:35/);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('lg-stream-intros-v1'))).Delta, [10, 95], 'Starts where Skip was pressed, ends at the mark');
    await press('episode-next'); await page.waitForTimeout(300);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__setMedia(12, 2400));
    await page.locator('#intro-skip').waitFor({ state: 'visible' });
    await page.waitForTimeout(5300);
    assert.equal(await page.locator('#intro-skip').isVisible(), false, 'Hidden after 5 s');
    await press('episode-next'); await page.waitForTimeout(300);
    await page.evaluate(() => window.__setMedia(12, 2400));
    await page.locator('#intro-skip').waitFor({ state: 'visible' });
    await page.keyboard.press('Enter');
    assert.ok(Math.abs(await now() - 95) < 2, 'Saved intro: to its end');
    await press('episode-next'); await page.waitForTimeout(300);
    await page.evaluate(() => window.__setMedia(5, 2400));
    assert.equal(await page.locator('#intro-skip').isVisible(), false, 'Before the saved start nothing shows');
    await page.evaluate(() => document.querySelector('[data-intro="auto"]').click());
    await page.evaluate(() => window.__setMedia(20, 2400));
    assert.ok(Math.abs(await now() - 95) < 2, 'Automatic: skipped without a key');
    assert.equal(await page.locator('#intro-skip-text').innerText(), 'تم تخطي المقدمة');
    await page.evaluate(() => document.querySelector('[data-intro="button"]').click());
    await page.keyboard.press('Escape'); if (await page.locator('video').count()) await page.keyboard.press('Escape');
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');

    // A refused episode is retried after 3 s and plays; four refusals in a row
    // (first attempt + three retries) return to the series page with the reason.
    await page.evaluate(() => { window.__failPlays = 1; });
    const startsBefore = await page.evaluate(() => window.__mediaStarts || 0);
    await page.locator('#movie-grid .movie-card', { hasText: 'Beta' }).click();
    await page.locator('#series-continue').click();
    await page.locator('#vod-retry').waitFor({ state: 'visible' });
    assert.match(await page.locator('#vod-retry-text').innerText(), /1 من 3/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'vod-retry-cancel');
    await page.screenshot({ path: path.join(root, 'test-results', 'ui-vod-retry.png') });
    await page.waitForFunction(count => (window.__mediaStarts || 0) > count, startsBefore, { timeout: 5000 });
    assert.equal(await page.locator('#vod-retry').isVisible(), false);
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), true, 'The retry plays full screen');
    await page.keyboard.press('Escape');
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    await page.evaluate(() => { window.__failPlays = 4; window.__mediaFails = 0; });
    await page.locator('#series-continue').click();
    await page.waitForFunction(() => /ثلاث محاولات/.test(document.getElementById('series-status').textContent), null, { timeout: 24000 });
    assert.equal(await page.evaluate(() => window.__mediaFails), 4, 'The first attempt and all three retries were refused');
    assert.equal(await page.evaluate(() => window.__failPlays), 0);
    assert.equal(await page.locator('#series-panel').isVisible(), true);
    assert.equal(await page.locator('video').count(), 0);
    await page.keyboard.press('Escape');

    // A movie stopped part way asks too; Back on the question returns to its details.
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('.primary-button[data-section="movies"]').click();
    await page.locator('#movie-grid .movie-card').first().click();
    await page.locator('#details-play').click();
    await page.waitForFunction(() => document.querySelector('video'));
    await page.evaluate(() => window.__setMedia(600, 5400));
    await page.keyboard.press('Escape');
    if (await page.locator('video').count()) await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('video'));
    await page.locator('#movie-grid .movie-card').first().click();
    await page.locator('#details-play').click();
    await page.locator('#resume-prompt').waitFor({ state: 'visible' });
    assert.match(await page.locator('#resume-continue').innerText(), /0:10:00/);
    await page.keyboard.press('Escape');
    await page.locator('#details-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('video').count(), 0);
    await page.locator('#details-play').click();
    await page.locator('#resume-continue').click();
    await page.waitForFunction(() => document.querySelector('video'));

    // My List: the part-watched movie is in Continue watching; the details
    // button and the blue button add items; the list opens them, and Back from
    // a page or from playback returns to the list.
    const blue = () => page.evaluate(() => { for (const type of ['keydown', 'keyup']) document.activeElement.dispatchEvent(new KeyboardEvent(type, { key: 'ColorF3Blue', keyCode: 406, which: 406, bubbles: true, cancelable: true })); });
    const rows = () => page.locator('#mylist-rows .search-section').evaluateAll(list => list.map(item => item.dataset.row));
    const inList = () => page.evaluate(() => document.getElementById('mylist-panel').contains(document.activeElement));
    await page.evaluate(() => window.__setMedia(900, 5400));
    await page.keyboard.press('Escape'); if (await page.locator('video').count()) await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('video'));
    await page.locator('#nav-mylist').click();
    await page.locator('#mylist-panel').waitFor({ state: 'visible' });
    assert.equal((await rows())[0], 'continue');
    assert.equal((await rows()).includes('movies'), false, 'Nothing added yet');
    const film = page.locator('#mylist-rows [data-row="continue"].movie-card', { hasText: 'Film One' });
    assert.match(await film.innerText(), /متبقٍّ [0-9]+ د/);
    assert.equal(await film.locator('.mylist-progress').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mylist-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'nav-mylist');

    await page.locator('.primary-button[data-section="movies"]').click();
    await page.locator('#movie-grid .movie-card').first().click();
    assert.equal(await page.locator('#details-mylist').innerText(), 'أضف إلى قائمتي');
    await page.locator('#details-mylist').click();
    assert.equal(await page.locator('#details-mylist').innerText(), 'في قائمتي ✓');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#movie-grid .movie-card').first().locator('.mylist-mark').count(), 1, 'Listed cards carry the bookmark');
    await page.locator('.primary-button[data-section="series"]').click();
    const seriesCard = page.locator('#movie-grid .movie-card').first(); const seriesName = (await seriesCard.innerText()).trim();
    await seriesCard.focus(); await blue();
    await page.locator('#item-menu').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#menu-select').isVisible(), false, 'Cards offer only My List');
    assert.equal(await page.locator('#menu-mylist').innerText(), 'إضافة إلى قائمتي');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#item-menu').isVisible(), false);
    assert.equal(await seriesCard.locator('.mylist-mark').count(), 1);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('lg-stream-my-list-v1'))).items.map(item => item.k.charAt(0)), ['s', 'm'], 'Newest first; keys only');
    assert.equal(await page.evaluate(() => /https?:|\/\//.test(localStorage.getItem('lg-stream-my-list-v1'))), false, 'No links stored');

    await page.locator('#nav-mylist').click();
    assert.deepEqual(await rows(), ['continue', 'movies', 'series']);
    await page.screenshot({ path: path.join(root, 'test-results', 'ui-mylist.png') });
    await page.locator('#mylist-rows [data-row="series"].movie-card').first().click();
    await page.locator('#series-panel').waitFor({ state: 'visible' });
    assert.match(await page.locator('#series-title').innerText(), new RegExp(seriesName.split('\n')[0]));
    assert.equal(await page.locator('#series-mylist').innerText(), 'في قائمتي ✓');
    await page.keyboard.press('Escape');
    assert.equal(await inList(), true, 'Back from the series page returns to My List');
    await page.locator('#mylist-rows [data-row="movies"].movie-card').first().click();
    await page.locator('#details-panel').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await inList(), true, 'Back from the details returns to My List');
    await page.locator('#mylist-rows [data-row="movies"].movie-card').first().focus(); await blue();
    assert.equal(await page.locator('#menu-mylist').innerText(), 'إزالة من قائمتي');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rows(), ['continue', 'series']);
    assert.equal(await inList(), true);
    // Continue watching plays from where it stopped; Back returns to the list.
    await film.click();
    await page.waitForFunction(() => document.querySelector('video'));
    assert.equal(await page.locator('#mylist-panel').isVisible(), false);
    assert.equal(await page.locator('#resume-prompt').isVisible(), false, 'Continue does not ask');
    await page.keyboard.press('Escape'); if (await page.locator('video').count()) await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('video'));
    await page.locator('#mylist-panel').waitFor({ state: 'visible' });
    assert.equal(await inList(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mylist-panel').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('Series page: provider categories, one card per series, details, seasons/episodes navigation, play and Back to the page, watched mark and next episode passed. Synthetic media only.');
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
