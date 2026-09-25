import { getGameState, setAppState } from './state.js';
import { AppState } from './config.js';
import { Events, emit } from './events.js';
import { stopTutorial } from './tutorial.js';
import { scheduleRunCallback } from './animation.js';

let _onStateChange = () => {};
let damageTextId = 0;

export function initCombat(onStateChangeCallback) {
  _onStateChange = onStateChangeCallback;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function totalBonusValue(bonuses) {
  return bonuses.reduce((sum, bonus) => sum + positiveNumber(bonus?.value), 0);
}

export function consumeAttackBonuses(bonuses, amount) {
  let remainingAmount = positiveNumber(amount);
  for (let index = bonuses.length - 1; index >= 0 && remainingAmount > 0; index--) {
    const bonus = bonuses[index];
    const value = positiveNumber(bonus?.value);
    const consumedAmount = Math.min(remainingAmount, value);
    bonus.value = value - consumedAmount;
    remainingAmount -= consumedAmount;

    if (bonus.value <= 0) {
      bonuses.splice(index, 1);
    }
  }
}

export function consumeDefenseBonuses(bonuses, amount) {
  let remainingAmount = positiveNumber(amount);
  for (let index = bonuses.length - 1; index >= 0 && remainingAmount > 0; index--) {
    const bonus = bonuses[index];
    const value = positiveNumber(bonus?.value);
    const absorbedAmount = Math.min(remainingAmount, value);
    bonus.value = value - absorbedAmount;
    remainingAmount -= absorbedAmount;

    if (bonus.value <= 0) {
      bonuses.splice(index, 1);
    }
  }

  return Math.max(0, positiveNumber(amount) - remainingAmount);
}

export function calculateAttackOutcome(baseDamage, attackBonuses = [], defenseBonuses = [], targetHp = 0) {
  const base = positiveNumber(baseDamage);
  const targetHealth = positiveNumber(targetHp);
  const attackBonusList = Array.isArray(attackBonuses) ? attackBonuses : [];
  const defenseBonusList = Array.isArray(defenseBonuses) ? defenseBonuses : [];
  const attackBonusTotal = totalBonusValue(attackBonusList);
  const attackPower = base + attackBonusTotal;
  const defenseCapacity = totalBonusValue(defenseBonusList);
  const blockedDamage = Math.min(attackPower, defenseCapacity);
  const hpDamage = Math.min(targetHealth, Math.max(0, attackPower - blockedDamage));
  const attackUsed = blockedDamage + hpDamage;

  consumeAttackBonuses(attackBonusList, attackUsed);
  consumeDefenseBonuses(defenseBonusList, blockedDamage);

  return {
    hpDamage,
    blockedDamage,
    attackPower,
    attackUsed,
  };
}

export function calculateAndConsumeAttackBonuses(baseDamage, targetMaxHp, defenseBonuses = []) {
  const { player } = getGameState().runState;
  return calculateAttackOutcome(
    baseDamage,
    player.inventory.attackBonuses,
    defenseBonuses,
    targetMaxHp,
  ).hpDamage;
}

export function applyPlayerDamage(totalDamageTaken, source = null) {
  const { runState } = getGameState();
  const { player } = runState;
  const damage = positiveNumber(totalDamageTaken);

  if (damage <= 0 || player.hp <= 0) return 0;

  player.hp = Math.max(0, player.hp - damage);

  const floatingText = {
    id: `${runState.runId}:${damageTextId++}`,
    text: `-${damage}`,
    color: '#ef4444',
    visual: {
      x: player.visual.x,
      y: player.visual.y + 32,
      alpha: 1.0,
    },
  };
  runState.floatingTexts.push(floatingText);

  const gameContainer = typeof document === 'undefined' ? null : document.getElementById('game-container');
  if (gameContainer) {
    gameContainer.classList.add('damage-flash');
    scheduleRunCallback(300, () => gameContainer.classList.remove('damage-flash'));
  }

  emit(Events.PLAYER_DAMAGED, { damage, source });

  if (player.hp <= 0) {
    emit(Events.RUN_ENDED, { result: 'defeat' });
    stopTutorial();
    scheduleRunCallback(100, () => setAppState(AppState.RUN_SUMMARY, _onStateChange));
  }

  return damage;
}

export function dealDamageToPlayer(incomingDamage, source = null) {
  const { player } = getGameState().runState;
  const damage = positiveNumber(incomingDamage);
  if (damage <= 0 || player.hp <= 0) return 0;

  const damageAfterDefense = Math.max(0, damage - consumeDefenseBonuses(player.inventory.defenseBonuses, damage));
  return applyPlayerDamage(damageAfterDefense, source);
}

export function dealDamageToEnemy(enemyCell, baseDamage, consumeBonuses = false) {
  const { runState } = getGameState();
  const { player } = runState;
  const enemy = enemyCell.data;
  const damage = positiveNumber(baseDamage);

  if (consumeBonuses) {
    consumeAttackBonuses(player.inventory.attackBonuses, damage);
  }

  const actualDamageDealt = Math.min(damage, positiveNumber(enemy.currentHp));
  enemy.currentHp = Math.max(0, enemy.currentHp - actualDamageDealt);
  emit(Events.ENEMY_ATTACKED, { enemy, damage: actualDamageDealt });

  return actualDamageDealt;
}

export function dealDamageToBoss(damage) {
  const { runState } = getGameState();
  const { boss } = runState;

  const actualDamageToHp = Math.min(positiveNumber(damage), positiveNumber(boss.currentHp));
  boss.currentHp = Math.max(0, boss.currentHp - actualDamageToHp);

  emit(Events.BOSS_ATTACKED, { damage, actualDamage: actualDamageToHp });

  if (boss.currentHp <= 0) {
    runState.turnOwner = 'processing';
    emit(Events.BOSS_KILLED, { boss });
    stopTutorial();
    setAppState(AppState.RUN_VICTORY, _onStateChange);
  }

  return actualDamageToHp;
}

export function processMeleeCombat(enemyCell) {
  const { player } = getGameState().runState;
  const enemy = enemyCell.data;
  const playerAttackPower = player.hp;
  const enemyAttackPower = enemy.currentHp;
  const actualDamage = calculateAndConsumeAttackBonuses(playerAttackPower, enemy.currentHp);

  dealDamageToEnemy(enemyCell, actualDamage, false);
  dealDamageToPlayer(enemyAttackPower, enemy);

  const playerWon = player.hp > 0 && enemy.currentHp <= 0;
  
  if (playerWon) {
    emit(Events.ENEMY_KILLED, { enemy });
  }

  return playerWon;
}

export function processPlayerMeleeOnBoss() {
  const { runState } = getGameState();
  const { player, boss, rows } = runState;

  if (player.inventory.attackBonuses.length === 0) return;

  runState.turnOwner = 'processing';

  const damage = calculateAndConsumeAttackBonuses(0, boss.currentHp, boss.inventory.defenseBonuses);
  dealDamageToBoss(damage);

  const bossCell = rows[boss.pos.y][boss.pos.x];
  if (damage > 0 && bossCell) {
    const floatingText = {
      id: `${runState.runId}:${damageTextId++}`,
      text: `-${damage}`,
      color: '#ef4444',
      visual: {
        x: bossCell.visual.x,
        y: bossCell.visual.y + 64,
        alpha: 1.0,
      },
    };
    runState.floatingTexts.push(floatingText);
  }

  emit(Events.PLAYER_ATTACKED, { target: 'boss', damage });
}
