import { AppState, DIMS } from './config.js';
import { getGameState, setAppState, loadMetaState } from './state.js';
import { showLevelSelectScreen, hideAllScreens, showGameOverScreen, showVictoryScreen, renderUi, renderTopBar, resetTopBar } from './ui.js';
import { startRun, processPlayerAction, initRun } from './run.js';
import { initRenderer, renderRun } from './renderer.js';
import { updateAnimations, isAnimating } from './animation.js';

const canvas = document.getElementById('gameCanvas');
if (!canvas) {
  throw new Error('FATAL: Canvas element with id "gameCanvas" not found!');
}
const ctx = canvas.getContext('2d');

let lastTime = 0;
let dpr = 1;

function resize() {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  dpr = window.devicePixelRatio || 1;

  const availableHeight = screenH - DIMS.TOP_UI_H - DIMS.BOTTOM_UI_H;
  const size = Math.floor(Math.min(screenW / DIMS.COLS, availableHeight / (DIMS.VISIBLE_ROWS + 1)));
  
  DIMS.CELL_SIZE = size;
  DIMS.CANVAS_WIDTH = DIMS.COLS * DIMS.CELL_SIZE;
  DIMS.CANVAS_HEIGHT = (DIMS.VISIBLE_ROWS + 1) * DIMS.CELL_SIZE;

  canvas.width = DIMS.CANVAS_WIDTH * dpr;
  canvas.height = DIMS.CANVAS_HEIGHT * dpr;
  canvas.style.width = `${DIMS.CANVAS_WIDTH}px`;
  canvas.style.height = `${DIMS.CANVAS_HEIGHT}px`;

  document.getElementById('top-ui-bar').style.height = `${DIMS.TOP_UI_H}px`;
  document.getElementById('bottom-ui-bar').style.height = `${DIMS.BOTTOM_UI_H}px`;
}

/**
 * Функция, которая вызывается при смене состояния приложения.
 * Отвечает за настройку UI для нового состояния.
 */
function onStateChange(newState, oldState) {
  hideAllScreens();

  switch (newState) {
    case AppState.META_HUB:
      showLevelSelectScreen((levelId) => {
        startRun(levelId);
        resetTopBar();
        setAppState(AppState.RUN_PLAYING, onStateChange);
      });
      break;
    case AppState.RUN_SUMMARY: {
      const lastRunLevelId = getGameState().runState?.levelId;
      showGameOverScreen(
        () => { // onRestart
          if (lastRunLevelId) {
            startRun(lastRunLevelId);
            setAppState(AppState.RUN_PLAYING, onStateChange);
          }
        },
        () => { // onGoToMenu
          const url = new URL(window.location);
          url.searchParams.delete('seed');
          window.history.pushState({}, '', url);
          setAppState(AppState.META_HUB, onStateChange);
        }
      );
      break;
    }
    case AppState.RUN_VICTORY: {
      showVictoryScreen(() => { // onGoToMenu
        const url = new URL(window.location);
        url.searchParams.delete('seed');
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
      // Логика самого забега (движение, бой)
      // Здесь мы скоро будем вызывать updateRun()
      break;
  }
}

function render() {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);

  const state = getGameState();
  switch (state.appState) {
    case AppState.RUN_PLAYING:
      renderTopBar(state.runState, () => {
        const url = new URL(window.location);
        url.searchParams.delete('seed');
        window.history.pushState({}, '', url);
        setAppState(AppState.META_HUB, onStateChange);
      });
      renderRun();
      renderUi(state.runState);
      break;
    case AppState.RUN_SUMMARY:
      if (state.runState) {
        renderRun();
      }
      break;
    case AppState.RUN_VICTORY:
      renderRun();
  }
  ctx.restore();
}

function handleCanvasClick(event) {
  const state = getGameState();
  if (state.appState !== AppState.RUN_PLAYING || isAnimating()) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = DIMS.CANVAS_WIDTH / rect.width;
  const scaleY = DIMS.CANVAS_HEIGHT / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;

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

  processPlayerAction(gx, gy);
}

function gameLoop(time = 0) {
  const deltaTime = time - lastTime;
  lastTime = time;
  update(deltaTime);
  render();
  requestAnimationFrame(gameLoop);
}

// Запуск игры
document.body.style.margin = '0';
resize();
window.addEventListener('resize', resize);
canvas.addEventListener('click', handleCanvasClick);
initRenderer(ctx);
initRun(onStateChange); // Передаём callback в run.js для вызова showGameOverScreen/showVictoryScreen

loadMetaState();
setAppState(AppState.META_HUB, onStateChange);
gameLoop();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(registration => {
        console.log('ServiceWorker registered:', registration.scope);
      }).catch(err => {
        console.error('ServiceWorker registration failed:', err);
      });
  });
}