import { getGameState } from './state.js';

const animationQueue = [];

// Простая функция линейной интерполяции (lerp)
function lerp(start, end, t) {
  return start * (1 - t) + end * t;
}

/**
 * Запускает анимацию. Одновременно может проигрываться только одна анимация.
 * @param {object} animationConfig - Конфигурация анимации.
 * @param {object} animationConfig.target - Объект для анимации (например, player).
 * @param {object} animationConfig.props - Целевые значения свойств (например, { 'visual.x': 100 }).
 * @param {number} animationConfig.duration - Длительность в мс.
 * @param {function} [animationConfig.onComplete] - Колбэк по завершении.
 */
export function play(animationConfig) {
  const { target, props, duration, onComplete } = animationConfig;

  const newAnimation = {
    target,
    duration,
    onComplete,
    elapsed: 0,
    props: Object.keys(props).map(key => {
      // Поддержка вложенных свойств типа 'visual.x'
      const keys = key.split('.');
      let startValue = target;
      for (const k of keys) {
        startValue = startValue[k];
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

/**
 * Обновляет текущую анимацию. Должна вызываться каждый кадр.
 * @param {number} deltaTime - Время, прошедшее с прошлого кадра (в мс).
 */
export function updateAnimations(deltaTime) {
  // Обновляем всплывающие тексты всегда
  updateFloatingTexts();
  
  if (animationQueue.length === 0) return;

  const current = animationQueue[0];

  current.elapsed += deltaTime;
  const progress = Math.min(current.elapsed / current.duration, 1);

  // Обновляем каждое анимируемое свойство
  current.props.forEach(prop => {
    const value = lerp(prop.start, prop.end, progress);
    let obj = current.target;
    for (let i = 0; i < prop.keys.length - 1; i++) {
      obj = obj[prop.keys[i]];
    }
    obj[prop.keys[prop.keys.length - 1]] = value;
  });

  // Если анимация завершена
  if (progress >= 1) {
    const callback = current.onComplete;
    animationQueue.shift(); // Удаляем завершенную анимацию из начала очереди
    callback?.();
  }
}

/**
 * @returns {boolean} - Возвращает true, если в данный момент проигрывается анимация.
 */
export function isAnimating() {
  return animationQueue.length > 0;
}

/**
 * Обновляет всплывающие тексты (движение вверх и затухание).
 */
function updateFloatingTexts() {
  const state = getGameState();
  if (!state.runState?.floatingTexts) return;
  
  const { floatingTexts } = state.runState;
  
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    
    ft.visual.y += 0.5;
    ft.visual.alpha -= 0.02;

    if (ft.visual.alpha <= 0) {
      floatingTexts.splice(i, 1);
    }
  }
}