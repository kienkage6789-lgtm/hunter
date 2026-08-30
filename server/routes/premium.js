const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

const SKIN_DEFS = [
  { key: 'char2', name: 'Rex', price: 249 },
  { key: 'char3', name: 'Tank', price: 279 },
  { key: 'marty', name: 'มาตี้', price: 299 },
  { key: 'jasmatha', name: 'จัสมาท่า', price: 329 },
  { key: 'ameoai', name: 'อามเมออาย', price: 349 },
  { key: 'montana', name: 'มอนทาน่า', price: 399 },
  { key: 'destroyer', name: 'Zero', price: 189, disabled: true },
  { key: 'infantry', name: 'Sarge', price: 189, disabled: true },
  { key: 'mecha1', name: 'Titan', price: 199, disabled: true },
  { key: 'mecha2', name: 'Fang', price: 199, disabled: true },
  { key: 'mecha3', name: 'Hunter', price: 199, disabled: true },
  { key: 'swordsman', name: 'Blade', price: 209, disabled: true },
  { key: 'kowel', name: 'โคเวล', price: 499 },
  { key: 'eyeflyer', name: 'eyeflyer', price: 599 },
  { key: 'turrus', name: 'Turrus', price: 999 },
  { key: 'dinosung', name: 'dinosung', price: 1999 },
  { key: 'tarex', name: 'Tarex', price: 3499 }
];

const HERO_SKIN_DEFS = [
  { key: 'sw2', name: 'นักรบพเนจร', price: 149 },
  { key: 'sw3', name: 'นักรบรับจ้าง', price: 249 },
  { key: 'sw4', name: 'อัศวิน', price: 349 },
  { key: 'sw5', name: 'อัศวินเหล็ก', price: 749 },
  { key: 'sw6', name: 'อัศวินเหล็กราชา', price: 949 },
  { key: 'sw7', name: 'ผู้กล้า', price: 1499 },
  { key: 'sw8', name: 'ผู้กล้าระดับสูง', price: 2499 },
  { key: 'sw9', name: 'ผู้กล้าในตำนาน', price: 3499 },
  { key: 'hs01', name: 'นักสู้เพลิง', price: 449 },
  { key: 'hs09', name: 'นักดวลซากุระ', price: 649 },
  { key: 'hs11', name: 'โรนินเหล็ก', price: 849 },
  { key: 'hs07', name: 'ดาบเลือด', price: 949 },
  { key: 'hs03', name: 'นินจาเงา', price: 1199 },
  { key: 'hs08', name: 'นักบวชน้ำแข็ง', price: 1399 },
  { key: 'hs06', name: 'อัศวินเขี้ยว', price: 1599 },
  { key: 'hs02', name: 'ซามูไรพเนจร', price: 1799 },
  { key: 'hs12', name: 'นักรบดาบคู่', price: 1899 },
  { key: 'hs10', name: 'นักฆ่าคลุมหัว', price: 3299 },
  { key: 'hs05', name: 'นักเวทแมวราตรี', price: 3399 },
  { key: 'hs04', name: 'จิ้งจอกคลั่ง', price: 3499 }
];

const PET_SKIN_DEFS = [
  { key: 'dog_black', name: 'ดำ', price: 149 },
  { key: 'cat_ginger', name: 'ทองแดง', price: 149 },
  { key: 'cat_navy', name: 'นาคี', price: 149 },
  { key: 'rat_brown', name: 'จี๊ด', price: 149 },
  { key: 'rat_navy', name: 'เงา', price: 149 },
  { key: 'bird_blue', name: 'ปีกฟ้า', price: 149 },
  { key: 'bird_teal', name: 'จิ๊บ', price: 149 },
  { key: 'cat_cream', name: 'ครีม', price: 299 },
  { key: 'wolf_brown', name: 'โลโบ', price: 399 },
  { key: 'rat_grey', name: 'แซะ', price: 499 },
  { key: 'cat_brown', name: 'ช็อกโก', price: 599 },
  { key: 'wolf_black', name: 'แบล็ค', price: 699 },
  { key: 'hamster_cream', name: 'นุ่น', price: 999 },
  { key: 'linhui', name: 'หลินฮุ่ย', price: 3499 },
  { key: 'bee', name: 'บัมเบิ้ล', price: 199 },
  { key: 'hedgehog', name: 'หนามเตย', price: 299 },
  { key: 'snail', name: 'สลัก', price: 399 },
  { key: 'crab', name: 'ก้ามปู', price: 499 },
  { key: 'bluebird', name: 'ฟ้าคราม', price: 699 },
  { key: 'turtle', name: 'กระดองเขียว', price: 899 },
  { key: 'fmon2', name: 'ขนเขียว', price: 1199 },
  { key: 'fmon4', name: 'ขนส้ม', price: 1499 },
  { key: 'fmon1', name: 'ปีกม่วง', price: 1899 },
  { key: 'fmon3', name: 'ปีกน้ำตาล', price: 2299 },
  { key: 'mon3', name: 'เขาทอง', price: 2499 },
  { key: 'mon2', name: 'ขนแดง', price: 2999 },
  { key: 'mon1', name: 'ฟันเขียว', price: 3499 }
];

const PREMIUM_ITEMS = {
  np: { price: 65, field: 'premium_np_expires', maxLv: 60 },
  pk: { price: 99, field: 'premium_pk_expires' },
  pro: { price: 199, field: 'premium_pro_expires' },
  offline: { price: 99, field: 'premium_offline_expires' },
  exp: { price: 35, field: 'premium_exp_expires' },
  drop: { price: 199, field: 'premium_drop_expires', disabled: true },
  gold: { price: 35, field: 'premium_gold_expires' },
  miner: { price: 69, field: 'premium_miner_expires' },
  drone_delivery: { price: 49, field: 'drone_expires', disabled: true },
  robot_railgun: { price: 39, field: 'robot_railgun_expires' },
  orion_gun: { price: 79, field: 'orion_gun_expires' },
  priest: { price: 149, field: 'priest_expires' },
  archer: { price: 149, field: 'archer_expires' },
  knight: { price: 149, field: 'knight_expires' },
};

const SKIN_LV_TABLE = [
  [1, 0, 0], [2, 100, 10], [3, 1000, 15], [4, 2000, 20], [5, 3000, 25],
  [6, 5000, 30], [7, 10000, 35], [8, 20000, 40], [9, 40000, 45], [10, 80000, 50],
];

function getSkinStatForXp(xp) {
  let s = 0;
  for (const r of SKIN_LV_TABLE) {
    if (xp >= r[1]) s = r[2];
  }
  return s;
}

function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function getSkinXp(ownedList, defs, statsRaw) {
  const own = parseJSON(ownedList, []);
  let sum = 0;
  own.forEach(k => {
    const d = defs.find(x => x.key === k);
    if (d) sum += d.price | 0;
  });
  const m = parseJSON(statsRaw, {});
  const g = m ? m._g : null;
  return Math.max(sum, g ? (+(g.xp || 0)) : 0);
}

function getSkinCap(ownedList, defs, statsRaw) {
  const m = parseJSON(statsRaw, {});
  const g = m ? m._g : null;
  const best = g ? Math.max(+(g.b || 0), +(g.v || 0)) : 0;
  const xp = getSkinXp(ownedList, defs, statsRaw);
  return Math.max(getSkinStatForXp(xp), best);
}

function getPickPrice(statsRaw) {
  const m = parseJSON(statsRaw, {});
  const g = m ? m._g : null;
  return (g && g.s && g.v) ? 19 : 0;
}

router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!userRow) {
      return res.json({ ok: false, error: 'Unauthorized: Invalid session_token' });
    }

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

    // Đảm bảo các field cần thiết tồn tại
    playerObj.p_points = playerObj.p_points || 0;
    playerObj.p_spend_total = playerObj.p_spend_total || 0;
    playerObj.p_total = playerObj.p_total || 0;

    switch (action) {
      case 'buy': {
        const { item } = req.body;
        if (!item) return res.json({ ok: false, error: 'Missing item' });
        
        const itemDef = PREMIUM_ITEMS[item];
        if (!itemDef) return res.json({ ok: false, error: 'Invalid premium item' });
        if (itemDef.disabled) return res.json({ ok: false, error: 'Mục này đã dừng bán!' });
        
        if (itemDef.maxLv !== undefined && (playerObj.lv || 1) > itemDef.maxLv) {
          return res.json({ ok: false, error: `Chỉ mua được khi cấp độ dưới hoặc bằng ${itemDef.maxLv}!` });
        }

        if (playerObj.p_points < itemDef.price) {
          return res.json({ ok: false, error: 'Không đủ P Point!' });
        }

        playerObj.p_points -= itemDef.price;
        playerObj.p_spend_total += itemDef.price;

        const field = itemDef.field;
        const now = Math.floor(Date.now() / 1000);
        const currentExpiry = playerObj[field] || 0;
        const baseTime = Math.max(now, currentExpiry);
        playerObj[field] = baseTime + 10 * 86400; // Cộng dồn 10 ngày

        db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
          JSON.stringify(playerObj), line_uid
        );

        return res.json({ ok: true, player: playerObj, msg: 'Mua thành công!' });
      }

      case 'stat_reset': {
        const bStr = playerObj.str || 5;
        const bAgi = playerObj.agi || 5;
        const bVit = playerObj.vit || 5;
        const bDex = playerObj.dex || 5;
        const bInt = playerObj.intel || 5;
        const bLuk = playerObj.luk || 5;
        const spentStats = (bStr + bAgi + bVit + bDex + bInt + bLuk) - 30;

        let spentSkillPts = 0;
        try {
          const _skRaw = playerObj.skills;
          const _skObj = (_skRaw && typeof _skRaw === 'object') ? _skRaw : JSON.parse(_skRaw || '{}');
          spentSkillPts = Object.values(_skObj || {}).reduce((a, b) => a + (parseInt(b) || 0), 0);
        } catch (e) {
          spentSkillPts = 0;
        }

        const hasSpent = spentStats > 0 || spentSkillPts > 0;
        if (!hasSpent) {
          return res.json({ ok: false, error: 'Bạn chưa cộng điểm Stats hoặc Skills nào để reset!' });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartSec = Math.floor(todayStart.getTime() / 1000);
        const isFree = (playerObj.stat_reset_last || 0) < todayStartSec;

        if (!isFree) {
          if (playerObj.p_points < 29) {
            return res.json({ ok: false, error: 'Không đủ P Point! Cần 29 P để reset lần tiếp theo.' });
          }
          playerObj.p_points -= 29;
          playerObj.p_spend_total += 29;
        }

        playerObj.stat_reset_last = Math.floor(Date.now() / 1000);
        playerObj.stat_pts = (playerObj.stat_pts || 0) + spentStats;
        playerObj.str = 5;
        playerObj.agi = 5;
        playerObj.vit = 5;
        playerObj.dex = 5;
        playerObj.intel = 5;
        playerObj.luk = 5;

        playerObj.skill_pts = (playerObj.skill_pts || 0) + spentSkillPts;
        playerObj.skills = '{}';

        db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
          JSON.stringify(playerObj), line_uid
        );

        return res.json({ ok: true, player: playerObj, msg: isFree ? 'Reset thành công (miễn phí)!' : 'Reset thành công (tiêu tốn 29P)!' });
      }

      case 'rag_reset': {
        if ((playerObj.lv || 1) < 50) {
          return res.json({ ok: false, error: 'Chỉ hỗ trợ Reset Ragnalok khi đạt cấp 50 trở lên!' });
        }

        const _rrSpent = ['hp', 'mp', 'atk', 'crit', 'def', 'armor'].reduce(
          (s, k) => s + Math.max(0, parseInt(playerObj['rag_' + k]) || 0), 0
        );

        if (_rrSpent <= 0) {
          return res.json({ ok: false, error: 'Bạn chưa cộng điểm Ragnalok nào để reset!' });
        }

        if (playerObj.p_points < 49) {
          return res.json({ ok: false, error: 'Không đủ P Point! Cần 49 P.' });
        }

        playerObj.p_points -= 49;
        playerObj.p_spend_total += 49;

        playerObj.rag_pts = (playerObj.rag_pts || 0) + _rrSpent;
        playerObj.rag_hp = 0;
        playerObj.rag_mp = 0;
        playerObj.rag_atk = 0;
        playerObj.rag_crit = 0;
        playerObj.rag_def = 0;
        playerObj.rag_armor = 0;

        db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
          JSON.stringify(playerObj), line_uid
        );

        return res.json({ ok: true, player: playerObj, msg: 'Reset Ragnalok thành công!' });
      }

      // ── MUA SKIN ──
      case 'buy_skin':
      case 'buy_hero_skin':
      case 'buy_pet_skin': {
        const { skin } = req.body;
        if (!skin) return res.json({ ok: false, error: 'Missing skin key' });

        let defs, listField, eqField;
        if (action === 'buy_skin') {
          defs = SKIN_DEFS;
          listField = 'robot_skins';
          eqField = 'robot_skin';
        } else if (action === 'buy_hero_skin') {
          defs = HERO_SKIN_DEFS;
          listField = 'hero_skins';
          eqField = 'hero_skin';
        } else {
          defs = PET_SKIN_DEFS;
          listField = 'pet_skins';
          eqField = 'pet_skin';
        }

        const skinDef = defs.find(d => d.key === skin);
        if (!skinDef) return res.json({ ok: false, error: 'Skin không tồn tại!' });
        if (skinDef.disabled) return res.json({ ok: false, error: 'Trang phục này đã dừng bán!' });

        let ownedList = parseJSON(playerObj[listField], []);
        if (ownedList.includes(skin)) {
          return res.json({ ok: false, error: 'Bạn đã sở hữu trang phục này rồi!' });
        }

        if (playerObj.p_points < skinDef.price) {
          return res.json({ ok: false, error: 'Không đủ P Point!' });
        }

        playerObj.p_points -= skinDef.price;
        playerObj.p_spend_total += skinDef.price;
        
        ownedList.push(skin);
        playerObj[listField] = JSON.stringify(ownedList);
        playerObj[eqField] = skin;

        db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
          JSON.stringify(playerObj), line_uid
        );

        return res.json({ ok: true, player: playerObj, msg: `Đã mua thành công trang phục ${skinDef.name}!` });
      }

      // ── TRANG BỊ/THÁO SKIN ──
      case 'set_skin':
      case 'set_hero_skin':
      case 'set_pet_skin': {
        const { skin } = req.body;
        
        let listField, eqField;
        if (action === 'set_skin') {
          listField = 'robot_skins';
          eqField = 'robot_skin';
        } else if (action === 'set_hero_skin') {
          listField = 'hero_skins';
          eqField = 'hero_skin';
        } else {
          listField = 'pet_skins';
          eqField = 'pet_skin';
        }

        if (!skin) {
          // Tháo skin về mặc định
          playerObj[eqField] = '';
          db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
            JSON.stringify(playerObj), line_uid
          );
          return res.json({ ok: true, player: playerObj, msg: 'Đã tháo skin!' });
        }

        const ownedList = parseJSON(playerObj[listField], []);
        if (!ownedList.includes(skin)) {
          return res.json({ ok: false, error: 'Bạn chưa sở hữu trang phục này!' });
        }

        playerObj[eqField] = skin;

        db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
          JSON.stringify(playerObj), line_uid
        );

        return res.json({ ok: true, player: playerObj, msg: 'Thay đổi trang phục thành công!' });
      }

      // ── CHỌN STAT CHO SKIN ──
      case 'reroll_skin':
      case 'reroll_hero_skin':
      case 'reroll_pet_skin': {
        const { stat } = req.body;
        if (!stat || !['str', 'agi', 'vit', 'dex', 'intel', 'luk'].includes(stat)) {
          return res.json({ ok: false, error: 'Chỉ số lựa chọn không hợp lệ!' });
        }

        let defs, listField, statsField;
        if (action === 'reroll_skin') {
          defs = SKIN_DEFS;
          listField = 'robot_skins';
          statsField = 'robot_skin_stats';
        } else if (action === 'reroll_hero_skin') {
          defs = HERO_SKIN_DEFS;
          listField = 'hero_skins';
          statsField = 'hero_skin_stats';
        } else {
          defs = PET_SKIN_DEFS;
          listField = 'pet_skins';
          statsField = 'pet_skin_stats';
        }

        const ownedList = parseJSON(playerObj[listField], []);
        const cap = getSkinCap(ownedList, defs, playerObj[statsField]);
        if (cap <= 0) {
          return res.json({ ok: false, error: 'Bạn cần sở hữu ít nhất 1 skin trong hạng mục này trước!' });
        }

        const price = getPickPrice(playerObj[statsField]);
        if (price > 0 && playerObj.p_points < price) {
          return res.json({ ok: false, error: 'Không đủ P Point!' });
        }

        if (price > 0) {
          playerObj.p_points -= price;
          playerObj.p_spend_total += price;
        }

        const xp = getSkinXp(ownedList, defs, playerObj[statsField]);
        const statsObj = parseJSON(playerObj[statsField], {});
        statsObj._g = { s: stat, v: cap, b: cap, xp: xp };
        playerObj[statsField] = JSON.stringify(statsObj);

        db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
          JSON.stringify(playerObj), line_uid
        );

        return res.json({
          ok: true,
          player: playerObj,
          roll: { s: stat, v: cap },
          msg: price > 0 ? 'Thiết lập STAT thành công (tiêu tốn 19P)!' : 'Thiết lập STAT thành công (miễn phí)!'
        });
      }

      default:
        return res.json({ ok: false, error: `Hành động ${action} chưa được hỗ trợ!` });
    }
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi xử lý Premium Shop:', err);
    return res.json({ ok: false, error: 'Lỗi hệ thống máy chủ: ' + (err.message || 'Lỗi không xác định') });
  } finally {
    release();
  }
});

module.exports = router;
