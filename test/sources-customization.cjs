'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

// Synthetic catalogue only, real IndexedDB: the sources card, new-item
// detection after a refresh, rename/stop/activate/delete, Xtream login, and
// (below) channel and group customization. No media is decoded.
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
      const own = video => { if (!state.has(video)) state.set(video, { source: '', paused: true, time: 0 }); return state.get(video); };
      const proto = HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'src', { configurable: true, get() { return own(this).source; }, set(value) { own(this).source = value; } });
      Object.defineProperty(proto, 'paused', { configurable: true, get() { return own(this).paused; } });
      Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return own(this).time; } });
      proto.load = function () {};
      proto.play = function () {
        own(this).paused = false; window.__mediaStarts = (window.__mediaStarts || 0) + 1;
        queueMicrotask(() => { if (!this.isConnected || own(this).paused) return; this.dispatchEvent(new Event('playing')); own(this).time += 0.04; this.dispatchEvent(new Event('timeupdate')); });
        return Promise.resolve();
      };
      proto.pause = function () { own(this).paused = true; this.dispatchEvent(new Event('pause')); };
      window.__fetches = [];
      window.fetch = async url => {
        window.__fetches.push(String(url));
        const lines = ['#EXTM3U'];
        const item = (section, group, id, title) => { lines.push('#EXTINF:-1 group-title="' + group + '",' + title); lines.push('https://media.invalid/' + section + '/user/pass/' + id + '.ts'); };
        const extra = localStorage.getItem('test-extra') === '1';
        if (extra) item('live', 'G1', 900, 'New One');
        for (let i = 0; i < 10; i++) item('live', 'G1', i, 'One ' + i);
        for (let i = 0; i < 10; i++) item('live', 'G2', 10 + i, 'Two ' + i);
        if (extra) { item('live', 'Fresh', 901, 'Fresh A'); item('live', 'Fresh', 902, 'Fresh B'); }
        item('movie', 'Films', 500, 'Film A'); item('movie', 'Films', 501, 'Film B');
        const bytes = new TextEncoder().encode(lines.join('\n'));
        return { ok: true, headers: { get: name => name.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
      };
    });
    const ready = async () => { await page.goto('http://127.0.0.1:4173'); await page.locator('#launch-splash').waitFor({ state: 'detached' }); };
    const active = () => page.evaluate(() => document.activeElement.id || document.activeElement.dataset.addMode || document.activeElement.className);
    await ready();

    // First source: added through the add panel; no input is focused on open.
    await page.locator('#setup-button').click();
    assert.equal(await active(), 'link', 'With no source, setup focuses the add choice, not a text field');
    await page.locator('#playlist-url').fill('https://provider.invalid/get.php?username=user&password=pass&type=m3u_plus');
    await page.locator('#load-playlist').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.match(await page.locator('#status').innerText(), /تم حفظ 22 عنصرًا/);
    assert.doesNotMatch(await page.locator('#status').innerText(), /الجديد/, 'No comparison on the first load');

    // The card: refresh focused, name, badge, counts, no URL.
    await page.locator('#setup-button').click();
    assert.equal(await active(), 'refresh-saved', 'Sources opens on the card with Refresh focused');
    assert.equal(await page.locator('#source-name').innerText(), 'المصدر الرئيسي');
    assert.equal(await page.locator('#source-badge').innerText(), 'نشط');
    assert.match(await page.locator('#source-counts').innerText(), /بث 20 · أفلام 2 · مسلسلات 0/);
    assert.match(await page.locator('#saved-catalog-status').innerText(), /آخر تحديث: \d{4}-\d\d-\d\d \d\d:\d\d/);
    assert.equal(await page.locator('#add-source-panel').isVisible(), false, 'The add panel stays closed when a source exists');
    assert.equal((await page.locator('#setup-panel').innerText()).includes('provider.invalid'), false, 'The source link is never shown');

    // Refresh with three new live items: summary, new group first, badge.
    await page.evaluate(() => localStorage.setItem('test-extra', '1'));
    await page.locator('#refresh-saved').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.match(await page.locator('#status').innerText(), /الجديد: 3 قناة · 0 فيلم · 0 مسلسل/);
    const groupOrder = () => page.locator('#groups .group-button').evaluateAll(nodes => nodes.map(node => node.dataset.group === '\u0002new' ? 'NEW:' + node.textContent : node.dataset.group));
    assert.deepEqual(await groupOrder(), ['', 'NEW:جديد (3)', 'Fresh', 'G1', 'G2'], 'The new-items entry and the wholly new group lead the list');
    await page.locator('#groups .group-button.new-group').click();
    assert.equal(await page.locator('#channels .channel-button').count(), 3);
    await page.locator('#groups [data-group="G1"]').click();
    assert.equal(await page.locator('#channels .channel-button').first().locator('.new-badge').count(), 1, 'A new channel leads its group with a badge');
    assert.equal(await page.locator('#channels .channel-button .channel-label').first().innerText(), 'New One');

    // Rename: keyboard only after choosing the field; persists across reload.
    await page.locator('#setup-button').click();
    await page.locator('#rename-source').click();
    assert.equal(await active(), 'save-source-name', 'Rename focuses Save, not the text field');
    await page.locator('#source-name-input').fill('اشتراكي');
    await page.locator('#save-source-name').click();
    assert.equal(await page.locator('#source-name').innerText(), 'اشتراكي');
    await page.waitForFunction(() => document.getElementById('playlist-status').textContent.includes('حُفظ اسم المصدر'));
    await page.keyboard.press('Escape');
    await ready();
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length > 0);
    assert.deepEqual((await groupOrder()).slice(0, 3), ['', 'NEW:جديد (3)', 'Fresh'], 'New marks survive a restart until the next refresh');
    await page.locator('#setup-button').click();
    assert.equal(await page.locator('#source-name').innerText(), 'اشتراكي');

    // Stop asks first; Back cancels; confirming hides the channels.
    await page.locator('#toggle-source').click();
    assert.equal(await page.locator('#source-confirm').isVisible(), true);
    assert.equal(await active(), 'source-confirm-no', 'The safe choice is focused');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#source-confirm').isVisible(), false);
    assert.equal(await active(), 'toggle-source');
    await page.locator('#toggle-source').click(); await page.locator('#source-confirm-yes').click();
    assert.equal(await page.locator('#source-badge').innerText(), 'متوقف');
    assert.equal(await page.locator('#channels .channel-button').count(), 0);
    await page.waitForFunction(() => document.getElementById('playlist-status').textContent.includes('أُوقف المصدر'));

    await ready();
    assert.equal(await page.locator('#channels .channel-button').count(), 0, 'A stopped source stays stopped after restart');
    assert.equal(await page.evaluate(() => window.__fetches.length), 0, 'and nothing is downloaded');
    await page.locator('#setup-button').click();
    assert.equal(await active(), 'toggle-source', 'A stopped source opens on Activate');
    await page.locator('#toggle-source').click();
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length > 0);
    assert.equal(await page.evaluate(() => window.__fetches.length), 0, 'Activation reuses the saved catalogue');
    assert.equal(await page.locator('#source-badge').innerText(), 'نشط');

    // Back inside setup closes the add panel before the screen.
    await page.locator('#add-source').click();
    assert.equal(await page.locator('#add-source-panel').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#add-source-panel').isVisible(), false);
    assert.equal(await page.locator('#setup-panel').isVisible(), true);
    assert.equal(await active(), 'add-source');

    // Delete asks first, then removes the source, catalogue and preferences.
    await page.locator('#clear-sources').click(); await page.locator('#source-confirm-yes').click();
    await page.waitForFunction(() => document.getElementById('source-card').hidden);
    assert.equal(await page.locator('#add-source-panel').isVisible(), true);
    await ready();
    assert.equal(await page.locator('#channels .channel-button').count(), 0);

    // Xtream login builds the get.php link; the password never appears on screen.
    await page.evaluate(() => localStorage.removeItem('test-extra'));
    await page.locator('#setup-button').click();
    await page.locator('[data-add-mode="xtream"]').click();
    await page.locator('#xtream-server').fill('server.invalid:8080');
    await page.locator('#xtream-username').fill('viewer');
    await page.locator('#xtream-password').fill('s3cret&x');
    await page.locator('#load-xtream').click();
    await page.waitForFunction(() => document.getElementById('setup-panel').hidden);
    assert.deepEqual(await page.evaluate(() => window.__fetches), ['http://server.invalid:8080/get.php?username=viewer&password=s3cret%26x&type=m3u_plus&output=ts']);
    assert.equal((await page.locator('body').innerText()).includes('s3cret'), false);
    assert.equal(await page.locator('#xtream-password').inputValue(), '', 'Typed credentials are cleared after use');

    assert.deepEqual(errors, []);
    console.log('Sources: card focus, counts, new items first, rename, stop/activate, delete, Xtream login and persistence passed. Synthetic catalogue only.');
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
