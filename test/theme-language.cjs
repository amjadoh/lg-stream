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
        for (const [i, group] of ['رياضة', 'قنوات أفلام', 'أخبار', 'الرياضة العالمية · جودة عالية', 'beIN', 'أطفال', 'NEWS HD', 'BEIN SPORTS FHD', 'SSC HD', 'BEIN SPORTS HD', 'CUSTOM SPORTS HD', 'MBC MOVIES HD', 'CUSTOM SPORTS FHD', 'أطفال إضافية', 'MBC MOVIES FHD'].entries()) {
          lines.push(`#EXTINF:-1 group-title="${group}",${i===0?"المفضلة":i===4||i===7||i===9?'beIN SPORTS 1 FHD':"قناة "+i}`);
          lines.push(`https://media.example.test/live/${i}.m3u8`);
        }
        for (const [i, name] of ['SSC1 FHD', 'MBC2', 'قناة غير واضحة'].entries()) {
          lines.push(`#EXTINF:-1 group-title="مختلط",${name}`);
          lines.push(`https://media.example.test/live/mixed${i}.m3u8`);
        }
        for (const kind of ['movie', 'series']) { lines.push('#EXTINF:-1 group-title="فيديو" year="2024" rating="8.4" description="وصف المزود",فيديو الاختبار'); lines.push(`https://media.example.test/${kind}/1.m3u8`); }
        for(let i=2;i<=5;i++){lines.push('#EXTINF:-1 group-title="فيديو",فيلم '+i);lines.push('https://media.example.test/movie/'+i+'.m3u8');}
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

    await page.locator('#channels .favorite-button').first().click();
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-pressed'),'true');
    const catalogueBefore = await page.evaluate(async () => {
      const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('lg-stream-catalog');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      const value = await new Promise(resolve=>{const r=db.transaction('meta').objectStore('meta').get('active');r.onsuccess=()=>resolve({count:r.result.count,revision:r.result.revision})}); db.close();return value;
    });
    assert.equal(await page.locator('body').getAttribute('data-theme'), 'editorial');
    const nav=page.locator('.primary-panel button');
    const boxes=await nav.evaluateAll(nodes=>nodes.map(n=>({id:n.id||n.dataset.section,x:n.getBoundingClientRect().x})));
    assert.deepEqual(boxes.map(b=>b.id), ['nav-search','favorites','tv','movies','series']);
    assert.ok(boxes.every((b,i)=>!i||b.x>boxes[i-1].x),'Arabic menu starts physically left with Search');
    await page.locator('#nav-search').focus();
    for(const id of ['favorites','tv','movies','series']){await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.id||document.activeElement.dataset.section),id)}
    await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.id),'nav-settings');
    await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.id),'setup-button');
    await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.id),'nav-settings');
    await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.id),'nav-search');
    const header=await page.locator('.header-actions button').evaluateAll(nodes=>nodes.map(n=>({id:n.id,x:n.getBoundingClientRect().x})));
    assert.deepEqual(header.map(b=>b.id),['nav-settings','setup-button']);assert.ok(header[0].x<header[1].x);
    assert.equal(await page.locator('.header-actions #diagnostics-button').count(),0);
    const videoBox=await page.locator('.viewing-panel').boundingBox();
    await page.locator('#groups-filter').focus();await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await page.locator('.viewing-panel').boundingBox(),videoBox,'Opening main navigation cannot resize video');
    await page.locator('#nav-settings').click();await page.locator('#settings-appearance').click();
    for(const theme of ['cinema','editorial']){
      await page.locator('[data-theme-choice="'+theme+'"]').click();
      assert.equal(await page.locator('body').getAttribute('data-theme'),theme);
      assert.equal(await page.evaluate(()=>document.querySelector('video')===window.__originalVideo),true);
      assert.equal(await page.evaluate(()=>window.__mediaStarts),starts);
      await page.keyboard.press('Escape');await page.keyboard.press('Escape');
      for(const [width,height] of [[1280,720],[1920,1080]]){
        await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(root,'artifacts/theme-'+theme+'-'+height+'.png')});
      }
      await page.locator('#nav-settings').click();await page.locator('#settings-appearance').click();
    }
    await page.keyboard.press('Escape');
    await page.locator('[data-language="en"]').click();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
    assert.equal(await page.locator('#nav-search span').innerText(),'Search');
    assert.equal(await page.evaluate(()=>document.querySelector('video')===window.__originalVideo),true);
    assert.equal(await page.evaluate(()=>window.__mediaStarts),starts);
    assert.equal(await page.locator('#channels .channel-label').first().innerText(),'المفضلة','Provider names matching UI words are not translated');
    assert.equal(await page.locator('#channel-title').innerText(),'المفضلة');
    assert.equal(await page.locator('#groups [data-group="رياضة"]').innerText(),'رياضة');
    assert.equal(await page.locator('#status').innerText(),'Playing');
    assert.equal(await page.evaluate(()=>LGI18n.t('والترجمة')),'والترجمة','Do not partially translate inside an unknown Arabic word');
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-label'),'Remove from favorites: المفضلة');
    await page.keyboard.press('Escape');await page.locator('#nav-search').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.section),'favorites');await page.locator('#nav-settings').click();
    await page.screenshot({path:path.join(root,'artifacts/settings-english.png')});
    await page.locator('[data-language="ar"]').click();
    assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
    assert.equal(await page.locator('#nav-search span').innerText(),'البحث');
    assert.equal(await page.locator('#status').innerText(),'يعمل');
    assert.equal(await page.locator('#channels .favorite-button').first().getAttribute('aria-label'),'إزالة من المفضلة: المفضلة');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.__mediaStarts),starts);
    // Back navigates the hierarchy without releasing or restarting the current stream.
    await page.locator('#groups [data-group="رياضة"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.group),'رياضة');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.section),'tv');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#exit-confirm').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'exit-cancel');
    await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',repeat:true,bubbles:true})));
    assert.equal(await page.locator('#exit-confirm').isVisible(),true,'Held Back cannot cycle the confirmation');
    await page.screenshot({path:path.join(root,'artifacts/exit-confirm-1080.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.section),'tv');
    assert.equal(await page.evaluate(()=>document.querySelector('video')===window.__originalVideo),true);
    assert.equal(await page.evaluate(()=>window.__mediaStarts),starts);
    await page.locator('#groups [data-group=""]').click();
    const queuedIndex=await page.evaluate(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',keyCode:33,bubbles:true}));const index=document.activeElement.dataset.index;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return index;});
    assert.equal(queuedIndex,'1','Cancellation test queues a different channel');
    await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>window.__mediaStarts),starts,'Back cancels a pending channel switch');
    const catalogueAfter=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('lg-stream-catalog');r.onsuccess=()=>resolve(r.result)});const value=await new Promise(resolve=>{const r=db.transaction('meta').objectStore('meta').get('active');r.onsuccess=()=>resolve({count:r.result.count,revision:r.result.revision})});db.close();return value});
    assert.deepEqual(catalogueAfter,catalogueBefore);
    await page.locator('#nav-settings').click();await page.locator('[data-language="en"]').click();
    await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'error',{configurable:true,value:{code:2}});v.dispatchEvent(new Event('error'));});
    await page.locator('[data-language="ar"]').click();assert.match(await page.locator('#status').innerText(),/تعذر.*\(2\)/);
    await page.locator('[data-language="en"]').click();assert.match(await page.locator('#status').innerText(),/Couldn't.*\(2\)/);
    await page.locator('#settings-appearance').click();await page.locator('[data-theme-choice="cinema"]').click();
    await page.reload();await page.locator('#launch-splash').waitFor({state:'detached'});
    assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('body').getAttribute('data-theme'),'cinema');
    assert.equal(await page.locator('#nav-search span').innerText(),'Search');
    await page.waitForFunction(()=>document.querySelectorAll('#channels .channel-button').length>0);
    assert.equal(await page.locator('#channels .channel-label').first().innerText(),'المفضلة');
    const rail=await nav.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y}}));assert.ok(rail.every((r,i)=>!i||(Math.abs(r.x-rail[0].x)<1&&r.y>rail[i-1].y)),'Cinema navigation is physically a vertical left rail');
    await page.locator('.primary-button[data-section="movies"]').click();
    const cards=page.locator('#movie-grid .movie-card');assert.equal(await cards.count(),5);await cards.first().focus();
    const firstX=(await cards.first().boundingBox()).x;await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.index),await cards.nth(1).getAttribute('data-index'));assert.ok((await cards.nth(1).boundingBox()).x>firstX);
    await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('group-button')),true,'English left edge goes to physically left groups');
    for(const section of ['movies','series']){
      await page.locator('.primary-button[data-section="'+section+'"]').click();
      await page.locator('#groups [data-group="فيديو"]').click();
      assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('movie-card')),true);
      await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.group),'فيديو');
      await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.section),section);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#exit-confirm').isVisible(),true);
      assert.equal(await page.locator('#exit-title').innerText(),'Do you want to exit the app?');
      await page.locator('#exit-cancel').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.section),section);
    }
    await page.locator('.primary-button[data-section="tv"]').click();
    const orderedGroups = await page.locator('#groups [data-group]').evaluateAll(nodes => nodes.map(node => node.dataset.group));
    assert.equal(orderedGroups.indexOf('BEIN SPORTS FHD'), orderedGroups.indexOf('beIN') + 1);
    await page.locator('#nav-settings').click();
    await page.locator('[data-language="ar"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#groups [data-group="beIN"]').innerText(), 'بي إن');
    assert.equal(await page.locator('#groups [data-group="BEIN SPORTS FHD"]').innerText(), 'بي إن سبورت FHD');
    assert.equal(await page.locator('#groups [data-group="NEWS HD"]').innerText(), 'أخبار HD');
    await page.locator('#groups [data-group="BEIN SPORTS FHD"]').click();
    assert.equal(await page.locator('#channels .channel-label').first().innerText(), 'بي إن سبورت 1 FHD');
    await page.locator('#channels .channel-button').first().click();
    const arabicStarts = await page.evaluate(() => { window.__arabicVideo = document.querySelector('video'); return window.__mediaStarts; });
    assert.equal(await page.locator('#channel-title').innerText(), 'بي إن سبورت 1 FHD');
    assert.match(await page.locator('#channels .favorite-button').first().getAttribute('aria-label'), /بي إن سبورت 1 FHD/);
    await page.screenshot({ path: path.join(root, 'artifacts/catalog-arabic-1080.png') });
    await page.locator('#nav-settings').click();
    await page.locator('[data-language="en"]').click();
    assert.equal(await page.locator('#channels .channel-label').first().innerText(), 'beIN SPORTS 1 FHD');
    assert.equal(await page.locator('#channel-title').innerText(), 'beIN SPORTS 1 FHD');
    await page.locator('[data-language="ar"]').click();
    assert.equal(await page.evaluate(() => document.querySelector('video') === window.__arabicVideo), true);
    assert.equal(await page.evaluate(() => window.__mediaStarts), arabicStarts);
    await page.keyboard.press('Escape');
    await page.locator('#nav-search').click();
    await page.locator('#channel-search').fill('بي إن سبورت 1');
    await page.waitForFunction(() => document.querySelectorAll('#search-results button').length === 3);
    assert.equal(await page.locator('#search-results button').first().innerText(), 'بي إن سبورت 1 FHD');
    await page.keyboard.press('Escape');
    for (const language of ['ar', 'en']) {
      await page.locator('#nav-settings').click();
      await page.locator('[data-language="' + language + '"]').click();
      await page.keyboard.press('Escape');
      for (const [category, first, second, arabicLabel, mixedName] of [['sports', 'BEIN SPORTS FHD', 'BEIN SPORTS HD', 'بي إن سبورت FHD', 'SSC1 FHD'], ['movies', 'MBC MOVIES HD', 'MBC MOVIES FHD', 'MBC موفيز HD', 'MBC2']]) {
        await page.locator('#groups-filter').click();
        await page.locator('#category-list [data-category="' + category + '"]').click();
        const groups = await page.locator('#groups [data-group]').evaluateAll(nodes => nodes.map(node => node.dataset.group));
        assert.ok(groups.indexOf(first) > 0);
        assert.equal(groups.indexOf(second), groups.indexOf(first) + 1);
        if (category === 'sports') assert.equal(groups.indexOf('CUSTOM SPORTS FHD'), groups.indexOf('CUSTOM SPORTS HD') + 1);
        assert.equal(await page.locator('#groups [data-group="' + first + '"]').innerText(), language === 'en' ? first : arabicLabel);
        await page.locator('#groups [data-group="مختلط"]').click();
        assert.equal(await page.locator('#channels .channel-button').count(), 1);
        assert.equal(await page.locator('#channels .channel-label').innerText(), mixedName);
        assert.equal(await page.evaluate(() => document.querySelector('video') === window.__arabicVideo), true);
        assert.equal(await page.evaluate(() => window.__mediaStarts), arabicStarts);
      }
    }
    await page.locator('#nav-settings').click();
    await page.locator('[data-language="ar"]').click();
    await page.keyboard.press('Escape');
    await page.locator('#groups-filter').click();
    await page.locator('#category-list [data-category="all"]').click();
    await page.locator('#groups [data-group="BEIN SPORTS FHD"]').click();
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('#groups [data-group="BEIN SPORTS FHD"].active'));
    assert.equal(await page.locator('#channels .channel-label').first().innerText(), 'بي إن سبورت 1 FHD');
    const storedLabels = await page.evaluate(async () => {
      const store = LGCatalogStore.createStore(); const saved = await store.load();
      return saved.entries.filter(entry => entry.group === 'BEIN SPORTS FHD').map(entry => entry.name);
    });
    assert.deepEqual(storedLabels, ['beIN SPORTS 1 FHD']);
    await page.addInitScript(() => {
      const state = JSON.parse(localStorage.getItem('lg-stream-view-v1'));
      state.category = 'sports'; state.groupIndex = 2; delete state.filterVersion;
      localStorage.setItem('lg-stream-view-v1', JSON.stringify(state));
    });
    await page.reload();
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('#groups [data-group=""].active'));
    assert.match(await page.locator('#groups-filter').innerText(), /رياضة/);
    await page.locator('#nav-settings').click();
    await page.locator('[data-language="en"]').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{window.__exitCalls=0;window.close=()=>{window.__exitCalls++}});
    await page.keyboard.press('Escape');await page.locator('#exit-accept').click();assert.equal(await page.evaluate(()=>window.__exitCalls),1);
    assert.deepEqual(errors,[]);assert.equal(unexpectedRequests,0);
    console.log('Themes/language: physical menu order, same player, unchanged catalogue, 720/1080 layouts passed. Synthetic media only.');
  }finally{if(browser)await browser.close();if(preview.exitCode===null){const closed=once(preview,'exit');preview.kill();await closed}}
}
main().catch(error=>{console.error(error);process.exitCode=1});
