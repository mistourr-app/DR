import { AppState } from './config.js';

const META_STORAGE_KEY = 'dcc_meta';

// Состояние всего приложения
const gameState = {
  appState: AppState.BOOT,
  
  // Состояние текущего забега (очищается между забегами)
  runState: null,

  // Состояние мета-прогрессии (сохраняется)
  metaState: {
    currency: 0,
    upgrades: {},
  },
};

export function getGameState() {
  return gameState;
}

export function setAppState(newState, onStateChangeCallback = () => {}) {
  const oldState = gameState.appState;
  if (oldState === newState) return;

  console.log(`State changed: ${oldState} -> ${newState}`);
  gameState.appState = newState;
  onStateChangeCallback(newState, oldState);
}

export function loadMetaState() {
  const savedMeta = localStorage.getItem(META_STORAGE_KEY);
  if (savedMeta) {
    gameState.metaState = JSON.parse(savedMeta);
  }
}

export function saveMetaState() {
  localStorage.setItem(META_STORAGE_KEY, JSON.stringify(gameState.metaState));
}