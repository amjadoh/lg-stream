'use strict';
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { chromium } = require('playwright');

// This checks UI and cancellation only. No media is fetched or decoded.
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
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === 'http://127.0.0.1:4173' && route.request().resourceType() !== 'media') return route.continue();
      if (requestUrl.hostname === 'images.example.test' && route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      externalRequests++;
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

      // Controlled download chunks exercise the speed-test UI without networking.
      const originalNow = performance.now.bind(performance);
      let elapsed = 0;
      performance.now = () => originalNow() + elapsed;
      const realDateNow = Date.now.bind(Date);
      let dateOffset = 0;
      Date.now = () => realDateNow() + dateOffset;
      window.__advanceTime = milliseconds => { dateOffset += milliseconds; };
      Object.defineProperty(window, 'LGCatalogStore', {
        configurable: true,
        set(api) {
          const createStore = api.createStore;
          api.createStore = (...args) => {
            const store = createStore(...args); const load = store.load;
            store.load = () => {
              if (!window.__holdNextCatalogLoad) return load();
              window.__holdNextCatalogLoad = false;
              return new Promise(resolve => { window.__resumeCatalogLoad = () => load().then(resolve); });
            };
            return store;
          };
          Object.defineProperty(window, 'LGCatalogStore', { configurable: true, writable: true, value: api });
        }
      });
      window.__speedRequests = [];
      window.__playlistRequests = [];
      window.__openedUrls = [];
      window.__bridgeCalls = [];
      window.PalmServiceBridge = class {
        call(uri, payload) {
          window.__bridgeCalls.push({ uri, payload: JSON.parse(payload) });
          const response = window.__failNextBridge ? { returnValue: false } : { returnValue: true };
          window.__failNextBridge = false;
          queueMicrotask(() => this.onservicecallback(JSON.stringify(response)));
        }
      };
      window.open = url => { window.__openedUrls.push(String(url)); return {}; };
      window.fetch = (url, options) => {
        if (!String(url).startsWith('https://speed.cloudflare.com/')) {
          const request = { url: String(url), options, aborted: false };
          window.__playlistRequests.push(request);
          options.signal.addEventListener('abort', () => { request.aborted = true; }, { once: true });
          if (window.__failNextPlaylist) { window.__failNextPlaylist = false; return Promise.reject(new TypeError('Synthetic automatic refresh failure')); }
          if (window.__stallNextPlaylist) { window.__stallNextPlaylist = false; return new Promise(() => {}); }
          if (String(url).includes('/fail')) return Promise.reject(new TypeError('Synthetic failure'));
          if (String(url).includes('/stall')) return new Promise(() => {});
          const lines = ['#EXTM3U'];
          for (let index = 1; index <= 120; index++) {
            const group = index === 64 ? 'قنوات أفلام' : index > 106 ? 'مسلسلات VOD' : index > 64 ? 'أفلام VOD' : index <= 8 ? `مجموعة ${Math.ceil(index / 4)}` : `مجموعة ${index}`;
            const metadata = index === 65 ? ' year="2024" rating="8.4" added="1731542400" description="وصف تجريبي من المزود" trailer="https://media.example.test/trailer/65.mp4"' : index === 66 ? ' year="2022" rating="7.1" added="1700000000"' : '';
            const details = metadata + (index > 64 && index <= 106 ? ` tvg-logo="https://images.example.test/${index}.png"` : '');
            lines.push(`#EXTINF:-1 group-title="${group}"${details},قناة ${index}`);
            lines.push(`https://media.example.test/${index > 106 ? 'series' : index > 64 ? 'movie' : 'live'}/${index}.m3u8?token=synthetic`);
          }
          const payload = window.__customPlaylist === undefined ? lines.join('\n') : window.__customPlaylist;
          delete window.__customPlaylist;
          const bytes = new TextEncoder().encode(payload);
          const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
          return Promise.resolve({ ok: true, status: 200, headers: { get: name => name === 'content-length' ? String(bytes.byteLength) : null }, body });
        }
        const request = { url: String(url), options, aborted: false, controller: null };
        window.__speedRequests.push(request);
        const body = new ReadableStream({ start(controller) { request.controller = controller; } });
        options.signal.addEventListener('abort', () => {
          request.aborted = true;
          request.controller.error(new DOMException('Cancelled synthetic download', 'AbortError'));
        }, { once: true });
        return Promise.resolve({ ok: true, status: 200, body });
      };
      window.__finishSpeed = () => {
        const request = window.__speedRequests[window.__speedRequests.length - 1];
        elapsed += 1000;
        request.controller.enqueue(new Uint8Array(1000000));
        request.controller.close();
      };
      window.__catalogSavedAt = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('lg-stream-catalog', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result.transaction('meta', 'readonly').objectStore('meta').get('active');
          get.onerror = () => reject(get.error); get.onsuccess = () => resolve(get.result && get.result.savedAt);
        };
      });
    });
    await page.goto('http://127.0.0.1:4173');
    await mkdir(path.join(root, 'artifacts'), { recursive: true });
    assert.equal(await page.locator('#launch-splash').isVisible(), true, 'Launch identity appears once on initial application load');
    await page.waitForTimeout(650);
    assert.ok(await page.locator('#launch-splash img').evaluate(image => image.complete && image.naturalWidth > 0), 'Launch identity asset must load');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-launch-1080.png') });
    await page.locator('#launch-splash').waitFor({ state: 'detached', timeout: 2500 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.locator('#launch-splash').count(), 0, 'Returning inside the same session must not replay the launch identity');
    async function insideViewport(selector) {
      const box = await page.locator(selector).boundingBox();
      const viewport = page.viewportSize();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} must remain inside the viewport`);
    }
    async function setMediaTracks(audioTracks, textTracks = []) {
      await page.evaluate(({ audioTracks, textTracks }) => {
        const video = document.querySelector('video');
        Object.defineProperty(video, 'audioTracks', { configurable: true, value: audioTracks });
        Object.defineProperty(video, 'textTracks', { configurable: true, value: textTracks });
      }, { audioTracks, textTracks });
    }
    async function remoteBack() {
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
    }
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      for (const selector of ['#start-button', '#setup-button', '#nav-settings', '.viewing-panel', '.transport']) await insideViewport(selector);
      await page.screenshot({ path: path.join(root, `artifacts/ui-idle-${height}.png`) });
      if (!await page.locator('#settings-home').isVisible()) await page.locator('#nav-settings').click();
      await page.locator('#settings-speed').click();
      for (const selector of ['#speed-wired', '#speed-wifi', '#speed-start', '#close-speed']) await insideViewport(selector);
      assert.equal(await page.locator('#speed-start').isDisabled(), true, 'Choose a connection label before starting');
      assert.equal(await page.evaluate(() => window.__speedRequests.length), 0, 'Opening speed-test controls must not download anything');
      await page.screenshot({ path: path.join(root, `artifacts/ui-speed-${height}.png`) });
      await page.locator('#close-speed').click();
      await page.locator('#close-settings').click();
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.locator('#start-button').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'source-form', 'Opening setup must leave inputs unfocused so webOS can open its keyboard on selection');
    await page.locator('#source-1').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'source-1');
    await page.locator('#clear-sources').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'playlist-url');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'clear-sources');
    await page.locator('#source-1').fill('https://example.test/first.m3u8?token=synthetic');
    await page.locator('#source-2').fill('https://example.test/second.m3u8');
    await page.locator('#source-3').fill('https://example.test/third.m3u8');
    await page.locator('#source-form button[type=submit]').click();
    assert.equal(await page.evaluate(() => window.__mediaStarts), 0);
    assert.equal(await page.locator('#source-1').inputValue(), '');
    assert.equal((await page.locator('body').innerText()).includes('example.test'), false);
    await page.screenshot({ path: path.join(root, 'artifacts/ui-channels-1080.png') });

    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '1');
    assert.equal(await page.evaluate(() => window.__mediaStarts), 0, 'Highlighting a channel must not start media');
    await page.keyboard.press('ArrowLeft');
    assert.notEqual(await page.evaluate(() => document.activeElement.dataset.index), '2', 'Left must leave the vertical channel list');
    await page.locator('#channels .channel-button').nth(1).focus();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '1', 'The selected channel must receive Enter');
    await page.keyboard.press('Enter');
    assert.deepEqual(errors, [], 'Browser errors before the first playback request');
    assert.equal(await page.evaluate(() => window.__mediaStarts), 1);
    assert.equal(await page.locator('#quality-badge').innerText(), 'FHD · 1920×1080');
    const fitStarts = await page.evaluate(() => window.__mediaStarts);
    await page.locator('#display-button').click();
    assert.equal(await page.locator('#video-host').getAttribute('data-fit'), 'cover');
    assert.equal(await page.evaluate(() => window.__mediaStarts), fitStarts, 'Changing picture fit must preserve the media element');
    const fittedRectangle = await page.locator('video').evaluate(video => ({ width: parseFloat(video.style.width), height: parseFloat(video.style.height) }));
    assert.ok(Math.abs(fittedRectangle.width / fittedRectangle.height - 1920 / 1080) < 0.001, 'The video rectangle itself preserves source aspect ratio on native renderers');
    await page.locator('#channels .channel-button').nth(1).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__mediaStarts), 1, 'Selecting the current channel must not restart it');
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), true, 'Double OK must enter fullscreen without reconnecting');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#seek-controls').isVisible(), false, 'Live controls do not advertise VOD seeking');
    assert.equal(await page.locator('#audio-language').isDisabled(), true, 'Missing native audio tracks disable selection');
    assert.equal(await page.locator('#subtitle-language').isDisabled(), true, 'Missing native subtitle tracks disable selection');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('#retry-button').click();
    assert.equal(await page.evaluate(() => window.__mediaStarts), 2, 'Explicit retry must restart media');
    assert.equal(await page.locator('video').count(), 1);

    await page.evaluate(() => { window.__originalVideo = document.querySelector('video'); });
    await page.locator('#display-fullscreen').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), false);
    assert.equal(await page.evaluate(() => document.querySelector('video') === window.__originalVideo), true, 'Leaving fullscreen must preserve the current media');
    assert.equal(await page.evaluate(() => window.__mediaStarts), 2);

    async function pendingThen(action) {
      const count = await page.evaluate(() => window.__mediaStarts);
      await page.evaluate(action => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', keyCode: 33, bubbles: true }));
        if (action === 'pause') document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 19, bubbles: true }));
        else document.getElementById(action).click();
      }, action);
      await page.waitForTimeout(180); // Longer than the documented 120ms channel coalescing delay.
      assert.equal(await page.evaluate(() => window.__mediaStarts), count, `${action} must cancel the pending channel request`);
    }
    await pendingThen('nav-settings');
    await page.locator('#settings-info').click();
    assert.equal(await page.locator('#diagnostics-panel .capability-list li').count(), 5, 'LG native readiness lists the five requested formats without probing media');
    assert.match(await page.locator('#diagnostics-panel .capability-list').innerText(), /HDR10.*Dolby Vision.*HLG.*4K HEVC.*4K AV1/s);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close-diagnostics');
    await page.keyboard.press('Escape');
    await page.locator('#close-settings').click();
    await pendingThen('setup-button');
    assert.equal(await page.evaluate(() => document.getElementById('setup-panel').contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#source-1').inputValue(), '');
    await pendingThen('nav-search');
    assert.equal(await page.locator('#search-panel').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('#display-fullscreen').click();
    await page.keyboard.press('Enter');
    await pendingThen('media-toggle');
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true, 'Fullscreen pause cancels the pending channel too');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await pendingThen('pause');
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    await pendingThen('stop-button');
    assert.equal(await page.locator('video').count(), 0);

    await page.locator('#channels .channel-button').first().click();
    const beforeHide = await page.evaluate(() => window.__mediaStarts);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('video').count(), 0, 'Leaving the app must release media');
    assert.equal(await page.evaluate(() => window.__mediaStarts), beforeHide, 'Returning must not automatically restart media');
    await page.locator('#channels .channel-button').first().click();
    await page.locator('#display-fullscreen').click();
    await setMediaTracks([{ language: 'ar', enabled: true }, { language: 'en', enabled: false }], [{ kind: 'captions', language: 'en', mode: 'disabled' }]);
    await page.keyboard.press('ArrowRight');
    const liveTrackStarts = await page.evaluate(() => window.__mediaStarts);
    await page.locator('#audio-language').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => document.querySelector('video').audioTracks.map(track => track.enabled)), [false, true], 'Live audio uses the same remote picker');
    await page.locator('#subtitle-language').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('video').textTracks[0].mode), 'showing', 'Live captions can be selected');
    assert.equal(await page.evaluate(() => window.__mediaStarts), liveTrackStarts, 'Live track changes preserve playback');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#track-picker').isVisible(), true);
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('error')));
    assert.equal(await page.locator('#track-picker').isVisible(), false, 'Source failure closes the picker');
    assert.equal(await page.locator('#track-list button').count(), 0, 'Source failure discards old track choices');
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), true, 'Live failure must preserve watching mode');
    assert.match(await page.locator('#status').innerText(), /جارٍ إعادة الاتصال… \(1\/3\)/, 'A live failure announces the bounded automatic reconnect');
    assert.equal(await page.locator('#status').isVisible(), true, 'Live failure message is visible over the video');
    assert.equal(await page.locator('#media-controls').isVisible(), false);
    const failedStarts = await page.evaluate(() => window.__mediaStarts);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), failedStarts, 'First channel boundary must not wrap or retry');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), failedStarts + 1, 'Down moves past a broken live channel');
    assert.equal(await page.locator('video').count(), 1);
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), true);
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('ended')));
    assert.match(await page.locator('#status').innerText(), /البث مقطوع/);
    assert.equal(await page.locator('#status').isVisible(), true, 'Live failure message is visible over the video');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), failedStarts + 2, 'Up works after live stream ends');
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), failedStarts + 2, 'Back cancels a queued channel switch');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '0');
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), false, 'Only explicit Back exits live watching');
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('error')));
    const startsBeforeQuickFailure = await page.evaluate(() => window.__mediaStarts);
    await page.evaluate(() => {
      const channel = document.querySelector('#channels .channel-button');
      // Run synchronously so the second OK is deterministically within 700ms.
      channel.click();
      document.querySelector('video').dispatchEvent(new Event('error'));
      channel.click();
    });
    assert.equal(await page.evaluate(() => window.__mediaStarts), startsBeforeQuickFailure + 2, 'Second OK after a rapid failure retries media instead of entering empty fullscreen');
    assert.equal(await page.locator('video').count(), 1);
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), false);

    // The single-source case must not reconnect when channel keys wrap around.
    await page.locator('#setup-button').click();
    await page.locator('#source-2').fill('');
    await page.locator('#source-3').fill('');
    await page.locator('#source-form button[type=submit]').click();
    await page.locator('#channels .channel-button').first().click();
    const singleStarts = await page.evaluate(() => window.__mediaStarts);
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), singleStarts);

    // A full private M3U URL loads names into memory and renders only one small page at a time.
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://provider.example.test/get.php?username=private&password=secret&type=m3u_plus&output=mpegts');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), 1);
    assert.match(await page.locator('#status').innerText(), /تم حفظ 120 عنصر/);

    // Failed and cancelled refreshes must leave the last complete catalogue intact.
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://provider.example.test/fail');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('playlist-status').textContent.includes('السابقة'));
    await page.locator('#close-setup').click();
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), 2, 'A failed manual load restores the released catalogue locally');
    const savedBeforeInvalidResponse = await page.evaluate(() => window.__catalogSavedAt());
    await page.locator('#setup-button').click();
    await page.evaluate(() => { window.__customPlaylist = '<html>Provider error</html>\nhttps://media.example.test/error-ad.mp4'; });
    await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => !document.getElementById('refresh-saved').disabled);
    assert.equal(await page.locator('#setup-panel').isVisible(), true, 'A non-M3U download must be rejected');
    assert.equal(await page.evaluate(() => window.__catalogSavedAt()), savedBeforeInvalidResponse, 'A provider error page cannot replace the saved catalogue');
    await page.locator('#close-setup').click();
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://provider.example.test/stall');
    await page.locator('#load-playlist').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 0, 'A manual load releases the previous catalogue before downloading');
    await page.locator('#cancel-playlist').click();
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40);
    assert.equal(await page.locator('#setup-panel').isVisible(), true, 'Cancelling restores the catalogue without closing setup');
    await page.locator('#close-setup').click();
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached', timeout: 2500 });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), 0, 'Startup restores the last complete catalogue without a network request');
    assert.match(await page.locator('#status').innerText(), /استُعيدت القائمة المحفوظة/);
    await page.locator('#groups [data-group="مجموعة 2"]').click();
    await page.locator('#channels .favorite-button').first().click();
    await page.locator('#channels .channel-button').nth(2).focus();
    await page.locator('#setup-button').click();
    await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.equal(await page.locator('#groups .group-button.active').getAttribute('data-group'), 'مجموعة 2', 'Manual refresh of the same source preserves the active group');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '6', 'Manual refresh restores the selected channel');
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-pressed'), 'true', 'Manual refresh preserves favorites');
    const beforePageReturn = await page.evaluate(() => ({ requests: window.__playlistRequests.length, starts: window.__mediaStarts }));
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 4);
    assert.equal(await page.locator('#groups .group-button.active').getAttribute('data-group'), 'مجموعة 2', 'Returning to a suspended page restores its saved catalogue');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '6');
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => ({ requests: window.__playlistRequests.length, starts: window.__mediaStarts })), beforePageReturn, 'Page return restores locally without downloading or starting media');
    const beforeRestoreRace = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => {
      window.__stallNextPlaylist = true;
      window.__advanceTime(24 * 60 * 60 * 1000 + 1);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, beforeRestoreRace);
    await page.evaluate(() => { window.__holdNextCatalogLoad = true; });
    await page.locator('#setup-button').click();
    await page.waitForFunction(() => typeof window.__resumeCatalogLoad === 'function');
    assert.equal(await page.locator('#channels .channel-button').count(), 0, 'Keep restoration pending while the settings remain usable');
    assert.equal(await page.locator('#manage-groups-button').isDisabled(), true, 'Group management waits for the released catalogue to return');
    await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    await page.evaluate(async () => { await window.__resumeCatalogLoad(); delete window.__resumeCatalogLoad; });
    assert.equal(await page.locator('#groups .group-button.active').getAttribute('data-group'), 'مجموعة 2', 'Refreshing before cancelled-download restoration completes preserves the original group');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '6', 'The old restoration cannot overwrite the refreshed selection');
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-pressed'), 'true', 'Refresh during restoration retains the original favorites');
    const beforeFailedRestoreRace = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => {
      window.__stallNextPlaylist = true; window.__advanceTime(24 * 60 * 60 * 1000 + 1);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, beforeFailedRestoreRace);
    await page.evaluate(() => { window.__holdNextCatalogLoad = true; });
    await page.locator('#setup-button').click();
    await page.waitForFunction(() => typeof window.__resumeCatalogLoad === 'function');
    await page.evaluate(() => { window.__failNextPlaylist = true; });
    await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => !document.getElementById('refresh-saved').disabled);
    await page.evaluate(async () => { await window.__resumeCatalogLoad(); delete window.__resumeCatalogLoad; });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 4);
    assert.equal(await page.locator('#groups .group-button.active').getAttribute('data-group'), 'مجموعة 2', 'A failed manual refresh does not discard the pending original view');
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-pressed'), 'true');
    await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '6', 'Retry after a failed refresh restores the original selection');

    await page.waitForTimeout(180); // Finish any legitimate scroll-position save before releasing the catalogue.
    const viewBeforeReleasedUnload = await page.evaluate(() => localStorage.getItem('lg-stream-view-v1'));
    const beforeReleasedUnload = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => {
      window.__stallNextPlaylist = true; window.__advanceTime(24 * 60 * 60 * 1000 + 1);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, beforeReleasedUnload);
    assert.equal(await page.locator('#channels .channel-button').count(), 0);
    await page.evaluate(() => document.getElementById('channels').dispatchEvent(new Event('scroll')));
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-view-v1')), viewBeforeReleasedUnload, 'A delayed view-save timer cannot save the temporarily empty catalogue');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-view-v1')), viewBeforeReleasedUnload, 'Closing during automatic refresh preserves the last complete view and favorites');
    const fakeTimeBeforeReload = await page.evaluate(() => Date.now());
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached', timeout: 2500 });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 4);
    assert.equal(await page.locator('#groups .group-button.active').getAttribute('data-group'), 'مجموعة 2');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '6');
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-pressed'), 'true', 'Favorites survive reloading after the catalogue was temporarily released');
    await page.evaluate(time => window.__advanceTime(time - Date.now()), fakeTimeBeforeReload);
    await page.locator('#channels .favorite-button').first().click();
    await page.locator('#groups [data-group=""]').click();
    const savedBeforeAutomaticFailure = await page.evaluate(() => window.__catalogSavedAt());
    await page.locator('#channels .channel-button').first().click();
    const requestsBeforeAutomatic = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => { window.__failNextPlaylist = true; window.__advanceTime(24 * 60 * 60 * 1000 + 1); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), requestsBeforeAutomatic, 'Due automatic refresh must not start while media is active');
    await page.locator('#stop-button').click();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), requestsBeforeAutomatic, 'Stopping media is user activity, not permission to immediately refresh');
    await page.evaluate(() => {
      window.__advanceTime(30000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), requestsBeforeAutomatic, 'Automatic refresh requires a complete minute without user input');
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
      window.__advanceTime(2000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), requestsBeforeAutomatic, 'Navigating resets the inactivity window');
    await page.evaluate(() => { window.__advanceTime(60001); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, requestsBeforeAutomatic);
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('القائمة السابقة'));
    assert.equal(await page.evaluate(() => window.__catalogSavedAt()), savedBeforeAutomaticFailure, 'Failed automatic refresh must not advance the last-success timestamp');
    const requestsAfterAutomaticFailure = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => { window.__advanceTime(59 * 60 * 1000); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), requestsAfterAutomaticFailure, 'Automatic failure uses bounded backoff instead of a tight retry loop');
    await page.evaluate(() => { window.__advanceTime(60 * 1000 + 1); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, requestsAfterAutomaticFailure);
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('تم تحديث القائمة تلقائيًا'));
    assert.ok(await page.evaluate(() => window.__catalogSavedAt()) > savedBeforeAutomaticFailure, 'Successful retry advances the last-success timestamp');

    const requestsBeforePendingSwitch = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => {
      window.__advanceTime(24 * 60 * 60 * 1000 + 1); window.__stallNextPlaylist = true;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', keyCode: 33, bubbles: true }));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), requestsBeforePendingSwitch, 'Pending 120ms channel switch blocks automatic refresh');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('video').count(), 1, 'Pending channel request still starts normally');
    await page.locator('#stop-button').click();
    await page.evaluate(() => { window.__advanceTime(60001); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, requestsBeforePendingSwitch);
    assert.equal(await page.locator('#channels .channel-button').count(), 0, 'Automatic refresh releases the in-memory catalogue while keeping the saved copy');
    if (!await page.locator('#settings-home').isVisible()) await page.locator('#nav-settings').click();
      await page.locator('#settings-speed').click();
    assert.equal(await page.evaluate(() => window.__playlistRequests.at(-1).aborted), true, 'A foreground click cancels a pending automatic catalogue download immediately');
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40);
    assert.equal(await page.evaluate(() => document.getElementById('speed-panel').contains(document.activeElement)), true, 'Catalogue restoration must not steal focus from the newly opened dialog');
    assert.equal(await page.evaluate(() => window.__speedRequests.length), 0, 'Opening controls restores the saved catalogue without starting another download');
    await page.locator('#speed-wired').click();
    await page.locator('#speed-start').click();
    assert.equal(await page.evaluate(() => window.__speedRequests.length), 1);
    await page.locator('#speed-cancel').click();
    await page.locator('#close-speed').click();
      await page.locator('#close-settings').click();
    await page.evaluate(() => { window.__speedRequests = []; });

    // Opening settings during an automatic refresh must cancel and reschedule it
    // with the short foreground-action backoff instead of losing it forever.
    const requestsBeforeDirectCancel = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => {
      window.__stallNextPlaylist = true;
      window.__advanceTime(5 * 60 * 1000 + 1);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, requestsBeforeDirectCancel);
    await page.locator('#setup-button').click();
    assert.equal(await page.evaluate(() => window.__playlistRequests.at(-1).aborted), true, 'Opening settings aborts the automatic catalogue download');
    await page.locator('#close-setup').click();
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40);
    const requestsAfterDirectCancel = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => { window.__advanceTime(4 * 60 * 1000); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__playlistRequests.length), requestsAfterDirectCancel, 'Direct cancellation waits for the five-minute backoff');
    await page.evaluate(() => { window.__advanceTime(60 * 1000 + 1); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, requestsAfterDirectCancel);
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('تم تحديث القائمة تلقائيًا'));

    // If the app is backgrounded during an automatic refresh, keep the large
    // saved catalogue on disk and restore it only after returning foreground.
    const requestsBeforeBackgroundCancel = await page.evaluate(() => window.__playlistRequests.length);
    await page.evaluate(() => {
      window.__stallNextPlaylist = true;
      window.__advanceTime(24 * 60 * 60 * 1000 + 1);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(count => window.__playlistRequests.length === count + 1, requestsBeforeBackgroundCancel);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => window.__playlistRequests.at(-1).aborted), true, 'Backgrounding aborts the automatic catalogue download');
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#channels .channel-button').count(), 0, 'The saved catalogue is not reloaded into memory while hidden');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40);

    const longLabelsFit = await page.evaluate(() => {
      const nodes = [document.querySelector('#groups .group-button'), document.querySelector('#channels .channel-label'), document.getElementById('channel-title')];
      return nodes.map(node => {
        const original = node.textContent;
        node.textContent = 'مجموعة القنوات الرياضية العربية بجميع البطولات والجودة العالية';
        const fits = node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1;
        node.textContent = original; return fits;
      });
    });
    assert.deepEqual(longLabelsFit, [true, true, true], 'Long group and channel names wrap without clipping');
    await page.locator('#groups [data-group="مجموعة 2"]').click();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'favorite-button', 'The remote can reach favorites');
    await page.locator('#channels .favorite-button').first().focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.favoriteIndex), '4', 'Favorite navigation also stops at the channel boundary');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.group), 'مجموعة 2', 'Left restores the same group');
    await page.keyboard.press('ArrowRight');
    await page.locator('#channels .channel-button').first().focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '4', 'Up stops at the first channel');
    await page.locator('#channels .channel-button').last().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '7', 'Down stops at the last channel');
    await page.locator('#groups [data-group=""]').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 40);
    assert.equal(await page.locator('#channel-paging').count(), 0, 'Channels scroll without previous/next controls');
    assert.equal((await page.locator('body').innerText()).includes('provider.example.test'), false);
    assert.equal((await page.locator('body').innerText()).includes('password=secret'), false);
    assert.match(await page.locator('#channels').innerText(), /قناة 1/);
    await page.locator('#channels .channel-button').last().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '40', 'Channel window advances while scrolling with the remote');
    assert.ok(await page.locator('#groups .group-button').count() <= 40, 'Large group lists keep a bounded DOM window');
    await page.locator('#groups .group-button').first().focus();
    for (let index = 0; index < 58; index++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.group), 'قنوات أفلام', 'Remote navigation reaches groups beyond the DOM window');
    await page.evaluate(() => {
      const groups = document.getElementById('groups'); groups.scrollTop = 0;
      groups.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    });
    assert.notEqual(await page.evaluate(() => document.activeElement.dataset.group), 'قنوات أفلام', 'Magic Remote wheel moves the virtual group window');
    assert.ok(await page.locator('#groups .group-button').count() <= 40, 'Wheel navigation keeps the group DOM bounded');
    const groupBounds = await page.evaluate(() => {
      const item = document.activeElement.getBoundingClientRect();
      const list = document.getElementById('groups').getBoundingClientRect();
      return { visible: item.top >= list.top - 1 && item.bottom <= list.bottom + 1, scrollTop: document.getElementById('groups').scrollTop };
    });
    assert.equal(groupBounds.visible, true, 'Focused group must remain visible inside the scrolling list');
    assert.ok(groupBounds.scrollTop > 0, 'A long group list must actually scroll');
    await page.locator('#channels .favorite-button').first().click();
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-pressed'), 'true');
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('.library-panel').getAttribute('class'), 'library-panel primary-open');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.groups-panel') !== null), true);
    assert.equal(await page.evaluate(() => document.activeElement.closest('.groups-panel') !== null), true);
    await page.keyboard.press('ArrowLeft');
    await page.locator('.primary-button[data-section="favorites"]').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 1);
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('.primary-button[data-section="tv"]').click();
    await page.locator('#groups [data-group="مجموعة 2"]').focus();
    assert.match(await page.locator('#channels').innerText(), /قناة 5/);
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('#nav-search').click();
    await page.locator('#channel-search').fill('قناة 17');
    await page.waitForFunction(() => document.getElementById('search-results').textContent.includes('البث المباشر (1)'));
    assert.match(await page.locator('#search-results').innerText(), /البث المباشر \(1\)/);
    assert.match(await page.locator('#search-results').innerText(), /قناة 17/);
    await page.locator('#clear-search').click();
    await page.locator('#close-search').click();
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('#channels .channel-button').first().click();
    const startsBeforeDetails = await page.evaluate(() => window.__mediaStarts);
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', keyCode: 33, bubbles: true }));
      document.querySelector('.primary-button[data-section="movies"]').click();
      document.querySelector('#movie-grid .movie-card').click();
    });
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), startsBeforeDetails, 'Opening content details cancels a previously queued live-channel request');
    assert.equal(await page.locator('video').count(), 0, 'Entering the content library stops live audio hidden behind its cards');
    assert.equal(await page.locator('#details-panel').isVisible(), true);
    await page.locator('#close-details').click();
    await page.locator('#groups [data-group="أفلام VOD"]').click();
    assert.equal(await page.locator('#movie-grid .movie-card').count(), 24);
    assert.equal(await page.locator('#movie-grid .movie-poster').count(), 24);
    await page.waitForFunction(() => document.querySelectorAll('#movie-grid .movie-poster[src]').length > 0);
    const assignedPosters = await page.locator('#movie-grid .movie-poster[src]').count();
    assert.ok(assignedPosters > 0 && assignedPosters < 24, 'Only posters inside the visible viewport receive a source');
    assert.equal(await page.locator('#movie-paging').count(), 0, 'VOD scrolls without previous/next controls');
    await page.locator('#movie-grid .movie-card').last().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '91', 'The virtual VOD window advances continuously with the remote');
    await page.locator('#groups [data-group="أفلام VOD"]').click();
    await page.locator('#movie-browser').evaluate(browser => { browser.scrollTop = browser.scrollHeight; browser.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); });
    assert.equal(await page.locator('#movie-grid .movie-card').first().getAttribute('data-index'), '76', 'Magic Remote wheel advances the virtual VOD window');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('movie-card')), true, 'Wheel keeps focus inside the VOD cards');
    await page.locator('#movie-browser').evaluate(browser => { browser.scrollTop = browser.scrollHeight; browser.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); });
    await page.locator('#movie-grid [data-index="102"]').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '105', 'ArrowDown reaches the final partial VOD row');
    await page.locator('#sort-button').click();
    assert.equal(await page.locator('#sort-menu [data-sort="year"]').isDisabled(), false);
    await page.locator('#sort-menu [data-sort="year"]').click();
    assert.match(await page.locator('#sort-button').innerText(), /السنة/);
    await page.locator('#groups [data-group="أفلام VOD"]').click();
    await page.locator('#movie-grid .movie-card').first().click();
    assert.equal(await page.locator('#details-panel').isVisible(), true);
    assert.match(await page.locator('#details-year').innerText(), /2024/);
    assert.match(await page.locator('#details-description').innerText(), /وصف تجريبي/);
    assert.equal(await page.locator('#details-trailer').isVisible(), true);
    assert.equal(await page.locator('#details-poster').isVisible(), true);
    await page.locator('#details-trailer').click();
    await page.keyboard.press('Enter'); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'media-display');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('video').count(), 0, 'Leaving fullscreen releases provider trailers too');
    assert.equal(await page.locator('#movie-browser').isVisible(), true);
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('#nav-search').click();
    await page.locator('#channel-search').fill('قناة 66');
    await page.locator('#search-results button', { hasText: 'قناة 66' }).click();
    assert.match(await page.locator('#details-trailer').innerText(), /YouTube/);
    await page.locator('#details-trailer').click();
    const launch = await page.evaluate(() => window.__bridgeCalls.at(-1));
    assert.equal(launch.uri, 'luna://com.webos.applicationManager/launch');
    assert.equal(launch.payload.id, 'youtube.leanback.v4');
    const contentTarget = new URL(launch.payload.params.contentTarget);
    assert.equal(contentTarget.origin + contentTarget.pathname, 'https://www.youtube.com/tv');
    assert.equal(contentTarget.searchParams.get('launch'), 'voice');
    assert.equal(contentTarget.searchParams.get('vq'), 'Search for قناة 66 2022 on YouTube');
    assert.doesNotMatch(launch.payload.params.contentTarget, /token|password|media\.example/);
    await page.evaluate(() => { window.__failNextBridge = true; });
    await page.locator('#details-trailer').click();
    await page.waitForFunction(() => document.getElementById('details-status').textContent.includes('تعذر فتح تطبيق YouTube'));
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached', timeout: 2500 });
    await page.waitForFunction(() => !document.getElementById('details-panel').hidden);
    assert.match(await page.locator('#details-title').innerText(), /قناة 66/, 'Returning after reload restores the same content details');
    assert.equal(await page.locator('.primary-button.active').getAttribute('data-section'), 'movies');
    assert.equal(await page.locator('#groups .group-button.active').getAttribute('data-group'), 'أفلام VOD');
    await page.locator('#close-details').click();
    await page.locator('#movie-grid [data-index="64"]').click();
    await page.locator('#details-play').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), true, 'Movie playback enters app fullscreen immediately');
    const movieStarts = await page.evaluate(() => window.__mediaStarts);
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), movieStarts, 'Channel keys cannot replace an actively watched movie');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('video').count(), 0, 'Back from movie releases its source');
    await page.locator('#movie-grid [data-index="64"]').click();
    await page.locator('#details-play').click();
    assert.equal(await page.locator('video').count(), 1, 'The same movie can immediately open again');
    await setMediaTracks([{ language: 'ar', enabled: true }], [{ kind: 'metadata', mode: 'hidden' }]);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#audio-language').isDisabled(), true, 'One audio track is informational, not a selectable menu');
    assert.match(await page.locator('#audio-language').innerText(), /ar.*مسار واحد/);
    assert.equal(await page.locator('#subtitle-language').isDisabled(), true, 'Metadata tracks are not subtitles');
    await page.locator('#audio-language').evaluate(button => button.click());
    assert.equal(await page.locator('#track-picker').isVisible(), false, 'A single audio track cannot open the picker');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'media-toggle');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'seek-position');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'seek-back');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'seek-position');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'seek-forward');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'media-toggle');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'media-display');
    const previousFit = await page.locator('#video-host').getAttribute('data-fit') || 'contain';
    await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    const nextFit = { contain: 'cover', cover: 'zoom125', zoom125: 'zoom135', zoom135: 'contain' };
    assert.equal(await page.locator('#video-host').getAttribute('data-fit'), nextFit[previousFit], 'Holding OK advances picture fit only once');
    assert.equal(await page.locator('#media-controls').isVisible(), true, 'Picture fit stays directly in playback controls');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'media-display');
    await page.keyboard.press('Escape');
    await setMediaTracks([{ language: 'ar', enabled: true }, { language: 'en', enabled: false }], [{ kind: 'metadata', mode: 'hidden' }, { kind: 'subtitles', language: 'ar', mode: 'disabled' }]);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#media-controls').isVisible(), true);
    await page.waitForFunction(() => document.getElementById('seek-status').textContent === '');
    for (const [width, height] of [[1280, 720], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      const controlsBox = await page.locator('#media-controls').boundingBox();
      assert.ok(controlsBox.height <= height * 0.35, `Playback controls stay below 35% of the ${height}p screen`);
      await insideViewport('#media-controls');
      await page.screenshot({ path: path.join(root, `artifacts/ui-playback-controls-${height}.png`) });
    }
    await page.evaluate(() => { window.__trackVideo = document.querySelector('video'); });
    const controlStarts = await page.evaluate(() => window.__mediaStarts);
    const seekWrites = await page.evaluate(() => window.__seekWrites);
    await page.locator('#seek-forward').click({ clickCount: 3 });
    const pendingTime = await page.locator('#playback-time').innerText();
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('timeupdate')));
    assert.equal(await page.locator('#playback-time').innerText(), pendingTime, 'Playback events preserve the pending seek preview');
    await page.waitForFunction(() => document.querySelector('video').currentTime >= 90);
    assert.equal(await page.evaluate(() => window.__seekWrites), seekWrites + 1, 'Rapid seek presses commit only the final position');
    await page.locator('#seek-back').click({ clickCount: 3 });
    await page.waitForFunction(() => document.querySelector('video').currentTime < 1);
    await page.locator('#audio-language').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'subtitle-language', 'Horizontal arrows move between track buttons');
    assert.equal(await page.evaluate(() => document.querySelector('video').audioTracks[0].enabled), true, 'Moving focus must not switch audio');
    await page.locator('#audio-language').focus();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    assert.equal(await page.locator('#track-picker').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#track-picker').isVisible(), true, 'Holding OK opens the picker without immediately selecting a track');
    assert.equal(await page.locator('#audio-language').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#track-list button').count(), 2);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '0', 'The current audio track initially receives focus');
    for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '0', `${key} cannot leave the first track`);
    }
    await insideViewport('#track-picker .track-card');
    await page.screenshot({ path: path.join(root, 'artifacts/ui-track-picker-1080.png') });
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '1');
    assert.equal(await page.evaluate(() => document.querySelector('video').audioTracks[0].enabled), true, 'Highlighting another track must not select it');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelector('video').audioTracks, track => track.enabled)), [false, true]);
    assert.equal(await page.locator('#track-picker').isVisible(), false, 'Holding OK after choosing cannot reopen the picker');
    assert.equal(await page.locator('#audio-language').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'audio-language', 'Selection restores the opener');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '1');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => document.querySelector('video').audioTracks.map(track => track.enabled)), [false, true], 'Cancelling a highlighted track keeps the selected audio');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'audio-language');
    assert.equal(await page.locator('#media-controls').isVisible(), true);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close-track-picker', 'Down stops on the final Back button');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '1', 'Up from Back returns to the final track');
    await page.locator('#video-host').evaluate(host => host.click());
    assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '1', 'Playback controls cannot steal focus from the picker');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#track-picker').isVisible(), false, 'The dialog Back button closes only the picker');
    await page.locator('#subtitle-language').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.locator('#track-list button').evaluateAll(buttons => buttons.map(button => button.dataset.trackIndex)), ['-1', '1'], 'Subtitle choices preserve native indexes and exclude metadata');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '-1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('video').textTracks[1].mode), 'showing');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'subtitle-language');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.trackIndex), '1', 'Reopening selects the currently showing subtitle');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => document.querySelector('video').textTracks.map(track => track.mode)), ['hidden', 'disabled'], 'Off disables subtitles while preserving metadata tracks');
    assert.equal(await page.evaluate(() => window.__mediaStarts), controlStarts, 'Seeking and track changes do not reopen the source');
    assert.equal(await page.evaluate(() => document.querySelector('video') === window.__trackVideo), true, 'Track selection keeps the same media element');
    assert.equal(await page.locator('video').count(), 1);
    await page.locator('#media-toggle').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true, 'Remote OK activates playback controls');
    await page.locator('#audio-language').focus();
    await page.keyboard.press('Enter');
    await remoteBack();
    assert.equal(await page.locator('#track-picker').isVisible(), false, 'LG Back first closes only the picker');
    assert.equal(await page.locator('#media-controls').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'audio-language');
    assert.equal(await page.locator('video').count(), 1);
    await remoteBack();
    assert.equal(await page.locator('#media-controls').isVisible(), false);
    assert.equal(await page.locator('video').count(), 1, 'Second LG Back closes controls while preserving the movie');
    await remoteBack();
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('movie-card')), true, 'Stopping content must restore its visible card');
    assert.equal(await page.locator('.channels-panel').isVisible(), false, 'Movies use groups plus cards without a duplicate channel list');
    assert.equal(await page.locator('.groups-panel').isVisible(), true);
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('.primary-button[data-section="series"]').click();
    await page.locator('#groups [data-group="مسلسلات VOD"]').click();
    assert.equal(await page.locator('#movie-grid .movie-card').count(), 14);
    await page.screenshot({ path: path.join(root, 'artifacts/ui-movies-1080.png') });
    await page.locator('#movie-grid .movie-card').first().click();
    await page.locator('#details-play').click();
    await setMediaTracks([{ language: 'ar', enabled: true }, { language: 'en', enabled: false }], [{ kind: 'captions', language: 'ar', mode: 'disabled' }]);
    const seriesTrackStarts = await page.evaluate(() => window.__mediaStarts);
    await page.keyboard.press('Enter');
    await page.locator('#subtitle-language').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('video').textTracks[0].mode), 'showing', 'Series captions use the shared picker');
    await page.locator('#audio-language').focus();
    await page.keyboard.press('Enter');
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 19, bubbles: true })));
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true, 'Remote Pause remains available inside the picker');
    assert.equal(await page.locator('#track-picker').isVisible(), true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#track-picker').isVisible(), false, 'Leaving the app closes an open track picker');
    assert.equal(await page.locator('#track-list button').count(), 0);
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(await page.evaluate(() => window.__mediaStarts), seriesTrackStarts, 'Returning from a track picker must not restart series playback');
    await page.locator('#groups .group-button').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('.primary-button[data-section="tv"]').click();
    await page.locator('#groups [data-group=""]').click();
    await page.screenshot({ path: path.join(root, 'artifacts/ui-playlist-1080.png') });
    const playlistStarts = await page.evaluate(() => window.__mediaStarts);
    await page.locator('#channels .channel-button').first().click();
    assert.equal(await page.evaluate(() => window.__mediaStarts), playlistStarts + 1);

    await pendingThen('nav-settings');
    await page.locator('#settings-speed').click();
    assert.equal(await page.locator('video').count(), 1, 'Opening speed controls alone must preserve playback');
    await page.locator('#speed-wired').click();
    assert.equal(await page.locator('#speed-wired').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#speed-wifi').getAttribute('aria-pressed'), 'false');
    await page.locator('#speed-start').click();
    assert.equal(await page.locator('video').count(), 0, 'Starting a download test must release playback');
    assert.equal(await page.evaluate(() => window.__speedRequests.length), 1);
    assert.equal(await page.locator('#speed-start').isDisabled(), true, 'Only one speed request may run');
    const request = await page.evaluate(() => {
      const item = window.__speedRequests[0];
      const url = new URL(item.url);
      return { origin: url.origin, path: url.pathname, bytes: url.searchParams.get('bytes'), cache: item.options.cache, credentials: item.options.credentials, referrer: item.options.referrerPolicy, redirect: item.options.redirect, signal: item.options.signal instanceof AbortSignal };
    });
    assert.deepEqual(request, { origin: 'https://speed.cloudflare.com', path: '/__down', bytes: '64000000', cache: 'no-store', credentials: 'omit', referrer: 'no-referrer', redirect: 'error', signal: true });
    const speedMediaStarts = await page.evaluate(() => window.__mediaStarts);
    await page.evaluate(() => {
      for (const keyCode of [33, 415, 10252]) document.dispatchEvent(new KeyboardEvent('keydown', { keyCode, bubbles: true }));
    });
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), speedMediaStarts, 'Channel/media remote keys cannot start playback behind the speed dialog');
    await page.locator('#speed-cancel').click();
    assert.equal(await page.evaluate(() => window.__speedRequests[0].aborted), true);
    assert.equal(await page.locator('#speed-results > li').count(), 0, 'Cancelled downloads must not enter history');

    async function finishDownload() {
      await page.locator('#speed-start').click();
      await page.evaluate(() => window.__finishSpeed());
      await page.waitForFunction(() => !document.getElementById('speed-start').disabled);
    }
    await finishDownload();
    assert.equal(await page.locator('#speed-results > li').count(), 1);
    assert.match(await page.locator('#speed-results').innerText(), /كيبل|سلك/);
    assert.match(await page.locator('#speed-results').innerText(), /Mbps/);
    await page.locator('#speed-wifi').click();
    await finishDownload();
    assert.equal(await page.locator('#speed-results > li').count(), 2);
    assert.match(await page.locator('#speed-results').innerText(), /واي/);
    await finishDownload();
    assert.equal(await page.locator('#speed-results > li').count(), 2, 'Keep only the last two results');
    assert.doesNotMatch(await page.locator('#speed-results').innerText(), /كيبل|سلك/);
    const history = await page.locator('#speed-results').innerText();
    await page.locator('#speed-start').click();
    await page.evaluate(() => { window.__finishSpeed(); document.getElementById('speed-cancel').click(); });
    await page.waitForFunction(() => !document.getElementById('speed-start').disabled);
    assert.equal(await page.locator('#speed-results').innerText(), history, 'Queued completion after cancellation must not add a stale result');
    await page.locator('#speed-start').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__speedRequests.at(-1).aborted), true, 'Back must abort a pending download');
    assert.equal(await page.locator('#speed-panel').isVisible(), false);
    if (!await page.locator('#settings-home').isVisible()) await page.locator('#nav-settings').click();
      await page.locator('#settings-speed').click();
    assert.equal(await page.locator('#speed-results').innerText(), history);
    assert.equal(await page.locator('#speed-start').isDisabled(), true, 'Reopening requires the current connection to be selected again');
    await page.locator('#speed-wifi').click();
    await page.locator('#speed-start').click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => window.__speedRequests.at(-1).aborted), true, 'Backgrounding must abort a pending download');
    assert.equal(await page.locator('#speed-results').innerText(), history, 'Aborted requests must not replace previous results');
    const localState = await page.evaluate(() => JSON.stringify({ local: Object.values(localStorage), session: Object.values(sessionStorage) }));
    assert.doesNotMatch(localState, /https?:|password|token|provider\.example/, 'View storage must never contain source URLs or credentials');
    assert.deepEqual(errors, [], 'Browser UI must not raise errors');
    assert.equal(externalRequests, 0, 'UI tests must never request media or external assets');
    console.log('UI checks passed: remote selection, same-channel guard, explicit retry, cancellation, fullscreen, dialog focus, background release, mocked speed downloads, and clean screenshots. No real network speed, TV playback, or Dolby was tested.');
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
