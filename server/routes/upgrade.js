const express = require('express');
const db = require('../db/queries');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Load mon_masters_cache.json
let monMastersCache = {};
try {
  const monMastersPath = path.join(__dirname, '..', '..', 'data', 'mon_masters_cache.json');
  monMastersCache = JSON.parse(fs.readFileSync(monMastersPath, 'utf8'));
} catch (err) {
  console.error("Lỗi đọc mon_masters_cache.json trong upgrade.js", err);
}

// Helpers for boxes, modules and cards
const MODULE_WEAPONS = ['pistol', 'sniper', 'knife', 'axe', 'robot', 'robot_gun', 'railgun', 'armor', 'house', 'turret'];
const MDC_FAM_SLOTS = {
  pistol: ['barrel','sight','mag'],
  sniper: ['barrel','sight','mag'],
  knife: ['barrel','sight','mag'],
  axe: ['barrel','sight','mag'],
  robot: ['core_back','core_brain','core_center'],
  robot_gun: ['barrel','sight','mag'],
  railgun: ['barrel','sight','mag'],
  armor: ['a_max','a_regen','a_return'],
  house: ['h_roof','h_wall','h_floor'],
  turret: ['t_atk','t_range','t_dur']
};
const MOD_INV_FIELDS = {
  pistol: 'module_inventory', sniper: 'sniper_module_inventory', knife: 'knife_module_inventory',
  axe: 'axe_module_inventory', robot: 'robot_module_inventory', robot_gun: 'robot_gun_module_inventory',
  railgun: 'railgun_module_inventory', armor: 'armor_module_inventory', house: 'house_module_inventory',
  turret: 'turret_module_inventory'
};
const RARITY_NAMES = { 1: 'Thường', 2: 'Hiếm', 3: 'Tinh Nhuệ', 4: 'Sử Thi', 5: 'Huyền Thoại', 6: 'Thần Thoại', 7: 'Cổ Đại' };
const SLOT_NAMES = {
  barrel: 'Nòng', sight: 'Kính ngắm', mag: 'Băng đạn',
  core_back: 'Lông vũ', core_brain: 'Bộ não', core_center: 'Hạt nhân',
  a_max: 'Giáp tối đa', a_regen: 'Hồi phục giáp', a_return: 'Phản sát thương',
  h_roof: 'Mái che', h_wall: 'Thân tàu', h_floor: 'Khoang máy',
  t_atk: 'Sát thương Trụ', t_range: 'Tầm bắn Trụ', t_dur: 'Độ bền Trụ'
};
const WEAPON_NAMES = {
  pistol: 'Súng ngắn', sniper: 'Súng trường', knife: 'Dao găm', axe: 'Rìu Titan',
  robot: 'Titan Robot', robot_gun: 'Súng Titan', railgun: 'Titan Beam',
  armor: 'Giáp bảo vệ', house: 'Phi thuyền', turret: 'Trụ súng'
};

const _MVP_CB_TYPES = ['str','agi','vit','dex','intel','luk','atk','armor','hp','mp','hp_regen','mp_regen'];

function _mvpCardBonus(mid, lv) {
  lv = Math.max(1, parseInt(lv) || 1);
  const t = _MVP_CB_TYPES[Math.abs(parseInt(mid) || 0) % 12];
  let a;
  if (t === 'hp' || t === 'mp') a = Math.round(lv * 30 / 4);
  else if (t === 'armor') a = Math.ceil(lv / 10) * 30;
  else if (t === 'hp_regen' || t === 'mp_regen') a = Math.max(1, Math.floor(lv / 10)) * 3;
  else a = Math.ceil(lv / 10) * 3;
  return { t, a };
}

function sanitizeCardOrEggCollection(collection) {
  if (!collection) return {};
  let obj = collection;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj || '{}'); } catch(e) { obj = {}; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  
  const cleaned = {};
  for (const mid in obj) {
    const val = obj[mid];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      cleaned[mid] = {
        n: parseInt(val.n) || 0,
        m: parseInt(val.m) || 0
      };
    } else {
      cleaned[mid] = {
        n: parseInt(val) || 0,
        m: 0
      };
    }
  }
  return cleaned;
}

function getRandomMonsterInLvRange(lo, hi) {
  const candidates = [];
  for (const mid in monMastersCache) {
    const mon = monMastersCache[mid];
    const lv = parseInt(mon.lv);
    if (lv >= lo && lv <= hi) {
      candidates.push(Object.assign({ mid: parseInt(mid) }, mon));
    }
  }
  if (candidates.length === 0) {
    const allMids = Object.keys(monMastersCache);
    const mid = allMids[Math.floor(Math.random() * allMids.length)];
    return Object.assign({ mid: parseInt(mid) }, monMastersCache[mid]);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function generateModuleStats(weapon, slot, tier, rarity) {
  const stats = {};
  const value = tier * 3 + rarity * 2;
  const statTypes = ['str', 'agi', 'vit', 'intel', 'dex', 'luk', 'atk', 'def', 'spd'];
  const chosenStat = statTypes[Math.floor(Math.random() * statTypes.length)];
  stats[chosenStat] = value;
  return stats;
}

function generateNewModule(tier) {
  const weapon = MODULE_WEAPONS[Math.floor(Math.random() * MODULE_WEAPONS.length)];
  const slots = MDC_FAM_SLOTS[weapon];
  const slot = slots[Math.floor(Math.random() * slots.length)];
  const rarity = Math.max(1, Math.min(7, tier + (Math.random() < 0.15 ? 1 : (Math.random() < 0.05 ? 2 : 0))));
  const sockets = rarity;
  const stats = generateModuleStats(weapon, slot, tier, rarity);
  const statName = Object.keys(stats)[0];
  const statVal = stats[statName];

  const m = {
    id: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    t: tier,
    slot: slot,
    rarity: rarity,
    sockets: sockets,
    c: Array(sockets).fill(null),
    cards: Array(sockets).fill(null),
    opt: stats
  };
  return { m, weapon, slot, statName, statVal };
}

// Helper formulas
const START_GOLD = [100, 2000, 5000, 10000, 19000, 36000, 69000, 134000, 263000, 520000];
const END_GOLD   = [1000, 3000, 6000, 11000, 20000, 37000, 70000, 135000, 264000, 521000];

function tierGold(lv) {
  lv = Math.max(1, lv);
  let b = Math.floor((lv - 1) / 10); if (b > 9) b = 9;
  const pos = (lv - 1) % 10;
  return Math.round((START_GOLD[b] + pos * (END_GOLD[b] - START_GOLD[b]) / 9) / 100) * 100;
}

function tierRes(lv) {
  lv = Math.max(1, lv);
  let b = Math.floor((lv - 1) / 10); if (b > 9) b = 9;
  return Math.ceil(lv * (10 + 20 * b) * (10 + b) / 10);
}

function upgCostMult(t) {
  if (t < 20) return 1.0;
  const band = Math.floor(t / 10);
  return 1.1 + 0.25 * (band - 2);
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

function getPetSlots(olv, mvp) {
  olv = Math.max(1, olv | 0);
  let s = Math.min(5, Math.ceil(olv / 20));
  if (mvp) s += Math.min(3, Math.ceil(olv / 30));
  return s;
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

router.post('/', async (req, res) => {
  const { line_uid, action } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
  }

  const { acquireLock } = require('../utils/lock');
  const release = await acquireLock(line_uid);

  try {
    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Player not found' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    // Backfill module cards format for client/server compatibility
    backfillModuleCards(playerObj);

    // Sanitize cards and eggs at the start of the request
    playerObj.cards = sanitizeCardOrEggCollection(playerObj.cards);
    playerObj.eggs = sanitizeCardOrEggCollection(playerObj.eggs);

  let msg = 'Thao tác thành công';
  let success = true;

  // 1. Thao tác bật tắt súng
  if (action === 'gun_use') {
    const { gun_type } = req.body;
    if (gun_type === 'pistol') {
      playerObj.gun_use_pistol = playerObj.gun_use_pistol === 0 ? 1 : 0;
      msg = `Đã ${playerObj.gun_use_pistol === 1 ? 'bật' : 'tắt'} sử dụng Súng ngắn`;
    } else if (gun_type === 'sniper') {
      playerObj.gun_use_sniper = playerObj.gun_use_sniper === 0 ? 1 : 0;
      msg = `Đã ${playerObj.gun_use_sniper === 1 ? 'bật' : 'tắt'} sử dụng Súng trường`;
    } else if (gun_type === 'turret') {
      playerObj.gun_use_turret = playerObj.gun_use_turret === 0 ? 1 : 0;
      msg = `Đã ${playerObj.gun_use_turret === 1 ? 'bật' : 'tắt'} sử dụng Cỗ máy bắn`;
    } else if (gun_type === 'stun') {
      playerObj.gun_use_stun = playerObj.gun_use_stun === 0 ? 1 : 0;
      msg = `Đã ${playerObj.gun_use_stun === 1 ? 'bật' : 'tắt'} bẫy Stun`;
    }
  } 
  
  // 2. Chuyển súng
  else if (action === 'switch_gun') {
    const active_gun = parseInt(req.body.active_gun);
    playerObj.active_gun = active_gun === 1 ? 1 : 0;
    msg = `Đã chuyển sang ${playerObj.active_gun === 1 ? 'Súng trường' : 'Súng ngắn'}`;
  } 

  // 3. Cộng điểm chỉ số (stat_up)
  else if (action === 'stat_up') {
    const { param, amount } = req.body;
    const pts = parseInt(amount) || 1;
    const statName = param === 'int' ? 'intel' : param;
    
    if (!['str', 'agi', 'vit', 'intel', 'dex', 'luk'].includes(statName)) {
      success = false;
      msg = 'Chỉ số không hợp lệ';
    } else if ((playerObj.stat_pts || 0) < pts) {
      success = false;
      msg = 'Không đủ điểm tiềm năng';
    } else {
      playerObj.stat_pts = (playerObj.stat_pts || 0) - pts;
      playerObj[statName] = (playerObj[statName] || 5) + pts;
      msg = `Cộng thành công ${pts} điểm vào chỉ số ${param.toUpperCase()}`;
    }
  }

  // 4. Nâng cấp Kỹ năng (skill_up)
  else if (action === 'skill_up') {
    const { skill_id, n } = req.body;
    const pts = parseInt(n) || 1;

    let skills = {};
    if (playerObj.skills) {
      try {
        skills = typeof playerObj.skills === 'string' ? JSON.parse(playerObj.skills) : playerObj.skills;
      } catch (e) {
        skills = {};
      }
    }

    if ((playerObj.skill_pts || 0) < pts) {
      success = false;
      msg = 'Không đủ điểm kỹ năng';
    } else {
      // Định nghĩa rules cho kỹ năng
      const SKILL_RULES = {
        crit_shot: { tree: 'atk', maxLv: 10, req: null },
        kill_shot: { tree: 'atk', maxLv: 10, req: { skill: 'crit_shot', lv: 5 } },
        explosive_shot: { tree: 'atk', maxLv: 10, req: { player_lv: 30, skills: [{ id: 'crit_shot', lv: 5 }, { id: 'kill_shot', lv: 5 }] } },
        lock_on: { tree: 'atk', maxLv: 10, req: { player_lv: 40, skills: [{ id: 'explosive_shot', lv: 5 }] } },
        triple_knife: { tree: 'atk', maxLv: 10, req: { player_lv: 50, skills: [{ id: 'lock_on', lv: 5 }] } },

        tough_body: { tree: 'def', maxLv: 10, req: null },
        armor_up: { tree: 'def', maxLv: 10, req: { skill: 'tough_body', lv: 3 } },
        hp_regen: { tree: 'def', maxLv: 10, req: { skill: 'tough_body', lv: 5 } },
        pull_monster: { tree: 'def', maxLv: 10, req: { player_lv: 30, skills: [{ id: 'hp_regen', lv: 5 }, { id: 'armor_up', lv: 5 }] } },
        melee_return: { tree: 'def', maxLv: 10, req: { player_lv: 40, skills: [{ id: 'pull_monster', lv: 5 }] } },
        melee_charge: { tree: 'def', maxLv: 10, req: { player_lv: 50, skills: [{ id: 'melee_return', lv: 5 }] } },

        knife_atk: { tree: 'melee', maxLv: 10, req: null },
        double_attack: { tree: 'melee', maxLv: 10, req: { skill: 'knife_atk', lv: 5 } },
        spin_attack: { tree: 'melee', maxLv: 10, req: { player_lv: 30, skills: [{ id: 'knife_atk', lv: 5 }, { id: 'double_attack', lv: 5 }] } },
        sword_cross: { tree: 'melee', maxLv: 10, req: { player_lv: 40, skills: [{ id: 'spin_attack', lv: 5 }] } },
        sword_x: { tree: 'melee', maxLv: 10, req: { player_lv: 50, skills: [{ id: 'sword_cross', lv: 5 }] } },

        deploy_turret: { tree: 'turret', maxLv: 10, req: null },
        turret_rapid: { tree: 'turret', maxLv: 10, req: { skill: 'deploy_turret', lv: 3 } },
        twin_turret: { tree: 'turret', maxLv: 10, req: { player_lv: 30, skills: [{ id: 'deploy_turret', lv: 5 }, { id: 'turret_rapid', lv: 5 }] } },
        turret_shock: { tree: 'turret', maxLv: 10, req: { player_lv: 40, skills: [{ id: 'twin_turret', lv: 5 }] } },
        turret_cannon: { tree: 'turret', maxLv: 10, req: { player_lv: 50, skills: [{ id: 'turret_shock', lv: 5 }] } },
      };

      const rule = SKILL_RULES[skill_id];
      if (!rule) {
        success = false;
        msg = 'Kỹ năng không tồn tại';
      } else {
        // Validate prerequisites
        let reqOk = true;
        let reqMsg = '';
        if (rule.req) {
          if (rule.req.skill) {
            const reqLv = skills[rule.req.skill] || 0;
            if (reqLv < rule.req.lv) {
              reqOk = false;
              reqMsg = `Yêu cầu kỹ năng ${rule.req.skill} đạt cấp ${rule.req.lv}`;
            }
          }
          if (rule.req.player_lv) {
            if ((playerObj.lv || 1) < rule.req.player_lv) {
              reqOk = false;
              reqMsg = `Yêu cầu nhân vật đạt cấp độ ${rule.req.player_lv}`;
            }
          }
          if (rule.req.skills) {
            for (const reqSkill of rule.req.skills) {
              const reqLv = skills[reqSkill.id] || 0;
              if (reqLv < reqSkill.lv) {
                reqOk = false;
                reqMsg = `Yêu cầu kỹ năng ${reqSkill.id} đạt cấp ${reqSkill.lv}`;
                break;
              }
            }
          }
        }

        if (!reqOk) {
          success = false;
          msg = reqMsg;
        } else {
          // Tính maxLv dựa trên job2_star
          let star = 0;
          if (playerObj.job2_star) {
            try {
              const stars = typeof playerObj.job2_star === 'string' ? JSON.parse(playerObj.job2_star) : playerObj.job2_star;
              star = parseInt(stars[rule.tree]) || 0;
            } catch (e) {}
          }
          star = Math.max(0, Math.min(5, star));
          const maxLv = 10 + star;

          const currentLv = skills[skill_id] || 0;
          if (currentLv + pts > maxLv) {
            success = false;
            msg = `Cấp độ kỹ năng tối đa của bạn cho ${skill_id} là ${maxLv}`;
          } else {
            skills[skill_id] = currentLv + pts;
            playerObj.skills = typeof playerObj.skills === 'string' ? JSON.stringify(skills) : skills;
            playerObj.skill_pts = (playerObj.skill_pts || 0) - pts;

            // Cập nhật hp_max lập tức nếu nâng tough_body
            if (skill_id === 'tough_body') {
              const baseHpMax = 300 + ((playerObj.lv || 1) - 1) * 15;
              const vit = playerObj.vit || 5;
              const vitHpBonus = (vit - 5) * 4;
              let calculatedHpMax = baseHpMax + vitHpBonus;
              const toughBodyLv = skills.tough_body || 0;
              if (toughBodyLv > 0) {
                calculatedHpMax += toughBodyLv * 30;
                calculatedHpMax = Math.floor(calculatedHpMax * (1 + toughBodyLv * 0.01));
              }
              playerObj.hp_max = calculatedHpMax;
            }

            msg = `Nâng cấp kỹ năng ${skill_id} thành công!`;
          }
        }
      }
    }
  }
  else if (action === 'skill_toggle') {
    const { skill_id } = req.body;
    let sa = {};
    if (playerObj.skill_auto) {
      try {
        sa = typeof playerObj.skill_auto === 'string' ? JSON.parse(playerObj.skill_auto) : playerObj.skill_auto;
      } catch (e) {
        sa = {};
      }
    } else {
      sa = {};
    }
    const current = sa[skill_id] !== undefined ? sa[skill_id] : 1;
    sa[skill_id] = current ? 0 : 1;
    playerObj.skill_auto = typeof playerObj.skill_auto === 'string' ? JSON.stringify(sa) : sa;
    msg = `Đã chuyển trạng thái tự động kỹ năng ${skill_id}`;
  }
  else if (action === 'use_skill') {
    const { skill_id } = req.body;
    let skills = {};
    if (playerObj.skills) {
      try {
        skills = typeof playerObj.skills === 'string' ? JSON.parse(playerObj.skills) : playerObj.skills;
      } catch (e) {
        skills = {};
      }
    }
    const skLv = skills[skill_id] || 0;
    if (skLv <= 0) {
      success = false;
      msg = 'Kỹ năng chưa được học!';
    } else {
      // Map MP cost and CD
      const SKILL_DEFS = {
        kill_shot: { mp: 10, cd: 5 },
        explosive_shot: { mp: 15, cd: 5 },
        lock_on: { mp: 5, cd: 3 },
        triple_knife: { mp: 5, cd: 5 },
        pull_monster: { mp: 10, cd: 6 },
        melee_charge: { mp: 10, cd: 6 },
        double_attack: { mp: 5, cd: 0 },
        spin_attack: { mp: 15, cd: 0 },
        sword_cross: { mp: 3, cd: 3 },
        sword_x: { mp: 5, cd: 3 },
        turret_shock: { mp: 20, cd: 0 },
        turret_cannon: { mp: 100, cd: 60 },
      };
      const def = SKILL_DEFS[skill_id];
      if (!def) {
        success = false;
        msg = 'Kỹ năng chủ động không tồn tại!';
      } else if ((playerObj.mp || 0) < def.mp) {
        success = false;
        msg = 'Không đủ MP!';
      } else {
        playerObj.skill_cds = playerObj.skill_cds || {};
        if (typeof playerObj.skill_cds === 'string') {
          try {
            playerObj.skill_cds = JSON.parse(playerObj.skill_cds);
          } catch (e) {
            playerObj.skill_cds = {};
          }
        }
        const lastCast = playerObj.skill_cds[skill_id] || 0;
        const currentTick = playerObj.tick || 0;
        if (currentTick - lastCast < def.cd) {
          success = false;
          msg = 'Kỹ năng đang trong thời gian hồi chiêu!';
        } else {
          // Thực hiện trừ MP và cập nhật cooldown tick
          playerObj.mp = (playerObj.mp || 0) - def.mp;
          playerObj.skill_cds[skill_id] = currentTick;
          
          // Trả về kết quả, đánh dấu kỹ năng sẽ được kích hoạt tại combat tick
          playerObj.manual_skill_trigger = skill_id;
          msg = `Sử dụng kỹ năng ${skill_id} thành công!`;
        }
      }
    }
  }

  // 5. Nâng cấp đệ tử Mèo (upgrade_cat)
  else if (action === 'upgrade_cat') {
    const catLv = playerObj.cat_lv || 0;
    const targetLv = catLv + 1;
    if (catLv >= 60) {
      success = false;
      msg = 'Đệ tử mèo đã đạt cấp tối đa!';
    } else {
      const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const stoneCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));
      
      if ((playerObj.gold || 0) < cost || (playerObj.stone || 0) < stoneCost) {
        success = false;
        msg = `Thiếu tài nguyên! Cần ${cost} Gold và ${stoneCost} Đá`;
      } else {
        playerObj.gold = (playerObj.gold || 0) - cost;
        playerObj.stone = (playerObj.stone || 0) - stoneCost;
        playerObj.cat_lv = targetLv;
        msg = `Nâng cấp Đệ tử Mèo lên Lv.${targetLv} thành công!`;
      }
    }
  }

  // 6. Nâng cấp Drone (upgrade_drone)
  else if (action === 'upgrade_drone') {
    const dLv = playerObj.drone_lv || 0;
    const targetLv = dLv + 1;
    if (dLv >= 30) {
      success = false;
      msg = 'Drone đã đạt cấp tối đa!';
    } else {
      const costGold = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const costCopper = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < costGold || (playerObj.copper || 0) < costCopper) {
        success = false;
        msg = `Thiếu tài nguyên! Cần ${costGold} Gold và ${costCopper} Đồng`;
      } else {
        playerObj.gold = (playerObj.gold || 0) - costGold;
        playerObj.copper = (playerObj.copper || 0) - costCopper;
        playerObj.drone_lv = targetLv;
        msg = `Nâng cấp Drone lên Lv.${targetLv} thành công!`;
      }
    }
  }

  // 7. Nâng cấp Priest (priest_up)
  else if (action === 'priest_up') {
    const prLv = playerObj.priest_lv || 1;
    const targetLv = prLv + 1;
    const m = upgCostMult(targetLv);
    const r = Math.ceil(tierRes(targetLv) * m);
    const costGold = Math.ceil(tierGold(targetLv) * m);

    if ((playerObj.gold || 0) < costGold || (playerObj.wood || 0) < r || (playerObj.herb || 0) < r) {
      success = false;
      msg = `Thiếu tài nguyên! Cần ${costGold} Gold, ${r} Gỗ và ${r} Thảo dược`;
    } else {
      playerObj.gold = (playerObj.gold || 0) - costGold;
      playerObj.wood = (playerObj.wood || 0) - r;
      playerObj.herb = (playerObj.herb || 0) - r;
      playerObj.priest_lv = targetLv;
      msg = `Nâng cấp Linh mục hỗ trợ lên Lv.${targetLv} thành công!`;
    }
  }

  // 8. Nâng cấp Hiệp sĩ (knight_up)
  else if (action === 'knight_up') {
    const knLv = playerObj.knight_lv || 1;
    const targetLv = knLv + 1;
    const m = upgCostMult(targetLv);
    const r = Math.ceil(tierRes(targetLv) * m);
    const costGold = Math.ceil(tierGold(targetLv) * m);

    if ((playerObj.gold || 0) < costGold || (playerObj.iron || 0) < r || (playerObj.copper || 0) < r) {
      success = false;
      msg = `Thiếu tài nguyên! Cần ${costGold} Gold, ${r} Sắt và ${r} Đồng`;
    } else {
      playerObj.gold = (playerObj.gold || 0) - costGold;
      playerObj.iron = (playerObj.iron || 0) - r;
      playerObj.copper = (playerObj.copper || 0) - r;
      playerObj.knight_lv = targetLv;
      msg = `Nâng cấp Hiệp sĩ lên Lv.${targetLv} thành công!`;
    }
  }

  // 9. Nâng cấp Titan Robot (robot_body_up)
  else if (action === 'robot_body_up') {
    const robotLv = playerObj.robot_lv || 1;
    const targetLv = robotLv + 1;
    if (robotLv >= 100) {
      success = false;
      msg = 'Titan Robot đã đạt cấp tối đa!';
    } else {
      const m = upgCostMult(targetLv);
      const r = Math.ceil(tierRes(targetLv) * m);
      const costGold = Math.ceil(tierGold(targetLv) * m);

      if ((playerObj.gold || 0) < costGold || (playerObj.iron || 0) < r || (playerObj.copper || 0) < r) {
        success = false;
        msg = `Thiếu tài nguyên! Cần ${costGold} Gold, ${r} Sắt và ${r} Đồng`;
      } else {
        playerObj.gold = (playerObj.gold || 0) - costGold;
        playerObj.iron = (playerObj.iron || 0) - r;
        playerObj.copper = (playerObj.copper || 0) - r;
        playerObj.robot_lv = targetLv;
        msg = `Nâng cấp Thân thể Robot lên Lv.${targetLv} thành công!`;
      }
    }
  }

  // 10. Nâng cấp trang bị vũ khí Robot (robot_up)
  else if (action === 'robot_up') {
    const { param } = req.body;
    if (param === 'axe') {
      const alv = playerObj.robot_axe_lv || 1;
      const targetLv = alv + 1;
      const acost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const acostStone = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < acost || (playerObj.stone || 0) < acostStone) {
        success = false;
        msg = 'Thiếu tài nguyên nâng cấp rìu Robot!';
      } else {
        playerObj.gold = (playerObj.gold || 0) - acost;
        playerObj.stone = (playerObj.stone || 0) - acostStone;
        playerObj.robot_axe_lv = targetLv;
        msg = `Nâng cấp Rìu Robot lên Lv.${targetLv} thành công!`;
      }
    } else if (param === 'stun') {
      const splv = playerObj.robot_stun_lv || 1;
      const targetLv = splv + 1;
      if (splv >= 30) {
        success = false;
        msg = 'Axe Stun đã đạt cấp tối đa!';
      } else {
        const spcostGold = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
        const spcostStone = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

        if ((playerObj.gold || 0) < spcostGold || (playerObj.stone || 0) < spcostStone || (playerObj.iron || 0) < spcostStone) {
          success = false;
          msg = 'Thiếu tài nguyên nâng cấp Axe Stun!';
        } else {
          playerObj.gold = (playerObj.gold || 0) - spcostGold;
          playerObj.stone = (playerObj.stone || 0) - spcostStone;
          playerObj.iron = (playerObj.iron || 0) - spcostStone;
          playerObj.robot_stun_lv = targetLv;
          msg = `Nâng cấp Axe Stun lên Lv.${targetLv} thành công!`;
        }
      }
    } else if (param === 'gun') {
      const glv = playerObj.robot_gun_lv || 1;
      const targetLv = glv + 1;
      const gcostGold = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const gcostStone = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < gcostGold || (playerObj.stone || 0) < gcostStone || (playerObj.copper || 0) < gcostStone) {
        success = false;
        msg = 'Thiếu tài nguyên nâng cấp súng Robot!';
      } else {
        playerObj.gold = (playerObj.gold || 0) - gcostGold;
        playerObj.stone = (playerObj.stone || 0) - gcostStone;
        playerObj.copper = (playerObj.copper || 0) - gcostStone;
        playerObj.robot_gun_lv = targetLv;
        msg = `Nâng cấp Súng Robot lên Lv.${targetLv} thành công!`;
      }
    } else if (param === 'railgun') {
      const rlv = playerObj.robot_railgun_lv || 1;
      const targetLv = rlv + 1;
      const rcostGold = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const rcostStone = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < rcostGold || (playerObj.stone || 0) < rcostStone || (playerObj.copper || 0) < rcostStone) {
        success = false;
        msg = 'Thiếu tài nguyên nâng cấp Railgun Robot!';
      } else {
        playerObj.gold = (playerObj.gold || 0) - rcostGold;
        playerObj.stone = (playerObj.stone || 0) - rcostStone;
        playerObj.copper = (playerObj.copper || 0) - rcostStone;
        playerObj.robot_railgun_lv = targetLv;
        msg = `Nâng cấp Railgun Robot lên Lv.${targetLv} thành công!`;
      }
    }
  }

  // 11. Nâng cấp Dao găm (knife_up)
  else if (action === 'knife_up') {
    const klv = playerObj.knife_lv || 1;
    const targetLv = klv + 1;
    const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
    const woodCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

    if ((playerObj.gold || 0) < cost || (playerObj.wood || 0) < woodCost || (playerObj.stone || 0) < woodCost) {
      success = false;
      msg = 'Thiếu tài nguyên nâng cấp Dao găm!';
    } else {
      playerObj.gold = (playerObj.gold || 0) - cost;
      playerObj.wood = (playerObj.wood || 0) - woodCost;
      playerObj.stone = (playerObj.stone || 0) - woodCost;
      playerObj.knife_lv = targetLv;
      msg = `Nâng cấp Dao găm lên Lv.${targetLv} thành công!`;
    }
  }

  // 12. Nâng cấp Súng (gun_up)
  else if (action === 'gun_up') {
    const { param } = req.body; // pistol hoặc sniper
    if (param === 'pistol') {
      const plv = playerObj.gun_pistol_lv || 1;
      const targetLv = plv + 1;
      const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const resCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < cost || (playerObj.iron || 0) < resCost || (playerObj.copper || 0) < resCost) {
        success = false;
        msg = 'Thiếu tài nguyên nâng cấp Súng ngắn!';
      } else {
        playerObj.gold = (playerObj.gold || 0) - cost;
        playerObj.iron = (playerObj.iron || 0) - resCost;
        playerObj.copper = (playerObj.copper || 0) - resCost;
        playerObj.gun_pistol_lv = targetLv;
        msg = `Nâng cấp Súng ngắn lên Lv.${targetLv} thành công!`;
      }
    } else if (param === 'sniper') {
      const slv = playerObj.gun_sniper_lv || 1;
      const targetLv = slv + 1;
      const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const resCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < cost || (playerObj.iron || 0) < resCost || (playerObj.copper || 0) < resCost) {
        success = false;
        msg = 'Thiếu tài nguyên nâng cấp Súng trường!';
      } else {
        playerObj.gold = (playerObj.gold || 0) - cost;
        playerObj.iron = (playerObj.iron || 0) - resCost;
        playerObj.copper = (playerObj.copper || 0) - resCost;
        playerObj.gun_sniper_lv = targetLv;
        msg = `Nâng cấp Súng trường lên Lv.${targetLv} thành công!`;
      }
    }
  }

  // 13. Nâng cấp Giáp (upgrade_armor)
  else if (action === 'upgrade_armor') {
    const armLv = playerObj.armor_lv || 1;
    const targetLv = armLv + 1;
    const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
    const stoneCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

    if ((playerObj.gold || 0) < cost || (playerObj.stone || 0) < stoneCost) {
      success = false;
      msg = 'Thiếu tài nguyên nâng cấp Giáp bảo vệ!';
    } else {
      playerObj.gold = (playerObj.gold || 0) - cost;
      playerObj.stone = (playerObj.stone || 0) - stoneCost;
      playerObj.armor_lv = targetLv;
      playerObj.armor = (playerObj.armor || 100) + 15; // Tăng giáp trực tiếp
      msg = `Nâng cấp Giáp lên Lv.${targetLv} thành công!`;
    }
  }

  // 14. Nâng cấp Solar Cell (upgrade_solar_cell)
  else if (action === 'upgrade_solar_cell') {
    const scLv = playerObj.solar_cell_lv || 0;
    const targetLv = scLv + 1;
    if (scLv >= 100) {
      success = false;
      msg = 'Solar Cell đã đạt cấp tối đa!';
    } else {
      const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const resCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < cost || (playerObj.stone || 0) < resCost || (playerObj.copper || 0) < resCost) {
        success = false;
        msg = 'Thiếu tài nguyên nâng cấp Solar Cell!';
      } else {
        playerObj.gold = (playerObj.gold || 0) - cost;
        playerObj.stone = (playerObj.stone || 0) - resCost;
        playerObj.copper = (playerObj.copper || 0) - resCost;
        playerObj.solar_cell_lv = targetLv;
        msg = `Nâng cấp Solar Cell lên Lv.${targetLv} thành công!`;
      }
    }
  }

  // 15. Nâng cấp Yàn bay (house_up)
  else if (action === 'house_up') {
    const hlv = playerObj.house_lv || 0;
    const targetLv = hlv + 1;
    const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
    const resCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

    if ((playerObj.gold || 0) < cost || (playerObj.wood || 0) < resCost || (playerObj.stone || 0) < resCost) {
      success = false;
      msg = 'Thiếu tài nguyên nâng cấp Phi thuyền!';
    } else {
      playerObj.gold = (playerObj.gold || 0) - cost;
      playerObj.wood = (playerObj.wood || 0) - resCost;
      playerObj.stone = (playerObj.stone || 0) - resCost;
      playerObj.house_lv = targetLv;
      msg = `Nâng cấp Phi thuyền lên Lv.${targetLv} thành công!`;
    }
  }

  // 16. Nâng cấp Orion Rail Gun (orion_gun_up)
  else if (action === 'orion_gun_up') {
    const oglv = playerObj.orion_gun_lv || 1;
    const targetLv = oglv + 1;
    const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
    const resCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

    if ((playerObj.gold || 0) < cost || (playerObj.wood || 0) < resCost || (playerObj.stone || 0) < resCost) {
      success = false;
      msg = 'Thiếu tài nguyên nâng cấp Orion Railgun!';
    } else {
      playerObj.gold = (playerObj.gold || 0) - cost;
      playerObj.wood = (playerObj.wood || 0) - resCost;
      playerObj.stone = (playerObj.stone || 0) - resCost;
      playerObj.orion_gun_lv = targetLv;
      msg = `Nâng cấp Orion Railgun lên Lv.${targetLv} thành công!`;
    }
  }

  // 17. Nâng cấp Orion Cannon (orion_cannon_up)
  else if (action === 'orion_cannon_up') {
    const oclv = playerObj.orion_cannon_lv || 1;
    const targetLv = oclv + 1;
    const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
    const resCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

    if ((playerObj.gold || 0) < cost || (playerObj.wood || 0) < resCost || (playerObj.stone || 0) < resCost) {
      success = false;
      msg = 'Thiếu tài nguyên nâng cấp Orion Cannon!';
    } else {
      playerObj.gold = (playerObj.gold || 0) - cost;
      playerObj.wood = (playerObj.wood || 0) - resCost;
      playerObj.stone = (playerObj.stone || 0) - resCost;
      playerObj.orion_cannon_lv = targetLv;
      msg = `Nâng cấp Orion Auto Cannon lên Lv.${targetLv} thành công!`;
    }
  }

  // 18. Nâng cấp vật liệu phủ Tháp Pháo (turret_up)
  else if (action === 'turret_up') {
    const tlv = playerObj.turret_lv || 1;
    const targetLv = tlv + 1;
    const cost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
    const resCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

    if ((playerObj.gold || 0) < cost || (playerObj.wood || 0) < resCost || (playerObj.stone || 0) < resCost) {
      success = false;
      msg = 'Thiếu tài nguyên nâng cấp Trụ súng!';
    } else {
      playerObj.gold = (playerObj.gold || 0) - cost;
      playerObj.wood = (playerObj.wood || 0) - resCost;
      playerObj.stone = (playerObj.stone || 0) - resCost;
      playerObj.turret_lv = targetLv;
      msg = `Nâng cấp Trụ súng lên Lv.${targetLv} thành công!`;
    }
  }

  // 19. Nâng cấp điểm Thú cưng (pet_up)
  else if (action === 'pet_up') {
    const { stat } = req.body;
    const petLv = getPetLv(playerObj.pet_exp || 0);
    const allocated = (playerObj.pet_up_atk || 0) + (playerObj.pet_up_hp || 0) + (playerObj.pet_up_reco || 0);
    const available = Math.max(0, (petLv - 1) - allocated);

    if (available < 1) {
      success = false;
      msg = 'Không đủ điểm nâng cấp Thú cưng!';
    } else if (!['atk', 'hp', 'reco'].includes(stat)) {
      success = false;
      msg = 'Chỉ số nâng cấp không hợp lệ!';
    } else {
      const field = `pet_up_${stat}`;
      playerObj[field] = (playerObj[field] || 0) + 1;
      msg = `Nâng cấp ${stat.toUpperCase()} của Pet thành công!`;
    }
  }

  // 20. Bơm máu thủ công (use_potion_manual)
  else if (action === 'use_potion_manual') {
    if ((playerObj.hp_potion || 0) < 1) {
      success = false;
      msg = 'Bạn đã hết Potion!';
    } else {
      const heal = Math.round(30 + ((playerObj.intel || 5) - 5) * 5);
      playerObj.hp_potion = (playerObj.hp_potion || 0) - 1;
      
      const vitEff = playerObj.vit_eff ?? playerObj.vit ?? 5;
      const vitBase = playerObj.vit ?? 5;
      const vitHpB = Math.max(0, Math.max(0, vitEff - 5) * 2 - Math.max(0, vitBase - 5));
      const ragHpMult = 1 + 0.001 * Math.max(0, parseInt(playerObj.rag_hp) || 0);
      const skills = typeof playerObj.skills === 'string' ? JSON.parse(playerObj.skills || '{}') : (playerObj.skills || {});
      const toughHpMul = 1 + 0.01 * (skills.tough_body || 0);
      const hpMaxEff = Math.floor(((playerObj.hp_max || 300) + vitHpB) * ragHpMult * toughHpMul);

      playerObj.hp = Math.min(hpMaxEff, (playerObj.hp || 300) + heal);
      msg = `Bơm Potion thành công (+${heal} HP).`;
    }
  }

  // 21. Bật tắt tự động
  else if (action === 'priest_toggle') {
    playerObj.priest_on = playerObj.priest_on === 0 ? 1 : 0;
    msg = `Đã ${playerObj.priest_on === 1 ? 'bật' : 'tắt'} tự động Priest`;
  } else if (action === 'knight_toggle') {
    playerObj.knight_on = playerObj.knight_on === 0 ? 1 : 0;
    msg = `Đã ${playerObj.knight_on === 1 ? 'bật' : 'tắt'} tự động Knight`;
  } else if (action === 'archer_toggle') {
    playerObj.archer_on = playerObj.archer_on === 0 ? 1 : 0;
    msg = `Đã ${playerObj.archer_on === 1 ? 'bật' : 'tắt'} tự động Archer`;
  }

  // 22. Chế tạo phi thuyền (house_build)
  else if (action === 'house_build') {
    if ((playerObj.house_lv || 0) >= 1) {
      success = false;
      msg = 'Bạn đã xây dựng Phi thuyền rồi!';
    } else if ((playerObj.gold || 0) < 1000 || (playerObj.wood || 0) < 100 || (playerObj.stone || 0) < 100) {
      success = false;
      msg = 'Thiếu tài nguyên! Cần 1000 Vàng, 100 Gỗ, 100 Đá để chế tạo phi thuyền.';
    } else {
      playerObj.gold = (playerObj.gold || 0) - 1000;
      playerObj.wood = (playerObj.wood || 0) - 100;
      playerObj.stone = (playerObj.stone || 0) - 100;
      playerObj.house_lv = 1;
      playerObj.house_x = 928;
      playerObj.house_y = 780;
      playerObj.house_energy = 60;
      playerObj.house_last_prod = Math.floor(Date.now() / 1000);
      msg = '🛸 Chế tạo phi thuyền Orion thành công!';
    }
  }

  // 23. Bật tắt sản xuất của phi thuyền (house_toggle)
  else if (action === 'house_toggle') {
    const { ammo_type } = req.body;
    if (['pistol', 'sniper', 'robot', 'potion'].includes(ammo_type)) {
      const field = `house_prod_${ammo_type}`;
      playerObj[field] = (playerObj[field] === undefined || playerObj[field] === 1) ? 0 : 1;
      msg = `Đã ${playerObj[field] === 1 ? 'bật' : 'tắt'} sản xuất ${ammo_type}`;
    } else {
      success = false;
      msg = 'Loại đạn/potion không hợp lệ!';
    }
  }

  // 24. Tự động nạp đạn (auto_refill)
  else if (action === 'auto_refill') {
    const { gun_type } = req.body;
    if (['pistol', 'sniper', 'robot_gun'].includes(gun_type)) {
      const field = `auto_refill_${gun_type}`;
      playerObj[field] = (playerObj[field] === undefined || playerObj[field] === 1) ? 0 : 1;
      msg = `Đã ${playerObj[field] === 1 ? 'bật' : 'tắt'} tự động nạp đạn ${gun_type}`;
    } else {
      success = false;
      msg = 'Loại súng không hợp lệ!';
    }
  }

  // 25. Tự động mua HP Potion (auto_refill_potion)
  else if (action === 'auto_refill_potion') {
    playerObj.auto_refill_potion = (playerObj.auto_refill_potion === undefined || playerObj.auto_refill_potion === 1) ? 0 : 1;
    msg = `Đã ${playerObj.auto_refill_potion === 1 ? 'bật' : 'tắt'} tự động mua HP Potion`;
  }

  // 26. Tự động đốt gỗ tạo năng lượng (toggle_burn_wood)
  else if (action === 'toggle_burn_wood') {
    const cur = (playerObj.house_burn_wood !== undefined ? playerObj.house_burn_wood : (playerObj.burn_wood !== undefined ? playerObj.burn_wood : 1));
    const nextVal = cur === 1 ? 0 : 1;
    playerObj.house_burn_wood = nextVal;
    playerObj.burn_wood = nextVal;
    msg = `Đã ${nextVal === 1 ? 'bật' : 'tắt'} tự động đốt gỗ tạo năng lượng`;
  }

  // 27. Thiết lập bitmask sản xuất theo tier (toggle_house_prod_tier)
  else if (action === 'toggle_house_prod_tier') {
    const { gun, tier, on } = req.body;
    const maskField = `house_prod_${gun}_mask`;
    let mask = playerObj[maskField] === undefined ? 1 : playerObj[maskField];
    const bit = 1 << (parseInt(tier) - 1);
    if (parseInt(on) === 1) {
      mask |= bit;
    } else {
      mask &= ~bit;
    }
    playerObj[maskField] = mask;
    msg = `Đã thay đổi thiết lập sản xuất ${gun} Tier ${tier}`;
  }

  // 28. Thiết lập dùng đạn theo tier (set_ammo_tier_enabled)
  else if (action === 'set_ammo_tier_enabled') {
    const { gun, tier, on } = req.body;
    const field = `${gun}_tier_enabled`;
    let mask = playerObj[field] === undefined ? 1 : playerObj[field];
    const bit = 1 << (parseInt(tier) - 1);
    if (parseInt(on) === 1) {
      mask |= bit;
    } else {
      mask &= ~bit;
    }
    playerObj[field] = mask;
    msg = `Đã thiết lập dùng đạn ${gun} Tier ${tier}`;
  }

  // 29. Thiết lập sản xuất HP Potion theo tier (toggle_house_potion_prod_tier)
  else if (action === 'toggle_house_potion_prod_tier') {
    const { tier, on } = req.body;
    let mask = playerObj.house_prod_potion_mask === undefined ? 1 : playerObj.house_prod_potion_mask;
    const bit = 1 << (parseInt(tier) - 1);
    if (parseInt(on) === 1) {
      mask |= bit;
    } else {
      mask &= ~bit;
    }
    playerObj.house_prod_potion_mask = mask;
    msg = `Đã thay đổi sản xuất HP Potion Tier ${tier}`;
  }

  // 30. Thiết lập dùng Potion theo tier (set_potion_tier_enabled)
  else if (action === 'set_potion_tier_enabled') {
    const { tier, on } = req.body;
    let mask = playerObj.potion_tier_enabled === undefined ? 1 : playerObj.potion_tier_enabled;
    const bit = 1 << (parseInt(tier) - 1);
    if (parseInt(on) === 1) {
      mask |= bit;
    } else {
      mask &= ~bit;
    }
    playerObj.potion_tier_enabled = mask;
    msg = `Đã thiết lập dùng Potion Tier ${tier}`;
  }

  // --- SYSTEM: NÔNG TRẠI (HOME FARM SYSTEM) ---
  else if (action === 'home_plant') {
    const { seed, all } = req.body;
    const seedId = parseInt(seed);
    const plantAll = parseInt(all) === 1;

    let seeds = playerObj.home_seeds;
    const isSeedsString = typeof seeds === 'string' || !seeds;
    if (isSeedsString) {
      try { seeds = JSON.parse(seeds || '{}'); } catch(e) { seeds = {}; }
    } else {
      seeds = seeds || {};
    }

    const availableSeeds = parseInt(seeds[seedId]) || 0;
    if (availableSeeds < 1) {
      success = false;
      msg = 'Bạn không có hạt giống này!';
    } else {
      let crops = playerObj.home_crops;
      const isCropsString = typeof crops === 'string' || !crops;
      if (isCropsString) {
        try { crops = JSON.parse(crops || '[]'); } catch(e) { crops = []; }
      } else {
        crops = crops || [];
      }

      const homeLv = Math.max(1, parseInt(playerObj.home_lv) || 1);
      const openPlots = 1 + [20, 40, 60, 80, 100].filter(q => homeLv >= q).length;
      const totalHoles = openPlots * 16;

      const occupied = {};
      crops.forEach(c => {
        if (c.p < openPlots) {
          occupied[`${c.p}_${c.i}`] = true;
        }
      });

      const emptyHoles = [];
      for (let p = 0; p < openPlots; p++) {
        for (let i = 0; i < 16; i++) {
          if (!occupied[`${p}_${i}`]) {
            emptyHoles.push({ p, i });
          }
        }
      }

      if (emptyHoles.length === 0) {
        success = false;
        msg = 'Không còn ô đất trống để gieo hạt!';
      } else {
        const toPlantCount = plantAll ? Math.min(availableSeeds, emptyHoles.length) : 1;
        const nowS = Math.floor(Date.now() / 1000);
        for (let k = 0; k < toPlantCount; k++) {
          const hole = emptyHoles[k];
          crops.push({
            p: hole.p,
            i: hole.i,
            s: seedId,
            t: nowS
          });
        }
        seeds[seedId] = availableSeeds - toPlantCount;
        playerObj.home_seeds = isSeedsString ? JSON.stringify(seeds) : seeds;
        playerObj.home_crops = isCropsString ? JSON.stringify(crops) : crops;
        msg = `Gieo thành công ${toPlantCount} hạt giống!`;
      }
    }
  }

  else if (action === 'home_harvest') {
    let crops = playerObj.home_crops;
    const isCropsString = typeof crops === 'string' || !crops;
    if (isCropsString) {
      try { crops = JSON.parse(crops || '[]'); } catch(e) { crops = []; }
    } else {
      crops = crops || [];
    }

    const homeLv = Math.max(1, parseInt(playerObj.home_lv) || 1);
    const openPlots = 1 + [20, 40, 60, 80, 100].filter(q => homeLv >= q).length;
    const nowS = Math.floor(Date.now() / 1000);

    const SEED_GROW_H = [1, 2, 4, 8, 16, 24];
    const SEED_PRICE = [80, 160, 400, 800, 1920, 3200];
    const getSeedTier = id => Math.floor((id - 1) / 4) + 1;
    const getSeedGold = id => ((id - 1) & 1) === 1;
    const getSeedPrice = id => SEED_PRICE[getSeedTier(id) - 1] * (getSeedGold(id) ? 3 : 1);
    const getSeedGrowS = id => SEED_GROW_H[getSeedTier(id) - 1] * 3600;

    const remainingCrops = [];
    let harvestedPlotsCount = 0;
    let harvestedQty = 0;
    let earnedGold = 0;

    crops.forEach(c => {
      if (c.p < openPlots) {
        const left = getSeedGrowS(c.s) - (nowS - c.t);
        if (left <= 0) {
          harvestedPlotsCount++;
          const qty = Math.floor(Math.random() * 3) + 1;
          harvestedQty += qty;
          earnedGold += qty * getSeedPrice(c.s);
        } else {
          remainingCrops.push(c);
        }
      } else {
        remainingCrops.push(c);
      }
    });

    if (harvestedPlotsCount === 0) {
      success = false;
      msg = 'Không có cây nào chín để thu hoạch!';
    } else {
      playerObj.home_crops = isCropsString ? JSON.stringify(remainingCrops) : remainingCrops;
      playerObj.gold = (playerObj.gold || 0) + earnedGold;
      
      res.locals = res.locals || {};
      res.locals.payloadExt = {
        hv: {
          n: harvestedPlotsCount,
          q: harvestedQty,
          g: earnedGold
        }
      };
      msg = `Thu hoạch thành công ${harvestedPlotsCount} ô đất, thu về ${earnedGold} Gold!`;
    }
  }

  else if (action === 'home_up') {
    const homeLv = Math.max(1, parseInt(playerObj.home_lv) || 1);
    const targetLv = homeLv + 1;
    const capLv = (playerObj.lv || 1) + 5;

    if (homeLv >= 100) {
      success = false;
      msg = 'Nông trại đã đạt cấp tối đa!';
    } else if (homeLv >= capLv) {
      success = false;
      msg = `Cấp nhà nông trại không thể vượt quá cấp nhân vật + 5 (Lv.${capLv})!`;
    } else {
      const m = upgCostMult(targetLv);
      const r = Math.ceil(tierRes(targetLv) * m) * 10;
      const costGold = Math.ceil(tierGold(targetLv) * m) * 10;

      if (
        (playerObj.gold || 0) < costGold ||
        (playerObj.wood || 0) < r ||
        (playerObj.stone || 0) < r ||
        (playerObj.iron || 0) < r ||
        (playerObj.copper || 0) < r ||
        (playerObj.herb || 0) < r
      ) {
        success = false;
        msg = `Thiếu tài nguyên! Cần ${costGold} Gold và ${r} mỗi loại gỗ/đá/sắt/đồng/thảo dược.`;
      } else {
        playerObj.gold = (playerObj.gold || 0) - costGold;
        playerObj.wood = (playerObj.wood || 0) - r;
        playerObj.stone = (playerObj.stone || 0) - r;
        playerObj.iron = (playerObj.iron || 0) - r;
        playerObj.copper = (playerObj.copper || 0) - r;
        playerObj.herb = (playerObj.herb || 0) - r;
        playerObj.home_lv = targetLv;
        msg = `Nâng cấp nhà nông trại lên Lv.${targetLv} thành công!`;
      }
    }
  }

  // --- SYSTEM: KHAI THÁC MỎ (AIRSHIP & MINING SYSTEM) ---
  else if (action === 'mine_build') {
    const slot = parseInt(req.body.slot);
    const ore = req.body.ore || 'wood';

    let mineLv = playerObj.mine_lv ? (typeof playerObj.mine_lv === 'string' ? JSON.parse(playerObj.mine_lv) : playerObj.mine_lv) : [0,0,0,0,0,0];
    let mineOre = playerObj.mine_ore ? (typeof playerObj.mine_ore === 'string' ? JSON.parse(playerObj.mine_ore) : playerObj.mine_ore) : ["","","","","",""];
    let mineOn = playerObj.mine_on ? (typeof playerObj.mine_on === 'string' ? JSON.parse(playerObj.mine_on) : playerObj.mine_on) : [0,0,0,0,0,0];

    const MINE_UNLOCK = [20, 40, 60, 999, 999, 999];
    const houseLv = playerObj.house_lv || 1;
    const isPrem = (slot === 3);
    const premMiner = (parseInt(playerObj.premium_miner_expires) || 0) > Math.floor(Date.now() / 1000);
    const unlockLv = (isPrem && premMiner) ? 20 : (MINE_UNLOCK[slot] || 999);

    if (isNaN(slot) || slot < 0 || slot > 5) {
      success = false;
      msg = 'Vị trí mỏ không hợp lệ!';
    } else if ((mineLv[slot] | 0) > 0) {
      success = false;
      msg = 'Mỏ ở vị trí này đã được xây dựng!';
    } else if (unlockLv >= 999 || houseLv < unlockLv) {
      success = false;
      if (isPrem && !premMiner) {
        msg = 'Mỏ 4 yêu cầu phải kích hoạt Premium Miner!';
      } else {
        msg = unlockLv >= 999 ? 'Mỏ này chưa mở khóa (Sắp ra mắt)!' : `Yêu cầu Phi thuyền đạt cấp Lv.${unlockLv} (Hiện tại Lv.${houseLv})!`;
      }
    } else if (!['wood', 'stone', 'iron', 'copper', 'herb'].includes(ore)) {
      success = false;
      msg = 'Loại tài nguyên khai thác không hợp lệ!';
    } else {
      const targetLv = 1;
      const m = upgCostMult(targetLv);
      const r = Math.ceil(tierRes(targetLv) * m);
      const costGold = Math.ceil(tierGold(targetLv) * m);

      const goldHave = playerObj.gold || 0;
      const woodHave = playerObj.wood || 0;
      const stoneHave = playerObj.stone || 0;
      const ironHave = playerObj.iron || 0;
      const copperHave = playerObj.copper || 0;

      if (goldHave < costGold || woodHave < r || stoneHave < r || ironHave < r || copperHave < r) {
        success = false;
        msg = `Không đủ tài nguyên xây dựng mỏ! Cần 💰${costGold.toLocaleString()} 🪵${r} 🪨${r} ⚙️${r} 🟫${r}`;
      } else {
        playerObj.gold = goldHave - costGold;
        playerObj.wood = woodHave - r;
        playerObj.stone = stoneHave - r;
        playerObj.iron = ironHave - r;
        playerObj.copper = copperHave - r;

        mineLv[slot] = 1;
        mineOre[slot] = ore;
        mineOn[slot] = 1;

        playerObj.mine_lv = JSON.stringify(mineLv);
        playerObj.mine_ore = JSON.stringify(mineOre);
        playerObj.mine_on = JSON.stringify(mineOn);
        msg = `Xây dựng mỏ khai thác ${ore.toUpperCase()} thành công!`;
      }
    }
  }

  else if (action === 'mine_up') {
    const slot = parseInt(req.body.slot);
    let mineLv = playerObj.mine_lv ? (typeof playerObj.mine_lv === 'string' ? JSON.parse(playerObj.mine_lv) : playerObj.mine_lv) : [0,0,0,0,0,0];
    let mineOre = playerObj.mine_ore ? (typeof playerObj.mine_ore === 'string' ? JSON.parse(playerObj.mine_ore) : playerObj.mine_ore) : ["","","","","",""];

    if (isNaN(slot) || slot < 0 || slot > 5 || (mineLv[slot] | 0) < 1) {
      success = false;
      msg = 'Vị trí mỏ chưa xây dựng hoặc không hợp lệ!';
    } else {
      const currentLv = mineLv[slot] | 0;
      const targetLv = currentLv + 1;
      const houseLv = playerObj.house_lv || 1;

      if (currentLv >= 100) {
        success = false;
        msg = 'Mỏ đã đạt cấp tối đa Lv.100!';
      } else if (currentLv >= houseLv) {
        success = false;
        msg = `Cấp mỏ không thể vượt quá cấp Phi thuyền hiện tại (Lv.${houseLv})! Vui lòng nâng cấp Phi thuyền trước.`;
      } else {
        const m = upgCostMult(targetLv);
        const r = Math.ceil(tierRes(targetLv) * m);
        const costGold = Math.ceil(tierGold(targetLv) * m);

        const goldHave = playerObj.gold || 0;
        const woodHave = playerObj.wood || 0;
        const stoneHave = playerObj.stone || 0;
        const ironHave = playerObj.iron || 0;
        const copperHave = playerObj.copper || 0;

        if (goldHave < costGold || woodHave < r || stoneHave < r || ironHave < r || copperHave < r) {
          success = false;
          msg = `Thiếu tài nguyên nâng cấp! Cần 💰${costGold.toLocaleString()} 🪵${r} 🪨${r} ⚙️${r} 🟫${r}`;
        } else {
          playerObj.gold = goldHave - costGold;
          playerObj.wood = woodHave - r;
          playerObj.stone = stoneHave - r;
          playerObj.iron = ironHave - r;
          playerObj.copper = copperHave - r;

          mineLv[slot] = targetLv;
          playerObj.mine_lv = JSON.stringify(mineLv);
          msg = `Nâng cấp mỏ slot ${slot + 1} lên Lv.${targetLv} thành công!`;
        }
      }
    }
  }

  else if (action === 'mine_select_ore') {
    const slot = parseInt(req.body.slot);
    const { ore } = req.body;
    let mineLv = playerObj.mine_lv ? (typeof playerObj.mine_lv === 'string' ? JSON.parse(playerObj.mine_lv) : playerObj.mine_lv) : [0,0,0,0,0,0];
    let mineOre = playerObj.mine_ore ? (typeof playerObj.mine_ore === 'string' ? JSON.parse(playerObj.mine_ore) : playerObj.mine_ore) : ["","","","","",""];

    if (isNaN(slot) || slot < 0 || slot > 5 || (mineLv[slot] | 0) < 1) {
      success = false;
      msg = 'Vị trí mỏ không hợp lệ hoặc chưa xây dựng!';
    } else if (!['wood', 'stone', 'iron', 'copper', 'herb'].includes(ore)) {
      success = false;
      msg = 'Loại tài nguyên chọn khai thác không hợp lệ!';
    } else {
      mineOre[slot] = ore;
      playerObj.mine_ore = JSON.stringify(mineOre);
      msg = `Đã chuyển mỏ slot ${slot + 1} sang khai thác quặng ${ore.toUpperCase()}!`;
    }
  }

  else if (action === 'mine_toggle') {
    const slot = parseInt(req.body.slot);
    let mineLv = playerObj.mine_lv ? (typeof playerObj.mine_lv === 'string' ? JSON.parse(playerObj.mine_lv) : playerObj.mine_lv) : [0,0,0,0,0,0];
    let mineOn = playerObj.mine_on ? (typeof playerObj.mine_on === 'string' ? JSON.parse(playerObj.mine_on) : playerObj.mine_on) : [0,0,0,0,0,0];

    if (isNaN(slot) || slot < 0 || slot > 5 || (mineLv[slot] | 0) < 1) {
      success = false;
      msg = 'Vị trí mỏ không hợp lệ hoặc chưa xây dựng!';
    } else {
      mineOn[slot] = (mineOn[slot] ?? 1) === 1 ? 0 : 1;
      playerObj.mine_on = JSON.stringify(mineOn);
      msg = `Đã ${mineOn[slot] === 1 ? 'bật' : 'tạm dừng'} mỏ khai thác slot ${slot + 1}`;
    }
  }

  // --- SYSTEM: MỞ HỘP VẬT PHẨM & MODULES ---
  else if (action === 'open_module_box') {
    const t = parseInt(req.body.param);
    const count = Math.max(1, Math.min(10, parseInt(req.body.count) || 1));
    const boxField = `module_box${t}`;
    const boxQty = parseInt(playerObj[boxField]) || 0;

    if (boxQty < count) {
      success = false;
      msg = 'Bạn không đủ hộp module để mở!';
    } else {
      playerObj[boxField] = boxQty - count;
      const results = [];

      for (let k = 0; k < count; k++) {
        const { m, weapon, slot, statName, statVal } = generateNewModule(t);
        const invField = MOD_INV_FIELDS[weapon];
        let inv = playerObj[invField];
        const isInvString = typeof inv === 'string' || !inv;
        if (isInvString) {
          try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; }
        } else {
          inv = inv || [];
        }

        // Initialize weapon modules object if not present
        const modObjField = `${weapon}_modules`;
        let modObj = playerObj[modObjField];
        const isModObjString = typeof modObj === 'string' || !modObj;
        if (isModObjString) {
          try { modObj = JSON.parse(modObj || '{}'); } catch(e) { modObj = {}; }
        } else {
          modObj = modObj || {};
        }

        let place = 'inv';
        let destroyed = null;

        // Auto-equip if slot is empty
        if (!modObj[slot]) {
          modObj[slot] = m;
          place = 'equip';
          playerObj[modObjField] = isModObjString ? JSON.stringify(modObj) : modObj;
        } else {
          // If inventory is full (> 30)
          if (inv.length >= 30) {
            // Find the lowest quality module in inventory to destroy
            let minIdx = -1;
            let minScore = Infinity;
            inv.forEach((item, index) => {
              if (item) {
                const score = (parseInt(item.t) || 1) * 10 + (parseInt(item.rarity) || 1);
                if (score < minScore) {
                  minScore = score;
                  minIdx = index;
                }
              }
            });

            if (minIdx !== -1) {
              const destroyedMod = inv[minIdx];
              let cardsReturnedCount = 0;
              if (destroyedMod && Array.isArray(destroyedMod.cards)) {
                let cards = playerObj.cards;
                const isCardsString = typeof cards === 'string' || !cards;
                if (isCardsString) {
                  try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
                } else {
                  cards = cards || {};
                }

                destroyedMod.cards.forEach(c => {
                  if (c && c.mid) {
                    cardsReturnedCount++;
                    const cid = c.mid;
                    cards[cid] = cards[cid] || { n: 0, m: 0 };
                    if (c.mvp) {
                      cards[cid].m = (cards[cid].m || 0) + 1;
                    } else {
                      cards[cid].n = (cards[cid].n || 0) + 1;
                    }
                  }
                });
                playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
              }

              destroyed = {
                rName: RARITY_NAMES[destroyedMod.rarity || 1],
                sName: `${Object.keys(destroyedMod.opt || {})[0]?.toUpperCase()}+${Object.values(destroyedMod.opt || {})[0]}`,
                cards: cardsReturnedCount
              };

              inv[minIdx] = m;
              place = 'inv_destroy';
            } else {
              inv.push(m);
            }
          } else {
            inv.push(m);
          }
          playerObj[invField] = isInvString ? JSON.stringify(inv) : inv;
        }

        results.push({
          boxTier: t,
          place: place,
          gunName: WEAPON_NAMES[weapon] || weapon,
          slotName: SLOT_NAMES[slot] || slot,
          rName: RARITY_NAMES[m.rarity],
          rarity: m.rarity,
          sockets: m.sockets,
          sName: `${statName.toUpperCase()}+${statVal}`,
          destroyed: destroyed,
          mid: 0,
          lv: t * 10
        });
      }

      res.locals = res.locals || {};
      res.locals.payloadExt = count > 1 ? { box_results: results } : { box_result: results[0] };
      msg = `Mở thành công ${count} hộp module!`;
    }
  }

  else if (action === 'module_equip') {
    const { weapon, slot, idx } = req.body;
    const index = parseInt(idx);
    const invField = MOD_INV_FIELDS[weapon];

    let inv = playerObj[invField];
    const isInvString = typeof inv === 'string' || !inv;
    if (isInvString) {
      try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; }
    } else {
      inv = inv || [];
    }

    if (index < 0 || index >= inv.length || !inv[index]) {
      success = false;
      msg = 'Không tìm thấy module trong kho đồ!';
    } else {
      const m = inv[index];
      const modObjField = `${weapon}_modules`;

      let modObj = playerObj[modObjField];
      const isModObjString = typeof modObj === 'string' || !modObj;
      if (isModObjString) {
        try { modObj = JSON.parse(modObj || '{}'); } catch(e) { modObj = {}; }
      } else {
        modObj = modObj || {};
      }

      const oldMod = modObj[slot];
      if (oldMod) {
        inv[index] = oldMod;
      } else {
        inv.splice(index, 1);
      }

      modObj[slot] = m;

      playerObj[invField] = isInvString ? JSON.stringify(inv) : inv;
      playerObj[modObjField] = isModObjString ? JSON.stringify(modObj) : modObj;
      msg = `Trang bị module vào ô ${SLOT_NAMES[slot] || slot} thành công!`;
    }
  }

  else if (action === 'module_unequip') {
    const { weapon, slot } = req.body;
    const invField = MOD_INV_FIELDS[weapon];

    let inv = playerObj[invField];
    const isInvString = typeof inv === 'string' || !inv;
    if (isInvString) {
      try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; }
    } else {
      inv = inv || [];
    }

    if (inv.length >= 30) {
      success = false;
      msg = 'Kho đồ module đã đầy (30)! Vui lòng dọn dẹp trước.';
    } else {
      const modObjField = `${weapon}_modules`;
      let modObj = playerObj[modObjField];
      const isModObjString = typeof modObj === 'string' || !modObj;
      if (isModObjString) {
        try { modObj = JSON.parse(modObj || '{}'); } catch(e) { modObj = {}; }
      } else {
        modObj = modObj || {};
      }

      const m = modObj[slot];
      if (!m) {
        success = false;
        msg = 'Không có module nào đang trang bị ở ô này!';
      } else {
        modObj[slot] = null;
        inv.push(m);

        playerObj[invField] = isInvString ? JSON.stringify(inv) : inv;
        playerObj[modObjField] = isModObjString ? JSON.stringify(modObj) : modObj;
        msg = `Tháo trang bị module ô ${SLOT_NAMES[slot] || slot} thành công!`;
      }
    }
  }

  else if (action === 'module_enhance') {
    const { weapon, slot } = req.body;
    const modObjField = `${weapon}_modules`;

    let modObj = playerObj[modObjField];
    const isModObjString = typeof modObj === 'string' || !modObj;
    if (isModObjString) {
      try { modObj = JSON.parse(modObj || '{}'); } catch(e) { modObj = {}; }
    } else {
      modObj = modObj || {};
    }

    const m = modObj[slot];
    if (!m) {
      success = false;
      msg = 'Không tìm thấy module đang trang bị ở ô này để cường hóa!';
    } else {
      const currentLv = parseInt(m.lv) || 0;
      const targetLv = currentLv + 1;
      const goldCost = Math.ceil(tierGold(targetLv) * upgCostMult(targetLv));
      const scrapCost = Math.ceil(tierRes(targetLv) * upgCostMult(targetLv));

      if ((playerObj.gold || 0) < goldCost || (playerObj.mod_scrap || 0) < scrapCost) {
        success = false;
        msg = `Thiếu tài nguyên! Cần ${goldCost} Gold và ${scrapCost} Scrap Module`;
      } else {
        playerObj.gold = (playerObj.gold || 0) - goldCost;
        playerObj.mod_scrap = (playerObj.mod_scrap || 0) - scrapCost;
        
        m.lv = targetLv;
        if (m.opt) {
          Object.keys(m.opt).forEach(k => {
            m.opt[k] = (m.opt[k] || 0) + Math.max(1, Math.floor(m.opt[k] * 0.1));
          });
        }

        modObj[slot] = m;
        playerObj[modObjField] = isModObjString ? JSON.stringify(modObj) : modObj;
        msg = `Cường hóa module lên Lv.${targetLv} thành công!`;
      }
    }
  }

  else if (action === 'module_discard') {
    const rarity = parseInt(req.body.rarity);
    let totalGoldGain = 0;
    let totalScrapGain = 0;
    let totalReturnedCards = 0;

    let cards = playerObj.cards;
    const isCardsString = typeof cards === 'string' || !cards;
    if (isCardsString) {
      try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
    } else {
      cards = cards || {};
    }

    MODULE_WEAPONS.forEach(weapon => {
      const invField = MOD_INV_FIELDS[weapon];
      let inv = playerObj[invField];
      const isInvString = typeof inv === 'string' || !inv;
      if (isInvString) {
        try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; }
      } else {
        inv = inv || [];
      }

      const remaining = [];
      inv.forEach(m => {
        if (m && parseInt(m.rarity) === rarity) {
          totalScrapGain += (parseInt(m.t) || 1) * 3 + (parseInt(m.rarity) || 1) * 2;
          totalGoldGain += (parseInt(m.t) || 1) * 100 + (parseInt(m.rarity) || 1) * 50;

          if (Array.isArray(m.cards)) {
            m.cards.forEach(c => {
              if (c && c.mid) {
                totalReturnedCards++;
                const cid = c.mid;
                cards[cid] = cards[cid] || { n: 0, m: 0 };
                if (c.mvp) {
                  cards[cid].m = (cards[cid].m || 0) + 1;
                } else {
                  cards[cid].n = (cards[cid].n || 0) + 1;
                }
              }
            });
          }
        } else if (m) {
          remaining.push(m);
        }
      });

      playerObj[invField] = isInvString ? JSON.stringify(remaining) : remaining;
    });

    playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
    playerObj.gold = (playerObj.gold || 0) + totalGoldGain;
    playerObj.mod_scrap = (playerObj.mod_scrap || 0) + totalScrapGain;
    msg = `Đã phân rã các module phẩm chất ${RARITY_NAMES[rarity] || rarity}, nhận lại ${totalGoldGain} Gold và ${totalScrapGain} Scrap!`;
    if (totalReturnedCards > 0) {
      msg += ` Trả lại ${totalReturnedCards} thẻ bài về túi.`;
    }
  }

  else if (action === 'module_discard_multi') {
    const { weapon, indices } = req.body;
    let idxArr = [];
    try { idxArr = JSON.parse(indices || '[]'); } catch(e) { idxArr = []; }

    const invField = MOD_INV_FIELDS[weapon];
    let inv = playerObj[invField];
    const isInvString = typeof inv === 'string' || !inv;
    if (isInvString) {
      try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; }
    } else {
      inv = inv || [];
    }

    let goldGain = 0;
    let scrapGain = 0;
    let cardsReturned = 0;

    let cards = playerObj.cards;
    const isCardsString = typeof cards === 'string' || !cards;
    if (isCardsString) {
      try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
    } else {
      cards = cards || {};
    }

    // Sort index descending to splice safely
    idxArr.sort((a, b) => b - a);

    idxArr.forEach(idx => {
      const index = parseInt(idx);
      if (index >= 0 && index < inv.length) {
        const m = inv[index];
        if (m) {
          scrapGain += (parseInt(m.t) || 1) * 3 + (parseInt(m.rarity) || 1) * 2;
          goldGain += (parseInt(m.t) || 1) * 100 + (parseInt(m.rarity) || 1) * 50;

          if (Array.isArray(m.cards)) {
            m.cards.forEach(c => {
              if (c && c.mid) {
                cardsReturned++;
                const cid = c.mid;
                cards[cid] = cards[cid] || { n: 0, m: 0 };
                if (c.mvp) {
                  cards[cid].m = (cards[cid].m || 0) + 1;
                } else {
                  cards[cid].n = (cards[cid].n || 0) + 1;
                }
              }
            });
          }
          inv.splice(index, 1);
        }
      }
    });

    playerObj[invField] = isInvString ? JSON.stringify(inv) : inv;
    playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
    playerObj.gold = (playerObj.gold || 0) + goldGain;
    playerObj.mod_scrap = (playerObj.mod_scrap || 0) + scrapGain;
    msg = `Đã phân rã các module được chọn, nhận lại ${goldGain} Gold và ${scrapGain} Scrap!`;
    if (cardsReturned > 0) {
      msg += ` Trả lại ${cardsReturned} thẻ bài về túi.`;
    }
  }

  // --- SYSTEM: HỘP THẺ BÀI QUÁI VẬT & ÉP THẺ ---
  else if (action === 'open_card_box') {
    const t = parseInt(req.body.param);
    const count = Math.max(1, Math.min(10, parseInt(req.body.count) || 1));
    const boxField = `card_box${t}`;
    const boxQty = parseInt(playerObj[boxField]) || 0;

    if (boxQty < count) {
      success = false;
      msg = 'Bạn không đủ hộp thẻ bài để mở!';
    } else {
      playerObj[boxField] = boxQty - count;
      const results = [];

      let cards = playerObj.cards;
      const isCardsString = typeof cards === 'string' || !cards;
      if (isCardsString) {
        try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
      } else {
        cards = cards || {};
      }

      const lo = (t - 1) * 10 + 1;
      const hi = t * 10;

      for (let k = 0; k < count; k++) {
        const mon = getRandomMonsterInLvRange(lo, hi);
        // Jackpot 1% chance for MVP card
        const isMvp = Math.random() < 0.01 ? 1 : 0;
        const cid = mon.mid;
        
        cards[cid] = cards[cid] || { n: 0, m: 0 };
        if (isMvp) {
          cards[cid].m = (cards[cid].m || 0) + 1;
        } else {
          cards[cid].n = (cards[cid].n || 0) + 1;
        }

        const bonus = isMvp ? _mvpCardBonus(cid, mon.lv || 1) : null;

        results.push({
          boxTier: t,
          mvp: isMvp,
          stat: mon.cs || 'str',
          lv: mon.lv || 1,
          mid: cid,
          name: mon.n || mon.orig_n || 'Quái vật',
          sName: (mon.cs || 'str').toUpperCase(),
          value: isMvp ? Math.max(1, Math.floor((mon.lv || 1) / 10) * 2 + 2) : Math.max(1, Math.floor((mon.lv || 1) / 10) + 1),
          mb: bonus ? { t: bonus.t, a: bonus.a } : null
        });
      }

      playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
      res.locals = res.locals || {};
      res.locals.payloadExt = count > 1 ? { card_results: results } : { card_result: results[0] };
      msg = `Mở thành công ${count} hộp thẻ bài!`;
    }
  }

  else if (action === 'card_socket') {
    const { weapon, slot, mid } = req.body;
    const mvp = parseInt(req.body.mvp) === 1 ? 1 : 0;
    const cid = parseInt(mid);

    let cards = playerObj.cards;
    const isCardsString = typeof cards === 'string' || !cards;
    if (isCardsString) {
      try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
    } else {
      cards = cards || {};
    }

    const available = cards[cid] ? (mvp ? cards[cid].m : cards[cid].n) : 0;
    if (available < 1) {
      success = false;
      msg = `Bạn không có thẻ bài ${mvp ? 'MVP' : 'Thường'} này trong bộ sưu tập!`;
    } else {
      const modObjField = `${weapon}_modules`;
      let modObj = playerObj[modObjField];
      const isModObjString = typeof modObj === 'string' || !modObj;
      if (isModObjString) {
        try { modObj = JSON.parse(modObj || '{}'); } catch(e) { modObj = {}; }
      } else {
        modObj = modObj || {};
      }

      const m = modObj[slot];
      if (!m) {
        success = false;
        msg = 'Không tìm thấy module để gắn thẻ bài!';
      } else {
        m.cards = m.cards || Array(m.rarity).fill(null);
        const socketIndex = m.cards.indexOf(null);

        if (socketIndex === -1) {
          success = false;
          msg = 'Module không còn ô trống để gắn thẻ bài!';
        } else {
          // Deduct card
          if (mvp) {
            cards[cid].m = (cards[cid].m || 0) - 1;
          } else {
            cards[cid].n = (cards[cid].n || 0) - 1;
          }

          const mon = monMastersCache[cid] || { lv: 1, cs: 'str', n: 'Quái vật' };
          const bonus = mvp ? _mvpCardBonus(cid, mon.lv || 1) : null;
          const statVal = mvp ? Math.max(1, Math.floor((mon.lv || 1) / 10) * 2 + 2) : Math.max(1, Math.floor((mon.lv || 1) / 10) + 1);

          m.cards[socketIndex] = {
            mid: cid,
            mvp: mvp,
            s: mon.cs || 'str',
            v: statVal,
            stat: mon.cs || 'str',
            lv: mon.lv || 1,
            sName: (mon.cs || 'str').toUpperCase(),
            value: statVal,
            mb: bonus ? { t: bonus.t, a: bonus.a } : null
          };

          // Sync legacy property m.c
          m.c = m.cards;

          modObj[slot] = m;
          playerObj[modObjField] = isModObjString ? JSON.stringify(modObj) : modObj;
          playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
          msg = `Gắn thành công thẻ bài ${mon.n || cid} vào module!`;
        }
      }
    }
  }

  else if (action === 'card_unsocket') {
    const { weapon, slot, sidx, pay } = req.body;
    const socketIndex = parseInt(sidx);

    const modObjField = `${weapon}_modules`;
    let modObj = playerObj[modObjField];
    const isModObjString = typeof modObj === 'string' || !modObj;
    if (isModObjString) {
      try { modObj = JSON.parse(modObj || '{}'); } catch(e) { modObj = {}; }
    } else {
      modObj = modObj || {};
    }

    const m = modObj[slot];
    if (!m || !Array.isArray(m.cards) || !m.cards[socketIndex]) {
      success = false;
      msg = 'Không tìm thấy thẻ bài ở vị trí socket này!';
    } else {
      const c = m.cards[socketIndex];
      const rarity = Math.max(1, parseInt(m.rarity) || 1);
      const goldCost = 3000 * rarity;

      if (pay === 'gold') {
        if ((playerObj.gold || 0) < goldCost) {
          success = false;
          msg = `Không đủ Gold! Cần ${goldCost} Gold để tháo thẻ bài.`;
        } else {
          playerObj.gold = (playerObj.gold || 0) - goldCost;
        }
      } else if (pay === 'p') {
        if ((playerObj.p_points || 0) < 5) {
          success = false;
          msg = 'Không đủ Điểm P! Cần 5 P để tháo thẻ bài.';
        } else {
          playerObj.p_points = (playerObj.p_points || 0) - 5;
        }
      } else {
        success = false;
        msg = 'Hình thức thanh toán không hợp lệ!';
      }

      if (success) {
        let cards = playerObj.cards;
        const isCardsString = typeof cards === 'string' || !cards;
        if (isCardsString) {
          try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
        } else {
          cards = cards || {};
        }

        const cid = c.mid;
        cards[cid] = cards[cid] || { n: 0, m: 0 };
        if (c.mvp) {
          cards[cid].m = (cards[cid].m || 0) + 1;
        } else {
          cards[cid].n = (cards[cid].n || 0) + 1;
        }

        m.cards[socketIndex] = null;
        m.c = m.cards;

        modObj[slot] = m;
        playerObj[modObjField] = isModObjString ? JSON.stringify(modObj) : modObj;
        playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
        msg = 'Tháo thẻ bài thành công!';
      }
    }
  }

  else if (action === 'card_mvp_exchange') {
    const mid = parseInt(req.body.mid);
    let cards = playerObj.cards;
    const isCardsString = typeof cards === 'string' || !cards;
    if (isCardsString) {
      try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
    } else {
      cards = cards || {};
    }

    const availableNormal = cards[mid] ? cards[mid].n : 0;
    if (availableNormal < 100) {
      success = false;
      msg = 'Không đủ thẻ bài thường của quái vật này (Cần 100 thẻ thường để đổi 1 thẻ MVP)!';
    } else {
      cards[mid].n = availableNormal - 100;
      cards[mid].m = (cards[mid].m || 0) + 1;

      playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
      msg = 'Đổi thẻ bài MVP thành công!';
    }
  }

  else if (action === 'god_card_exchange') {
    let cards = playerObj.cards;
    const isCardsString = typeof cards === 'string' || !cards;
    if (isCardsString) {
      try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
    } else {
      cards = cards || {};
    }

    let godCards = playerObj.god_cards;
    const isGodString = typeof godCards === 'string' || !godCards;
    if (isGodString) {
      try { godCards = JSON.parse(godCards || '{}'); } catch(e) { godCards = {}; }
    } else {
      godCards = godCards || {};
    }

    const haveGod = parseInt(godCards.anubis) || 0;
    if (haveGod >= 5) {
      success = false;
      msg = 'Bạn đã đạt giới hạn tối đa 5 Thẻ bài Thần Anubis!';
    } else {
      // Check MVP cards of levels between 1 and 50
      const missing = [];
      const requiredMidList = [];

      for (const midStr in monMastersCache) {
        const mon = monMastersCache[midStr];
        const lv = parseInt(mon.lv);
        if (lv >= 1 && lv <= 50) {
          const mid = parseInt(midStr);
          requiredMidList.push(mid);
          const mvpQty = cards[mid] ? parseInt(cards[mid].m) : 0;
          if (mvpQty < 3) {
            missing.push(mon.n || midStr);
          }
        }
      }

      if (missing.length > 0) {
        success = false;
        msg = `Thiếu thẻ MVP: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' và ' + (missing.length - 5) + ' loại khác' : ''}. Yêu cầu mỗi loại 3 thẻ MVP.`;
      } else {
        // Deduct 3 MVP cards for each mid
        requiredMidList.forEach(mid => {
          cards[mid].m = (cards[mid].m || 0) - 3;
        });

        godCards.anubis = haveGod + 1;
        playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
        playerObj.god_cards = isGodString ? JSON.stringify(godCards) : godCards;
        msg = '🏺 Đổi Thẻ bài Thần Anubis thành công!';
      }
    }
  }

  else if (action === 'card_sacrifice') {
    const mid = parseInt(req.body.mid);
    let cards = playerObj.cards;
    const isCardsString = typeof cards === 'string' || !cards;
    if (isCardsString) {
      try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
    } else {
      cards = cards || {};
    }

    let sacCards = playerObj.sac_cards;
    const isSacString = typeof sacCards === 'string' || !sacCards;
    if (isSacString) {
      try { sacCards = JSON.parse(sacCards || '{}'); } catch(e) { sacCards = {}; }
    } else {
      sacCards = sacCards || {};
    }

    const currentSac = parseInt(sacCards[mid]) || 0;
    const mvpQty = cards[mid] ? parseInt(cards[mid].m) : 0;

    if (currentSac >= 30) {
      success = false;
      msg = 'Chỉ số hiến tế thẻ này đã đạt tối đa (30)!';
    } else if (mvpQty < 1) {
      success = false;
      msg = 'Bạn không có thẻ MVP này để hiến tế!';
    } else {
      cards[mid].m = mvpQty - 1;
      sacCards[mid] = currentSac + 1;

      playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
      playerObj.sac_cards = isSacString ? JSON.stringify(sacCards) : sacCards;
      msg = '🔥 Bù chay nhã thẻ MVP thành công!';
    }
  }

  // --- SYSTEM: TRỨNG THÚ CƯNG ---
  else if (action === 'open_egg_box') {
    const t = parseInt(req.body.param);
    const count = Math.max(1, Math.min(10, parseInt(req.body.count) || 1));
    const boxField = `egg_box${t}`;
    const boxQty = parseInt(playerObj[boxField]) || 0;

    if (boxQty < count) {
      success = false;
      msg = 'Bạn không đủ hộp trứng để mở!';
    } else {
      playerObj[boxField] = boxQty - count;
      const results = [];

      let eggs = playerObj.eggs;
      const isEggsString = typeof eggs === 'string' || !eggs;
      if (isEggsString) {
        try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; }
      } else {
        eggs = eggs || {};
      }

      const lo = (t - 1) * 10 + 1;
      const hi = t * 10;

      for (let k = 0; k < count; k++) {
        const mon = getRandomMonsterInLvRange(lo, hi);
        const isMvp = Math.random() < 0.01 ? 1 : 0;
        const cid = mon.mid;
        
        eggs[cid] = eggs[cid] || { n: 0, m: 0 };
        if (isMvp) {
          eggs[cid].m = (eggs[cid].m || 0) + 1;
        } else {
          eggs[cid].n = (eggs[cid].n || 0) + 1;
        }

        results.push({
          boxTier: t,
          mvp: isMvp,
          lv: mon.lv || 1,
          mid: cid,
          name: mon.n || mon.orig_n || 'Thú cưng'
        });
      }

      playerObj.eggs = isEggsString ? JSON.stringify(eggs) : eggs;
      res.locals = res.locals || {};
      res.locals.payloadExt = count > 1 ? { egg_results: results } : { egg_result: results[0] };
      msg = `Mở thành công ${count} hộp trứng thú cưng!`;
    }
  }

  else if (action === 'egg_mvp_exchange') {
    const mid = parseInt(req.body.mid);
    let eggs = playerObj.eggs;
    const isEggsString = typeof eggs === 'string' || !eggs;
    if (isEggsString) {
      try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; }
    } else {
      eggs = eggs || {};
    }

    const availableNormal = eggs[mid] ? eggs[mid].n : 0;
    if (availableNormal < 100) {
      success = false;
      msg = 'Không đủ trứng thường của thú cưng này (Cần 100 trứng thường để đổi 1 trứng MVP)!';
    } else {
      eggs[mid].n = availableNormal - 100;
      eggs[mid].m = (eggs[mid].m || 0) + 1;

      playerObj.eggs = isEggsString ? JSON.stringify(eggs) : eggs;
      msg = 'Đổi trứng thú cưng MVP thành công!';
    }
  }

  else if (action === 'egg_sacrifice') {
    const mid = parseInt(req.body.mid);
    let eggs = playerObj.eggs;
    const isEggsString = typeof eggs === 'string' || !eggs;
    if (isEggsString) {
      try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; }
    } else {
      eggs = eggs || {};
    }

    let sacEggs = playerObj.sac_eggs;
    const isSacString = typeof sacEggs === 'string' || !sacEggs;
    if (isSacString) {
      try { sacEggs = JSON.parse(sacEggs || '{}'); } catch(e) { sacEggs = {}; }
    } else {
      sacEggs = sacEggs || {};
    }

    const sacVal = sacEggs[mid];
    const currentSac = (sacVal && typeof sacVal === 'object') ? (sacVal.st || 0) : (parseInt(sacVal) || 0);
    const mvpQty = eggs[mid] ? parseInt(eggs[mid].m) : 0;

    if (currentSac >= 30) {
      success = false;
      msg = 'Chỉ số hiến tế trứng này đã đạt tối đa (30)!';
    } else if (mvpQty < 1) {
      success = false;
      msg = 'Bạn không có trứng MVP này để hiến tế!';
    } else {
      eggs[mid].m = mvpQty - 1;
      if (sacVal && typeof sacVal === 'object') {
        sacVal.st = currentSac + 1;
      } else {
        sacEggs[mid] = { st: currentSac + 1, e: 0, a: 0, h: 0, r: 0 };
      }

      playerObj.eggs = isEggsString ? JSON.stringify(eggs) : eggs;
      playerObj.sac_eggs = isSacString ? JSON.stringify(sacEggs) : sacEggs;
      msg = '🔥 Bù chay nhã trứng thú cưng MVP thành công!';
    }
  }

  else if (action === 'pet_hatch') {
    const mid = parseInt(req.body.mid);
    const isMvpReq = parseInt(req.body.mvp) === 1;

    if ((playerObj.pet_mid || 0) > 0) {
      success = false;
      msg = 'Có thú nuôi rồi, phải recall trước!';
    } else {
      const mon = monMastersCache[mid];
      if (!mon) {
        success = false;
        msg = 'Không tìm thấy thông tin quái vật!';
      } else {
        let sacEggs = playerObj.sac_eggs;
        if (typeof sacEggs === 'string') { try { sacEggs = JSON.parse(sacEggs || '{}'); } catch(e) { sacEggs = {}; } }
        sacEggs = sacEggs || {};
        const isUnlocked = !!sacEggs[mid];

        let eggs = playerObj.eggs;
        const isEggsString = typeof eggs === 'string' || !eggs;
        if (isEggsString) {
          try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; }
        } else {
          eggs = eggs || {};
        }

        const cost = isUnlocked ? 0 : (mon.lv || 1) * 100 * (isMvpReq ? 10 : 1);
        const playerGold = playerObj.gold || 0;

        let okToHatch = false;
        let mvp = isUnlocked ? 1 : (isMvpReq ? 1 : 0);

        if (playerGold < cost) {
          success = false;
          msg = 'Không đủ vàng để ấp!';
        } else if (!isUnlocked) {
          const available = mvp ? (eggs[mid] ? eggs[mid].m : 0) : (eggs[mid] ? eggs[mid].n : 0);
          if (available < 1) {
            success = false;
            msg = `Không đủ trứng ${mvp ? 'MVP' : 'Thường'} của quái vật này!`;
          } else {
            if (mvp) eggs[mid].m--;
            else eggs[mid].n--;
            okToHatch = true;
          }
        } else {
          okToHatch = true;
        }

        if (okToHatch) {
          playerObj.gold = playerGold - cost;
          playerObj.pet_mid = mid;
          playerObj.pet_mvp = mvp;
          playerObj.pet_olv = mon.lv || 1;
          playerObj.pet_batk = (mon.lv || 1) * 3;
          playerObj.pet_bhp = (mon.lv || 1) * 8;
          playerObj.pet_down = 0;

          const sacStar = (sacEggs[mid] && typeof sacEggs[mid] === 'object') ? (sacEggs[mid].st || 0) : (parseInt(sacEggs[mid]) || 0);
          const es = 1 + 0.05 * Math.max(0, Math.min(30, sacStar));
          const hpMax = Math.max(1, Math.round(0.5 * playerObj.pet_bhp * (1 + 0.25 * 1) * (mvp ? 2 : 1) * es));
          playerObj.pet_hp = hpMax;

          if (isUnlocked && typeof sacEggs[mid] === 'object' && sacEggs[mid] !== null) {
            playerObj.pet_exp = Math.max(0, parseInt(sacEggs[mid].e) || 0);
            playerObj.pet_up_atk = parseInt(sacEggs[mid].a) || 0;
            playerObj.pet_up_hp = parseInt(sacEggs[mid].h) || 0;
            playerObj.pet_up_reco = parseInt(sacEggs[mid].r) || 0;
          } else {
            playerObj.pet_exp = 0;
            playerObj.pet_up_atk = 0;
            playerObj.pet_up_hp = 0;
            playerObj.pet_up_reco = 0;
          }
          playerObj.pet_cards = JSON.stringify([]);

          playerObj.eggs = isEggsString ? JSON.stringify(eggs) : eggs;
          msg = `Ấp thành công Thú cưng ${mon.n || mid}${mvp ? ' ⭐MVP' : ''}!`;
        }
      }
    }
  }

  else if (action === 'pet_recall') {
    const mid = playerObj.pet_mid || 0;
    if (mid === 0) {
      success = false;
      msg = 'Không có thú cưng nào đang ấp để thu hồi!';
    } else {
      let sacEggs = playerObj.sac_eggs;
      if (typeof sacEggs === 'string') { try { sacEggs = JSON.parse(sacEggs || '{}'); } catch(e) { sacEggs = {}; } }
      sacEggs = sacEggs || {};
      const isUnlocked = !!sacEggs[mid];

      let cards = playerObj.cards;
      const isCardsString = typeof cards === 'string' || !cards;
      if (isCardsString) {
        try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
      } else {
        cards = cards || {};
      }

      let petCards = playerObj.pet_cards;
      if (typeof petCards === 'string') { try { petCards = JSON.parse(petCards || '[]'); } catch(e) { petCards = []; } }
      petCards = petCards || [];

      petCards.forEach(c => {
        if (c && c.mid) {
          cards[c.mid] = cards[c.mid] || { n: 0, m: 0 };
          if (c.mvp) {
            cards[c.mid].m = (cards[c.mid].m || 0) + 1;
          } else {
            cards[c.mid].n = (cards[c.mid].n || 0) + 1;
          }
        }
      });

      playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
      playerObj.pet_cards = JSON.stringify([]);

      if (isUnlocked) {
        if (typeof sacEggs[mid] !== 'object' || sacEggs[mid] === null) {
          sacEggs[mid] = { st: parseInt(sacEggs[mid]) || 1, e: 0, a: 0, h: 0, r: 0 };
        }
        sacEggs[mid].e = Math.max(0, parseInt(playerObj.pet_exp) || 0);
        sacEggs[mid].a = parseInt(playerObj.pet_up_atk) || 0;
        sacEggs[mid].h = parseInt(playerObj.pet_up_hp) || 0;
        sacEggs[mid].r = parseInt(playerObj.pet_up_reco) || 0;
        
        playerObj.sac_eggs = typeof playerObj.sac_eggs === 'string' ? JSON.stringify(sacEggs) : sacEggs;
        msg = 'Đã thu hồi thú cưng miễn phí thành công! Điểm nâng cấp và EXP được giữ lại.';
      } else {
        const cost = 10000;
        const playerGold = playerObj.gold || 0;
        if (playerGold < cost) {
          success = false;
          msg = 'Không đủ 10,000 vàng để thu hồi thú cưng!';
          return res.json({ ok: false, error: msg });
        }
        playerObj.gold = playerGold - cost;

        let eggs = playerObj.eggs;
        const isEggsString = typeof eggs === 'string' || !eggs;
        if (isEggsString) {
          try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; }
        } else {
          eggs = eggs || {};
        }

        eggs[mid] = eggs[mid] || { n: 0, m: 0 };
        if (playerObj.pet_mvp) {
          eggs[mid].m = (eggs[mid].m || 0) + 1;
        } else {
          eggs[mid].n = (eggs[mid].n || 0) + 1;
        }

        playerObj.eggs = isEggsString ? JSON.stringify(eggs) : eggs;
        playerObj.pet_exp = 0;
        playerObj.pet_up_atk = 0;
        playerObj.pet_up_hp = 0;
        playerObj.pet_up_reco = 0;
        msg = 'Đã thu hồi thú cưng thành công (Tốn 10,000 G). EXP và điểm nâng cấp bị reset.';
      }

      playerObj.pet_mid = 0;
      playerObj.pet_mvp = 0;
      playerObj.pet_hp = 0;
      playerObj.pet_down = 0;
    }
  }

  else if (action === 'pet_card_socket') {
    const mid = parseInt(req.body.mid);
    const mvp = parseInt(req.body.mvp) === 1 ? 1 : 0;

    if (!(playerObj.pet_mid || 0)) {
      success = false;
      msg = 'Bạn không có thú cưng đang hoạt động để khảm thẻ!';
    } else {
      let cards = playerObj.cards;
      const isCardsString = typeof cards === 'string' || !cards;
      if (isCardsString) {
        try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
      } else {
        cards = cards || {};
      }

      const available = cards[mid] ? (mvp ? cards[mid].m : cards[mid].n) : 0;
      if (available < 1) {
        success = false;
        msg = `Bạn không có thẻ bài ${mvp ? 'MVP' : 'Thường'} này trong bộ sưu tập!`;
      } else {
        let petCards = playerObj.pet_cards;
        const isPetCardsString = typeof petCards === 'string' || !petCards;
        if (isPetCardsString) {
          try { petCards = JSON.parse(petCards || '[]'); } catch(e) { petCards = []; }
        } else {
          petCards = petCards || [];
        }

        const olv = playerObj.pet_olv || 1;
        const petMvp = playerObj.pet_mvp || 0;
        const slotsCount = getPetSlots(olv, petMvp);

        while (petCards.length < slotsCount) {
          petCards.push(null);
        }
        if (petCards.length > slotsCount) {
          petCards = petCards.slice(0, slotsCount);
        }

        const emptyIndex = petCards.indexOf(null);
        if (emptyIndex === -1) {
          success = false;
          msg = 'Thú cưng của bạn đã khảm đầy thẻ, không còn ô trống!';
        } else {
          if (mvp) cards[mid].m--;
          else cards[mid].n--;

          const mon = monMastersCache[mid] || { lv: 1, cs: 'str', n: 'Quái vật' };
          const bonus = mvp ? _mvpCardBonus(mid, mon.lv || 1) : null;
          const statVal = mvp ? Math.max(1, Math.floor((mon.lv || 1) / 10) * 2 + 2) : Math.max(1, Math.floor((mon.lv || 1) / 10) + 1);

          petCards[emptyIndex] = {
            mid: mid,
            mvp: mvp,
            s: mon.cs || 'str',
            v: statVal,
            mb: bonus ? { t: bonus.t, a: bonus.a } : null
          };

          playerObj.pet_cards = isPetCardsString ? JSON.stringify(petCards) : petCards;
          playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
          msg = `Gắn thành công thẻ bài ${mon.n || mid} vào thú cưng!`;
        }
      }
    }
  }

  else if (action === 'pet_card_unsocket') {
    const sidx = parseInt(req.body.sidx);
    const pay = req.body.pay;

    if (!(playerObj.pet_mid || 0)) {
      success = false;
      msg = 'Bạn không có thú cưng đang hoạt động!';
    } else {
      let petCards = playerObj.pet_cards;
      const isPetCardsString = typeof petCards === 'string' || !petCards;
      if (isPetCardsString) {
        try { petCards = JSON.parse(petCards || '[]'); } catch(e) { petCards = []; }
      } else {
        petCards = petCards || [];
      }

      if (sidx < 0 || sidx >= petCards.length || !petCards[sidx]) {
        success = false;
        msg = 'Không tìm thấy thẻ khảm tại ô này!';
      } else {
        const petLv = getPetLv(playerObj.pet_exp || 0);
        const goldCost = petLv * 500;
        const pCost = 15;

        let canPay = false;
        if (pay === 'gold') {
          if ((playerObj.gold || 0) >= goldCost) {
            playerObj.gold -= goldCost;
            canPay = true;
          } else {
            msg = 'Bạn không đủ vàng để tháo thẻ!';
          }
        } else if (pay === 'p') {
          if ((playerObj.p_points || 0) >= pCost) {
            playerObj.p_points -= pCost;
            canPay = true;
          } else {
            msg = 'Bạn không đủ Point để tháo thẻ!';
          }
        } else {
          msg = 'Phương thức thanh toán không hợp lệ!';
        }

        if (canPay) {
          const removedCard = petCards[sidx];
          petCards[sidx] = null;

          let cards = playerObj.cards;
          const isCardsString = typeof cards === 'string' || !cards;
          if (isCardsString) {
            try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
          } else {
            cards = cards || {};
          }

          const cid = removedCard.mid;
          cards[cid] = cards[cid] || { n: 0, m: 0 };
          if (removedCard.mvp) {
            cards[cid].m = (cards[cid].m || 0) + 1;
          } else {
            cards[cid].n = (cards[cid].n || 0) + 1;
          }

          playerObj.pet_cards = isPetCardsString ? JSON.stringify(petCards) : petCards;
          playerObj.cards = isCardsString ? JSON.stringify(cards) : cards;
          msg = `Đã tháo thẻ bài thành công!`;
        } else {
          success = false;
        }
      }
    }
  }

  else if (action === 'pet_reset_up') {
    const pay = req.body.pay;

    const allocated = (playerObj.pet_up_atk || 0) + (playerObj.pet_up_hp || 0) + (playerObj.pet_up_reco || 0);
    if (allocated < 1) {
      success = false;
      msg = 'Thú cưng chưa nâng cấp điểm chỉ số nào!';
    } else {
      const petLv = getPetLv(playerObj.pet_exp || 0);
      const goldCost = petLv * 1000;
      const pCost = 20;

      let canPay = false;
      if (pay === 'gold') {
        if ((playerObj.gold || 0) >= goldCost) {
          playerObj.gold -= goldCost;
          canPay = true;
        } else {
          msg = 'Bạn không đủ vàng để reset!';
        }
      } else if (pay === 'p') {
        if ((playerObj.p_points || 0) >= pCost) {
          playerObj.p_points -= pCost;
          canPay = true;
        } else {
          msg = 'Bạn không đủ Point để reset!';
        }
      } else {
        msg = 'Phương thức thanh toán không hợp lệ!';
      }

      if (canPay) {
        playerObj.pet_up_atk = 0;
        playerObj.pet_up_hp = 0;
        playerObj.pet_up_reco = 0;
        msg = 'Reset điểm tiềm năng của Thú cưng thành công!';
      } else {
        success = false;
      }
    }
  }

  // --- ACTIONS: ĐỔI TÊN, HIỆU ỨNG VIP & TIỂM NĂNG RAG ---
  else if (action === 'rename') {
    const { name } = req.body;
    if (!name || name.trim().length === 0) {
      success = false;
      msg = 'Tên không hợp lệ!';
    } else {
      playerObj.display_name = name.trim();
      msg = `Đổi tên thành công thành ${playerObj.display_name}!`;
    }
  }

  else if (action === 'vipfx_toggle') {
    playerObj.vip_fx = playerObj.vip_fx === 0 ? 1 : 0;
    msg = `Đã ${playerObj.vip_fx === 1 ? 'bật' : 'tắt'} hiệu ứng VIP!`;
  }

  else if (action === 'rag_up') {
    const { param, amount } = req.body;
    const pts = parseInt(amount) || 1;
    if ((playerObj.rag_pts || 0) < pts) {
      success = false;
      msg = 'Không đủ điểm tiềm năng Ragnarok!';
    } else {
      playerObj.rag_pts = (playerObj.rag_pts || 0) - pts;
      const field = `rag_${param}`;
      playerObj[field] = (playerObj[field] || 0) + pts;
      msg = `Nâng cấp chỉ số Ragnarok ${param.toUpperCase()} thành công!`;
    }
  }

  // --- AUTO TOGGLES ---
  else if (action === 'auto_railgun') {
    playerObj.auto_railgun = playerObj.auto_railgun === 0 ? 1 : 0;
    msg = `Đã ${playerObj.auto_railgun === 1 ? 'bật' : 'tắt'} tự động Titan Beam`;
  }
  else if (action === 'orion_rail_toggle') {
    playerObj.orion_rail_on = playerObj.orion_rail_on === 0 ? 1 : 0;
    msg = `Đã ${playerObj.orion_rail_on === 1 ? 'bật' : 'tắt'} Orion Railgun`;
  }
  else if (action === 'orion_cannon_toggle') {
    playerObj.orion_cannon_on = playerObj.orion_cannon_on === 0 ? 1 : 0;
    msg = `Đã ${playerObj.orion_cannon_on === 1 ? 'bật' : 'tắt'} Orion Cannon`;
  }
  else if (action === 'auto_robot_recharge') {
    playerObj.auto_robot_recharge = playerObj.auto_robot_recharge === 0 ? 1 : 0;
    msg = `Đã ${playerObj.auto_robot_recharge === 1 ? 'bật' : 'tắt'} tự động sạc Titan`;
  }
  else if (action === 'auto_potion') {
    const { threshold } = req.body;
    if (threshold !== undefined) {
      playerObj.auto_potion_threshold = parseInt(threshold) || 50;
      msg = `Đã thiết lập ngưỡng tự động bơm máu: ${playerObj.auto_potion_threshold}%`;
    } else {
      playerObj.auto_use_potion = playerObj.auto_use_potion === 0 ? 1 : 0;
      msg = `Đã ${playerObj.auto_use_potion === 1 ? 'bật' : 'tắt'} tự động bơm máu`;
    }
  }

  if (!success) {
      return res.json({ ok: false, error: msg });
    }

    // Always stringify cards and eggs to string format for consistency (only if they are objects to avoid double-stringification)
    if (playerObj.cards && typeof playerObj.cards === 'object') {
      playerObj.cards = JSON.stringify(playerObj.cards);
    }
    if (playerObj.eggs && typeof playerObj.eggs === 'object') {
      playerObj.eggs = JSON.stringify(playerObj.eggs);
    }

    // Lưu DB
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    const responsePayload = {
      ok: true,
      player: playerObj,
      msg: msg
    };

    if (res.locals && res.locals.payloadExt) {
      Object.assign(responsePayload, res.locals.payloadExt);
    }

    res.json(responsePayload);
  } finally {
    release();
  }
});

module.exports = router;
