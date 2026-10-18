import test from 'node:test';
import assert from 'node:assert/strict';
import { inverseFFT, WaveCascade } from '../src/spectrum.js';
import {
  progressAt,
  routePoint,
  DURATION,
  formatTime,
  voyageSpeed,
  advanceVoyage,
} from '../src/route.js';
import { bankAt } from '../src/world.js';

test('inverse FFT reconstructs a known complex frequency', () => {
  const re = new Float64Array(8),
    im = new Float64Array(8);
  re[1] = 8;
  inverseFFT(re, im, 8);
  for (let i = 0; i < 8; i++) {
    assert.ok(Math.abs(re[i] - Math.cos((2 * Math.PI * i) / 8)) < 1e-10);
    assert.ok(Math.abs(im[i] - Math.sin((2 * Math.PI * i) / 8)) < 1e-10);
  }
});
test('spectral river is finite, real-valued, reproducible and evolves', () => {
  const a = new WaveCascade({ n: 32, length: 64, height: 0.06, seed: 4 });
  const first = new Float32Array(a.data);
  const rms = Math.sqrt(a.re.reduce((s, x) => s + (x * a.scale) ** 2, 0) / (32 * 32));
  assert.ok(Math.abs(rms - 0.06) < 0.00001);
  a.update(7.25);
  assert.ok(a.data.every(Number.isFinite));
  assert.ok(a.im.every((x) => Math.abs(x) < 1e-6));
  assert.notDeepEqual(a.data, first);
  const b = new WaveCascade({ n: 32, length: 64, height: 0.06, seed: 4 });
  b.update(7.25);
  assert.deepEqual(a.data, b.data);
});
test('cruise accelerates smoothly, progresses monotonically, ends at 8 min', () => {
  assert.equal(progressAt(-1), 0);
  assert.equal(progressAt(DURATION + 10), 1);
  assert.ok(progressAt(1) < 1 / DURATION);
  assert.ok(1 - progressAt(DURATION - 1) < 1 / DURATION);
  let previous = 0;
  for (let t = 0; t <= DURATION; t += 0.25) {
    const p = progressAt(t);
    assert.ok(p >= previous);
    assert.ok(Number.isFinite(routePoint(p).heading));
    previous = p;
  }
  assert.equal(formatTime(DURATION), '08:00');
  assert.equal(formatTime(65), '01:05');
});
test('voyage stays in river and clears all modelled bridge piers', () => {
  const south = [
    [-2500, 790],
    [-1150, 510],
    [-500, 400],
    [200, 360],
    [900, 380],
    [1800, 540],
  ];
  const north = [
    [-2500, -1050],
    [-1500, -900],
    [-700, -810],
    [200, -760],
    [1200, -840],
    [2200, -1050],
  ];
  const piers = [];
  for (let z = -790; z < 420; z += 120) piers.push({ x: z * -0.15, z, r: 8 });
  for (let z = -820; z < 420; z += 100) piers.push({ x: 1400 + z * -0.15, z, r: 25 });
  for (let i = 0; i <= 1000; i++) {
    const p = routePoint(i / 1000);
    assert.ok(p.z + 6 < bankAt(p.x, south));
    assert.ok(p.z - 6 > bankAt(p.x, north));
    // Rectangular boat footprint is conservatively bounded by a circle.
    for (const pier of piers)
      if (Math.abs(p.x - pier.x) < pier.r + 24)
        assert.ok(Math.abs(p.z - pier.z) > 11, `pier clearance at ${i / 1000}`);
  }
});
test('selected speed scales travel without changing position at the switch or overshooting', () => {
  const start = 100;
  for (const speed of [0.5, 1, 1.5, 2, 4]) {
    assert.equal(advanceVoyage(start, 0, speed), start);
    const elapsed = advanceVoyage(start, 10, speed);
    assert.equal(elapsed, start + 10 * speed);
    assert.ok(
      Math.abs(progressAt(elapsed) - progressAt(start) - (10 * speed) / (DURATION - 8)) < 1e-10,
    );
    let stepped = start;
    for (let i = 0; i < 100; i++) stepped = advanceVoyage(stepped, 0.1, speed);
    assert.ok(Math.abs(stepped - elapsed) < 1e-9, 'independent of frame rate');
    assert.equal(advanceVoyage(0, DURATION / speed, speed), DURATION);
    assert.equal(advanceVoyage(DURATION - 1, 20, speed), DURATION);
  }
  assert.equal(advanceVoyage(start, -10, 4), start);
  for (const invalid of [null, undefined, NaN, Infinity, -1, 0, 120, 'bad'])
    assert.equal(voyageSpeed(invalid), 1);
  assert.equal(voyageSpeed('0.5'), 0.5);
});
