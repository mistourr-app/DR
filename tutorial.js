import { getGameState } from './state.js';

let currentStep = 0;
let tutorialActive = false;

export const TUTORIAL_STEPS = [
  {
    text: "Тапни на клетку впереди чтобы двигаться",
    allowedCells: [{x: 2, y: 1}], // Ряд 2 (индекс 1)
    checkComplete: (state) => state.runState.player.pos.y >= 1
  },
  {
    text: "Тапни на клетку по диагонали (прыжок стоит 1 энергию)",
    allowedCells: [{x: 0, y: 2}, {x: 4, y: 2}], // Ряд 3 (индекс 2)
    checkComplete: (state) => state.runState.player.pos.y >= 2 && state.runState.player.energy < 10
  },
  {
    text: "Подбери здоровье",
    allowedCells: [{x: 2, y: 3}], // Ряд 4 (индекс 3)
    checkComplete: (state) => state.runState.player.pos.y >= 3
  },
  {
    text: "Подбери патроны для арбалета",
    allowedCells: [{x: 2, y: 4}], // Ряд 5 (индекс 4)
    checkComplete: (state) => state.runState.player.pos.y >= 4
  },
  {
    text: "Атакуй врага в ближнем бою",
    allowedCells: [{x: 2, y: 5}], // Ряд 6 (индекс 5)
    checkComplete: (state) => state.runState.player.pos.y >= 5
  },
  {
    text: "Двигайся вперед",
    allowedCells: [{x: 2, y: 6}], // Ряд 7 (индекс 6)
    checkComplete: (state) => state.runState.player.pos.y >= 6
  },
  {
    text: "Двигайся вперед на ряд с врагом",
    allowedCells: [{x: 2, y: 7}], // Ряд 8 (индекс 7)
    checkComplete: (state) => state.runState.player.pos.y >= 7
  },
  {
    text: "Выстрели из арбалета во врага слева",
    allowedCells: [{x: 0, y: 7}], // Ряд 8 (индекс 7) - враг слева
    checkComplete: (state) => state.runState.player.inventory.ammo < 3
  },
  {
    text: "Иди вперед. Враг сзади атакует в спину!",
    allowedCells: [{x: 2, y: 8}], // Ряд 9 (индекс 8)
    checkComplete: (state) => state.runState.player.pos.y >= 8
  },
  {
    text: "Подбери бонус атаки",
    allowedCells: [{x: 2, y: 9}], // Ряд 10 (индекс 9)
    checkComplete: (state) => state.runState.player.inventory.attackBonuses.length > 0
  },
  {
    text: "Атакуй врага с бонусом атаки",
    allowedCells: [{x: 2, y: 10}], // Ряд 11 (индекс 10)
    checkComplete: (state) => state.runState.player.pos.y >= 10
  },
  {
    text: "Двигайся вперед в арену босса",
    allowedCells: [{x: 2, y: 11}], // Ряд 12 (индекс 11) - первый ряд арены
    checkComplete: (state) => state.runState.player.pos.y >= 11
  },
  {
    text: "Входим в арену босса! Двигайся горизонтально",
    allowedCells: [{x: 0, y: 11}, {x: 1, y: 11}, {x: 3, y: 11}, {x: 4, y: 11}, {x: 0, y: 12}, {x: 1, y: 12}, {x: 2, y: 12}, {x: 3, y: 12}, {x: 4, y: 12}], // Ряды 12-13 (индексы 11-12)
    checkComplete: (state) => state.runState.player.pos.y >= 12
  },
  {
    text: "Наступи на клетку атаки чтобы ударить босса",
    allowedCells: null, // Динамические клетки атаки
    checkComplete: (state) => state.runState.boss.currentHp < state.runState.boss.hp
  },
  {
    text: "Победи босса!",
    allowedCells: null,
    checkComplete: (state) => state.runState.boss.currentHp <= 0
  }
];

export function startTutorial() {
  tutorialActive = true;
  currentStep = 0;
  console.log('[TUTORIAL] Started, step 0:', TUTORIAL_STEPS[0].text);
}

export function stopTutorial() {
  tutorialActive = false;
  currentStep = 0;
}

export function isTutorialActive() {
  return tutorialActive;
}

export function getCurrentStep() {
  if (!tutorialActive || currentStep >= TUTORIAL_STEPS.length) return null;
  return TUTORIAL_STEPS[currentStep];
}

export function getTutorialAllowedCells() {
  if (!tutorialActive) return null;
  const step = getCurrentStep();
  return step?.allowedCells || null;
}

export function updateTutorial() {
  if (!tutorialActive) return;
  
  const state = getGameState();
  const step = TUTORIAL_STEPS[currentStep];
  
  if (step && step.checkComplete(state)) {
    console.log('[TUTORIAL] Step', currentStep, 'completed:', step.text);
    currentStep++;
    if (currentStep >= TUTORIAL_STEPS.length) {
      console.log('[TUTORIAL] All steps completed!');
      stopTutorial();
    } else {
      console.log('[TUTORIAL] Step', currentStep, 'started:', TUTORIAL_STEPS[currentStep].text);
    }
  }
}

export function isClickAllowed(x, y) {
  if (!tutorialActive) return true;
  
  const step = getCurrentStep();
  if (!step) return true;
  
  const state = getGameState();
  const playerPos = state.runState?.player?.pos;
  console.log('[TUTORIAL] Player at:', playerPos, 'clicking:', x, y, 'step:', currentStep);
  
  // Для шагов с динамическими клетками (attack_cell в боссфайте)
  if (!step.allowedCells) {
    const state = getGameState();
    const { runState } = state;
    
    // Шаг 14: клик на клетку атаки
    if (currentStep === 14 && runState.levelPhase === 'boss_arena') {
      const cell = runState.rows[y]?.[x];
      const allowed = cell?.type === 'attack_cell';
      console.log('[TUTORIAL] Click check (step 14):', x, y, 'allowed:', allowed, 'cell type:', cell?.type);
      return allowed;
    }
    
    // Шаг 15: любой клик разрешен (победи босса)
    if (currentStep === 15) {
      console.log('[TUTORIAL] Click check (step 15): allowed (any)');
      return true;
    }
    
    return true;
  }
  
  const allowed = step.allowedCells.some(cell => cell.x === x && cell.y === y);
  console.log('[TUTORIAL] Click check (step', currentStep + '):', x, y, 'allowed:', allowed, 'expected:', step.allowedCells);
  return allowed;
}
