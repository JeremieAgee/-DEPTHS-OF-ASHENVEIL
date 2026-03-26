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
  /* ── Pause Menu ──────────────────────────────── */
function buildPauseMenu() {
  if (document.getElementById('pauseMenu')) return;

  const menu = document.createElement('div');
  menu.id = 'pauseMenu';
 menu.style.cssText = `
  display:none;position:fixed;inset:0;z-index:100;
  background:rgba(0,0,0,0.75);
  backdrop-filter:blur(6px);
  -webkit-backdrop-filter:blur(6px);
  flex-direction:row;align-items:stretch;justify-content:center;
  font-family:'Cinzel',serif;
`;

  menu.innerHTML =  `
  <div id="pauseSidebar" style="
  width:200px;background:#1c1c1c;border-right:2px solid #444;
  display:flex;flex-direction:column;padding:2rem 0;gap:2px;
  min-height:0;max-height:100vh;overflow-y:auto;">
    <div style="color:#ffffff;font-size:14px;letter-spacing:4px;padding:0 1.5rem 1.5rem;font-weight:700;">PAUSED</div>
    <button class="pmenu-tab active" data-tab="items"    onclick="UI.pauseTab('items')">⚔ Items</button>
    <button class="pmenu-tab"        data-tab="skills"   onclick="UI.pauseTab('skills')">✦ Skills</button>
    <button class="pmenu-tab"        data-tab="upgrades" onclick="UI.pauseTab('upgrades')">▲ Upgrades</button>
    <div style="flex:1"></div>
    <button class="pmenu-exit" onclick="UI.closePauseMenu();Game.start()">↺ Restart</button>
    <button class="pmenu-exit danger" onclick="location.reload()">✕ Quit</button>
  </div>
  <div id="pauseContent" style="
  flex:1;max-width:600px;overflow-y:auto;padding:2rem;
  color:#e8e8e8;font-family:inherit;background:#242424;
  min-height:0;max-height:100vh;">
  </div>
`;

  document.body.appendChild(menu);

  // Styles
  const style = document.createElement('style');
  style.textContent = `
  .pmenu-tab {
    background:none;border:none;color:#aaaaaa;
    font-family:'Cinzel',serif;font-size:13px;letter-spacing:1px;
    padding:0.8rem 1.5rem;text-align:left;cursor:pointer;
    border-left:3px solid transparent;transition:all 0.15s;
    width:100%;
  }
  .pmenu-tab:hover  { color:#ffffff;background:rgba(255,255,255,0.08); }
  .pmenu-tab.active { color:#f0c060;border-left-color:#f0c060;background:rgba(240,192,96,0.1); }
  .pmenu-exit {
    background:none;border:none;color:#888;
    font-family:'Cinzel',serif;font-size:12px;letter-spacing:1px;
    padding:0.6rem 1.5rem;text-align:left;cursor:pointer;
    transition:color 0.15s;width:100%;
  }
  .pmenu-exit:hover { color:#ffffff; }
  .pmenu-exit.danger:hover { color:#ff4444; }
  #pauseContent h2 {
    color:#f0c060;font-size:14px;letter-spacing:2px;
    margin:0 0 1rem;border-bottom:1px solid #444;padding-bottom:0.6rem;
  }
  .pm-item {
    display:flex;justify-content:space-between;align-items:center;
    padding:0.7rem 0.9rem;margin-bottom:5px;
    background:#2e2e2e;border:1px solid #444;cursor:pointer;
    transition:border-color 0.15s;border-radius:3px;
  }
  .pm-item:hover    { border-color:#f0c060;background:#353535; }
  .pm-item.equipped { border-color:#66bb66;background:#2a3a2a; }
  .pm-item .iname   { font-size:13px;color:#e8e8e8; }
  .pm-item .istat   { font-size:11px;color:#aaaaaa;margin-top:2px; }
  .pm-item .irarity { font-size:10px;letter-spacing:1px; }
  .rarity-common    { color:#aaaaaa; }
  .rarity-uncommon  { color:#66dd66; }
  .rarity-rare      { color:#6699ff; }
  .rarity-epic      { color:#cc66ff; }
  .rarity-legendary { color:#ffaa33; }
  .pm-skill {
    display:flex;gap:1rem;padding:0.8rem;margin-bottom:6px;
    background:#2e2e2e;border:1px solid #444;border-radius:3px;cursor:pointer;
    transition:border-color 0.15s;
  }
  .pm-skill:hover:not(.locked) { border-color:#f0c060; }
  .pm-skill.unlocked { border-color:#66bb66;background:#2a3a2a; }
  .pm-skill.locked   { opacity:0.4;cursor:not-allowed; }
  .pm-skill .sicon   { font-size:24px;line-height:1;min-width:28px; }
  .pm-skill .sname   { font-size:13px;color:#e8e8e8;margin-bottom:3px; }
  .pm-skill .sdesc   { font-size:11px;color:#aaaaaa; }
  .pm-skill .scost   { font-size:11px;color:#f0c060;margin-top:4px; }
  .pm-upgrade {
    display:flex;justify-content:space-between;align-items:center;
    padding:0.8rem;margin-bottom:6px;
    background:#2e2e2e;border:1px solid #444;border-radius:3px;
  }
  .pm-upgrade .uinfo { font-size:13px;color:#e8e8e8; }
  .pm-upgrade .udesc { font-size:11px;color:#aaaaaa;margin-top:3px; }
  .pm-upgrade button {
    background:#333;border:1px solid #f0c060;color:#f0c060;
    font-family:'Cinzel',serif;font-size:11px;letter-spacing:1px;
    padding:6px 14px;cursor:pointer;white-space:nowrap;
    transition:all 0.15s;border-radius:2px;
  }
  .pm-upgrade button:hover    { background:#f0c060;color:#000; }
  .pm-upgrade button:disabled { border-color:#555;color:#555;cursor:default;background:none; }
`;style.textContent = `
  .pmenu-tab {
    background:none;border:none;color:#aaaaaa;
    font-family:'Cinzel',serif;font-size:13px;letter-spacing:1px;
    padding:0.8rem 1.5rem;text-align:left;cursor:pointer;
    border-left:3px solid transparent;transition:all 0.15s;
    width:100%;
  }
  .pmenu-tab:hover  { color:#ffffff;background:rgba(255,255,255,0.08); }
  .pmenu-tab.active { color:#f0c060;border-left-color:#f0c060;background:rgba(240,192,96,0.1); }
  .pmenu-exit {
    background:none;border:none;color:#888;
    font-family:'Cinzel',serif;font-size:12px;letter-spacing:1px;
    padding:0.6rem 1.5rem;text-align:left;cursor:pointer;
    transition:color 0.15s;width:100%;
  }
  .pmenu-exit:hover { color:#ffffff; }
  .pmenu-exit.danger:hover { color:#ff4444; }
  #pauseContent h2 {
    color:#f0c060;font-size:14px;letter-spacing:2px;
    margin:0 0 1rem;border-bottom:1px solid #444;padding-bottom:0.6rem;
  }
  .pm-item {
    display:flex;justify-content:space-between;align-items:center;
    padding:0.7rem 0.9rem;margin-bottom:5px;
    background:#2e2e2e;border:1px solid #444;cursor:pointer;
    transition:border-color 0.15s;border-radius:3px;
  }
  .pm-item:hover    { border-color:#f0c060;background:#353535; }
  .pm-item.equipped { border-color:#66bb66;background:#2a3a2a; }
  .pm-item .iname   { font-size:13px;color:#e8e8e8; }
  .pm-item .istat   { font-size:11px;color:#aaaaaa;margin-top:2px; }
  .pm-item .irarity { font-size:10px;letter-spacing:1px; }
  .rarity-common    { color:#aaaaaa; }
  .rarity-uncommon  { color:#66dd66; }
  .rarity-rare      { color:#6699ff; }
  .rarity-epic      { color:#cc66ff; }
  .rarity-legendary { color:#ffaa33; }
  .pm-skill {
    display:flex;gap:1rem;padding:0.8rem;margin-bottom:6px;
    background:#2e2e2e;border:1px solid #444;border-radius:3px;cursor:pointer;
    transition:border-color 0.15s;
  }
  .pm-skill:hover:not(.locked) { border-color:#f0c060; }
  .pm-skill.unlocked { border-color:#66bb66;background:#2a3a2a; }
  .pm-skill.locked   { opacity:0.4;cursor:not-allowed; }
  .pm-skill .sicon   { font-size:24px;line-height:1;min-width:28px; }
  .pm-skill .sname   { font-size:13px;color:#e8e8e8;margin-bottom:3px; }
  .pm-skill .sdesc   { font-size:11px;color:#aaaaaa; }
  .pm-skill .scost   { font-size:11px;color:#f0c060;margin-top:4px; }
  .pm-upgrade {
    display:flex;justify-content:space-between;align-items:center;
    padding:0.8rem;margin-bottom:6px;
    background:#2e2e2e;border:1px solid #444;border-radius:3px;
  }
  .pm-upgrade .uinfo { font-size:13px;color:#e8e8e8; }
  .pm-upgrade .udesc { font-size:11px;color:#aaaaaa;margin-top:3px; }
  .pm-upgrade button {
    background:#333;border:1px solid #f0c060;color:#f0c060;
    font-family:'Cinzel',serif;font-size:11px;letter-spacing:1px;
    padding:6px 14px;cursor:pointer;white-space:nowrap;
    transition:all 0.15s;border-radius:2px;
  }
  .pm-upgrade button:hover    { background:#f0c060;color:#000; }
  .pm-upgrade button:disabled { border-color:#555;color:#555;cursor:default;background:none; }
`;
  document.head.appendChild(style);
}

let pauseActiveTab = 'items';

function openPauseMenu() {
  buildPauseMenu();
  document.getElementById('pauseMenu').style.display = 'flex';
  pauseTab(pauseActiveTab);
}

function closePauseMenu() {
  const m = document.getElementById('pauseMenu');
  if (m) m.style.display = 'none';
}

function isPauseMenuOpen() {
  const m = document.getElementById('pauseMenu');
  return m && m.style.display === 'flex';
}

function pauseTab(tab) {
  pauseActiveTab = tab;
  document.querySelectorAll('.pmenu-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const content = document.getElementById('pauseContent');
  const p = Game.getPlayer();
  if (!p) return;

  if (tab === 'items') {
    content.innerHTML = `<h2>INVENTORY</h2>` + (p.inventory.length === 0 ? '<p style="color:#4a3a2a">Nothing yet.</p>' :
      p.inventory.map(item => {
        let stat = item.type === 'weapon' ? `ATK +${item.atk}` :
                   item.type === 'armor'  ? `DEF +${item.def}` :
                   item.effect === 'heal' ? `Heal ${item.value} HP` : `Buff +${item.value}`;
        return `<div class="pm-item ${item.equipped ? 'equipped' : ''}" onclick="UI.equipItemById('${item.id}');UI.pauseTab('items')">
          <div><div class="iname">${item.equipped ? '[E] ' : ''}${item.name}</div>
               <div class="istat">${stat}</div></div>
          <div class="irarity rarity-${item.rarity}">${item.rarity.toUpperCase()}</div>
        </div>`;
      }).join(''));

  } else if (tab === 'skills') {
    content.innerHTML = `<h2>SKILLS &nbsp;<span style="color:#446644;font-size:11px">${p.skillPoints} point${p.skillPoints !== 1 ? 's' : ''} available</span></h2>` +
      Loot.SKILLS.map(sk => {
        const unlocked  = !!p.skills[sk.id];
        const reqMet    = !sk.requires || !!p.skills[sk.requires];
        const canAfford = p.skillPoints >= sk.cost;
        const cls       = unlocked ? 'unlocked' : (!reqMet || !canAfford) ? 'locked' : '';
        const costLabel = unlocked ? '✓ Unlocked' : `Cost: ${sk.cost} pts`;
        const req       = sk.requires && !p.skills[sk.requires] ? `<span style="color:#cc4422;font-size:10px">Requires: ${sk.requires}</span>` : '';
        return `<div class="pm-skill ${cls}" onclick="UI.unlockSkill('${sk.id}');UI.pauseTab('skills')">
          <div class="sicon">${sk.icon}</div>
          <div><div class="sname">${sk.name}</div>
               <div class="sdesc">${sk.desc}</div>
               ${req}<div class="scost">${costLabel}</div></div>
        </div>`;
      }).join('');

  } else if (tab === 'upgrades') {
    const upgrades = [
      { id:'hp',    label:'Max HP +20',       desc:`Current: ${p.maxHp} HP`,      cost:3, apply: p => { p.maxHp += 20; p.hp = Math.min(p.hp + 20, p.maxHp); } },
      { id:'atk',   label:'Attack +5',        desc:`Current: ${Player.totalAtk(p)} ATK`, cost:3, apply: p => { p.atk += 5; } },
      { id:'def',   label:'Defense +3',       desc:`Current: ${Player.totalDef(p)} DEF`, cost:2, apply: p => { p.def += 3; } },
      { id:'spd',   label:'Speed +0.5',       desc:`Current: ${p.speed.toFixed(1)} SPD`, cost:2, apply: p => { p.speed += 0.5; } },
      { id:'crit',  label:'Crit Chance +5%',  desc:`Current: ${Math.round(p.critChance*100)}%`, cost:3, apply: p => { p.critChance = Math.min(0.75, p.critChance + 0.05); } },
      { id:'life',  label:'Lifesteal +3%',    desc:`Current: ${Math.round(p.lifesteal*100)}%`,  cost:4, apply: p => { p.lifesteal = Math.min(0.3, p.lifesteal + 0.03); } },
    ];
    content.innerHTML = `<h2>UPGRADES &nbsp;<span style="color:#446644;font-size:11px">${p.skillPoints} point${p.skillPoints !== 1 ? 's' : ''} available</span></h2>` +
      upgrades.map(u => `
        <div class="pm-upgrade">
          <div><div class="uinfo">${u.label}</div><div class="udesc">${u.desc}</div></div>
          <button onclick="UI.buyUpgrade('${u.id}')" ${p.skillPoints < u.cost ? 'disabled' : ''}>${u.cost} pts</button>
        </div>`).join('');
  }
}

function buyUpgrade(id) {
  const p = Game.getPlayer();
  if (!p) return;
  const upgrades = {
    hp:   { cost:3, apply: p => { p.maxHp += 20; p.hp = Math.min(p.hp + 20, p.maxHp); } },
    atk:  { cost:3, apply: p => { p.atk += 5; } },
    def:  { cost:2, apply: p => { p.def += 3; } },
    spd:  { cost:2, apply: p => { p.speed += 0.5; } },
    crit: { cost:3, apply: p => { p.critChance = Math.min(0.75, p.critChance + 0.05); } },
    life: { cost:4, apply: p => { p.lifesteal = Math.min(0.3, p.lifesteal + 0.03); } },
  };
  const u = upgrades[id];
  if (!u || p.skillPoints < u.cost) return;
  p.skillPoints -= u.cost;
  u.apply(p);
  addMsg(`Upgraded: ${id}`, 'level');
  pauseTab('upgrades'); // re-render with new values
  refresh(p);
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
    openPauseMenu,
    closePauseMenu,
    isPauseMenuOpen,
    pauseTab,
    buyUpgrade,
    renderSkills,
    equipItemById,
    unlockSkill,
    showTitle,
    showDeath,
    hideTitleAndDeath,
    clearMessages,
  };

})();
