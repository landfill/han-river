import { PlaneGeometry } from 'three/webgpu';

export function createRiverGrid(segments = 256) {
  const geometry = new PlaneGeometry(2, 2, segments, segments);
  // Lower-density mobile grids retain ~1 m cells beside the hull. The far
  // surface uses fewer vertices; fragment-level FFT normals are unchanged.
  const exponent = 6 + Math.log(256 / segments) * 1.4;
  const extent = 8000,
    denominator = Math.expm1(exponent);
  const warp = (x) => ((Math.sign(x) * Math.expm1(Math.abs(x) * exponent)) / denominator) * extent;
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++)
    positions.setXY(i, warp(positions.getX(i)), warp(positions.getY(i)));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
