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
      proto.play = function () {
        own(this).paused = false; window.__mediaStarts = (window.__mediaStarts || 0) + 1;
        queueMicrotask(() => { if (!this.isConnected || own(this).paused) return; this.dispatchEvent(new Event('playing')); });
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
            : action === 'get_series' ? [{ name: 'Alpha', series_id: 1, category_id: '10' }, { name: 'Beta', series_id: 2, category_id: '20' }]
            : action === 'get_series_info' ? { info: { plot: 'Alpha provider plot', genre: 'Drama', releaseDate: '2021-03-01', rating: '7.8' }, episodes: { 1: [{ id: '301', info: { duration_secs: 1800 } }, { id: '302', info: { duration_secs: 1700 } }] } }
            : null;
          return { ok: true, json: async () => reply };
        }
        const lines = ['#EXTM3U'];
        const item = (section, group, id, title) => { lines.push('#EXTINF:-1 group-title="' + group + '",' + title); lines.push('https://media.invalid/' + section + '/user/pass/' + id + '.mp4'); };
        item('live', 'News', 1, 'Live One');
        item('series', 'Alpha', 301, 'Alpha.S01.E01'); item('series', 'Alpha', 302, 'Alpha.S01.E02'); item('series', 'Alpha', 303, 'Alpha.S02.E01');
        item('series', 'Beta', 401, 'Beta S01E01');
        item('series', 'Gamma', 501, 'Gamma S01E01');
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
    assert.equal(await page.locator('#movie-grid .movie-card').count(), 3, 'One card per series');
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
    assert.match(await page.locator('#series-continue').innerText(), /2/, 'Continue offers the next episode');
    const stored = await page.evaluate(() => localStorage.getItem('lg-stream-series-progress-v1'));
    assert.doesNotMatch(stored, /media\.invalid|user|pass/, 'Progress stores keys only, never links or credentials');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#series-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('movie-card')), true, 'Back from the page returns to the series card');
    assert.deepEqual(errors, []);
    console.log('Series page: provider categories, one card per series, details, seasons/episodes navigation, play and Back to the page, watched mark and next episode passed. Synthetic media only.');
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
