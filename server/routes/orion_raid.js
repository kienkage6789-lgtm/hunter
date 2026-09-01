/**
 * server/routes/orion_raid.js
 * 
 * SERVER-AUTHORITATIVE ORION GUNSHIP SPACE EXPEDITION ROUTE
 * Endpoint: POST /xhrpg_orion_raid.php
 * 
 * Tính năng thám hiểm không gian vũ trụ bằng phi thuyền Orion (Orion Space Raid / Expedition):
 * - Auth: Bắt buộc line_uid + session_token hợp lệ (HTTP 401 nếu thiếu/sai).
 * - 3 Tiers thám hiểm (theo client/xhrpg_canvas.js:21387-21391):
 *     Tier 1: 8h (28.800s), yêu cầu house_lv >= 30, icon '🌙', 'วงโคจรดวงจันทร์' (Moon Orbit)
 *     Tier 2: 16h (57.600s), yêu cầu house_lv >= 60, icon '☄️', 'แถบดาวเคราะห์น้อย' (Asteroid Belt)
 *     Tier 3: 24h (86.400s), yêu cầu house_lv >= 90, icon '🌌', 'ห้วงอวกาศลึก' (Deep Space)
 * - Daily Quota: 1 chuyến/ngày theo giờ UTC+7, reset 00:00:00 (free_left: 1).
 * - Rush: Dùng Point P để kết thúc tức thì, chi phí = Math.max(1, Math.ceil(leftSec / 3600) * 1P).
 * - Kết toán (Settlement): Tỷ lệ thành công cơ bản 50% (RND.oraid = 50%).
 *     Thành công: oraid_done = { success: true, tier, log: [...] }
 *     Thất bại: oraid_done = { success: false, tier, log: [...], cons: { stone, iron, copper } }
 * - Mutex lock per-user (acquireLock), JSON DB atomic persistence, Idempotency cache & rollback.
 */

const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

// =========================================================================
// CẤU HÌNH TIERS & HẰNG SỐ CHUẨN
// =========================================================================
const ORAID_TIERS = [
  { t: 1, h: 8, sec: 8 * 3600, lv: 30, ic: '🌙', nm: 'วงโคจรดวงจันทร์' },
  { t: 2, h: 16, sec: 16 * 3600, lv: 60, ic: '☄️', nm: 'แถบดาวเคราะห์น้อย' },
  { t: 3, h: 24, sec: 24 * 3600, lv: 90, ic: '🌌', nm: 'ห้วงอวกาศลึก' }
];

const SUCCESS_RATE = 50; // 50%
const PPH = 1; // 1 Point P per hour

// Idempotency cache cho retry requests
const oraidIdempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 120 * 1000;

function cleanIdempotencyCache() {
  const now = Date.now();
  for (const [key, entry] of oraidIdempotencyCache.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      oraidIdempotencyCache.delete(key);
    }
  }
}

// =========================================================================
// THỜI GIAN & CANONICAL TIMEZONE (UTC+7)
// =========================================================================
function getNowEpochSec() {
  return Math.floor(Date.now() / 1000);
}

function getTodayStrUtc7() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// =========================================================================
// DB SERIALIZATION HELPERS
// =========================================================================
function unpackPlayer(pRow) {
  let player = {};
  if (pRow && pRow.raw_data) {
    try {
      player = JSON.parse(pRow.raw_data);
    } catch (e) {
      player = Object.assign({}, pRow);
    }
  } else {
    player = Object.assign({}, pRow || {});
  }
  if (pRow && pRow.gold !== undefined) player.gold = pRow.gold;
  if (pRow && pRow.lv !== undefined) player.lv = pRow.lv;
  player.line_uid = pRow ? pRow.line_uid : player.line_uid;
  player.p_points = parseInt(player.p_points, 10) || 0;
  player.gold = parseInt(player.gold, 10) || 0;
  player.house_lv = parseInt(player.house_lv, 10) || 0;
  player.stone = parseInt(player.stone, 10) || 0;
  player.iron = parseInt(player.iron, 10) || 0;
  player.copper = parseInt(player.copper, 10) || 0;
  return player;
}

function savePlayer(pRow, playerObj) {
  pRow.gold = playerObj.gold;
  pRow.p_points = playerObj.p_points;
  pRow.house_lv = playerObj.house_lv;
  pRow.stone = playerObj.stone;
  pRow.iron = playerObj.iron;
  pRow.copper = playerObj.copper;
  pRow.raw_data = JSON.stringify(playerObj);
}

// =========================================================================
// BUSINESS LOGIC: HẠN NGẠCH NGÀY & KẾT TOÁN THÁM HIỂM
// =========================================================================
function getDailyFreeLeft(player) {
  const todayStr = getTodayStrUtc7();
  if (!player.oraid_daily || player.oraid_daily.date !== todayStr) {
    return 1;
  }
  return Math.max(0, 1 - (parseInt(player.oraid_daily.count, 10) || 0));
}

function calculateRushCost(activeRaid, nowSec) {
  if (!activeRaid || !activeRaid.end_at) return 0;
  const leftSec = Math.max(0, activeRaid.end_at - nowSec);
  if (leftSec <= 0) return 0;
  const leftHours = Math.ceil(leftSec / 3600);
  return Math.max(1, leftHours * PPH);
}

function settleOrionExpedition(player, nowSec) {
  if (!player.orion_raid) return null;
  const tierNum = parseInt(player.orion_raid.tier, 10) || 1;
  const tierCfg = ORAID_TIERS.find((x) => x.t === tierNum) || ORAID_TIERS[0];

  // 50% RNG Thành công
  const isSuccess = Math.random() * 100 < SUCCESS_RATE;

  if (isSuccess) {
    player.oraid_done = {
      success: true,
      tier: tierNum,
      log: [
        '🌌 ภารกิจอวกาศสำเร็จ!',
        `ยาน Orion สำรวจ ${tierCfg.nm} สำเร็จและนำแร่อวกาศกลับมาอย่างปลอดภัย`
      ]
    };
  } else {
    // Thất bại: Trao khoáng sản an ủi stone, iron, copper
    const stoneQty = Math.floor(Math.random() * 1500) + 500;
    const ironQty = Math.floor(Math.random() * 800) + 200;
    const copperQty = Math.floor(Math.random() * 400) + 100;

    player.stone = (parseInt(player.stone, 10) || 0) + stoneQty;
    player.iron = (parseInt(player.iron, 10) || 0) + ironQty;
    player.copper = (parseInt(player.copper, 10) || 0) + copperQty;

    player.oraid_done = {
      success: false,
      tier: tierNum,
      log: [
        '🪨 ภารกิจอวกาศล้มเหลว',
        'ยานพบพายุสุริยะ ได้เพียงแร่พื้นฐานกลับมา'
      ],
      cons: {
        stone: stoneQty,
        iron: ironQty,
        copper: copperQty
      }
    };
  }

  // Xóa trạng thái chuyến đi đang hoạt động
  player.orion_raid = null;
  return player.oraid_done;
}

// =========================================================================
// MAIN ROUTER
// =========================================================================
router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body || {};

  // 1. Xác thực auth line_uid + session_token
  if (!line_uid || !session_token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  db.load();
  const user = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid session_token' });
  }

  const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
  if (!pRow) {
    return res.status(404).json({ ok: false, error: 'Player not found' });
  }

  const releaseLock = await acquireLock(line_uid);
  cleanIdempotencyCache();

  try {
    db.load();
    const freshPRow = (db.data.players || []).find((p) => p.line_uid === line_uid);
    if (!freshPRow) return res.status(404).json({ ok: false, error: 'Player not found' });
    const player = unpackPlayer(freshPRow);
    const nowSec = getNowEpochSec();

    // Tự động kết toán nếu có chuyến đi đã hết giờ
    if (player.orion_raid && nowSec >= player.orion_raid.end_at) {
      settleOrionExpedition(player, nowSec);
      savePlayer(freshPRow, player);
      db.save();
    }

    // =========================================================================
    // ACTION: INFO — Xem trạng thái thám hiểm & chi phí tăng tốc
    // =========================================================================
    if (action === 'info' || !action) {
      const freeLeft = getDailyFreeLeft(player);
      const rushP = calculateRushCost(player.orion_raid, nowSec);

      return res.json({
        ok: true,
        free_left: freeLeft,
        rush_p: rushP,
        pph: PPH,
        rate: SUCCESS_RATE,
        active: player.orion_raid || null
      });
    }

    // =========================================================================
    // ACTION: SEND — Phái phi thuyền Orion đi thám hiểm
    // =========================================================================
    if (action === 'send') {
      // Idempotency check
      const customIdemKey = req.body.idempotency_key || req.body.req_id;
      const idemKey = customIdemKey ? `send:${line_uid}:${customIdemKey}` : null;
      if (idemKey && oraidIdempotencyCache.has(idemKey)) {
        return res.json(oraidIdempotencyCache.get(idemKey).response);
      }

      // Kiểm tra chuyến đi đang hoạt động
      if (player.orion_raid) {
        return res.json({ ok: false, error: 'Phi thuyền Orion đang trong chuyến thám hiểm' });
      }

      // Kiểm tra hạn ngạch ngày
      const freeLeft = getDailyFreeLeft(player);
      if (freeLeft <= 0) {
        return res.json({ ok: false, error: 'Hôm nay bạn đã phái phi thuyền đi rồi (tối đa 1 lần/ngày)' });
      }

      // Validate tier
      if (req.body.tier === undefined || req.body.tier === null) {
        return res.json({ ok: false, error: 'Thiếu thông tin cấp độ thám hiểm (tier)' });
      }
      const tierNum = Number(req.body.tier);
      if (!Number.isInteger(tierNum) || tierNum < 1 || tierNum > 3) {
        return res.json({ ok: false, error: 'Cấp độ thám hiểm (tier) không hợp lệ (phải là 1, 2 hoặc 3)' });
      }

      const tierCfg = ORAID_TIERS[tierNum - 1];
      const shipLv = player.house_lv;

      // Kiểm tra cấp phi thuyền
      if (shipLv < tierCfg.lv) {
        return res.json({ ok: false, error: `Cấp phi thuyền không đủ (yêu cầu Lv.${tierCfg.lv}, hiện có Lv.${shipLv})` });
      }

      // Khởi tạo chuyến đi
      const startSec = nowSec;
      const endAtSec = nowSec + tierCfg.sec;

      player.orion_raid = {
        tier: tierNum,
        start: startSec,
        end_at: endAtSec
      };

      // Đánh dấu hạn ngạch ngày
      player.oraid_daily = {
        date: getTodayStrUtc7(),
        count: 1
      };

      savePlayer(freshPRow, player);
      db.save();

      const successRes = {
        ok: true,
        end_at: endAtSec,
        msg: `Phái phi thuyền Orion thám hiểm [${tierCfg.nm}] thành công!`
      };

      if (idemKey) {
        oraidIdempotencyCache.set(idemKey, { timestamp: Date.now(), response: successRes });
      }

      return res.json(successRes);
    }

    // =========================================================================
    // ACTION: RUSH — Tăng tốc chuyến đi bằng Point P
    // =========================================================================
    if (action === 'rush') {
      // Idempotency check
      const customIdemKey = req.body.idempotency_key || req.body.req_id;
      const idemKey = customIdemKey ? `rush:${line_uid}:${customIdemKey}` : null;
      if (idemKey && oraidIdempotencyCache.has(idemKey)) {
        return res.json(oraidIdempotencyCache.get(idemKey).response);
      }

      if (!player.orion_raid) {
        return res.json({ ok: false, error: 'Hiện không có chuyến thám hiểm nào đang hoạt động' });
      }

      const rushCost = calculateRushCost(player.orion_raid, nowSec);

      // Nếu còn thời gian thì phải trả Point P
      if (rushCost > 0) {
        if (player.p_points < rushCost) {
          return res.json({ ok: false, error: `Bạn không đủ điểm P để tăng tốc (cần ${rushCost} P, hiện có ${player.p_points} P)` });
        }
        player.p_points -= rushCost;
      }

      // Kết toán tức thì
      const doneResult = settleOrionExpedition(player, nowSec);

      savePlayer(freshPRow, player);
      db.save();

      const successRes = {
        ok: true,
        msg: 'Tăng tốc thành công! Phi thuyền đã trở về an toàn.',
        p_points: player.p_points,
        oraid_done: doneResult
      };

      if (idemKey) {
        oraidIdempotencyCache.set(idemKey, { timestamp: Date.now(), response: successRes });
      }

      return res.json(successRes);
    }

    return res.json({ ok: false, error: 'Hành động không hợp lệ' });
  } catch (err) {
    console.error('[OrionRaid] Lỗi xử lý:', err);
    db.load(); // Rollback snapshot
    return res.status(500).json({ ok: false, error: 'Lỗi hệ thống khi xử lý thám hiểm không gian' });
  } finally {
    releaseLock();
  }
});

module.exports = router;
module.exports.router = router;
module.exports.settleOrionExpedition = settleOrionExpedition;
