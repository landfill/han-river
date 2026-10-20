import { Group, InstancedMesh, Matrix4, Color } from 'three/webgpu';

// Keep the original instances and materials, but let both the view camera and
// reflection camera cull local bounds instead of submitting an entire riverbank.
export function partitionInstances(source, cellSize = 500) {
  const cells = new Map(),
    matrix = new Matrix4(),
    color = new Color();
  for (let i = 0; i < source.count; i++) {
    source.getMatrixAt(i, matrix);
    const key = `${Math.floor(matrix.elements[12] / cellSize)},${Math.floor(matrix.elements[14] / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }
  const group = new Group();
  group.name = `${source.name || 'Instances'} cells`;
  group.position.copy(source.position);
  group.quaternion.copy(source.quaternion);
  group.scale.copy(source.scale);
  for (const [key, indices] of cells) {
    // Keep the source buffer capacity: the 1200-tree buffer exceeds TSL's
    // uniform-buffer limit and uses instanced vertex attributes. Small buffers
    // become per-cell UBOs with unique shaders, stalling when entering new cells.
    // Extra capacity is a bounded memory tradeoff; only real instances are drawn.
    const mesh = new InstancedMesh(source.geometry, source.material, source.instanceMatrix.count);
    mesh.count = indices.length;
    mesh.name = `${source.name || 'Instances'} ${key}`;
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    for (let i = 0; i < indices.length; i++) {
      source.getMatrixAt(indices[i], matrix);
      mesh.setMatrixAt(i, matrix);
      if (source.instanceColor) {
        source.getColorAt(indices[i], color);
        mesh.setColorAt(i, color);
      }
    }
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  source.dispose(); // geometry and material are shared, not disposed
  return group;
}
