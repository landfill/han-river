import * as THREE from 'three/webgpu';
import {
  uniform,
  texture,
  positionWorld,
  positionLocal,
  cameraPosition,
  vec2,
  vec3,
  float,
  normalize,
  mix,
  max,
  dot,
  reflect,
  pow,
  reflector,
  length,
  sin,
  smoothstep,
  abs,
  exp,
} from 'three/tsl';
import { WaveCascade } from './spectrum.js';

export async function createRiver() {
  let normalMap;
  try {
    normalMap = await new THREE.TextureLoader().loadAsync('/textures/waternormals.jpg');
  } catch (cause) {
    const error = new Error(
      '물결 텍스처를 불러오지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
      { cause },
    );
    error.name = 'AssetLoadError';
    throw error;
  }
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  const cascades = [
    new WaveCascade({ length: 96, height: 0.072, seed: 82 }),
    new WaveCascade({ length: 12, height: 0.018, seed: 31 }),
  ];
  const maps = cascades.map((c) => {
    const t = new THREE.DataTexture(c.data, c.n, c.n, THREE.RGBAFormat, THREE.FloatType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
  const clock = uniform(0),
    sun = uniform(new THREE.Vector3(-0.8, 0.15, 0.4)),
    sunColor = uniform(new THREE.Color('#ffe4ba')),
    waterColor = uniform(new THREE.Color('#294b40'));
  const boatPosition = uniform(new THREE.Vector2(-1150, -90)),
    speed = uniform(0),
    night = uniform(0),
    heading = uniform(0);
  const material = new THREE.NodeMaterial();
  const gridOrigin = uniform(new THREE.Vector2());
  const uv = positionWorld.xz;
  const low = texture(maps[0], uv.div(96)),
    high = texture(maps[1], uv.div(12));
  // Plane is XY rotated to XZ; its local Z displacement becomes world Y.
  const localUV = vec2(positionLocal.x, positionLocal.y.negate()).add(gridOrigin);
  material.positionNode = vec3(
    positionLocal.xy,
    texture(maps[0], localUV.div(96)).w.add(texture(maps[1], localUV.div(12)).w),
  );
  const normalNoise = texture(normalMap, uv.div(22).add(vec2(clock.mul(0.006), clock.mul(0.003))))
    .xyz.mul(2)
    .sub(1);
  const normalNoise2 = texture(
    normalMap,
    uv.div(5.3).add(vec2(clock.mul(-0.012), clock.mul(0.009))),
  )
    .xyz.mul(2)
    .sub(1);
  const normal = normalize(
    vec3(
      low.x.add(high.x).add(normalNoise.x.mul(0.1)).add(normalNoise2.x.mul(0.035)),
      1,
      low.z.add(high.z).add(normalNoise.y.mul(0.1)).add(normalNoise2.y.mul(0.035)),
    ),
  );
  const view = normalize(cameraPosition.sub(positionWorld));
  const distance = length(cameraPosition.sub(positionWorld));
  const distortion = normal.xz.mul(float(0.001).add(float(1).div(distance.max(1)))).mul(1.8);
  const mirror = reflector({ resolutionScale: 0.5, bounces: false });
  mirror.uvNode = mirror.uvNode.add(distortion);
  const fresnel = pow(float(1).sub(dot(normal, view).max(0)), 5)
    .mul(0.975)
    .add(0.025);
  const glint = pow(max(dot(reflect(sun.negate(), normal), view), 0), 250)
    .mul(sunColor)
    .mul(4);
  const scatter = waterColor.mul(float(0.58).add(max(dot(sun, normal), 0).mul(0.4)));
  // Speed-coupled Kelvin-style diverging wake in the moving boat's local frame.
  const relative = uv.sub(boatPosition),
    along = relative.x.mul(heading.cos()).add(relative.y.mul(heading.sin()));
  const across = relative.y.mul(heading.cos()).sub(relative.x.mul(heading.sin()));
  const behind = along.negate();
  const wakeBand = abs(abs(across).sub(behind.mul(0.32))).div(
    float(1).add(behind.max(0).mul(0.012)),
  );
  const envelope = smoothstep(0, 10, behind)
    .mul(float(1).sub(smoothstep(70, 190, behind)))
    .mul(speed);
  const wake = exp(wakeBand.mul(-1.6))
    .mul(envelope)
    .mul(
      sin(behind.mul(1.9).sub(clock.mul(3)))
        .mul(0.3)
        .add(0.7),
    );
  const stern = exp(across.mul(across).mul(-0.07))
    .mul(smoothstep(14, 21, behind))
    .mul(float(1).sub(smoothstep(25, 85, behind)))
    .mul(speed);
  const foam = wake.mul(0.35).add(stern.mul(0.3)).clamp(0, 0.55);
  const lighting = mix(scatter, mirror.rgb.max(vec3(0)).min(vec3(8)), fresnel).add(
    glint.mul(float(1).sub(night)),
  );
  const bridgeDistance = abs(uv.x.add(uv.y.mul(0.15)).sub(26));
  const bridgeShade = smoothstep(12, 25, bridgeDistance).mul(0.45).add(0.55);
  material.colorNode = mix(lighting.mul(bridgeShade), vec3(0.66, 0.72, 0.67), foam);
  // A continuous exponential grid: ~0.95 m cells at the boat, gradually
  // expanding toward 8 km. The old uniform grid had 62.5 m near-field cells.
  const geometry = new THREE.PlaneGeometry(2, 2, 256, 256);
  const positions = geometry.attributes.position;
  const warp = (x) => ((Math.sign(x) * Math.expm1(Math.abs(x) * 6)) / Math.expm1(6)) * 8000;
  for (let i = 0; i < positions.count; i++)
    positions.setXY(i, warp(positions.getX(i)), warp(positions.getY(i)));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.add(mirror.target);
  mesh.receiveShadow = true;
  mesh.name = 'Spectral river';
  let last = -1;
  return {
    mesh,
    material,
    sun,
    sunColor,
    waterColor,
    night,
    mirror,
    update(t, boat, velocity) {
      clock.value = t;
      mesh.position.set(boat.x, 0, boat.z);
      gridOrigin.value.set(boat.x, boat.z);
      boatPosition.value.set(boat.x, boat.z);
      heading.value = boat.heading;
      speed.value = velocity;
      if (t - last > 0.08) {
        cascades.forEach((c, i) => {
          c.update(t);
          maps[i].needsUpdate = true;
        });
        last = t;
      }
    },
    quality(q) {
      mirror.resolutionScale = q === 'high' ? 0.65 : q === 'low' ? 0.25 : 0.45;
    },
  };
}
