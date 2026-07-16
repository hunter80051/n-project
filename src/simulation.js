import {
  createSeededRandom,
  findPath,
  generateBossFloor,
  generateDungeonFloor
} from './dungeon.js?v=20260716a';
import {
  createWorldMap,
  extendWorldMap,
  getWorldTile,
  getWorldTravelProgress,
  markActiveWorldDestination,
  updateWorldTravel,
  WORLD_OBJECT,
  WORLD_TERRAIN
} from './world-map.js?v=20260716b';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const positionKey = (point) => `${Math.round(point.x)},${Math.round(point.y)}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const WORLD_MOVE_SPEED = 2.4;
const ENTITY_CLEARANCE = 0.68;
const ACTOR_FLOOR_RADIUS = 0.24;
const PICKUP_DISTANCE = 1.02;
const PROJECTILE_SPEED = 8;
const FORMATION_OFFSETS = [
  { x: -0.8, y: -0.45 },
  { x: 0.75, y: -0.4 },
  { x: -0.65, y: 0.7 },
  { x: 0.7, y: 0.65 }
];

function noop() {}

export class GameSimulation {
  constructor(data, callbacks = {}) {
    this.data = data;
    this.callbacks = {
      onEvent: callbacks.onEvent ?? noop,
      onEquipment: callbacks.onEquipment ?? noop,
      onLevelUp: callbacks.onLevelUp ?? noop,
      onSceneChange: callbacks.onSceneChange ?? noop
    };
    this.scene = 'world';
    this.dungeonRun = 0;
    this.worldDestinationIndex = 0;
    this.floorNumber = 0;
    this.currentDungeon = null;
    this.floor = null;
    this.enemies = [];
    this.partyPosition = { x: 6, y: 11 };
    this.partyNavigation = { goal: '', path: [] };
    this.formationGoal = '';
    this.formationAssignments = new Map();
    this.projectiles = [];
    this.spellEffects = [];
    this.chests = [];
    this.pendingEquipment = [];
    this.runtimeSequence = 0;
    this.combatActive = false;
    this.floorCleared = false;
    this.revealedGroup = 0;
    this.floorTransitionMs = 0;
    this.manualPaused = false;
    this.paused = false;
    this.pendingSkillChoices = [];
    this.deferredSkillChoices = [];
    this.random = createSeededRandom(Date.now());
    this.party = data.characters.map((config) => this.createPartyMember(config));
    this.scrolls = data.scrolls.map((config) => ({ ...config, quantity: config.initialQuantity }));
    this.worldMap = createWorldMap(Date.now());
    if (data.dungeons.length > 0) extendWorldMap(this.worldMap, this.worldDestinationIndex, data.dungeons[0]);
    this.initializeWorldPartyPositions();
    this.recalculatePartyStats();
  }

  createPartyMember(config) {
    return {
      ...config,
      base: {
        maxHp: config.maxHp,
        maxSp: config.maxSp,
        attack: config.attack,
        defense: config.defense,
        attackCooldownMs: config.attackCooldownMs
      },
      level: 1,
      xp: 0,
      xpToNext: this.data.balance.xpBase,
      hp: config.maxHp,
      sp: config.maxSp,
      cooldownMs: 0,
      attackingMs: 0,
      x: 0,
      y: 0,
      navigation: { goal: '', path: [] },
      wanderOffset: { x: 0, y: 0 },
      wanderMs: 0,
      worldStuckMs: 0,
      dungeonStuckMs: 0,
      targetRuntimeId: null,
      learnedSkillIds: [],
      learnedSkillNames: [],
      equipment: { weapon: null, armor: null },
      weaponName: '空欄位',
      armorName: '空欄位',
      healPower: 1,
      regen: 0,
      spRegen: this.data.balance.spRegenPerSecond,
      aoeBonus: 0,
      chainBonus: 0
    };
  }

  initializeWorldPartyPositions() {
    const reserved = [];
    this.party.forEach((member, index) => {
      const offset = FORMATION_OFFSETS[index] ?? { x: 0, y: 0 };
      const position = this.findWorldRecoveryPosition(member, reserved, {
        x: this.worldMap.partyPosition.x + offset.x,
        y: this.worldMap.partyPosition.y + offset.y
      }) ?? { ...this.worldMap.partyPosition };
      member.x = position.x;
      member.y = position.y;
      member.wanderOffset = { ...offset };
      member.wanderMs = 500 + index * 260;
      member.worldStuckMs = 0;
      reserved.push(position);
    });
  }

  updateWorldParty(dtSeconds, dtMs) {
    for (const member of this.party) {
      if (!this.isWorldGround(member) || distance(member, this.worldMap.partyPosition) > 6) {
        this.relocateWorldPartyMember(member);
      }
      member.wanderMs -= dtMs;
      if (member.wanderMs <= 0) {
        const angle = this.random() * Math.PI * 2;
        const radius = 0.45 + this.random() * 0.9;
        member.wanderOffset = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        member.wanderMs = 900 + this.random() * 1500;
      }
      const preferred = {
        x: this.worldMap.partyPosition.x + member.wanderOffset.x,
        y: this.worldMap.partyPosition.y + member.wanderOffset.y
      };
      const goal = this.findWorldOpenPosition(preferred, member);
      if (!goal) {
        member.worldStuckMs += dtMs;
        if (member.worldStuckMs >= 1000) this.relocateWorldPartyMember(member);
        continue;
      }
      const dx = goal.x - member.x;
      const dy = goal.y - member.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining < 0.02) {
        member.worldStuckMs = 0;
        continue;
      }
      const movement = Math.min(remaining, member.speed * dtSeconds);
      const candidate = {
        x: member.x + (dx / remaining) * movement,
        y: member.y + (dy / remaining) * movement
      };
      if (this.canOccupyWorld(member, candidate)) {
        member.x = candidate.x;
        member.y = candidate.y;
        member.worldStuckMs = 0;
      } else {
        member.worldStuckMs += dtMs;
        if (member.worldStuckMs >= 1000) this.relocateWorldPartyMember(member);
      }
    }
    this.separateActors(this.party, false);
  }

  findWorldOpenPosition(preferred, actor) {
    const candidates = [
      preferred,
      { x: this.worldMap.partyPosition.x, y: this.worldMap.partyPosition.y },
      ...FORMATION_OFFSETS.map((offset) => ({
        x: this.worldMap.partyPosition.x + offset.x,
        y: this.worldMap.partyPosition.y + offset.y
      }))
    ];
    return candidates.find((point) => this.canOccupyWorld(actor, point)) ?? null;
  }

  findWorldRecoveryPosition(actor, reserved = [], preferred = this.worldMap.partyPosition) {
    const center = { x: Math.round(this.worldMap.partyPosition.x), y: Math.round(this.worldMap.partyPosition.y) };
    const candidates = [preferred, center];
    for (let radius = 1; radius <= 4; radius += 1) {
      for (let y = center.y - radius; y <= center.y + radius; y += 1) {
        for (let x = center.x - radius; x <= center.x + radius; x += 1) candidates.push({ x, y });
      }
    }
    return candidates.find((point) => this.isWorldGround(point)
      && reserved.every((other) => distance(other, point) >= ENTITY_CLEARANCE)
      && (reserved.length > 0 || this.party.every((other) => other === actor
        || distance(other, point) >= ENTITY_CLEARANCE))) ?? null;
  }

  relocateWorldPartyMember(member) {
    const position = this.findWorldRecoveryPosition(member);
    if (!position) return false;
    member.x = position.x;
    member.y = position.y;
    member.worldStuckMs = 0;
    member.wanderMs = 500;
    return true;
  }

  canOccupyWorld(actor, point) {
    const tile = getWorldTile(this.worldMap, Math.round(point.x), Math.round(point.y));
    if (!tile || tile.terrain === WORLD_TERRAIN.WATER) return false;
    if (tile.object && tile.object !== WORLD_OBJECT.DUNGEON) return false;
    return this.party.every((other) => other === actor || distance(other, point) >= ENTITY_CLEARANCE);
  }

  findOpenPositionsNear(origin, count) {
    const positions = [];
    for (let radius = 0; radius <= 5 && positions.length < count; radius += 1) {
      for (let y = origin.y - radius; y <= origin.y + radius && positions.length < count; y += 1) {
        for (let x = origin.x - radius; x <= origin.x + radius && positions.length < count; x += 1) {
          const point = { x, y };
          if (!this.isDungeonPointWalkable(point)) continue;
          if (this.enemies.some((enemy) => enemy.hp > 0 && distance(enemy, point) < ENTITY_CLEARANCE)) continue;
          if (positions.some((other) => distance(other, point) < ENTITY_CLEARANCE)) continue;
          positions.push(point);
        }
      }
    }
    return positions;
  }

  enterDungeon() {
    if (this.scene !== 'world' || !this.worldMap.arrived || this.data.dungeons.length === 0) return false;
    const destination = this.worldMap.destinations.find((candidate) =>
      candidate.destinationIndex === this.worldMap.activeDestinationIndex);
    this.currentDungeon = destination ? this.data.indexes.dungeonById.get(destination.dungeonId) : null;
    if (!this.currentDungeon) return false;
    this.scene = 'dungeon';
    this.floorNumber = 1;
    this.startFloor();
    this.emitEvent(`小隊進入 ${this.currentDungeon.name}`);
    this.emitSceneChange();
    return true;
  }

  startFloor() {
    const dungeon = this.currentDungeon;
    const seed = 10000 + this.dungeonRun * 100 + this.floorNumber;
    const enemyCount = this.floorNumber === 1 ? dungeon.floor1EnemyCount : dungeon.floor2EnemyCount;
    const generatorOptions = {
      width: 48,
      height: 28,
      roomCountMin: this.data.balance.roomCountMin,
      roomCountMax: this.data.balance.roomCountMax,
      roomMinSize: this.data.balance.roomMinSize,
      roomMaxSize: this.data.balance.roomMaxSize,
      roomMinArea: this.data.balance.roomMinArea,
      enemyCount: this.floorNumber === 3 ? 1 : enemyCount,
      seed
    };
    this.floor = this.floorNumber === 3
      ? generateBossFloor(generatorOptions)
      : generateDungeonFloor(generatorOptions);
    this.random = createSeededRandom(this.floor.seed + 77);
    this.partyPosition = { ...this.floor.entrance };
    this.partyNavigation = { goal: '', path: [] };
    this.formationGoal = '';
    this.formationAssignments = new Map();
    this.projectiles = [];
    this.spellEffects = [];
    this.chests = [];
    this.combatActive = false;
    this.floorCleared = false;
    this.revealedGroup = 0;
    this.floorTransitionMs = 0;
    this.enemies = this.createFloorEnemies();
    const startPositions = this.findOpenPositionsNear(this.floor.entrance, this.party.length);
    this.party.forEach((member, index) => {
      const position = startPositions[index] ?? this.floor.entrance;
      member.x = position.x;
      member.y = position.y;
      member.navigation = { goal: '', path: [] };
      member.targetRuntimeId = null;
      member.sp = member.maxSp;
      member.cooldownMs = 0;
      member.attackingMs = 0;
      member.dungeonStuckMs = 0;
    });
    this.emitEvent(this.floorNumber === 3 ? 'Boss 房已開啟' : `開始探索地下城第 ${this.floorNumber} 層`);
  }

  createFloorEnemies() {
    const dungeon = this.currentDungeon;
    const difficulty = dungeon.difficultyScale
      * (this.data.balance.dungeonDifficultyGrowth ** this.dungeonRun)
      * (1 + (this.floorNumber - 1) * 0.12);

    return this.floor.spawnPoints.map((point, index) => {
      const enemyId = this.floorNumber === 3
        ? dungeon.bossEnemyId
        : dungeon.enemyPool[Math.floor(this.random() * dungeon.enemyPool.length)];
      const config = this.data.indexes.enemyById.get(enemyId);
      const maxHp = Math.round(config.maxHp * difficulty);
      return {
        ...config,
        runtimeId: `${enemyId}-${this.floorNumber}-${index}`,
        x: point.x,
        y: point.y,
        maxHp,
        hp: maxHp,
        attack: config.attack * difficulty,
        defense: config.defense * difficulty,
        cooldownMs: 400 + index * 60,
        attackingMs: 0,
        revealGroup: point.revealGroup ?? 0,
        navigation: { goal: '', path: [] },
        targetCharacterId: null
      };
    });
  }

  togglePause() {
    this.manualPaused = !this.manualPaused;
    this.syncPausedState();
    return this.paused;
  }

  setPaused(paused) {
    this.manualPaused = Boolean(paused);
    this.syncPausedState();
  }

  syncPausedState() {
    this.paused = this.manualPaused;
  }

  update(dtMs) {
    if (this.paused) return;
    const safeDtMs = Math.min(dtMs, 250);
    const dtSeconds = safeDtMs / 1000;

    if (this.scene === 'world') {
      const wasArrived = this.worldMap.arrived;
      updateWorldTravel(this.worldMap, WORLD_MOVE_SPEED * dtSeconds);
      this.updateWorldParty(dtSeconds, safeDtMs);
      if (!wasArrived && this.worldMap.arrived) {
        const destination = this.worldMap.destinations.at(-1);
        this.emitEvent(`小隊抵達 ${destination.name}`);
        this.emitSceneChange();
      }
      return;
    }
    if (!this.floor) return;

    this.updatePartyResources(dtSeconds, safeDtMs);
    this.updateEffects(safeDtMs);
    this.updateNavigation(dtSeconds);
    this.updateCombat(safeDtMs);
    this.updateProjectiles(dtSeconds);
    this.removeDefeatedEnemies();
    this.updateChests(safeDtMs);
    this.updateDungeonReveal();
    this.updateFloorCompletion(safeDtMs);
  }

  updatePartyResources(dtSeconds, dtMs) {
    for (const member of this.party) {
      member.cooldownMs = Math.max(0, member.cooldownMs - dtMs);
      member.attackingMs = Math.max(0, member.attackingMs - dtMs);
      member.sp = Math.min(member.maxSp, member.sp + member.spRegen * dtSeconds);
      member.hp = Math.min(member.maxHp, member.hp + member.regen * dtSeconds);
    }
    for (const enemy of this.enemies) {
      enemy.cooldownMs = Math.max(0, enemy.cooldownMs - dtMs);
      enemy.attackingMs = Math.max(0, enemy.attackingMs - dtMs);
    }
  }

  updateNavigation(dtSeconds) {
    const livingEnemies = this.enemies.filter((enemy) => enemy.hp > 0 && enemy.revealGroup <= this.revealedGroup);
    this.combatActive = livingEnemies.length > 0;
    if (this.combatActive) {
      this.assignEnemyTargets(livingEnemies);
      for (const enemy of livingEnemies) this.updateEnemyMovement(enemy, dtSeconds);
      for (const member of this.party) this.updatePartyCombatMovement(member, livingEnemies, dtSeconds);
      this.partyPosition = this.averagePartyPosition();
    } else {
      const chest = this.chests
        .filter((candidate) => !candidate.collected)
        .sort((a, b) => distance(a, this.partyPosition) - distance(b, this.partyPosition))[0];
      let goal = chest ?? null;
      if (!goal && this.revealedGroup < this.floor.maxRevealGroup) {
        goal = this.floor.doorTriggers.find((door) => door.targetGroup === this.revealedGroup + 1) ?? null;
      } else if (!goal && this.floorCleared) {
        goal = this.floor.stairs;
      }
      if (goal) {
        this.ensurePartyAnchorCanReach(goal);
        this.moveActor(this.partyPosition, goal, this.data.balance.partyMoveSpeed, dtSeconds, this.partyNavigation, false);
      }
      this.updateNonCombatParty(dtSeconds, goal);
    }
    this.constrainDungeonActors();
    this.separateDungeonActors();
  }

  updateNonCombatParty(dtSeconds, goal = null) {
    const door = goal
      ? this.floor.objects.find((object) => object.type === 'door'
        && object.x === Math.round(goal.x)
        && object.y === Math.round(goal.y))
      : null;
    const offsets = door
      ? [
        { x: -door.direction.x * 1.2 - door.direction.y * 1.1, y: -door.direction.y * 1.2 + door.direction.x * 1.1 },
        { x: -door.direction.x * 1.2 + door.direction.y * 1.1, y: -door.direction.y * 1.2 - door.direction.x * 1.1 },
        { x: -door.direction.x * 2.1 - door.direction.y * 0.5, y: -door.direction.y * 2.1 + door.direction.x * 0.5 },
        { x: -door.direction.x * 2.1 + door.direction.y * 0.5, y: -door.direction.y * 2.1 - door.direction.x * 0.5 }
      ]
      : FORMATION_OFFSETS;
    const formationGoal = door ? `${door.x},${door.y},${door.targetGroup}` : '';
    if (door) {
      if (this.formationGoal !== formationGoal) {
        const orderedMembers = [...this.party]
          .sort((a, b) => distance(b, this.partyPosition) - distance(a, this.partyPosition));
        const orderedOffsets = [...offsets]
          .sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
        this.formationAssignments = new Map();
        orderedMembers.forEach((member, index) => this.formationAssignments.set(member.characterId, orderedOffsets[index]));
        this.formationGoal = formationGoal;
      }
    } else if (this.formationGoal) {
      this.formationGoal = '';
      this.formationAssignments = new Map();
    }
    const reserved = [];
    for (const [index, member] of this.party.entries()) {
      member.targetRuntimeId = null;
      const offset = this.formationAssignments.get(member.characterId) ?? offsets[index] ?? { x: 0, y: 0 };
      const preferred = { x: this.partyPosition.x + offset.x, y: this.partyPosition.y + offset.y };
      const goal = this.findNearestOpenDungeonPoint(preferred, member, reserved, 3);
      if (!goal) continue;
      reserved.push(goal);
      const previous = { x: member.x, y: member.y };
      this.moveActor(member, goal, member.speed, dtSeconds, member.navigation, true);
      if (distance(previous, member) < 0.01 && distance(member, this.partyPosition) > 3) {
        member.dungeonStuckMs += dtSeconds * 1000;
        if (member.dungeonStuckMs >= 1000) {
          const recovery = this.findNearestOpenDungeonPoint(this.partyPosition, member, reserved, 5);
          if (recovery) {
            member.x = recovery.x;
            member.y = recovery.y;
            member.navigation = { goal: '', path: [] };
          }
          member.dungeonStuckMs = 0;
        }
      } else {
        member.dungeonStuckMs = 0;
      }
    }
  }

  ensurePartyAnchorCanReach(goal) {
    const roundedGoal = { x: Math.round(goal.x), y: Math.round(goal.y) };
    const roundedAnchor = { x: Math.round(this.partyPosition.x), y: Math.round(this.partyPosition.y) };
    const anchorPath = this.isDungeonPointWalkable(roundedAnchor)
      ? findPath(this.floor.tiles, roundedAnchor, roundedGoal, {
        groups: this.floor.groups,
        maxGroup: this.revealedGroup
      })
      : [];
    if ((roundedAnchor.x === roundedGoal.x && roundedAnchor.y === roundedGoal.y) || anchorPath.length > 0) return;

    const reachable = this.party
      .map((member) => {
        const start = { x: Math.round(member.x), y: Math.round(member.y) };
        const path = this.isDungeonPointWalkable(start)
          ? findPath(this.floor.tiles, start, roundedGoal, {
            groups: this.floor.groups,
            maxGroup: this.revealedGroup
          })
          : [];
        return { member, path };
      })
      .filter(({ member, path }) => path.length > 0
        || (Math.round(member.x) === roundedGoal.x && Math.round(member.y) === roundedGoal.y))
      .sort((a, b) => a.path.length - b.path.length)[0];
    if (!reachable) return;
    this.partyPosition = { x: reachable.member.x, y: reachable.member.y };
    this.partyNavigation = { goal: '', path: [] };
  }

  assignEnemyTargets(livingEnemies) {
    for (const enemy of livingEnemies) {
      let target = this.party.find((member) => member.characterId === enemy.targetCharacterId);
      if (!target) {
        target = this.party
          .map((member) => ({ member, score: distance(enemy, member) + (member.combatStyle === 'ranged' ? -0.08 : 0) }))
          .sort((a, b) => a.score - b.score)[0]?.member;
        enemy.targetCharacterId = target?.characterId ?? null;
      }
    }
  }

  updateEnemyMovement(enemy, dtSeconds) {
    const target = this.party.find((member) => member.characterId === enemy.targetCharacterId);
    if (!target) return;
    const currentDistance = distance(enemy, target);
    if (currentDistance <= enemy.attackRange * 0.92) return;
    const goal = this.findCombatPosition(enemy, target, {
      minDistance: Math.max(ENTITY_CLEARANCE, enemy.attackRange * 0.55),
      maxDistance: Math.max(ENTITY_CLEARANCE + 0.1, enemy.attackRange * 0.88),
      enemies: [],
      preferOpen: false
    });
    if (goal) this.moveActor(enemy, goal, enemy.speed, dtSeconds, enemy.navigation, true);
  }

  updatePartyCombatMovement(member, livingEnemies, dtSeconds) {
    const target = this.selectPartyTarget(member, livingEnemies);
    member.targetRuntimeId = target?.runtimeId ?? null;
    if (!target) return;
    const currentDistance = distance(member, target);
    let goal = null;
    if (member.combatStyle === 'melee') {
      if (currentDistance > member.attackRange * 0.9) {
        goal = this.findCombatPosition(member, target, {
          minDistance: ENTITY_CLEARANCE,
          maxDistance: Math.max(ENTITY_CLEARANCE + 0.1, member.attackRange * 0.82),
          enemies: livingEnemies,
          preferOpen: false
        });
      }
    } else {
      const nearestEnemyDistance = Math.min(...livingEnemies.map((enemy) => distance(member, enemy)));
      const safeDistance = Math.min(member.attackRange * 0.78, Math.max(2.1, member.attackRange * 0.58));
      if (nearestEnemyDistance < safeDistance || currentDistance > member.attackRange * 0.92) {
        goal = this.findCombatPosition(member, target, {
          minDistance: safeDistance,
          maxDistance: member.attackRange * 0.88,
          enemies: livingEnemies,
          preferOpen: true
        });
      }
    }
    if (goal) this.moveActor(member, goal, member.speed, dtSeconds, member.navigation, true);
  }

  selectPartyTarget(member, livingEnemies) {
    const rangedIds = new Set(this.party
      .filter((candidate) => candidate.combatStyle === 'ranged')
      .map((candidate) => candidate.characterId));
    return livingEnemies
      .map((enemy) => {
        const priority = enemy.targetCharacterId === member.characterId
          ? 0
          : rangedIds.has(enemy.targetCharacterId) ? 1 : 2;
        return { enemy, priority, distance: distance(member, enemy) };
      })
      .sort((a, b) => a.priority - b.priority || a.distance - b.distance)[0]?.enemy ?? null;
  }

  findCombatPosition(actor, target, { minDistance, maxDistance, enemies, preferOpen }) {
    const desiredDistance = (minDistance + maxDistance) / 2;
    const candidates = [];
    for (let y = 0; y < this.floor.height; y += 1) {
      for (let x = 0; x < this.floor.width; x += 1) {
        const point = { x, y };
        if (!this.isDungeonPointWalkable(point) || !this.canOccupyDungeon(actor, point)) continue;
        const targetDistance = distance(point, target);
        if (targetDistance < minDistance || targetDistance > maxDistance) continue;
        const enemyClearance = enemies.length > 0
          ? Math.min(...enemies.map((enemy) => enemy === target ? targetDistance : distance(point, enemy)))
          : targetDistance;
        const crowding = this.party.reduce((score, member) => member === actor
          ? score : score + Math.max(0, 2 - distance(point, member)), 0);
        const score = Math.abs(targetDistance - desiredDistance) * 3
          + distance(actor, point) * 0.35
          + crowding * 1.8
          - (preferOpen ? enemyClearance * 0.7 : 0);
        candidates.push({ point, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.point ?? null;
  }

  findNearestOpenDungeonPoint(preferred, actor, reserved = [], radius = 3) {
    const candidates = [];
    const center = { x: Math.round(preferred.x), y: Math.round(preferred.y) };
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        const point = { x, y };
        if (!this.isDungeonPointWalkable(point) || !this.canOccupyDungeon(actor, point)) continue;
        if (reserved.some((other) => distance(other, point) < ENTITY_CLEARANCE)) continue;
        candidates.push({ point, score: distance(point, preferred) + distance(point, actor) * 0.15 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.point ?? null;
  }

  isDungeonPointWalkable(point) {
    if (!this.floor) return false;
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    return x >= 0 && y >= 0 && x < this.floor.width && y < this.floor.height
      && this.floor.tiles[y][x] !== 0
      && this.floor.groups[y][x] >= 0
      && this.floor.groups[y][x] <= this.revealedGroup;
  }

  isDungeonActorPosition(point) {
    const radius = ACTOR_FLOOR_RADIUS;
    return [
      { x: 0, y: 0 },
      { x: -radius, y: 0 },
      { x: radius, y: 0 },
      { x: 0, y: -radius },
      { x: 0, y: radius },
      { x: -radius, y: -radius },
      { x: radius, y: -radius },
      { x: -radius, y: radius },
      { x: radius, y: radius }
    ].every((offset) => this.isDungeonPointWalkable({
      x: point.x + offset.x,
      y: point.y + offset.y
    }));
  }

  constrainDungeonPosition(point) {
    const tile = { x: Math.round(point.x), y: Math.round(point.y) };
    const radius = ACTOR_FLOOR_RADIUS;
    const constrained = { ...point };
    if (!this.isDungeonPointWalkable({ x: tile.x - 1, y: tile.y })) {
      constrained.x = Math.max(constrained.x, tile.x - 0.5 + radius);
    }
    if (!this.isDungeonPointWalkable({ x: tile.x + 1, y: tile.y })) {
      constrained.x = Math.min(constrained.x, tile.x + 0.5 - radius);
    }
    if (!this.isDungeonPointWalkable({ x: tile.x, y: tile.y - 1 })) {
      constrained.y = Math.max(constrained.y, tile.y - 0.5 + radius);
    }
    if (!this.isDungeonPointWalkable({ x: tile.x, y: tile.y + 1 })) {
      constrained.y = Math.min(constrained.y, tile.y + 0.5 - radius);
    }
    if (this.isDungeonActorPosition(constrained)) return constrained;

    let safe = tile;
    let unsafe = constrained;
    for (let index = 0; index < 8; index += 1) {
      const middle = { x: (safe.x + unsafe.x) / 2, y: (safe.y + unsafe.y) / 2 };
      if (this.isDungeonActorPosition(middle)) safe = middle;
      else unsafe = middle;
    }
    return safe;
  }

  canOccupyDungeon(actor, point) {
    if (!this.isDungeonPointWalkable(point)) return false;
    const actors = [...this.party, ...this.enemies.filter((enemy) => enemy.hp > 0)];
    return actors.every((other) => other === actor || distance(other, point) >= ENTITY_CLEARANCE);
  }

  moveActor(actor, goal, speed, dtSeconds, navigation, avoidActors = true) {
    const roundedStart = { x: Math.round(actor.x), y: Math.round(actor.y) };
    const roundedGoal = { x: Math.round(goal.x), y: Math.round(goal.y) };
    if (roundedStart.x === roundedGoal.x && roundedStart.y === roundedGoal.y) {
      if (!avoidActors || this.canOccupyDungeon(actor, roundedGoal)) {
        actor.x = roundedGoal.x;
        actor.y = roundedGoal.y;
      }
      navigation.path = [];
      return;
    }
    const goalKey = positionKey(roundedGoal);
    if (navigation.goal !== goalKey || navigation.path.length === 0) {
      const blocked = avoidActors
        ? new Set([...this.party, ...this.enemies.filter((enemy) => enemy.hp > 0)]
          .filter((other) => other !== actor)
          .map((other) => positionKey(other)))
        : null;
      navigation.goal = goalKey;
      navigation.path = findPath(this.floor.tiles, roundedStart, roundedGoal, {
        groups: this.floor.groups,
        maxGroup: this.revealedGroup,
        blocked
      });
    }
    if (navigation.path.length === 0) return;

    const next = navigation.path[0];
    const dx = next.x - actor.x;
    const dy = next.y - actor.y;
    const remaining = Math.hypot(dx, dy);
    const movement = speed * dtSeconds;
    if (remaining <= movement || remaining < 0.03) {
      if (avoidActors && !this.canOccupyDungeon(actor, next)) {
        navigation.path = [];
        return;
      }
      actor.x = next.x;
      actor.y = next.y;
      navigation.path.shift();
      return;
    }
    const candidate = this.constrainDungeonPosition({
      x: actor.x + (dx / remaining) * movement,
      y: actor.y + (dy / remaining) * movement
    });
    if (!avoidActors || this.canOccupyDungeon(actor, candidate)) {
      actor.x = candidate.x;
      actor.y = candidate.y;
    } else {
      navigation.path = [];
    }
  }

  updateCombat(dtMs) {
    const livingEnemies = this.enemies.filter((enemy) => enemy.hp > 0 && enemy.revealGroup <= this.revealedGroup);
    if (livingEnemies.length === 0) return;

    for (const member of this.party) {
      if (member.cooldownMs > 0) continue;
      const basicSkill = this.data.indexes.skillById.get(member.basicSkillId);
      const healingTarget = this.lowestHealthPartyMember();
      if (basicSkill.effectType === 'heal' && healingTarget.hp / healingTarget.maxHp < 0.84 && member.sp >= basicSkill.spCost) {
        this.castHeal(member, healingTarget, basicSkill);
        continue;
      }

      const target = this.selectPartyTarget(member, livingEnemies);
      if (!target || distance(member, target) > member.attackRange) continue;
      const skillPower = member.sp >= basicSkill.spCost ? basicSkill.power : 1;
      if (member.sp >= basicSkill.spCost) member.sp -= basicSkill.spCost;
      if (member.combatStyle === 'ranged') this.launchProjectile(member, target, skillPower);
      else this.damageEnemy(member, target, skillPower);
      member.cooldownMs = Math.max(260, member.attackCooldownMs || basicSkill.cooldownMs);
      member.attackingMs = 260;
    }

    for (const enemy of livingEnemies) {
      const target = this.party.find((member) => member.characterId === enemy.targetCharacterId);
      if (!target || enemy.hp <= 0 || enemy.cooldownMs > 0 || distance(enemy, target) > enemy.attackRange) continue;
      const damage = Math.max(1, Math.round(enemy.attack - target.defense * 0.45));
      target.hp = Math.max(1, target.hp - damage);
      enemy.cooldownMs = enemy.attackCooldownMs;
      enemy.attackingMs = Math.min(300, dtMs + 220);
    }
  }

  averagePartyPosition() {
    if (this.party.length === 0) return { ...this.partyPosition };
    const total = this.party.reduce((sum, member) => ({ x: sum.x + member.x, y: sum.y + member.y }), { x: 0, y: 0 });
    return { x: total.x / this.party.length, y: total.y / this.party.length };
  }

  constrainDungeonActors() {
    for (const actor of [...this.party, ...this.enemies.filter((enemy) => enemy.hp > 0)]) {
      const constrained = this.constrainDungeonPosition(actor);
      actor.x = constrained.x;
      actor.y = constrained.y;
    }
  }

  separateActors(actors, dungeon = true) {
    for (let firstIndex = 0; firstIndex < actors.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < actors.length; secondIndex += 1) {
        const first = actors[firstIndex];
        const second = actors[secondIndex];
        const actorDistance = distance(first, second);
        if (actorDistance >= ENTITY_CLEARANCE) continue;
        const angle = actorDistance > 0.001
          ? Math.atan2(second.y - first.y, second.x - first.x)
          : (firstIndex + secondIndex) * 1.7;
        const push = ENTITY_CLEARANCE - actorDistance + 0.02;
        const candidate = dungeon ? this.constrainDungeonPosition({
          x: second.x + Math.cos(angle) * push,
          y: second.y + Math.sin(angle) * push
        }) : {
          x: second.x + Math.cos(angle) * push,
          y: second.y + Math.sin(angle) * push
        };
        const validGround = dungeon ? this.isDungeonActorPosition(candidate) : this.isWorldGround(candidate);
        const clearsOthers = actors.every((other) => other === first || other === second
          || distance(other, candidate) >= ENTITY_CLEARANCE);
        if (validGround && clearsOthers) {
          second.x = candidate.x;
          second.y = candidate.y;
        }
      }
    }
  }

  separateDungeonActors() {
    this.separateActors([...this.party, ...this.enemies.filter((enemy) => enemy.hp > 0)], true);
  }

  isWorldGround(point) {
    const tile = getWorldTile(this.worldMap, Math.round(point.x), Math.round(point.y));
    return Boolean(tile && tile.terrain !== WORLD_TERRAIN.WATER
      && (!tile.object || tile.object === WORLD_OBJECT.DUNGEON));
  }

  launchProjectile(member, target, power) {
    this.projectiles.push({
      runtimeId: `projectile-${this.runtimeSequence += 1}`,
      sourceCharacterId: member.characterId,
      targetRuntimeId: target.runtimeId,
      attackType: member.attackType,
      color: member.color,
      x: member.x,
      y: member.y,
      power,
      speed: PROJECTILE_SPEED
    });
  }

  updateProjectiles(dtSeconds) {
    const active = [];
    for (const projectile of this.projectiles) {
      const target = this.enemies.find((enemy) => enemy.runtimeId === projectile.targetRuntimeId && enemy.hp > 0);
      const source = this.party.find((member) => member.characterId === projectile.sourceCharacterId);
      if (!target || !source) continue;
      const dx = target.x - projectile.x;
      const dy = target.y - projectile.y;
      const remaining = Math.hypot(dx, dy);
      const movement = projectile.speed * dtSeconds;
      if (remaining <= movement + 0.12) {
        this.damageEnemy(source, target, projectile.power);
        continue;
      }
      projectile.x += (dx / remaining) * movement;
      projectile.y += (dy / remaining) * movement;
      active.push(projectile);
    }
    this.projectiles = active;
  }

  castHeal(caster, target, skill) {
    const amount = Math.max(1, Math.round(target.maxHp * skill.power * caster.healPower));
    target.hp = Math.min(target.maxHp, target.hp + amount);
    caster.sp -= skill.spCost;
    caster.cooldownMs = skill.cooldownMs;
    caster.attackingMs = 260;
    this.spellEffects.push({
      runtimeId: `effect-${this.runtimeSequence += 1}`,
      type: 'healPulse',
      casterCharacterId: caster.characterId,
      targetCharacterIds: [target.characterId],
      elapsedMs: 0,
      durationMs: 420,
      applied: true
    });
  }

  damageEnemy(member, enemy, power) {
    const damage = Math.max(1, Math.round(member.attack * power - enemy.defense * 0.45));
    enemy.hp -= damage;

    if (member.aoeBonus > 0) {
      for (const nearby of this.enemies) {
        if (nearby !== enemy && nearby.hp > 0 && distance(nearby, enemy) <= 2.5) {
          nearby.hp -= Math.max(1, Math.round(damage * member.aoeBonus));
        }
      }
    }
    if (member.chainBonus > 0) {
      const extra = this.enemies
        .filter((candidate) => candidate !== enemy && candidate.hp > 0)
        .sort((a, b) => distance(a, enemy) - distance(b, enemy))[0];
      if (extra) extra.hp -= Math.max(1, Math.round(damage * member.chainBonus));
    }
  }

  lowestHealthPartyMember() {
    return this.party.reduce((lowest, member) =>
      member.hp / member.maxHp < lowest.hp / lowest.maxHp ? member : lowest);
  }

  removeDefeatedEnemies() {
    const defeated = this.enemies.filter((enemy) => enemy.hp <= 0);
    if (defeated.length === 0) return;
    this.enemies = this.enemies.filter((enemy) => enemy.hp > 0);
    for (const enemy of defeated) this.handleEnemyDefeat(enemy);
  }

  handleEnemyDefeat(enemy) {
    this.emitEvent(`${enemy.name} 被擊敗，獲得 ${enemy.xp} XP`);
    for (const member of this.party) this.grantExperience(member, enemy.xp);
    const contents = this.rollLoot(enemy.lootTableId);
    if (contents.length > 0) {
      this.chests.push({
        runtimeId: `chest-${this.runtimeSequence += 1}`,
        x: enemy.x,
        y: enemy.y,
        contents,
        collected: false,
        unattendedMs: 0
      });
      this.emitEvent(`${enemy.name} 留下了一個寶箱`);
    }
  }

  grantExperience(member, amount) {
    member.xp += amount;
    while (member.xp >= member.xpToNext) {
      member.xp -= member.xpToNext;
      member.level += 1;
      member.xpToNext = Math.round(this.data.balance.xpBase * (this.data.balance.xpGrowth ** (member.level - 1)));
      member.base.maxHp = Math.round(member.base.maxHp * 1.08);
      member.base.maxSp = Math.round(member.base.maxSp * 1.04);
      member.base.attack *= 1.05;
      member.base.defense *= 1.04;
      this.recalculatePartyStats();
      this.queueLevelUp(member);
    }
  }

  queueLevelUp(member) {
    const request = {
      decisionOrder: this.runtimeSequence += 1,
      characterId: member.characterId,
      level: member.level
    };
    if (this.pendingSkillChoices.some((decision) => decision.characterId === member.characterId)) {
      this.deferredSkillChoices.push(request);
      return;
    }
    this.openSkillChoice(member, request);
  }

  openSkillChoice(member, request) {
    const choices = (this.data.indexes.skillsByPool.get(member.skillPoolId) ?? [])
      .filter((skill) => skill.skillId !== member.basicSkillId)
      .filter((skill) => skill.requiredLevel <= request.level)
      .filter((skill) => !member.learnedSkillIds.includes(skill.skillId));
    for (let index = choices.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
    }
    if (choices.length === 0) {
      member.base.attack *= 1.03;
      this.recalculatePartyStats();
      this.emitEvent(`${member.name} 升到 Lv.${request.level}，獲得固定攻擊成長`);
      this.activateNextSkillChoice(member.characterId);
      return;
    }
    const decision = {
      decisionId: `skill-${request.decisionOrder}`,
      decisionOrder: request.decisionOrder,
      characterId: member.characterId,
      characterName: member.name,
      level: request.level,
      choices: choices.slice(0, 3)
    };
    this.pendingSkillChoices.push(decision);
    this.syncPausedState();
    this.callbacks.onLevelUp({ ...member }, decision.choices);
  }

  activateNextSkillChoice(characterId) {
    const requestIndex = this.deferredSkillChoices.findIndex((request) => request.characterId === characterId);
    if (requestIndex < 0) return;
    const [request] = this.deferredSkillChoices.splice(requestIndex, 1);
    const member = this.party.find((candidate) => candidate.characterId === characterId);
    if (member) this.openSkillChoice(member, request);
  }

  chooseSkill(characterId, skillId) {
    const decision = this.pendingSkillChoices.find((candidate) => candidate.characterId === characterId
      && candidate.choices.some((choice) => choice.skillId === skillId));
    if (!decision) return false;
    const skill = decision.choices.find((choice) => choice.skillId === skillId);
    const member = this.party.find((candidate) => candidate.characterId === characterId);
    if (!skill || !member || member.learnedSkillIds.includes(skill.skillId)) return false;
    member.learnedSkillIds.push(skill.skillId);
    member.learnedSkillNames.push(skill.name);
    this.emitEvent(`${member.name} 學會「${skill.name}」`);
    this.pendingSkillChoices = this.pendingSkillChoices.filter((candidate) => candidate !== decision);
    this.recalculatePartyStats();
    this.activateNextSkillChoice(characterId);
    this.syncPausedState();
    return true;
  }

  recalculatePartyStats() {
    let partyAttackMultiplier = 1;
    let partyDefenseMultiplier = 1;
    let partyRegen = 0;

    for (const member of this.party) {
      for (const skillId of member.learnedSkillIds) {
        const skill = this.data.indexes.skillById.get(skillId);
        if (skill.targetType !== 'party') continue;
        if (skill.effectType === 'attackBuff') partyAttackMultiplier += skill.power;
        if (skill.effectType === 'defenseBuff') partyDefenseMultiplier += skill.power;
        if (skill.effectType === 'regen') partyRegen += skill.power;
      }
    }

    for (const member of this.party) {
      const oldMaxHp = member.maxHp ?? member.base.maxHp;
      const oldMaxSp = member.maxSp ?? member.base.maxSp;
      const oldHpRatio = oldMaxHp > 0 ? member.hp / oldMaxHp : 1;
      const oldSpRatio = oldMaxSp > 0 ? member.sp / oldMaxSp : 1;
      const weapon = member.equipment.weapon;
      const armor = member.equipment.armor;
      let maxHpMultiplier = 1;
      let maxSpMultiplier = 1;
      let attackMultiplier = partyAttackMultiplier;
      let defenseMultiplier = partyDefenseMultiplier;
      let cooldownMultiplier = 1;

      member.healPower = 1;
      member.regen = partyRegen;
      member.spRegen = this.data.balance.spRegenPerSecond;
      member.aoeBonus = 0;
      member.chainBonus = 0;

      for (const skillId of member.learnedSkillIds) {
        const skill = this.data.indexes.skillById.get(skillId);
        if (skill.targetType === 'party') continue;
        if (skill.effectType === 'maxHp') maxHpMultiplier += skill.power;
        else if (skill.effectType === 'maxSp') maxSpMultiplier += skill.power;
        else if (skill.effectType === 'attackBuff') attackMultiplier += skill.power;
        else if (skill.effectType === 'defenseBuff') defenseMultiplier += skill.power;
        else if (skill.effectType === 'haste') cooldownMultiplier -= skill.power;
        else if (skill.effectType === 'healPower') member.healPower += skill.power;
        else if (skill.effectType === 'regen') member.regen += skill.power;
        else if (skill.effectType === 'spRegen') member.spRegen += skill.power;
        else if (skill.effectType === 'aoeBonus') member.aoeBonus += skill.power;
        else if (skill.effectType === 'chainBonus') member.chainBonus += skill.power;
        else if (skill.effectType === 'hybridBuff') {
          maxHpMultiplier += skill.power;
          attackMultiplier += skill.power * 0.55;
        }
      }

      member.maxHp = Math.round((member.base.maxHp + (weapon?.maxHpBonus ?? 0) + (armor?.maxHpBonus ?? 0)) * maxHpMultiplier);
      member.maxSp = Math.round((member.base.maxSp + (weapon?.maxSpBonus ?? 0) + (armor?.maxSpBonus ?? 0)) * maxSpMultiplier);
      member.attack = (member.base.attack + (weapon?.attackBonus ?? 0) + (armor?.attackBonus ?? 0)) * attackMultiplier;
      member.defense = (member.base.defense + (weapon?.defenseBonus ?? 0) + (armor?.defenseBonus ?? 0)) * defenseMultiplier;
      member.attackCooldownMs = Math.max(260, member.base.attackCooldownMs * clamp(cooldownMultiplier, 0.45, 1));
      member.hp = clamp(oldHpRatio * member.maxHp, 1, member.maxHp);
      member.sp = clamp(oldSpRatio * member.maxSp, 0, member.maxSp);
      member.weaponName = weapon?.name ?? '空欄位';
      member.armorName = armor?.name ?? '空欄位';
    }
  }

  rollLoot(lootTableId) {
    const rows = this.data.indexes.lootByTable.get(lootTableId) ?? [];
    const contents = [];
    for (const loot of rows) {
      if (this.random() > loot.chance) continue;
      const quantity = loot.minQuantity + Math.floor(this.random() * (loot.maxQuantity - loot.minQuantity + 1));
      if (loot.dropType === 'item') {
        const item = this.data.indexes.itemById.get(loot.dropId);
        if (item) contents.push({ dropType: 'item', item, quantity });
      } else if (loot.dropType === 'scroll') {
        const scroll = this.data.indexes.scrollById.get(loot.dropId);
        if (scroll) contents.push({ dropType: 'scroll', scrollId: scroll.scrollId, quantity });
      }
    }
    return contents;
  }

  updateChests(dtMs) {
    const hasActiveEnemies = this.enemies.some((enemy) => enemy.hp > 0
      && enemy.revealGroup <= this.revealedGroup);
    for (const chest of this.chests) {
      if (chest.collected) continue;
      const touched = this.party.some((member) => distance(member, chest) <= PICKUP_DISTANCE);
      chest.unattendedMs = hasActiveEnemies || touched ? 0 : (chest.unattendedMs ?? 0) + dtMs;
      if (!touched && chest.unattendedMs < 3000) continue;
      this.collectChest(chest, !touched);
    }
    this.chests = this.chests.filter((chest) => !chest.collected);
  }

  collectChest(chest, automatic = false) {
    chest.collected = true;
    if (automatic) this.emitEvent('寶箱 3 秒內未被接觸，已自動收進小隊背包');
    for (const content of chest.contents) {
      if (content.dropType === 'item') this.queueEquipmentProposal(content.item);
      else {
        const scroll = this.scrolls.find((candidate) => candidate.scrollId === content.scrollId);
        if (scroll) {
          scroll.quantity += content.quantity;
          this.emitEvent(`從寶箱取得 ${scroll.name} ×${content.quantity}`);
        }
      }
    }
  }

  bestEquipmentCandidate(item) {
    return this.party
      .map((member) => ({ member, current: member.equipment[item.slot], delta: item.score - (member.equipment[item.slot]?.score ?? 0) }))
      .filter((candidate) => candidate.delta > 0)
      .sort((a, b) => b.delta - a.delta || (a.current?.score ?? 0) - (b.current?.score ?? 0))[0] ?? null;
  }

  refreshEquipmentProposals() {
    this.pendingEquipment = this.pendingEquipment.flatMap((proposal) => {
      const candidate = this.bestEquipmentCandidate(proposal.item);
      if (!candidate) return [];
      return [{
        ...proposal,
        characterId: candidate.member.characterId,
        characterName: candidate.member.name,
        oldItemName: candidate.current?.name ?? '空欄位',
        oldScore: candidate.current?.score ?? 0
      }];
    });
  }

  queueEquipmentProposal(item) {
    const candidate = this.bestEquipmentCandidate(item);
    if (!candidate) {
      this.emitEvent(`取得 ${item.name}，但目前沒有隊員需要更換`);
      return;
    }
    const { member, current } = candidate;
    const decisionOrder = this.runtimeSequence += 1;
    this.pendingEquipment.push({
      proposalId: `equipment-${decisionOrder}`,
      decisionOrder,
      characterId: member.characterId,
      characterName: member.name,
      slot: item.slot,
      oldItemName: current?.name ?? '空欄位',
      oldScore: current?.score ?? 0,
      item
    });
    this.emitEvent(`寶箱中發現 ${item.name}，等待確認是否更換`);
  }

  acceptEquipment(proposalId) {
    const proposal = this.pendingEquipment.find((candidate) => candidate.proposalId === proposalId);
    if (!proposal) return false;
    const member = this.party.find((candidate) => candidate.characterId === proposal.characterId);
    if (!member) return false;
    const current = member.equipment[proposal.slot];
    this.pendingEquipment = this.pendingEquipment.filter((candidate) => candidate.proposalId !== proposalId);
    if (proposal.item.score <= (current?.score ?? 0)) {
      this.emitEvent(`${proposal.item.name} 已不優於 ${member.name} 的目前裝備`);
      return true;
    }
    member.equipment[proposal.slot] = proposal.item;
    this.recalculatePartyStats();
    this.refreshEquipmentProposals();
    this.callbacks.onEquipment({
      characterName: member.name,
      oldItemName: current?.name ?? '空欄位',
      newItemName: proposal.item.name,
      durationMs: this.data.balance.equipmentNoticeMs
    });
    this.emitEvent(`${member.name} 裝備 ${proposal.item.name}`);
    return true;
  }

  skipDungeon() {
    if (this.scene !== 'world' || !this.worldMap.arrived || this.data.dungeons.length === 0) return false;
    const skipped = markActiveWorldDestination(this.worldMap, 'skipped');
    if (!skipped) return false;
    this.worldDestinationIndex += 1;
    const nextDungeon = this.data.dungeons[this.worldDestinationIndex % this.data.dungeons.length];
    extendWorldMap(this.worldMap, this.worldDestinationIndex, nextDungeon);
    this.initializeWorldPartyPositions();
    this.emitEvent(`小隊決定略過「${skipped.name}」，繼續尋找其他地下城`);
    this.emitSceneChange();
    return true;
  }

  useScroll(scrollId) {
    if (this.scene !== 'dungeon' || this.paused) return false;
    const scroll = this.scrolls.find((candidate) => candidate.scrollId === scrollId);
    if (!scroll || scroll.quantity <= 0) return false;
    const caster = scroll.effectType === 'partyHeal'
      ? this.party.find((member) => member.role === 'Healer') ?? this.party[0]
      : this.party.find((member) => member.combatStyle === 'ranged' && member.attackType === 'magic')
        ?? this.party.find((member) => member.combatStyle === 'ranged')
        ?? this.party[0];
    const targets = this.enemies
      .filter((enemy) => enemy.hp > 0 && enemy.revealGroup <= this.revealedGroup)
      .sort((a, b) => distance(a, caster) - distance(b, caster));
    if (scroll.effectType !== 'partyHeal' && targets.length === 0) return false;

    scroll.quantity -= 1;
    this.spellEffects.push({
      runtimeId: `effect-${this.runtimeSequence += 1}`,
      type: scroll.effectType,
      casterCharacterId: caster.characterId,
      targetRuntimeIds: scroll.effectType === 'chainDamage'
        ? targets.slice(0, 3).map((enemy) => enemy.runtimeId)
        : targets.map((enemy) => enemy.runtimeId),
      power: scroll.power,
      elapsedMs: 0,
      durationMs: scroll.effectType === 'partyHeal' ? 720 : 620,
      applied: false
    });
    caster.attackingMs = 360;
    this.emitEvent(`施放卷軸「${scroll.name}」`);
    return true;
  }

  updateEffects(dtMs) {
    const active = [];
    for (const effect of this.spellEffects) {
      effect.elapsedMs += dtMs;
      if (!effect.applied && effect.elapsedMs >= effect.durationMs * 0.72) {
        effect.applied = true;
        if (effect.type === 'aoeDamage') {
          for (const enemy of this.enemies) {
            if (effect.targetRuntimeIds.includes(enemy.runtimeId) && enemy.hp > 0) enemy.hp -= effect.power;
          }
        } else if (effect.type === 'chainDamage') {
          effect.targetRuntimeIds.forEach((runtimeId, index) => {
            const enemy = this.enemies.find((candidate) => candidate.runtimeId === runtimeId && candidate.hp > 0);
            if (enemy) enemy.hp -= effect.power * (1 - index * 0.18);
          });
        } else if (effect.type === 'partyHeal') {
          for (const member of this.party) member.hp = Math.min(member.maxHp, member.hp + effect.power);
        }
      }
      if (effect.elapsedMs < effect.durationMs) active.push(effect);
    }
    this.spellEffects = active;
  }

  updateFloorCompletion(dtMs) {
    if (!this.floorCleared && this.revealedGroup >= this.floor.maxRevealGroup && this.enemies.length === 0) {
      this.floorCleared = true;
      this.partyNavigation = { goal: '', path: [] };
      this.emitEvent(this.floorNumber === 3 ? 'Boss 已擊敗，出口開啟' : '本層已清空，樓梯解鎖');
    }
    const wholePartyAtExit = this.party.length > 0
      && this.party.every((member) => member.hp > 0)
      && distance(this.partyPosition, this.floor.stairs) <= 0.15
      && this.party.every((member) => distance(member, this.floor.stairs) <= 9.5)
      && this.partyNavigation.path.length === 0;
    if (!this.floorCleared || !wholePartyAtExit) return;
    if (this.floorTransitionMs <= 0) this.floorTransitionMs = 1000;
    else {
      this.floorTransitionMs -= dtMs;
      if (this.floorTransitionMs <= 0) this.advanceFloor();
    }
  }

  updateDungeonReveal() {
    if (this.revealedGroup >= this.floor.maxRevealGroup) return;
    const hasActiveEnemy = this.enemies.some((enemy) => enemy.hp > 0 && enemy.revealGroup <= this.revealedGroup);
    if (hasActiveEnemy) return;
    const nextGroup = this.revealedGroup + 1;
    const door = this.floor.doorTriggers.find((trigger) => trigger.targetGroup === nextGroup);
    if (!door || distance(this.partyPosition, door) > 0.18) return;
    if (!this.party.every((member) => distance(member, door) <= 5.2)) return;
    this.revealedGroup = nextGroup;
    this.partyNavigation = { goal: '', path: [] };
    this.emitEvent(`門後的第 ${nextGroup + 1} 個區域已展開`);
  }

  advanceFloor() {
    if (this.floorNumber < 3) {
      this.floorNumber += 1;
      this.startFloor();
      this.emitSceneChange();
      return;
    }
    const completedName = this.currentDungeon.name;
    markActiveWorldDestination(this.worldMap, 'completed');
    this.dungeonRun += 1;
    this.scene = 'world';
    this.floorNumber = 0;
    this.currentDungeon = null;
    this.floor = null;
    this.enemies = [];
    this.projectiles = [];
    this.spellEffects = [];
    this.chests = [];
    this.pendingEquipment = [];
    this.floorCleared = false;
    for (const member of this.party) {
      member.hp = Math.min(member.maxHp, member.hp + member.maxHp * 0.35);
      member.sp = member.maxSp;
    }
    this.worldDestinationIndex += 1;
    const nextDungeon = this.data.dungeons[this.worldDestinationIndex % this.data.dungeons.length];
    extendWorldMap(this.worldMap, this.worldDestinationIndex, nextDungeon);
    this.initializeWorldPartyPositions();
    this.emitEvent(`成功攻克 ${completedName}，回到大地圖`);
    this.emitSceneChange();
  }

  emitEvent(message) {
    this.callbacks.onEvent(message);
  }

  emitSceneChange() {
    this.callbacks.onSceneChange(this.getSnapshot());
  }

  getSnapshot() {
    return {
      scene: this.scene,
      dungeon: this.currentDungeon,
      floorNumber: this.floorNumber,
      dungeonRun: this.dungeonRun,
      worldDestinationIndex: this.worldDestinationIndex,
      worldMap: this.worldMap,
      worldTravelProgress: getWorldTravelProgress(this.worldMap),
      floor: this.floor,
      party: this.party,
      partyPosition: this.partyPosition,
      enemies: this.enemies.filter((enemy) => enemy.revealGroup <= this.revealedGroup),
      projectiles: this.projectiles,
      spellEffects: this.spellEffects,
      chests: this.chests,
      pendingEquipment: this.pendingEquipment.map((proposal) => {
        const member = this.party.find((candidate) => candidate.characterId === proposal.characterId);
        const current = member?.equipment[proposal.slot];
        return {
          ...proposal,
          oldItemName: current?.name ?? '空欄位',
          oldScore: current?.score ?? 0
        };
      }),
      pendingSkillChoices: this.pendingSkillChoices,
      combatActive: this.combatActive,
      revealedGroup: this.revealedGroup,
      scrolls: this.scrolls,
      floorCleared: this.floorCleared,
      paused: this.paused
    };
  }
}

export default GameSimulation;
