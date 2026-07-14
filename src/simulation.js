import {
  createSeededRandom,
  findPath,
  generateBossFloor,
  generateDungeonFloor
} from './dungeon.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const positionKey = (point) => `${Math.round(point.x)},${Math.round(point.y)}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    this.floorNumber = 0;
    this.currentDungeon = null;
    this.floor = null;
    this.enemies = [];
    this.partyPosition = { x: 6, y: 11 };
    this.partyNavigation = { goal: '', path: [] };
    this.floorCleared = false;
    this.floorTransitionMs = 0;
    this.manualPaused = false;
    this.paused = false;
    this.pendingLevelUps = [];
    this.activeLevelUp = null;
    this.random = createSeededRandom(Date.now());
    this.party = data.characters.map((config) => this.createPartyMember(config));
    this.scrolls = data.scrolls.map((config) => ({ ...config, quantity: config.initialQuantity }));
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

  enterDungeon() {
    if (this.scene !== 'world' || this.data.dungeons.length === 0) return false;
    this.currentDungeon = this.data.dungeons[this.dungeonRun % this.data.dungeons.length];
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
      width: 40,
      height: 22,
      roomCountMin: this.data.balance.roomCountMin,
      roomCountMax: this.data.balance.roomCountMax,
      roomMinSize: this.data.balance.roomMinSize,
      roomMaxSize: this.data.balance.roomMaxSize,
      enemyCount: this.floorNumber === 3 ? 1 : enemyCount,
      seed
    };
    this.floor = this.floorNumber === 3
      ? generateBossFloor(generatorOptions)
      : generateDungeonFloor(generatorOptions);
    this.random = createSeededRandom(this.floor.seed + 77);
    this.partyPosition = { ...this.floor.entrance };
    this.partyNavigation = { goal: '', path: [] };
    this.floorCleared = false;
    this.floorTransitionMs = 0;
    this.enemies = this.createFloorEnemies();
    this.party.forEach((member) => {
      member.sp = member.maxSp;
      member.cooldownMs = 0;
      member.attackingMs = 0;
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
        navigation: { goal: '', path: [] }
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
    this.paused = this.manualPaused || Boolean(this.activeLevelUp);
  }

  update(dtMs) {
    if (this.paused || this.scene !== 'dungeon' || !this.floor) return;
    const safeDtMs = Math.min(dtMs, 250);
    const dtSeconds = safeDtMs / 1000;

    this.updatePartyResources(dtSeconds, safeDtMs);
    this.updateNavigation(dtSeconds);
    this.updateCombat(safeDtMs);
    this.removeDefeatedEnemies();
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
    const livingEnemies = this.enemies.filter((enemy) => enemy.hp > 0);
    const target = livingEnemies.reduce((closest, enemy) => {
      const currentDistance = distance(this.partyPosition, enemy);
      return !closest || currentDistance < closest.distance ? { enemy, distance: currentDistance } : closest;
    }, null);

    if (target && target.distance > 1.25) {
      this.moveActor(
        this.partyPosition,
        target.enemy,
        this.data.balance.partyMoveSpeed,
        dtSeconds,
        this.partyNavigation
      );
    } else if (!target && this.floorCleared) {
      this.moveActor(
        this.partyPosition,
        this.floor.stairs,
        this.data.balance.partyMoveSpeed,
        dtSeconds,
        this.partyNavigation
      );
    }

    for (const enemy of livingEnemies) {
      const partyDistance = distance(enemy, this.partyPosition);
      if (partyDistance > enemy.attackRange && partyDistance < 10) {
        this.moveActor(enemy, this.partyPosition, enemy.speed, dtSeconds, enemy.navigation);
      }
    }
  }

  moveActor(actor, goal, speed, dtSeconds, navigation) {
    const roundedStart = { x: Math.round(actor.x), y: Math.round(actor.y) };
    const roundedGoal = { x: Math.round(goal.x), y: Math.round(goal.y) };
    const goalKey = positionKey(roundedGoal);
    if (navigation.goal !== goalKey || navigation.path.length === 0) {
      navigation.goal = goalKey;
      navigation.path = findPath(this.floor.tiles, roundedStart, roundedGoal);
    }
    if (navigation.path.length === 0) return;

    const next = navigation.path[0];
    const dx = next.x - actor.x;
    const dy = next.y - actor.y;
    const remaining = Math.hypot(dx, dy);
    const movement = speed * dtSeconds;
    if (remaining <= movement || remaining < 0.03) {
      actor.x = next.x;
      actor.y = next.y;
      navigation.path.shift();
      return;
    }
    actor.x += (dx / remaining) * movement;
    actor.y += (dy / remaining) * movement;
  }

  updateCombat(dtMs) {
    const livingEnemies = this.enemies.filter((enemy) => enemy.hp > 0);
    if (livingEnemies.length === 0) return;

    for (const member of this.party) {
      if (member.cooldownMs > 0) continue;
      const basicSkill = this.data.indexes.skillById.get(member.basicSkillId);
      const healingTarget = this.lowestHealthPartyMember();
      if (basicSkill.effectType === 'heal' && healingTarget.hp / healingTarget.maxHp < 0.84 && member.sp >= basicSkill.spCost) {
        this.castHeal(member, healingTarget, basicSkill);
        continue;
      }

      const target = livingEnemies.reduce((closest, enemy) => {
        const targetDistance = distance(this.partyPosition, enemy);
        return !closest || targetDistance < closest.distance ? { enemy, distance: targetDistance } : closest;
      }, null);
      if (!target || target.distance > member.attackRange) continue;
      const skillPower = member.sp >= basicSkill.spCost ? basicSkill.power : 1;
      if (member.sp >= basicSkill.spCost) member.sp -= basicSkill.spCost;
      this.damageEnemy(member, target.enemy, skillPower);
      member.cooldownMs = Math.max(260, member.attackCooldownMs || basicSkill.cooldownMs);
      member.attackingMs = 260;
    }

    for (const enemy of livingEnemies) {
      if (enemy.hp <= 0 || enemy.cooldownMs > 0 || distance(enemy, this.partyPosition) > enemy.attackRange) continue;
      const target = this.party[Math.floor(this.random() * this.party.length)];
      const damage = Math.max(1, Math.round(enemy.attack - target.defense * 0.45));
      target.hp = Math.max(1, target.hp - damage);
      enemy.cooldownMs = enemy.attackCooldownMs;
      enemy.attackingMs = Math.min(300, dtMs + 220);
    }
  }

  castHeal(caster, target, skill) {
    const amount = Math.max(1, Math.round(target.maxHp * skill.power * caster.healPower));
    target.hp = Math.min(target.maxHp, target.hp + amount);
    caster.sp -= skill.spCost;
    caster.cooldownMs = skill.cooldownMs;
    caster.attackingMs = 260;
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
    this.rollLoot(enemy.lootTableId);
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
    this.pendingLevelUps.push({ characterId: member.characterId, level: member.level });
    this.showNextLevelUp();
  }

  showNextLevelUp() {
    if (this.activeLevelUp) return;
    while (this.pendingLevelUps.length > 0) {
      const pending = this.pendingLevelUps.shift();
      const member = this.party.find((candidate) => candidate.characterId === pending.characterId);
      const choices = (this.data.indexes.skillsByPool.get(member.skillPoolId) ?? [])
        .filter((skill) => skill.skillId !== member.basicSkillId)
        .filter((skill) => skill.requiredLevel <= pending.level)
        .filter((skill) => !member.learnedSkillIds.includes(skill.skillId));
      for (let index = choices.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(this.random() * (index + 1));
        [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
      }
      if (choices.length === 0) {
        member.base.attack *= 1.03;
        this.recalculatePartyStats();
        this.emitEvent(`${member.name} 升到 Lv.${pending.level}，獲得固定攻擊成長`);
        continue;
      }
      this.activeLevelUp = {
        characterId: pending.characterId,
        level: pending.level,
        choices: choices.slice(0, 3)
      };
      this.syncPausedState();
      this.callbacks.onLevelUp({ ...member, level: pending.level }, this.activeLevelUp.choices);
      return;
    }
    this.syncPausedState();
  }

  chooseSkill(characterId, skillId) {
    if (!this.activeLevelUp || this.activeLevelUp.characterId !== characterId) return false;
    const skill = this.activeLevelUp.choices.find((choice) => choice.skillId === skillId);
    const member = this.party.find((candidate) => candidate.characterId === characterId);
    if (!skill || !member) return false;
    member.learnedSkillIds.push(skill.skillId);
    member.learnedSkillNames.push(skill.name);
    this.emitEvent(`${member.name} 學會「${skill.name}」`);
    this.activeLevelUp = null;
    this.recalculatePartyStats();
    this.showNextLevelUp();
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
    for (const loot of rows) {
      if (this.random() > loot.chance) continue;
      const quantity = loot.minQuantity + Math.floor(this.random() * (loot.maxQuantity - loot.minQuantity + 1));
      if (loot.dropType === 'item') {
        const item = this.data.indexes.itemById.get(loot.dropId);
        if (item) this.tryEquipItem(item);
      } else if (loot.dropType === 'scroll') {
        const scroll = this.scrolls.find((candidate) => candidate.scrollId === loot.dropId);
        if (scroll) {
          scroll.quantity += quantity;
          this.emitEvent(`找到 ${scroll.name} ×${quantity}`);
        }
      }
    }
  }

  tryEquipItem(item) {
    const candidates = this.party
      .map((member) => ({ member, current: member.equipment[item.slot], delta: item.score - (member.equipment[item.slot]?.score ?? 0) }))
      .filter((candidate) => candidate.delta > 0)
      .sort((a, b) => b.delta - a.delta || (a.current?.score ?? 0) - (b.current?.score ?? 0));
    if (candidates.length === 0) return;
    const { member, current } = candidates[0];
    member.equipment[item.slot] = item;
    this.recalculatePartyStats();
    this.callbacks.onEquipment({
      characterName: member.name,
      oldItemName: current?.name ?? '空欄位',
      newItemName: item.name,
      durationMs: this.data.balance.equipmentNoticeMs
    });
    this.emitEvent(`${member.name} 裝備 ${item.name}`);
  }

  useScroll(scrollId) {
    if (this.scene !== 'dungeon' || this.paused) return false;
    const scroll = this.scrolls.find((candidate) => candidate.scrollId === scrollId);
    if (!scroll || scroll.quantity <= 0) return false;
    const targets = this.enemies.filter((enemy) => enemy.hp > 0).sort((a, b) => distance(a, this.partyPosition) - distance(b, this.partyPosition));
    if (scroll.effectType !== 'partyHeal' && targets.length === 0) return false;

    scroll.quantity -= 1;
    if (scroll.effectType === 'aoeDamage') {
      for (const enemy of targets) enemy.hp -= scroll.power;
    } else if (scroll.effectType === 'chainDamage') {
      targets.slice(0, 3).forEach((enemy, index) => { enemy.hp -= scroll.power * (1 - index * 0.18); });
    } else if (scroll.effectType === 'partyHeal') {
      for (const member of this.party) member.hp = Math.min(member.maxHp, member.hp + scroll.power);
    }
    this.emitEvent(`施放卷軸「${scroll.name}」`);
    this.removeDefeatedEnemies();
    return true;
  }

  updateFloorCompletion(dtMs) {
    if (!this.floorCleared && this.enemies.length === 0) {
      this.floorCleared = true;
      this.partyNavigation = { goal: '', path: [] };
      this.emitEvent(this.floorNumber === 3 ? 'Boss 已擊敗，出口開啟' : '本層已清空，樓梯解鎖');
    }
    if (!this.floorCleared || distance(this.partyPosition, this.floor.stairs) > 0.15) return;
    if (this.floorTransitionMs <= 0) this.floorTransitionMs = 700;
    else {
      this.floorTransitionMs -= dtMs;
      if (this.floorTransitionMs <= 0) this.advanceFloor();
    }
  }

  advanceFloor() {
    if (this.floorNumber < 3) {
      this.floorNumber += 1;
      this.startFloor();
      this.emitSceneChange();
      return;
    }
    const completedName = this.currentDungeon.name;
    this.dungeonRun += 1;
    this.scene = 'world';
    this.floorNumber = 0;
    this.currentDungeon = null;
    this.floor = null;
    this.enemies = [];
    this.floorCleared = false;
    for (const member of this.party) {
      member.hp = Math.min(member.maxHp, member.hp + member.maxHp * 0.35);
      member.sp = member.maxSp;
    }
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
      floor: this.floor,
      party: this.party,
      partyPosition: this.partyPosition,
      enemies: this.enemies,
      scrolls: this.scrolls,
      floorCleared: this.floorCleared,
      paused: this.paused
    };
  }
}

export default GameSimulation;
