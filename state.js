import { AppState } from './config.js';
import { DATA_VERSION, UPGRADE_DEFS, CAMPAIGN_LEVELS, getUpgradeDef, upgradeCost } from './registry.js';

const META_STORAGE_KEY = 'dcc_meta';
const DATA_VERSION_KEY = 'dcc_data_version';
const LEVEL_ORDER_KEY = 'levelOrder';
const LEVEL_VISIBILITY_KEY = 'levelVisibility';

const TOTAL_DUNGEONS = CAMPAIGN_LEVELS.length;

const gameState = {
  appState: AppState.BOOT,
  runState: null,
  metaState: {
    gold: 0,
    upgrades: {},
    progress: {
      current: 1,
      allUnlocked: false,
    },
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

// Upgrades are a flat map of key -> purchased level. Anything that is not a
// known key or a sane non negative integer is dropped, so a hand edited or
// corrupted save cannot inject stats or prototype keys into the game.
function normalizeUpgrades(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const upgrades = {};
  for (const key of Object.keys(UPGRADE_DEFS)) {
    // Skip inherited and prototype-polluting keys explicitly.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

    const raw = value[key];
    if (raw === undefined || raw === null) continue;

    const level = Number(raw);
    if (!Number.isFinite(level) || level < 0) continue;

    upgrades[key] = Math.floor(level);
  }

  return upgrades;
}

function normalizeProgress(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const current = Number(source.current);

  return {
    current: Number.isInteger(current) && current >= 1 && current <= TOTAL_DUNGEONS
      ? current
      : 1,
    // Cheat flag for testing, never granted by normal play.
    allUnlocked: source.allUnlocked === true,
  };
}

function normalizeMetaState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const gold = Number(source.gold);

  return {
    gold: Number.isFinite(gold) && gold >= 0 ? gold : 0,
    upgrades: normalizeUpgrades(source.upgrades),
    progress: normalizeProgress(source.progress),
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

// Spends gold on one more level of an upgrade. Returns true when the purchase
// went through; rejects unknown tracks and unaffordable prices.
export function buyUpgrade(upgradeKey) {
  // hasOwnProperty lookup: `constructor` and friends must not resolve to a def.
  if (!getUpgradeDef(upgradeKey)) return false;

  const currentLevel = gameState.metaState.upgrades[upgradeKey] || 0;
  const cost = upgradeCost(upgradeKey, currentLevel);
  if (cost === null || !Number.isFinite(cost)) return false;
  if (gameState.metaState.gold < cost) return false;

  gameState.metaState.gold -= cost;
  gameState.metaState.upgrades[upgradeKey] = currentLevel + 1;
  saveMetaState();
  return true;
}

export function getUpgradeLevel(upgradeKey) {
  if (!getUpgradeDef(upgradeKey)) return 0;
  return gameState.metaState.upgrades[upgradeKey] || 0;
}

export function getProgress() {
  return gameState.metaState.progress;
}

export function setCurrentLevel(level) {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 1) return false;

  // Progress never rewinds and never runs past the campaign. Clamping here
  // rather than relying on the save normaliser keeps memory and storage in sync.
  const clamped = Math.min(value, TOTAL_DUNGEONS);
  gameState.metaState.progress.current = Math.max(gameState.metaState.progress.current, clamped);
  saveMetaState();
  return true;
}

// Testing cheat. Lets every dungeon be picked regardless of progress.
export function setAllLevelsUnlocked(enabled) {
  gameState.metaState.progress.allUnlocked = enabled === true;
  saveMetaState();
  return gameState.metaState.progress.allUnlocked;
}

// Wipes the build and the campaign position, but keeps the gold bank so a
// designer can re-test the first screens without grinding again. Used by the
// admin panel.
export function resetBuildAndCampaign() {
  gameState.metaState.upgrades = {};
  gameState.metaState.progress = { current: 1, allUnlocked: false };
  saveMetaState();
}

// Full fresh start: gold, upgrades and campaign position all back to their
// initial values, so only the first dungeon is reachable and the player stats
// are the untouched base kit from balance.csv.
//
// Deliberately leaves levelOrder and levelVisibility alone: those are the
// admin's own layout and QA settings, not player progress, and wiping them
// would un-hide dev dungeons as a side effect.
export function resetAllProgress() {
  gameState.metaState.gold = 0;
  gameState.metaState.upgrades = {};
  gameState.metaState.progress = { current: 1, allUnlocked: false };
  saveMetaState();
}
