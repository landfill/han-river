import './style.css';
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { createWorld, createBoat } from './world.js';
import { createRiver } from './river.js';
import { RiverAudio } from './audio.js';
import {
  DURATION,
  ROUTE_DISTANCE,
  routePoint,
  progressAt,
  nearestStop,
  formatTime,
} from './route.js';
import { icon, hydrateIcons } from './icons.js';

hydrateIcons();
const $ = (id) => document.getElementById(id),
  params = new URLSearchParams(location.search);
const audio = new RiverAudio(),
  stored = (() => {
    try {
      return JSON.parse(localStorage.getItem('hangang-preferences') || '{}');
    } catch {
      return {};
    }
  })();
const state = {
  ready: false,
  playing: false,
  started: false,
  ended: false,
  elapsed: 0,
  preset: 'golden',
  view: 'city',
  quality: params.get('quality') || stored.quality || 'balanced',
  reducedMotion: stored.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
  yaw: 1.72,
  pitch: 0.017,
  targetYaw: 1.72,
  targetPitch: 0.017,
  frames: [],
  errors: [],
  backend: 'pending',
  time: 0,
};
const save = () => {
  try {
    localStorage.setItem(
      'hangang-preferences',
      JSON.stringify({ quality: state.quality, reducedMotion: state.reducedMotion }),
    );
  } catch {}
};
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.2, 22000);
const VIEW_OFFSETS = { bow: { x: 11, z: 0 }, city: { x: 8, z: 2.4 }, stern: { x: -18, z: 0 } };
const target = new THREE.Vector3(),
  direction = new THREE.Vector3();
let renderer,
  world,
  river,
  boat,
  sky,
  sunLight,
  ambient,
  hemi,
  pmrem,
  envTexture,
  previous = 0,
  frameCount = 0,
  toastTimer;
const stats = {
  frames: 0,
  medianFrameMs: 0,
  p95FrameMs: 0,
  drawCalls: 0,
  triangles: 0,
  backend: '',
  adapter: 'unavailable',
  loadMs: 0,
};
window.__HAN_RIVER__ = {
  state,
  stats,
  scene,
  camera,
  setProgress(p) {
    state.elapsed = THREE.MathUtils.clamp(p, 0, 1) * DURATION;
    updateHUD();
  },
  setTime: timePreset,
  setView,
  play: togglePlayback,
  reset: resetJourney,
  snapshot: () => ({
    ready: state.ready,
    playing: state.playing,
    elapsed: state.elapsed,
    progress: progressAt(state.elapsed),
    location: nearestStop(progressAt(state.elapsed)).name,
    position: routePoint(progressAt(state.elapsed)),
    ...stats,
  }),
};
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3600);
}
function loading(value, message) {
  $('loading-progress').style.width = `${value}%`;
  if (message) $('loading-text').textContent = message;
}
function error(message) {
  state.ready = false;
  $('error-message').textContent = message;
  $('error-screen').hidden = false;
  $('loading').classList.add('done');
  $('loading').setAttribute('aria-hidden', 'true');
}
function wrap(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
function setView(view) {
  if (!['bow', 'city', 'stern'].includes(view)) view = 'city';
  state.view = view;
  if (state.ready && !state.reducedMotion)
    $('scene').animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 300 });
  const p = progressAt(state.elapsed);
  state.targetYaw = view === 'bow' ? 0.13 : view === 'stern' ? Math.PI + 0.12 : 1.72;
  state.targetPitch = view === 'city' ? 0.025 : -0.025;
  if (state.reducedMotion) {
    state.yaw = state.targetYaw;
    state.pitch = state.targetPitch;
  }
  document.querySelectorAll('[data-view]').forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}
function togglePlayback() {
  if (!state.ready) return;
  if (state.ended) resetJourney();
  if (!state.started) {
    state.started = true;
    document.body.classList.add('started');
    $('intro').classList.add('departed');
    $('scene').focus({ preventScroll: true });
    toast('항해를 시작합니다. 드래그해서 서울을 둘러보세요.');
  }
  state.playing = !state.playing;
  updateHUD();
}
function resetJourney() {
  state.elapsed = 0;
  state.playing = false;
  state.ended = false;
  state.started = false;
  document.body.classList.remove('started');
  $('intro').classList.remove('departed');
  setView('city');
  updateHUD();
}
function updateHUD() {
  const progress = progressAt(state.elapsed),
    stop = nearestStop(progress);
  $('voyage-state').textContent = state.ended
    ? '물길에서 만난 서울'
    : state.playing
      ? '천천히, 항해 중'
      : state.started
        ? '풍경에 잠시 머무는 중'
        : '당신을 기다리는 항해';
  $('current-location').textContent = state.ended ? '한강철교 · 관람 종료' : stop.name;
  $('elapsed').innerHTML = `${formatTime(state.elapsed)} <span>/</span> ${formatTime(DURATION)}`;
  $('track-progress').style.width = `${progress * 100}%`;
  $('boat-marker').style.left = `${progress * 100}%`;
  $('distance').textContent = `${((progress * ROUTE_DISTANCE) / 1000).toFixed(1)} / 2.8 km`;
  $('play').innerHTML = icon(state.playing ? 'pause' : state.ended ? 'rotate' : 'play');
  $('play').setAttribute(
    'aria-label',
    state.playing ? '항해 일시정지' : state.ended ? '항해 다시 시작' : '항해 시작',
  );
  $('landmark-name').textContent = stop.title;
  $('landmark-description').innerText = stop.description;
  $('story-title').textContent = stop.title;
  $('story-body').textContent = stop.story;
}
async function timePreset(name) {
  if (!['day', 'golden', 'night'].includes(name)) name = 'golden';
  state.preset = name;
  document.querySelectorAll('[data-time]').forEach((b) => {
    const active = b.dataset.time === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  const presets = {
    day: {
      sun: [-0.5, 0.8, 0.3],
      color: '#fff4db',
      intensity: 3,
      ambient: 1.1,
      exposure: 0.85,
      fog: '#bbccc8',
      density: 0.0001,
      water: '#254b42',
      weather: '햇살 아래의 한강 · 가벼운 강바람',
      rayleigh: 1.6,
      turbidity: 3,
    },
    golden: {
      sun: [-0.87, 0.038, 0.45],
      color: '#ffddac',
      intensity: 2.7,
      ambient: 0.8,
      exposure: 0.8,
      fog: '#c8b59b',
      density: 0.00014,
      water: '#374a40',
      weather: '해 질 녘의 한강 · 잔잔한 바람',
      rayleigh: 2.5,
      turbidity: 8,
    },
    night: {
      sun: [-0.85, -0.15, 0.4],
      color: '#adc2eb',
      intensity: 0.16,
      ambient: 0.18,
      exposure: 1,
      fog: '#182938',
      density: 0.00015,
      water: '#14252b',
      weather: '밤빛이 흐르는 한강 · 고요한 물결',
      rayleigh: 0.5,
      turbidity: 3,
    },
  };
  $('weather').textContent = presets[name].weather;
  if (!renderer) return;
  const p = presets[name],
    v = new THREE.Vector3(...p.sun).normalize();
  sunLight.position.copy(v).multiplyScalar(1700);
  sunLight.color.set(p.color);
  sunLight.intensity = p.intensity;
  ambient.intensity = p.ambient * 0.25;
  hemi.intensity = p.ambient;
  hemi.color.set(name === 'night' ? '#7798c2' : '#d6e0e5');
  hemi.groundColor.set(name === 'night' ? '#1e2833' : '#6e7863');
  sky.sunPosition.value.copy(v).multiplyScalar(450000);
  sky.rayleigh.value = p.rayleigh;
  sky.turbidity.value = p.turbidity;
  sky.mieCoefficient.value = 0.007;
  sky.mieDirectionalG.value = 0.83;
  sky.cloudCoverage.value = name === 'night' ? 0.35 : 0.55;
  sky.cloudDensity.value = 0.35;
  sky.cloudScale.value = 0.0008;
  sky.cloudSpeed.value = params.has('still') ? 0 : 0.00002;
  scene.fog = new THREE.FogExp2(p.fog, p.density);
  renderer.toneMappingExposure = p.exposure;
  river.sun.value.copy(v);
  river.sunColor.value.set(p.color);
  river.waterColor.value.set(p.water);
  river.night.value = name === 'night' ? 1 : 0;
  world.setTime(name);
  // Keep environment lighting and visible sky consistent, rebuilding only on preset change.
  if (pmrem) {
    sky.showSunDisc.value = false;
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    const next = pmrem.fromScene(envScene, 0.025, 0.1, 22000);
    envTexture?.dispose();
    envTexture = next;
    scene.environment = next.texture;
    scene.environmentIntensity = name === 'night' ? 0.15 : 0.6;
    sky.showSunDisc.value = true;
  }
}
function applyQuality(q) {
  state.quality = q;
  $('quality').value = q;
  if (!renderer) return;
  renderer.setPixelRatio(
    q === 'high'
      ? Math.min(devicePixelRatio, 1.75)
      : q === 'low'
        ? 0.7
        : Math.min(devicePixelRatio, 1.15),
  );
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q === 'high';
  sunLight.castShadow = q === 'high';
  river.quality(q);
  save();
}
function animate(milliseconds) {
  const now = milliseconds * 0.001,
    actualDt = previous ? now - previous : 0,
    dt = Math.min(actualDt, 0.5);
  previous = now;
  if (!params.has('still')) state.time += dt;
  if (state.playing) {
    state.elapsed = Math.min(
      DURATION,
      state.elapsed + actualDt * Math.min(120, Math.max(1, Number(params.get('rate')) || 1)),
    );
    if (state.elapsed >= DURATION) {
      state.playing = false;
      state.ended = true;
      updateHUD();
      toast('오늘의 항해가 끝났어요. 다시 시작해 다른 빛의 한강도 만나보세요.');
    }
  }
  const progress = progressAt(state.elapsed),
    point = routePoint(progress),
    moving = state.playing
      ? THREE.MathUtils.smoothstep(state.elapsed, 0, 8) *
        (1 - THREE.MathUtils.smoothstep(state.elapsed, DURATION - 8, DURATION))
      : 0;
  boat.position.set(point.x, state.reducedMotion ? 0 : Math.sin(state.time * 0.7) * 0.025, point.z);
  boat.rotation.y = -point.heading;
  boat.rotation.x = state.reducedMotion ? 0 : Math.sin(state.time * 0.48) * 0.0009;
  boat.rotation.z = state.reducedMotion ? 0 : Math.sin(state.time * 0.61) * 0.0012;
  state.yaw +=
    wrap(state.targetYaw - state.yaw) * (state.reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
  state.pitch +=
    (state.targetPitch - state.pitch) * (state.reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
  const offset = VIEW_OFFSETS[state.view];
  camera.position.set(
    point.x + offset.x * Math.cos(point.heading) - offset.z * Math.sin(point.heading),
    4.85 + (state.reducedMotion ? 0 : Math.sin(state.time * 0.7) * 0.025),
    point.z + offset.x * Math.sin(point.heading) + offset.z * Math.cos(point.heading),
  );
  direction.set(
    Math.cos(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    Math.sin(state.yaw) * Math.cos(state.pitch),
  );
  target.copy(camera.position).add(direction);
  camera.lookAt(target);
  $('compass-needle').style.transform = `rotate(${((state.yaw + Math.PI / 2) * 180) / Math.PI}deg)`;
  river.update(state.time, point, moving);
  world.update(state.time);
  audio.update(moving);
  sunLight.target.position.set(point.x, 0, point.z);
  sunLight.target.updateMatrixWorld();
  sunLight.position.copy(river.sun.value).multiplyScalar(1700).add(sunLight.target.position);
  if (frameCount % 12 === 0) updateHUD();
  const start = performance.now();
  renderer.render(scene, camera);
  stats.drawCalls = renderer.info.render.drawCalls;
  stats.triangles = renderer.info.render.triangles;
  stats.frames++;
  if (dt > 0 && state.ready) {
    state.frames.push(actualDt * 1000);
    if (state.frames.length > 300) state.frames.shift();
    if (frameCount % 60 === 0) {
      const a = [...state.frames].sort((a, b) => a - b);
      stats.medianFrameMs = a[Math.floor(a.length * 0.5)];
      stats.p95FrameMs = a[Math.floor(a.length * 0.95)];
    }
  }
  frameCount++;
}
async function init() {
  const start = performance.now();
  loading(8, '그래픽 장치와 렌더링 환경을 확인하고 있어요');
  try {
    let adapter = null;
    if (navigator.gpu && params.get('backend') !== 'webgl') {
      try {
        adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      } catch {}
    }
    const software =
      adapter?.info &&
      /swiftshader|llvmpipe|software/i.test(
        `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.device}`,
      );
    const forceWebGL = !adapter || (software && params.get('backend') !== 'webgpu');
    stats.adapter = adapter?.info
      ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.device}`
      : 'WebGL2 fallback';
    renderer = new THREE.WebGPURenderer({
      canvas: $('scene'),
      antialias: true,
      forceWebGL,
      powerPreference: 'high-performance',
    });
    await renderer.init();
    state.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    stats.backend = state.backend;
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.15));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.onDeviceLost = () =>
      error('그래픽 장치 연결이 끊어졌어요. 다른 그래픽 앱을 종료한 뒤 다시 시도해 주세요.');
    loading(24, '강변과 서울의 실루엣을 만들고 있어요');
    await new Promise((r) => setTimeout(r, 0));
    world = createWorld(scene);
    boat = createBoat(scene);
    sky = new SkyMesh();
    sky.scale.setScalar(18000);
    scene.add(sky);
    ambient = new THREE.AmbientLight('#d2d4c0', 0.2);
    hemi = new THREE.HemisphereLight('#d6e0e5', '#6e7863', 0.8);
    scene.add(ambient, hemi);
    sunLight = new THREE.DirectionalLight('#ffe4bc', 2.7);
    sunLight.shadow.mapSize.set(1024, 1024);
    Object.assign(sunLight.shadow.camera, {
      left: -70,
      right: 70,
      top: 70,
      bottom: -70,
      near: 0.5,
      far: 4000,
    });
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight, sunLight.target);
    loading(45, '잔물결과 도시의 반사를 계산하고 있어요');
    river = await createRiver();
    scene.add(river.mesh);
    // PMREM uses the same physical sky as the reflected environment.
    pmrem = new THREE.PMREMGenerator(renderer);
    await timePreset(params.get('time') || 'golden');
    applyQuality(state.quality);
    $('reduce-motion').checked = state.reducedMotion;
    if (params.has('progress')) state.elapsed = Number(params.get('progress')) * DURATION;
    setView(params.get('view') || 'city');
    state.yaw = state.targetYaw;
    state.pitch = state.targetPitch;
    const point = routePoint(progressAt(state.elapsed));
    camera.position.set(point.x + 11, 4.85, point.z);
    camera.lookAt(point.x + Math.cos(state.yaw) * 100, 7, point.z + Math.sin(state.yaw) * 100);
    loading(72, '마지막으로 한강의 빛을 맞추고 있어요');
    await renderer.compileAsync(scene, camera);
    animate(0);
    if (renderer.backend.isWebGPUBackend) await renderer.backend.device.queue.onSubmittedWorkDone();
    loading(100, '당신의 자리가 준비되었어요');
    stats.loadMs = performance.now() - start;
    state.ready = true;
    $('start').disabled = false;
    $('start').querySelector('span').textContent = '항해 시작하기';
    $('play').disabled = false;
    $('loading').classList.add('done');
    $('loading').setAttribute('aria-hidden', 'true');
    $('render-status').innerHTML = `실시간 3D 풍경 <span>·</span> ${state.backend}`;
    $('capability').textContent =
      `${state.backend} 렌더링 사용 중. ${forceWebGL ? 'WebGPU를 사용할 수 없어 WebGL2로 실행합니다. ' : ''}화질을 낮추면 해상도와 수면 반사 비용이 줄어듭니다. 실제 성능은 기기에 따라 달라집니다.`;
    if (params.get('ui') === '0') document.body.classList.add('hide-ui');
    if (params.has('progress')) {
      state.started = true;
      document.body.classList.add('started');
      $('intro').classList.add('departed');
    }
    renderer.setAnimationLoop(animate);
    updateHUD();
  } catch (e) {
    console.error(e);
    state.errors.push(String(e));
    error(
      e.name === 'AssetLoadError'
        ? e.message
        : '3D 풍경을 시작하지 못했어요. 최신 Chrome 또는 Edge에서 하드웨어 가속을 켜고 다시 시도해 주세요.',
    );
  }
}
// UI bindings remain usable while preparing the renderer.
$('start').onclick = togglePlayback;
$('play').onclick = togglePlayback;
$('retry').onclick = () => location.reload();
for (const name of ['route', 'landmark', 'settings'])
  $(name + '-open').onclick = () => $(name + '-dialog').showModal();
document
  .querySelectorAll('.dialog-close')
  .forEach((b) => (b.onclick = () => b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        d.close();
    }
  }),
);
document.querySelectorAll('[data-time]').forEach(
  (b) =>
    (b.onclick = () =>
      timePreset(b.dataset.time).catch((e) => {
        console.error(e);
        toast('시간대 전환 중 오류가 발생했어요. 다시 시도해 주세요.');
      })),
);
document
  .querySelectorAll('[data-view]')
  .forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$('look-city').onclick = () => {
  setView('city');
  $('landmark-dialog').close();
};
$('quality').onchange = (e) => applyQuality(e.target.value);
$('reduce-motion').onchange = (e) => {
  state.reducedMotion = e.target.checked;
  save();
};
$('volume').oninput = (e) => audio.setVolume(Number(e.target.value) / 100);
$('sound').onclick = async () => {
  try {
    const enabled = await audio.toggle();
    $('sound').innerHTML = icon(enabled ? 'volume' : 'volume-off');
    $('sound').setAttribute('aria-pressed', String(enabled));
    $('sound').setAttribute('aria-label', enabled ? '주변 소리 끄기' : '주변 소리 켜기');
    toast(enabled ? '한강의 소리를 켰어요' : '주변 소리를 껐어요');
  } catch (e) {
    toast(e.message);
  }
};
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('app').requestFullscreen();
  } catch {
    toast('이 브라우저에서는 전체 화면을 사용할 수 없어요.');
  }
};
$('reset').onclick = () => {
  resetJourney();
  $('settings-dialog').close();
};
let pointer = null;
$('scene').addEventListener('pointerdown', (e) => {
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  $('scene').setPointerCapture(e.pointerId);
  $('scene').focus({ preventScroll: true });
  $('look-hint').style.opacity = 0;
});
$('scene').addEventListener('pointermove', (e) => {
  if (!pointer || pointer.id !== e.pointerId) return;
  state.targetYaw -= (e.clientX - pointer.x) * 0.003;
  state.targetPitch = THREE.MathUtils.clamp(
    state.targetPitch + (e.clientY - pointer.y) * 0.002,
    -0.65,
    0.75,
  );
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
const stopPointer = () => (pointer = null);
$('scene').addEventListener('pointerup', stopPointer);
$('scene').addEventListener('pointercancel', stopPointer);
window.addEventListener('keydown', (e) => {
  if (
    document.querySelector('dialog[open]') ||
    ['INPUT', 'SELECT', 'BUTTON', 'A'].includes(document.activeElement?.tagName)
  )
    return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayback();
  }
  const offsets = {
    ArrowLeft: [-0.12, 0],
    ArrowRight: [0.12, 0],
    ArrowUp: [0, 0.06],
    ArrowDown: [0, -0.06],
  };
  if (offsets[e.key]) {
    e.preventDefault();
    state.targetYaw += offsets[e.key][0];
    state.targetPitch = THREE.MathUtils.clamp(state.targetPitch + offsets[e.key][1], -0.65, 1.25);
  }
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer?.setSize(innerWidth, innerHeight);
});
document.addEventListener('visibilitychange', () => {
  if (!state.ready) return;
  if (document.hidden) {
    state.playing = false;
    updateHUD();
    renderer.setAnimationLoop(null);
  } else {
    previous = 0;
    renderer.setAnimationLoop(animate);
  }
});
window.addEventListener('unhandledrejection', (e) => state.errors.push(String(e.reason)));
init();
