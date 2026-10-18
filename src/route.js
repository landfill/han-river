// Local metre coordinates: +X east, +Z south, +Y up. Approximate recreation,
// not navigation data. Source/provenance and uncertainty: docs/GEOGRAPHY.md.
export const DURATION = 480;
export const ROUTE_DISTANCE = 2800;
export const STOPS = [
  {
    id: 'yeouido',
    name: '여의도 선착장',
    at: 0,
    title: '여의도의 황금빛 윤곽',
    description: '강 위에서 조금 멀리 바라보면,\n도시는 하나의 풍경이 됩니다.',
    story:
      '서울의 금융 중심지인 여의도는 한강 위에서 또 다른 얼굴을 보여줍니다. 63빌딩의 금빛 외벽, 파크원의 붉은 구조물, IFC의 유리 실루엣을 천천히 찾아보세요. 해가 낮아지면 건축물의 반사와 물 위의 빛이 함께 바뀝니다.',
  },
  {
    id: 'wonhyo',
    name: '원효대교',
    at: 0.41,
    title: '교각 사이로 흐르는 빛',
    description: '여의도와 용산을 잇는 다리.\n그 아래에서 서울의 빛이 달라집니다.',
    story:
      '원효대교는 여의도와 용산을 연결합니다. 수평으로 길게 이어진 상판과 반복되는 교각이 한강 위에 차분한 리듬을 만듭니다. 교량에 다가갈수록 거대한 구조물과 물결의 크기를 비교해 보세요. 이 앱의 교량 형상과 간격은 관람용으로 단순화했습니다.',
  },
  {
    id: 'railway',
    name: '한강철교',
    at: 1,
    title: '서울의 시간을 잇는 선',
    description: '철제 구조 사이로 이어지는 풍경.\n물길과 철길이 여기서 만납니다.',
    story:
      '한강철교는 용산과 노량진 사이를 연결하는 철도 교량군입니다. 서로 다른 시기에 건설된 다리들이 나란히 한강을 건넙니다. 반복되는 철제 트러스가 만드는 실루엣은 도로 교량과 다른 인상을 줍니다. 이 앱에서는 그 특징을 절차적 모델로 표현했습니다.',
  },
];
export function routePoint(progress) {
  const p = Math.max(0, Math.min(1, progress));
  return {
    x: -1150 + p * 2800,
    z: -90 - 90 * Math.sin(p * Math.PI * 0.65),
    heading: Math.atan2(-90 * Math.PI * 0.65 * Math.cos(p * Math.PI * 0.65), 2800),
  };
}
export function speedFactor(t) {
  return Math.min(1, t / 8, (DURATION - t) / 8);
}
export function nearestStop(progress) {
  return progress < 0.3 ? STOPS[0] : progress < 0.72 ? STOPS[1] : STOPS[2];
}
export function formatTime(t) {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export function progressAt(seconds) {
  // Integral of smoothstep acceleration/deceleration: the 8 s ends each
  // cover 4 nominal seconds, total nominal cruise duration = DURATION - 8.
  const t = Math.max(0, Math.min(DURATION, seconds)),
    ramp = 8;
  const integral = (x) => ramp * (Math.pow(x / ramp, 3) - 0.5 * Math.pow(x / ramp, 4));
  if (t < ramp) return integral(t) / (DURATION - ramp);
  if (t > DURATION - ramp) return 1 - integral(DURATION - t) / (DURATION - ramp);
  return (t - ramp * 0.5) / (DURATION - ramp);
}
