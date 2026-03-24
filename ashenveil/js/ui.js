/* ═══════════════════════════════════════════════════
   ui.js  —  HUD, panels, messages, inventory, skills
   Exports: UI (namespace)
════════════════════════════════════════════════════ */
const UI = (() => {

  let messages = [];
  let activePanel = null;

  /* ── Message log ─────────────────────────────── */
  function addMsg(text, type = '') {
    messages.unshift({ text, type });
    if (messages.length > 3) messages.pop();
    const log = document.getElementById('msgLog');
    log.innerHTML = messages
      .map(m => `<div class="msg ${m.type}">${m.text}</div>`)
      .join('');
  }

  /* ── Refresh all HUD elements ────────────────── */
  function refresh(player) {
    const p = player;
    if (!p) return;

    // HP bar
    const hpPct = Math.max(0, p.hp / p.maxHp * 100);
    document.getElementById('hpFill').style.width = hpPct + '%';
    document.getElementById('hpText').textContent  = `${Math.ceil(p.hp)}/${p.maxHp}`;

    // XP bar
    const xpPct = p.xp / p.xpNext * 100;
    document.getElementById('xpFill').style.width = xpPct + '%';
    document.getElementById('xpText').textContent  = `${p.xp}/${p.xpNext}`;

    // Stats
    document.getElementById('hudLevel').textContent = `LVL ${p.level}`;
    document.getElementById('hudAtk').textContent   = Player.totalAtk(p);
    document.getElementById('hudDef').textContent   = Player.totalDef(p);
    document.getElementById('hudSpd').textContent   = p.speed.toFixed(1);

    // Equipped gear names
    const w = Player.equippedWeapon(p);
    const a = Player.equippedArmor(p);
    document.getElementById('eqWeapon').textContent = w ? w.name : '—';
    document.getElementById('eqArmor').textContent  = a ? a.name : '—';

    // Skill points badge
    const sp = document.getElementById('skillPts');
    sp.textContent = p.skillPoints > 0 ? `✦ ${p.skillPoints} skill pts` : '';

    // Panel refresh if open
    if (activePanel === 'inv')    renderInventory(p);
    if (activePanel === 'skills') renderSkills(p);
  }

  /* ── Floor label ─────────────────────────────── */
  function setFloor(n) {
    document.getElementById('hudFloor').textContent = `FLOOR ${n}`;
  }

  /* ── Boss bar ────────────────────────────────── */
  function showBossBar(enemy) {
    let bar = document.getElementById('bossBarWrap');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bossBarWrap';
      bar.innerHTML = `
        <div id="bossName">${enemy.name}</div>
        <div id="bossHpBar"><div id="bossHpFill" style="width:100%"></div></div>`;
      bar.style.cssText = `
        position:absolute;top:8px;left:50%;transform:translateX(-50%);
        width:300px;display:flex;flex-direction:column;align-items:center;gap:4px;
        z-index:10;pointer-events:none;`;
      document.getElementById('canvasMount').style.position = 'relative';
      document.getElementById('canvasMount').appendChild(bar);
      // Style the bar
      const hpBar = document.getElementById('bossHpBar');
      hpBar.style.cssText = 'width:100%;height:10px;background:#2a0000;border:1px solid #8a0000;border-radius:2px;overflow:hidden;';
      const fill = document.getElementById('bossHpFill');
      fill.style.cssText = 'height:100%;background:linear-gradient(90deg,#660000,#ff2200);box-shadow:0 0 8px #ff000099;transition:width 0.3s;';
      const name = document.getElementById('bossName');
      name.style.cssText = 'font-family:Cinzel,serif;font-size:13px;color:#ff4422;text-shadow:0 0 10px #ff000088;letter-spacing:2px;';
    }
    bar.style.display = 'flex';
    updateBossBar(enemy);
  }

  function updateBossBar(enemy) {
    const fill = document.getElementById('bossHpFill');
    if (fill) fill.style.width = Math.max(0, enemy.hp / enemy.maxHp * 100) + '%';
  }

  function hideBossBar() {
    const bar = document.getElementById('bossBarWrap');
    if (bar) bar.style.display = 'none';
  }

  /* ── Panel toggle ────────────────────────────── */
  function togglePanel(id) {
    if (activePanel === id) {
      closePanel();
    } else {
      closePanel();
      activePanel = id;
      const panel = document.getElementById(id === 'inv' ? 'invPanel' : 'skillsPanel');
      panel.classList.add('open');
    }
  }

  function closePanel() {
    document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
    activePanel = null;
  }

  function isPanelOpen() { return activePanel !== null; }

  /* ── Inventory panel ─────────────────────────── */
  function renderInventory(p) {
    const list = document.getElementById('invList');
    if (!p || !list) return;

    list.innerHTML = p.inventory.map(item => {
      let statTxt = '';
      if (item.type === 'weapon')     statTxt = `ATK +${item.atk}`;
      else if (item.type === 'armor') statTxt = `DEF +${item.def}`;
      else                            statTxt = item.effect === 'heal' ? `Heal ${item.value} HP` : `Buff +${item.value}`;

      return `<div class="inv-item ${item.equipped ? 'equipped' : ''}"
                   onclick="UI.equipItemById('${item.id}')">
        <div>
          <div class="item-name">${item.equipped ? '[E] ' : ''}${item.name}</div>
          <div class="item-stat">${statTxt}</div>
        </div>
        <div class="item-rarity rarity-${item.rarity}">${item.rarity.toUpperCase()}</div>
      </div>`;
    }).join('');
  }

  function equipItemById(id) {
    const p = Game.getPlayer();
    if (!p) return;
    Player.equip(p, id);
    refresh(p);
    addMsg('Equipped item', 'loot');
  }

  /* ── Skill tree panel ────────────────────────── */
  function renderSkills(p) {
    const list = document.getElementById('skillList');
    if (!p || !list) return;

    list.innerHTML = Loot.SKILLS.map(sk => {
      const unlocked  = !!p.skills[sk.id];
      const reqMet    = !sk.requires || !!p.skills[sk.requires];
      const canAfford = p.skillPoints >= sk.cost;
      const cls       = unlocked ? 'unlocked' : (!reqMet || !canAfford) ? 'locked' : '';
      const reqLabel  = sk.requires && !p.skills[sk.requires]
        ? `<span style="color:#cc4422;font-size:9px;">Requires: ${sk.requires}</span>` : '';

      return `<div class="skill-node ${cls}" onclick="UI.unlockSkill('${sk.id}')">
        <div class="skill-icon">${sk.icon}</div>
        <div class="skill-info">
          <h3>${sk.name}</h3>
          <p>${sk.desc}</p>
          ${reqLabel}
          <span class="skill-cost">${unlocked ? '✓ Unlocked' : `Cost: ${sk.cost} pts`}</span>
        </div>
      </div>`;
    }).join('');
  }

  function unlockSkill(id) {
    const p = Game.getPlayer();
    if (!p) return;
    const sk = Loot.SKILLS.find(s => s.id === id);
    if (!sk || p.skills[id]) return;
    if (sk.requires && !p.skills[sk.requires]) { addMsg('Prerequisite not met', 'warn'); return; }
    if (p.skillPoints < sk.cost)               { addMsg('Not enough skill points', 'warn'); return; }
    p.skillPoints  -= sk.cost;
    p.skills[sk.id] = true;
    sk.apply(p);
    addMsg(`Learned: ${sk.name}`, 'level');
    refresh(p);
  }

  /* ── Screen transitions ──────────────────────── */
  function showTitle() {
    document.getElementById('titleScreen').classList.add('active');
    document.getElementById('deathScreen').classList.remove('active');
  }

  function showDeath(floor, level) {
    document.getElementById('deathScreen').classList.add('active');
    document.getElementById('deathMsg').textContent =
      `Fell on Floor ${floor} at Level ${level}. The dungeon claims another soul...`;
  }

  function hideTitleAndDeath() {
    document.getElementById('titleScreen').classList.remove('active');
    document.getElementById('deathScreen').classList.remove('active');
  }

  function clearMessages() { messages = []; document.getElementById('msgLog').innerHTML = ''; }

  return {
    addMsg,
    refresh,
    setFloor,
    showBossBar,
    updateBossBar,
    hideBossBar,
    togglePanel,
    closePanel,
    isPanelOpen,
    renderInventory,
    renderSkills,
    equipItemById,
    unlockSkill,
    showTitle,
    showDeath,
    hideTitleAndDeath,
    clearMessages,
  };

})();
