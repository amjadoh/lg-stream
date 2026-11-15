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
        for (const [i, group] of ['رياضة', 'قنوات أفلام', 'أخبار', 'RU 4K', 'beIN', 'أطفال'].entries()) {
          lines.push(`#EXTINF:-1 group-title="${group}",قناة ${i}`);
          lines.push(`https://media.example.test/live/${i}.m3u8`);
        }
        for (const kind of ['movie', 'series']) { lines.push('#EXTINF:-1 group-title="فيديو" year="2024" rating="8.4" description="وصف المزود",فيديو الاختبار'); lines.push(`https://media.example.test/${kind}/1.m3u8`); }
        return new Response(lines.join('\n'));
      };
    });
    await page.goto('http://127.0.0.1:4173');
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://catalog.example.test/list');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    await page.locator('#channels .channel-button').first().click();
    await page.evaluate(() => { window.__originalVideo = document.querySelector('video'); });
    const starts = await page.evaluate(() => window.__mediaStarts);
    async function key(key, expected) {
      await page.keyboard.press(key);
      if (expected) assert.equal(await page.evaluate(() => document.activeElement.id), expected);
    }
    // Starting on a channel, every settings card is reachable with the remote.
    await key('ArrowLeft'); await key('ArrowLeft'); await key('ArrowLeft');
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown', 'nav-settings');
    await key('Enter', 'manage-groups-button');
    assert.equal(await page.locator('#setup-panel').isVisible(), false);
    await page.screenshot({ path: path.join(root, 'artifacts/ui-settings-home-1080.png') });
    assert.deepEqual(await page.locator('.primary-panel button').evaluateAll(nodes => nodes.map(n => n.id || n.dataset.section)), ['nav-search', 'favorites', 'tv', 'movies', 'series', 'nav-settings']);
    await key('ArrowLeft', 'settings-sources');
    await key('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'FORM', 'Sources does not open the keyboard automatically');
    await key('Escape', 'settings-sources');
    await key('ArrowDown', 'settings-info'); await key('Enter', 'close-diagnostics'); await key('Escape', 'settings-info');
    await key('ArrowRight', 'settings-speed'); await key('Enter', 'speed-wired'); await key('Escape', 'settings-speed');
    await key('ArrowDown', 'settings-appearance'); await key('Enter');
    for (const layout of ['tabs', 'vertical', 'compact']) {
      await page.locator(`[data-layout="${layout}"]`).click();
      assert.equal(await page.locator('body').getAttribute('data-layout'), layout);
      assert.equal(await page.evaluate(() => document.querySelector('video') === window.__originalVideo), true);
      await key('Escape'); await key('Escape'); await key('ArrowRight');
      if (layout === 'vertical') {
        await key('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.category), 'other', 'Up from first group returns through vertical shortcuts');
        for (let i = 0; i < 7; i++) await key('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'groups-filter');
        await key('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.category), 'all');
      } else {
        await key('ArrowUp', 'groups-filter'); await key('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains('group-button')), true, 'Down from header goes down into groups');
      }
      for (const [width, height] of [[1280,720], [1920,1080]]) {
        await page.setViewportSize({ width, height });
        const box = await page.locator('.groups-panel').boundingBox();
        assert.ok(box.y + box.height <= height);
        await page.screenshot({ path: path.join(root, `artifacts/ui-appearance-${layout}-${height}.png`) });
      }
      await page.locator('#groups-filter').focus(); await key('ArrowLeft'); await page.locator('#nav-settings').click();
      await page.locator('#settings-appearance').click();
    }
    await page.locator('[data-controls="comfortable"]').click();
    await key('Escape', 'settings-appearance'); await key('Escape', 'nav-settings');
    await key('ArrowRight'); await key('ArrowUp', 'groups-filter');
    await key('Enter'); await key('ArrowDown'); await key('Enter', 'groups-filter');
    assert.match(await page.locator('#groups-filter').innerText(), /رياضة/);
    assert.equal(await page.locator('#channels .channel-button').count(), 1);
    await key('ArrowDown'); await key('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '0');
    await key('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '0', 'Last filtered channel retains focus');
    await key('ArrowLeft'); await key('ArrowLeft'); await key('ArrowUp', 'groups-filter');
    await key('Enter'); await key('ArrowUp'); await key('Enter');
    assert.equal(await page.locator('#channels .channel-button').count(), 6, 'All restores unknown groups and provider order');
    assert.equal(await page.evaluate(() => window.__mediaStarts), starts, 'Filters and settings do not reconnect playback');
    // Hide sports, then selecting sports must stay empty; changing appearance cannot unhide it.
    await key('ArrowLeft'); await page.locator('#nav-settings').click();
    await page.locator('#manage-groups-button').click();
    await page.locator('.group-switch').filter({ hasText: 'رياضة' }).click();
    await page.waitForFunction(() => document.getElementById('manager-status').textContent.includes('أُخفيت'));
    assert.equal(await page.locator('video').count(), 0, 'Hiding the currently playing group intentionally stops its video');
    await key('Escape', 'manage-groups-button');
    await page.locator('#settings-appearance').click();
    await page.locator('[data-layout="tabs"]').click(); await key('Escape'); await key('Escape');
    await key('ArrowRight'); await key('ArrowUp', 'groups-filter');
    await page.locator('#category-shortcuts [data-category="sports"]').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 0);
    await page.locator('#category-shortcuts [data-category="all"]').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 5);
    for (const [width, height] of [[1280,720], [1920,1080]]) {
      await page.setViewportSize({ width, height });
      for (const selector of ['.viewing-panel', '.groups-panel', '.channels-panel', '#category-shortcuts']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `${selector} fits ${height}p`);
      }
      await page.screenshot({ path: path.join(root, `artifacts/ui-appearance-tabs-${height}.png`) });
    }
    await page.reload(); await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 5);
    assert.equal(await page.locator('body').getAttribute('data-layout'), 'tabs', 'Appearance survives relaunch');
    assert.equal(await page.locator('video').count(), 0, 'Restoring appearance does not auto-play');
    assert.equal(await page.locator('body').getAttribute('data-controls'), 'comfortable');
    // A chosen genre survives a new catalogue revision after manual refresh.
    await page.locator('#groups-filter').click();
    await page.locator('#category-list [data-category="news"]').click();
    await key('ArrowLeft'); await page.locator('#nav-settings').click();
    await page.locator('#settings-sources').click(); await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.match(await page.locator('#groups-filter').innerText(), /أخبار/);
    assert.equal(await page.locator('#channels .channel-button').count(), 1);
    await key('Escape');
    // Both VOD types use the same reachable controls and stop on display-menu exit.
    for (const section of ['movies', 'series']) {
      await page.locator(`.primary-button[data-section="${section}"]`).click();
      await key('ArrowRight'); await key('Enter');
      assert.match(await page.locator('#details-rating').innerText(), /8.4/);
      await key('Enter'); await key('Enter', 'media-toggle');
      assert.equal(await page.locator('#audio-language').isDisabled(), true);
      assert.equal(await page.locator('#subtitle-language').isDisabled(), true);
      await key('ArrowUp', 'seek-position'); await key('ArrowUp', 'seek-back');
      await key('ArrowRight', 'seek-position'); await key('ArrowDown', 'seek-forward');
      await key('Enter');
      await page.waitForFunction(() => document.querySelector('video').currentTime >= 30);
      await key('ArrowLeft', 'seek-position');
      await page.evaluate(() => {
        const video = document.querySelector('video');
        Object.defineProperty(video, 'seekable', { configurable: true, value: { length: 0 } });
        video.dispatchEvent(new Event('progress'));
      });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'media-toggle', 'Losing seekability restores usable focus');
      await page.evaluate(() => { delete document.querySelector('video').seekable; document.querySelector('video').dispatchEvent(new Event('progress')); });
      await key('ArrowUp', 'seek-position');
      await page.locator('#seek-position').evaluate(input => { input.value = 3595; });
      await key('ArrowRight');
      await page.waitForFunction(() => document.querySelector('video').currentTime === 3600);
      await key('ArrowDown', 'seek-forward'); await key('ArrowDown', 'media-toggle');
      for (const [width, height] of [[1280,720], [1920,1080]]) {
        await page.setViewportSize({ width, height });
        const back = await page.locator('#seek-back').boundingBox();
        const timeline = await page.locator('#seek-position').boundingBox();
        const forward = await page.locator('#seek-forward').boundingBox();
        assert.ok(back.x + back.width < timeline.x && timeline.x + timeline.width < forward.x, 'Seek buttons surround the timeline physically');
        const box = await page.locator('#media-controls').boundingBox();
        assert.ok(box.height <= height * 0.4 && box.y + box.height <= height, 'Comfortable controls fit without covering half the screen');
        await page.screenshot({ path: path.join(root, `artifacts/ui-controls-comfortable-${height}.png`) });
      }
      await key('ArrowLeft', 'media-display'); await key('Enter', 'display-fullscreen'); await key('Enter');
      assert.equal(await page.locator('video').count(), 0, 'Returning to VOD list stops audio and releases the video');
      assert.equal(await page.locator('#movie-browser').isVisible(), true);
      await key('Enter'); await key('Enter');
      assert.equal(await page.locator('video').count(), 1, 'The same item opens again immediately');
      await key('Escape');
      await page.locator('#groups-filter').focus(); await key('ArrowLeft');
    }
    assert.deepEqual(errors, []);
    assert.equal(unexpectedRequests, 0);
    console.log('Appearance/settings: remote card navigation, filters, hidden groups, persistence, same-player identity, 720/1080 geometry passed. No TV playback tested.');
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
