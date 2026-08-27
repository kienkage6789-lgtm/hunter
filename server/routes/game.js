const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/queries');
const worldManager = require('../game/WorldManager');
const combatEngine = require('../game/CombatEngine');
const dropSystem = require('../game/DropSystem');

const router = express.Router();

// Load spots cache
let spotsCache = {};
try {
  const spotsPath = path.join(__dirname, '..', '..', 'data', 'spots_cache.json');
  spotsCache = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));
} catch (err) {
  console.error("Lỗi đọc spots_cache.json", err);
}

// Hàm tính EXP cần để lên cấp của hero
function expNextHero(lv) {
  if (lv < 41) {
    let e = 100;
    for (let k = 2; k <= lv; k++) {
      const b = k <= 10 ? 1.50 : k <= 20 ? 1.45 : k <= 30 ? 1.40 : 1.35;
      e = Math.round(e * b);
    }
    return e;
  }
  let e = 100000000;
  for (let k = 42; k <= lv; k++) {
    e += (k >= 60 ? 120000000 : (k >= 55 ? 160000000 : (k >= 50 ? 80000000 : 15000000)));
  }
  return e;
}

function expNext(lv) {
  if (lv >= 41) return 100000000 + (lv - 41) * 15000000;
  let e = 100;
  for (let k = 2; k <= lv; k++) {
    const b = k <= 10 ? 1.50 : k <= 20 ? 1.45 : k <= 30 ? 1.40 : 1.35;
    e = Math.round(e * b);
  }
  return e;
}

function getPetLv(exp) {
  let lv = 1, e = Math.max(0, Math.floor(Number(exp) || 0));
  while (lv < 99) {
    const need = expNext(lv);
    if (e < need) break;
    e -= need;
    lv++;
  }
  return lv;
}

function getDvLv(exp) {
  let lv = 1, e = Math.max(0, Math.floor(Number(exp) || 0));
  while (lv < 99) {
    const need = expNextHero(lv) * 10;
    if (e < need) break;
    e -= need;
    lv++;
  }
  return lv;
}

function getEq2Worn(playerObj) {
  const e = playerObj.eq2;
  if (e && typeof e === 'object' && !Array.isArray(e)) return e;
  if (typeof e === 'string') {
    try {
      return JSON.parse(e || '{}') || {};
    } catch (err) {}
  }
  return {};
}

function getEq2AfArr(af) {
  if (Array.isArray(af)) return af;
  if (typeof af === 'string') {
    try {
      return JSON.parse(af || '[]') || [];
    } catch (err) {}
  }
  return [];
}

function getEq2FxSum(playerObj, key) {
  let sum = 0;
  const worn = getEq2Worn(playerObj);
  Object.values(worn).forEach(it => {
    if (it) {
      const af = getEq2AfArr(it.af);
      af.forEach(a => {
        if (a && a[0] === key) {
          sum += (Number(a[1]) || 0);
        }
      });
    }
  });
  return sum;
}

function backfillModuleCards(playerObj) {
  if (!playerObj) return;
  const fields = [
    'pistol_modules', 'sniper_modules', 'knife_modules', 'axe_modules',
    'robot_modules', 'robot_gun_modules', 'railgun_modules',
    'armor_modules', 'house_modules', 'turret_modules'
  ];
  fields.forEach(f => {
    let raw = playerObj[f];
    if (!raw) return;
    let isStr = typeof raw === 'string';
    let obj;
    if (isStr) {
      try { obj = JSON.parse(raw); } catch (e) { return; }
    } else {
      obj = raw;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      let changed = false;
      Object.keys(obj).forEach(slot => {
        const m = obj[slot];
        if (m) {
          if (Array.isArray(m.cards)) {
            m.cards.forEach(c => {
              if (c && typeof c === 'object') {
                if (c.stat && c.s === undefined) { c.s = c.stat; changed = true; }
                if (c.value !== undefined && c.v === undefined) { c.v = c.value; changed = true; }
                if (c.s && c.stat === undefined) { c.stat = c.s; changed = true; }
                if (c.v !== undefined && c.value === undefined) { c.value = c.v; changed = true; }
              }
            });
          }
          if (Array.isArray(m.c)) {
            m.c.forEach(c => {
              if (c && typeof c === 'object') {
                if (c.stat && c.s === undefined) { c.s = c.stat; changed = true; }
                if (c.value !== undefined && c.v === undefined) { c.v = c.value; changed = true; }
                if (c.s && c.stat === undefined) { c.stat = c.s; changed = true; }
                if (c.v !== undefined && c.value === undefined) { c.value = c.v; changed = true; }
              }
            });
          }
        }
      });
      if (changed) {
        playerObj[f] = isStr ? JSON.stringify(obj) : obj;
      }
    }
  });
}

function getEffectiveStats(player) {
  // Normalize module cards for display & calculation
  backfillModuleCards(player);

  const stats = {
    str: player.str || 5,
    agi: player.agi || 5,
    vit: player.vit || 5,
    intel: player.intel || 5,
    dex: player.dex || 5,
    luk: player.luk || 5
  };

  const modBonus = { str: 0, agi: 0, vit: 0, intel: 0, dex: 0, luk: 0 };
  
  function safeParse(val, fallback) {
    if (!val) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val) || fallback; } catch (e) { return fallback; }
  }

  function getPlayerModules(p, w) {
    return safeParse(p[w + '_modules'], {});
  }

  const railOn = (parseInt(player.robot_railgun_expires) || 0) > Math.floor(Date.now() / 1000);
  const mdcFams = ['pistol', 'sniper', 'knife', 'axe', 'robot', 'robot_gun', 'railgun', 'armor', 'house', 'turret'];
  mdcFams.forEach(w => {
    if (w === 'railgun' && !railOn) return;
    const mo = getPlayerModules(player, w);
    Object.keys(mo).forEach(slot => {
      const m = mo[slot];
      if (m) {
        if (m.stat && modBonus[m.stat] !== undefined) {
          modBonus[m.stat] += Math.max(1, Math.min(7, parseInt(m.rarity) || 1));
        }
        // Card Socket Bonus from Modules
        if (Array.isArray(m.cards)) {
          m.cards.forEach(c => {
            if (!c) return;
            const sKey = (c.s || c.stat || '').toLowerCase();
            const val = parseInt(c.v || c.value) || 0;
            if (sKey && val && modBonus[sKey] !== undefined) {
              modBonus[sKey] += val;
            }
            if (c.mvp && c.mb && c.mb.t && modBonus[c.mb.t] !== undefined && (parseInt(c.mb.a) || 0) > 0) {
              modBonus[c.mb.t] += parseInt(c.mb.a);
            }
          });
        }
      }
    });
  });

  // Card Socket Bonus from Pet
  if (player.pet_mid && player.pet_mid > 0) {
    let petCards = player.pet_cards;
    if (typeof petCards === 'string') { try { petCards = JSON.parse(petCards || '[]'); } catch(e) { petCards = []; } }
    if (Array.isArray(petCards)) {
      petCards.forEach(c => {
        if (!c) return;
        const sKey = (c.s || c.stat || '').toLowerCase();
        const val = parseInt(c.v || c.value) || 0;
        if (sKey && val && modBonus[sKey] !== undefined) {
          modBonus[sKey] += val;
        }
        if (c.mvp && c.mb && c.mb.t && modBonus[c.mb.t] !== undefined && (parseInt(c.mb.a) || 0) > 0) {
          modBonus[c.mb.t] += parseInt(c.mb.a);
        }
      });
    }
  }

  // Card Socket Bonus from Divine Pet
  if (player.dv_pet && player.dv_pet > 0) {
    let dvCards = player.dv_cards;
    if (typeof dvCards === 'string') { try { dvCards = JSON.parse(dvCards || '[]'); } catch(e) { dvCards = []; } }
    if (Array.isArray(dvCards)) {
      dvCards.forEach(c => {
        if (!c) return;
        const sKey = (c.s || c.stat || '').toLowerCase();
        const val = parseInt(c.v || c.value) || 0;
        if (sKey && val && modBonus[sKey] !== undefined) {
          modBonus[sKey] += val;
        }
        if (c.mvp && c.mb && c.mb.t && modBonus[c.mb.t] !== undefined && (parseInt(c.mb.a) || 0) > 0) {
          modBonus[c.mb.t] += parseInt(c.mb.a);
        }
      });
    }
  }

  const eq2Bonus = { str: 0, agi: 0, vit: 0, intel: 0, dex: 0, luk: 0 };
  Object.keys(eq2Bonus).forEach(k => {
    const key = k === 'intel' ? 'int' : k;
    eq2Bonus[k] = getEq2FxSum(player, key);
  });

  const eff = {};
  Object.keys(stats).forEach(k => {
    eff[k] = stats[k] + modBonus[k] + eq2Bonus[k];
  });
  return { eff, modBonus, eq2Bonus };
}

router.post('/', async (req, res) => {
  const { line_uid, session_token, explore_cx, explore_cy, explore_radius, target_monster_id, have_static, bot, manual_dir, traveling } = req.body;
  
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Auth failed' });
  }

  const { acquireLock } = require('../utils/lock');
  const release = await acquireLock(line_uid);

  try {
    // Xác thực token
    const user = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!user) {
      return res.json({ ok: false, error: 'Invalid session' });
    }

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Player data not found' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch(e) {
      playerObj = { line_uid }; 
    }

    // Đảm bảo đồng hành tự động kích hoạt hỗ trợ nhân vật từ lvl 1
    const nowTs = Math.floor(Date.now() / 1000);
    playerObj.priest_expires = Math.max(playerObj.priest_expires || 0, nowTs + 86400 * 365);
    playerObj.knight_expires = Math.max(playerObj.knight_expires || 0, nowTs + 86400 * 365);
    playerObj.archer_expires = Math.max(playerObj.archer_expires || 0, nowTs + 86400 * 365);
    playerObj.priest_on = playerObj.priest_on !== undefined ? Number(playerObj.priest_on) : 1;
    playerObj.knight_on = playerObj.knight_on !== undefined ? Number(playerObj.knight_on) : 1;
    playerObj.archer_on = playerObj.archer_on !== undefined ? Number(playerObj.archer_on) : 1;
    playerObj.priest_lv = playerObj.priest_lv || 1;
    playerObj.knight_lv = playerObj.knight_lv || 1;
    playerObj.archer_lv = playerObj.archer_lv || 1;
    playerObj.robot_lv = Math.max(playerObj.robot_lv || 0, 1);
    playerObj.dv_pet = Math.max(playerObj.dv_pet || 0, 1);
    playerObj.dv_on = playerObj.dv_on !== undefined ? Number(playerObj.dv_on) : 1;

    let card_coll = 0;
    if (playerObj.cards) {
      let cards = playerObj.cards;
      if (typeof cards === 'string') { try { cards = JSON.parse(cards); } catch(e) {} }
      if (cards && typeof cards === 'object') {
        Object.keys(cards).forEach(k => {
          const c = cards[k];
          if (c && ((c.n || 0) > 0 || (c.m || 0) > 0)) {
            card_coll++;
          }
        });
      }
    }
    let egg_coll = 0;
    if (playerObj.eggs) {
      let eggs = playerObj.eggs;
      if (typeof eggs === 'string') { try { eggs = JSON.parse(eggs); } catch(e) {} }
      if (eggs && typeof eggs === 'object') {
        Object.keys(eggs).forEach(k => {
          const e = eggs[k];
          if (e && ((e.n || 0) > 0 || (e.m || 0) > 0)) {
            egg_coll++;
          }
        });
      }
    }

    // Calculate and assign effective stats (str_eff, etc.)
    const { eff, modBonus, eq2Bonus } = getEffectiveStats(playerObj);
    playerObj.str_eff = eff.str;
    playerObj.agi_eff = eff.agi;
    playerObj.vit_eff = eff.vit;
    playerObj.intel_eff = eff.intel;
    playerObj.dex_eff = eff.dex;
    playerObj.luk_eff = eff.luk;

    // --- HỆ THỐNG VÔ HẠN ĐẠN & NĂNG LƯỢNG (AUTO-FILL MAX CAPACITIES) ---
    function getAmmoMaxCap(tierIdx, player, gun) {
      const AMMO_TIER_CARRY_CAPS = [50, 40, 35, 30, 27, 25];
      const lv = player.lv || 1;
      const eq2Pam = gun === 'pistol' ? getEq2FxSum(player, 'pam') : 0;
      return AMMO_TIER_CARRY_CAPS[tierIdx] + Math.max(0, lv - 1) * 5 + eq2Pam;
    }

    function getRobotModEnergyTotal(player) {
      let s = 0;
      try {
        let cores = {};
        if (player.robot_modules) {
          cores = typeof player.robot_modules === 'string' ? JSON.parse(player.robot_modules) : player.robot_modules;
        }
        if (cores && typeof cores === 'object') {
          Object.keys(cores).forEach(k => {
            const m = cores[k];
            if (m) s += (parseInt(m.plus) || 0) + 1;
          });
        }
      } catch (e) {}
      return s;
    }

    function getRobotEnergyMax(player) {
      const lv = player.robot_lv || 1;
      let max = 300 + (lv - 1) * 30;
      try {
        let hw = [];
        if (player.hardware) {
          hw = Array.isArray(player.hardware) ? player.hardware : JSON.parse(player.hardware);
        }
        const HW_MAP = { 14: 50, 6: 100, 15: 150, 16: 200, 17: 250, 18: 300 };
        hw.forEach(id => {
          if (HW_MAP[id]) max += HW_MAP[id];
        });
      } catch (e) {}
      max += getRobotModEnergyTotal(player);
      max += getEq2FxSum(player, 'ene');
      return max;
    }

    function getHouseModEnergyTotal(player) {
      let s = 0;
      try {
        let cores = {};
        if (player.house_modules) {
          cores = typeof player.house_modules === 'string' ? JSON.parse(player.house_modules) : player.house_modules;
        }
        if (cores && typeof cores === 'object') {
          Object.keys(cores).forEach(k => {
            const m = cores[k];
            if (m) s += (parseInt(m.plus) || 0) + 1;
          });
        }
      } catch (e) {}
      return s;
    }

    function getHouseEnergyMax(player) {
      const lv = player.house_lv || 1;
      return lv * 60 + getHouseModEnergyTotal(player);
    }

    // Auto-fill and lock all ammo & energy to max limits
    const pMax = getAmmoMaxCap(0, playerObj, 'pistol');
    const sMax = getAmmoMaxCap(0, playerObj, 'sniper');
    const rMax = getAmmoMaxCap(0, playerObj, 'robot');
    
    playerObj.ammo_pistol = pMax;
    playerObj.ammo_sniper = sMax;
    playerObj.ammo_robot_gun = rMax;
    
    playerObj.ammo_pistol_extra = [
      getAmmoMaxCap(1, playerObj, 'pistol'),
      getAmmoMaxCap(2, playerObj, 'pistol'),
      getAmmoMaxCap(3, playerObj, 'pistol'),
      getAmmoMaxCap(4, playerObj, 'pistol'),
      getAmmoMaxCap(5, playerObj, 'pistol')
    ];
    playerObj.ammo_sniper_extra = [
      getAmmoMaxCap(1, playerObj, 'sniper'),
      getAmmoMaxCap(2, playerObj, 'sniper'),
      getAmmoMaxCap(3, playerObj, 'sniper'),
      getAmmoMaxCap(4, playerObj, 'sniper'),
      getAmmoMaxCap(5, playerObj, 'sniper')
    ];
    playerObj.ammo_robot_extra = [
      getAmmoMaxCap(1, playerObj, 'robot'),
      getAmmoMaxCap(2, playerObj, 'robot'),
      getAmmoMaxCap(3, playerObj, 'robot'),
      getAmmoMaxCap(4, playerObj, 'robot'),
      getAmmoMaxCap(5, playerObj, 'robot')
    ];

    playerObj.robot_energy = getRobotEnergyMax(playerObj);
    playerObj.house_energy = getHouseEnergyMax(playerObj);

  const mapId = playerObj.map || pRow.map || 1;

  // --- ANTI-CHEAT: RATE LIMIT CHECK (COOLDOWN 900MS) ---
  const now = Date.now();
  if (playerObj.last_tick_at && (now - playerObj.last_tick_at) < 800) {
    const bossesList = [];
    const otherPlayers = worldManager.getOthersOnMap(mapId, line_uid);
    const finalMonsters = worldManager.getMonstersInRadius(mapId, playerObj.x, playerObj.y, 300);

    const responseData = {
      ok: 1,
      player: playerObj,
      monsters: finalMonsters,
      bosses: bossesList,
      others: otherPlayers,
      ally: [],
      events: [{ type: "explore", msg: "⏳ Hệ thống bảo vệ: Vui lòng không spam request quá nhanh!" }],
      drop_fx: [],
      equipment_bonus: eq2Bonus,
      module_stat_bonus: modBonus,
      stat_parts_bonus: [],
      target_monster_id: playerObj.target_monster_id || null,
      card_coll: card_coll,
      egg_coll: egg_coll,
      online_count: 168,
      offline: null,
      region: "VN",
      ts: Math.floor(now / 1000),
      map: mapId,
      ev: { e: 2, d: 1.5, g: 1.5, n: "NEW COME" },
      gwn: "Server Mới",
      cwc: "VN",
      col_n: 0,
      chat_n: 0, 
      dm_n: 0, 
      gchat_n: 0,
      gturrets: [],
      ci: 532, 
      otbl: 10733,
      araid: { on: 1, g: 0, c: 0, used: 1, max: 5 },
      auc: { end: Math.floor(now / 1000) + 3600, bid: 0, now: Math.floor(now / 1000) }
    };

    if (have_static != '1') {
      const mapSpots = worldManager.getSpotsForMap(mapId);
      if (mapSpots.length > 0) {
        responseData.spots = mapSpots;
      }
      
      const enrichedMonMasters = {};
      for (const [mid, mon] of Object.entries(worldManager.monMastersCache)) {
        enrichedMonMasters[mid] = {
          ...mon,
          ba: Math.max(1, mon.lv * 3),
          bh: Math.max(2, Math.round(worldManager.getMonsterHpMax(mon.lv) / 3))
        };
      }
      responseData.mon_masters = enrichedMonMasters;
    }
    return res.json(responseData);
  }
  playerObj.last_tick_at = now;

  // Lấy tọa độ mục tiêu (explore_cx/cy)
  let targetCx = parseFloat(explore_cx) || 1125;
  let targetCy = parseFloat(explore_cy) || 1125;
  let radius = parseFloat(explore_radius) || 300;

  // Anti-cheat: Cap explore_radius
  if (radius > 300) radius = 300;
  if (radius < 50) radius = 50;
  
  // Khởi tạo tọa độ hiện tại của player nếu chưa có
  if (playerObj.x === undefined || playerObj.x === null) playerObj.x = targetCx;
  if (playerObj.y === undefined || playerObj.y === null) playerObj.y = targetCy;

  // Anti-cheat: Validate distance between explore center and player actual position
  const dxCenter = targetCx - playerObj.x;
  const dyCenter = targetCy - playerObj.y;
  const distCenter = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter);
  if (distCenter > 350) {
    targetCx = Math.round(playerObj.x + (dxCenter / distCenter) * 350);
    targetCy = Math.round(playerObj.y + (dyCenter / distCenter) * 350);
  }

  // Parse skills
  let skills = {};
  try {
    skills = typeof playerObj.skills === 'string' ? JSON.parse(playerObj.skills || '{}') : (playerObj.skills || {});
  } catch (e) {
    skills = {};
  }

  // Initialize and increment tick & skill_cds
  playerObj.tick = (playerObj.tick || 0) + 1;
  if (!playerObj.skill_cds || typeof playerObj.skill_cds !== 'object') {
    try {
      playerObj.skill_cds = typeof playerObj.skill_cds === 'string' ? JSON.parse(playerObj.skill_cds || '{}') : (playerObj.skill_cds || {});
    } catch (e) {
      playerObj.skill_cds = {};
    }
  }

  // Recalculate hp_max dynamically with tough_body
  const baseHpMax = 300 + ((playerObj.lv || 1) - 1) * 15;
  const vitVal = playerObj.vit || 5;
  const vitHpBonus = (vitVal - 5) * 4;
  let calculatedHpMax = baseHpMax + vitHpBonus;
  const toughBodyLv = skills.tough_body || 0;
  if (toughBodyLv > 0) {
    calculatedHpMax += toughBodyLv * 30;
    calculatedHpMax = Math.floor(calculatedHpMax * (1 + toughBodyLv * 0.01));
  }
  playerObj.hp_max = calculatedHpMax;

  // Calculate hpMaxEff locally (matching client formula)
  const vitEff = playerObj.vit_eff ?? playerObj.vit ?? 5;
  const vitBase = playerObj.vit ?? 5;
  const vitHpB = Math.max(0, Math.max(0, vitEff - 5) * 2 - Math.max(0, vitBase - 5));
  const ragHpMult = 1 + 0.001 * Math.max(0, parseInt(playerObj.rag_hp) || 0);
  const toughHpMul = 1 + 0.01 * toughBodyLv;
  const hpMaxEff = Math.floor((playerObj.hp_max + vitHpB) * ragHpMult * toughHpMul);

  // --- PLAYER REGENERATION (HP, MP, ARMOR/SHIELD) ---
  
  // 1. HP Regeneration (client formula)
  const hpRegenSkill = parseInt(skills.hp_regen) || 0;
  let regenAmount = Math.floor(vitEff / 5) + hpRegenSkill + Math.floor((playerObj.armor_lv || 0) / 5);
  
  if (hpRegenSkill >= 5) {
    regenAmount += hpRegenSkill + Math.floor(hpMaxEff * 0.001);
  }

  // Đồng đội hỗ trợ (Priest)
  if (playerObj.priest_on === 1 && (playerObj.priest_lv || 0) >= 1) {
    regenAmount += playerObj.priest_lv * 3;
  }
  
  playerObj.hp = Math.min(hpMaxEff, (playerObj.hp || 300) + regenAmount);

  // 2. MP Regeneration
  const intel = playerObj.intel_eff ?? playerObj.intel ?? 5;
  const ragMpMult = 1 + 0.001 * Math.max(0, parseInt(playerObj.rag_mp) || 0);
  const mpMax = Math.floor((50 + intel * 5) * ragMpMult);
  const mpRegen = 2 + Math.floor(intel / 5);
  
  playerObj.mp = Math.min(mpMax, (playerObj.mp !== undefined ? playerObj.mp : mpMax) + mpRegen);

  // 3. Armor (Shield) Regeneration
  const vit = playerObj.vit_eff ?? playerObj.vit ?? 5;
  const str = playerObj.str_eff ?? playerObj.str ?? 5;
  const armLv = playerObj.armor_lv || 0;
  const armorUpLv = parseInt(skills.armor_up) || 0;

  // Calculate modules bonus for armor
  let aModMax = 0;
  let aModRegen = 0;
  try {
    let armorModules = {};
    if (playerObj.armor_modules) {
      armorModules = typeof playerObj.armor_modules === 'string' ? JSON.parse(playerObj.armor_modules || '{}') : playerObj.armor_modules;
    }
    
    function getArmorModDefOne(plus) {
      const p = Math.max(0, Math.min(15, parseInt(plus) || 0));
      if (p <= 5) return 3 * p;
      if (p <= 10) return 15 + (p - 5) * 4;
      return 35 + (p - 10) * 6;
    }
    
    function getArmorEffVal(slot, m) {
      const r = parseInt(m.rarity) || 1;
      const p = parseInt(m.plus) || 0;
      if (slot === 'a_max') return r * 3 + p * 2;
      if (slot === 'a_regen') return getArmorModDefOne(p) + Math.floor((r - 1) / 2);
      if (slot === 'a_return') return Math.min(50, r * 2 + p);
      return 0;
    }

    if (armorModules.a_max) {
      aModMax = getArmorEffVal('a_max', armorModules.a_max);
    }
    if (armorModules.a_regen) {
      aModRegen = getArmorEffVal('a_regen', armorModules.a_regen);
    }
  } catch (e) {
    console.error("Lỗi parse armor_modules trên server:", e);
  }

  const priestAmB = (playerObj.priest_on === 1 && (playerObj.priest_lv || 0) >= 1) ? 50 + (playerObj.priest_lv || 1) * 5 : 0;
  const ragArmorMult = 1 + 0.001 * Math.max(0, parseInt(playerObj.rag_armor) || 0);
  
  const arpOption = getEq2FxSum(playerObj, 'arp');
  const armorUpMul = 1 + 0.01 * armorUpLv + arpOption / 10000;
  
  const armorMax = Math.floor((100 + Math.floor((vit - 5) / 5) + Math.floor((str - 5) / 2) + armLv * 10 + aModMax + armorUpLv * 5 + priestAmB) * ragArmorMult * armorUpMul);
  const armorRegen = 5 + aModRegen + armorUpLv + armLv;

  playerObj.armor = Math.min(armorMax, (playerObj.armor !== undefined ? playerObj.armor : armorMax) + armorRegen);

  // --- HỆ THỐNG THÚ CƯNG (PET): EXP, HP RECO & BACKFILL ---
  if (playerObj.pet_mid && playerObj.pet_mid > 0) {
    const petOlv = playerObj.pet_olv || 1;
    const petMvp = playerObj.pet_mvp || 0;
    
    // 1. Backfill Base Stats
    if (!playerObj.pet_batk) playerObj.pet_batk = petOlv * 3;
    if (!playerObj.pet_bhp) playerObj.pet_bhp = petOlv * 8;
    
    // 2. Tinh HP max
    let sacStar = 0;
    if (playerObj.sac_eggs) {
      let sacEggs = playerObj.sac_eggs;
      if (typeof sacEggs === 'string') { try { sacEggs = JSON.parse(sacEggs || '{}'); } catch(e) {} }
      if (sacEggs && typeof sacEggs === 'object') {
        const sacVal = sacEggs[playerObj.pet_mid];
        sacStar = (sacVal && typeof sacVal === 'object') ? (sacVal.st || 0) : (parseInt(sacVal) || 0);
      }
    }
    const es = 1 + 0.05 * Math.max(0, Math.min(30, sacStar));
    const petLv = getPetLv(playerObj.pet_exp || 0);
    const petBondLv = skills.pet_bond || 0;
    const petHpMax = Math.max(1, Math.round(0.5 * playerObj.pet_bhp * (1 + 0.25 * petLv) * (petMvp ? 2 : 1) * es * (1 + petBondLv * 0.15)));
    
    // 3. Regen hoac Cap nhat EXP
    const isDown = !!(playerObj.pet_down || 0);
    if (isDown) {
      // 💤 Pet dang bat tinh: hoi HP tu tu (0.3% hpMax/tick)
      const heal = Math.round(petHpMax * 0.003) || 1;
      playerObj.pet_hp = Math.min(petHpMax, (playerObj.pet_hp || 0) + heal);
      if (playerObj.pet_hp >= petHpMax * 0.1) {
        playerObj.pet_down = 0;
      }
    } else {
      // 🐾 Pet dang tinh tao: nhan EXP va hoi phuc thuong
      playerObj.pet_exp = (playerObj.pet_exp || 0) + (2 + Math.floor(petOlv * 0.5));
      
      const regenPct = 1.0 + 0.20 * (playerObj.pet_up_reco || 0);
      const heal = Math.round(petHpMax * (regenPct / 100)) || 1;
      playerObj.pet_hp = Math.min(petHpMax, (playerObj.pet_hp || petHpMax) + heal);
    }
  }

  // --- HỆ THỐNG THẦN HỘ MỆNH (DIVINE PET): EXP, HP RECO & BACKFILL ---
  if (playerObj.dv_pet && playerObj.dv_pet > 0) {
    const lv = getDvLv(playerObj.dv_exp || 0);
    const g = 1 + 0.02 * (lv - 1);
    const dvHpMax = Math.max(1, Math.round(183000 * (g + 0.05 * (playerObj.dv_up_hp || 0))));
    const regenPct = 1.0 + 0.2 * (playerObj.dv_up_reco || 0);
    
    const isDown = !!(playerObj.dv_down || 0);
    if (isDown) {
      const heal = Math.round(dvHpMax * 0.003) || 1;
      playerObj.dv_hp = Math.min(dvHpMax, (playerObj.dv_hp || 0) + heal);
      if (playerObj.dv_hp >= dvHpMax * 0.1) {
        playerObj.dv_down = 0;
      }
    } else {
      playerObj.dv_exp = (playerObj.dv_exp || 0) + (2 + Math.floor(lv * 0.1));
      const heal = Math.round(dvHpMax * (regenPct / 100)) || 1;
      playerObj.dv_hp = Math.min(dvHpMax, (playerObj.dv_hp || dvHpMax) + heal);
    }
  }

  const cx = targetCx;
  const cy = targetCy;
  const events = [];
  const drops = [];

  // Đồng bộ vị trí của player vào bộ nhớ để hiển thị cho người chơi khác
  worldManager.updatePlayerPosition(line_uid, playerObj.display_name || user.username, playerObj.x, playerObj.y, playerObj.lv || pRow.lv || 1, mapId);

  // Tìm quái trong tầm của explorer center
  const localMonsters = worldManager.getMonstersInRadius(mapId, cx, cy, radius);

  // --- HỆ THỐNG TARGET ---
  let targetM = null;
  if (target_monster_id) {
    playerObj.target_monster_id = parseInt(target_monster_id);
  }
  // 1. Kiểm tra target hiện tại có hợp lệ không (còn sống, thuộc map hiện tại, và nằm trong radius của cx, cy)
  if (playerObj.target_monster_id) {
    targetM = worldManager.getMonster(mapId, playerObj.target_monster_id);
    if (targetM) {
      const dx = targetM.x - cx;
      const dy = targetM.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius || targetM.hp <= 0) {
        targetM = null;
      }
    }
  }

  // 2. Nếu chưa có target hoặc target cũ không còn hợp lệ, tự động chọn quái gần vị trí hiện tại của player nhất
  if (!targetM && localMonsters.length > 0) {
    let closestM = null;
    let minDist = Infinity;
    for (const m of localMonsters) {
      if (m.hp <= 0) continue;
      const dx = m.x - playerObj.x;
      const dy = m.y - playerObj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closestM = m;
      }
    }
    if (closestM) {
      targetM = closestM;
      playerObj.target_monster_id = targetM.id;
    } else {
      playerObj.target_monster_id = null;
    }
  } else if (localMonsters.length === 0) {
    playerObj.target_monster_id = null;
  }

  // --- TÍNH PHẠM VI TẤN CÔNG (WEAPON RANGE) ---
  const activeGun = parseInt(playerObj.active_gun) || 0;
  const gunUsePistol = playerObj.gun_use_pistol !== undefined ? Number(playerObj.gun_use_pistol) : 1;
  const gunUseSniper = playerObj.gun_use_sniper !== undefined ? Number(playerObj.gun_use_sniper) : 1;
  
  const dexBonus = (playerObj.dex || 5) / 8;
  let attackRange = 35; // Mặc định dao găm là 35px
  let activeWeapon = 'knife';

  if (activeGun === 1) {
    if (gunUseSniper !== 0) {
      activeWeapon = 'sniper';
      const slv = playerObj.gun_sniper_lv || 1;
      attackRange = 100 + (slv - 1) * 0.2 + dexBonus;
    } else if (gunUsePistol !== 0) {
      activeWeapon = 'pistol';
      const plv = playerObj.gun_pistol_lv || 1;
      attackRange = 75 + (plv - 1) * 0.2 + dexBonus;
    }
  } else { // activeGun === 0
    if (gunUsePistol !== 0) {
      activeWeapon = 'pistol';
      const plv = playerObj.gun_pistol_lv || 1;
      attackRange = 75 + (plv - 1) * 0.2 + dexBonus;
    } else if (gunUseSniper !== 0) {
      activeWeapon = 'sniper';
      const slv = playerObj.gun_sniper_lv || 1;
      attackRange = 100 + (slv - 1) * 0.2 + dexBonus;
    }
  }

  let combatIcon = '🔪';
  if (activeWeapon === 'pistol') combatIcon = '🔫';
  else if (activeWeapon === 'sniper') combatIcon = '🎯';

  // Khởi tạo các thông số di chuyển ngẫu nhiên duy nhất cho mỗi nhân vật để tránh trùng nhau
  if (!playerObj.speed_modifier) {
    playerObj.speed_modifier = 0.85 + Math.random() * 0.30;
  }
  if (!playerObj.wander_change_rate) {
    playerObj.wander_change_rate = 0.10 + Math.random() * 0.20;
  }

  const baseMoveSpeed = 51.75; // Tăng 15% tốc độ di chuyển (45 * 1.15)
  const speed = baseMoveSpeed * playerObj.speed_modifier;

  if (manual_dir) {
    // 1. Di chuyển bằng tay (D-pad / WASD)
    if (manual_dir === 'up') playerObj.y -= speed;
    if (manual_dir === 'down') playerObj.y += speed;
    if (manual_dir === 'left') playerObj.x -= speed;
    if (manual_dir === 'right') playerObj.x += speed;
  } else if (traveling == '1') {
    // 2. Di chuyển tự động khi đang đi tới Spot mới
    const dx = targetCx - playerObj.x;
    const dy = targetCy - playerObj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 10) {
      playerObj.x += (dx / dist) * Math.min(dist, speed);
      playerObj.y += (dy / dist) * Math.min(dist, speed);
    }
  } else if (bot == '1') {
    // 3. Di chuyển bằng Auto Bot khi đang đi săn
    if (targetM) {
      const dx = targetM.x - playerObj.x;
      const dy = targetM.y - playerObj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > attackRange) { 
        playerObj.x += (dx / dist) * Math.min(dist - (attackRange - 10), speed);
        playerObj.y += (dy / dist) * Math.min(dist - (attackRange - 10), speed);
      }
    } else {
      // Bật Bot nhưng không có mục tiêu cụ thể -> Đi dạo ngẫu nhiên một hướng bất kỳ trên bản đồ
      if (!playerObj.wander_angle) {
        playerObj.wander_angle = Math.random() * Math.PI * 2;
      }
      
      playerObj.x += Math.cos(playerObj.wander_angle) * speed;
      playerObj.y += Math.sin(playerObj.wander_angle) * speed;
      
      if (Math.random() < playerObj.wander_change_rate) {
        playerObj.wander_angle = Math.random() * Math.PI * 2;
      }
    }
  } else {
    // Không có di chuyển nào -> Kéo dần về explore_cx/cy nếu lệch quá xa
    const dx = targetCx - playerObj.x;
    const dy = targetCy - playerObj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 10) {
      playerObj.x += (dx / dist) * Math.min(dist, speed);
      playerObj.y += (dy / dist) * Math.min(dist, speed);
    }
  }

  // Giới hạn trong kích thước bản đồ
  playerObj.x = Math.round(Math.max(50, Math.min(2200, playerObj.x)));
  playerObj.y = Math.round(Math.max(50, Math.min(2200, playerObj.y)));

  // --- HỆ THỐNG PHẦN THƯỞNG KHI DIỆT QUÁI ---
  const handleMonsterKill = (m, killerIcon, killData) => {
    if (!m || m.killed_handled) return;
    m.killed_handled = true;

    playerObj.exp += killData.exp;
    playerObj.gold += killData.gold;
    
    events.push({
      type: "explore",
      msg: `⚔️ Giết ${m.name} nhận ${killData.exp} EXP và ${killData.gold} G`
    });

    events.push({
      type: "kill",
      mid: m.id,
      icon: killerIcon,
      is_mvp: m.is_mvp ? 1 : 0
    });

    const dropRes = dropSystem.generateDrops(playerObj, m, mapId);
    if (dropRes && dropRes.drops && dropRes.drops.length > 0) {
      drops.push(...dropRes.drops);
    }
    if (dropRes && dropRes.events && dropRes.events.length > 0) {
      events.push(...dropRes.events);
    }
    
    let leveledUp = false;
    while (playerObj.exp >= expNextHero(playerObj.lv || 1) && (playerObj.lv || 1) < 70) {
      playerObj.exp -= expNextHero(playerObj.lv || 1);
      playerObj.lv = (playerObj.lv || 1) + 1;
      playerObj.stat_pts = (playerObj.stat_pts || 0) + 5;
      playerObj.skill_pts = (playerObj.skill_pts || 0) + 1;
      playerObj.hp_max = (playerObj.hp_max || 300) + 15;
      playerObj.hp = playerObj.hp_max;
      leveledUp = true;
    }

    if (leveledUp) {
      events.push({ type: "explore", msg: `🎉 Chúc mừng bạn đã lên cấp ${playerObj.lv}!` });
    }
    
    playerObj.target_monster_id = null;
  };

  // --- HỆ THỐNG ĐẶT/CẬP NHẬT THÁP CANH (TURRETS) ---
  {
  const currentTick = playerObj.tick || 0;
  const turretSkLv = skills.deploy_turret || 0;
  
  if (playerObj.gun_use_turret === 1) {
    // 1. Tải lại đạn/kiểm tra hết hạn của Cannon Turret (Ưu tiên MP trước)
    const lastCannon = (playerObj.skill_cds && playerObj.skill_cds.turret_cannon) || 0;
    if (skills.turret_cannon > 0 && currentTick - lastCannon >= 60 && (playerObj.mp || 0) >= 100) {
      playerObj.mp = (playerObj.mp || 0) - 100;
      playerObj.skill_cds = playerObj.skill_cds || {};
      playerObj.skill_cds.turret_cannon = currentTick;
      playerObj.cannon_turret = { x: playerObj.x, y: playerObj.y, lv: skills.turret_cannon, expires: currentTick + 40 };
      events.push({ type: "explore", msg: `💣 Đã đặt Pháo cối hạng nặng!` });
    }

    // 2. Triển khai Tháp canh thường (nếu còn đủ MP)
    const lastDeploy = (playerObj.skill_cds && playerObj.skill_cds.deploy_turret) || 0;
    if (turretSkLv > 0) {
      const cost = skills.twin_turret > 0 ? 40 : 20;
      if (currentTick - lastDeploy >= 10 && (playerObj.mp || 0) >= cost) {
        playerObj.mp = (playerObj.mp || 0) - cost;
        playerObj.skill_cds = playerObj.skill_cds || {};
        playerObj.skill_cds.deploy_turret = currentTick;
        
        const turretLife = 15 + (skills.turret_rapid || 0);
        const hasShock = skills.turret_shock > 0 ? 1 : 0;
        playerObj.turrets = playerObj.turrets || [];
        
        if (skills.twin_turret > 0) {
          playerObj.turrets.push({ x: playerObj.x - 15, y: playerObj.y, lv: turretSkLv, expires: currentTick + turretLife, sh: hasShock });
          playerObj.turrets.push({ x: playerObj.x + 15, y: playerObj.y, lv: turretSkLv, expires: currentTick + turretLife, sh: hasShock });
        } else {
          playerObj.turrets.push({ x: playerObj.x, y: playerObj.y, lv: turretSkLv, expires: currentTick + turretLife, sh: hasShock });
        }
        events.push({ type: "explore", msg: `🗼 Đã triển khai Tháp canh!` });
      }
    }
  }

  if (playerObj.cannon_turret && playerObj.cannon_turret.expires <= currentTick) {
    playerObj.cannon_turret = null;
  }

  // Lọc tháp canh hết hạn
  playerObj.turrets = (playerObj.turrets || []).filter(tu => tu && tu.expires > currentTick);

  // Tháp canh tấn công
  const localMonsters = worldManager.getMonstersInRadius(mapId, playerObj.x, playerObj.y, 350);

  (playerObj.turrets || []).forEach(tu => {
    // Tìm quái gần nhất tháp
    let closestMon = null;
    let minDist = Infinity;
    for (const m of localMonsters) {
      if (m.hp <= 0) continue;
      const d = Math.hypot(m.x - tu.x, m.y - tu.y);
      if (d < minDist) {
        minDist = d;
        closestMon = m;
      }
    }
    
    const range = 180 + 3 * (tu.lv - 1) + (skills.twin_turret || 0) * 9;
    const turretAtk = 20 + 5 * (tu.lv - 1) + 3 * intel + (playerObj.turret_lv || 1) * 2;

    if (closestMon && minDist <= range) {
      let turretDmg = Math.max(1, Math.round((turretAtk - closestMon.lv * 1.5) * (1 + 0.005 * turretSkLv)));
      turretDmg = Math.round(turretDmg * (0.9 + Math.random() * 0.2));
      const res = worldManager.damageMonster(mapId, closestMon.id, turretDmg);
      if (res) {
        events.push({
          type: "hit",
          msg: `🗼 Tháp canh bắn trúng -${turretDmg} HP (còn ${res.hp || 0})`,
          mid: closestMon.id,
          icon: "🗼",
          dmg: turretDmg,
          crit: 0
        });
        if (res.killed) handleMonsterKill(closestMon, "🗼", res);
      }
    }

    // Shock aura AoE
    if (tu.sh === 1 && skills.turret_shock > 0) {
      const shockRange = 50 + skills.turret_shock * 3;
      let shockDmg = Math.max(1, Math.round(turretAtk * (0.25 + 0.025 * skills.turret_shock)));
      localMonsters.forEach(m => {
        if (m.hp > 0 && Math.hypot(m.x - tu.x, m.y - tu.y) <= shockRange) {
          const res = worldManager.damageMonster(mapId, m.id, shockDmg);
          if (res) {
            events.push({
              type: "hit",
              msg: `🌩️ Điện giật -${shockDmg} HP (còn ${res.hp || 0})`,
              mid: m.id,
              icon: "🌩️",
              dmg: shockDmg,
              crit: 0
            });
            if (res.killed) handleMonsterKill(m, "🌩️", res);
          }
        }
      });
    }
  });

  // Pháo cối (cannon turret) tấn công
  if (playerObj.cannon_turret) {
    const tu = playerObj.cannon_turret;
    let closestMon = null;
    let minDist = Infinity;
    for (const m of localMonsters) {
      if (m.hp <= 0) continue;
      const d = Math.hypot(m.x - tu.x, m.y - tu.y);
      if (d < minDist) {
        minDist = d;
        closestMon = m;
      }
    }
    
    if (closestMon && minDist <= 300) {
      const turretAtk = 20 + 5 * (turretSkLv - 1) + 3 * intel + (playerObj.turret_lv || 1) * 2;
      let cannonDmg = Math.max(1, Math.round(turretAtk * (1 + (tu.lv - 1) * 0.1) * 1.5));
      cannonDmg = Math.round(cannonDmg * (0.9 + Math.random() * 0.2));
      
      // Explodes AoE around the target
      const targetX = closestMon.x;
      const targetY = closestMon.y;
      
      // Đẩy event hoạt ảnh bắn súng và nổ
      events.push({
        type: "beam",
        path: [[tu.x, tu.y], [targetX, targetY]],
        color: "#f97316"
      });
      events.push({
        type: "explosion",
        x: targetX,
        y: targetY,
        r: 50,
        color: "#f97316"
      });
      
      localMonsters.forEach(m => {
        if (m.hp > 0 && Math.hypot(m.x - targetX, m.y - targetY) <= 50) {
          const res = worldManager.damageMonster(mapId, m.id, cannonDmg);
          if (res) {
            events.push({
              type: "hit",
              msg: `💣 Pháo cối nổ trúng -${cannonDmg} HP (còn ${res.hp || 0})`,
              mid: m.id,
              icon: "💣",
              dmg: cannonDmg,
              crit: 0
            });
            if (res.killed) handleMonsterKill(m, "💣", res);
          }
        }
      });
    }
  }

  // --- XỬ LÝ TẤN CÔNG PLAYER (Có active skills) ---
  if (targetM && playerObj.hp > 0) {
    const dx = targetM.x - playerObj.x;
    const dy = targetM.y - playerObj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= attackRange) {
      // 1. Phân tích active skill
      let activeSkillTriggered = null;
      let skillDmgMult = 1;
      let isAoE = false;
      let isChain = false;
      let isDouble = false;
      let isTriple = false;
      let isExplosive = false;
      let isLockOn = false;
      let isPull = false;
      let isMeleeCharge = false;
      
      let skillAuto = {};
      if (playerObj.skill_auto) {
        try {
          skillAuto = typeof playerObj.skill_auto === 'string' ? JSON.parse(playerObj.skill_auto) : playerObj.skill_auto;
        } catch (e) {
          skillAuto = {};
        }
      }
      
      const ACTIVE_SKILL_RULES = {
        sword_x: { mp: 5, cd: 3, weapon: 'knife' },
        sword_cross: { mp: 3, cd: 3, weapon: 'knife' },
        spin_attack: { mp: 15, cd: 0, weapon: 'knife', isAoE: true },
        double_attack: { mp: 5, cd: 0, weapon: 'knife', isDouble: true },
        
        triple_knife: { mp: 5, cd: 5, isTriple: true },
        lock_on: { mp: 5, cd: 3, isLockOn: true },
        explosive_shot: { mp: 15, cd: 5, isExplosive: true },
        kill_shot: { mp: 10, cd: 5, isChain: true },
        
        pull_monster: { mp: 10, cd: 6, isPull: true },
        melee_charge: { mp: 10, cd: 6, isMeleeCharge: true }
      };

      // A. Manual trigger override
      if (playerObj.manual_skill_trigger) {
        const mSkId = playerObj.manual_skill_trigger;
        playerObj.manual_skill_trigger = null;
        if (skills[mSkId] > 0) {
          activeSkillTriggered = mSkId;
        }
      }
      
      // B. Auto trigger check
      if (!activeSkillTriggered) {
        const checkOrder = [];
        if (activeWeapon === 'knife') {
          checkOrder.push('sword_x', 'sword_cross', 'spin_attack', 'double_attack');
        } else if (activeWeapon === 'pistol' || activeWeapon === 'sniper') {
          checkOrder.push('triple_knife', 'lock_on', 'explosive_shot', 'kill_shot');
        }
        checkOrder.push('melee_charge', 'pull_monster');
        
        for (const skId of checkOrder) {
          const rule = ACTIVE_SKILL_RULES[skId];
          const skLv = skills[skId] || 0;
          const isEnabled = (skillAuto[skId] ?? 1) === 1;
          
          if (skLv > 0 && isEnabled) {
            const lastCast = playerObj.skill_cds[skId] || 0;
            if (currentTick - lastCast >= rule.cd && (playerObj.mp || 0) >= rule.mp) {
              playerObj.mp = (playerObj.mp || 0) - rule.mp;
              playerObj.skill_cds[skId] = currentTick;
              activeSkillTriggered = skId;
              break;
            }
          }
        }
      }
      
      // C. Xử lý các hiệu ứng của skill active
      const skLv = activeSkillTriggered ? (skills[activeSkillTriggered] || 0) : 0;
      
      if (activeSkillTriggered === 'sword_x') {
        skillDmgMult = 3 + skLv * 0.1;
      } else if (activeSkillTriggered === 'sword_cross') {
        skillDmgMult = 2 + skLv * 0.1;
      } else if (activeSkillTriggered === 'spin_attack') {
        skillDmgMult = 1.1 + skLv * 0.1;
        isAoE = true;
      } else if (activeSkillTriggered === 'double_attack') {
        skillDmgMult = 1.1 + skLv * 0.1;
        isDouble = true;
      } else if (activeSkillTriggered === 'triple_knife') {
        skillDmgMult = 2 + skLv * 0.3;
        isTriple = true;
      } else if (activeSkillTriggered === 'lock_on') {
        skillDmgMult = 1 + skLv * 0.2;
        isLockOn = true;
      } else if (activeSkillTriggered === 'explosive_shot') {
        skillDmgMult = 1.5;
        isExplosive = true;
      } else if (activeSkillTriggered === 'kill_shot') {
        skillDmgMult = 2 + skLv * 0.1;
        isChain = true;
      } else if (activeSkillTriggered === 'pull_monster') {
        isPull = true;
        let pullCount = 0;
        localMonsters.forEach(m => {
          if (m.hp > 0 && !m.is_mvp && pullCount < 6) {
            const distToPl = Math.hypot(m.x - playerObj.x, m.y - playerObj.y);
            if (distToPl > 30) {
              m.x = playerObj.x + Math.round(Math.random() * 30 - 15);
              m.y = playerObj.y + Math.round(Math.random() * 30 - 15);
              pullCount++;
            }
          }
        });
        events.push({ type: "explore", msg: `🧲 Kéo các quái vật lại gần bằng kỹ năng Nam châm!` });
      } else if (activeSkillTriggered === 'melee_charge') {
        isMeleeCharge = true;
      }
      
      let attackRes = null;

      if (isMeleeCharge) {
        // Húc/Nổ xung quanh, gây choáng
        let hitCount = 0;
        const baseDmgResult = combatEngine.calculateDamage(playerObj, targetM, activeWeapon, { str: playerObj.str_eff, dex: playerObj.dex_eff, agi: playerObj.agi_eff }, (key) => getEq2FxSum(playerObj, key));
        const baseDmg = typeof baseDmgResult === 'object' ? baseDmgResult.dmg : baseDmgResult;
        let isCrit = typeof baseDmgResult === 'object' ? baseDmgResult.crit : 0;
        
        const chargeDmg = Math.round(baseDmg * (1.0 + 0.1 * (skLv - 1)) + (playerObj.vit || 5) * (5 + (skLv - 1)));
        
        localMonsters.forEach(m => {
          if (m.hp > 0 && !m.is_mvp && hitCount < 6 && Math.hypot(m.x - playerObj.x, m.y - playerObj.y) <= 80) {
            m.stunned = 1;
            m.stun_until = Date.now() + skLv * 1000; // 0.1s per level
            const res = worldManager.damageMonster(mapId, m.id, chargeDmg);
            if (res) {
              events.push({
                type: "hit",
                msg: `✨💫 Đập choáng -${chargeDmg} HP (còn ${res.hp || 0})`,
                mid: m.id,
                icon: "✨💫",
                dmg: chargeDmg,
                crit: isCrit
              });
              if (res.killed) handleMonsterKill(m, "✨💫", res);
              if (m.id === targetM.id) attackRes = res;
            }
            hitCount++;
          }
        });
      }
      
      // 2. Tính sát thương chính lên targetM cho các skill gây damage đơn/chuỗi/AoE
      if (activeSkillTriggered !== 'pull_monster' && !isMeleeCharge) {
        const baseDmgResult = combatEngine.calculateDamage(playerObj, targetM, activeWeapon, { str: playerObj.str_eff, dex: playerObj.dex_eff, agi: playerObj.agi_eff }, (key) => getEq2FxSum(playerObj, key));
        let baseDmg = typeof baseDmgResult === 'object' ? baseDmgResult.dmg : baseDmgResult;
        let isCrit = typeof baseDmgResult === 'object' ? baseDmgResult.crit : 0;
        
        if (targetM.locked_on) {
          baseDmg = Math.round(baseDmg * targetM.locked_on);
        }
        
        let finalDmg = Math.round(baseDmg * skillDmgMult);
        if (finalDmg < 1) finalDmg = 1;
        
        let skillIconMap = {
          kill_shot: '⚡',
          explosive_shot: '💥',
          lock_on: '🧿',
          triple_knife: '🔱',
          double_attack: '⚔️',
          spin_attack: '🌀',
          sword_cross: '➕',
          sword_x: '✖️'
        };
        const skIcon = activeSkillTriggered ? ('✨' + (skillIconMap[activeSkillTriggered] || '')) : combatIcon;
        
        if (isDouble) {
          // Song kích: Đánh 2 hit riêng biệt
          for (let i = 0; i < 2; i++) {
            const res = worldManager.damageMonster(mapId, targetM.id, finalDmg);
            if (res) {
              attackRes = res;
              events.push({
                type: "hit",
                msg: `${skIcon} Đánh trúng -${finalDmg} HP (còn ${res.hp || 0})`,
                mid: targetM.id,
                icon: skIcon,
                dmg: finalDmg,
                crit: isCrit
              });
              if (res.killed) {
                handleMonsterKill(targetM, skIcon, res);
                break;
              }
            }
          }
        } else if (isTriple) {
          // Ba phi đao: Đánh 3 hit riêng biệt, chia đều dmg
          const partDmg = Math.max(1, Math.round(finalDmg / 3));
          events.push({
            type: "tri_knife",
            mid: targetM.id,
            x: playerObj.x,
            y: playerObj.y,
            hits: [partDmg, partDmg, partDmg],
            crit: isCrit
          });
          for (let i = 0; i < 3; i++) {
            const res = worldManager.damageMonster(mapId, targetM.id, partDmg);
            if (res) {
              attackRes = res;
              events.push({
                type: "hit",
                msg: `${skIcon} Đánh trúng -${partDmg} HP (còn ${res.hp || 0})`,
                mid: targetM.id,
                icon: skIcon,
                crit: isCrit
              });
              if (res.killed) {
                handleMonsterKill(targetM, skIcon, res);
                break;
              }
            }
          }
        } else if (isChain) {
          // Chain: Xích lôi đánh target chính và 2 mục tiêu lân cận
          const chainFx = [{ x: targetM.x, y: targetM.y }];
          const res = worldManager.damageMonster(mapId, targetM.id, finalDmg);
          if (res) {
            attackRes = res;
            events.push({
              type: "hit",
              msg: `${skIcon} Đánh trúng -${finalDmg} HP (còn ${res.hp || 0})`,
              mid: targetM.id,
              icon: skIcon,
              dmg: finalDmg,
              crit: isCrit
            });
            if (res.killed) handleMonsterKill(targetM, skIcon, res);
          }
          
          let chainCount = 0;
          const chainDmgMults = [1, 0.8, 0.6];
          for (const m of localMonsters) {
            if (m.id !== targetM.id && m.hp > 0 && chainCount < 2) {
              const chainDmg = Math.round(finalDmg * chainDmgMults[chainCount + 1]);
              const chainRes = worldManager.damageMonster(mapId, m.id, chainDmg);
              if (chainRes) {
                chainFx.push({ x: m.x, y: m.y });
                events.push({
                  type: "hit",
                  msg: `${skIcon} Sấm sét lan -${chainDmg} HP (còn ${chainRes.hp || 0})`,
                  mid: m.id,
                  icon: skIcon,
                  dmg: chainDmg,
                  crit: isCrit
                });
                if (chainRes.killed) handleMonsterKill(m, skIcon, chainRes);
              }
              chainCount++;
            }
          }
          events.push({
            type: "dv_chain",
            sx: playerObj.x,
            sy: playerObj.y,
            fx: chainFx
          });
        } else if (isAoE) {
          // AoE chém xoay: Tấn công target chính và tối đa 5 quái xung quanh
          events.push({
            type: "spin_aoe",
            x: playerObj.x,
            y: playerObj.y,
            r: 150
          });
          const res = worldManager.damageMonster(mapId, targetM.id, finalDmg);
          if (res) {
            attackRes = res;
            events.push({
              type: "hit",
              msg: `${skIcon} Đánh trúng -${finalDmg} HP (còn ${res.hp || 0})`,
              mid: targetM.id,
              icon: skIcon,
              dmg: finalDmg,
              crit: isCrit
            });
            if (res.killed) handleMonsterKill(targetM, skIcon, res);
          }
          
          let aoeCount = 0;
          for (const m of localMonsters) {
            if (m.id !== targetM.id && m.hp > 0 && aoeCount < 5 && Math.hypot(m.x - playerObj.x, m.y - playerObj.y) <= 150) {
              const aoeRes = worldManager.damageMonster(mapId, m.id, finalDmg);
              if (aoeRes) {
                events.push({
                  type: "hit",
                  msg: `${skIcon} Đánh lan -${finalDmg} HP (còn ${aoeRes.hp || 0})`,
                  mid: m.id,
                  icon: skIcon,
                  dmg: finalDmg,
                  crit: isCrit
                });
                if (aoeRes.killed) handleMonsterKill(m, skIcon, aoeRes);
              }
              aoeCount++;
            }
          }
        } else if (isExplosive) {
          // Explode: Gây sát thương AoE nổ xung quanh
          const explosionHits = [];
          localMonsters.forEach(m => {
            if (m.hp > 0 && Math.hypot(m.x - targetM.x, m.y - targetM.y) <= 100) {
              const res = worldManager.damageMonster(mapId, m.id, finalDmg);
              if (res) {
                if (m.id === targetM.id) attackRes = res;
                explosionHits.push([m.id, finalDmg]);
                events.push({
                  type: "hit",
                  msg: `${skIcon} Nổ trúng -${finalDmg} HP (còn ${res.hp || 0})`,
                  mid: m.id,
                  icon: skIcon,
                  crit: isCrit
                });
                if (res.killed) handleMonsterKill(m, skIcon, res);
              }
            }
          });
          // Bắn mũi tên bay tới
          events.push({
            type: "arrow",
            mid: targetM.id,
            x: targetM.x,
            y: targetM.y,
            hits: [finalDmg],
            exp: 1
          });
          // Tạo vụ nổ nổ chậm đồng bộ khi mũi tên chạm đích
          events.push({
            type: "explosion",
            x: targetM.x,
            y: targetM.y,
            r: 100,
            color: "#f97316",
            sic: "🏹💥",
            hits: explosionHits,
            crit: isCrit
          });
        } else {
          // Đánh đơn mục tiêu bình thường (hoặc Lock-on, Sword Cross, Sword X)
          if (activeSkillTriggered === 'sword_cross') {
            events.push({
              type: 'sword_skill',
              mid: targetM.id,
              x: targetM.x,
              y: targetM.y,
              kind: 'cross'
            });
          } else if (activeSkillTriggered === 'sword_x') {
            events.push({
              type: 'sword_skill',
              mid: targetM.id,
              x: targetM.x,
              y: targetM.y,
              kind: 'x'
            });
          } else if (activeSkillTriggered === 'kill_shot') {
            events.push({
              type: 'beam',
              path: [[playerObj.x, playerObj.y], [targetM.x, targetM.y]],
              color: '#a855f7'
            });
          } else if (activeSkillTriggered === 'lock_on') {
            events.push({
              type: 'lockon',
              mid: targetM.id
            });
          }

          const res = worldManager.damageMonster(mapId, targetM.id, finalDmg);
          if (res) {
            attackRes = res;
            events.push({
              type: "hit",
              msg: `${skIcon} Đánh trúng -${finalDmg} HP (còn ${res.hp || 0})`,
              mid: targetM.id,
              icon: skIcon,
              dmg: finalDmg,
              crit: isCrit
            });
            
            if (isLockOn) {
              targetM.locked_on = 1 + skLv * 0.2;
            }
            
            if (res.killed) {
              handleMonsterKill(targetM, skIcon, res);
            }
          }
        }
      } else {
        // Pull monster
        attackRes = { killed: false, hp: targetM.hp };
      }
      
      // 3. Quái vật phản đòn (bỏ qua nếu quái đã chết hoặc bị choáng)
      const isTargetStunned = targetM.stunned || (targetM.stun_until && Date.now() < targetM.stun_until);
      
      if (attackRes && !attackRes.killed && targetM.hp > 0 && !isTargetStunned) {
        // Tính toán chỉ số phòng thủ hiệu dụng của người chơi
        const vitEffVal = playerObj.vit_eff ?? playerObj.vit ?? 5;
        const armLvVal = playerObj.armor_lv || 0;
        
        let defMod = 0;
        try {
          let armorModules = {};
          if (playerObj.armor_modules) {
            armorModules = typeof playerObj.armor_modules === 'string' ? JSON.parse(playerObj.armor_modules || '{}') : playerObj.armor_modules;
          }
          function getArmorModDefOne(plus) {
            const p = Math.max(0, Math.min(15, parseInt(plus) || 0));
            if (p <= 5) return 3 * p;
            if (p <= 10) return 15 + (p - 5) * 4;
            return 35 + (p - 10) * 6;
          }
          ['a_max', 'a_regen', 'a_return'].forEach(k => {
            const m = armorModules[k];
            if (m) defMod += getArmorModDefOne(m.plus);
          });
        } catch (e) {
          console.error("Lỗi parse armor_modules tính defMod:", e);
        }

        const eq2DefBonus = getEq2FxSum(playerObj, 'def');
        const playerDef = 10 + Math.max(0, vitEffVal - 5) + armLvVal + defMod + eq2DefBonus;

        const rawDmg = Math.max(1, Math.round((targetM.lv * 2) - playerDef));
        let dmgToHp = rawDmg;
        let absorbed = 0;
        
        const currentArmor = playerObj.armor !== undefined ? playerObj.armor : 0;
        if (currentArmor > 0) {
          if (currentArmor >= rawDmg) {
            absorbed = rawDmg;
            playerObj.armor = currentArmor - rawDmg;
            dmgToHp = 0;
          } else {
            absorbed = currentArmor;
            dmgToHp = rawDmg - currentArmor;
            playerObj.armor = 0;
          }
        }
        
        playerObj.hp = Math.max(0, playerObj.hp - dmgToHp);
        
        // Phản sát thương (melee_return)
        const meleeReturnLv = skills.melee_return || 0;
        const vit = playerObj.vit_eff ?? playerObj.vit ?? 5;
        const armLv = playerObj.armor_lv || 0;
        if (meleeReturnLv > 0) {
          // Tính baseDmg cho phản đòn
          const baseDmgResult = combatEngine.calculateDamage(playerObj, targetM, activeWeapon, { str: playerObj.str_eff, dex: playerObj.dex_eff, agi: playerObj.agi_eff }, (key) => getEq2FxSum(playerObj, key));
          const baseDmg = typeof baseDmgResult === 'object' ? baseDmgResult.dmg : baseDmgResult;
          
          const pctAtkMon = (8 + meleeReturnLv * 5) / 100 * (targetM.lv * 2);
          const vitReflect = (2 + meleeReturnLv * 0.2) * vit;
          const pctAtkMid = (3 + meleeReturnLv * 3) / 100 * baseDmg;
          const armLvReflect = (2 + meleeReturnLv * 0.8) * armLv;
          const reflectDmg = Math.round(pctAtkMon + vitReflect + pctAtkMid + armLvReflect);
          
          const reflectRes = worldManager.damageMonster(mapId, targetM.id, reflectDmg);
          if (reflectRes) {
            events.push({
              type: "hit",
              msg: `🛡️ Phản đòn -${reflectDmg} HP (còn ${reflectRes.hp || 0})`,
              mid: targetM.id,
              icon: "🛡️",
              dmg: reflectDmg,
              crit: 0
            });
            if (reflectRes.killed) handleMonsterKill(targetM, "🛡️", reflectRes);
          }
        }

        // Pet gánh chịu sát thương
        if (playerObj.pet_mid && playerObj.pet_mid > 0 && !playerObj.pet_down) {
          const petOlv = playerObj.pet_olv || 1;
          const petMvp = playerObj.pet_mvp || 0;
          const petLv = getPetLv(playerObj.pet_exp || 0);
          
          let sacStar = 0;
          if (playerObj.sac_eggs) {
            let sacEggs = playerObj.sac_eggs;
            if (typeof sacEggs === 'string') { try { sacEggs = JSON.parse(sacEggs || '{}'); } catch(e) {} }
            if (sacEggs && typeof sacEggs === 'object') {
              const sacVal = sacEggs[playerObj.pet_mid];
              sacStar = (sacVal && typeof sacVal === 'object') ? (sacVal.st || 0) : (parseInt(sacVal) || 0);
            }
          }
          const es = 1 + 0.05 * Math.max(0, Math.min(30, sacStar));
          const petDef = Math.max(0, Math.round((petOlv + petLv + 2 * (playerObj.pet_up_hp || 0)) * (petMvp ? 2 : 1) * es));
          
          const petBondLv = skills.pet_bond || 0;
          const petHpMax = Math.max(1, Math.round(0.5 * (playerObj.pet_bhp || (petOlv * 8)) * (1 + 0.25 * petLv) * (petMvp ? 2 : 1) * es * (1 + petBondLv * 0.15)));

          const rawPetDmg = targetM.lv * 2.5;
          const petDmg = Math.max(1, Math.round(rawPetDmg - petDef));
          
          playerObj.pet_hp = Math.max(0, (playerObj.pet_hp || petHpMax) - petDmg);
          if (playerObj.pet_hp <= 0) {
            playerObj.pet_down = 1;
            playerObj.pet_hp = 0;
            events.push({ type: "dead", msg: `💤 Thú cưng đã bị hạ gục (sốt sột)!` });
          }
        }

        // Thần hộ mệnh Anubis gánh chịu sát thương
        if (playerObj.dv_pet && playerObj.dv_pet > 0 && !playerObj.dv_down) {
          const lv = getDvLv(playerObj.dv_exp || 0);
          const g = 1 + 0.02 * (lv - 1);
          const dvDef = Math.max(0, Math.round(372 * g) + 2 * (playerObj.dv_up_hp || 0));
          const dvHpMax = Math.max(1, Math.round(183000 * (g + 0.05 * (playerObj.dv_up_hp || 0))));
          
          const rawPetDmg = targetM.lv * 2.5;
          const dvDmg = Math.max(1, Math.round(rawPetDmg - dvDef));
          
          playerObj.dv_hp = Math.max(0, (playerObj.dv_hp || dvHpMax) - dvDmg);
          if (playerObj.dv_hp <= 0) {
            playerObj.dv_down = 1;
            playerObj.dv_hp = 0;
            events.push({ type: "dead", msg: `💤 Thần hộ mệnh Anubis đã kiệt sức!` });
          }
        }
        
        let combatMsg = "";
        if (absorbed > 0) {
          if (dmgToHp > 0) {
            combatMsg = `💥 ${targetM.name} đánh trả bạn: Giáp hấp thụ -${absorbed}, HP giảm -${dmgToHp} (HP còn ${playerObj.hp}/${playerObj.hp_max || 300}, Giáp còn ${playerObj.armor})`;
          } else {
            combatMsg = `💥 ${targetM.name} đánh trả bạn: Giáp hấp thụ -${absorbed} (HP còn ${playerObj.hp}/${playerObj.hp_max || 300}, Giáp còn ${playerObj.armor})`;
          }
        } else {
          combatMsg = `💥 ${targetM.name} đánh trả bạn -${dmgToHp} HP (HP còn ${playerObj.hp}/${playerObj.hp_max || 300})`;
        }

        events.push({
          type: "explore",
          msg: combatMsg
        });

        // Gửi thêm sự kiện mon_atk để client hiển thị hiệu ứng động và Float Text
        events.push({
          type: "mon_atk",
          dmg: dmgToHp,
          absorb: absorbed,
          mid: targetM.id
        });
      }

    }
  }
  }

  // --- HỆ THỐNG THÚ CƯNG & ĐỒNG HÀNH DI CHUYỂN & CHIẾN ĐẤU ---
  
  // 1. Thú cưng (Pet)
  if (playerObj.pet_mid && playerObj.pet_mid > 0) {
    let petX = playerObj.pet_x !== undefined && playerObj.pet_x !== null ? playerObj.pet_x : playerObj.x + 22;
    let petY = playerObj.pet_y !== undefined && playerObj.pet_y !== null ? playerObj.pet_y : playerObj.y + 12;
    
    // Teleport nếu ở quá xa
    if (Math.hypot(playerObj.x - petX, playerObj.y - petY) > 400) {
      petX = playerObj.x;
      petY = playerObj.y;
    }
    
    if (playerObj.pet_down) {
      // Đi theo chủ nhân
      const tx = playerObj.x + 22;
      const ty = playerObj.y + 12;
      const distToHome = Math.hypot(tx - petX, ty - petY);
      if (distToHome > 10) {
        const moveSpeed = 60;
        petX += ((tx - petX) / distToHome) * Math.min(distToHome, moveSpeed);
        petY += ((ty - petY) / distToHome) * Math.min(distToHome, moveSpeed);
      }
    } else {
      if (targetM && targetM.hp > 0 && playerObj.hp > 0) {
        const distToTarget = Math.hypot(targetM.x - petX, targetM.y - petY);
        if (distToTarget > 35) {
          const moveSpeed = 60;
          petX += ((targetM.x - petX) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
          petY += ((targetM.y - petY) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
        }
        
        const newDistToTarget = Math.hypot(targetM.x - petX, targetM.y - petY);
        if (newDistToTarget <= 45) {
          const petLv = getPetLv(playerObj.pet_exp || 0);
          let sacStar = 0;
          if (playerObj.sac_eggs) {
            let sacEggs = playerObj.sac_eggs;
            if (typeof sacEggs === 'string') { try { sacEggs = JSON.parse(sacEggs || '{}'); } catch(e) {} }
            if (sacEggs && typeof sacEggs === 'object') {
              const sacVal = sacEggs[playerObj.pet_mid];
              sacStar = (sacVal && typeof sacVal === 'object') ? (sacVal.st || 0) : (parseInt(sacVal) || 0);
            }
          }
          const es = 1 + 0.05 * Math.max(0, Math.min(30, sacStar));
          const petOlv = playerObj.pet_olv || 1;
          const petMvp = playerObj.pet_mvp || 0;
          
          const petAtkBase = playerObj.pet_batk || (petOlv * 3);
          const petBondLv = skills.pet_bond || 0;
          const petDmg = Math.max(1, Math.round(petAtkBase * (2 + 0.20 * petLv + 0.30 * (playerObj.pet_up_atk || 0)) * (petMvp ? 2 : 1) * es * (1 + petBondLv * 0.15)));
          
          const attackRes = worldManager.damageMonster(mapId, targetM.id, petDmg);
          if (attackRes) {
            events.push({
              type: "hit",
              msg: `🐾 Pet đánh trúng -${petDmg} HP (còn ${attackRes.hp || 0})`,
              mid: targetM.id,
              icon: "🐾",
              dmg: petDmg,
              crit: 0
            });
            
            if (attackRes.killed) {
              handleMonsterKill(targetM, "🐾", attackRes);
            }
          }
        }
      } else {
        // Đi theo chủ nhân
        const tx = playerObj.x + 22;
        const ty = playerObj.y + 12;
        const distToHome = Math.hypot(tx - petX, ty - petY);
        if (distToHome > 10) {
          const moveSpeed = 60;
          petX += ((tx - petX) / distToHome) * Math.min(distToHome, moveSpeed);
          petY += ((ty - petY) / distToHome) * Math.min(distToHome, moveSpeed);
        }
      }
    }
    playerObj.pet_x = Math.round(Math.max(50, Math.min(2200, petX)));
    playerObj.pet_y = Math.round(Math.max(50, Math.min(2200, petY)));
  }
  
  // 2. Hiệp sĩ Skeleton Knight
  const hasKnight = (parseInt(playerObj.knight_expires) || 0) > Math.floor(Date.now() / 1000) && playerObj.knight_on === 1;
  if (hasKnight) {
    let knightX = playerObj.knight_x !== undefined && playerObj.knight_x !== null ? playerObj.knight_x : playerObj.x + 20;
    let knightY = playerObj.knight_y !== undefined && playerObj.knight_y !== null ? playerObj.knight_y : playerObj.y + 14;
    
    // Teleport nếu ở quá xa
    if (Math.hypot(playerObj.x - knightX, playerObj.y - knightY) > 400) {
      knightX = playerObj.x;
      knightY = playerObj.y;
    }
    
    if (targetM && targetM.hp > 0 && playerObj.hp > 0) {
      const distToTarget = Math.hypot(targetM.x - knightX, targetM.y - knightY);
      if (distToTarget > 35) {
        const moveSpeed = 68;
        knightX += ((targetM.x - knightX) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
        knightY += ((targetM.y - knightY) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
      }
      
      const newDistToTarget = Math.hypot(targetM.x - knightX, targetM.y - knightY);
      if (newDistToTarget <= 45) {
        const knLv = playerObj.knight_lv || 1;
        const knDmg = knLv * 8 + 20;
        
        const attackRes = worldManager.damageMonster(mapId, targetM.id, knDmg);
        if (attackRes) {
          events.push({
            type: "hit",
            msg: `⚔️ Skeleton Knight chém trúng -${knDmg} HP (còn ${attackRes.hp || 0})`,
            mid: targetM.id,
            icon: "⚔️",
            dmg: knDmg,
            crit: 0
          });
          
          if (attackRes.killed) {
            handleMonsterKill(targetM, "⚔️", attackRes);
          }
        }
      }
    } else {
      // Đi theo chủ nhân
      const tx = playerObj.x + 20;
      const ty = playerObj.y + 14;
      const distToHome = Math.hypot(tx - knightX, ty - knightY);
      if (distToHome > 10) {
        const moveSpeed = 68;
        knightX += ((tx - knightX) / distToHome) * Math.min(distToHome, moveSpeed);
        knightY += ((ty - knightY) / distToHome) * Math.min(distToHome, moveSpeed);
      }
    }
    playerObj.knight_x = Math.round(Math.max(50, Math.min(2200, knightX)));
    playerObj.knight_y = Math.round(Math.max(50, Math.min(2200, knightY)));
  }
  
  // 3. Cung thủ Elf Archer
  const hasArcher = (parseInt(playerObj.archer_expires) || 0) > Math.floor(Date.now() / 1000) && playerObj.archer_on === 1;
  if (hasArcher && targetM && targetM.hp > 0 && playerObj.hp > 0) {
    const distToTarget = Math.hypot(targetM.x - playerObj.x, targetM.y - playerObj.y);
    if (distToTarget <= 150) {
      const arLv = playerObj.archer_lv || 1;
      const arDmg = arLv * 6 + 10;
      
      const attackRes = worldManager.damageMonster(mapId, targetM.id, arDmg);
      if (attackRes) {
        events.push({
          type: "arrow",
          mid: targetM.id,
          x: targetM.x,
          y: targetM.y,
          exp: 0,
          hits: [Math.floor(arDmg / 3), Math.floor(arDmg / 3), arDmg - 2 * Math.floor(arDmg / 3)]
        });
        
        if (attackRes.killed) {
          handleMonsterKill(targetM, "🏹", attackRes);
        }
      }
    }
  }
  
  // 4. Titan Robot
  const hasRobot = (playerObj.robot_lv || 0) >= 1;
  if (hasRobot) {
    let robotX = playerObj.robot_x !== undefined && playerObj.robot_x !== null ? playerObj.robot_x : playerObj.x + 15;
    let robotY = playerObj.robot_y !== undefined && playerObj.robot_y !== null ? playerObj.robot_y : playerObj.y;
    
    // Teleport nếu ở quá xa
    if (Math.hypot(playerObj.x - robotX, playerObj.y - robotY) > 400) {
      robotX = playerObj.x;
      robotY = playerObj.y;
    }
    
    if (targetM && targetM.hp > 0 && playerObj.hp > 0) {
      const distToTarget = Math.hypot(targetM.x - robotX, targetM.y - robotY);
      if (distToTarget > 35) {
        const moveSpeed = 60;
        robotX += ((targetM.x - robotX) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
        robotY += ((targetM.y - robotY) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
      }
      
      const newDistToTarget = Math.hypot(targetM.x - robotX, targetM.y - robotY);
      if (newDistToTarget <= 45) {
        const rLv = playerObj.robot_lv || 1;
        const axeLv = playerObj.robot_axe_lv || 0;
        const robotMasteryLv = skills.robot_mastery || 0;
        const rDmg = Math.round((rLv * 10 + axeLv * 12 + 30) * (1 + robotMasteryLv * 0.1));
        
        const attackRes = worldManager.damageMonster(mapId, targetM.id, rDmg);
        if (attackRes) {
          events.push({
            type: "hit",
            msg: `🦾 Robot đập trúng -${rDmg} HP (còn ${attackRes.hp || 0})`,
            mid: targetM.id,
            icon: "🪓",
            src: "axe",
            dmg: rDmg,
            crit: 0
          });
          
          if (attackRes.killed) {
            handleMonsterKill(targetM, "🪓", attackRes);
          }
        }
      }
    } else {
      // Đi theo chủ nhân
      const tx = playerObj.x + 15;
      const ty = playerObj.y;
      const distToHome = Math.hypot(tx - robotX, ty - robotY);
      if (distToHome > 10) {
        const moveSpeed = 60;
        robotX += ((tx - robotX) / distToHome) * Math.min(distToHome, moveSpeed);
        robotY += ((ty - robotY) / distToHome) * Math.min(distToHome, moveSpeed);
      }
    }
    playerObj.robot_x = Math.round(Math.max(50, Math.min(2200, robotX)));
    playerObj.robot_y = Math.round(Math.max(50, Math.min(2200, robotY)));
  }
  
  // 5. Thần hộ mệnh Anubis (Divine Pet)
  const hasDivine = playerObj.dv_pet && playerObj.dv_pet > 0 && playerObj.dv_on === 1;
  if (hasDivine) {
    let dvX = playerObj.dv_x !== undefined && playerObj.dv_x !== null ? playerObj.dv_x : playerObj.x + 22;
    let dvY = playerObj.dv_y !== undefined && playerObj.dv_y !== null ? playerObj.dv_y : playerObj.y - 10;
    
    // Teleport nếu ở quá xa
    if (Math.hypot(playerObj.x - dvX, playerObj.y - dvY) > 400) {
      dvX = playerObj.x;
      dvY = playerObj.y;
    }
    
    if (playerObj.dv_down) {
      // Đi theo chủ nhân
      const tx = playerObj.x + 22;
      const ty = playerObj.y - 10;
      const distToHome = Math.hypot(tx - dvX, ty - dvY);
      if (distToHome > 10) {
        const moveSpeed = 75;
        dvX += ((tx - dvX) / distToHome) * Math.min(distToHome, moveSpeed);
        dvY += ((ty - dvY) / distToHome) * Math.min(distToHome, moveSpeed);
      }
    } else {
      if (targetM && targetM.hp > 0 && playerObj.hp > 0) {
        const distToTarget = Math.hypot(targetM.x - dvX, targetM.y - dvY);
        if (distToTarget > 35) {
          const moveSpeed = 75;
          dvX += ((targetM.x - dvX) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
          dvY += ((targetM.y - dvY) / distToTarget) * Math.min(distToTarget - 25, moveSpeed);
        }
        
        const newDistToTarget = Math.hypot(targetM.x - dvX, targetM.y - dvY);
        if (newDistToTarget <= 45) {
          const lv = getDvLv(playerObj.dv_exp || 0);
          const g = 1 + 0.02 * (lv - 1);
          const ragAtkMult = 1 + 0.001 * Math.max(0, parseInt(playerObj.rag_atk) || 0);
          const dvAtk = Math.max(1, Math.round(2748 * (g + 0.10 * (playerObj.dv_up_atk || 0)) * ragAtkMult));
          
          const attackRes = worldManager.damageMonster(mapId, targetM.id, dvAtk);
          if (attackRes) {
            events.push({
              type: "dv_chain",
              sx: dvX,
              sy: dvY,
              fx: [{ x: targetM.x, y: targetM.y }],
              mid: targetM.id,
              crit: 0
            });
            
            events.push({
              type: "hit",
              msg: `🏺 Anubis đánh trúng -${dvAtk} HP (còn ${attackRes.hp || 0})`,
              mid: targetM.id,
              icon: "🏺",
              dmg: dvAtk,
              crit: 0
            });
            
            if (attackRes.killed) {
              handleMonsterKill(targetM, "🏺", attackRes);
            }
          }
        }
      } else {
        // Đi theo chủ nhân
        const tx = playerObj.x + 22;
        const ty = playerObj.y - 10;
        const distToHome = Math.hypot(tx - dvX, ty - dvY);
        if (distToHome > 10) {
          const moveSpeed = 75;
          dvX += ((tx - dvX) / distToHome) * Math.min(distToHome, moveSpeed);
          dvY += ((ty - dvY) / distToHome) * Math.min(distToHome, moveSpeed);
        }
      }
    }
    playerObj.dv_x = Math.round(Math.max(50, Math.min(2200, dvX)));
    playerObj.dv_y = Math.round(Math.max(50, Math.min(2200, dvY)));
  }

  // Xử lý khi nhân vật chết
  if (playerObj.hp <= 0) {
    playerObj.hp = Math.round(hpMaxEff * 0.5);
    playerObj.map = 1;
    playerObj.x = 1125;
    playerObj.y = 1125;
    playerObj.explore_cx = 1125;
    playerObj.explore_cy = 1125;
    playerObj.target_monster_id = null;
    events.push({ type: "dead", msg: "💀 Bạn đã hy sinh! Tự động hồi sinh tại Cánh đồng trung tâm." });
  }

  // Đồng bộ các trường hiển thị quan trọng
  playerObj.exp_next = expNextHero(playerObj.lv || 1) - playerObj.exp;
  pRow.exp = playerObj.exp;
  pRow.gold = playerObj.gold;
  pRow.lv = playerObj.lv || 1;
  pRow.map = playerObj.map;

  // Lưu lại player vào db
  db.prepare(`
    UPDATE players SET 
      x = ?, y = ?, exp = ?, gold = ?, lv = ?, raw_data = ?
    WHERE line_uid = ?
  `).run(playerObj.x, playerObj.y, pRow.exp, pRow.gold, pRow.lv, JSON.stringify(playerObj), line_uid);

  // Lấy danh sách quái vật mới trong tầm (sau khi đã xử lý chết/spawn) để gửi về client
  const finalMonsters = worldManager.getMonstersInRadius(mapId, cx, cy, radius);

  // Phân loại quái thường và BOSS MVP
  const bossesList = finalMonsters.filter(m => m.is_mvp);

  // Lấy danh sách người chơi khác cùng map
  const otherPlayers = worldManager.getOthersOnMap(mapId, line_uid);

  // Trả về JSON chuẩn của game
  const responseData = {
    ok: 1,
    player: playerObj,
    monsters: finalMonsters,
    bosses: bossesList,
    others: otherPlayers,
    ally: [],
    events: events,
    drop_fx: drops,
    equipment_bonus: eq2Bonus,
    module_stat_bonus: modBonus,
    stat_parts_bonus: [],
    target_monster_id: playerObj.target_monster_id || null,
    card_coll: card_coll,
    egg_coll: egg_coll,
    online_count: 168,
    offline: null,
    region: "VN",
    ts: Math.floor(Date.now() / 1000),
    map: mapId,
    ev: { e: 2, d: 1.5, g: 1.5, n: "NEW COME" },
    gwn: "Server Mới",
    cwc: "VN",
    col_n: 0,
    chat_n: 0, 
    dm_n: 0, 
    gchat_n: 0,
    gturrets: [],
    ci: 532, 
    otbl: 10733,
    araid: { on: 1, g: 0, c: 0, used: 1, max: 5 },
    auc: { end: Math.floor(Date.now() / 1000) + 3600, bid: 0, now: Math.floor(Date.now() / 1000) }
  };

  // Gửi spots khi client yêu cầu (have_static != 1)
  if (have_static != '1') {
    const mapSpots = worldManager.getSpotsForMap(mapId);
    if (mapSpots.length > 0) {
      responseData.spots = mapSpots;
    }
    
    const enrichedMonMasters = {};
    for (const [mid, mon] of Object.entries(worldManager.monMastersCache)) {
      enrichedMonMasters[mid] = {
        ...mon,
        ba: Math.max(1, mon.lv * 3),
        bh: Math.max(2, Math.round(worldManager.getMonsterHpMax(mon.lv) / 3))
      };
    }
    responseData.mon_masters = enrichedMonMasters;
  }

    res.json(responseData);
  } finally {
    release();
  }
});

module.exports = router;
