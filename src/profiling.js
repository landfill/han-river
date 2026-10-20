// Opt-in CPU/frame diagnostics. These timings are not GPU execution times.
export function createProfiler() {
  let active = false,
    previous = 0;
  const frames = [],
    longTasks = [];
  let frame;
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
  ) {
    new PerformanceObserver((list) => {
      if (active)
        for (const entry of list.getEntries()) {
          if (longTasks.length < 2000)
            longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
    }).observe({ type: 'longtask', buffered: false });
  }
  return {
    start() {
      frames.length = 0;
      longTasks.length = 0;
      active = true;
    },
    stop() {
      active = false;
      return { frames: [...frames], longTasks: [...longTasks] };
    },
    begin(intervalMs) {
      if (!active) return;
      previous = performance.now();
      frame = { intervalMs };
    },
    mark(name) {
      if (!active || !frame) return;
      const now = performance.now();
      frame[name] = now - previous;
      previous = now;
    },
    end(drawCalls, triangles) {
      if (!active || !frame) return;
      if (frames.length < 2000) frames.push({ ...frame, drawCalls, triangles });
      frame = null;
    },
  };
}
