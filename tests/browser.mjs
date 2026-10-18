import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const port = 4175,
  base = `http://127.0.0.1:${port}`,
  dir = 'artifacts';
await mkdir(dir, { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'pipe' },
);
let serverLog = '';
server.stdout.on('data', (b) => (serverLog += b));
server.stderr.on('data', (b) => (serverLog += b));
const results = [],
  errors = [],
  requests = [];
let browser;
async function check(name, fn) {
  const start = Date.now();
  await fn();
  results.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function ready(page, path = '/') {
  await page.bringToFront();
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__HAN_RIVER__?.state.ready, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}
async function frames(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (i === 99) throw new Error('Vite did not start: ' + serverLog);
    await delay(100);
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-unsafe-webgpu',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('requestfailed', (r) => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on('request', (r) => requests.push(r.url()));
  await check('desktop renders locally with WebGL2 software fallback', async () => {
    await ready(page, '/?quality=low&still=1');
    assert.equal(await page.evaluate(() => window.__HAN_RIVER__.stats.backend), 'WebGL2');
    await page.screenshot({ path: `${dir}/01-golden-desktop.png` });
    assert.ok(
      requests.every((u) => u.startsWith(base) || u.startsWith('data:')),
      'external runtime requests',
    );
    assert.equal(await page.locator('#scene').evaluate((c) => c.width), 896);
  });
  await check('start, travel, pause and resume use real UI', async () => {
    await page.locator('#start').click();
    await page.waitForFunction(() => window.__HAN_RIVER__.state.elapsed > 0.1, null, {
      timeout: 15000,
    });
    assert.ok(await page.locator('body').evaluate((b) => b.classList.contains('started')));
    await page.locator('#play').click();
    const elapsed = await page.evaluate(() => window.__HAN_RIVER__.state.elapsed);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.elapsed), elapsed);
    await page.locator('#play').click();
    assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.playing), true);
    await page.locator('#play').click();
  });
  await check('viewpoints, keyboard and pointer look change camera', async () => {
    await page.locator('[data-view=bow]').click();
    await frames(page);
    const before = await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw);
    await page.locator('#scene').focus();
    await page.keyboard.press('ArrowRight');
    assert.ok((await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw)) > before);
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(850, 470, { steps: 5 });
    await page.mouse.up();
    assert.notEqual(await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw), before + 0.12);
    await page.locator('[data-view=city]').click();
  });
  await check('day, golden-hour and night render distinct scenes', async () => {
    for (const time of ['day', 'night', 'golden']) {
      await page.locator(`[data-time=${time}]`).click();
      await page.waitForTimeout(600);
      assert.equal(await page.locator(`[data-time=${time}]`).getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: `${dir}/02-${time}.png` });
    }
    assert.deepEqual(await page.evaluate(() => window.__HAN_RIVER__.state.errors), []);
  });
  await check('route and landmark dialogs support close and Escape', async () => {
    await page.locator('#route-open').click();
    assert.equal(await page.locator('#route-dialog').evaluate((d) => d.open), true);
    await page.screenshot({ path: `${dir}/03-route.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#route-dialog').evaluate((d) => d.open), false);
    await page.locator('#landmark-open').click();
    await page.locator('#look-city').click();
    assert.equal(await page.locator('#landmark-dialog').evaluate((d) => d.open), false);
  });
  await check('sound activates only on interaction and toggles', async () => {
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
  });
  await check('quality and reduced motion persist; restart resets cruise', async () => {
    await page.locator('#settings-open').click();
    await page.locator('#quality').selectOption('low');
    await page.locator('#reduce-motion').check();
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('hangang-preferences')).quality),
      'low',
    );
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.elapsed), 0);
    assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.started), false);
  });
  await check('bridge approach, passage, stern and night scene capture', async () => {
    await page.locator('#start').click();
    await page.locator('#play').click();
    for (const [name, p, v, time] of [
      ['bridge-approach', 0.38, 'bow', 'golden'],
      ['bridge-under', 0.416, 'bow', 'golden'],
      ['railway', 0.92, 'bow', 'day'],
      ['stern-wake', 0.6, 'stern', 'golden'],
      ['city-night', 0.2, 'city', 'night'],
      ['sun-glitter', 0.15, 'city', 'golden'],
    ]) {
      await page.evaluate(
        async ({ name, p, v, time }) => {
          const a = window.__HAN_RIVER__;
          a.setProgress(p);
          a.setView(v);
          await a.setTime(time);
          if (time === 'golden' && v === 'city') a.state.targetYaw = 2.65;
          if (name === 'bridge-under') a.state.targetPitch = 1.1;
        },
        { name, p, v, time },
      );
      await frames(page);
      await page.screenshot({ path: `${dir}/04-${name}.png` });
    }
  });
  await check('full accelerated voyage reaches the end and restarts', async () => {
    const voyage = await browser.newPage({
      viewport: { width: 960, height: 600 },
      reducedMotion: 'reduce',
    });
    voyage.on('pageerror', (e) => errors.push(String(e)));
    await ready(voyage, '/?rate=120&quality=low&view=bow');
    await voyage.locator('#start').click();
    await voyage.waitForFunction(() => window.__HAN_RIVER__.state.ended, null, { timeout: 25000 });
    assert.equal(await voyage.evaluate(() => window.__HAN_RIVER__.state.elapsed), 480);
    assert.equal(await voyage.locator('#play').getAttribute('aria-label'), '항해 다시 시작');
    await voyage.screenshot({ path: `${dir}/05-voyage-end.png` });
    await voyage.locator('#play').click();
    assert.equal(await voyage.evaluate(() => window.__HAN_RIVER__.state.playing), true);
    await voyage.close();
  });
  await check('mobile layout and native touch look work', async () => {
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    mobile.on('pageerror', (e) => errors.push(String(e)));
    await ready(mobile, '/?quality=low&still=1');
    await mobile.screenshot({ path: `${dir}/06-mobile.png` });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
    const client = await mobile.context().newCDPSession(mobile),
      yaw = await mobile.evaluate(() => window.__HAN_RIVER__.state.targetYaw);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 190, y: 400 }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 240, y: 410 }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForFunction((yaw) => window.__HAN_RIVER__.state.targetYaw !== yaw, yaw, {
      timeout: 10000,
    });
    await mobile.locator('#start').click();
    await mobile.screenshot({ path: `${dir}/06-mobile-voyage.png` });
    await mobile.close();
  });
  await check('measured render statistics and clean console', async () => {
    await page.bringToFront();
    await page.waitForFunction(() => window.__HAN_RIVER__.stats.medianFrameMs > 0, null, {
      timeout: 20000,
    });
    assert.deepEqual(errors, []);
    assert.ok((await page.evaluate(() => window.__HAN_RIVER__.stats.triangles)) > 1000);
  });
  const metrics = await page.evaluate(() => window.__HAN_RIVER__.snapshot());
  if (process.env.CAPTURE_VIDEO === '1') {
    await check('capture sampled complete-route film', async () => {
      await mkdir(`${dir}/route-frames`, { recursive: true });
      await page.setViewportSize({ width: 960, height: 600 });
      await page.evaluate(async () => {
        await window.__HAN_RIVER__.setTime('golden');
        window.__HAN_RIVER__.setView('bow');
        document.body.classList.add('hide-ui');
      });
      for (let i = 0; i < 48; i++) {
        await page.evaluate((p) => window.__HAN_RIVER__.setProgress(p), i / 47);
        await frames(page);
        await page.screenshot({ path: `${dir}/route-frames/${String(i).padStart(3, '0')}.png` });
      }
      const r = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-loglevel',
          'error',
          '-framerate',
          '6',
          '-i',
          `${dir}/route-frames/%03d.png`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          `${dir}/voyage-sampled.mp4`,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(r.status, 0, r.stderr);
    });
  }
  await check('asset failure displays recovery and retry succeeds', async () => {
    await browser.close();
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--enable-unsafe-webgpu',
      ],
    });
    const fail = await browser.newPage({ viewport: { width: 960, height: 600 } });
    let block = true;
    await fail.route('**/textures/waternormals.jpg', (route) =>
      block ? route.abort() : route.continue(),
    );
    await fail.bringToFront();
    await fail.goto(base + '/?backend=webgl&quality=low', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await fail.locator('#error-screen:not([hidden])').waitFor({ timeout: 60000 });
    assert.equal(await fail.locator('#retry').isVisible(), true);
    assert.match(await fail.locator('#error-message').textContent(), /텍스처/);
    await fail.screenshot({ path: `${dir}/07-recovery.png` });
    block = false;
    await fail.locator('#retry').click();
    await fail.waitForFunction(() => window.__HAN_RIVER__?.state.ready, null, { timeout: 60000 });
    await fail.close();
  });
  await writeFile(
    `${dir}/browser-results.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: await browser.version(),
        viewport: '1280x800, low quality (mobile 390x844)',
        results,
        metrics,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: results.length, metrics, errors }, null, 2));
} catch (e) {
  await writeFile(
    `${dir}/browser-failure.json`,
    JSON.stringify({ results, errors, failure: String(e) }, null, 2),
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
