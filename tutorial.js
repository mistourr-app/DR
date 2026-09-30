import { getGameState } from './state.js';

let currentStep = 0;
let tutorialActive = false;

export const TUTORIAL_STEPS = [
  {
    text: "Tap the cell ahead to move",
    allowedCells: [{x: 2, y: 1}], // Row 2 (index 1)
    checkComplete: (state) => state.runState.player.pos.y >= 1
  },
  {
    text: "Tap a diagonal cell (a leap costs 1 energy)",
    allowedCells: [{x: 0, y: 2}, {x: 4, y: 2}], // Row 3 (index 2)
    checkComplete: (state) => state.runState.player.pos.y >= 2 && state.runState.player.energy < 10
  },
  {
    text: "Pick up the health",
    allowedCells: [{x: 2, y: 3}], // Row 4 (index 3)
    checkComplete: (state) => state.runState.player.pos.y >= 3
  },
  {
    text: "Take crossbow bolts",
    allowedCells: [{x: 2, y: 4}], // Row 5 (index 4)
    checkComplete: (state) => state.runState.player.pos.y >= 4
  },
  {
    text: "Strike an enemy in melee",
    allowedCells: [{x: 2, y: 5}], // Row 6 (index 5)
    checkComplete: (state) => state.runState.player.pos.y >= 5
  },
  {
    text: "Push forward",
    allowedCells: [{x: 2, y: 6}], // Row 7 (index 6)
    checkComplete: (state) => state.runState.player.pos.y >= 6
  },
  {
    text: "Advance into the row with the enemy",
    allowedCells: [{x: 2, y: 7}], // Row 8 (index 7)
    checkComplete: (state) => state.runState.player.pos.y >= 7
  },
  {
    text: "Shoot the enemy on your left",
    allowedCells: [{x: 0, y: 7}], // Row 8 (index 7) - enemy on the left
    checkComplete: (state) => state.runState.player.inventory.ammo < 3
  },
  {
    text: "Move on. That enemy strikes from behind!",
    allowedCells: [{x: 2, y: 8}], // Row 9 (index 8)
    checkComplete: (state) => state.runState.player.pos.y >= 8
  },
  {
    text: "Take the attack charm",
    allowedCells: [{x: 2, y: 9}], // Row 10 (index 9)
    checkComplete: (state) => state.runState.player.inventory.attackBonuses.length > 0
  },
  {
    text: "Strike the charmed enemy",
    allowedCells: [{x: 2, y: 10}], // Row 11 (index 10)
    checkComplete: (state) => state.runState.player.pos.y >= 10
  },
  {
    text: "Descend into the Elder hall",
    allowedCells: [{x: 2, y: 11}], // Row 12 (index 11) - first arena row
    checkComplete: (state) => state.runState.player.pos.y >= 11
  },
  {
    text: "Strike the Elder!",
    allowedCells: [{x: 1, y: 11}], // Neighbouring attack cell on the left
    checkComplete: (state) => {
      const player = state.runState.player;
      const boss = state.runState.boss;
      // Check that the player stands on (1, 11) AND the Elder took damage
      return player.pos.x === 1 && player.pos.y === 11 && boss.currentHp < boss.hp;
    }
  },
  {
    text: "End it.",
    allowedCells: [{x: 3, y: 11}], // Attack cell on the right (leap over the centre)
    checkComplete: (state) => {
      const player = state.runState.player;
      const boss = state.runState.boss;
      // Check that the player stands on (3, 11) AND the Elder is dead
      return player.pos.x === 3 && player.pos.y === 11 && boss.currentHp <= 0;
    }
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
  
  // For steps with dynamic cells (attack_cell during the Elder fight)
  if (!step.allowedCells) {
    // Every step now uses allowedCells, so this block must never run
    return true;
  }
  
  const allowed = step.allowedCells.some(cell => cell.x === x && cell.y === y);
  console.log('[TUTORIAL] Click check (step', currentStep + '):', x, y, 'allowed:', allowed, 'expected:', step.allowedCells);
  return allowed;
}
