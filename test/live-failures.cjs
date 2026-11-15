'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { chromium } = require('playwright');

// Exercise real keyboard/wheel handlers against a synthetic catalogue. No media
// is downloaded, decoded, or accepted as evidence of television playback.
async function main() {
  const root = path.resolve(__dirname, '..');
  const preview = spawn(process.execPath, ['scripts/preview.cjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Navigation preview did not start')), 5000);
      preview.once('error', error => { clearTimeout(timeout); reject(error); });
      preview.once('exit', () => { clearTimeout(timeout); reject(new Error('Navigation preview exited before startup')); });
      preview.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    let unexpectedRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173' && route.request().resourceType() !== 'media') return route.continue();
      unexpectedRequests++;
      return route.abort();
    });
    await page.addInitScript(() => {
      const states = new WeakMap();
      const state = video => {
        if (!states.has(video)) states.set(video, { paused: true, time: 0, source: '' });
        return states.get(video);
      };
      window.__mediaStarts = 0;
      const originalTimeout = window.setTimeout;
      window.setTimeout = function (fn, ms, ...args) { return originalTimeout(fn, ms === 15000 ? 100 : ms, ...args); };
      window.__seekWrites = 0;
      const proto = HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'src', { configurable: true, get() { return state(this).source; }, set(value) { state(this).source = value; } });
      Object.defineProperty(proto, 'paused', { configurable: true, get() { return state(this).paused; } });
      Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return state(this).time; }, set(value) { window.__seekWrites++; state(this).time = value; } });
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get() { return 1920; } });
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get() { return 1080; } });
      Object.defineProperty(proto, 'duration', { configurable: true, get() { return 3600; } });
      Object.defineProperty(proto, 'seekable', { configurable: true, get() { return { length: 1, start() { return 0; }, end() { return 3600; } }; } });
      proto.load = function () {};
      proto.play = function () {
        window.__mediaStarts++;
        state(this).paused = false;
        const mode = window.__nextPlayMode; window.__nextPlayMode = null;
        if (mode === 'reject') return Promise.reject(new Error('synthetic rejection'));
        if (mode === 'timeout') return Promise.resolve();
        queueMicrotask(() => {
          if (!this.isConnected || state(this).paused) return;
          this.dispatchEvent(new Event('playing'));
          state(this).time += 0.04;
          this.dispatchEvent(new Event('timeupdate'));
        });
        return Promise.resolve();
      };
      proto.pause = function () { state(this).paused = true; this.dispatchEvent(new Event('pause')); };


      window.fetch = async () => {
        const lines = ['#EXTM3U'];
        for (const [i, kind] of ['live', 'movie', 'live', 'series', 'live', 'live'].entries()) {
          lines.push(`#EXTINF:-1 group-title="${i === 5 ? 'مجموعة أخرى' : 'مجموعة الاختبار'}",عنصر ${i}`);
          lines.push(`https://media.example.test/${kind}/${i}.m3u8`);
        }
        return new Response(lines.join('\n'));
      };
    });
    await page.goto('http://127.0.0.1:4173');
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://catalog.example.test/list');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);

    const columns = await page.evaluate(() => {
      const groups = document.getElementById('groups').getBoundingClientRect();
      const channels = document.getElementById('channels').getBoundingClientRect();
      return { top: Math.abs(groups.top - channels.top), bottom: Math.abs(groups.bottom - channels.bottom) };
    });
    assert.ok(columns.top < 1 && columns.bottom < 1, 'Default live lists share their top and bottom edges');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-live-columns-1080.png') });
    async function watch(index) {
      await page.locator(`#channels [data-index="${index}"]`).click();
      await page.locator('#display-button').click();
      await page.locator('#display-fullscreen').click();
    }
    async function current(index) {
      await page.waitForFunction(index => document.getElementById('channel-title').textContent === `عنصر ${index}` && document.body.dataset.state === 'playing', index);
      assert.equal(await page.locator('video').count(), 1);
    }
    async function keys(...names) {
      await page.evaluate(names => names.forEach(key => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))), names);
    }
    // All terminal live states keep the viewer in place and let the next arrow work.
    for (const kind of ['error', 'ended', 'reject', 'timeout']) {
      await watch(0);
      if (kind === 'error' || kind === 'ended') await page.evaluate(kind => document.querySelector('video').dispatchEvent(new Event(kind)), kind);
      else {
        await page.evaluate(kind => { window.__nextPlayMode = kind; }, kind);
        await page.keyboard.press('ArrowDown');
      }
      await page.waitForFunction(() => ['error', 'ended', 'play-rejected', 'startup-timeout'].includes(document.body.dataset.state));
      assert.equal(await page.locator('body').evaluate(node => node.classList.contains('watch-mode')), true, kind);
      assert.equal(await page.locator('#status').isVisible(), true, kind);
      assert.match(await page.locator('#status').innerText(), /البث مقطوع/);
      await page.keyboard.press('ArrowDown');
      await current(kind === 'error' || kind === 'ended' ? 2 : 4);
      await page.keyboard.press('Escape');
    }
    // A held OK opens controls once; repeats must never toggle playback.
    await watch(0);
    const beforeHeldOK = await page.evaluate(() => window.__mediaStarts);
    await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    assert.equal(await page.evaluate(() => document.body.dataset.state), 'playing');
    assert.equal(await page.evaluate(() => window.__mediaStarts), beforeHeldOK);
    assert.equal(await page.locator('#media-controls').isVisible(), true);
    await page.keyboard.press('Escape');
    // Broken-source controls offer a real retry of the same live channel.
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('error')));
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#media-toggle').innerText(), 'إعادة المحاولة');
    await page.keyboard.press('Enter'); await current(0);
    assert.equal(await page.evaluate(() => window.__mediaStarts), beforeHeldOK + 1);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    // Search has the same stop-before-VOD behavior as the main navigation.
    await page.locator('#groups-filter').focus(); await page.keyboard.press('ArrowLeft');
    await page.locator('#nav-search').click();
    await page.locator('#channel-search').fill('عنصر 1');
    await page.locator('#search-results button').click();
    assert.equal(await page.locator('video').count(), 0, 'Opening a movie result releases live audio before showing posters/details');
    assert.equal(await page.locator('#details-panel').isVisible(), true);
    await page.locator('#close-details').click();
    await page.locator('#groups-filter').focus(); await page.keyboard.press('ArrowLeft');
    await page.locator('.primary-button[data-section="tv"]').click();
    await page.locator('#groups [data-group=""]').click();
    // Highlighting another channel must not change the anchor for live arrows.
    await page.locator('#channels [data-index="0"]').click();
    await page.locator('#channels [data-index="4"]').focus();
    await page.locator('#display-button').click(); await page.locator('#display-fullscreen').click();
    await page.keyboard.press('ArrowDown'); await current(2);
    const beforeBurst = await page.evaluate(() => window.__mediaStarts);
    await keys('ArrowDown', 'ArrowDown', 'ArrowDown'); await current(5);
    assert.equal(await page.evaluate(() => window.__mediaStarts), beforeBurst + 1, 'A burst opens only the final live source');
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(160);
    assert.equal(await page.evaluate(() => window.__mediaStarts), beforeBurst + 1, 'Last live channel does not wrap');
    await page.keyboard.press('Escape');
    await page.locator('#groups [data-group="مجموعة الاختبار"]').focus();
    await page.locator('#display-button').click(); await page.locator('#display-fullscreen').click();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#media-controls').isVisible(), true, 'A playing channel outside the visible group leaves controls accessible');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // Seed a synthetic mixed favourites view; no actual account/catalogue is used.
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('lg-stream-view-v1'));
      state.section = 'favorites'; state.favorites = [0, 1, 2, 3, 4]; state.groupIndex = -1; state.selected = 0;
      localStorage.setItem('lg-stream-view-v1', JSON.stringify(state));
    });
    // Restore on the same page after suppressing the fixture's outgoing view save.
    await page.evaluate(() => { const set = localStorage.setItem.bind(localStorage); Storage.prototype.setItem = function (key, value) { if (key !== 'lg-stream-view-v1') set(key, value); }; });
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 5);
    await watch(0); await page.keyboard.press('ArrowDown'); await current(2);
    await page.keyboard.press('ArrowDown'); await current(4);
    await page.keyboard.press('ArrowUp'); await current(2);
    await page.keyboard.press('Escape');
    // VOD error still exits; it must not inherit the live-only stay-in-view rule.
    await page.locator('#channels [data-index="1"]').click();
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('error')));
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('watch-mode')), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'retry-button');
    assert.deepEqual(errors, []);
    assert.equal(unexpectedRequests, 0);
    console.log('Live failures: errors/end/rejection/timeout, burst/bounds, actual playing anchor, mixed favorites, held OK, retry, search-to-VOD and VOD isolation passed. Synthetic only.');
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
