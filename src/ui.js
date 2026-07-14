const clampPercent = (value) => `${Math.max(0, Math.min(100, value))}%`;

function createMeter(label, value, max, className = '') {
  const row = document.createElement('div');
  row.className = 'meter-row';

  const name = document.createElement('span');
  name.textContent = label;

  const track = document.createElement('div');
  track.className = 'meter-track';
  const fill = document.createElement('div');
  fill.className = `meter-fill ${className}`.trim();
  fill.style.width = clampPercent(max > 0 ? (value / max) * 100 : 0);
  track.append(fill);

  const amount = document.createElement('span');
  amount.textContent = `${Math.ceil(value)} / ${Math.ceil(max)}`;

  row.append(name, track, amount);
  return row;
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
    skillModal: document.getElementById('skill-modal'),
    skillTitle: document.getElementById('skill-modal-title'),
    skillDescription: document.getElementById('skill-modal-description'),
    skillChoices: document.getElementById('skill-choice-list')
  };

  elements.pauseButton.addEventListener('click', () => callbacks.onTogglePause?.());
  elements.enterButton.addEventListener('click', () => callbacks.onEnterDungeon?.());

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
    const cards = party.map((member) => {
      const card = document.createElement('article');
      card.className = `party-card${member.attacking ? ' is-attacking' : ''}`;
      card.style.setProperty('--character-color', member.color);

      const badge = document.createElement('div');
      badge.className = 'character-badge';
      badge.textContent = member.name.slice(0, 1);

      const summary = document.createElement('div');
      const line = document.createElement('div');
      line.className = 'character-line';
      const name = document.createElement('strong');
      name.textContent = member.name;
      const meta = document.createElement('span');
      meta.textContent = `Lv.${member.level} ${member.role}`;
      line.append(name, meta);
      summary.append(line, createMeter('HP', member.hp, member.maxHp), createMeter('SP', member.sp, member.maxSp, 'sp'));

      const details = document.createElement('div');
      details.className = 'character-details';
      const learned = member.learnedSkillNames.length > 0 ? member.learnedSkillNames.join('、') : '尚未學習升級技能';
      details.textContent = `技能：${learned}｜武器：${member.weaponName}｜防具：${member.armorName}`;

      card.append(badge, summary, details);
      return card;
    });
    elements.partyList.replaceChildren(...cards);
  }

  function renderScrolls(scrolls) {
    const buttons = scrolls.map((scroll) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scroll-button';
      button.disabled = scroll.disabled || scroll.quantity <= 0;
      button.addEventListener('click', () => callbacks.onUseScroll?.(scroll.scrollId));

      const icon = document.createElement('span');
      icon.className = 'scroll-icon';
      icon.textContent = scroll.effectType === 'partyHeal' ? '✦' : scroll.effectType === 'chainDamage' ? 'ϟ' : '✹';

      const copy = document.createElement('span');
      copy.className = 'scroll-copy';
      const name = document.createElement('strong');
      name.textContent = scroll.name;
      const description = document.createElement('small');
      description.textContent = scroll.description;
      copy.append(name, description);

      const count = document.createElement('span');
      count.className = 'scroll-count';
      count.textContent = `×${scroll.quantity}`;
      button.append(icon, copy, count);
      return button;
    });
    elements.scrollList.replaceChildren(...buttons);
  }

  function pushEvent(message) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.textContent = message;
    elements.eventLog.prepend(row);
    while (elements.eventLog.children.length > 8) elements.eventLog.lastElementChild.remove();
  }

  function showSkillChoices(character, skills) {
    elements.skillTitle.textContent = `${character.name} 升到 Lv.${character.level}`;
    elements.skillDescription.textContent = '選擇一項技能立即學習，冒險會在選擇後繼續。';
    const cards = skills.map((skill) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skill-card';
      const name = document.createElement('strong');
      name.textContent = skill.name;
      const description = document.createElement('span');
      description.textContent = skill.description;
      button.append(name, description);
      button.addEventListener('click', () => {
        const keepOpen = callbacks.onChooseSkill?.(character.characterId, skill.skillId);
        if (!keepOpen) elements.skillModal.close();
      });
      return button;
    });
    elements.skillChoices.replaceChildren(...cards);
    if (!elements.skillModal.open) elements.skillModal.showModal();
  }

  function showEquipmentNotice({ characterName, oldItemName, newItemName, durationMs = 3500 }) {
    const toast = document.createElement('div');
    toast.className = 'equipment-toast';
    toast.textContent = `${characterName} 裝備替換：${oldItemName || '空欄位'} → ${newItemName}`;
    elements.toastContainer.append(toast);
    window.setTimeout(() => toast.remove(), durationMs);
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
    showSkillChoices,
    showEquipmentNotice,
    setPaused
  };
}
