import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileBrowser, reflectionScale, riverSegments } from '../src/render-policy.js';
import { createRiverGrid } from '../src/river-grid.js';

test('iOS Safari, Edge and iPad desktop mode use mobile rendering; PCs do not', () => {
  for (const userAgent of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile EdgiOS/130.0',
    'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36',
  ])
    assert.equal(isMobileBrowser({ userAgent }), true);
  assert.equal(isMobileBrowser({ platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(
    isMobileBrowser({ platform: 'iPhone', userAgent: 'Macintosh', maxTouchPoints: 5 }),
    true,
  );
  assert.equal(
    isMobileBrowser({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 10,
    }),
    false,
  );
  assert.equal(isMobileBrowser({ platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(isMobileBrowser({ platform: 'Linux x86_64' }), false);
  for (const quality of ['low', 'balanced', 'high'])
    assert.equal(reflectionScale(quality, false), 0.5);
  assert.deepEqual(
    ['low', 'balanced', 'high'].map((q) => reflectionScale(q, true)),
    [0.25, 0.35, 0.5],
  );
});

test('mobile grids retain extent and near-hull detail, and desktop tessellation is unchanged', () => {
  assert.deepEqual(
    ['low', 'balanced', 'high'].map((q) => riverSegments(q, false)),
    [256, 256, 256],
  );
  assert.deepEqual(
    ['low', 'balanced', 'high'].map((q) => riverSegments(q, true)),
    [96, 128, 256],
  );
  for (const segments of [96, 128, 256]) {
    const g = createRiverGrid(segments),
      p = g.attributes.position;
    assert.equal(g.index.count / 3, segments * segments * 2);
    assert.equal(g.boundingBox.min.x, -8000);
    assert.equal(g.boundingBox.max.x, 8000);
    const center = (segments / 2) * (segments + 1) + segments / 2;
    assert.equal(p.getX(center), 0);
    assert.ok(p.getX(center + 1) > 0.5 && p.getX(center + 1) < 1.1);
    for (let x = 1; x <= segments; x++) assert.ok(p.getX(x) > p.getX(x - 1));
    assert.ok(g.index.array.every((i) => i >= 0 && i < p.count));
    g.dispose();
  }
});
