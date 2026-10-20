import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:4183';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4183',
    '--strictPort',
  ],
  { stdio: 'ignore' },
);
const safariUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const errors = [],
  checks = [];
let browser;
const frame = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log('PASS', name);
}
async function ready(page) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(base + '/?profile=1&backend=webgl&quality=balanced&still=1', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => window.__HAN_RIVER__?.state.ready || window.__HAN_RIVER__?.state.errors.length,
    null,
    { timeout: 120000 },
  );
  assert.deepEqual(await page.evaluate(() => window.__HAN_RIVER__.state.errors), []);
}
async function resources(page) {
  return page.evaluate(() => {
    const a = window.__HAN_RIVER__,
      d = a.inspect(),
      canvas = document.getElementById('scene');
    return {
      mode: a.snapshot().renderMode,
      segments: d.river.mesh.geometry.parameters.widthSegments,
      scale: d.river.mirror.reflector.resolutionScale,
      canvas: [canvas.width, canvas.height],
      targets: [...d.river.mirror.reflector.renderTargets.values()].map((t) => [t.width, t.height]),
      trees: d.world.trees.isGroup
        ? d.world.trees.children.reduce((n, m) => n + m.count, 0)
        : d.world.trees.count,
      cells: d.world.trees.children.length,
      geometries: d.renderer.info.memory.geometries,
      textures: d.renderer.info.memory.textures,
    };
  });
}
try {
  await mkdir('artifacts/performance', { recursive: true });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (i === 99) throw new Error('Preview unavailable');
    await delay(100);
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: safariUA,
    reducedMotion: 'reduce',
  });
  await ready(page);
  await check(
    'iPhone Safari UA selects mobile geometry while retaining all 1200 crowns',
    async () => {
      const r = await resources(page);
      assert.equal(r.mode, 'mobile');
      assert.equal(r.segments, 128);
      assert.equal(r.trees, 1200);
      assert.ok(r.cells > 1);
      assert.equal(r.scale, 0.35);
      assert.ok(r.targets.some((t) => t.every((v, i) => v === Math.round(r.canvas[i] * r.scale))));
    },
  );
  await check(
    'quality changes actual mobile grids and reflection targets without accumulating geometry',
    async () => {
      await page.locator('#settings-open').click();
      const counts = [];
      for (const [q, segments, scale] of [
        ['low', 96, 0.25],
        ['high', 256, 0.5],
        ['balanced', 128, 0.35],
        ['low', 96, 0.25],
        ['high', 256, 0.5],
        ['balanced', 128, 0.35],
      ]) {
        await page.evaluate(() => {
          const a = window.__HAN_RIVER__;
          a.gridDisposed = false;
          a.inspect().river.mesh.geometry.addEventListener(
            'dispose',
            () => (a.gridDisposed = true),
          );
        });
        await page.locator('#quality').selectOption(q);
        await frame(page);
        const r = await resources(page);
        assert.equal(r.segments, segments);
        assert.equal(r.scale, scale);
        assert.ok(r.targets.some((t) => t.every((v, i) => v === Math.round(r.canvas[i] * scale))));
        assert.equal(await page.evaluate(() => window.__HAN_RIVER__.gridDisposed), true);
        counts.push(r.geometries);
      }
      console.log('QUALITY_GEOMETRIES', counts);
      // The first high preset also initializes shadow-pass resources. Compare
      // identical presets after all presets have been visited.
      assert.equal(counts[5], counts[2], 'repeated quality cycles do not retain old grids');
      await page.keyboard.press('Escape');
    },
  );
  let inputTiming;
  await check(
    'native touch changes view while paused and sailing; speed settings remain independent',
    async () => {
      await page.locator('#start').click();
      await page.locator('#play').click();
      const client = await page.context().newCDPSession(page);
      const yaw = await page.evaluate(() => {
        const a = window.__HAN_RIVER__;
        document.getElementById('scene').addEventListener(
          'pointermove',
          (e) => {
            const now = performance.now();
            a.inputTiming = { eventQueueMs: now - e.timeStamp };
            requestAnimationFrame(
              () => (a.inputTiming.nextAnimationCallbackMs = performance.now() - now),
            );
          },
          { once: true },
        );
        return a.state.targetYaw;
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 190, y: 400 }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 240, y: 410 }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await frame(page);
      assert.notEqual(await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw), yaw);
      inputTiming = await page.evaluate(() => window.__HAN_RIVER__.inputTiming);
      for (const speed of ['0.5', '1', '4']) {
        const elapsed = await page.evaluate(() => window.__HAN_RIVER__.state.elapsed);
        await page.locator('#speed').selectOption(speed);
        await frame(page);
        assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.elapsed), elapsed);
        await page.locator('#play').click();
        await page.waitForFunction((t) => window.__HAN_RIVER__.state.elapsed > t, elapsed, {
          timeout: 15000,
        });
        assert.equal(await page.locator('#speed').inputValue(), speed);
        if (speed === '4') {
          const beforeYaw = await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw);
          await client.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: 190, y: 400 }],
          });
          await client.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: 140, y: 410 }],
          });
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          assert.notEqual(
            await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw),
            beforeYaw,
          );
        }
        await page.locator('#speed').selectOption('1.5');
        assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.playing), true);
        await page.locator('#play').click();
      }
    },
  );
  await check('time presets, landmarks and stern stay renderable on mobile', async () => {
    for (const [p, view, time] of [
      [0.38, 'bow', 'day'],
      [0.416, 'bow', 'golden'],
      [0.58, 'stern', 'golden'],
      [0.2, 'city', 'night'],
    ]) {
      await page.evaluate(
        async ({ p, view, time }) => {
          const a = window.__HAN_RIVER__;
          a.setProgress(p);
          a.setView(view);
          await a.setTime(time);
        },
        { p, view, time },
      );
      await frame(page);
      assert.deepEqual(await page.evaluate(() => window.__HAN_RIVER__.state.errors), []);
      await page.screenshot({ path: `artifacts/performance/mobile-${view}-${time}.png` });
    }
  });
  await check('visibility pause prevents travel jumps and preserves speed', async () => {
    await page.locator('#play').click();
    // Chromium headless tab focus does not reliably hide old tabs. Dispatch the
    // browser event with document.hidden overridden to exercise the real handler.
    const before = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      return window.__HAN_RIVER__.state.elapsed;
    });
    await delay(350);
    const stopped = await page.evaluate(() => ({
      elapsed: window.__HAN_RIVER__.state.elapsed,
      playing: window.__HAN_RIVER__.state.playing,
    }));
    assert.equal(stopped.elapsed, before);
    assert.equal(stopped.playing, false);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await frame(page);
    assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.elapsed), before);
    await page.locator('#play').click();
    await page.waitForFunction((t) => window.__HAN_RIVER__.state.elapsed > t, before, {
      timeout: 15000,
    });
    await page.locator('#play').click();
    assert.equal(await page.locator('#speed').inputValue(), '1.5');
  });
  await page.close();
  const edge = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: safariUA + ' EdgiOS/130.0',
    reducedMotion: 'reduce',
  });
  await ready(edge);
  await check('iOS Edge UA also selects the mobile path', async () => {
    assert.equal((await resources(edge)).mode, 'mobile');
    assert.equal((await resources(edge)).segments, 128);
    await edge.locator('#speed').selectOption('2');
    await edge.reload({ waitUntil: 'domcontentloaded' });
    await edge.waitForFunction(() => window.__HAN_RIVER__?.state.ready, null, { timeout: 120000 });
    assert.equal(await edge.locator('#speed').inputValue(), '2');
  });
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/performance/mobile-functional.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: await browser.version(),
        note: 'iOS UA and touch emulation in Chromium/SwiftShader; not Safari/WebKit or real device validation',
        checks,
        inputTiming,
        errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e);
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
