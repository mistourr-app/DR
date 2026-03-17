# Мета-геймплей и система прокачки

## Концепция

Мета-геймплей добавляет долгосрочную прогрессию между забегами. Игрок собирает валюту, прокачивает снаряжение и персонажа, разблокирует новый контент.

---

## 1. Разделение инвентаря

### 1.1 Постоянное снаряжение (Equipment)

**Что это:**
- Предметы, которые игрок выбирает перед забегом
- Сохраняются между забегами
- Можно прокачивать в мета-хабе

**Типы снаряжения:**
- Оружие (арбалет, меч, и т.д.)
- Броня/защита
- Аксессуары (кольца, амулеты)
- Стартовые бонусы (начальное HP, энергия)

**Параметры снаряжения:**
- Базовые характеристики (урон, защита, дальность)
- Уровень прокачки (1-10?)
- Стоимость прокачки на каждый уровень
- Требования для разблокировки

### 1.2 Расходники (Consumables)

**Что это:**
- Подбираются во время забега
- Не сохраняются между забегами
- Зависят от прокачки игрока

**Типы расходников:**
- Здоровье (heal)
- Энергия (energy)
- Патроны (ammo)
- Временные бонусы (attack_bonus, defense_bonus)

**Параметры расходников:**
- Базовое значение (например, heal = 6)
- Случайный разброс (±20%?)
- Модификаторы от прокачки игрока

### 1.3 Структура инвентаря

**Текущая структура:**
```javascript
inventory: {
  weapon: { type, damage, range, ammo },
  attackBonuses: [],
  defenseBonuses: []
}
```

**Новая структура:**
```javascript
inventory: {
  // Постоянное снаряжение (из меты)
  equipment: {
    weapon: { id, level, stats },
    armor: { id, level, stats },
    accessory1: { id, level, stats },
    accessory2: { id, level, stats }
  },
  
  // Расходники (подбираются в забеге)
  consumables: {
    maxSlots: 6, // Можно прокачать
    items: [
      { type: 'heal', value: 7, slot: 0 },
      { type: 'attack_bonus', value: 5, slot: 1 }
    ]
  }
}
```

---

## 2. Система прокачки

### 2.1 Мета-валюта

**Типы валют:**
- **Золото (gold)** - основная валюта за прохождение
- **Кристаллы (crystals)** - редкая валюта за достижения
- **Опыт (experience)** - для уровня игрока

**Источники валюты:**
- Победа над врагами
- Прохождение уровня
- Победа над боссом
- Достижения

### 2.2 Прокачка снаряжения

**Механика:**
- Каждый предмет имеет уровень (1-10)
- Каждый уровень улучшает характеристики
- Стоимость растет с уровнем (например, level * 100 золота)

**Пример прокачки арбалета:**
```
Level 1: damage 3, range 3, ammo 3
Level 2: damage 4, range 3, ammo 3 (cost: 100 gold)
Level 3: damage 4, range 4, ammo 3 (cost: 200 gold)
Level 4: damage 5, range 4, ammo 4 (cost: 300 gold)
Level 5: damage 6, range 4, ammo 4 (cost: 400 gold)
...
Level 10: damage 10, range 5, ammo 6 (cost: 900 gold)
```

### 2.3 Прокачка игрока

**Параметры для прокачки:**
- Максимальное HP (20 → 25 → 30...)
- Максимальная энергия (10 → 12 → 15...)
- Слоты расходников (4 → 6 → 8...)
- Эффективность расходников (+10% к heal, +20%...)
- Начальные ресурсы (стартовое HP, энергия)

**Дерево прокачки:**
- Узлы с требованиями (нужен уровень X)
- Ветки специализации (танк/урон/мобильность)
- Пассивные бонусы

---

## 3. Рандомизация расходников

### 3.1 Генерация значений

**Базовая формула:**
```javascript
finalValue = baseValue * (1 + randomRange) * (1 + playerBonus)

// Пример для heal:
baseValue = 6
randomRange = random(-0.2, +0.2) // ±20%
playerBonus = 0.1 // +10% от прокачки

finalValue = 6 * (1 + 0.15) * (1.1) = 7.59 ≈ 8
```

### 3.2 Визуальное отображение

- Показывать диапазон значений (5-7 вместо 6)
- Цветовая кодировка (зеленый = выше среднего, серый = средний)
- Подсветка при наведении

---

## 4. Структура данных

### 4.1 MetaState (расширение)

```javascript
metaState: {
  // Валюта
  currency: {
    gold: 0,
    crystals: 0,
    experience: 0
  },
  
  // Уровень игрока
  playerLevel: 1,
  
  // Прокачка игрока
  playerUpgrades: {
    maxHp: { level: 0, maxLevel: 10 },
    maxEnergy: { level: 0, maxLevel: 10 },
    consumableSlots: { level: 0, maxLevel: 5 },
    healEfficiency: { level: 0, maxLevel: 5 },
    energyEfficiency: { level: 0, maxLevel: 5 },
    startingHp: { level: 0, maxLevel: 5 },
    startingEnergy: { level: 0, maxLevel: 5 }
  },
  
  // Коллекция снаряжения
  equipment: {
    crossbow_1: { id: 'crossbow_1', level: 1, unlocked: true },
    sword_1: { id: 'sword_1', level: 0, unlocked: false },
    armor_1: { id: 'armor_1', level: 1, unlocked: true },
    ring_1: { id: 'ring_1', level: 0, unlocked: false }
  },
  
  // Текущая экипировка (что взято в забег)
  loadout: {
    weapon: 'crossbow_1',
    armor: 'armor_1',
    accessory1: null,
    accessory2: null
  },
  
  // Статистика
  stats: {
    runsCompleted: 0,
    runsWon: 0,
    enemiesKilled: 0,
    bossesDefeated: 0,
    totalGoldEarned: 0,
    totalDamageTaken: 0,
    totalDamageDealt: 0
  },
  
  // Разблокировки
  unlocks: {
    levels: ['level_1', 'tutorial'],
    equipment: ['crossbow_1', 'armor_1'],
    upgrades: ['maxHp', 'maxEnergy']
  }
}
```

### 4.2 Registry для снаряжения

```javascript
// registry.js
export const EQUIPMENT_DEFS = {
  // Оружие
  crossbow_1: {
    id: 'crossbow_1',
    name: 'Арбалет',
    type: 'weapon',
    rarity: 'common',
    emoji: '🏹',
    baseStats: { 
      damage: 3, 
      range: 3, 
      ammo: 3 
    },
    upgradeScaling: { 
      damage: 1,      // +1 урон за уровень
      range: 0.5,     // +1 дальность каждые 2 уровня
      ammo: 0.5       // +1 патрон каждые 2 уровня
    },
    upgradeCost: (level) => level * 100,
    unlockCost: 0 // Стартовый предмет
  },
  
  sword_1: {
    id: 'sword_1',
    name: 'Меч',
    type: 'weapon',
    rarity: 'rare',
    emoji: '⚔️',
    baseStats: { 
      damage: 5, 
      range: 1 
    },
    upgradeScaling: { 
      damage: 1.5 
    },
    upgradeCost: (level) => level * 150,
    unlockCost: 500
  },
  
  // Броня
  armor_1: {
    id: 'armor_1',
    name: 'Кожаная броня',
    type: 'armor',
    rarity: 'common',
    emoji: '🛡️',
    baseStats: { 
      defense: 1 
    },
    upgradeScaling: { 
      defense: 0.5 
    },
    upgradeCost: (level) => level * 80,
    unlockCost: 0
  },
  
  // Аксессуары
  ring_1: {
    id: 'ring_1',
    name: 'Кольцо силы',
    type: 'accessory',
    rarity: 'rare',
    emoji: '💍',
    baseStats: { 
      attackBonus: 2 
    },
    upgradeScaling: { 
      attackBonus: 1 
    },
    upgradeCost: (level) => level * 120,
    unlockCost: 300
  }
};
```

### 4.3 Registry для прокачек игрока

```javascript
// registry.js
export const UPGRADE_DEFS = {
  maxHp: {
    id: 'maxHp',
    name: 'Максимальное здоровье',
    description: 'Увеличивает максимальное HP',
    emoji: '❤️',
    baseValue: 20,
    valuePerLevel: 5,
    costPerLevel: (level) => level * 50,
    maxLevel: 10
  },
  
  maxEnergy: {
    id: 'maxEnergy',
    name: 'Максимальная энергия',
    description: 'Увеличивает максимальную энергию',
    emoji: '⚡',
    baseValue: 10,
    valuePerLevel: 2,
    costPerLevel: (level) => level * 40,
    maxLevel: 10
  },
  
  consumableSlots: {
    id: 'consumableSlots',
    name: 'Слоты расходников',
    description: 'Увеличивает количество слотов для бонусов',
    emoji: '🎒',
    baseValue: 4,
    valuePerLevel: 2,
    costPerLevel: (level) => level * 100,
    maxLevel: 5
  },
  
  healEfficiency: {
    id: 'healEfficiency',
    name: 'Эффективность лечения',
    description: 'Увеличивает восстановление HP',
    emoji: '💊',
    baseValue: 0,
    valuePerLevel: 0.1, // +10% за уровень
    costPerLevel: (level) => level * 60,
    maxLevel: 5
  },
  
  energyEfficiency: {
    id: 'energyEfficiency',
    name: 'Эффективность энергии',
    description: 'Увеличивает восстановление энергии',
    emoji: '🔋',
    baseValue: 0,
    valuePerLevel: 0.1,
    costPerLevel: (level) => level * 60,
    maxLevel: 5
  },
  
  startingHp: {
    id: 'startingHp',
    name: 'Стартовое здоровье',
    description: 'Начинать забег с дополнительным HP',
    emoji: '💚',
    baseValue: 0,
    valuePerLevel: 5,
    costPerLevel: (level) => level * 80,
    maxLevel: 5
  },
  
  startingEnergy: {
    id: 'startingEnergy',
    name: 'Стартовая энергия',
    description: 'Начинать забег с дополнительной энергией',
    emoji: '⚡',
    baseValue: 0,
    valuePerLevel: 3,
    costPerLevel: (level) => level * 70,
    maxLevel: 5
  }
};
```

### 4.4 Конфигурация расходников

```javascript
// registry.js
export const CONSUMABLE_CONFIG = {
  heal: {
    baseValue: 6,
    randomRange: 0.2,        // ±20%
    playerBonusKey: 'healEfficiency',
    spawnWeight: 1.0,
    color: '#22c55e'
  },
  
  energy: {
    baseValue: 10,
    randomRange: 0.15,       // ±15%
    playerBonusKey: 'energyEfficiency',
    spawnWeight: 0.8,
    color: '#3b82f6'
  },
  
  ammo: {
    baseValue: 2,
    randomRange: 0.25,       // ±25%
    playerBonusKey: null,
    spawnWeight: 0.7,
    color: '#f59e0b'
  },
  
  attack_bonus: {
    baseValue: 5,
    randomRange: 0.2,
    playerBonusKey: null,
    spawnWeight: 0.6,
    color: '#ef4444'
  },
  
  defense_bonus: {
    baseValue: 5,
    randomRange: 0.2,
    playerBonusKey: null,
    spawnWeight: 0.6,
    color: '#8b5cf6'
  }
};
```

---

## 5. Изменения в существующих модулях

### 5.1 state.js
- Расширить metaState новыми полями
- Добавить функции для работы с валютой:
  - `addCurrency(type, amount)`
  - `spendCurrency(type, amount)`
  - `canAfford(type, amount)`
- Добавить функции для прокачки:
  - `upgradeEquipment(equipmentId)`
  - `upgradePlayer(upgradeId)`
  - `unlockEquipment(equipmentId)`

### 5.2 registry.js
- Создать `EQUIPMENT_DEFS`
- Создать `UPGRADE_DEFS`
- Расширить `CONSUMABLE_CONFIG`
- Добавить функции:
  - `getEquipmentStats(equipmentId, level)`
  - `getUpgradeValue(upgradeId, level)`

### 5.3 run.js
- При старте забега загружать снаряжение из loadout
- Применять бонусы от прокачки игрока
- Генерировать расходники с рандомом
- Начислять валюту за действия:
  - Убийство врага → gold
  - Победа над боссом → gold + crystals
  - Завершение уровня → gold

### 5.4 utils.js
- Функция генерации случайного значения расходника:
  - `generateConsumableValue(type, prng)`
- Функция расчета стоимости прокачки:
  - `getUpgradeCost(id, currentLevel)`
- Функция применения бонусов:
  - `applyPlayerBonuses(baseValue, bonusKey)`

### 5.5 ui.js (новые экраны)
- **UPGRADE_SCREEN** - экран прокачки
  - Список доступных прокачек
  - Текущий уровень и стоимость
  - Кнопки прокачки
- **LOADOUT_SCREEN** - экран выбора снаряжения
  - Слоты для оружия, брони, аксессуаров
  - Список доступного снаряжения
  - Характеристики предметов
- **META_HUB** (расширение)
  - Отображение валюты
  - Кнопки перехода на экраны прокачки
  - Статистика игрока

---

## 6. Порядок реализации

### Фаза 1: Подготовка данных
- [ ] Расширить metaState новыми полями
- [ ] Создать EQUIPMENT_DEFS в registry.js
- [ ] Создать UPGRADE_DEFS в registry.js
- [ ] Создать CONSUMABLE_CONFIG в registry.js
- [ ] Добавить функции работы с валютой в state.js

### Фаза 2: Рандомизация расходников
- [ ] Добавить генерацию случайных значений в utils.js
- [ ] Обновить генерацию расходников в run.js
- [ ] Обновить визуал расходников в renderer.js
- [ ] Применять бонусы игрока к расходникам

### Фаза 3: Разделение инвентаря
- [ ] Разделить equipment и consumables в структуре
- [ ] Обновить логику подбора предметов в run.js
- [ ] Обновить отображение инвентаря в renderer.js
- [ ] Добавить систему слотов для расходников

### Фаза 4: Система прокачки
- [ ] Реализовать прокачку снаряжения
- [ ] Реализовать прокачку игрока
- [ ] Добавить траты валюты
- [ ] Добавить начисление валюты за действия
- [ ] Сохранение прогресса в localStorage

### Фаза 5: UI меты
- [ ] Создать экран прокачки (UPGRADE_SCREEN)
- [ ] Создать экран выбора снаряжения (LOADOUT_SCREEN)
- [ ] Расширить META_HUB отображением валюты
- [ ] Добавить навигацию между экранами
- [ ] Добавить визуал прогресса прокачки

### Фаза 6: Баланс и тестирование
- [ ] Настроить стоимость прокачек
- [ ] Настроить награды за действия
- [ ] Протестировать прогрессию
- [ ] Добавить feedback для действий
- [ ] Полировка UI

---

## 7. Примеры использования

### 7.1 Загрузка снаряжения при старте забега

```javascript
// run.js: startRun()
function loadEquipment() {
  const { loadout, equipment } = metaState;
  
  // Загружаем оружие
  if (loadout.weapon) {
    const weaponDef = EQUIPMENT_DEFS[loadout.weapon];
    const weaponData = equipment[loadout.weapon];
    const stats = getEquipmentStats(loadout.weapon, weaponData.level);
    
    player.inventory.equipment.weapon = {
      id: loadout.weapon,
      level: weaponData.level,
      stats: stats
    };
  }
  
  // Загружаем броню
  if (loadout.armor) {
    const armorDef = EQUIPMENT_DEFS[loadout.armor];
    const armorData = equipment[loadout.armor];
    const stats = getEquipmentStats(loadout.armor, armorData.level);
    
    player.inventory.equipment.armor = {
      id: loadout.armor,
      level: armorData.level,
      stats: stats
    };
  }
}
```

### 7.2 Генерация расходника с рандомом

```javascript
// utils.js
export function generateConsumableValue(type, prng) {
  const config = CONSUMABLE_CONFIG[type];
  const { baseValue, randomRange, playerBonusKey } = config;
  
  // Случайный разброс
  const randomFactor = 1 + (prng() * 2 - 1) * randomRange;
  
  // Бонус от прокачки игрока
  let playerBonus = 1;
  if (playerBonusKey) {
    const upgradeLevel = metaState.playerUpgrades[playerBonusKey].level;
    const upgradeDef = UPGRADE_DEFS[playerBonusKey];
    playerBonus = 1 + (upgradeLevel * upgradeDef.valuePerLevel);
  }
  
  const finalValue = Math.round(baseValue * randomFactor * playerBonus);
  return finalValue;
}
```

### 7.3 Прокачка снаряжения

```javascript
// state.js
export function upgradeEquipment(equipmentId) {
  const equipmentData = metaState.equipment[equipmentId];
  const equipmentDef = EQUIPMENT_DEFS[equipmentId];
  
  if (!equipmentData.unlocked) {
    console.error('Equipment not unlocked');
    return false;
  }
  
  const currentLevel = equipmentData.level;
  const cost = equipmentDef.upgradeCost(currentLevel + 1);
  
  if (!canAfford('gold', cost)) {
    console.error('Not enough gold');
    return false;
  }
  
  spendCurrency('gold', cost);
  equipmentData.level++;
  saveMetaState();
  
  return true;
}
```

---

## 8. Визуальный дизайн

### 8.1 Экран прокачки
```
┌─────────────────────────────────────┐
│  ПРОКАЧКА                  💰 1250  │
├─────────────────────────────────────┤
│                                     │
│  ❤️  Максимальное здоровье         │
│      20 → 25                        │
│      Уровень: 0/10                  │
│      [Прокачать за 50 💰]           │
│                                     │
│  ⚡  Максимальная энергия           │
│      10 → 12                        │
│      Уровень: 0/10                  │
│      [Прокачать за 40 💰]           │
│                                     │
│  🎒  Слоты расходников              │
│      4 → 6                          │
│      Уровень: 0/5                   │
│      [Прокачать за 100 💰]          │
│                                     │
└─────────────────────────────────────┘
```

### 8.2 Экран снаряжения
```
┌─────────────────────────────────────┐
│  СНАРЯЖЕНИЕ                💰 1250  │
├─────────────────────────────────────┤
│                                     │
│  🏹 Оружие: [Арбалет ⭐⭐⭐]        │
│     Урон: 6  Дальность: 4           │
│     [Прокачать за 300 💰]           │
│                                     │
│  🛡️ Броня: [Кожаная броня ⭐⭐]    │
│     Защита: 2                       │
│     [Прокачать за 160 💰]           │
│                                     │
│  💍 Аксессуар 1: [Пусто]            │
│     [Разблокировать]                │
│                                     │
│  💍 Аксессуар 2: [Пусто]            │
│     [Разблокировать]                │
│                                     │
└─────────────────────────────────────┘
```

---

## 9. Баланс (черновик)

### 9.1 Награды за действия
- Убийство врага TYPE_1: 10 gold
- Убийство врага TYPE_2: 15 gold
- Победа над боссом: 100 gold + 5 crystals
- Прохождение уровня: 50 gold

### 9.2 Стоимость прокачек
- Прокачка игрока: 40-100 gold за уровень
- Прокачка снаряжения: 80-150 gold за уровень
- Разблокировка снаряжения: 300-500 gold

### 9.3 Прогрессия
- Первый забег: ~150 gold (если победил)
- Нужно 3-4 забега для первых прокачек
- Нужно 10+ забегов для разблокировки нового снаряжения
