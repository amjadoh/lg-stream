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
      window.__navigationMediaStarts = 0;
      HTMLMediaElement.prototype.play = function () { window.__navigationMediaStarts++; return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () {};
      HTMLMediaElement.prototype.load = function () {};
      window.fetch = async () => {
        const lines = ['#EXTM3U'];
        for (const [kind, group, count] of [['live', 'بث الاختبار', 95], ['movie', 'أفلام الاختبار', 45], ['series', 'حلقات الاختبار', 45]]) {
          for (let index = 0; index < count; index++) {
            lines.push(`#EXTINF:-1 group-title="${group}",${group} ${index + 1}`);
            lines.push(`https://media.example.test/${kind}/${index + 1}.m3u8`);
          }
        }
        return new Response(lines.join('\n'), { status: 200 });
      };
    });
    await page.goto('http://127.0.0.1:4173');
    await page.locator('#launch-splash').waitFor({ state: 'detached', timeout: 2500 });
    await page.locator('#setup-button').click();
    await page.locator('#playlist-url').fill('https://catalog.example.test/navigation.m3u');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40 && document.getElementById('setup-panel').hidden);

    async function focusedIndex(expected, kind = 'channel-button') {
      const focused = await page.evaluate(() => ({ index: document.activeElement.dataset.index, id: document.activeElement.id, classes: document.activeElement.className }));
      assert.equal(focused.index, String(expected), `Remote selection must reach item ${expected} without leaving its list; focused ${focused.id || focused.classes}`);
      assert.ok(focused.classes.split(' ').includes(kind), `Focus must stay on ${kind}`);
    }
    async function wheelAtBoundary(selector, down) {
      await page.locator(selector).evaluate((element, down) => {
        element.scrollTop = down ? element.scrollHeight : 0;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: down ? 120 : -120, bubbles: true, cancelable: true }));
      }, down);
    }
    async function chooseSection(section, group) {
      await page.locator('#groups .group-button.active').focus();
      await page.keyboard.press('ArrowLeft');
      await page.locator(`.primary-button[data-section="${section}"]`).click();
      await page.locator(`#groups [data-group="${group}"]`).click();
    }

    await page.locator('#groups [data-group="بث الاختبار"]').click();
    await focusedIndex(0);
    await page.keyboard.press('ArrowUp');
    await focusedIndex(0);
    for (let index = 1; index < 95; index++) {
      await page.keyboard.press('ArrowDown');
      await focusedIndex(index);
      assert.ok(await page.locator('#channels .channel-button').count() <= 40, 'Channel navigation keeps its DOM window bounded');
    }
    await page.keyboard.press('ArrowDown');
    await focusedIndex(94);
    for (let index = 93; index >= 0; index--) {
      await page.keyboard.press('ArrowUp');
      await focusedIndex(index);
    }
    await page.keyboard.press('ArrowUp');
    await focusedIndex(0);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'favorite-button');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.favoriteIndex), '1');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.group), 'بث الاختبار');
    await page.keyboard.press('ArrowRight');
    await focusedIndex(1);

    // Moving through the adjacent star column updates the same selected channel;
    // removing its last favorite must leave focus on a visible group control.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#channels [data-favorite-index="1"]').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.locator('.primary-button[data-section="favorites"]').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 1);
    await page.locator('#channels .favorite-button').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#channels .channel-button').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('group-button') && document.activeElement.classList.contains('active')), true, 'Removing the last favorite restores visible group focus');
    await chooseSection('tv', 'بث الاختبار');
    await focusedIndex(0);

    // Wheel users must reach every window too; a visible scrollbar alone only
    // reaches the end of the currently mounted forty channels.
    const wheelChannels = new Set();
    for (let step = 0; step < 10; step++) {
      for (const index of await page.locator('#channels .channel-button').evaluateAll(nodes => nodes.map(node => Number(node.dataset.index)))) wheelChannels.add(index);
      if (await page.locator('#channels .channel-button').last().getAttribute('data-index') === '94') break;
      await wheelAtBoundary('#channels', true);
    }
    assert.equal(wheelChannels.size, 95, 'Wheel scrolling exposes every channel beyond the first forty');
    assert.equal(await page.locator('#channels .channel-button').last().getAttribute('data-index'), '94');
    assert.ok(await page.locator('#channels .channel-button').count() <= 40);
    for (let step = 0; step < 10 && await page.locator('#channels .channel-button').first().getAttribute('data-index') !== '0'; step++) await wheelAtBoundary('#channels', false);
    assert.equal(await page.locator('#channels .channel-button').first().getAttribute('data-index'), '0', 'Wheel returns to the first channel window');

    for (const [section, group, base] of [['movies', 'أفلام الاختبار', 95], ['series', 'حلقات الاختبار', 140]]) {
      await chooseSection(section, group);
      await focusedIndex(base, 'movie-card');
      // Every first-row column has a useful upward exit and returns to the same
      // card after visiting the sort control.
      for (let column = 0; column < 4; column++) {
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'sort-button');
        await page.keyboard.press('ArrowDown');
        await focusedIndex(base + column, 'movie-card');
        if (column < 3) await page.keyboard.press('ArrowLeft');
      }
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.group), group, 'Leaving the RTL grid restores its selected group');
      await page.keyboard.press('ArrowRight');
      await focusedIndex(base + 3, 'movie-card');
      for (let column = 0; column < 3; column++) await page.keyboard.press('ArrowRight');

      // Walk all forty-five entries with arrows, including the virtual-window
      // boundaries and the single card in the final partial row.
      for (let row = 0; row < 45; row += 4) {
        await focusedIndex(base + row, 'movie-card');
        const columns = Math.min(4, 45 - row);
        for (let column = 1; column < columns; column++) {
          await page.keyboard.press('ArrowLeft');
          await focusedIndex(base + row + column, 'movie-card');
        }
        for (let column = columns - 2; column >= 0; column--) {
          await page.keyboard.press('ArrowRight');
          await focusedIndex(base + row + column, 'movie-card');
        }
        assert.ok(await page.locator('#movie-grid .movie-card').count() <= 24, 'Content navigation keeps its DOM window bounded');
        if (row + 4 < 45) await page.keyboard.press('ArrowDown');
      }
      await page.keyboard.press('ArrowDown');
      await focusedIndex(base + 44, 'movie-card');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.group), group, 'The incomplete last RTL row also returns to the active group');
      await page.keyboard.press('ArrowRight');
      await focusedIndex(base + 44, 'movie-card');
      for (let row = 40; row >= 0; row -= 4) {
        await page.keyboard.press('ArrowUp');
        await focusedIndex(base + row, 'movie-card');
      }

      const wheelContent = new Set();
      for (let step = 0; step < 6; step++) {
        for (const index of await page.locator('#movie-grid .movie-card').evaluateAll(nodes => nodes.map(node => Number(node.dataset.index)))) wheelContent.add(index);
        if (await page.locator('#movie-grid .movie-card').last().getAttribute('data-index') === String(base + 44)) break;
        await wheelAtBoundary('#movie-browser', true);
      }
      assert.equal(wheelContent.size, 45, 'Wheel scrolling exposes every movie or episode');
      assert.ok(await page.locator('#movie-grid .movie-card').count() <= 24);
      for (let step = 0; step < 6 && await page.locator('#movie-grid .movie-card').first().getAttribute('data-index') !== String(base); step++) await wheelAtBoundary('#movie-browser', false);
      assert.equal(await page.locator('#movie-grid .movie-card').first().getAttribute('data-index'), String(base));
      await page.locator('#movie-grid .movie-card').first().click();
      assert.equal(await page.locator('#details-poster').isVisible(), false);
      const detailsWidth = await page.locator('.details-card > div').evaluate(element => element.getBoundingClientRect().width);
      assert.ok(detailsWidth > 600, 'Content without a poster uses the full details width, not the 240px poster column');
      await page.keyboard.press('Escape');
    }
    assert.equal(await page.evaluate(() => window.__navigationMediaStarts), 0, 'Browsing and navigating never starts playback');
    assert.deepEqual(errors, [], 'Navigation must not raise browser errors');
    assert.equal(unexpectedRequests, 0, 'Navigation checks do not download external media or assets');
    console.log('Navigation regressions passed: 95 channels, 45 movies, 45 episodes; both virtual-window directions, wheel access, sort navigation, active-group return, and poster-free details. No TV playback tested.');
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
