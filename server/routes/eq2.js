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
  console.error("Lỗi đọc mon_masters_cache.json trong eq2.js", err);
}

// EQC Constants and Helpers
const EQ2_SLOTS = ['head', 'body', 'foot', 'neck', 'ring1', 'ring2'];
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

const EQC_LV_RES = {
  head: ['iron', 'copper'],
  body: ['stone', 'wood'],
  foot: ['copper', 'stone'],
  neck: ['iron', 'stone', 'copper'],
  ring: ['iron', 'wood']
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

function _eqcLvCost(to) {
  return { res: Math.ceil(tierRes(to) * upgCostMult(to)), gold: Math.ceil(tierGold(to) * upgCostMult(to)), sc: 1 };
}

function _eq2EnhCost(to) {
  const EQ2_ENH_GOLD_X = 10;
  return { blue: to, red: to >= 6 ? to - 5 : 0, green: to >= 12 ? to - 11 : 0, gold: Math.max(1, to) * 1000 * EQ2_ENH_GOLD_X };
}

function _eq2EnhRate(to) {
  if (to <= 5)  return 1.0;
  if (to === 6) return 0.9;
  if (to <= 11) return (150 - to * 10) / 100;
  return 0.3;
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

    // Parse EQC structures
    let eq2 = safeParse(playerObj.eq2, {});
    let eq2Inv = safeParse(playerObj.eq2_inv, []);
    let eqcOpt = safeParse(playerObj.eqc_opt, {});

    if (action === 'info') {
      const req_names = {};
      const req_lv = {};
      for (const mid in monMastersCache) {
        req_names[mid] = monMastersCache[mid].n;
        req_lv[mid] = monMastersCache[mid].lv;
      }
      return res.json({ ok: true, player: playerObj, req_names, req_lv });
    }

    else if (action === 'craft') {
      const { kind } = req.body;
      const validKinds = ['head', 'body', 'foot', 'neck', 'ring'];
      if (!validKinds.includes(kind)) {
        success = false;
        msg = 'Loại trang bị chế tạo không hợp lệ!';
      } else if (eq2Inv.length >= 100) {
        success = false;
        msg = 'Hành lý trang bị đã đầy (Tối đa 100)!';
      } else {
        const cost = EQC_T_COST[1];
        const resKinds = EQC_LV_RES[kind] || [];

        // Check costs
        let hasResources = true;
        resKinds.forEach(k => {
          if ((playerObj[k] || 0) < cost.res) hasResources = false;
        });

        if (!hasResources || (playerObj.gold || 0) < cost.gold || (playerObj.eq2_scrap || 0) < cost.sc) {
          success = false;
          msg = 'Thiếu nguyên liệu chế tạo!';
        } else {
          // Deduct
          resKinds.forEach(k => {
            playerObj[k] -= cost.res;
          });
          playerObj.gold -= cost.gold;
          playerObj.eq2_scrap -= cost.sc;

          // Create new EQC item
          const newGear = {
            id: Math.random().toString(36).substring(2, 12),
            s: kind,
            t: 1,
            lv: 1,
            c: 1, // Marks it as EQC
            af: [null]
          };

          eq2Inv.push(newGear);
          msg = `Chế tạo thành công Trang bị ${kind.toUpperCase()} T1!`;
        }
      }
    }

    else if (action === 'upt') {
      const { id } = req.body;
      const idx = eq2Inv.findIndex(it => String(it.id) === String(id));
      if (idx === -1) {
        success = false;
        msg = 'Không tìm thấy trang bị trong hành lý!';
      } else {
        const it = eq2Inv[idx];
        if (!it.c) {
          success = false;
          msg = 'Không thể nâng Tier trang bị thường!';
        } else if (it.t >= 6) {
          success = false;
          msg = 'Trang bị đã đạt Tier tối đa (T6)!';
        } else {
          const nextT = it.t + 1;
          const cost = EQC_T_COST[nextT];
          if ((playerObj.gold || 0) < cost.gold ||
              (playerObj.eq2_scrap || 0) < cost.sc ||
              (playerObj.diamond_blue || 0) < cost.b ||
              (playerObj.diamond_red || 0) < cost.r ||
              (playerObj.diamond_green || 0) < cost.g) {
            success = false;
            msg = `Không đủ nguyên liệu nâng Tier! Yêu cầu: Gold ${cost.gold}, Scrap ${cost.sc}, Diamond B${cost.b}/R${cost.r}/G${cost.g}`;
          } else {
            // Deduct
            playerObj.gold -= cost.gold;
            playerObj.eq2_scrap -= cost.sc;
            playerObj.diamond_blue -= cost.b;
            playerObj.diamond_red -= cost.r;
            playerObj.diamond_green -= cost.g;

            // Upgrade
            it.t = nextT;
            while (it.af.length < it.t) {
              it.af.push(null);
            }
            msg = `Nâng cấp thành công lên Tier T${nextT}!`;
          }
        }
      }
    }

    else if (action === 'uplv') {
      const { id } = req.body;
      const idx = eq2Inv.findIndex(it => String(it.id) === String(id));
      if (idx === -1) {
        success = false;
        msg = 'Không tìm thấy trang bị trong hành lý!';
      } else {
        const it = eq2Inv[idx];
        if (!it.c) {
          success = false;
          msg = 'Không thể nâng cấp Level trang bị thường!';
        } else if (it.lv >= (playerObj.lv || 1)) {
          success = false;
          msg = 'Cấp trang bị không được vượt quá cấp nhân vật!';
        } else {
          const nextLv = it.lv + 1;
          const cost = _eqcLvCost(nextLv);
          const resKinds = EQC_LV_RES[it.s] || [];

          let hasResources = true;
          resKinds.forEach(k => {
            if ((playerObj[k] || 0) < cost.res) hasResources = false;
          });

          if (!hasResources || (playerObj.gold || 0) < cost.gold || (playerObj.eq2_scrap || 0) < cost.sc) {
            success = false;
            msg = 'Không đủ nguyên liệu nâng cấp Level!';
          } else {
            // Deduct
            resKinds.forEach(k => {
              playerObj[k] -= cost.res;
            });
            playerObj.gold -= cost.gold;
            playerObj.eq2_scrap -= cost.sc;

            // Upgrade
            it.lv = nextLv;
            msg = `Nâng cấp thành công lên Level ${nextLv}!`;
          }
        }
      }
    }

    else if (action === 'reroll_slot') {
      const { id, opt_slot } = req.body;
      const slotIdx = parseInt(opt_slot) - 1;
      const idx = eq2Inv.findIndex(it => String(it.id) === String(id));

      if (idx === -1) {
        success = false;
        msg = 'Không tìm thấy trang bị trong hành lý!';
      } else {
        const it = eq2Inv[idx];
        if (!it.c) {
          success = false;
          msg = 'Không thể chỉnh sửa trang bị thường!';
        } else if (slotIdx < 0 || slotIdx >= it.t) {
          success = false;
          msg = 'Vị trí dòng thuộc tính không hợp lệ!';
        } else {
          const cost = EQC_ROLL_COST[opt_slot];
          if ((playerObj.gold || 0) < cost.gold ||
              (playerObj.eq2_scrap || 0) < cost.sc ||
              (playerObj.diamond_blue || 0) < cost.b ||
              (playerObj.diamond_red || 0) < cost.r ||
              (playerObj.diamond_green || 0) < cost.g) {
            success = false;
            msg = 'Không đủ nguyên liệu để sành/sุ่ม dòng!';
          } else {
            // Deduct
            playerObj.gold -= cost.gold;
            playerObj.eq2_scrap -= cost.sc;
            playerObj.diamond_blue -= cost.b;
            playerObj.diamond_red -= cost.r;
            playerObj.diamond_green -= cost.g;

            // Roll logic
            const validOptions = [];
            for (const key in EQ2_OPT_LO) {
              const minT = _optMinT(key);
              const maxT = _optMaxT(key);
              if (minT === 99) continue;
              if (it.t >= minT && it.t <= maxT) {
                validOptions.push(key);
              }
            }

            const usedOptions = it.af.filter((a, i) => i !== slotIdx && a).map(a => a[0]);
            const pool = validOptions.filter(k => !usedOptions.includes(k));

            if (pool.length === 0) {
              success = false;
              msg = 'Lỗi hệ thống: Hồ thuộc tính trống!';
            } else {
              const chosen = pool[Math.floor(Math.random() * pool.length)];
              const range = _eqcPickRange(chosen, it.t, it.lv);
              const rolledVal = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

              it.af[slotIdx] = [chosen, rolledVal];
              msg = `Đã sุ่ม thành công dòng thuộc tính mới!`;
            }
          }
        }
      }
    }

    else if (action === 'pick_slot') {
      const { id, opt_slot, opt } = req.body;
      const slotIdx = parseInt(opt_slot) - 1;
      const idx = eq2Inv.findIndex(it => String(it.id) === String(id));

      if (idx === -1) {
        success = false;
        msg = 'Không tìm thấy trang bị trong hành lý!';
      } else {
        const it = eq2Inv[idx];
        if (!it.c) {
          success = false;
          msg = 'Không thể chỉnh sửa trang bị thường!';
        } else if (slotIdx < 0 || slotIdx >= it.t) {
          success = false;
          msg = 'Vị trí dòng thuộc tính không hợp lệ!';
        } else {
          const unlockedLv = eqcOpt[opt] || 0;
          if (unlockedLv <= 0) {
            success = false;
            msg = 'Bạn chưa mở khóa thuộc tính này!';
          } else {
            const cost = EQC_ROLL_COST[opt_slot];
            if ((playerObj.gold || 0) < cost.gold ||
                (playerObj.eq2_scrap || 0) < cost.sc ||
                (playerObj.diamond_blue || 0) < cost.b ||
                (playerObj.diamond_red || 0) < cost.r ||
                (playerObj.diamond_green || 0) < cost.g) {
              success = false;
              msg = 'Không đủ nguyên liệu để chọn dòng!';
            } else {
              const usedOptions = it.af.filter((a, i) => i !== slotIdx && a).map(a => a[0]);
              if (usedOptions.includes(opt)) {
                success = false;
                msg = 'Trang bị đã có thuộc tính này ở ô khác!';
              } else {
                // Deduct
                playerObj.gold -= cost.gold;
                playerObj.eq2_scrap -= cost.sc;
                playerObj.diamond_blue -= cost.b;
                playerObj.diamond_red -= cost.r;
                playerObj.diamond_green -= cost.g;

                // Roll value based on unlocked tier and item tier
                const eff = Math.min(unlockedLv, it.t);
                const range = _eqcPickRange(opt, eff, it.lv);
                const rolledVal = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

                it.af[slotIdx] = [opt, rolledVal];
                msg = `Đã chỉ định thành công dòng thuộc tính ${opt.toUpperCase()}!`;
              }
            }
          }
        }
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

    else if (action === 'destroy') {
      const { id } = req.body;
      const idx = eq2Inv.findIndex(it => String(it.id) === String(id));

      if (idx === -1) {
        success = false;
        msg = 'Không tìm thấy trang bị trong hành lý để phân rã!';
      } else {
        const it = eq2Inv[idx];
        const now = Math.floor(Date.now() / 1000);
        const unlocked = (it.ul || 0) > now;

        if (it.c && !unlocked) {
          success = false;
          msg = 'Vật phẩm chế tạo đang khóa bảo vệ. Vui lòng mở khóa trước!';
        } else {
          const goldGain = it.t * 100 + (it.p || 0) * 200;
          const scrapGain = it.t * 4 + (it.p || 0) * 2;

          playerObj.gold = (playerObj.gold || 0) + goldGain;
          playerObj.eq2_scrap = (playerObj.eq2_scrap || 0) + scrapGain;

          eq2Inv.splice(idx, 1);
          msg = `Phân rã thành công! Nhận lại ${goldGain} Gold và ${scrapGain} Scrap`;
        }
      }
    }

    else if (action === 'destroy_multi') {
      const idsParam = req.body.ids;
      let idsArr = [];
      try { idsArr = JSON.parse(idsParam || '[]'); } catch(e) { idsArr = []; }

      let totalGold = 0;
      let totalScrap = 0;
      let destroyedCount = 0;

      const now = Math.floor(Date.now() / 1000);

      idsArr.forEach(id => {
        const idx = eq2Inv.findIndex(it => String(it.id) === String(id));
        if (idx !== -1) {
          const it = eq2Inv[idx];
          const unlocked = (it.ul || 0) > now;
          if (!it.c || unlocked) {
            totalGold += it.t * 100 + (it.p || 0) * 200;
            totalScrap += it.t * 4 + (it.p || 0) * 2;
            eq2Inv.splice(idx, 1);
            destroyedCount++;
          }
        }
      });

      playerObj.gold = (playerObj.gold || 0) + totalGold;
      playerObj.eq2_scrap = (playerObj.eq2_scrap || 0) + totalScrap;
      msg = `Phân rã thành công ${destroyedCount} trang bị, nhận lại ${totalGold} Gold và ${totalScrap} Scrap!`;
    }

    else if (action === 'unlock') {
      const { id } = req.body;
      const idx = eq2Inv.findIndex(it => String(it.id) === String(id));

      if (idx === -1) {
        success = false;
        msg = 'Không tìm thấy trang bị!';
      } else {
        const it = eq2Inv[idx];
        it.ul = Math.floor(Date.now() / 1000) + 300; // Unlocked for 5 mins
        msg = 'Đã mở khóa bảo vệ trang bị (Hiệu lực trong 5 phút)';
      }
    }

    else if (action === 'auto') {
      const { lvl } = req.body;
      eq2._auto = parseInt(lvl) || 0;
      playerObj.eq2 = JSON.stringify(eq2);
      msg = `Đã thiết lập tự động phân rã trang bị T <= ${lvl}`;
    }

    else if (action === 'enhance') {
      const { slot } = req.body;
      const it = eq2[slot];

      if (!it) {
        success = false;
        msg = 'Không tìm thấy trang bị đang đeo để cường hóa!';
      } else {
        const cur = it.p || 0;
        if (cur >= 15) {
          success = false;
          msg = 'Trang bị đã đạt cấp cường hóa tối đa (+15)!';
        } else {
          const to = cur + 1;
          const cost = _eq2EnhCost(to);

          if ((playerObj.gold || 0) < cost.gold ||
              (playerObj.diamond_blue || 0) < cost.blue ||
              (playerObj.diamond_red || 0) < cost.red ||
              (playerObj.diamond_green || 0) < cost.green) {
            success = false;
            msg = 'Không đủ nguyên liệu cường hóa!';
          } else {
            // Deduct
            playerObj.gold -= cost.gold;
            playerObj.diamond_blue -= cost.blue;
            playerObj.diamond_red -= cost.red;
            playerObj.diamond_green -= cost.green;

            const rate = _eq2EnhRate(to);
            const win = Math.random() < rate ? 1 : 0;

            if (win === 1) {
              it.p = to;
              msg = `Chúc mừng! Cường hóa [${slot.toUpperCase()}] thành công lên +${to}!`;
              res.locals.win = 1;
            } else {
              if (cur > 5) {
                it.p = cur - 1;
              } else {
                it.p = cur;
              }
              msg = `Rất tiếc! Cường hóa [${slot.toUpperCase()}] thất bại (giảm xuống +${it.p || 0}).`;
              res.locals.win = 0;
            }
            eq2[slot] = it;
          }
        }
      }
    }

    else if (action === 'equip') {
      const { id, slot } = req.body;
      const idx = eq2Inv.findIndex(it => String(it.id) === String(id));

      if (idx === -1) {
        success = false;
        msg = 'Không tìm thấy trang bị trong hành lý!';
      } else {
        const it = eq2Inv[idx];
        let targetSlot = slot;
        if (!targetSlot) {
          if (it.s === 'ring') {
            if (!eq2.ring1) targetSlot = 'ring1';
            else if (!eq2.ring2) targetSlot = 'ring2';
            else targetSlot = 'ring1'; // Default replacement
          } else {
            targetSlot = it.s;
          }
        }

        // Validate slot target
        const allowed = {
          head: ['head'], body: ['body'], foot: ['foot'], neck: ['neck'],
          ring: ['ring1', 'ring2']
        };

        const kind = it.s;
        if (!allowed[kind] || !allowed[kind].includes(targetSlot)) {
          success = false;
          msg = 'Vị trí trang bị không phù hợp!';
        } else {
          // Swap logic
          const oldWorn = eq2[targetSlot];
          eq2Inv.splice(idx, 1); // remove from inv
          if (oldWorn) {
            eq2Inv.push(oldWorn); // put old worn to inv
          }
          eq2[targetSlot] = it;
          msg = `Đã trang bị thành công!`;
        }
      }
    }

    else if (action === 'unequip') {
      const { slot } = req.body;
      const it = eq2[slot];

      if (!it) {
        success = false;
        msg = 'Không có trang bị nào ở ô này!';
      } else if (eq2Inv.length >= 100) {
        success = false;
        msg = 'Hành lý trang bị đã đầy!';
      } else {
        eq2Inv.push(it);
        delete eq2[slot];
        msg = `Tháo trang bị thành công!`;
      }
    }

    else {
      success = false;
      msg = 'Hành động không hợp lệ!';
    }

    if (!success) {
      return res.json({ ok: false, error: msg });
    }

    // Save back to raw_data
    playerObj.eq2 = JSON.stringify(eq2);
    playerObj.eq2_inv = JSON.stringify(eq2Inv);

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    res.json({
      ok: true,
      player: playerObj,
      msg: msg,
      win: res.locals.win
    });

  } catch (err) {
    console.error("Lỗi trong route EQC", err);
    res.json({ ok: false, error: 'Internal server error' });
  } finally {
    release();
  }
});

module.exports = router;
