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
  console.error("Lỗi đọc mon_masters_cache.json trong mdc.js", err);
}

// MDC Constants and Helpers
const MODULE_WEAPONS = ['pistol', 'sniper', 'knife', 'axe', 'robot', 'robot_gun', 'railgun', 'armor', 'house', 'turret'];
const MOD_INV_FIELDS = {
  pistol: 'module_inventory', sniper: 'sniper_module_inventory', knife: 'knife_module_inventory',
  axe: 'axe_module_inventory', robot: 'robot_module_inventory', robot_gun: 'robot_gun_module_inventory',
  railgun: 'railgun_module_inventory', armor: 'armor_module_inventory', house: 'house_module_inventory',
  turret: 'turret_module_inventory'
};

const EQC_T_COST = {
  1: { res: 1000, gold: 1000, b: 0, r: 0, g: 0, sc: 20 },
  2: { res: 10000, gold: 10000, b: 1, r: 0, g: 0, sc: 50 },
  3: { res: 50000, gold: 50000, b: 3, r: 0, g: 0, sc: 100 },
  4: { res: 100000, gold: 100000, b: 10, r: 5, g: 0, sc: 200 },
  5: { res: 200000, gold: 500000, b: 30, r: 10, g: 1, sc: 300 },
  6: { res: 300000, gold: 1000000, b: 30, r: 10, g: 10, sc: 500 },
  7: { res: 500000, gold: 2000000, b: 50, r: 20, g: 20, sc: 800 }
};

const EQC_ROLL_COST = {
  1: { b: 1, r: 0, g: 0, gold: 1000, sc: 1 },
  2: { b: 3, r: 0, g: 0, gold: 10000, sc: 2 },
  3: { b: 5, r: 1, g: 0, gold: 50000, sc: 3 },
  4: { b: 5, r: 5, g: 0, gold: 100000, sc: 4 },
  5: { b: 5, r: 5, g: 1, gold: 200000, sc: 5 },
  6: { b: 10, r: 10, g: 5, gold: 300000, sc: 6 },
  7: { b: 15, r: 15, g: 8, gold: 500000, sc: 7 }
};

const EQC_OPT_COST = {
  1: { b: 5, r: 0, g: 0, gold: 10000, card: 0, egg: 0 },
  2: { b: 10, r: 0, g: 0, gold: 50000, card: 0, egg: 0 },
  3: { b: 15, r: 10, g: 0, gold: 100000, card: 0, egg: 0 },
  4: { b: 20, r: 20, g: 0, gold: 500000, card: 0, egg: 0 },
  5: { b: 30, r: 30, g: 0, gold: 1000000, card: 1, egg: 0 },
  6: { b: 50, r: 50, g: 10, gold: 5000000, card: 1, egg: 1 }
};

const EQC_OPT_REQ = {
  str: { 5: 47, 6: 53 }, agi: { 5: 48, 6: 54 }, dex: { 5: 49, 6: 63 }, int: { 5: 50, 6: 64 }, vit: { 5: 51, 6: 65 }, luk: { 5: 52, 6: 66 },
  rhp: { 5: 47, 6: 67 }, rdf: { 5: 49, 6: 69 }, exp: { 5: 50, 6: 70 }, gld: { 5: 51, 6: 71 }, drp: { 5: 52, 6: 72 },
  prg: { 5: 47, 6: 73 }, srg: { 5: 48, 6: 74 }, pam: { 5: 49, 6: 75 }, xat: { 5: 51, 6: 77 }, ene: { 5: 52, 6: 53 }, gsk: { 5: 47, 6: 54 }, xsk: { 5: 48, 6: 63 },
  hda: { 5: 50, 6: 65 }, swp: { 5: 52, 6: 67 }, krg: { 5: 47, 6: 68 }, tup: { 5: 48, 6: 69 }, trg: { 5: 49, 6: 70 },
  thp: { 5: 50, 6: 71 }, arp: { 5: 51, 6: 72 }, hrp: { 5: 52, 6: 73 }, spd: { 5: 47, 6: 74 }, pln: { 5: 48, 6: 75 }, rpl: { 5: 49, 6: 76 }, cdr: { 5: 50, 6: 77 }
};

const EQ2_OPT_MINT = { atk: 99, gat: 99, brg: 99, hrg: 99, prg: 3, srg: 3, gsk: 3, xsk: 3, swp: 3, krg: 3, tup: 3, trg: 3, thp: 3, arp: 4, hrp: 4, spd: 2, pln: 5, rpl: 5, cdr: 5 };
const EQ2_OPT_MAXT = { wod: 3, stn: 3, irn: 3, cop: 3, hrb: 3 };

const _optMinT = k => EQ2_OPT_MINT[k] || 1;
const _optMaxT = k => EQ2_OPT_MAXT[k] || 6;

const EQ2_OPT_LO = {
  str: [1, 2, 3, 4, 5, 8], agi: [1, 2, 3, 4, 5, 8], dex: [1, 2, 3, 4, 5, 8], int: [1, 2, 3, 4, 5, 8], vit: [1, 2, 3, 4, 5, 8], luk: [1, 2, 3, 4, 5, 8],
  rhp: [10, 20, 40, 60, 90, 120], atk: [10, 20, 40, 60, 90, 120], rdf: [10, 20, 40, 60, 90, 120], exp: [10, 20, 40, 60, 90, 120], gld: [10, 20, 40, 60, 90, 120], drp: [10, 20, 40, 60, 90, 120],
  prg: [0, 0, 1, 2, 3, 5], srg: [0, 0, 1, 2, 3, 5], pam: [2, 4, 6, 9, 12, 16],
  gat: [2, 4, 7, 11, 16, 24], xat: [2, 4, 7, 11, 16, 24], ene: [3, 5, 10, 18, 28, 45], gsk: [0, 0, 1, 2, 3, 5], xsk: [0, 0, 1, 2, 3, 5], brg: [0, 0, 0, 1, 1, 2],
  hda: [2, 4, 7, 10, 14, 19], hrg: [0, 0, 0, 1, 1, 2],
  swp: [0, 0, 30, 60, 100, 160], krg: [0, 0, 2, 3, 5, 7], tup: [0, 0, 30, 60, 100, 160], trg: [0, 0, 3, 4, 5, 6],
  thp: [0, 0, 30, 60, 100, 160], arp: [0, 0, 0, 50, 100, 160], hrp: [0, 0, 0, 2, 4, 7],
  spd: [0, 2, 3, 5, 8, 12], pln: [0, 0, 0, 0, 1, 2], rpl: [0, 0, 0, 0, 1, 1], cdr: [0, 0, 0, 0, 30, 60],
  wod: [1, 1, 1, 0, 0, 0], stn: [1, 1, 1, 0, 0, 0], irn: [1, 1, 1, 0, 0, 0], cop: [1, 1, 1, 0, 0, 0], hrb: [1, 1, 1, 0, 0, 0]
};

const EQ2_OPT_HI = {
  str: [2, 3, 4, 5, 7, 10], agi: [2, 3, 4, 5, 7, 10], dex: [2, 3, 4, 5, 7, 10], int: [2, 3, 4, 5, 7, 10], vit: [2, 3, 4, 5, 7, 10], luk: [2, 3, 4, 5, 7, 10],
  rhp: [20, 40, 60, 90, 120, 180], atk: [20, 40, 60, 90, 120, 180], rdf: [20, 40, 60, 90, 120, 180], exp: [20, 40, 60, 90, 120, 180], gld: [20, 40, 60, 90, 120, 180], drp: [20, 40, 60, 90, 120, 180],
  prg: [0, 0, 2, 3, 5, 7], srg: [0, 0, 2, 3, 5, 7], pam: [4, 6, 9, 12, 16, 20],
  gat: [4, 7, 11, 16, 24, 35], xat: [4, 7, 11, 16, 24, 35], ene: [5, 10, 18, 28, 45, 75], gsk: [0, 0, 2, 3, 5, 7], xsk: [0, 0, 2, 3, 5, 7], brg: [0, 0, 0, 1, 2, 3],
  hda: [4, 7, 10, 14, 19, 25], hrg: [0, 0, 0, 1, 2, 4],
  swp: [0, 0, 60, 100, 160, 250], krg: [0, 0, 3, 5, 7, 9], tup: [0, 0, 60, 100, 160, 250], trg: [0, 0, 4, 5, 6, 7],
  thp: [0, 0, 60, 100, 160, 250], arp: [0, 0, 0, 100, 160, 250], hrp: [0, 0, 0, 4, 7, 10],
  spd: [0, 3, 5, 8, 12, 15], pln: [0, 0, 0, 0, 2, 3], rpl: [0, 0, 0, 0, 1, 2], cdr: [0, 0, 0, 0, 60, 100],
  wod: [1, 1, 2, 0, 0, 0], stn: [1, 1, 2, 0, 0, 0], irn: [1, 1, 2, 0, 0, 0], cop: [1, 1, 2, 0, 0, 0], hrb: [1, 1, 2, 0, 0, 0]
};

const EQ2_OPT_LVM = {
  str: 'l10', agi: 'l10', dex: 'l10', int: 'l10', vit: 'l10', luk: 'l10',
  rhp: 'p10', atk: 'p10', rdf: 'p10', exp: 'p10', gld: 'p10', drp: 'p10',
  pam: 'l10', gat: 'l10', xat: 'l10', ene: 'l10', hda: 'l10'
};

const EQ2_LVF = 1.5;

function _eqcPickRange(k, tier, lv) {
  const i = Math.max(1, Math.min(6, tier)) - 1;
  const lo = (EQ2_OPT_LO[k] || [])[i] | 0, hi = (EQ2_OPT_HI[k] || [])[i] | 0;
  if (!hi) return null;
  const m = EQ2_OPT_LVM[k] || '', l10 = Math.floor(Math.max(1, lv | 0) / 10);
  const b = m === 'l10' ? Math.round(l10 * EQ2_LVF) : (m === 'p10' ? Math.round(l10 * 5 * EQ2_LVF) : 0);
  return [lo + b, hi + b];
}

function safeParse(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val) || fallback; } catch (e) { return fallback; }
}

router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Auth failed' });
  }

  const { acquireLock } = require('../utils/lock');
  const release = await acquireLock(line_uid);

  try {
    const user = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!user) {
      return res.json({ ok: false, error: 'Auth failed' });
    }

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Player not found' });
    }

    let playerObj = typeof pRow.raw_data === 'string' ? JSON.parse(pRow.raw_data) : pRow.raw_data;
    let success = true;
    let msg = '';
    let responseData = {};

    let eqcOpt = safeParse(playerObj.eqc_opt, {});

    if (action === 'mdc_craft') {
      const { fam, slot } = req.body;
      const invField = MOD_INV_FIELDS[fam];

      if (!invField) {
        success = false;
        msg = 'Weapon family không hợp lệ!';
      } else {
        let inv = safeParse(playerObj[invField], []);

        if (inv.length >= 30) {
          success = false;
          msg = `Kho module của [${fam.toUpperCase()}] đã đầy (Tối đa 30)!`;
        } else {
          const cost = EQC_T_COST[1];
          const resKinds = ['wood', 'stone', 'iron', 'copper'];

          let hasResources = true;
          resKinds.forEach(k => {
            if ((playerObj[k] || 0) < cost.res) hasResources = false;
          });

          if (!hasResources || (playerObj.gold || 0) < cost.gold || (playerObj.mod_scrap || 0) < cost.sc) {
            success = false;
            msg = 'Không đủ nguyên liệu chế tạo module!';
          } else {
            // Deduct resources
            resKinds.forEach(k => {
              playerObj[k] -= cost.res;
            });
            playerObj.gold -= cost.gold;
            playerObj.mod_scrap -= cost.sc;

            const modId = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
            const newMod = {
              id: modId,
              t: 1,
              slot: slot,
              rarity: 1,
              sockets: 1,
              c: [null],
              cards: [null],
              opt: {} // Starts empty
            };

            inv.push(newMod);
            playerObj[invField] = JSON.stringify(inv);
            responseData.id = modId;
            msg = `Chế tạo thành công Module ${slot.toUpperCase()} T1!`;
          }
        }
      }
    }

    else if (action === 'mdc_upt') {
      const { id } = req.body;
      let found = false;

      // Find module in all inventories and worn modules
      for (const fam of MODULE_WEAPONS) {
        // Check inventory
        const invField = MOD_INV_FIELDS[fam];
        let inv = safeParse(playerObj[invField], []);

        const idx = inv.findIndex(m => String(m.id) === String(id));
        if (idx !== -1) {
          const m = inv[idx];
          found = true;

          if (m.t >= 7) {
            success = false;
            msg = 'Module đã đạt Tier tối đa (T7)!';
          } else {
            const nextT = m.t + 1;
            const cost = EQC_T_COST[nextT];

            if ((playerObj.gold || 0) < cost.gold ||
                (playerObj.mod_scrap || 0) < cost.sc ||
                (playerObj.diamond_blue || 0) < cost.b ||
                (playerObj.diamond_red || 0) < cost.r ||
                (playerObj.diamond_green || 0) < cost.g) {
              success = false;
              msg = `Không đủ nguyên liệu nâng Tier! Yêu cầu: Gold ${cost.gold}, Scrap ${cost.sc}, Diamond B${cost.b}/R${cost.r}/G${cost.g}`;
            } else {
              // Deduct
              playerObj.gold -= cost.gold;
              playerObj.mod_scrap -= cost.sc;
              playerObj.diamond_blue -= cost.b;
              playerObj.diamond_red -= cost.r;
              playerObj.diamond_green -= cost.g;

              m.t = nextT;
              m.rarity = nextT;
              m.sockets = nextT;
              while (m.c.length < m.sockets) m.c.push(null);
              while (m.cards.length < m.sockets) m.cards.push(null);

              playerObj[invField] = JSON.stringify(inv);
              msg = `Nâng cấp Module lên Tier T${nextT} thành công!`;
            }
          }
          break;
        }

        // Check worn modules
        const wornField = `${fam}_modules`;
        let wornObj = safeParse(playerObj[wornField], {});

        for (const slotKey in wornObj) {
          const m = wornObj[slotKey];
          if (m && String(m.id) === String(id)) {
            found = true;
            if (m.t >= 7) {
              success = false;
              msg = 'Module đã đạt Tier tối đa (T7)!';
            } else {
              const nextT = m.t + 1;
              const cost = EQC_T_COST[nextT];

              if ((playerObj.gold || 0) < cost.gold ||
                  (playerObj.mod_scrap || 0) < cost.sc ||
                  (playerObj.diamond_blue || 0) < cost.b ||
                  (playerObj.diamond_red || 0) < cost.r ||
                  (playerObj.diamond_green || 0) < cost.g) {
                success = false;
                msg = `Không đủ nguyên liệu nâng Tier! Yêu cầu: Gold ${cost.gold}, Scrap ${cost.sc}, Diamond B${cost.b}/R${cost.r}/G${cost.g}`;
              } else {
                // Deduct
                playerObj.gold -= cost.gold;
                playerObj.mod_scrap -= cost.sc;
                playerObj.diamond_blue -= cost.b;
                playerObj.diamond_red -= cost.r;
                playerObj.diamond_green -= cost.g;

                m.t = nextT;
                m.rarity = nextT;
                m.sockets = nextT;
                while (m.c.length < m.sockets) m.c.push(null);
                while (m.cards.length < m.sockets) m.cards.push(null);

                playerObj[wornField] = JSON.stringify(wornObj);
                msg = `Nâng cấp Module lên Tier T${nextT} thành công!`;
              }
            }
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        success = false;
        msg = 'Không tìm thấy Module!';
      }
    }

    else if (action === 'mdc_unlock') {
      const { id } = req.body;
      let found = false;

      for (const fam of MODULE_WEAPONS) {
        const invField = MOD_INV_FIELDS[fam];
        let inv = safeParse(playerObj[invField], []);

        const idx = inv.findIndex(m => String(m.id) === String(id));
        if (idx !== -1) {
          const m = inv[idx];
          m.ul = Math.floor(Date.now() / 1000) + 300; // Unlock for 5 mins
          playerObj[invField] = JSON.stringify(inv);
          msg = 'Đã mở khóa bảo vệ module (Hiệu lực trong 5 phút)';
          found = true;
          break;
        }
      }

      if (!found) {
        success = false;
        msg = 'Không tìm thấy module trong hành lý!';
      }
    }

    else if (action === 'mdc_destroy') {
      const { id } = req.body;
      let found = false;

      for (const fam of MODULE_WEAPONS) {
        const invField = MOD_INV_FIELDS[fam];
        let inv = safeParse(playerObj[invField], []);

        const idx = inv.findIndex(m => String(m.id) === String(id));
        if (idx !== -1) {
          const m = inv[idx];
          found = true;

          const now = Math.floor(Date.now() / 1000);
          const unlocked = (m.ul || 0) > now;

          if (!unlocked) {
            success = false;
            msg = 'Module đang khóa bảo vệ. Vui lòng mở khóa trước!';
          } else {
            const goldGain = m.t * 100 + m.rarity * 50;
            const scrapGain = m.t * 3 + m.rarity * 2;

            // Return socketed cards to player's card collection
            let cards = playerObj.cards;
            if (typeof cards === 'string') {
              try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
            }
            let cardsReturned = 0;
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

            playerObj.cards = JSON.stringify(cards);
            playerObj.gold = (playerObj.gold || 0) + goldGain;
            playerObj.mod_scrap = (playerObj.mod_scrap || 0) + scrapGain;

            inv.splice(idx, 1);
            playerObj[invField] = JSON.stringify(inv);

            msg = `Phân rã module thành công, nhận lại ${goldGain} Gold và ${scrapGain} Scrap!`;
            if (cardsReturned > 0) {
              msg += ` Đã trả lại ${cardsReturned} thẻ bài về bộ sưu tập.`;
            }
          }
          break;
        }
      }

      if (!found) {
        success = false;
        msg = 'Không tìm thấy module trong hành lý!';
      }
    }

    else if (action === 'mdc_pick') {
      const { id, opt } = req.body;
      let found = false;

      for (const fam of MODULE_WEAPONS) {
        const invField = MOD_INV_FIELDS[fam];
        let inv = safeParse(playerObj[invField], []);

        const idx = inv.findIndex(m => String(m.id) === String(id));
        if (idx !== -1) {
          const m = inv[idx];
          found = true;

          const unlockedLv = eqcOpt[opt] || 0;
          if (unlockedLv <= 0) {
            success = false;
            msg = 'Bạn chưa mở khóa thuộc tính này!';
          } else {
            const cost = EQC_ROLL_COST[m.t];
            if ((playerObj.gold || 0) < cost.gold ||
                (playerObj.mod_scrap || 0) < cost.sc ||
                (playerObj.diamond_blue || 0) < cost.b ||
                (playerObj.diamond_red || 0) < cost.r ||
                (playerObj.diamond_green || 0) < cost.g) {
              success = false;
              msg = 'Không đủ nguyên liệu để chọn dòng thuộc tính!';
            } else {
              // Deduct
              playerObj.gold -= cost.gold;
              playerObj.mod_scrap -= cost.sc;
              playerObj.diamond_blue -= cost.b;
              playerObj.diamond_red -= cost.r;
              playerObj.diamond_green -= cost.g;

              // Roll option value
              const eff = Math.min(unlockedLv, m.t);
              const range = _eqcPickRange(opt, eff, 1); // Module has lv=1
              const rolledVal = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

              m.opt = { [opt]: rolledVal };
              playerObj[invField] = JSON.stringify(inv);
              msg = `Chỉ định thành công dòng thuộc tính ${opt.toUpperCase()} cho Module!`;
            }
          }
          break;
        }

        // Check worn modules as well (picking slot when equipped)
        const wornField = `${fam}_modules`;
        let wornObj = safeParse(playerObj[wornField], {});

        for (const slotKey in wornObj) {
          const m = wornObj[slotKey];
          if (m && String(m.id) === String(id)) {
            found = true;

            const unlockedLv = eqcOpt[opt] || 0;
            if (unlockedLv <= 0) {
              success = false;
              msg = 'Bạn chưa mở khóa thuộc tính này!';
            } else {
              const cost = EQC_ROLL_COST[m.t];
              if ((playerObj.gold || 0) < cost.gold ||
                  (playerObj.mod_scrap || 0) < cost.sc ||
                  (playerObj.diamond_blue || 0) < cost.b ||
                  (playerObj.diamond_red || 0) < cost.r ||
                  (playerObj.diamond_green || 0) < cost.g) {
                success = false;
                msg = 'Không đủ nguyên liệu để chọn dòng thuộc tính!';
              } else {
                // Deduct
                playerObj.gold -= cost.gold;
                playerObj.mod_scrap -= cost.sc;
                playerObj.diamond_blue -= cost.b;
                playerObj.diamond_red -= cost.r;
                playerObj.diamond_green -= cost.g;

                // Roll option value
                const eff = Math.min(unlockedLv, m.t);
                const range = _eqcPickRange(opt, eff, 1);
                const rolledVal = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

                m.opt = { [opt]: rolledVal };
                playerObj[wornField] = JSON.stringify(wornObj);
                msg = `Chỉ định thành công dòng thuộc tính ${opt.toUpperCase()} cho Module!`;
              }
            }
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        success = false;
        msg = 'Không tìm thấy Module!';
      }
    }

    else if (action === 'opt_unlock') {
      const { opt, tier } = req.body;
      const targetT = parseInt(tier);
      const curLv = eqcOpt[opt] || 0;

      const nextT = Math.max(_optMinT(opt), curLv + 1);

      if (targetT !== nextT) {
        success = false;
        msg = `Yêu cầu cấp mở khóa không khớp (Cần mở khóa T${nextT})!`;
      } else if (targetT > _optMaxT(opt)) {
        success = false;
        msg = 'Thuộc tính này đã đạt cấp mở khóa tối đa!';
      } else {
        const cost = EQC_OPT_COST[targetT];
        
        // Cards and Eggs verification
        let ownsMvpCard = true;
        let ownsMvpEgg = true;
        const mid = EQC_OPT_REQ[opt] ? EQC_OPT_REQ[opt][targetT] : 0;

        let cards = playerObj.cards;
        if (typeof cards === 'string') {
          try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; }
        }
        let eggs = playerObj.eggs;
        if (typeof eggs === 'string') {
          try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; }
        }

        const ownedCards = (cards[mid] && cards[mid].m) || 0;
        const ownedEggs = (eggs[mid] && eggs[mid].m) || 0;

        if (cost.card && ownedCards < cost.card) ownsMvpCard = false;
        if (cost.egg && ownedEggs < cost.egg) ownsMvpEgg = false;

        if (!ownsMvpCard || !ownsMvpEgg ||
            (playerObj.gold || 0) < cost.gold ||
            (playerObj.diamond_blue || 0) < cost.b ||
            (playerObj.diamond_red || 0) < cost.r ||
            (playerObj.diamond_green || 0) < cost.g) {
          success = false;
          msg = 'Không đủ nguyên liệu để mở khóa cấp thuộc tính mới!';
        } else {
          // Deduct cards and eggs
          if (cost.card && mid) {
            cards[mid].m -= cost.card;
            playerObj.cards = JSON.stringify(cards);
          }
          if (cost.egg && mid) {
            eggs[mid].m -= cost.egg;
            playerObj.eggs = JSON.stringify(eggs);
          }

          // Deduct gems/gold
          playerObj.gold -= cost.gold;
          playerObj.diamond_blue -= cost.b;
          playerObj.diamond_red -= cost.r;
          playerObj.diamond_green -= cost.g;

          eqcOpt[opt] = targetT;
          playerObj.eqc_opt = JSON.stringify(eqcOpt);
          msg = `Mở khóa thành công thuộc tính ${opt.toUpperCase()} cấp T${targetT}!`;
        }
      }
    }

    else {
      success = false;
      msg = 'Hành động không hợp lệ!';
    }

    if (!success) {
      return res.json({ ok: false, error: msg });
    }

    // Save back to database
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    const payload = {
      ok: true,
      player: playerObj,
      msg: msg
    };
    if (responseData.id) {
      payload.id = responseData.id;
    }
    res.json(payload);

  } catch (err) {
    console.error("Lỗi trong route MDC", err);
    res.json({ ok: false, error: 'Internal server error' });
  } finally {
    release();
  }
});

module.exports = router;
