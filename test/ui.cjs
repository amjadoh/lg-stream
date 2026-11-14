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
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173' && route.request().resourceType() !== 'media') return route.continue();
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
      const proto = HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'src', { configurable: true, get() { return state(this).source; }, set(value) { state(this).source = value; } });
      Object.defineProperty(proto, 'paused', { configurable: true, get() { return state(this).paused; } });
      Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return state(this).time; } });
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
      window.__speedRequests = [];
      window.fetch = (url, options) => {
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
    });
    await page.goto('http://127.0.0.1:4173');
    await mkdir(path.join(root, 'artifacts'), { recursive: true });
    async function insideViewport(selector) {
      const box = await page.locator(selector).boundingBox();
      const viewport = page.viewportSize();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} must remain inside the viewport`);
    }
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      for (const selector of ['#start-button', '#setup-button', '#diagnostics-button', '.viewing-panel', '.transport']) await insideViewport(selector);
      await page.screenshot({ path: path.join(root, `artifacts/ui-idle-${height}.png`) });
      await page.locator('#speed-button').click();
      for (const selector of ['#speed-wired', '#speed-wifi', '#speed-start', '#close-speed']) await insideViewport(selector);
      assert.equal(await page.locator('#speed-start').isDisabled(), true, 'Choose a connection label before starting');
      assert.equal(await page.evaluate(() => window.__speedRequests.length), 0, 'Opening speed-test controls must not download anything');
      await page.screenshot({ path: path.join(root, `artifacts/ui-speed-${height}.png`) });
      await page.locator('#close-speed').click();
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.locator('#start-button').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'source-form', 'Opening setup must leave inputs unfocused so webOS can open its keyboard on selection');
    await page.locator('#source-1').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'source-1');
    await page.locator('#clear-sources').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'source-1');
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
    await page.locator('#channels button').nth(1).focus();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '1', 'The selected channel must receive Enter');
    await page.keyboard.press('Enter');
    assert.deepEqual(errors, [], 'Browser errors before the first playback request');
    assert.equal(await page.evaluate(() => window.__mediaStarts), 1);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__mediaStarts), 1, 'Selecting the current channel must not restart it');
    await page.locator('#retry-button').click();
    assert.equal(await page.evaluate(() => window.__mediaStarts), 2, 'Explicit retry must restart media');
    assert.equal(await page.locator('video').count(), 1);

    await page.evaluate(() => { window.__originalVideo = document.querySelector('video'); });
    await page.locator('#fullscreen-button').click();
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
    await pendingThen('diagnostics-button');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close-diagnostics');
    await page.keyboard.press('Escape');
    await pendingThen('setup-button');
    assert.equal(await page.evaluate(() => document.getElementById('setup-panel').contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#source-1').inputValue(), '');
    await pendingThen('pause');
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    await pendingThen('stop-button');
    assert.equal(await page.locator('video').count(), 0);

    await page.locator('#channels button').first().click();
    const beforeHide = await page.evaluate(() => window.__mediaStarts);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('video').count(), 0, 'Leaving the app must release media');
    assert.equal(await page.evaluate(() => window.__mediaStarts), beforeHide, 'Returning must not automatically restart media');
    await page.locator('#channels button').first().click();
    await page.locator('#fullscreen-button').click();
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('error')));
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(await page.evaluate(() => document.body.classList.contains('watch-mode')), false, 'Failure must reveal retry controls');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'retry-button');

    // The single-source case must not reconnect when channel keys wrap around.
    await page.locator('#setup-button').click();
    await page.locator('#source-2').fill('');
    await page.locator('#source-3').fill('');
    await page.locator('#source-form button[type=submit]').click();
    await page.locator('#channels button').first().click();
    const singleStarts = await page.evaluate(() => window.__mediaStarts);
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__mediaStarts), singleStarts);

    await pendingThen('speed-button');
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
    await page.locator('#speed-button').click();
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
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.deepEqual(errors, [], 'Browser UI must not raise errors');
    assert.equal(externalRequests, 0, 'UI tests must never request media or external assets');
    console.log('UI checks passed: remote selection, same-channel guard, explicit retry, cancellation, fullscreen, dialog focus, background release, mocked speed downloads, and clean screenshots. No real network speed, TV playback, or Dolby was tested.');
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
