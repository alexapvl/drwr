export interface SpringConfig {
  damping: number;
  stiffness: number;
  mass: number;
  restThreshold: number;
}

export const DEFAULT_SPRING: SpringConfig = {
  damping: 30,
  stiffness: 200,
  mass: 1,
  restThreshold: 0.5,
};

export interface SpringState {
  position: number;
  velocity: number;
}

/**
 * Solve one step of a damped spring using semi-implicit Euler integration.
 * Returns the new position and velocity after `dt` seconds.
 */
export function springStep(
  current: number,
  target: number,
  velocity: number,
  dt: number,
  config: SpringConfig,
): SpringState {
  const { stiffness, damping, mass } = config;
  const displacement = current - target;
  const springForce = -stiffness * displacement;
  const dampingForce = -damping * velocity;
  const acceleration = (springForce + dampingForce) / mass;

  const newVelocity = velocity + acceleration * dt;
  const newPosition = current + newVelocity * dt;

  return { position: newPosition, velocity: newVelocity };
}

/**
 * Returns true when the spring is close enough to rest.
 */
export function isAtRest(
  current: number,
  target: number,
  velocity: number,
  threshold: number = DEFAULT_SPRING.restThreshold,
): boolean {
  return (
    Math.abs(current - target) < threshold && Math.abs(velocity) < threshold
  );
}

/**
 * Runs a spring animation via requestAnimationFrame. Returns a cancel function.
 */
export function animateSpring(
  from: number,
  to: number,
  initialVelocity: number,
  config: Partial<SpringConfig>,
  onUpdate: (value: number) => void,
  onComplete: () => void,
): () => void {
  const cfg = { ...DEFAULT_SPRING, ...config };
  let position = from;
  let velocity = initialVelocity;
  let lastTime = 0;
  let frameId = 0;

  function tick(time: number) {
    if (lastTime === 0) {
      lastTime = time;
      frameId = requestAnimationFrame(tick);
      return;
    }

    // Cap dt to avoid spiral of death on tab-switch resume
    const dt = Math.min((time - lastTime) / 1000, 0.064);
    lastTime = time;

    const state = springStep(position, to, velocity, dt, cfg);
    position = state.position;
    velocity = state.velocity;

    onUpdate(position);

    if (isAtRest(position, to, velocity, cfg.restThreshold)) {
      onUpdate(to);
      onComplete();
      return;
    }

    frameId = requestAnimationFrame(tick);
  }

  frameId = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(frameId);
}

/**
 * Tracks pointer velocity over the last N samples for flick detection.
 */
export class VelocityTracker {
  private samples: { time: number; value: number }[] = [];
  private maxSamples: number;

  constructor(maxSamples = 8) {
    this.maxSamples = maxSamples;
  }

  add(value: number) {
    this.samples.push({ time: performance.now(), value });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /** Returns velocity in units per second. */
  getVelocity(): number {
    if (this.samples.length < 2) return 0;

    const recent = this.samples[this.samples.length - 1];
    // Use sample from ~50ms ago for stability
    let oldest = this.samples[0];
    for (let i = this.samples.length - 2; i >= 0; i--) {
      if (recent.time - this.samples[i].time >= 30) {
        oldest = this.samples[i];
        break;
      }
    }

    const dt = (recent.time - oldest.time) / 1000;
    if (dt === 0) return 0;

    return (recent.value - oldest.value) / dt;
  }

  reset() {
    this.samples = [];
  }
}

/**
 * Given a set of snap points and a release position + velocity,
 * determine which snap point to target.
 */
export function resolveSnapPoint(
  position: number,
  velocity: number,
  snapPoints: number[],
  flickThreshold = 400,
  hardFlickThreshold = 1200,
): number {
  if (snapPoints.length === 0) return position;
  if (snapPoints.length === 1) return snapPoints[0];

  const sorted = [...snapPoints].sort((a, b) => a - b);

  // Hard flick: skip all intermediate snaps, go to the extreme
  if (Math.abs(velocity) > hardFlickThreshold) {
    return velocity > 0 ? sorted[sorted.length - 1] : sorted[0];
  }

  // Normal flick: go to next snap in the flick direction
  if (Math.abs(velocity) > flickThreshold) {
    if (velocity > 0) {
      for (const sp of sorted) {
        if (sp > position + 2) return sp;
      }
      return sorted[sorted.length - 1];
    } else {
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i] < position - 2) return sorted[i];
      }
      return sorted[0];
    }
  }

  // No flick: snap to nearest
  let closest = sorted[0];
  let closestDist = Math.abs(position - sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    const dist = Math.abs(position - sorted[i]);
    if (dist < closestDist) {
      closest = sorted[i];
      closestDist = dist;
    }
  }
  return closest;
}
