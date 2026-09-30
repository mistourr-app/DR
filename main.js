import { AppState, DIMS } from './config.js';
import { getLevelById, CAMPAIGN_LEVELS } from './registry.js';
import { getGameState, setAppState, loadMetaState, addGold, setCurrentLevel } from './state.js';
import { showLevelSelectScreen, hideAllScreens, showGameOverScreen, showVictoryScreen, showUpgradeScreen, renderUi, renderTopBar, resetTopBar, updateGoldCounter } from './ui.js';
import { startRun, processPlayerAction, initRun, getDeathType, resizeRunVisuals } from './run.js';
import { initRenderer, renderRun } from './renderer.js';
import { updateAnimations, isAnimating, clearAnimations } from './animation.js';
import { isClickAllowed, stopTutorial } from './tutorial.js';
import { loadAssets } from './assets/loader.js';

const canvas = document.getElementById('gameCanvas');
if (!canvas) {
  throw new Error('FATAL: Canvas element with id "gameCanvas" not found!');
}
const ctx = canvas.getContext('2d');

let lastTime = 0;

function resize() {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const previousCellSize = getGameState().runState?.visualCellSize || DIMS.CELL_SIZE;

  const availableHeight = screenH - DIMS.TOP_UI_H - DIMS.BOTTOM_UI_H;
  const size = Math.max(1, Math.floor(Math.min(screenW / DIMS.COLS, availableHeight / (DIMS.VISIBLE_ROWS + 1))));
  
  DIMS.CELL_SIZE = size;
  DIMS.CANVAS_WIDTH = DIMS.COLS * DIMS.CELL_SIZE;
  DIMS.CANVAS_HEIGHT = (DIMS.VISIBLE_ROWS + 1) * DIMS.CELL_SIZE;

  const dpr = Math.min(Math.max(Number(window.devicePixelRatio) || 1, 1), 3);
  canvas.width = Math.max(1, Math.round(DIMS.CANVAS_WIDTH * dpr));
  canvas.height = Math.max(1, Math.round(DIMS.CANVAS_HEIGHT * dpr));
  canvas.style.width = `${DIMS.CANVAS_WIDTH}px`;
  canvas.style.height = `${DIMS.CANVAS_HEIGHT}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  resizeRunVisuals(previousCellSize);

  document.getElementById('top-ui-bar').style.height = `${DIMS.TOP_UI_H}px`;
  document.getElementById('bottom-ui-bar').style.height = `${DIMS.BOTTOM_UI_H}px`;
}

/**
 * Commits the gold of a finished run exactly once.
 * @returns {number} The amount that was banked.
 */
function commitRunGold() {
  const { runState } = getGameState();
  if (!runState || runState.goldCommitted) return 0;

  const goldCollected = runState.goldCollected || 0;
  if (goldCollected > 0) addGold(goldCollected);
  runState.goldCommitted = true;
  return goldCollected;
}

// Drops the deep link parameters so a restart cannot replay a pinned seed.
function clearRunUrl() {
  const url = new URL(window.location);
  url.searchParams.delete('seed');
  url.searchParams.delete('level');
  window.history.pushState({}, '', url);
}

function goToMenu() {
  clearAnimations();
  stopTutorial();
  clearRunUrl();
  setAppState(AppState.META_HUB, onStateChange);
}

// The dungeon id that follows the one just finished, or null at the end of the
// campaign and for levels that are not part of it.
function nextCampaignLevelId() {
  const { runState, metaState } = getGameState();
  const finished = getLevelById(runState?.levelId);
  if (!finished || !Number.isInteger(finished.difficulty)) return null;

  const next = finished.difficulty + 1;
  if (next > CAMPAIGN_LEVELS.length) return null;

  return `dungeon_${String(next).padStart(2, '0')}`;
}

/**
 * Called whenever the application state changes.
 * Responsible for setting up the UI for the new state.
 */
function onStateChange(newState, oldState) {
  hideAllScreens();
  resetTopBar();

  switch (newState) {
    case AppState.META_HUB:
      showLevelSelectScreen((levelId) => {
        if (startRun(levelId)) {
          resetTopBar();
          setAppState(AppState.RUN_PLAYING, onStateChange);
        }
      });
      break;

    case AppState.UPGRADE: {
      const nextLevelId = nextCampaignLevelId();
      showUpgradeScreen(() => {
        if (nextLevelId && startRun(nextLevelId)) {
          setAppState(AppState.RUN_PLAYING, onStateChange);
        } else {
          goToMenu();
        }
      }, nextLevelId ? 'ENTER DUNGEON' : 'BACK TO DUNGEON SELECT');
      break;
    }

    case AppState.RUN_SUMMARY: {
      const { runState } = getGameState();
      const lastRunLevelId = runState?.levelId;
      const level = getLevelById(lastRunLevelId);
      const levelName = level?.name || 'DUNGEON';
      const isTutorial = level?.isTutorial === true;
      commitRunGold();

      // The tutorial teaches the base kit, so it never leads into the upgrade
      // screen; it drops straight back into the level select.
      const goUpgrades = () => {
        if (isTutorial) goToMenu();
        else setAppState(AppState.UPGRADE, onStateChange);
      };

      showGameOverScreen(
        () => { // onRestart
          if (lastRunLevelId && startRun(lastRunLevelId)) {
            setAppState(AppState.RUN_PLAYING, onStateChange);
          }
        },
        goUpgrades,
        goToMenu,
        levelName,
        getDeathType(),
      );
      break;
    }

    case AppState.RUN_VICTORY: {
      const { runState } = getGameState();
      const levelId = runState?.levelId;
      const level = getLevelById(levelId);
      const levelName = level?.name || 'DUNGEON';
      const goldEarned = commitRunGold();

      // Clearing a campaign dungeon opens the next one.
      if (Number.isInteger(level?.difficulty)) {
        setCurrentLevel(level.difficulty + 1);
      }

      // The tutorial goes straight back to the level select.
      if (level?.isTutorial) {
        goToMenu();
        break;
      }

      showVictoryScreen(
        () => setAppState(AppState.UPGRADE, onStateChange),
        levelName,
        goldEarned,
      );
      break;
    }
  }
}

function update(deltaTime) {
  const state = getGameState();

  updateAnimations(deltaTime);

  switch (state.appState) {
    case AppState.RUN_PLAYING:
  // Run logic itself (movement, combat)
  // updateRun() will be called from here soon
      break;
  }
}

function render(deltaTime = 1000 / 60) {
  const state = getGameState();
  
  // Refresh the gold counter on every frame
  updateGoldCounter();
  
  // Do not render the canvas in the menu to save resources
  if (state.appState === AppState.META_HUB) {
    // Fill with black
    ctx.fillStyle = '#090a0c';
    ctx.fillRect(0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);
    return;
  }
  
  ctx.clearRect(0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);

  switch (state.appState) {
    case AppState.RUN_PLAYING:
      renderTopBar(state.runState, goToMenu);
      renderRun(deltaTime);
      renderUi(state.runState);
      break;
    case AppState.RUN_SUMMARY:
      if (state.runState) {
        renderRun(deltaTime);
      }
      break;
    case AppState.RUN_VICTORY:
      renderRun(deltaTime);
  }
}

function handleCanvasClick(event) {
  const state = getGameState();
  if (state.appState !== AppState.RUN_PLAYING || isAnimating()) return;

  const rect = canvas.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;

  const gx = Math.floor(canvasX / DIMS.CELL_SIZE);

  const worldY = state.runState.scrollY + DIMS.CANVAS_HEIGHT - canvasY;
  const regularCellHeight = DIMS.CELL_SIZE;
  const tallCellHeight = DIMS.CELL_SIZE * 2;
  const arenaStartRow = state.runState.totalRows - 2;
  const dungeonHeight = arenaStartRow * regularCellHeight;

  let gy;
  if (worldY < dungeonHeight) {
    gy = Math.floor(worldY / regularCellHeight);
  } else {
    gy = arenaStartRow + Math.floor((worldY - dungeonHeight) / tallCellHeight);
  }

  if (!isClickAllowed(gx, gy)) return;
  processPlayerAction(gx, gy);
}

function gameLoop(time = 0) {
  const deltaTime = time - lastTime;
  lastTime = time;
  update(deltaTime);
  render(deltaTime);
  requestAnimationFrame(gameLoop);
}

  // Boot the game
document.body.style.margin = '0';
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
canvas.addEventListener('click', handleCanvasClick);
initRenderer(ctx);
  initRun(onStateChange); // Hand the callback to run.js so it can call showGameOverScreen/showVictoryScreen

loadMetaState();
loadAssets({ onError: (error) => console.warn('Graphics assets unavailable; using procedural fallback', error) });
const requestedLevelId = new URLSearchParams(window.location.search).get('level');
if (requestedLevelId && getLevelById(requestedLevelId) && startRun(requestedLevelId)) {
  resetTopBar();
  setAppState(AppState.RUN_PLAYING, onStateChange);
} else {
  setAppState(AppState.META_HUB, onStateChange);
}
gameLoop();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn('Service worker registration failed', error);
      });
  });
}