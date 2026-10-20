import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InstancedMesh,
  BoxGeometry,
  MeshBasicMaterial,
  Matrix4,
  Color,
  PerspectiveCamera,
  Frustum,
} from 'three/webgpu';
import { partitionInstances } from '../src/spatial-instances.js';

test('partitioning preserves every instance and color while allowing local frustum culling', () => {
  const mesh = new InstancedMesh(new BoxGeometry(8, 16, 8), new MeshBasicMaterial(), 21);
  const matrix = new Matrix4(),
    color = new Color();
  const original = new Map();
  for (let i = 0; i < mesh.count; i++) {
    const x = (i - 10) * 250;
    matrix.makeTranslation(x, 8, -350);
    mesh.setMatrixAt(i, matrix);
    color.setRGB(i / 21, 0.5, 1 - i / 21);
    mesh.setColorAt(i, color);
    original.set(x, { matrix: [...matrix.elements], color: color.toArray() });
  }
  const group = partitionInstances(mesh);
  group.updateMatrixWorld(true);
  const recovered = new Set();
  let total = 0;
  for (const cell of group.children) {
    total += cell.count;
    assert.equal(cell.geometry, mesh.geometry);
    assert.equal(cell.material, mesh.material);
    for (let i = 0; i < cell.count; i++) {
      cell.getMatrixAt(i, matrix);
      cell.getColorAt(i, color);
      const x = matrix.elements[12];
      assert.ok(!recovered.has(x));
      recovered.add(x);
      assert.deepEqual(matrix.elements, original.get(x).matrix);
      color.toArray().forEach((v, j) => assert.ok(Math.abs(v - original.get(x).color[j]) < 1e-6));
    }
  }
  assert.equal(total, mesh.count);
  const camera = new PerspectiveCamera(52, 390 / 844, 0.2, 22000);
  camera.position.set(0, 5, 0);
  camera.lookAt(0, 5, -350);
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  const visible = group.children.filter((cell) => frustum.intersectsObject(cell));
  assert.ok(visible.length > 0);
  assert.ok(visible.reduce((n, cell) => n + cell.count, 0) < mesh.count / 2);
  const center = visible.some((cell) => {
    for (let i = 0; i < cell.count; i++) {
      cell.getMatrixAt(i, matrix);
      if (matrix.elements[12] === 0) return true;
    }
    return false;
  });
  assert.ok(center, 'visible central tree is retained');
});
