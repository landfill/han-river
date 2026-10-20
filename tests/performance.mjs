import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import assert from 'node:assert/strict';

// Reproducible production-build diagnostics, not a mobile-device benchmark.
const label = process.env.PROFILE_LABEL || 'current';
const out = `artifacts/performance/${label}`;
const samples = Number(process.env.PROFILE_SAMPLES || 60);
const warmup = Number(process.env.PROFILE_WARMUP || 15);
assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 2000);
assert.ok(Number.isInteger(warmup) && warmup >= 0);
const port = 4181,
  base = `http://127.0.0.1:${port}`;
const cases = (process.env.PROFILE_CASES || 'golden,bridge,deck,night,travel').split(',');
const software = process.env.PROFILE_SOFTWARE !== '0';
const desktop = process.env.PROFILE_DESKTOP === '1';
const backend = process.env.PROFILE_BACKEND || (software ? 'webgl' : '');
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
    '--outDir',
    process.env.PROFILE_DIST || 'dist',
  ],
  { stdio: 'pipe' },
);
let serverLog = '',
  browser;
server.stdout.on('data', (b) => (serverLog += b));
server.stderr.on('data', (b) => (serverLog += b));
const errors = [],
  results = [];
function distribution(values) {
  const a = [...values].sort((a, b) => a - b);
  const at = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? null;
  return {
    count: a.length,
    median: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    mean: a.reduce((s, n) => s + n, 0) / a.length,
  };
}
async function waitFrames(page, count) {
  const start = await page.evaluate(() => window.__HAN_RIVER__.stats.frames);
  await page.waitForFunction(
    ({ start, count }) => window.__HAN_RIVER__.stats.frames - start >= count,
    { start, count },
    { timeout: Math.max(120000, count * 5000), polling: 'raf' },
  );
}
try {
  await mkdir(out, { recursive: true });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (i === 99) throw new Error('Preview failed: ' + serverLog);
    await delay(100);
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      ...(backend === 'webgpu' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] : []),
    ],
  });
  const page = await browser.newPage({
    viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: desktop ? 1 : 3,
    isMobile: !desktop,
    hasTouch: !desktop,
    reducedMotion: 'reduce',
    // Rendering still uses Chromium/SwiftShader; this UA exercises the iOS
    // device-category path and is never evidence of Safari or iPhone speed.
    userAgent: desktop
      ? undefined
      : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.error('PAGEERROR', String(e));
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('requestfailed', (r) => errors.push(r.url() + ': ' + r.failure()?.errorText));
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  await page.goto(
    `${base}/?profile=1&quality=${process.env.PROFILE_QUALITY || 'balanced'}${backend ? `&backend=${backend}` : ''}${process.env.PROFILE_STILL === '1' ? '&still=1' : ''}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(
    () => window.__HAN_RIVER__?.state.ready || window.__HAN_RIVER__?.state.errors.length,
    null,
    { timeout: 120000 },
  );
  assert.deepEqual(await page.evaluate(() => window.__HAN_RIVER__.state.errors), []);
  const environment = await page.evaluate(() => {
    const a = window.__HAN_RIVER__,
      { renderer, river } = a.inspect();
    const gl = renderer.backend.gl;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      canvas: [document.getElementById('scene').width, document.getElementById('scene').height],
      backend: a.state.backend,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : a.stats.adapter,
      gpuTimerSupported: !!(
        gl?.getExtension('EXT_disjoint_timer_query_webgl2') ||
        renderer.backend.device?.features.has('timestamp-query')
      ),
      loadMs: a.stats.loadMs,
      resources: performance.getEntriesByType('resource').map((r) => ({
        name: new URL(r.name).pathname,
        encodedBytes: r.encodedBodySize,
        duration: r.duration,
      })),
      reflectionScale: river.mirror.reflector.resolutionScale,
      requestedReflectionScale: river.mirror.resolutionScale ?? null,
    };
  });
  console.log('ENV', JSON.stringify(environment));
  if (backend === 'webgpu')
    assert.equal(environment.backend, 'WebGPU', 'WebGPU requested but no usable adapter selected');
  for (const name of cases) {
    await page.evaluate(async (name) => {
      const a = window.__HAN_RIVER__,
        d = a.inspect();
      if (!a.state.started) {
        a.play();
        a.play();
      }
      a.state.playing = false;
      a.state.speed = 1;
      a.setProgress(name === 'bridge' ? 0.416 : name === 'deck' ? 0.58 : 0.2);
      a.setView(name === 'bridge' ? 'bow' : name === 'deck' ? 'stern' : 'city');
      if (a.state.preset !== (name === 'night' ? 'night' : 'golden'))
        await a.setTime(name === 'night' ? 'night' : 'golden');
      if (a._restore) {
        a._restore();
        a._restore = null;
      }
      if (name === 'no-reflection') {
        const original = d.river.mirror.reflector.updateBefore;
        d.river.mirror.reflector.updateBefore = () => {};
        a._restore = () => (d.river.mirror.reflector.updateBefore = original);
      } else if (name === 'no-trees') {
        d.world.trees.visible = false;
        a._restore = () => (d.world.trees.visible = true);
      } else if (name === 'no-fft') {
        const original = d.river.update;
        d.river.update = () => {};
        a._restore = () => (d.river.update = original);
      } else if (name === 'no-blur') {
        const style = document.createElement('style');
        style.textContent = '* { backdrop-filter:none !important; }';
        document.head.append(style);
        a._restore = () => style.remove();
      } else if (name === 'coarse-water') {
        const geometry = d.river.mesh.geometry,
          original = geometry.index;
        const indices = [];
        const segments = geometry.parameters.widthSegments,
          stride = segments + 1;
        for (let y = 0; y < segments; y += 2)
          for (let x = 0; x < segments; x += 2) {
            const i = x + y * stride,
              next = i + 2 * stride;
            indices.push(i, next, i + 2, next, next + 2, i + 2);
          }
        geometry.setIndex(indices);
        a._restore = () => geometry.setIndex(original);
      } else if (name === 'no-sky') {
        d.sky.visible = false;
        a._restore = () => (d.sky.visible = true);
      } else if (name === 'travel') a.state.playing = true;
    }, name);
    await waitFrames(page, warmup);
    const before = (await client.send('Performance.getMetrics')).metrics;
    await page.evaluate(() => window.__HAN_RIVER__.profile.start());
    await waitFrames(page, samples);
    const raw = await page.evaluate(() => window.__HAN_RIVER__.profile.stop());
    const after = (await client.send('Performance.getMetrics')).metrics;
    const details = await page.evaluate(() => {
      const a = window.__HAN_RIVER__,
        { renderer, river } = a.inspect();
      return {
        snapshot: a.snapshot(),
        time: a.state.preset,
        view: a.state.view,
        quality: a.state.quality,
        memory: renderer.info.memory,
        renderPasses: renderer.info.render.frameCalls,
        heap: performance.memory?.usedJSHeapSize,
        reflectionTargets: [...river.mirror.reflector.renderTargets.values()].map((t) => [
          t.width,
          t.height,
        ]),
        waterVertices: river.mesh.geometry.attributes.position.count,
      };
    });
    const cpuMetrics = {};
    for (const metric of after) {
      if (
        ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(
          metric.name,
        )
      )
        cpuMetrics[metric.name] =
          metric.value - (before.find((m) => m.name === metric.name)?.value || 0);
    }
    const summary = {
      name,
      ...details,
      cpuMetrics,
      metrics: {},
      longTasks: distribution(raw.longTasks.map((t) => t.duration)),
      over50ms: raw.frames.filter((f) => f.intervalMs > 50).length,
    };
    for (const key of [
      'intervalMs',
      'sceneCpuMs',
      'riverCpuMs',
      'otherUpdateCpuMs',
      'renderSubmitCpuMs',
      'drawCalls',
      'triangles',
    ])
      summary.metrics[key] = distribution(raw.frames.map((f) => f[key]));
    results.push(summary);
    const caseId = `${results.length}-${name}`;
    await writeFile(`${out}/${caseId}-samples.json`, JSON.stringify(raw));
    if (process.env.PROFILE_STILL === '1')
      await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
    await page.screenshot({ path: `${out}/${caseId}.png`, scale: 'css' }); // outside the measured window
    console.log('RESULT', JSON.stringify(summary));
  }
  assert.deepEqual(errors, []);
  let gpuQueries = null;
  if (process.env.PROFILE_GPU === '1') {
    gpuQueries = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const a = window.__HAN_RIVER__,
            { renderer } = a.inspect();
          renderer.backend.trackTimestamp = true;
          let busy = false,
            attempts = 0;
          const values = [];
          renderer.setAnimationLoop(async () => {
            if (busy) return;
            busy = true;
            attempts++;
            renderer.render(a.scene, a.camera);
            const ms = await renderer.resolveTimestampsAsync();
            if (Number.isFinite(ms)) values.push(ms);
            if (values.length >= 12 || attempts >= 24) {
              renderer.setAnimationLoop(null);
              resolve(values);
            }
            busy = false;
          });
        }),
    );
  }
  const report = {
    date: new Date().toISOString(),
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    label,
    software,
    host: { cpu: os.cpus()[0].model, cpus: os.availableParallelism(), memory: os.totalmem() },
    browser: await browser.version(),
    samples,
    warmup,
    environment,
    results,
    errors,
    gpuQueries,
  };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e);
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
