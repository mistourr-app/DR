const listeners = {};

export const Events = {
  RUN_STARTED: 'RUN_STARTED',
  RUN_ENDED: 'RUN_ENDED',
  PLAYER_MOVED: 'PLAYER_MOVED',
  PLAYER_ATTACKED: 'PLAYER_ATTACKED',
  ENEMY_KILLED: 'ENEMY_KILLED',
  ENEMY_ATTACKED: 'ENEMY_ATTACKED',
  ITEM_PICKED: 'ITEM_PICKED',
  BOSS_KILLED: 'BOSS_KILLED',
  BOSS_ATTACKED: 'BOSS_ATTACKED',
  PLAYER_DAMAGED: 'PLAYER_DAMAGED',
  PHASE_CHANGED: 'PHASE_CHANGED',
};

export function on(event, callback) {
  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event].push(callback);
}

export function off(event, callback) {
  if (!listeners[event]) return;
  const index = listeners[event].indexOf(callback);
  if (index > -1) {
    listeners[event].splice(index, 1);
  }
}

export function emit(event, data) {
  if (!listeners[event]) return;
  listeners[event].forEach(callback => callback(data));
}

export function clear() {
  Object.keys(listeners).forEach(key => {
    listeners[key] = [];
  });
}
