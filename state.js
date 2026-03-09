import { AppState } from './config.js';
import { DATA_VERSION } from './registry.js';

const META_STORAGE_KEY = 'dcc_meta';
const DATA_VERSION_KEY = 'dcc_data_version';

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
  // Проверяем версию данных
  const savedVersion = localStorage.getItem(DATA_VERSION_KEY);
  const currentVersion = String(DATA_VERSION);
  
  if (savedVersion !== currentVersion) {
    console.log(`Data version changed: ${savedVersion} -> ${currentVersion}. Clearing cache...`);
    // Очищаем все данные кроме мета-прогресса
    localStorage.removeItem('levelOrder');
    localStorage.removeItem('levelVisibility');
    localStorage.setItem(DATA_VERSION_KEY, currentVersion);
  }
  
  const savedMeta = localStorage.getItem(META_STORAGE_KEY);
  if (savedMeta) {
    gameState.metaState = JSON.parse(savedMeta);
  }
}

export function saveMetaState() {
  localStorage.setItem(META_STORAGE_KEY, JSON.stringify(gameState.metaState));
}