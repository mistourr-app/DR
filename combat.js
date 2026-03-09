import { getGameState, setAppState } from './state.js';
import { AppState } from './config.js';
import { Events, emit } from './events.js';
import { stopTutorial } from './tutorial.js';

let _onStateChange = () => {};

export function initCombat(onStateChangeCallback) {
  _onStateChange = onStateChangeCallback;
}

export function dealDamageToPlayer(incomingDamage, source = null) {
  const { runState } = getGameState();
  const { player } = runState;
  let totalDamageTaken = 0;

  if (incomingDamage <= 0) return 0;

  for (let i = player.inventory.defenseBonuses.length - 1; i >= 0; i--) {
    const bonus = player.inventory.defenseBonuses[i];
    const absorbedAmount = Math.min(incomingDamage, bonus.value);
    
    bonus.value -= absorbedAmount;
    incomingDamage -= absorbedAmount;

    if (bonus.value <= 0) {
      player.inventory.defenseBonuses.splice(i, 1);
    }
    if (incomingDamage <= 0) break;
  }

  totalDamageTaken = Math.max(0, incomingDamage);
  player.hp -= totalDamageTaken;

  if (totalDamageTaken > 0) {
    const floatingText = {
      id: Date.now() + Math.random(),
      text: `-${totalDamageTaken}`,
      color: '#ef4444',
      visual: { 
        x: player.visual.x, 
        y: player.visual.y + 32,
        alpha: 1.0 
      },
    };
    runState.floatingTexts.push(floatingText);
    
    const gameContainer = document.getElementById('game-container');
    gameContainer.classList.add('damage-flash');
    setTimeout(() => gameContainer.classList.remove('damage-flash'), 300);
    
    emit(Events.PLAYER_DAMAGED, { damage: totalDamageTaken, source });
  }

  if (player.hp <= 0) {
    emit(Events.RUN_ENDED, { result: 'defeat' });
    stopTutorial();
    setTimeout(() => setAppState(AppState.RUN_SUMMARY, _onStateChange), 100);
  }

  return totalDamageTaken;
}

export function dealDamageToEnemy(enemyCell, baseDamage, consumeBonuses = false) {
  const { runState } = getGameState();
  const { player } = runState;
  const enemy = enemyCell.data;

  if (consumeBonuses) {
    let damageToConsumeFromBonuses = baseDamage;

    for (let i = player.inventory.attackBonuses.length - 1; i >= 0; i--) {
      const bonus = player.inventory.attackBonuses[i];
      const consumedAmount = Math.min(damageToConsumeFromBonuses, bonus.value);
      
      bonus.value -= consumedAmount;
      damageToConsumeFromBonuses -= consumedAmount;

      if (bonus.value <= 0) {
        player.inventory.attackBonuses.splice(i, 1);
      }
      if (damageToConsumeFromBonuses <= 0) break;
    }
  }

  const actualDamageDealt = Math.min(baseDamage, enemy.currentHp);
  enemy.currentHp -= actualDamageDealt;
  emit(Events.ENEMY_ATTACKED, { enemy, damage: actualDamageDealt });

  return actualDamageDealt;
}

export function dealDamageToBoss(damage) {
  const { runState } = getGameState();
  const { boss } = runState;
  let remainingDamage = damage;

  for (let i = boss.inventory.defenseBonuses.length - 1; i >= 0; i--) {
    const bonus = boss.inventory.defenseBonuses[i];
    const absorbedAmount = Math.min(remainingDamage, bonus.value);
    
    bonus.value -= absorbedAmount;
    remainingDamage -= absorbedAmount;

    if (bonus.value <= 0) {
      boss.inventory.defenseBonuses.splice(i, 1);
    }
    if (remainingDamage <= 0) break;
  }

  const actualDamageToHp = Math.min(remainingDamage, boss.currentHp);
  boss.currentHp -= actualDamageToHp;

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

  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalPlayerDamage = bonusDamage + playerAttackPower;
  dealDamageToEnemy(enemyCell, totalPlayerDamage, true);

  const damageToPlayer = dealDamageToPlayer(enemyAttackPower, enemy);

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

  const damage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  player.inventory.attackBonuses = [];

  dealDamageToBoss(damage);
  
  const bossCell = rows[boss.pos.y][boss.pos.x];
  // Создаем всплывающий текст
  const floatingText = {
    id: Date.now() + Math.random(),
    text: `-${damage}`,
    color: '#ef4444',
    visual: { 
      x: bossCell.visual.x, 
      y: bossCell.visual.y + 64,
      alpha: 1.0 
    },
  };
  runState.floatingTexts.push(floatingText);
  
  emit(Events.PLAYER_ATTACKED, { target: 'boss', damage });
}
