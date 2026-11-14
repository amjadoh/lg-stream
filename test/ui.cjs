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
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.locator('#start-button').click();
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
    await page.keyboard.press('Enter');
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
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.deepEqual(errors, [], 'Browser UI must not raise errors');
    assert.equal(externalRequests, 0, 'UI tests must never request media or external assets');
    console.log('UI checks passed: remote selection, same-channel guard, explicit retry, cancellation, fullscreen, dialog focus, background release, and clean screenshots. No TV playback or Dolby was tested.');
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
