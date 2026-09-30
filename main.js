import { AppState, DIMS } from './config.js';
import { getLevelById } from './registry.js';
import { getGameState, setAppState, loadMetaState, addGold } from './state.js';
import { showLevelSelectScreen, hideAllScreens, showGameOverScreen, showVictoryScreen, renderUi, renderTopBar, resetTopBar, updateGoldCounter } from './ui.js';
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
    case AppState.RUN_SUMMARY: {
      const state = getGameState();
      const lastRunLevelId = state.runState?.levelId;
      const goldCollected = state.runState?.goldCollected || 0;

      // Persist gold on death
      if (goldCollected > 0) {
        addGold(goldCollected);
      }
      if (state.runState) state.runState.goldCommitted = true;

      const deathType = getDeathType();
      showGameOverScreen(
        () => { // onRestart
          if (lastRunLevelId && startRun(lastRunLevelId)) {
            setAppState(AppState.RUN_PLAYING, onStateChange);
          }
        },
        () => { // onGoToMenu
          clearAnimations();
          stopTutorial();
         const url = new URL(window.location);
         url.searchParams.delete('seed');
         url.searchParams.delete('level');
         window.history.pushState({}, '', url);
          setAppState(AppState.META_HUB, onStateChange);
        },
        deathType
      );
      break;
    }
    case AppState.RUN_VICTORY: {
      const state = getGameState();
      const goldCollected = state.runState?.goldCollected || 0;

      // Persist gold on victory
      if (goldCollected > 0) {
        addGold(goldCollected);
      }
      if (state.runState) state.runState.goldCommitted = true;

      showVictoryScreen(() => { // onGoToMenu
        clearAnimations();
        stopTutorial();
        const url = new URL(window.location);
        url.searchParams.delete('seed');
        url.searchParams.delete('level');
        window.history.pushState({}, '', url);
        setAppState(AppState.META_HUB, onStateChange);
      });
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
      renderTopBar(state.runState, () => {
        clearAnimations();
        // Stop the tutorial when returning to the menu
        stopTutorial();
        const url = new URL(window.location);
        url.searchParams.delete('seed');
           url.searchParams.delete('level');
        window.history.pushState({}, '', url);
        setAppState(AppState.META_HUB, onStateChange);
      });
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