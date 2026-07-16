import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

import { GameSimulation } from '../src/simulation.js';
import { getWorldTile, updateWorldTravel, WORLD_OBJECT } from '../src/world-map.js';

await access(new URL('../assets/dungeon-monster-hints.png', import.meta.url));

const dungeons = [
  { dungeonId: 'dungeon-a', name: '地下城 A', themeColor: '#aa7755' },
  { dungeonId: 'dungeon-b', name: '地下城 B', themeColor: '#5577aa' }
];

const data = {
  balance: {
    xpBase: 100,
    spRegenPerSecond: 1
  },
  characters: [{
    characterId: 'hero',
    name: 'Hero',
    role: 'Tank',
    combatStyle: 'melee',
    attackType: 'physical',
    color: '#ffffff',
    spriteId: 'hero',
    maxHp: 100,
    maxSp: 20,
    attack: 10,
    defense: 5,
    speed: 3,
    attackRange: 1,
    attackCooldownMs: 1000,
    basicSkillId: 'basic',
    skillPoolId: 'pool'
  }],
  scrolls: [],
  dungeons,
  indexes: {
    skillById: new Map(),
    dungeonById: new Map(dungeons.map((dungeon) => [dungeon.dungeonId, dungeon]))
  }
};

const events = [];
const simulation = new GameSimulation(data, { onEvent: (message) => events.push(message) });
updateWorldTravel(simulation.worldMap, 9999);

const firstDestination = simulation.worldMap.destinations[0];
assert.equal(simulation.worldMap.arrived, true);
assert.equal(firstDestination.status, 'active');
assert.ok(firstDestination.intel.monsters.length >= 1 && firstDestination.intel.monsters.length <= 2);
assert.ok(firstDestination.intel.difficulty.label);

assert.equal(simulation.skipDungeon(), true);
assert.equal(simulation.dungeonRun, 0, '略過地下城不得增加完成數');
assert.equal(simulation.worldDestinationIndex, 1);
assert.equal(firstDestination.status, 'skipped');
assert.equal(simulation.worldMap.destinations.length, 2);
assert.equal(simulation.worldMap.activeDestinationIndex, 1);
assert.equal(getWorldTile(simulation.worldMap, firstDestination.x, firstDestination.y).object, WORLD_OBJECT.DUNGEON);
assert.match(events.at(-1), /略過「地下城 A」/);

const secondDestination = simulation.worldMap.destinations[1];
assert.equal(secondDestination.dungeonId, 'dungeon-b');
assert.equal(secondDestination.status, 'active');
assert.notDeepEqual(secondDestination, firstDestination);

updateWorldTravel(simulation.worldMap, 9999);
simulation.startFloor = () => {};
assert.equal(simulation.enterDungeon(), true);
assert.equal(simulation.currentDungeon.dungeonId, 'dungeon-b');
assert.equal(simulation.dungeonRun, 0, '進入略過後的新入口前仍不得增加完成數');

const repeated = new GameSimulation(data);
for (let index = 0; index < 6; index += 1) {
  updateWorldTravel(repeated.worldMap, 9999);
  const active = repeated.worldMap.destinations.at(-1);
  assert.ok(active.intel.monsters.length >= 1 && active.intel.monsters.length <= 2);
  assert.equal(active.status, 'active');
  assert.equal(repeated.skipDungeon(), true);
  assert.equal(active.status, 'skipped');
  assert.equal(getWorldTile(repeated.worldMap, active.x, active.y).object, WORLD_OBJECT.DUNGEON);
}
assert.equal(repeated.dungeonRun, 0, '連續略過不得增加完成數');
assert.equal(repeated.worldDestinationIndex, 6);
assert.equal(repeated.worldMap.destinations.length, 7);
assert.equal(new Set(repeated.worldMap.destinations.map((destination) => destination.destinationIndex)).size, 7);
assert.equal(repeated.worldMap.destinations.filter((destination) => destination.status === 'skipped').length, 6);
assert.equal(repeated.worldMap.destinations.at(-1).status, 'active');

console.log('地下城情報與略過流程驗證通過');
