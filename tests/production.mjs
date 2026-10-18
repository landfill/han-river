import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const port = 4177,
  base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: 'ignore' },
);
let browser;
const errors = [],
  checks = [];
const rendered = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
try {
  await mkdir('artifacts', { recursive: true });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (i === 99) throw new Error('Preview server unavailable');
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
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('requestfailed', (r) => errors.push(r.url() + ': ' + r.failure()?.errorText));
  await page.goto(base + '/?still=1&quality=balanced', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__HAN_RIVER__?.state.ready, null, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/08-production-hero.png' });
  checks.push('built app renders from dist, including local fonts and texture');
  await page.locator('#start').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scene');
  const yaw = await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw);
  await page.keyboard.press('ArrowRight');
  assert.ok((await page.evaluate(() => window.__HAN_RIVER__.state.targetYaw)) > yaw);
  checks.push('keyboard look works immediately after starting');
  await page.evaluate(() => {
    const a = window.__HAN_RIVER__;
    a.setProgress(0.58);
    a.setView('stern');
    a.state.targetYaw = Math.PI - 0.18;
  });
  await rendered(page);
  await page.screenshot({ path: 'artifacts/08-active-wake.png' });
  assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.playing), true);
  await page.locator('#play').click();
  checks.push('active cruise and stern wake captured');
  const paused = await page.evaluate(() => window.__HAN_RIVER__.snapshot());
  for (const speed of ['0.5', '1', '1.5', '2', '4']) {
    await page.locator('#speed').selectOption(speed);
    const state = await page.evaluate(() => window.__HAN_RIVER__.snapshot());
    assert.equal(state.speed, Number(speed));
    assert.equal(state.elapsed, paused.elapsed);
    assert.deepEqual(state.position, paused.position);
    assert.match(await page.locator('#elapsed').innerText(), /남음$/);
  }
  await page.locator('#speed').selectOption('0.5');
  const slowRemaining = await page.locator('#elapsed').innerText();
  await page.locator('#speed').selectOption('4');
  assert.notEqual(await page.locator('#elapsed').innerText(), slowRemaining);
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('hangang-preferences')).speed),
    4,
  );
  checks.push('all five speeds update remaining time and preserve paused position');
  await page.locator('#play').click();
  await page.waitForFunction(
    (elapsed) => window.__HAN_RIVER__.state.elapsed > elapsed,
    paused.elapsed,
  );
  await page.locator('#play').click();
  assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.speed), 4);
  await page.evaluate(() => window.__HAN_RIVER__.reset());
  assert.equal(await page.locator('#elapsed').innerText(), '02:00 남음');
  await page.locator('#speed').focus();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#speed').inputValue(), '2');
  assert.equal(await page.locator('#elapsed').innerText(), '04:00 남음');
  checks.push('resume, restart and keyboard speed control retain expected travel state');
  await page.locator('#settings-open').click();
  await page.locator('#quality').selectOption('high');
  await page.keyboard.press('Escape');
  await rendered(page);
  await page.screenshot({ path: 'artifacts/08-high-quality.png' });
  assert.equal(await page.evaluate(() => window.__HAN_RIVER__.state.quality), 'high');
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__HAN_RIVER__.state.errors), []);
  checks.push('high quality shadow/reflection configuration renders without errors');
  await page.setViewportSize({ width: 375, height: 812 });
  await rendered(page);
  const mobile = await page.evaluate(() => {
    const ids = ['play', 'current-location', 'speed', 'route-open'];
    return ids.map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { id, x: r.x, right: r.right, y: r.y, bottom: r.bottom, height: r.height };
    });
  });
  for (let i = 0; i < mobile.length; i++) {
    assert.ok(mobile[i].x >= 0 && mobile[i].right <= 375, `${mobile[i].id} fits mobile`);
    if (i) assert.ok(mobile[i - 1].right <= mobile[i].x, 'mobile controls do not overlap');
  }
  assert.ok(mobile.find((r) => r.id === 'speed').height >= 44);
  await page.screenshot({ path: 'artifacts/09-mobile-speed.png' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__HAN_RIVER__?.state.ready, null, { timeout: 120000 });
  assert.equal(await page.locator('#speed').inputValue(), '2');
  assert.equal(await page.locator('#elapsed').innerText(), '04:00 남음');
  assert.deepEqual(errors, []);
  checks.push('mobile control fits and saved speed survives reload');
  const report = {
    date: new Date().toISOString(),
    browser: await browser.version(),
    checks,
    errors,
    metrics: await page.evaluate(() => window.__HAN_RIVER__.snapshot()),
  };
  await writeFile('artifacts/production-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
