'use strict';
// Differential orchestration check, NOT a decoder/network/TV acceptance test.
// All sources are synthetic; no media or provider requests leave the runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');

async function inspect(root) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'app/appinfo.json'))).version;
  const preview = spawn(process.execPath, ['scripts/preview.cjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview did not start')), 5000);
      preview.once('error', reject);
      preview.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(8000);
    const errors = []; let externalRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173' && route.request().resourceType() !== 'media') return route.continue();
      externalRequests++; return route.abort();
    });
    await page.addInitScript(() => {
      const metrics = window.__metrics = { starts: 0, loads: 0, sources: 0, seeks: 0, tracks: 0, fetches: 0, indexes: 0, storageWrites: 0, mutations: 0 };
      const states = new WeakMap();
      const state = video => {
        if (!states.has(video)) states.set(video, { paused: true, time: 1, source: '' });
        return states.get(video);
      };
      const proto = HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'src', { configurable: true, get() { return state(this).source; }, set(value) { metrics.sources++; state(this).source = value; } });
      Object.defineProperty(proto, 'paused', { configurable: true, get() { return state(this).paused; } });
      Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return state(this).time; }, set(value) { metrics.seeks++; state(this).time = value; } });
      Object.defineProperty(proto, 'duration', { configurable: true, get() { return Infinity; } });
      Object.defineProperty(proto, 'seekable', { configurable: true, get() { return { length: 1, start() { return 0; }, end() { return state(this).time + 10; } }; } });
      for (const [property, value] of [['videoWidth', 1920], ['videoHeight', 1080]]) Object.defineProperty(HTMLVideoElement.prototype, property, { configurable: true, get() { return value; } });
      const audio = new EventTarget(); audio.length = 2;
      for (let i = 0; i < 2; i++) { let enabled = i === 0; audio[i] = { language: i ? 'en' : 'ar', get enabled() { return enabled; }, set enabled(value) { metrics.tracks++; enabled = value; } }; }
      const subtitles = new EventTarget(); subtitles.length = 1;
      let mode = 'disabled'; subtitles[0] = { kind: 'subtitles', language: 'ar', get mode() { return mode; }, set mode(value) { metrics.tracks++; mode = value; } };
      Object.defineProperty(proto, 'audioTracks', { configurable: true, get() { return audio; } });
      Object.defineProperty(proto, 'textTracks', { configurable: true, get() { return subtitles; } });
      proto.load = function () { metrics.loads++; };
      proto.pause = function () { state(this).paused = true; this.dispatchEvent(new Event('pause')); };
      proto.play = function () {
        metrics.starts++; state(this).paused = false;
        queueMicrotask(() => { if (this.isConnected) { this.dispatchEvent(new Event('playing')); state(this).time += 1; this.dispatchEvent(new Event('timeupdate')); } });
        return Promise.resolve();
      };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) { metrics.storageWrites++; return setItem.apply(this, args); };
      window.fetch = () => { metrics.fetches++; return Promise.reject(new Error('Unexpected synthetic fetch')); };
      const realNow = Date.now.bind(Date); let advanced = 0;
      Date.now = () => realNow() + advanced;
      const idleTimers = new Map(); let nextTimer = 1000000000;
      const timeout = window.setTimeout; const clear = window.clearTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay >= 60000) { const id = nextTimer++; idleTimers.set(id, () => callback(...args)); return id; }
        return timeout(callback, delay, ...args);
      };
      window.clearTimeout = id => { if (!idleTimers.delete(id)) clear(id); };
      window.__idleTick = () => { advanced += 61000; const callbacks = [...idleTimers.values()]; idleTimers.clear(); callbacks.forEach(callback => callback()); };
      Object.defineProperty(window, 'LGStream', { configurable: true, set(api) {
        const build = api.buildSectionIndex;
        api.buildSectionIndex = (...args) => { metrics.indexes++; return build(...args); };
        Object.defineProperty(window, 'LGStream', { configurable: true, value: api });
      } });
      Object.defineProperty(window, 'LGCatalogStore', { configurable: true, set(api) {
        api.createStore = () => ({
          load: async () => ({ state: 'complete', source: 'https://synthetic.invalid/list', revision: 'synthetic-revision', savedAt: Date.now() - 2 * 86400000,
            entries: Array.from({ length: 331681 }, (_, index) => ({ name: `قناة ${index}`, group: `رياضة ${index % 6000}`, url: `https://synthetic.invalid/live/${index}.m3u8` })) }),
          cancel: () => true
        });
        Object.defineProperty(window, 'LGCatalogStore', { configurable: true, value: api });
      } });
      let observer;
      window.__observe = () => {
        if (observer) observer.disconnect();
        Object.keys(metrics).forEach(key => { metrics[key] = 0; });
        observer = new MutationObserver(records => { metrics.mutations += records.length; });
        observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
      };
      window.__burst = async waiting => {
        const video = document.querySelector('video');
        for (let i = 0; i < 120; i++) {
          state(video).time += 0.25;
          video.dispatchEvent(new Event('timeupdate'));
          video.dispatchEvent(new Event('progress'));
          if (waiting && i % 20 === 0) { video.dispatchEvent(new Event('waiting')); video.dispatchEvent(new Event('playing')); }
          if (i % 20 === 0) await Promise.resolve();
        }
        window.__idleTick(); await Promise.resolve();
        return { ...metrics, videos: document.querySelectorAll('video').length, selectedSameVideo: video === document.querySelector('video') };
      };
    });
    await page.goto('http://127.0.0.1:4173');
    await page.locator('#launch-splash').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('#channels .channel-button').length === 40);
    await page.locator('#channels .channel-button').first().click();
    await page.waitForFunction(() => document.body.dataset.state === 'playing');
    const results = [];
    async function sample(phase, waiting = false) {
      await page.evaluate(() => window.__observe());
      const observed = await page.evaluate(waiting => window.__burst(waiting), waiting);
      for (const key of ['starts', 'loads', 'sources', 'seeks', 'tracks', 'fetches', 'indexes', 'storageWrites']) assert.equal(observed[key], 0, `${version}/${phase}: unexpected ${key}`);
      assert.equal(observed.videos, 1); assert.equal(observed.selectedSameVideo, true);
      if (phase === 'preview-idle' || phase === 'fullscreen-idle' || phase === 'controls-closed') assert.equal(observed.mutations, 0, `${version}/${phase}: hidden UI should stay idle`);
      results.push({ version, phase, ...observed });
    }
    await sample('preview-idle');
    if (await page.locator('#fullscreen-button').count()) await page.locator('#fullscreen-button').click();
    else { await page.locator('#display-button').click(); await page.locator('#display-fullscreen').click(); }
    await page.waitForTimeout(3100); // Let the one-shot fullscreen hint finish.
    await sample('fullscreen-idle');
    await page.keyboard.press('Enter');
    await sample('controls-open');
    await page.keyboard.press('Escape');
    await sample('controls-closed');
    await sample('waiting-playing-events', true);
    assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
    for (const result of results) console.log(JSON.stringify(result));
    return results;
  } finally {
    if (browser) await browser.close();
    if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill(); await closed; }
  }
}
(async () => {
  for (const root of process.argv.slice(2)) await inspect(path.resolve(root));
  console.log('Synthetic control-flow comparison only. No decoded media, native TV performance, A/V sync or provider stability was tested.');
})().catch(error => { console.error(error); process.exitCode = 1; });
