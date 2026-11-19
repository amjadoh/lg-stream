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
      window.fetch = async (url, options) => {
        window.__fetches.push(String(url));
        if (String(url).startsWith('https://api.themoviedb.org/')) return { ok: true, json: async () => ({ id: Number(new URL(url).pathname.split('/').pop()), overview: 'وصف عربي من TMDB' }) };
        if (String(url).startsWith('https://www.omdbapi.com/')) return { ok: true, json: async () => window.__omdbReply || { Response: 'True', imdbRating: '8.7', Plot: 'IMDb plot', imdbID: 'tt0133093' } };
        if (String(url).includes('/player_api.php')) {
          window.__infoSignal = options && options.signal;
          if (window.__holdInfo) return new Promise(() => {});
          return { ok: true, json: async () => ({ info: { plot: 'Provider plot for the film', rating: '7.4', genre: 'Drama', duration: '01:50:00', year: '2019', tmdb_id: '603' } }) };
        }
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
    const blue = () => page.evaluate(() => { for (const type of ['keydown', 'keyup']) document.activeElement.dispatchEvent(new KeyboardEvent(type, { key: 'ColorF3Blue', keyCode: 406, which: 406, bubbles: true, cancelable: true })); });
    await page.locator('#groups [data-group="G2"]').click();
    // OK plays at once (webOS sends OK as an instant press); blue opens the options.
    const startsBefore = await page.evaluate(() => window.__mediaStarts || 0);
    await focusChannelNamed('Two 0');
    assert.equal(await page.locator('#blue-hint').isVisible(), true, 'The blue-key legend shows on a channel');
    assert.equal(await page.locator('#footer-note').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-blue-tip-v1')), '1', 'The one-time blue-key tip was shown');
    await page.keyboard.down('Enter');
    await page.waitForFunction(count => (window.__mediaStarts || 0) === count + 1, startsBefore);
    await page.keyboard.up('Enter');
    assert.equal(await page.locator('#item-menu').isVisible(), false);
    await page.locator('#stop-button').click(); await page.locator('#setup-button').focus();
    assert.equal(await page.locator('#blue-hint').isVisible(), false, 'The legend hides away from the lists');
    await blue(); assert.equal(await page.locator('#item-menu').isVisible(), false, 'Blue does nothing outside the lists');
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
    // Blue opens the menu; move a channel down two places and save.
    await focusChannelNamed('Two 0'); await blue();
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
    await focusChannelNamed('Two 2'); await blue(); await page.locator('#menu-move').click();
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Escape');
    assert.deepEqual((await channelNames()).slice(0, 3), ['Two 1', 'Two 2', 'Two 0'], 'Back cancels a move');
    assert.equal(await page.locator('#edit-confirm').isVisible(), false, 'A cancelled move has nothing to save');
    // Rename keeps the original for restoring.
    await focusChannelNamed('Two 1'); await blue(); await page.locator('#menu-rename').click();
    assert.equal(await active(), 'save-channel-name', 'Rename focuses Save, not the text field');
    await page.locator('#channel-name-input').fill('Zed 7');
    await page.locator('#save-channel-name').click();
    assert.equal((await channelNames())[0], 'Zed 7');
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    // Hide one channel; it leaves the list and the numbering.
    await focusChannelNamed('Two 5'); await blue(); await page.locator('#menu-hide').click();
    assert.equal((await channelNames()).includes('Two 5'), false);
    assert.equal(await page.locator('#channels .channel-button').count(), 9);
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    // Discarding a menu edit puts everything back.
    await focusChannelNamed('Two 6'); await blue(); await page.locator('#menu-hide').click();
    await page.locator('#edit-discard').click();
    assert.equal((await channelNames()).includes('Two 6'), true, 'Discard restores the hidden channel');
    // Multi-select two channels and move them as a block to the top.
    await focusChannelNamed('Two 8'); await blue(); await page.locator('#menu-select').click();
    assert.equal(await page.locator('#select-bar').isVisible(), true);
    const startsInSelect = await page.evaluate(() => window.__mediaStarts || 0);
    await focusChannelNamed('Two 9'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__mediaStarts || 0), startsInSelect, 'OK selects instead of playing');
    assert.match(await page.locator('#select-count').innerText(), /2/);
    assert.match(await page.locator('#blue-hint-text').innerText(), /نقل أو إخفاء المحدد/, 'The legend explains blue in select mode');
    await blue(); assert.equal(await active(), 'select-move', 'Blue jumps from deep in the list to the actions');
    await blue(); assert.equal(await page.evaluate(() => document.activeElement.textContent.includes('Two 9')), true, 'Blue again returns to the same channel');
    await blue(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.includes('Two 9')), true, 'Down also returns to the same channel');
    await focusChannelNamed('Zed 7'); await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.getElementById('select-bar').contains(document.activeElement)), true, 'Up from the top reaches the bar');
    await page.locator('#select-move').click();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#edit-confirm').isVisible(), true, 'One edit from the menu asks to save'); assert.equal(await active(), 'edit-save'); assert.equal(await page.locator('#edit-continue').isVisible(), false); await page.locator('#edit-save').click();
    assert.deepEqual((await channelNames()).slice(0, 4), ['Two 8', 'Two 9', 'Zed 7', 'Two 2']);
    // Move group G2 above G1; All follows the same master order.
    await page.locator('#groups [data-group="G2"]').focus(); await blue(); await page.locator('#menu-move').click();
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
    // Remote: each card lands in its own column.
    await page.locator('#organize-groups').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement.className.replace(' active', '') + '|' + document.activeElement.parentNode.id), 'group-button|groups', 'Arrange groups lands on the first real group');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.getElementById('select-bar').contains(document.activeElement)), true, 'First Back goes to the actions bar');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#select-bar').isVisible(), false, 'Second Back leaves select mode');
    await page.locator('#nav-settings').click(); await page.locator('#manage-groups-button').click();
    await page.locator('#organize-channels').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('channel-button')), true, 'Arrange channels lands on the channels');
    assert.equal(await page.locator('#select-bar').isVisible(), true);
    await page.locator('#groups [data-group="G2"]').click();
    await focusChannelNamed('Two 3'); await page.keyboard.press('Enter');
    await page.locator('#select-hide').click();
    assert.equal((await channelNames()).includes('Two 3'), false);
    assert.equal(await page.locator('#edit-confirm').isVisible(), false, 'Settings edits do not stop after one change');
    assert.equal(await page.locator('#select-bar').isVisible(), true, 'Still selecting after an edit');
    await focusChannelNamed('Two 4'); await page.keyboard.press('Enter'); await page.locator('#select-hide').click();
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
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

    // Movie details: one provider request when opened, cached, cancelled on close.
    await page.evaluate(() => { window.__fetches = []; });
    await page.locator('.primary-button[data-section="movies"]').click();
    await page.locator('#movie-grid .movie-card').first().click();
    await page.waitForFunction(() => /Provider plot/.test(document.getElementById('details-description').textContent));
    assert.match(await page.locator('#details-rating').innerText(), /7\.4\/10/);
    assert.match(await page.locator('#details-year').innerText(), /2019/);
    assert.match(await page.locator('#details-extra').innerText(), /Drama · 110/);
    const infoRequests = await page.evaluate(() => window.__fetches.map(url => new URL(url)).map(url => url.pathname + ' ' + url.searchParams.get('action') + ' ' + url.searchParams.get('vod_id')));
    assert.ok(infoRequests.includes('/player_api.php get_vod_info 500'));
    assert.ok(infoRequests.every(request => request.startsWith('/player_api.php get_vod_info ')), 'Only movie info is requested');
    assert.equal((await page.locator('body').innerText()).includes('s3cret'), false, 'The provider request never shows credentials');
    await page.keyboard.press('Escape');
    const before = await page.evaluate(() => window.__fetches.length);
    await page.locator('#movie-grid .movie-card').first().click();
    await page.waitForFunction(() => /Provider plot/.test(document.getElementById('details-description').textContent));
    assert.equal(await page.evaluate(() => window.__fetches.length), before, 'Reopening uses the cached details');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__holdInfo = true; });
    await page.locator('#movie-grid .movie-card').nth(1).click();
    assert.equal(await page.locator('#details-status-info').isVisible(), true, 'Loading is shown while the provider answers');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__infoSignal.aborted), true, 'Closing details cancels the provider request');
    await page.evaluate(() => { window.__holdInfo = false; });

    // Ratings on the visible cards, saved on the TV; then IMDb with the owner's key.
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#movie-grid .card-rating')).filter(badge => badge.textContent === '★ 7.4').length === 2);
    const savedRatings = () => page.evaluate(() => new Promise(resolve => { const open = indexedDB.open('lg-stream-ratings'); open.onsuccess = () => { const request = open.result.transaction('items').objectStore('items').getAll(); request.onsuccess = () => { open.result.close(); resolve(request.result); }; }; }));
    for (let wait = 0; wait < 30 && (await savedRatings()).filter(value => value[1] === '7.4').length < 2; wait++) await page.waitForTimeout(200);
    assert.equal((await savedRatings()).length, 2, 'Ratings are saved on the TV in IndexedDB');
    await page.locator('#nav-settings').click();
    await page.locator('#settings-imdb').click();
    assert.equal(await active(), 'imdb-key', 'The IMDb panel opens on the key field');
    await page.locator('#imdb-key').fill('bad key');
    await page.locator('#imdb-save').click();
    assert.match(await page.locator('#imdb-status').innerText(), /أحرف وأرقام/);
    await page.evaluate(() => { window.__omdbReply = { Response: 'False', Error: 'Invalid API key!' }; });
    await page.locator('#imdb-key').fill('abc12345');
    await page.locator('#imdb-save').click();
    await page.waitForFunction(() => /رفض OMDb المفتاح/.test(document.getElementById('imdb-status').textContent));
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-omdb-key-v1')), null, 'A rejected key is not saved');
    await page.evaluate(() => { window.__omdbReply = null; });
    await page.locator('#imdb-save').click();
    await page.waitForFunction(() => /تم الحفظ/.test(document.getElementById('imdb-status').textContent));
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-omdb-key-v1')), 'abc12345');
    assert.equal(await page.locator('#imdb-key').inputValue(), '', 'The typed key is cleared');
    assert.match(await page.locator('#imdb-key').getAttribute('placeholder'), /محفوظ/, 'The field itself shows the key is saved');
    assert.equal((await page.locator('body').innerText()).includes('abc12345'), false, 'The key is never shown');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.locator('.primary-button[data-section="movies"]').click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#movie-grid .card-rating.imdb')).filter(badge => badge.textContent === 'IMDb 8.7').length === 2);
    const omdbRequests = await page.evaluate(() => window.__fetches.filter(url => url.startsWith('https://www.omdbapi.com/')).map(url => new URL(url).searchParams.get('t')));
    assert.deepEqual(omdbRequests.slice(-2).sort(), ['Film A', 'Film B'], 'One IMDb lookup per visible movie');
    const lookups = await page.evaluate(() => window.__fetches.length);
    await page.locator('#movie-grid .movie-card').first().click();
    await page.waitForFunction(() => /IMDb 8\.7/.test(document.getElementById('details-rating').textContent));
    assert.match(await page.locator('#details-rating').innerText(), /IMDb 8\.7\/10 · .*7\.4\/10/);
    assert.equal(await page.evaluate(() => window.__fetches.length), lookups, 'Details reuse the saved ratings');
    await page.keyboard.press('Escape');
    // The owner chooses which rating shows: IMDb only hides the provider rating.
    await page.locator('#nav-settings').click(); await page.locator('#settings-imdb').click();
    await page.locator('[data-rating-source="imdb"]').click();
    assert.equal(await page.locator('[data-rating-source="imdb"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#prefetch-status').innerText(), /تقييمات IMDb المحفوظة: 2/);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#movie-grid .card-rating:not(.imdb)').count(), 0, 'No provider badge with IMDb only');
    await page.locator('#movie-grid .movie-card').first().click();
    assert.doesNotMatch(await page.locator('#details-rating').innerText(), /7\.4/, 'Details hide the provider rating too');
    await page.keyboard.press('Escape');
    await page.locator('#nav-settings').click(); await page.locator('#settings-imdb').click();
    await page.locator('[data-rating-source="off"]').click();
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#movie-grid .card-rating').count(), 0, 'No badges when ratings are off');
    await page.locator('#nav-settings').click(); await page.locator('#settings-imdb').click();
    await page.locator('[data-rating-source="both"]').click();
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-rating-source-v1')), 'both');
    await page.locator('#sort-button').click();
    assert.equal(await page.locator('#sort-menu [data-sort="rating"]').isDisabled(), false, 'Rating sort is available');
    await page.locator('#sort-menu [data-sort="rating"]').click();
    assert.match(await page.locator('#sort-button').innerText(), /التقييم/);
    await page.locator('#nav-settings').click(); await page.locator('#settings-imdb').click();
    await page.locator('#imdb-remove').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-omdb-key-v1')), null);
    await page.locator('#tmdb-key').fill('0123456789abcdef0123456789abcdef');
    await page.locator('#tmdb-save').click();
    await page.waitForFunction(() => /تم الحفظ/.test(document.getElementById('imdb-status').textContent));
    assert.equal((await page.locator('body').innerText()).includes('0123456789abcdef'), false, 'The TMDB key is never shown');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.locator('#movie-grid .movie-card').first().click();
    await page.waitForFunction(() => /وصف عربي من TMDB/.test(document.getElementById('details-description').textContent));
    assert.ok(await page.evaluate(() => window.__fetches.some(url => /api\.themoviedb\.org\/3\/movie\/603\?.*language=ar/.test(url))));
    await page.keyboard.press('Escape');
    await page.locator('#nav-settings').click(); await page.locator('#settings-imdb').click();
    await page.locator('#tmdb-remove').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-stream-tmdb-key-v1')), null);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    assert.deepEqual(errors, []);
    console.log('Sources and customization: card focus, counts, new items first, rename, stop/activate, delete, Xtream login, provider movie details, card ratings, IMDb key, rating choice and rating sort, Arabic TMDB descriptions, blue-key menu and legend, pointer hold, move, hide, channel rename, multi-select, group order, organizer and reset passed. Synthetic catalogue only.');
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
