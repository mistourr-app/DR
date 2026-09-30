// GENERATED FILE - DO NOT EDIT.
//
// Source: balance.csv
// Regenerate: npm run build:balance
// Verify:     npm run balance:check
//
// Every tunable in the game is defined in balance.csv. This module is the
// machine readable form of it and is committed so that the game and the tests
// never need a build step.

export const BALANCE = {
  "campaign": {
    "total": 30,
    "idPrefix": "dungeon_",
    "rows": {
      "from": 30,
      "to": 75
    },
    "bossHpMultiplier": {
      "from": 1.2,
      "to": 5
    },
    "chances": {
      "ENEMY": {
        "from": 0.1,
        "to": 0.2
      },
      "WALL": {
        "from": 0.15,
        "to": 0.3
      },
      "HEAL": {
        "from": 0.06,
        "to": 0.05
      },
      "AMMO": {
        "from": 0.05,
        "to": 0.04
      },
      "ENERGY": {
        "from": 0.06,
        "to": 0.04
      },
      "ATTACK_BONUS": {
        "from": 0.05,
        "to": 0.03
      },
      "DEFENSE_BONUS": {
        "from": 0.06,
        "to": 0.03
      },
      "GOLD": {
        "from": 0.03,
        "to": 0.03
      }
    }
  },
  "enemyWindow": {
    "floor": {
      "from": -1,
      "to": 6
    },
    "shape": [
      0.7,
      0.2,
      0.1
    ]
  },
  "enemies": {
    "TYPE_1": {
      "label": "ARCANIST",
      "hp": 4,
      "visionRange": 4,
      "actionRange": 4,
      "color": "#FF1F1F",
      "weight": 1
    },
    "TYPE_2": {
      "label": "SPEARMAN",
      "hp": 7,
      "visionRange": 2,
      "actionRange": 2,
      "color": "#FF1F1F",
      "weight": 1
    },
    "TYPE_3": {
      "label": "WARDEN",
      "hp": 10,
      "visionRange": 1,
      "actionRange": 1,
      "color": "#FF1F1F",
      "weight": 1
    }
  },
  "player": {
    "hp": 20,
    "energy": 10,
    "weapon": {
      "type": "crossbow",
      "damage": 3,
      "range": 3
    },
    "ammo": 3,
    "debugAmmo": 10
  },
  "cells": {
    "WALL": {
      "label": "WALL",
      "color": "#3F4556",
      "blocksMovement": "true"
    },
    "HEAL": {
      "label": "HEALTH",
      "value": "+6",
      "amount": 6,
      "color": "#10B981"
    },
    "AMMO": {
      "label": "BOLTS",
      "value": "+2",
      "amount": 2,
      "color": "#5CFAFF"
    },
    "ENERGY": {
      "label": "ENERGY",
      "value": "+10",
      "amount": 10,
      "color": "#9E6DFF"
    },
    "ATTACK_BONUS": {
      "label": "ATTACK",
      "value": 5,
      "color": "#FF731B"
    },
    "DEFENSE_BONUS": {
      "label": "SHIELD",
      "value": 5,
      "color": "#0084FF"
    },
    "ATTACK_CELL": {
      "label": "ATTACK",
      "value": 10,
      "color": "#C40014"
    },
    "GOLD": {
      "label": "GOLD",
      "value": "+10",
      "amount": 10,
      "color": "#FFE761"
    }
  },
  "upgrades": {
    "hp": {
      "label": "MIGHT",
      "effect": 5,
      "base": 20,
      "step": 10
    },
    "energy": {
      "label": "VIGOUR",
      "effect": 2,
      "base": 15,
      "step": 8
    },
    "weaponDamage": {
      "label": "BOLT POWER",
      "effect": 1,
      "base": 25,
      "step": 12
    },
    "maxAmmo": {
      "label": "QUIVER",
      "effect": 1,
      "base": 30,
      "step": 15
    },
    "attackBonus": {
      "label": "EDGE",
      "effect": 1,
      "base": 18,
      "step": 9
    },
    "defenseBonus": {
      "label": "WARD",
      "effect": 1,
      "base": 18,
      "step": 9
    },
    "energyPerCell": {
      "label": "SIPHON",
      "effect": 2,
      "base": 20,
      "step": 10
    },
    "boltsPerCell": {
      "label": "SALVAGE",
      "effect": 1,
      "base": 22,
      "step": 11
    }
  }
};

export default BALANCE;
