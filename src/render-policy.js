// Device category controls scope, not a claim about measured GPU speed.
// iPadOS can send a desktop Mac user agent. Narrow desktop windows and touch
// laptops keep the desktop renderer; browser width alone never selects mobile.
export function isMobileBrowser({
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
  userAgentData,
} = {}) {
  return Boolean(
    userAgentData?.mobile ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    /iPhone|iPad|iPod/i.test(platform) ||
    (/Mac/i.test(platform) && maxTouchPoints > 1),
  );
}

export function reflectionScale(quality, mobile) {
  // Desktop retains the actual pre-optimization 0.5 scale at every preset.
  if (!mobile) return 0.5;
  return quality === 'high' ? 0.5 : quality === 'low' ? 0.25 : 0.35;
}

export function riverSegments(quality, mobile) {
  if (!mobile || quality === 'high') return 256;
  return quality === 'low' ? 96 : 128;
}
