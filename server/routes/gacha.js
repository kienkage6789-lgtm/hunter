/**
 * server/routes/gacha.js
 * Server-authoritative Gacha System (TASK-042)
 * 
 * Hỗ trợ các action:
 * - 'info': Lấy thông tin lượt quay hàng ngày, quota, level, next_cost, base gold
 * - 'spin': Thực hiện quay vòng quay may mắn đổi P sang G (authoritative RNG, idempotency, mutex lock)
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../db/queries');

const router = express.Router();

// =========================================================================
// HẰNG SỐ CƠ BẢN VÀ CÔNG THỨC GACHA (CHUẨN COMPLIANCE & CLIENT MIRROR)
// =========================================================================
const GACHA_MAX_DAILY = 10;
const GACHA_COST_LADDER = [0, 10, 10, 15, 15, 15, 20, 20, 20, 25]; // Phù hợp với GACHA_TIER_CLR trên client
const GACHA_BASE_UNIT = 200; // Gold cơ bản = lv * 200 (theo RND.gachaBase = 200)
const GACHA_WEIGHTS = [50, 20, 18, 10, 5, 2]; // Trọng số nhân ×1..×6 (theo RND.gachaW)
const GACHA_MULTIPLIERS = [1, 2, 3, 4, 5, 6];
const GACHA_TOTAL_WEIGHT = GACHA_WEIGHTS.reduce((a, b) => a + b, 0); // 105

// In-memory idempotency cache: key -> { result, timestamp }
const idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Per-user async mutex locks to serialize concurrent requests
const userLocks = new Map();

async function acquireUserLock(uid) {
  while (userLocks.has(uid)) {
    await userLocks.get(uid);
  }
  let resolveLock;
  const promise = new Promise((resolve) => { resolveLock = resolve; });
  userLocks.set(uid, promise);
  return () => {
    userLocks.delete(uid);
    resolveLock();
  };
}

/**
 * Trả về ngày theo múi giờ UTC+7 (đồng bộ với reset 00:00 toàn bộ server)
 */
function getTodayString() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const tzOffset = 7 * 3600000;
  const d = new Date(utc + tzOffset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Thuật toán CSPRNG chọn hệ số trúng thưởng theo trọng số
 */
function pickMultiplier() {
  const rand = crypto.randomInt(0, GACHA_TOTAL_WEIGHT);
  let accum = 0;
  for (let i = 0; i < GACHA_WEIGHTS.length; i++) {
    accum += GACHA_WEIGHTS[i];
    if (rand < accum) {
      return GACHA_MULTIPLIERS[i];
    }
  }
  return 1;
}

function cleanIdempotencyStore() {
  const now = Date.now();
  for (const [k, v] of idempotencyStore.entries()) {
    if (now - v.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(k);
    }
  }
}

/**
 * Helper trích xuất playerObj đầy đủ từ pRow và raw_data
 */
function unpackPlayer(pRow) {
  let player = {};
  if (pRow.raw_data) {
    try {
      player = JSON.parse(pRow.raw_data);
    } catch (e) {
      player = Object.assign({}, pRow);
    }
  } else {
    player = Object.assign({}, pRow);
  }
  if (pRow.gold !== undefined) player.gold = pRow.gold;
  if (pRow.lv !== undefined) player.lv = pRow.lv;
  if (pRow.exp !== undefined) player.exp = pRow.exp;
  if (pRow.map !== undefined) player.map = pRow.map;
  player.line_uid = pRow.line_uid;
  player.p_points = parseInt(player.p_points) || 0;
  return player;
}

// Router xử lý cả route gốc '/' khi mount tại /xhrpg_gacha.php và '/xhrpg_gacha.php'
router.post(['/', '/xhrpg_gacha.php'], async (req, res) => {
  const { line_uid, session_token, action } = req.body || {};

  // 1. Xác thực bảo mật: line_uid & session_token
  if (!line_uid || !session_token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: missing credentials' });
  }

  db.load();
  const user = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: invalid session token' });
  }

  let pRow = (db.data.players || []).find((p) => p.line_uid === line_uid);
  if (!pRow) {
    return res.status(404).json({ ok: false, error: 'Player not found' });
  }

  let player = unpackPlayer(pRow);

  // Chuẩn hóa cấu trúc gacha của player
  const today = getTodayString();
  if (!player.gacha || typeof player.gacha !== 'object') {
    player.gacha = { date: today, used: 0, last_spin: 0 };
  } else if (player.gacha.date !== today) {
    player.gacha.date = today;
    player.gacha.used = 0;
  }
  player.gacha.used = Math.max(0, parseInt(player.gacha.used) || 0);

  // =========================================================================
  // ACTION: INFO — Lấy dữ liệu hiển thị cho Gacha Panel
  // =========================================================================
  if (action === 'info') {
    const used = player.gacha.used;
    const max = GACHA_MAX_DAILY;
    const next_cost = (used < max) ? GACHA_COST_LADDER[used] : -1;
    const lv = Math.max(1, parseInt(player.lv) || 1);
    const base = lv * GACHA_BASE_UNIT;
    const pPoints = parseInt(player.p_points) || 0;

    return res.json({
      ok: 1,
      used,
      max,
      next_cost,
      base,
      min_lv: 1,
      lv,
      p: pPoints
    });
  }

  // =========================================================================
  // ACTION: SPIN — Thực hiện lượt quay (với Mutex & Idempotency)
  // =========================================================================
  if (action === 'spin') {
    const releaseLock = await acquireUserLock(line_uid);
    try {
      // Reload dữ liệu mới nhất trong lock để tránh stale read
      db.load();
      pRow = (db.data.players || []).find((p) => p.line_uid === line_uid);
      if (!pRow) {
        return res.status(404).json({ ok: false, error: 'Player not found' });
      }
      player = unpackPlayer(pRow);

      // Kiểm tra Idempotency Key (nếu client có truyền)
      const idempotencyKey = req.body.idempotency_key || req.body.request_id;
      if (idempotencyKey) {
        cleanIdempotencyStore();
        const cacheKey = `${line_uid}:${idempotencyKey}`;
        const cached = idempotencyStore.get(cacheKey);
        if (cached) {
          return res.json(Object.assign({}, cached.result, { player, cached: true }));
        }
      }

      // Kiểm tra và reset quota theo ngày
      const currentToday = getTodayString();
      if (!player.gacha || typeof player.gacha !== 'object') {
        player.gacha = { date: currentToday, used: 0, last_spin: 0 };
      } else if (player.gacha.date !== currentToday) {
        player.gacha.date = currentToday;
        player.gacha.used = 0;
      }
      const used = Math.max(0, parseInt(player.gacha.used) || 0);
      const max = GACHA_MAX_DAILY;

      // 1. Kiểm tra giới hạn Quota hàng ngày
      if (used >= max) {
        return res.json({ ok: false, error: 'Hôm nay bạn đã hết lượt quay (tối đa 10 lần/ngày)' });
      }

      // 2. Xác định chi phí từ bậc thang chi phí (Server Authoritative)
      const lv = Math.max(1, parseInt(player.lv) || 1);
      const cost = GACHA_COST_LADDER[used];
      const curP = parseInt(player.p_points) || 0;

      // 3. Kiểm tra số dư P (ngăn chặn số dư âm)
      if (cost > 0 && curP < cost) {
        return res.json({ ok: false, error: `Bạn không đủ P points (cần ${cost} P, hiện có ${curP} P)` });
      }

      // 4. Sinh ngẫu nhiên hệ số nhân và tính toán phần thưởng (Server Authoritative)
      const mult = pickMultiplier();
      const base = lv * GACHA_BASE_UNIT;
      const amount = base * mult;

      // 5. Khấu trừ chi phí và cộng thưởng Gold
      if (cost > 0) {
        player.p_points = curP - cost;
        if (user && user.p_points !== undefined) {
          user.p_points = Math.max(0, (parseInt(user.p_points) || 0) - cost);
        }
      }
      player.gold = (parseInt(player.gold) || 0) + amount;

      // 6. Cập nhật quota sử dụng
      const newUsed = used + 1;
      player.gacha.used = newUsed;
      player.gacha.last_spin = Date.now();

      // 7. Đồng bộ ngược lại pRow và lưu database an toàn
      pRow.gold = player.gold;
      pRow.p_points = player.p_points;
      pRow.gacha = player.gacha;
      pRow.raw_data = JSON.stringify(player);

      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(pRow.raw_data, line_uid);
      db.save();

      const next_cost = (newUsed < max) ? GACHA_COST_LADDER[newUsed] : -1;
      const msg = `Chúc mừng bạn đã nhận được ${amount.toLocaleString()} G (×${mult})!`;

      const responsePayload = {
        ok: 1,
        mult,
        base,
        amount,
        used: newUsed,
        max,
        next_cost,
        player,
        msg
      };

      // Lưu kết quả vào idempotency cache
      if (idempotencyKey) {
        idempotencyStore.set(`${line_uid}:${idempotencyKey}`, {
          result: responsePayload,
          timestamp: Date.now()
        });
      }

      return res.json(responsePayload);
    } finally {
      releaseLock();
    }
  }

  return res.json({ ok: false, error: 'Hành động không hợp lệ' });
});

module.exports = router;
