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

    // ---- Customization ----
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#setup-panel').isVisible(), false);
    const channelNames = () => page.locator('#channels .channel-button .channel-label').allInnerTexts();
    const focusChannelNamed = name => page.locator('#channels .channel-button', { hasText: name }).first().focus();
    const holdOk = async ms => { await page.keyboard.down('Enter'); await page.waitForTimeout(ms); await page.keyboard.up('Enter'); };
    await page.locator('#groups [data-group="G2"]').click();
    // A short OK still plays; a held OK released while the ring shows cancels.
    const startsBefore = await page.evaluate(() => window.__mediaStarts || 0);
    await focusChannelNamed('Two 0'); await page.keyboard.press('Enter');
    await page.waitForFunction(count => (window.__mediaStarts || 0) === count + 1, startsBefore);
    await page.locator('#stop-button').click();
    await focusChannelNamed('Two 0');
    await page.keyboard.down('Enter'); await page.waitForTimeout(800);
    assert.equal(await page.locator('#hold-ring').isVisible(), true, 'The ring appears after half a second');
    await page.keyboard.up('Enter');
    assert.equal(await page.locator('#hold-ring').isVisible(), false);
    assert.equal(await page.locator('#item-menu').isVisible(), false, 'Releasing early cancels');
    assert.equal(await page.evaluate(() => window.__mediaStarts || 0), startsBefore + 1, 'A cancelled hold does not start playback');
    // Magic Remote pointer: OK arrives as mouse events.
    { const box = await page.locator('#channels .channel-button', { hasText: 'Two 3' }).first().boundingBox();
      const startsPointer = await page.evaluate(() => window.__mediaStarts || 0);
      await page.mouse.move(box.x + 40, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(4200);
      assert.equal(await page.locator('#item-menu').isVisible(), true, 'A held pointer press opens the menu'); await page.mouse.up();
      assert.equal(await page.evaluate(() => window.__mediaStarts || 0), startsPointer, 'A held pointer press does not play');
      await page.keyboard.press('Escape');
      await page.mouse.down(); await page.waitForTimeout(1000); await page.mouse.up();
      assert.equal(await page.evaluate(() => window.__mediaStarts || 0), startsPointer, 'Releasing the pointer while the ring shows cancels');
      await page.mouse.click(box.x + 40, box.y + box.height / 2);
      await page.waitForFunction(count => (window.__mediaStarts || 0) === count + 1, startsPointer);
      await page.locator('#stop-button').click(); }
    // Four seconds opens the menu; move a channel down two places and save.
    await focusChannelNamed('Two 0'); await holdOk(4200);
    assert.equal(await page.locator('#item-menu').isVisible(), true);
    assert.equal(await active(), 'menu-select');
    await page.locator('#menu-move').click();
    assert.equal(await page.locator('#move-bar').isVisible(), true);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    assert.deepEqual((await channelNames()).slice(0, 3), ['Two 1', 'Two 2', 'Two 0']);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#move-bar').isVisible(), false);
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    // Back during a move restores the previous order.
    await focusChannelNamed('Two 2'); await holdOk(4200); await page.locator('#menu-move').click();
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Escape');
    assert.deepEqual((await channelNames()).slice(0, 3), ['Two 1', 'Two 2', 'Two 0'], 'Back cancels a move');
    assert.equal(await page.locator('#edit-confirm').isVisible(), false, 'A cancelled move has nothing to save');
    // Rename keeps the original for restoring.
    await focusChannelNamed('Two 1'); await holdOk(4200); await page.locator('#menu-rename').click();
    assert.equal(await active(), 'save-channel-name', 'Rename focuses Save, not the text field');
    await page.locator('#channel-name-input').fill('Zed 7');
    await page.locator('#save-channel-name').click();
    assert.equal((await channelNames())[0], 'Zed 7');
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    // Hide one channel; it leaves the list and the numbering.
    await focusChannelNamed('Two 5'); await holdOk(4200); await page.locator('#menu-hide').click();
    assert.equal((await channelNames()).includes('Two 5'), false);
    assert.equal(await page.locator('#channels .channel-button').count(), 9);
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    // Discarding a menu edit puts everything back.
    await focusChannelNamed('Two 6'); await holdOk(4200); await page.locator('#menu-hide').click();
    await page.locator('#edit-discard').click();
    assert.equal((await channelNames()).includes('Two 6'), true, 'Discard restores the hidden channel');
    // Multi-select two channels and move them as a block to the top.
    await focusChannelNamed('Two 8'); await holdOk(4200); await page.locator('#menu-select').click();
    assert.equal(await page.locator('#select-bar').isVisible(), true);
    const startsInSelect = await page.evaluate(() => window.__mediaStarts || 0);
    await focusChannelNamed('Two 9'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__mediaStarts || 0), startsInSelect, 'OK selects instead of playing');
    assert.match(await page.locator('#select-count').innerText(), /2/);
    await focusChannelNamed('Zed 7'); await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.getElementById('select-bar').contains(document.activeElement)), true, 'Up from the top reaches the bar');
    await page.locator('#select-move').click();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    assert.deepEqual((await channelNames()).slice(0, 4), ['Two 8', 'Two 9', 'Zed 7', 'Two 2']);
    // Move group G2 above G1; All follows the same master order.
    await page.locator('#groups [data-group="G2"]').focus(); await holdOk(4200); await page.locator('#menu-move').click();
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    const order = await page.locator('#groups .group-button').evaluateAll(nodes => nodes.map(node => node.dataset.group));
    assert.ok(order.indexOf('G2') < order.indexOf('G1'), 'Group order saved');
    await page.locator('#groups [data-group=""]').click();
    { const all = await channelNames(); assert.ok(all.indexOf('Two 8') >= 0 && all.indexOf('Two 8') < all.indexOf('One 0') && all.indexOf('Two 8') < all.indexOf('Two 9'), 'All follows the saved group and channel order'); }
    // Everything survives a restart.
    await page.waitForTimeout(300);
    await ready();
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length > 0);
    await page.locator('#groups [data-group="G2"]').click();
    assert.deepEqual((await channelNames()).slice(0, 3), ['Two 8', 'Two 9', 'Zed 7']);
    assert.equal((await channelNames()).includes('Two 5'), false);
    // Settings organizer: show the hidden channel again, then reset everything.
    await page.locator('#nav-settings').click(); await page.locator('#manage-groups-button').click();
    assert.equal(await page.locator('#manager-home').isVisible(), true); assert.equal(await active(), 'organize-channels', 'The manager opens on its option cards');
    await page.locator('#manage-visibility').click();
    await page.locator('[data-manage-section="hidden"]').click();
    assert.equal(await page.locator('#managed-groups .group-switch').count(), 1);
    await page.locator('#managed-groups .group-switch').first().click();
    assert.equal(await page.locator('#managed-groups .group-switch').first().getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape'); assert.equal(await active(), 'manage-visibility', 'Back returns to the option cards');
    // From Settings the owner keeps editing until Back, then chooses.
    await page.locator('#organize-channels').click();
    assert.equal(await page.locator('#select-bar').isVisible(), true);
    await page.locator('#groups [data-group="G2"]').click();
    await focusChannelNamed('Two 3'); await page.keyboard.press('Enter');
    await page.locator('#select-hide').click();
    assert.equal((await channelNames()).includes('Two 3'), false);
    assert.equal(await page.locator('#edit-confirm').isVisible(), false, 'Settings edits do not stop after one change');
    assert.equal(await page.locator('#select-bar').isVisible(), true, 'Still selecting after an edit');
    await focusChannelNamed('Two 4'); await page.keyboard.press('Enter'); await page.locator('#select-hide').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#edit-confirm').isVisible(), true); assert.equal(await page.locator('#edit-continue').isVisible(), true);
    await page.locator('#edit-continue').click(); assert.equal(await page.locator('#select-bar').isVisible(), true, 'Continue keeps editing');
    await page.keyboard.press('Escape'); await page.locator('#edit-discard').click();
    assert.equal(await page.locator('#select-bar').isVisible(), false);
    assert.equal((await channelNames()).includes('Two 3') && (await channelNames()).includes('Two 4'), true, 'Discard brings both back');
    await page.locator('#nav-settings').click(); await page.locator('#manage-groups-button').click();
    await page.locator('#reset-customization').click(); await page.locator('#reset-confirm-yes').click();
    await page.locator('#close-group-manager').click(); await page.keyboard.press('Escape');
    await page.locator('#groups [data-group="G2"]').click();
    assert.deepEqual((await channelNames()).slice(0, 3), ['Two 0', 'Two 1', 'Two 2'], 'Reset restores provider order and names');
    assert.equal(await page.locator('#channels .channel-button').count(), 10);
    await page.waitForTimeout(300);
    await page.locator('#setup-button').click();
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
    console.log('Sources and customization: card focus, counts, new items first, rename, stop/activate, delete, Xtream login, hold ring, menu, move, hide, channel rename, multi-select, group order, organizer and reset passed. Synthetic catalogue only.');
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
