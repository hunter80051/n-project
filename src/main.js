import { loadGameData } from './data-loader.js';
import { GameRenderer } from './renderer.js';
import { GameSimulation } from './simulation.js';
import { createUI } from './ui.js';

let simulation = null;
let renderer = null;
let lastUiUpdate = 0;

const ui = createUI({
  onEnterDungeon() {
    if (simulation?.enterDungeon()) updateUi(simulation.getSnapshot());
  },
  onTogglePause() {
    if (!simulation) return;
    simulation.togglePause();
    updateUi(simulation.getSnapshot());
  },
  onUseScroll(scrollId) {
    if (simulation?.useScroll(scrollId)) updateUi(simulation.getSnapshot());
  },
  onChooseSkill(characterId, skillId) {
    if (!simulation?.chooseSkill(characterId, skillId)) return false;
    updateUi(simulation.getSnapshot());
    return Boolean(simulation.activeLevelUp);
  }
});

function updateUi(snapshot) {
  if (!snapshot) return;
  if (snapshot.scene === 'world') {
    const nextDungeon = simulation.data.dungeons[snapshot.dungeonRun % simulation.data.dungeons.length];
    const travelPercent = Math.round(snapshot.worldTravelProgress * 100);
    ui.updateHeader({
      sceneName: '朋友們的冒險地圖',
      floorLabel: snapshot.worldMap.arrived ? '已抵達入口' : '大地圖移動中',
      progressLabel: `已攻克 ${snapshot.dungeonRun} 座｜${nextDungeon.name} ${travelPercent}%`,
      canEnterDungeon: snapshot.worldMap.arrived
    });
  } else {
    ui.updateHeader({
      sceneName: snapshot.dungeon.name,
      floorLabel: `第 ${snapshot.floorNumber} / 3 層`,
      progressLabel: snapshot.floorCleared ? '本層已清空，前往樓梯' : `剩餘敵人 ${snapshot.enemies.length}`,
      canEnterDungeon: false
    });
  }

  ui.setPaused(snapshot.paused);
  ui.renderParty(snapshot.party.map((member) => ({
    characterId: member.characterId,
    name: member.name,
    role: member.role,
    color: member.color,
    level: member.level,
    hp: member.hp,
    maxHp: member.maxHp,
    sp: member.sp,
    maxSp: member.maxSp,
    attacking: member.attackingMs > 0,
    learnedSkillNames: member.learnedSkillNames,
    weaponName: member.weaponName,
    armorName: member.armorName
  })));
  ui.renderScrolls(snapshot.scrolls.map((scroll) => ({
    scrollId: scroll.scrollId,
    name: scroll.name,
    description: scroll.description,
    effectType: scroll.effectType,
    quantity: scroll.quantity,
    disabled: snapshot.scene !== 'dungeon'
      || snapshot.paused
      || (scroll.effectType !== 'partyHeal' && snapshot.enemies.length === 0)
  })));
}

async function start() {
  ui.setLoading(true, '載入外部 CSV 與建立 ID 索引中…');
  try {
    const data = await loadGameData();
    const canvas = document.getElementById('game-canvas');
    renderer = new GameRenderer(canvas, data);
    simulation = new GameSimulation(data, {
      onEvent: (message) => ui.pushEvent(message),
      onEquipment: (notice) => ui.showEquipmentNotice(notice),
      onLevelUp: (character, choices) => {
        updateUi(simulation.getSnapshot());
        ui.showSkillChoices(character, choices);
      },
      onSceneChange: (snapshot) => updateUi(snapshot)
    });

    updateUi(simulation.getSnapshot());
    renderer.render(simulation.getSnapshot(), performance.now());
    ui.pushEvent('外部配置載入完成，固定小隊已在大地圖集合');
    ui.setError(null);
    ui.setLoading(false);

    let lastTime = performance.now();
    let accumulator = 0;
    const stepMs = data.balance.simulationStepMs;

    function frame(time) {
      const elapsed = Math.min(250, Math.max(0, time - lastTime));
      lastTime = time;
      accumulator += elapsed;

      let steps = 0;
      while (accumulator >= stepMs && steps < 8) {
        simulation.update(stepMs);
        accumulator -= stepMs;
        steps += 1;
      }
      if (steps === 8) accumulator = 0;

      const snapshot = simulation.getSnapshot();
      renderer.render(snapshot, time);
      if (time - lastUiUpdate >= 100) {
        updateUi(snapshot);
        lastUiUpdate = time;
      }
      window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
    window.GamePrototype = {
      getSnapshot: () => simulation.getSnapshot(),
      enterDungeon: () => simulation.enterDungeon(),
      useScroll: (scrollId) => simulation.useScroll(scrollId)
    };
  } catch (error) {
    console.error(error);
    ui.setLoading(false);
    ui.setError(error.message);
  }
}

start();
