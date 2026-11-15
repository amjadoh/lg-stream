'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const { chromium } = require('playwright');

// Synthetic catalogue only: exercise real IndexedDB and remote navigation,
// without requesting or decoding media, pictures, or a provider playlist.
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
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    let externalRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173' && route.request().resourceType() !== 'media') return route.continue();
      externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => {
      // Keep the real IndexedDB write, but optionally delay its completion
      // callback so pagehide can race the UI without replacing storage.
      let catalogApi;
      Object.defineProperty(window, 'LGCatalogStore', {
        configurable: true,
        get() { return catalogApi; },
        set(api) {
          catalogApi = api;
          const create = api.createStore;
          api.createStore = function (options) {
            const store = create(options);
            const save = store.saveHiddenGroups.bind(store);
            store.saveHiddenGroups = function (source, groups) {
              const pending = save(source, groups);
              if (!window.__delayGroupSave) return pending;
              window.__delayGroupSave = false;
              return pending.then(result => new Promise(resolve => {
                window.__groupSaveCommitted = true;
                window.__releaseGroupSave = () => resolve(result);
              }));
            };
            return store;
          };
        }
      });
      const state = new WeakMap();
      const own = video => { if (!state.has(video)) state.set(video, { source: '', paused: true, time: 0 }); return state.get(video); };
      const proto = HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'src', { configurable: true, get() { return own(this).source; }, set(value) { own(this).source = value; } });
      Object.defineProperty(proto, 'paused', { configurable: true, get() { return own(this).paused; } });
      Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return own(this).time; } });
      proto.load = function () {};
      proto.play = function () {
        own(this).paused = false;
        queueMicrotask(() => { if (!this.isConnected || own(this).paused) return; this.dispatchEvent(new Event('playing')); own(this).time += 0.04; this.dispatchEvent(new Event('timeupdate')); });
        return Promise.resolve();
      };
      proto.pause = function () { own(this).paused = true; this.dispatchEvent(new Event('pause')); };
      window.__groupFetches = 0;
      window.fetch = async () => {
        window.__groupFetches++;
        const lines = ['#EXTM3U'];
        function item(section, group, number, title) {
          lines.push(`#EXTINF:-1 group-title="${group}",${title}`);
          lines.push(`https://media.invalid/${section}/${number}`);
        }
        for (let i = 0; i < 70; i++) item('live', 'مشتركة', i, `مشترك بث ${i}`);
        for (let i = 1; i <= 44; i++) item('live', `مجموعة ${i}`, 70 + i, `قناة مجموعة ${i}`);
        if (!window.__groupsLiveOnly) {
          for (let i = 0; i < 3; i++) item('movie', 'مشتركة', i, `مشترك فيلم ${i}`);
          for (let i = 0; i < 2; i++) item('series', 'مشتركة', i, `مشترك حلقة ${i}`);
        }
        const bytes = new TextEncoder().encode(lines.join('\n'));
        return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
      };
    });
    await page.goto('http://127.0.0.1:4173');
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://provider.invalid/catalogue');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.match(await page.locator('#status').innerText(), /119 عنصر/);

    async function openManager() {
      await page.locator('#groups-filter').focus();
      await page.keyboard.press('ArrowLeft');
      await page.locator('#nav-settings').click();
      await page.locator('#manage-groups-button').click();
      assert.equal(await page.locator('#group-manager').isVisible(), true);
    }
    async function closeManager() {
      await page.locator('#close-group-manager').click();
      await page.locator('#close-settings').click();
    }
    async function chooseSection(section) {
      await page.locator('#groups .group-button').first().focus();
      await page.keyboard.press('ArrowLeft');
      await page.locator(`.primary-button[data-section="${section}"]`).click();
    }
    async function groupSwitch(section) {
      await page.locator(`[data-manage-section="${section}"]`).click();
      return page.locator('#managed-groups .group-switch').filter({ has: page.locator('.group-switch-name', { hasText: /^مشتركة$/ }) });
    }
    async function toggleCommon(section, enabled) {
      const button = await groupSwitch(section);
      await button.click();
      await page.waitForFunction(() => !document.querySelector('#managed-groups .group-switch:disabled'));
      assert.equal(await button.getAttribute('aria-checked'), String(enabled));
    }
    async function storedCount() {
      return page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('lg-stream-catalog');
        request.onerror = () => reject(new Error('Unable to inspect synthetic catalogue'));
        request.onsuccess = () => {
          const db = request.result; const get = db.transaction('meta').objectStore('meta').get('active');
          get.onsuccess = () => { resolve(get.result.count); db.close(); };
          get.onerror = () => { db.close(); reject(new Error('Unable to read synthetic catalogue count')); };
        };
      }));
    }

    // Every channel remains reachable through the 40-row virtual window.
    await page.locator('#groups [data-group="مشتركة"]').click();
    await page.locator('#channels .favorite-button').first().click();
    await page.locator('#channels .channel-button').first().focus();
    for (let i = 0; i < 69; i++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '69');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '69');
    assert.ok(await page.locator('#channels .channel-button').count() <= 40);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('video').count(), 1);

    await openManager();
    assert.match(await page.locator('#managed-summary').innerText(), /45 مجموعة/);
    assert.equal(await page.locator('#managed-groups .group-switch').count(), 40);
    assert.match(await (await groupSwitch('tv')).innerText(), /70 عنصر/);
    await page.locator('#managed-groups .group-switch').first().focus();
    for (let i = 0; i < 44; i++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.position), '44', 'Remote reaches the last group beyond the DOM window');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close-group-manager', 'The last group leads to the manager return button');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.position), '44');
    await toggleCommon('tv', false);
    await mkdir(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts/ui-groups-1080.png') });
    assert.equal(await page.locator('video').count(), 0, 'Hiding the playing group releases its source');
    assert.equal(await (await groupSwitch('movies')).getAttribute('aria-checked'), 'true');
    assert.equal(await (await groupSwitch('series')).getAttribute('aria-checked'), 'true');
    await closeManager();
    assert.equal(await page.locator('#groups [data-group="مشتركة"]').count(), 0);
    assert.doesNotMatch(await page.locator('#channels').innerText(), /مشترك بث/);
    assert.equal(await storedCount(), 119, 'OFF changes visibility without deleting catalogue items');

    await chooseSection('favorites');
    assert.equal(await page.locator('#channels .channel-button').count(), 0, 'Hidden groups are excluded from favorites');
    await chooseSection('tv');
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('#nav-search').click();
    await page.locator('#channel-search').fill('مشترك');
    await page.waitForFunction(() => document.getElementById('search-status').textContent.includes('5 نتيجة'));
    assert.doesNotMatch(await page.locator('#search-results').innerText(), /مشترك بث/);
    assert.match(await page.locator('#search-results').innerText(), /مشترك فيلم/);
    assert.match(await page.locator('#search-results').innerText(), /مشترك حلقة/);
    await page.locator('#close-search').click();

    // Reopening and a same-source refresh preserve OFF and all original data.
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('استُعيدت'));
    assert.equal(await page.locator('#groups [data-group="مشتركة"]').count(), 0);
    await page.locator('#setup-button').click();
    await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.equal(await page.locator('#groups [data-group="مشتركة"]').count(), 0);
    assert.equal(await storedCount(), 119);
    await openManager();
    assert.equal(await (await groupSwitch('tv')).getAttribute('aria-checked'), 'false');
    await toggleCommon('movies', false);
    assert.equal(await (await groupSwitch('series')).getAttribute('aria-checked'), 'true');
    await toggleCommon('tv', true);
    await closeManager();
    assert.equal(await page.locator('#groups [data-group="مشتركة"]').count(), 1);
    await chooseSection('favorites');
    assert.equal(await page.locator('#channels .channel-button').count(), 1, 'ON restores favorites after the same-source refresh');
    assert.match(await page.locator('#channels').innerText(), /مشترك بث 0/);
    await chooseSection('movies');
    assert.equal(await page.locator('#movie-grid .movie-card').count(), 0, 'Movie visibility is scoped independently');
    await chooseSection('series');
    assert.equal(await page.locator('#movie-grid .movie-card').count(), 2);
    await chooseSection('tv');
    await page.locator('#groups [data-group="مجموعة 1"]').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 1);
    assert.match(await page.locator('#channels').innerText(), /قناة مجموعة 1/);
    await page.locator('#channels .channel-button').click();
    assert.equal(await page.locator('video').count(), 1, 'An enabled group still plays normally');
    await page.locator('#stop-button').click();
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('استُعيدت'));
    await openManager();
    assert.equal(await (await groupSwitch('tv')).getAttribute('aria-checked'), 'true');
    assert.equal(await (await groupSwitch('movies')).getAttribute('aria-checked'), 'false');
    assert.equal(await (await groupSwitch('series')).getAttribute('aria-checked'), 'true');
    assert.equal(await storedCount(), 119);

    // A completed preference write must not rewrite the view after pagehide
    // has released its in-memory sources and favorites.
    const seriesSwitch = await groupSwitch('series');
    const previousView = await page.evaluate(() => JSON.parse(localStorage.getItem('lg-stream-view-v1')));
    assert.ok(previousView.favorites.length > 0);
    assert.notEqual(previousView.selected, 0);
    await page.evaluate(() => { window.__delayGroupSave = true; });
    await seriesSwitch.click();
    await page.waitForFunction(() => window.__groupSaveCommitted);
    const savedOnExit = await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
      return localStorage.getItem('lg-stream-view-v1');
    });
    assert.equal(JSON.parse(savedOnExit).selected, previousView.selected);
    assert.deepEqual(JSON.parse(savedOnExit).favorites, previousView.favorites);
    await page.evaluate(async () => { window.__releaseGroupSave(); await Promise.resolve(); await Promise.resolve(); });
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-view-v1')), savedOnExit, 'Late preference completion must not overwrite the saved selection or favorites with the cleared view');
    // We already dispatched pagehide: suppress only the duplicate emitted by
    // reload so this test models one departure, as on the television.
    await page.evaluate(() => window.addEventListener('pagehide', event => event.stopImmediatePropagation(), { capture: true, once: true }));
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('استُعيدت'));
    await openManager();
    assert.equal(await (await groupSwitch('series')).getAttribute('aria-checked'), 'false', 'The preference itself was saved even though its UI completion arrived after exit');
    const restoredView = await page.evaluate(() => JSON.parse(localStorage.getItem('lg-stream-view-v1')));
    assert.equal(restoredView.selected, previousView.selected);
    assert.deepEqual(restoredView.favorites, previousView.favorites);
    assert.equal(await storedCount(), 119);
    await closeManager();
    await page.evaluate(() => { window.__groupsLiveOnly = true; });
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://provider.invalid/live-only');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    await openManager();
    await page.locator('[data-manage-section="movies"]').click();
    assert.equal(await page.locator('#managed-groups .group-switch').count(), 0);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close-group-manager');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.manageSection), 'movies', 'An empty section still lets the remote return from Close to its tabs');
    assert.equal(externalRequests, 0);
    assert.deepEqual(errors, []);
    console.log('Group checks passed: complete group contents, virtual remote navigation, independent visibility, persistence, same-source refresh, search/favorites filtering, and enabled playback. Synthetic media only.');
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
