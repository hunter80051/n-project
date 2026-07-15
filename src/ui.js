const clampPercent = (value) => `${Math.max(0, Math.min(100, value))}%`;

function createMeter(label, className = '') {
  const row = document.createElement('div');
  row.className = 'meter-row';

  const name = document.createElement('span');
  name.textContent = label;

  const track = document.createElement('div');
  track.className = 'meter-track';
  const fill = document.createElement('div');
  fill.className = `meter-fill ${className}`.trim();
  track.append(fill);

  const amount = document.createElement('span');

  row.append(name, track, amount);
  return { row, fill, amount };
}

function updateMeter(meter, value, max) {
  meter.fill.style.width = clampPercent(max > 0 ? (value / max) * 100 : 0);
  meter.amount.textContent = `${Math.ceil(value)} / ${Math.ceil(max)}`;
}

export function createUI(callbacks = {}) {
  const elements = {
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingMessage: document.getElementById('loading-message'),
    errorOverlay: document.getElementById('error-overlay'),
    errorMessage: document.getElementById('error-message'),
    sceneName: document.getElementById('scene-name'),
    floorLabel: document.getElementById('floor-label'),
    progressLabel: document.getElementById('progress-label'),
    pauseButton: document.getElementById('pause-button'),
    enterButton: document.getElementById('enter-dungeon-button'),
    partyList: document.getElementById('party-list'),
    scrollList: document.getElementById('scroll-list'),
    eventLog: document.getElementById('event-log'),
    toastContainer: document.getElementById('toast-container'),
    decisionList: document.getElementById('decision-list'),
    decisionEmpty: document.getElementById('decision-empty')
  };

  elements.pauseButton.addEventListener('click', () => callbacks.onTogglePause?.());
  elements.enterButton.addEventListener('click', () => callbacks.onEnterDungeon?.());
  const scrollViews = new Map();
  const partyViews = new Map();
  let decisionRenderSignature = '';

  function bindInstantAction(button, action) {
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || button.disabled) return;
      action();
    });
    button.addEventListener('click', (event) => {
      if (event.detail !== 0 || button.disabled) return;
      action();
    });
  }

  function setLoading(loading, message = '載入 Google Sheet 相容配置中…') {
    elements.loadingMessage.textContent = message;
    elements.loadingOverlay.hidden = !loading;
  }

  function setError(message) {
    if (!message) {
      elements.errorOverlay.hidden = true;
      elements.errorMessage.textContent = '';
      return;
    }
    elements.errorMessage.textContent = String(message);
    elements.errorOverlay.hidden = false;
  }

  function updateHeader({ sceneName, floorLabel, progressLabel, canEnterDungeon = false }) {
    elements.sceneName.textContent = sceneName;
    elements.floorLabel.textContent = floorLabel;
    elements.progressLabel.textContent = progressLabel;
    elements.enterButton.hidden = !canEnterDungeon;
  }

  function renderParty(party) {
    const activeIds = new Set(party.map((member) => member.characterId));
    for (const [characterId, view] of partyViews) {
      if (activeIds.has(characterId)) continue;
      view.card.remove();
      partyViews.delete(characterId);
    }
    for (const member of party) {
      let view = partyViews.get(member.characterId);
      if (!view) {
        const card = document.createElement('article');
        const badge = document.createElement('div');
        const face = document.createElement('span');
        face.className = 'badge-face';
        const eyes = document.createElement('span');
        eyes.className = 'badge-eyes';
        const feature = document.createElement('span');
        feature.className = 'badge-feature';
        badge.append(face, eyes, feature);
        const summary = document.createElement('div');
        const line = document.createElement('div');
        line.className = 'character-line';
        const name = document.createElement('strong');
        const meta = document.createElement('span');
        line.append(name, meta);
        const hpMeter = createMeter('HP');
        const spMeter = createMeter('SP', 'sp');
        summary.append(line, hpMeter.row, spMeter.row);
        const details = document.createElement('div');
        details.className = 'character-details';
        card.append(badge, summary, details);
        view = { card, badge, name, meta, hpMeter, spMeter, details };
        partyViews.set(member.characterId, view);
        elements.partyList.append(card);
      }
      view.card.className = `party-card${member.attacking ? ' is-attacking' : ''}`;
      view.card.style.setProperty('--character-color', member.color);
      view.badge.className = `character-badge ${member.spriteId}`;
      view.badge.setAttribute('aria-label', `${member.name} 頭像`);
      view.name.textContent = member.name;
      view.meta.textContent = `Lv.${member.level} ${member.role}`;
      updateMeter(view.hpMeter, member.hp, member.maxHp);
      updateMeter(view.spMeter, member.sp, member.maxSp);
      const learned = member.learnedSkillNames.length > 0 ? member.learnedSkillNames.join('、') : '尚未學習升級技能';
      view.details.textContent = `技能：${learned}｜武器：${member.weaponName}｜防具：${member.armorName}`;
    }
  }

  function renderScrolls(scrolls) {
    const activeIds = new Set(scrolls.map((scroll) => scroll.scrollId));
    for (const [scrollId, view] of scrollViews) {
      if (activeIds.has(scrollId)) continue;
      view.button.remove();
      scrollViews.delete(scrollId);
    }
    for (const scroll of scrolls) {
      let view = scrollViews.get(scroll.scrollId);
      if (!view) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'scroll-button';
        const icon = document.createElement('span');
        icon.className = 'scroll-icon';
        const copy = document.createElement('span');
        copy.className = 'scroll-copy';
        const name = document.createElement('strong');
        const description = document.createElement('small');
        copy.append(name, description);
        const count = document.createElement('span');
        count.className = 'scroll-count';
        button.append(icon, copy, count);
        bindInstantAction(button, () => callbacks.onUseScroll?.(scroll.scrollId));
        view = { button, icon, name, description, count };
        scrollViews.set(scroll.scrollId, view);
        elements.scrollList.append(button);
      }
      view.button.disabled = scroll.disabled || scroll.quantity <= 0;
      view.icon.textContent = scroll.effectType === 'partyHeal' ? '✦' : scroll.effectType === 'chainDamage' ? 'ϟ' : '✹';
      view.name.textContent = scroll.name;
      view.description.textContent = scroll.description;
      view.count.textContent = `×${scroll.quantity}`;
    }
  }

  function pushEvent(message) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.textContent = message;
    elements.eventLog.prepend(row);
    while (elements.eventLog.children.length > 40) elements.eventLog.lastElementChild.remove();
  }

  function showEquipmentNotice({ characterName, oldItemName, newItemName, durationMs = 3500 }) {
    const toast = document.createElement('div');
    toast.className = 'equipment-toast';
    toast.textContent = `${characterName} 裝備替換：${oldItemName || '空欄位'} → ${newItemName}`;
    elements.toastContainer.append(toast);
    window.setTimeout(() => toast.remove(), durationMs);
  }

  function renderDecisions(decisions) {
    const ordered = [...decisions].sort((a, b) => a.decisionOrder - b.decisionOrder);
    const signature = JSON.stringify(ordered.map((decision) => decision.kind === 'skill'
      ? [decision.kind, decision.decisionId, decision.characterId, decision.level,
        decision.choices.map((skill) => skill.skillId)]
      : [decision.kind, decision.proposalId, decision.characterId, decision.oldScore,
        decision.item.itemId, decision.item.score]));
    if (signature === decisionRenderSignature) return;
    decisionRenderSignature = signature;
    const cards = ordered.map((decision) => {
      if (decision.kind === 'equipment') {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'decision-card equipment-decision';
        const type = document.createElement('span');
        type.className = 'decision-type';
        type.textContent = '裝備';
        const title = document.createElement('strong');
        title.textContent = `${decision.characterName}｜${decision.slot === 'weapon' ? '武器' : '防具'}`;
        const change = document.createElement('span');
        change.textContent = `${decision.oldItemName} → ${decision.item.name}`;
        const score = document.createElement('small');
        score.textContent = `評分 ${decision.oldScore} → ${decision.item.score}｜點擊立即換裝`;
        card.append(type, title, change, score);
        bindInstantAction(card, () => callbacks.onAcceptEquipment?.(decision.proposalId));
        return card;
      }

      const card = document.createElement('article');
      card.className = 'decision-card skill-decision';
      const type = document.createElement('span');
      type.className = 'decision-type';
      type.textContent = '技能';
      const title = document.createElement('strong');
      title.textContent = `${decision.characterName} 升到 Lv.${decision.level}`;
      const options = document.createElement('div');
      options.className = 'decision-skill-options';
      for (const skill of decision.choices) {
        const button = document.createElement('button');
        button.type = 'button';
        const name = document.createElement('strong');
        name.textContent = skill.name;
        const description = document.createElement('small');
        description.textContent = skill.description;
        button.append(name, description);
        bindInstantAction(button, () => callbacks.onChooseSkill?.(decision.characterId, skill.skillId));
        options.append(button);
      }
      card.append(type, title, options);
      return card;
    });
    elements.decisionList.replaceChildren(...cards);
    elements.decisionEmpty.hidden = cards.length > 0;
  }

  function setPaused(paused) {
    elements.pauseButton.textContent = paused ? '繼續' : '暫停';
    elements.pauseButton.setAttribute('aria-pressed', String(paused));
  }

  return {
    setLoading,
    setError,
    updateHeader,
    renderParty,
    renderScrolls,
    pushEvent,
    showEquipmentNotice,
    renderDecisions,
    setPaused
  };
}
