const paths = {
  'arrow-up-right': 'M6 18 18 6M6 6h12v12',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  sun: 'M12 3V1m0 22v-2M3 12H1m22 0h-2M5.5 5.5  -0-0m0 0L4 4m16 16-1.5-1.5M4 20l1.5-1.5M20 4l-1.5 1.5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  sunset: 'M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v4M4 9l3 3m13-3-3 3M9 6l3-3 3 3',
  moon: 'M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z',
  waves: 'M2 7q2.5-3 5 0t5 0 5 0 5 0M2 12q2.5-3 5 0t5 0 5 0 5 0M2 17q2.5-3 5 0t5 0 5 0 5 0',
  navigation: 'm12 3 8 18-8-4-8 4Z',
  building: 'M4 21V6h7v15m0-18h9v18M2 21h20M7 9v1m0 4v1m7-9v1m3-1v1m-3 3v1m3-1v1m-3 3v1m3-1v1',
  anchor: 'M12 9v12M5 13H2a10 10 0 0 0 20 0h-3M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  'volume-off': 'M11 5 6 9H3v6h3l5 4ZM16 9l6 6m-6 0 6-6',
  volume: 'M11 5 6 9H3v6h3l5 4ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',
  mouse: 'M12 8V4m-6 6V8a6 6 0 0 1 12 0v8a6 6 0 0 1-12 0v-6Z',
  play: 'm9 5 11 7-11 7Z',
  pause: 'M8 5v14m8-14v14',
  ship: 'M12 3v11M7 6h9v6M3 13l9-3 9 3-3 7H6ZM2 22q2-2 4 0t4 0 4 0 4 0 4 0',
  map: 'm9 4 6 3 6-3v16l-6 3-6-3-6 3V7Zm0 0v16m6-13v16',
  sliders: 'M4 3v5m0 4v9M12 3v9m0 4v5M20 3v2m0 4v12M1 8h6m2 8h6m2-11h6',
  x: 'm6 6 12 12M6 18 18 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  rotate: 'M3 9a9 9 0 1 1 0 6M3 3v6h6',
};
paths.sun =
  'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0';
export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.waves}"/></svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
}
