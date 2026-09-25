import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAttackOutcome, consumeDefenseBonuses } from '../combat.js';
import { createPRNG, generateArenaObject } from '../utils.js';

test('attack bonuses are consumed before base damage and defense', () => {
  const attackBonuses = [{ value: 5 }];
  const defenseBonuses = [{ value: 5 }];

  const outcome = calculateAttackOutcome(3, attackBonuses, defenseBonuses, 20);

  assert.deepEqual(outcome, {
    hpDamage: 3,
    blockedDamage: 5,
    attackPower: 8,
    attackUsed: 8,
  });
  assert.deepEqual(attackBonuses, []);
  assert.deepEqual(defenseBonuses, []);
});

test('only the needed attack bonus is consumed when base damage can overkill', () => {
  const attackBonuses = [{ value: 5 }];

  const outcome = calculateAttackOutcome(3, attackBonuses, [], 4);

  assert.equal(outcome.hpDamage, 4);
  assert.deepEqual(attackBonuses, [{ value: 1 }]);
});

test('defense absorbs part of an attack and consumes only its own values', () => {
  const attackBonuses = [{ value: 5 }];
  const defenseBonuses = [{ value: 3 }];

  const outcome = calculateAttackOutcome(3, attackBonuses, defenseBonuses, 20);

  assert.equal(outcome.hpDamage, 5);
  assert.deepEqual(attackBonuses, []);
  assert.deepEqual(defenseBonuses, [{ value: 0 }].filter((bonus) => bonus.value > 0));
});

test('defense consumption never creates negative bonus values', () => {
  const defenseBonuses = [{ value: 2 }, { value: 3 }];
  const absorbed = consumeDefenseBonuses(defenseBonuses, 4);

  assert.equal(absorbed, 4);
  assert.deepEqual(defenseBonuses, [{ value: 1 }]);
});

test('PRNG is deterministic and stays in range', () => {
  const first = createPRNG(12345);
  const second = createPRNG(12345);
  const firstValues = Array.from({ length: 20 }, () => first());
  const secondValues = Array.from({ length: 20 }, () => second());

  assert.deepEqual(firstValues, secondValues);
  assert.ok(firstValues.every((value) => value >= 0 && value < 1));
});

test('arena generation is deterministic with the same PRNG', () => {
  const first = generateArenaObject(2, 8, 10, createPRNG(99));
  const second = generateArenaObject(2, 8, 10, createPRNG(99));

  assert.deepEqual(first, second);
});
