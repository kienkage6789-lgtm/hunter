const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

// 1. Nạp spots cache và monster masters cache
let spotsCache = {};
try {
  const spotsPath = path.join(__dirname, '..', '..', 'data', 'spots_cache.json');
  spotsCache = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));
} catch (err) {
  console.error('Lỗi đọc spots_cache.json:', err.message);
}

let monMastersCache = {};
try {
  const monPath = path.join(__dirname, '..', '..', 'data', 'mon_masters_cache.json');
  monMastersCache = JSON.parse(fs.readFileSync(monPath, 'utf8'));
} catch (err) {
  console.error('Lỗi đọc mon_masters_cache.json:', err.message);
}

const ADDITIONAL_SPOTS = {
  3: [
    { name: 'Thung lũng Băng Giá', cx: 1125, cy: 1125, radius: 375, lv_min: 40, lv_max: 45, emoji: '❄️' },
    { name: 'Động Tuyết Sâu', cx: 1850, cy: 1125, radius: 200, lv_min: 46, lv_max: 54, emoji: '❄️' }
  ],
  6: [
    { name: 'Rạn San Hô', cx: 1125, cy: 1125, radius: 375, lv_min: 55, lv_max: 60, emoji: '🌊' },
    { name: 'Hải Vực Tối', cx: 1850, cy: 1125, radius: 200, lv_min: 61, lv_max: 69, emoji: '🌊' }
  ],
  10: [
    { name: 'Lối vào Rừng Rồng', cx: 1125, cy: 1125, radius: 375, lv_min: 70, lv_max: 75, emoji: '🐉' },
    { name: 'Lăng Mộ Cổ', cx: 1850, cy: 1125, radius: 200, lv_min: 76, lv_max: 85, emoji: '🐉' }
  ],
  13: [
    { name: 'Tinh Vân Trung Tâm', cx: 1125, cy: 1125, radius: 375, lv_min: 86, lv_max: 92, emoji: '⭐' },
    { name: 'Hố Đen Vũ Trụ', cx: 1850, cy: 1125, radius: 200, lv_min: 93, lv_max: 99, emoji: '⭐' }
  ]
};

const MAP_DEFS = [
  { map: 1, name: 'Cánh đồng Trung tâm', lv_req: 1 },
  { map: 2, name: 'Sa mạc Nắng Cháy', lv_req: 20 },
  { map: 3, name: 'Thung lũng Băng Giá', lv_req: 40 },
  { map: 5, name: 'Khu Rừng Cấm', lv_req: 50 },
  { map: 6, name: 'Vịnh Biển Sâu', lv_req: 55 },
  { map: 10, name: 'Lãnh địa Rồng', lv_req: 70 },
  { map: 13, name: 'Vùng Đất Tinh Vân', lv_req: 85 }
];

function getSpotsForMap(mapId) {
  const m = parseInt(mapId) || 1;
  return spotsCache[m] || ADDITIONAL_SPOTS[m] || [];
}

function getMonstersForLevelRange(lvMin, lvMax) {
  const mons = [];
  for (const [mid, m] of Object.entries(monMastersCache)) {
    if (m && typeof m.lv === 'number' && m.lv >= lvMin && m.lv <= lvMax) {
      mons.push({ id: parseInt(mid), name: m.n || m.orig_n || 'Quái', emoji: m.e || '👾', lv: m.lv });
    }
  }
  return mons;
}

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

function parseOfflineZones(offlineZones) {
  if (!offlineZones) return [];
  if (Array.isArray(offlineZones)) {
    return offlineZones.map(item => {
      if (typeof item === 'string') {
        const parts = item.split(':');
        return { map: parseInt(parts[0]) || 1, zone: parseInt(parts[1]) || 0 };
      } else if (item && typeof item === 'object') {
        return { map: parseInt(item.map) || 1, zone: parseInt(item.zone) || 0 };
      }
      return null;
    }).filter(Boolean);
  }
  if (typeof offlineZones === 'string') {
    return offlineZones
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(p => {
        const parts = p.split(':');
        return { map: parseInt(parts[0]) || 1, zone: parseInt(parts[1]) || 0 };
      });
  }
  return [];
}

// Lưu trữ phiên Bot Monitor trong RAM
const activeMonitorSessions = new Map();

router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid || !session_token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!userRow) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid session_token' });
    }

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.status(404).json({ ok: false, error: 'Player not found' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    const playerLv = parseInt(playerObj.lv) || parseInt(pRow.lv) || 1;
    const nowSec = Math.floor(Date.now() / 1000);

    // ─────────────────────────────────────────────────────────────
    // 1. ACTION: PREVIEW (Xem trước danh sách map và zone của map)
    // ─────────────────────────────────────────────────────────────
    if (action === 'preview') {
      const mapId = parseInt(req.body.map) || (playerObj.offline_zones_map | 0) || (playerObj.map | 0) || 1;
      const spots = getSpotsForMap(mapId);

      const parsedSelected = parseOfflineZones(playerObj.offline_zones);

      const zonesList = spots.map((s, idx) => {
        const lvLo = s.lv_min || 1;
        const lvHi = s.lv_max || lvLo;
        const unlocked = playerLv >= lvLo;
        const reason = unlocked ? '' : `Cần đạt Lv.${lvLo}`;
        const mons = getMonstersForLevelRange(lvLo, lvHi);
        const monsterNames = mons.map(m => m.name);

        return {
          zone: idx,
          name: s.name || `Khu vực ${idx + 1}`,
          emoji: s.emoji || '📍',
          lv_lo: lvLo,
          lv_hi: lvHi,
          unlocked: unlocked,
          reason: reason,
          monsters: monsterNames.length ? monsterNames : ['Quái vật hoang dã']
        };
      });

      return res.json({
        ok: true,
        map: mapId,
        maps: MAP_DEFS.map(m => ({
          ...m,
          enterable: playerLv >= m.lv_req
        })),
        unlock_lv: playerLv,
        zones: zonesList,
        selected_all: parsedSelected,
        is_default: parsedSelected.length === 0
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. ACTION: SET (Lưu cấu hình zone farm offline)
    // ─────────────────────────────────────────────────────────────
    if (action === 'set') {
      const parsed = parseOfflineZones(req.body.zones);

      if (parsed.length > 3) {
        return res.json({ ok: false, error: 'invalid_zones', msg: 'Chỉ được chọn tối đa 3 zone cho tất cả các bản đồ!' });
      }

      const validPairs = [];
      for (const p of parsed) {
        const mId = p.map;
        const zId = p.zone;

        const mapDef = MAP_DEFS.find(m => m.map === mId);
        if (!mapDef || playerLv < mapDef.lv_req) {
          return res.json({ ok: false, error: 'map_locked', msg: `Bản đồ ${mId} chưa mở khóa cho cấp độ của bạn!` });
        }

        const spots = getSpotsForMap(mId);
        if (zId < 0 || zId >= spots.length) {
          return res.json({ ok: false, error: 'invalid_zone', msg: `Khu vực ${zId} không tồn tại trên bản đồ ${mId}!` });
        }

        validPairs.push({ map: mId, zone: zId });
      }

      playerObj.offline_zones = validPairs.map(v => `${v.map}:${v.zone}`).join(',');
      playerObj.offline_zones_map = parseInt(req.body.map) || (validPairs.length ? validPairs[0].map : 1);

      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(playerObj), line_uid
      );

      return res.json({
        ok: true,
        selected_all: validPairs,
        msg: 'Lưu cấu hình zone farm thành công!'
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. ACTION: MONITOR_SYNC (Bắt đầu / Đồng bộ lát cắt / Kết thúc)
    // ─────────────────────────────────────────────────────────────
    if (action === 'monitor_sync') {
      const isStart = parseInt(req.body.start) === 1;
      const isEnd = parseInt(req.body.end) === 1;

      const configuredPairs = parseOfflineZones(playerObj.offline_zones);

      if (!configuredPairs.length) {
        return res.json({
          ok: true,
          no_zone: true,
          sync_s: 60,
          pull_s: 5,
          zones: [],
          tot: { exp: 0, gold: 0, kills: 0, cards: 0, eggs: 0, mods: 0, bexp: 0, bgold: 0 },
          got: { kills: 0, exp: 0, gold: 0, lv_ups: 0, new_lv: playerLv },
          otbfree: 0
        });
      }

      // Thông tin chi tiết các zone đã chọn
      const zoneDetails = configuredPairs.map(cp => {
        const spots = getSpotsForMap(cp.map);
        const s = spots[cp.zone] || { name: 'Khu vực', emoji: '📍', lv_min: 1, lv_max: 5 };
        return {
          map: cp.map,
          zone: cp.zone,
          name: s.name,
          emoji: s.emoji || '📍',
          lv_min: s.lv_min || 1,
          lv_max: s.lv_max || 5
        };
      });

      const isPremium = (parseInt(playerObj.premium_offline_expires) || 0) > nowSec;
      const maxCapSec = isPremium ? 86400 : 28800; // 24 giờ vs 8 giờ
      const bonusMult = isPremium ? 1.35 : 1.0;

      let session = activeMonitorSessions.get(line_uid);

      if (isStart || !session) {
        session = {
          started_at: nowSec,
          last_sync_at: nowSec,
          tot: { exp: 0, gold: 0, kills: 0, cards: 0, eggs: 0, mods: 0, bexp: 0, bgold: 0 },
          feedQueue: []
        };
        activeMonitorSessions.set(line_uid, session);
      }

      const elapsedSec = Math.min(nowSec - session.last_sync_at, maxCapSec);
      let sliceKills = 0;
      let sliceExp = 0;
      let sliceGold = 0;

      if (elapsedSec > 0) {
        // Tính toán dựa trên quái vật thực tế
        for (const zd of zoneDetails) {
          const avgLv = (zd.lv_min + zd.lv_max) / 2;
          const kpm = Math.max(10, Math.min(20, Math.floor(12 + (playerLv - avgLv) / 5)));
          const zoneKills = Math.floor((elapsedSec / 60) * kpm);
          const zoneExp = Math.floor(zoneKills * Math.max(1, avgLv * 2.5) * bonusMult);
          const zoneGold = Math.floor(zoneKills * Math.max(1, avgLv * 1.5) * bonusMult);

          sliceKills += zoneKills;
          sliceExp += zoneExp;
          sliceGold += zoneGold;

          // Sinh dòng nhật ký feed từ quái thật
          const mons = getMonstersForLevelRange(zd.lv_min, zd.lv_max);
          if (mons.length && zoneKills > 0) {
            const pick = mons[Math.floor(Math.random() * mons.length)];
            session.feedQueue.push({
              k: 1,
              ic: pick.emoji,
              nm: pick.name,
              lv: pick.lv,
              e: Math.max(1, Math.round(pick.lv * 2.5 * bonusMult)),
              g: Math.max(1, Math.round(pick.lv * 1.5 * bonusMult)),
              be: 0,
              bg: 0
            });
          }
        }

        session.tot.kills += sliceKills;
        session.tot.exp += sliceExp;
        session.tot.gold += sliceGold;
        session.last_sync_at = nowSec;
      }

      let lvUps = 0;
      let currentLv = playerLv;

      if (isEnd) {
        // Cộng dồn toàn bộ phần thưởng vào player
        let totalExp = (playerObj.exp || 0) + session.tot.exp;
        let totalGold = (playerObj.gold || 0) + session.tot.gold;

        while (currentLv < 99) {
          const need = expNextHero(currentLv);
          if (totalExp >= need) {
            totalExp -= need;
            currentLv++;
            lvUps++;
          } else {
            break;
          }
        }

        playerObj.exp = totalExp;
        playerObj.gold = totalGold;
        playerObj.lv = currentLv;
        pRow.exp = totalExp;
        pRow.gold = totalGold;
        pRow.lv = currentLv;

        db.prepare('UPDATE players SET exp = ?, gold = ?, lv = ?, raw_data = ? WHERE line_uid = ?').run(
          totalExp, totalGold, currentLv, JSON.stringify(playerObj), line_uid
        );

        activeMonitorSessions.delete(line_uid);
      }

      return res.json({
        ok: true,
        no_zone: false,
        sync_s: 60,
        pull_s: 5,
        zones: zoneDetails,
        tot: session.tot,
        got: {
          kills: sliceKills,
          exp: sliceExp,
          gold: sliceGold,
          lv_ups: lvUps,
          new_lv: currentLv
        },
        otbfree: 0
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ACTION: FEED_PULL (Lấy feed log chiến đấu từ hàng đợi RAM)
    // ─────────────────────────────────────────────────────────────
    if (action === 'feed_pull') {
      const session = activeMonitorSessions.get(line_uid);
      const lines = session ? session.feedQueue.splice(0, 10) : [];
      return res.json({
        ok: true,
        lines: lines
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. ACTION: IDLESTAT (Nhịp check-in an toàn, không kích hoạt offline)
    // ─────────────────────────────────────────────────────────────
    if (action === 'idlestat') {
      return res.json({
        ok: true,
        ci: 0
      });
    }

    return res.json({ ok: false, error: 'Unknown offline action' });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi offline farming route:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi máy chủ offline farming: ' + (err.message || 'Lỗi hệ thống') });
  } finally {
    release();
  }
});

module.exports = router;
