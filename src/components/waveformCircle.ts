export const FULL_CIRCLE = Math.PI * 2;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function toPolarPoint(radius: number, theta: number, center: number) {
  return {
    x: center + radius * Math.cos(theta - Math.PI / 2),
    y: center + radius * Math.sin(theta - Math.PI / 2),
  };
}

export function triangleWave(phase: number) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

export function wrappedAngularDistance(left: number, right: number) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

export function buildCircularPath(size: number, radii: number[]) {
  const center = size / 2;
  const segmentTotal = radii.length;
  const commands = new Array<string>(segmentTotal + 1);

  for (let i = 0; i <= segmentTotal; i += 1) {
    const index = i % segmentTotal;
    const theta = (index / segmentTotal) * FULL_CIRCLE;
    const point = toPolarPoint(radii[index], theta, center);
    commands[i] = `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return `${commands.join(' ')} Z`;
}

export function getBaseRadius(size: number, strokeWidth: number, intensity: number, mode: 'playback' | 'record') {
  const center = size / 2;
  const safeOuterRadius = center - strokeWidth * 0.5 - 0.5;
  const effectiveIntensity = mode === 'record' ? 1 : intensity;
  const maxAmplitude = 16 * clamp(effectiveIntensity, 0.4, 4);
  return {
    baseRadius: clamp(safeOuterRadius - maxAmplitude - 1, strokeWidth + 3, safeOuterRadius),
    safeOuterRadius,
  };
}
