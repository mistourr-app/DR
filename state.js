import { AppState } from './config.js';
import { DATA_VERSION } from './registry.js';

const META_STORAGE_KEY = 'dcc_meta';
const DATA_VERSION_KEY = 'dcc_data_version';
const LEVEL_ORDER_KEY = 'levelOrder';
const LEVEL_VISIBILITY_KEY = 'levelVisibility';

const gameState = {
  appState: AppState.BOOT,
  runState: null,
  metaState: {
    gold: 0,
    upgrades: {},
  },
};

let nextRunId = 0;

export function getGameState() {
  return gameState;
}

export function createRunId() {
  nextRunId += 1;
  return nextRunId;
}

export function isRunActive(runId) {
  return Boolean(runId && gameState.runState?.runId === runId);
}

export function setAppState(newState, onStateChangeCallback = () => {}) {
  const oldState = gameState.appState;
  if (oldState === newState) return;

  console.log(`State changed: ${oldState} -> ${newState}`);
  
  if (newState === AppState.META_HUB) {
    gameState.runState = null;
  }
  
  gameState.appState = newState;
  onStateChangeCallback(newState, oldState);
}

function getStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeMetaState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const gold = Number(source.gold);
  return {
    gold: Number.isFinite(gold) && gold >= 0 ? gold : 0,
    upgrades: source.upgrades && typeof source.upgrades === 'object' && !Array.isArray(source.upgrades)
      ? source.upgrades
      : {},
  };
}

export function loadMetaState() {
  const storage = getStorage();
  if (!storage) return;

  try {
    const savedVersion = storage.getItem(DATA_VERSION_KEY);
    const currentVersion = String(DATA_VERSION);
  
    if (savedVersion !== currentVersion) {
      console.log(`Data version changed: ${savedVersion} -> ${currentVersion}. Clearing cache...`);
      storage.removeItem(LEVEL_ORDER_KEY);
      storage.removeItem(LEVEL_VISIBILITY_KEY);
      storage.setItem(DATA_VERSION_KEY, currentVersion);
    }
  } catch (error) {
    console.warn('Unable to read saved data version', error);
  }

  try {
    const savedMeta = storage.getItem(META_STORAGE_KEY);
    if (savedMeta) {
      gameState.metaState = normalizeMetaState(JSON.parse(savedMeta));
    } else {
      gameState.metaState = normalizeMetaState(null);
    }
  } catch (error) {
    gameState.metaState = normalizeMetaState(null);
    console.warn('Saved metadata is invalid and was ignored', error);
  }
}

export function saveMetaState() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(META_STORAGE_KEY, JSON.stringify(normalizeMetaState(gameState.metaState)));
  } catch (error) {
    console.warn('Unable to save metadata', error);
  }
}

export function addGold(amount) {
  const value = Number(amount);
  if (Number.isFinite(value) && value > 0) {
    gameState.metaState.gold += value;
    saveMetaState();
  }
}
