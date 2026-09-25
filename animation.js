import { getGameState, isRunActive } from './state.js';

const animationQueue = [];
const runTimers = new Set();

function lerp(start, end, t) {
  return start * (1 - t) + end * t;
}

function belongsToCurrentRun(runId) {
  return runId === null || isRunActive(runId);
}

export function play(animationConfig) {
  const { target, props, duration, onComplete } = animationConfig;
  const runId = getGameState().runState?.runId ?? null;
  const safeDuration = Math.max(1, Number(duration) || 1);

  const newAnimation = {
    target,
    duration: safeDuration,
    onComplete,
    elapsed: 0,
    runId,
    props: Object.keys(props).map(key => {
      const keys = key.split('.');
      let startValue = target;
      for (const nestedKey of keys) {
        startValue = startValue[nestedKey];
      }
      return {
        key,
        keys,
        start: startValue,
        end: props[key],
      };
    }),
  };

  animationQueue.push(newAnimation);
}

export function updateAnimations(deltaTime) {
  const safeDeltaTime = Math.max(0, Number(deltaTime) || 0);
  updateFloatingTexts(safeDeltaTime);
  
  if (animationQueue.length === 0) return;

  const current = animationQueue[0];

  if (!belongsToCurrentRun(current.runId)) {
    animationQueue.shift();
    return;
  }

  current.elapsed += safeDeltaTime;
  const progress = Math.min(current.elapsed / current.duration, 1);

  current.props.forEach(prop => {
    const value = lerp(prop.start, prop.end, progress);
    let target = current.target;
    for (let index = 0; index < prop.keys.length - 1; index++) {
      target = target[prop.keys[index]];
    }
    target[prop.keys[prop.keys.length - 1]] = value;
  });

  if (progress >= 1) {
    const callback = current.onComplete;
    animationQueue.shift();
    if (belongsToCurrentRun(current.runId)) {
      callback?.();
    }
  }
}

export function isAnimating() {
  return animationQueue.length > 0;
}

export function resizeAnimations(scale) {
  const factor = Number(scale);
  if (!Number.isFinite(factor) || factor <= 0) return;

  animationQueue.forEach((animation) => {
    animation.props.forEach((prop) => {
      if (prop.key !== 'visual.x' && prop.key !== 'visual.y' && prop.key !== 'visual.h') return;
      if (Number.isFinite(prop.start)) prop.start *= factor;
      if (Number.isFinite(prop.end)) prop.end *= factor;
    });
  });
}

export function scheduleRunCallback(delayMs, callback) {
  const runId = getGameState().runState?.runId ?? null;
  if (runId === null) return null;

  const handle = setTimeout(() => {
    runTimers.delete(handle);
    if (belongsToCurrentRun(runId)) {
      callback();
    }
  }, Math.max(0, Number(delayMs) || 0));
  runTimers.add(handle);
  return handle;
}

export function clearAnimations() {
  animationQueue.length = 0;
  for (const handle of runTimers) {
    clearTimeout(handle);
  }
  runTimers.clear();
}

function updateFloatingTexts(deltaTime) {
  const state = getGameState();
  if (!state.runState?.floatingTexts) return;
  
  const frameScale = deltaTime / (1000 / 60);
  const { floatingTexts } = state.runState;
  
  for (let index = floatingTexts.length - 1; index >= 0; index--) {
    const floatingText = floatingTexts[index];
    
    floatingText.visual.y += 0.5 * frameScale;
    floatingText.visual.alpha -= 0.02 * frameScale;

    if (floatingText.visual.alpha <= 0) {
      floatingTexts.splice(index, 1);
    }
  }
}
