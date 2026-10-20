// Optional visual evidence capture. Recording is excluded from performance runs.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const base = 'http://127.0.0.1:4184';
const out = path.resolve('artifacts/performance/mobile-motion');
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4184',
    '--strictPort',
  ],
  { stdio: 'ignore' },
);
let browser;
const errors = [],
  frames = [];
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  await mkdir(out, { recursive: true });
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
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(base + '/?profile=1&backend=webgl&quality=balanced&progress=0.38&view=bow');
  await page.waitForFunction(() => window.__HAN_RIVER__?.state.ready, null, { timeout: 120000 });
  await page.locator('#speed').selectOption('4');
  await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
  await page.screenshot({ path: `${out}/start.png`, scale: 'css' });
  const before = await page.evaluate(() => window.__HAN_RIVER__.snapshot());
  const client = await page.context().newCDPSession(page);
  client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    if (frames.length < 300) frames.push({ data, timestamp: metadata.timestamp });
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: 390,
    maxHeight: 844,
    everyNthFrame: 1,
  });
  const start = Date.now();
  await page.locator('#play').click();
  await delay(10000);
  await page.locator('#play').click();
  await client.send('Page.stopScreencast');
  const wallMs = Date.now() - start;
  const after = await page.evaluate(() => window.__HAN_RIVER__.snapshot());
  await page.screenshot({ path: `${out}/end.png`, scale: 'css' });
  assert.ok(frames.length >= 2, 'capture contains moving frames');
  assert.ok(after.elapsed > before.elapsed);
  assert.equal(after.speed, 4);
  assert.deepEqual(errors, []);
  let concat = '';
  for (let i = 0; i < frames.length; i++) {
    const file = `${String(i).padStart(4, '0')}.jpg`;
    await writeFile(`${out}/${file}`, Buffer.from(frames[i].data, 'base64'));
    const duration =
      i + 1 < frames.length ? Math.max(0.001, frames[i + 1].timestamp - frames[i].timestamp) : 0.1;
    concat += `file '${file}'\nduration ${duration}\n`;
  }
  await writeFile(`${out}/frames.txt`, concat);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    `${out}/frames.txt`,
    '-vf',
    'scale=390:844',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    `${out}/motion.mp4`,
  ]);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        frames: frames.length,
        wallMs,
        before,
        after,
        errors,
        note: 'Actual 4x cruise captured in Chromium/SwiftShader with iPhone UA; recording overhead included. Not device FPS or Safari validation.',
      },
      null,
      2,
    ),
  );
  console.log('Captured', frames.length, 'frames in', wallMs, 'ms:', `${out}/motion.mp4`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
