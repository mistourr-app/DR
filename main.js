import { AppState, DIMS } from './config.js';
import { getGameState, setAppState, loadMetaState, addGold } from './state.js';
import { showLevelSelectScreen, hideAllScreens, showGameOverScreen, showVictoryScreen, renderUi, renderTopBar, resetTopBar, updateGoldCounter } from './ui.js';
import { startRun, processPlayerAction, initRun, getDeathType } from './run.js';
import { initRenderer, renderRun } from './renderer.js';
import { updateAnimations, isAnimating } from './animation.js';
import { isClickAllowed, stopTutorial } from './tutorial.js';

const canvas = document.getElementById('gameCanvas');
if (!canvas) {
  throw new Error('FATAL: Canvas element with id "gameCanvas" not found!');
}
const ctx = canvas.getContext('2d');

let lastTime = 0;

function resize() {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  const availableHeight = screenH - DIMS.TOP_UI_H - DIMS.BOTTOM_UI_H;
  const size = Math.floor(Math.min(screenW / DIMS.COLS, availableHeight / (DIMS.VISIBLE_ROWS + 1)));
  
  DIMS.CELL_SIZE = size;
  DIMS.CANVAS_WIDTH = DIMS.COLS * DIMS.CELL_SIZE;
  DIMS.CANVAS_HEIGHT = (DIMS.VISIBLE_ROWS + 1) * DIMS.CELL_SIZE;

  canvas.width = DIMS.CANVAS_WIDTH;
  canvas.height = DIMS.CANVAS_HEIGHT;

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
      const state = getGameState();
      const lastRunLevelId = state.runState?.levelId;
      const goldCollected = state.runState?.goldCollected || 0;
      
      // Сохраняем золото при смерти
      if (goldCollected > 0) {
        addGold(goldCollected);
      }
      
      const deathType = getDeathType();
      showGameOverScreen(
        () => { // onRestart
          if (lastRunLevelId) {
            startRun(lastRunLevelId);
            setAppState(AppState.RUN_PLAYING, onStateChange);
          }
        },
        () => { // onGoToMenu
          stopTutorial();
          const url = new URL(window.location);
          url.searchParams.delete('seed');
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
      
      // Сохраняем золото при победе
      if (goldCollected > 0) {
        addGold(goldCollected);
      }
      
      showVictoryScreen(() => { // onGoToMenu
        stopTutorial();
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
  const state = getGameState();
  
  // Обновляем счётчик золота на каждом кадре
  updateGoldCounter();
  
  // Не рендерим canvas в меню для экономии ресурсов
  if (state.appState === AppState.META_HUB) {
    // Заливаем чёрным цветом
    ctx.fillStyle = '#090a0c';
    ctx.fillRect(0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);
    return;
  }
  
  ctx.clearRect(0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);

  switch (state.appState) {
    case AppState.RUN_PLAYING:
      renderTopBar(state.runState, () => {
        // Останавливаем туториал при выходе в меню
        stopTutorial();
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
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let registration of registrations) {
        registration.unregister();
      }
    });
  });
}