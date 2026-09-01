/**
 * server/routes/auction.js
 * Server-authoritative Daily Auction System (TASK-043)
 * 
 * Lịch chuẩn Canonical:
 * - Mở: 11:00 UTC+7 (04:00 UTC)
 * - Đóng: 20:30 UTC+7 (13:30 UTC)
 * - 6 Slots thẻ bài mỗi ngày: 3 slots P (0..2), 3 slots G (3..5)
 * 
 * Các action hỗ trợ:
 * - 'state': Lấy thông tin phiên hôm nay, 6 slots, bước nhảy inc, epoch now, phase
 * - 'bid': Đặt giá đấu / tăng giá trên slot (instant refund khi outbid, self-bid chênh lệch, mutex lock)
 * - 'hist': Xem lịch sử đặt giá minh bạch của slot (kèm cờ refunded: 1/0)
 * - 'prev': Xem kết quả các vòng đấu giá trước
 * - 'settle': [Internal/Test API] Kích hoạt kết toán vòng đấu giá idempotent
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db/queries');

const router = express.Router();

// =========================================================================
// NẠP MONSTER / CARD CACHE
// =========================================================================
let monMasters = {};
try {
  const monMastersPath = path.join(__dirname, '..', '..', 'data', 'mon_masters_cache.json');
  if (fs.existsSync(monMastersPath)) {
    monMasters = JSON.parse(fs.readFileSync(monMastersPath, 'utf8'));
  }
} catch (e) {
  console.error('[Auction] Lỗi đọc mon_masters_cache.json:', e.message);
}

// =========================================================================
// CẤU HÌNH BƯỚC NHẢY GIÁ (MIRROR CLIENT RND / WT)
// =========================================================================
const INC_CONFIG = {
  P: [1, 5, 10, 20, 50],
  G: [100000, 500000, 1000000, 2000000, 5000000]
};

// Async mutex locks per slot để tuần tự hóa các request bid đồng thời
const slotLocks = new Map();

async function acquireSlotLock(lockKey) {
  while (slotLocks.has(lockKey)) {
    await slotLocks.get(lockKey);
  }
  let resolveLock;
  const promise = new Promise((resolve) => { resolveLock = resolve; });
  slotLocks.set(lockKey, promise);
  return () => {
    slotLocks.delete(lockKey);
    resolveLock();
  };
}

// Bộ nhớ đệm Idempotency chống retry duplicate / double charge
const auctionIdempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 120 * 1000;

function cleanIdempotencyCache() {
  const now = Date.now();
  for (const [key, entry] of auctionIdempotencyCache.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      auctionIdempotencyCache.delete(key);
    }
  }
}

// =========================================================================
// THỜI GIAN & CANONICAL TIMEZONE (UTC+7)
// =========================================================================
function getNowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function getTodayStringUTC7(d = new Date()) {
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const tzOffset = 7 * 3600000;
  const local = new Date(utc + tzOffset);
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getAuctionTimeBoundsUTC7(todayStr) {
  const [yyyy, mm, dd] = todayStr.split('-').map(Number);
  // 11:00 UTC+7 là 04:00 UTC
  // 20:30 UTC+7 là 13:30 UTC
  const openDate = new Date(Date.UTC(yyyy, mm - 1, dd, 4, 0, 0));
  const closeDate = new Date(Date.UTC(yyyy, mm - 1, dd, 13, 30, 0));
  return {
    opens_at: Math.floor(openDate.getTime() / 1000),
    ends_at: Math.floor(closeDate.getTime() / 1000)
  };
}

// =========================================================================
// TẠO 6 SLOTS CHO NGÀY MỚI (P×3 G×3, CHỐNG TRÙNG LẶP)
// =========================================================================
function createDailySlots(todayStr) {
  const allMids = Object.keys(monMasters);
  const pCandidates = allMids.filter((mid) => (monMasters[mid].lv || 0) >= 20);
  const gCandidates = allMids.filter((mid) => (monMasters[mid].lv || 0) >= 5 && (monMasters[mid].lv || 0) < 40);

  let seed = 0;
  for (let i = 0; i < todayStr.length; i++) {
    seed = (seed * 31 + todayStr.charCodeAt(i)) >>> 0;
  }

  function seededPick(arr, usedSet) {
    for (let attempt = 0; attempt < arr.length; attempt++) {
      const idx = (seed + attempt * 7) % arr.length;
      const mid = arr[idx];
      if (!usedSet.has(mid)) {
        usedSet.add(mid);
        seed = (seed * 17 + 13) >>> 0;
        return mid;
      }
    }
    for (const mid of arr) {
      if (!usedSet.has(mid)) {
        usedSet.add(mid);
        return mid;
      }
    }
    return arr[0] || '1';
  }

  const usedMids = new Set();
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const cur = i < 3 ? 'P' : 'G';
    const pool = cur === 'P' ? (pCandidates.length >= 3 ? pCandidates : allMids) : (gCandidates.length >= 3 ? gCandidates : allMids);
    const mid = seededPick(pool, usedMids);
    const mm = monMasters[mid] || { n: 'Thẻ Quái Vật', lv: 20, cs: 'str' };
    const lv = mm.lv || 20;
    const start = cur === 'P'
      ? Math.max(10, Math.floor(lv / 2) * 5)
      : Math.max(100000, lv * 50000);

    slots.push({
      i,
      cur,
      mid: Number(mid),
      name: `${mm.n} Card`,
      lv,
      cs: mm.cs || 'str',
      start,
      top: start,
      n: 0,
      leader_uid: null,
      nm: '',
      cc: ''
    });
  }
  return slots;
}

// =========================================================================
// HELPER TRÍCH XUẤT VÀ LƯU PLAYER STATE
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
  player.p_points = parseInt(player.p_points) || 0;
  player.gold = parseInt(player.gold) || 0;
  return player;
}

function savePlayer(pRow, playerObj) {
  pRow.gold = playerObj.gold;
  pRow.p_points = playerObj.p_points;
  if (playerObj.cards) pRow.cards = playerObj.cards;
  pRow.raw_data = JSON.stringify(playerObj);
}

// =========================================================================
// QUẢN LÝ ROUND ĐẤU GIÁ VÀ TỰ ĐỘNG SETTLEMENT
// =========================================================================
function initAuctionDb() {
  if (!db.data.auction_rounds) db.data.auction_rounds = [];
  if (!db.data.auction_bids) db.data.auction_bids = [];
  if (!db.data.auction_history) db.data.auction_history = [];
}

function getTodayRound() {
  initAuctionDb();
  const todayStr = getTodayStringUTC7();
  let round = db.data.auction_rounds.find((r) => r.date === todayStr);
  if (!round) {
    const bounds = getAuctionTimeBoundsUTC7(todayStr);
    round = {
      date: todayStr,
      opens_at: bounds.opens_at,
      ends_at: bounds.ends_at,
      settled: false,
      settled_at: 0,
      slots: createDailySlots(todayStr)
    };
    db.data.auction_rounds.push(round);
    db.save();
  }

  // Tự động kết toán nếu đã qua ends_at mà chưa kết toán
  const now = getNowEpoch();
  if (now >= round.ends_at && !round.settled) {
    settleRound(round);
  }

  return round;
}

function settleRound(round) {
  if (!round || round.settled) return;
  round.settled = true;
  round.settled_at = Date.now();

  for (const s of round.slots || []) {
    if (s.n > 0 && s.leader_uid) {
      // Có người chiến thắng -> Trao thẻ bài
      const winnerRow = (db.data.players || []).find((p) => p.line_uid === s.leader_uid);
      if (winnerRow) {
        const winner = unpackPlayer(winnerRow);
        let cards = winner.cards;
        if (typeof cards === 'string') {
          try { cards = JSON.parse(cards || '{}'); } catch (e) { cards = {}; }
        } else if (!cards || typeof cards !== 'object') {
          cards = {};
        }
        const cid = String(s.mid);
        cards[cid] = cards[cid] || { n: 0, m: 0 };
        cards[cid].n = (cards[cid].n || 0) + 1;
        winner.cards = cards;
        savePlayer(winnerRow, winner);
      }

      db.data.auction_history.push({
        round_date: round.date,
        item_name: s.name,
        item_lv: s.lv,
        winner_uid: s.leader_uid,
        winner_name: s.nm,
        winner_cc: s.cc,
        final_price: s.top,
        cur: s.cur
      });
    } else {
      // Không có người bid
      db.data.auction_history.push({
        round_date: round.date,
        item_name: s.name,
        item_lv: s.lv,
        winner_uid: null,
        winner_name: null,
        winner_cc: '',
        final_price: 0,
        cur: s.cur
      });
    }
  }
  db.save();
}

// =========================================================================
// ROUTER XỬ LÝ POST /xhrpg_auction.php
// =========================================================================
router.post(['/', '/xhrpg_auction.php'], async (req, res) => {
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

  const pRow = (db.data.players || []).find((p) => p.line_uid === line_uid);
  if (!pRow) {
    return res.status(404).json({ ok: false, error: 'Player not found' });
  }

  const round = getTodayRound();
  const now = getNowEpoch();

  // =========================================================================
  // ACTION: STATE — Lấy trạng thái phiên đấu giá hôm nay
  // =========================================================================
  if (action === 'state') {
    let phase = 'closed';
    if (now >= round.opens_at && now < round.ends_at) {
      phase = 'open';
    } else if (now < round.opens_at) {
      phase = 'waiting';
    }

    const clientSlots = (round.slots || []).map((s) => ({
      i: s.i,
      cur: s.cur,
      mid: s.mid,
      name: s.name,
      lv: s.lv,
      cs: s.cs,
      start: s.start,
      top: s.top,
      n: s.n,
      mine: (s.leader_uid === line_uid),
      nm: s.nm || '',
      cc: s.cc || ''
    }));

    return res.json({
      ok: true,
      now,
      phase,
      opens_at: round.opens_at,
      ends_at: round.ends_at,
      inc: INC_CONFIG,
      slots: clientSlots
    });
  }

  // =========================================================================
  // ACTION: BID — Đặt giá đấu trên slot chỉ định
  // =========================================================================
  if (action === 'bid') {
    cleanIdempotencyCache();

    // 1. Kiểm tra Idempotency key chống retry lặp thao tác
    const customIdemKey = req.body.idempotency_key || req.body.req_id;
    const idemKey = customIdemKey ? `custom:${line_uid}:${customIdemKey}` : null;
    if (idemKey && auctionIdempotencyCache.has(idemKey)) {
      return res.json(auctionIdempotencyCache.get(idemKey).response);
    }

    // 2. Validate slot index (chặt chẽ: không null, không float, trong khoảng 0..5)
    if (req.body.slot === undefined || req.body.slot === null) {
      return res.json({ ok: false, error: 'Thiếu thông tin slot đấu giá' });
    }
    const slotIdx = Number(req.body.slot);
    if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx > 5) {
      return res.json({ ok: false, error: 'Slot đấu giá không hợp lệ (phải là số nguyên từ 0 đến 5)' });
    }

    // 3. Kiểm tra phase mở đấu giá
    if (now < round.opens_at || now >= round.ends_at) {
      return res.json({ ok: false, error: 'Phiên đấu giá hiện chưa mở hoặc đã kết thúc' });
    }

    // 4. Validate seen price
    if (req.body.seen !== undefined) {
      const seenNum = Number(req.body.seen);
      if (isNaN(seenNum) || seenNum < 0 || !Number.isFinite(seenNum) || seenNum > Number.MAX_SAFE_INTEGER) {
        return res.json({ ok: false, error: 'Giá tham chiếu (seen) không hợp lệ' });
      }
    }

    // 5. Validate inc index (0..4)
    const incRaw = req.body.inc !== undefined ? req.body.inc : 0;
    const incIx = Number(incRaw);
    if (!Number.isInteger(incIx) || incIx < 0 || incIx > 4) {
      return res.json({ ok: false, error: 'Chỉ số bước tăng giá không hợp lệ (phải là số nguyên từ 0 đến 4)' });
    }

    const lockKey = `${round.date}:${slotIdx}`;
    const releaseLock = await acquireSlotLock(lockKey);

    try {
      db.load();
      initAuctionDb();
      const currentRound = db.data.auction_rounds.find((r) => r.date === round.date);
      if (!currentRound || !currentRound.slots || !currentRound.slots[slotIdx]) {
        return res.json({ ok: false, error: 'Không tìm thấy thông tin slot đấu giá' });
      }
      const s = currentRound.slots[slotIdx];

      // Kiểm tra trượt giá (Stale bid protection)
      if (s.n > 0 && req.body.seen !== undefined && parseInt(req.body.seen, 10) !== s.top) {
        return res.json({ ok: false, moved: true, error: 'Giá đấu đã thay đổi — vui lòng xem lại trước khi đặt tiếp' });
      }

      // Xác định increment và giá bid mới
      let increment = 0;
      let newBid = s.start;

      if (s.n === 0) {
        newBid = s.start;
      } else {
        const ladder = INC_CONFIG[s.cur] || [];
        increment = ladder[incIx];
        newBid = s.top + increment;
      }

      // Kiểm tra overflow an toàn
      if (newBid <= 0 || newBid > Number.MAX_SAFE_INTEGER || isNaN(newBid)) {
        return res.json({ ok: false, error: 'Giá đặt không hợp lệ' });
      }

      // Tính toán chi phí thực tế cần trả
      const isSelfOutbid = (s.leader_uid === line_uid);
      const cost = isSelfOutbid ? increment : newBid;

      // Đọc số dư mới nhất của bidder
      const bidderRow = (db.data.players || []).find((p) => p.line_uid === line_uid);
      if (!bidderRow) return res.status(404).json({ ok: false, error: 'Player not found' });
      const bidder = unpackPlayer(bidderRow);

      if (s.cur === 'P') {
        if (bidder.p_points < cost) {
          return res.json({ ok: false, error: `Bạn không đủ điểm P (cần ${cost} P, hiện có ${bidder.p_points} P)` });
        }
        bidder.p_points -= cost;
      } else {
        if (bidder.gold < cost) {
          return res.json({ ok: false, error: `Bạn không đủ vàng G (cần ${cost.toLocaleString()} G, hiện có ${bidder.gold.toLocaleString()} G)` });
        }
        bidder.gold -= cost;
      }

      // Hoàn tiền tức thì cho người dẫn đầu cũ nếu bị người khác outbid
      if (!isSelfOutbid && s.leader_uid && s.top > 0) {
        const prevUid = s.leader_uid;
        const prevRefund = s.top;
        const prevCur = s.cur;

        const prevRow = (db.data.players || []).find((p) => p.line_uid === prevUid);
        if (prevRow) {
          const prevPlayer = unpackPlayer(prevRow);
          if (prevCur === 'P') {
            prevPlayer.p_points = (parseInt(prevPlayer.p_points, 10) || 0) + prevRefund;
          } else {
            prevPlayer.gold = (parseInt(prevPlayer.gold, 10) || 0) + prevRefund;
          }
          savePlayer(prevRow, prevPlayer);
        }

        // Đánh dấu hoàn tiền trong lịch sử bid
        for (const b of db.data.auction_bids || []) {
          if (b.round_date === currentRound.date && b.slot === slotIdx && b.bidder_uid === prevUid && !b.refunded) {
            b.refunded = 1;
          }
        }
      }

      // Lưu bid mới vào lịch sử
      db.data.auction_bids.push({
        round_date: currentRound.date,
        slot: slotIdx,
        bidder_uid: line_uid,
        bidder_name: bidder.name || bidder.display_name || user.username,
        bidder_cc: bidder.country || 'TH',
        amount: newBid,
        cur: s.cur,
        refunded: 0,
        created_at: new Date().toISOString()
      });

      // Cập nhật trạng thái slot
      s.top = newBid;
      s.n += 1;
      s.leader_uid = line_uid;
      s.nm = bidder.name || bidder.display_name || user.username;
      s.cc = bidder.country || 'TH';

      // Lưu người chơi mới và cơ sở dữ liệu
      savePlayer(bidderRow, bidder);
      db.save();

      const newBal = s.cur === 'P' ? bidder.p_points : bidder.gold;
      const successRes = {
        ok: true,
        cur: s.cur,
        bal: newBal,
        msg: `Đặt giá thành công ${newBid.toLocaleString()} ${s.cur} cho ${s.name}!`
      };
      if (idemKey) {
        auctionIdempotencyCache.set(idemKey, { timestamp: Date.now(), response: successRes });
      }
      return res.json(successRes);
    } catch (err) {
      console.error('[Auction] Lỗi xử lý bid:', err);
      db.load(); // Rollback in-memory state nếu có ngoại lệ
      return res.status(500).json({ ok: false, error: 'Lỗi hệ thống khi đặt giá đấu' });
    } finally {
      releaseLock();
    }
  }

  // =========================================================================
  // ACTION: HIST — Xem lịch sử đặt giá của slot chỉ định
  // =========================================================================
  if (action === 'hist') {
    const slotIdx = parseInt(req.body.slot, 10) || 0;
    const targetSlot = (round.slots || [])[slotIdx] || {};

    const bids = (db.data.auction_bids || [])
      .filter((b) => b.round_date === round.date && b.slot === slotIdx)
      .map((b) => ({
        created_at: b.created_at,
        bidder_name: b.bidder_name,
        bidder_cc: b.bidder_cc,
        amount: b.amount,
        cur: b.cur,
        refunded: b.refunded || 0
      }));

    const past = (db.data.auction_history || [])
      .filter((h) => h.item_name === targetSlot.name && h.winner_name)
      .slice(-5)
      .map((h) => ({
        round_date: h.round_date,
        winner_name: h.winner_name,
        winner_cc: h.winner_cc,
        final_price: h.final_price,
        cur: h.cur
      }));

    return res.json({
      ok: true,
      bids,
      past
    });
  }

  // =========================================================================
  // ACTION: PREV — Xem kết quả các vòng trước
  // =========================================================================
  if (action === 'prev') {
    const rounds = (db.data.auction_history || [])
      .slice(-50)
      .reverse();

    return res.json({
      ok: true,
      rounds
    });
  }

  // =========================================================================
  // ACTION: SETTLE — [Internal / Admin / Test API] Kích hoạt kết toán thủ công
  // =========================================================================
  if (action === 'settle') {
    const adminKey = process.env.ADMIN_API_KEY || (process.env.NODE_ENV !== 'production' ? 'test_admin_secret_key' : null);
    const authHeader = req.headers['x-admin-api-key'] || req.headers['authorization'];
    let apiKey = null;
    if (typeof authHeader === 'string') {
      apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    }
    const isAdminKey = apiKey && adminKey && apiKey === adminKey;
    const isAdminUser = user && user.role === 'admin';

    if (!isAdminKey && !isAdminUser) {
      return res.status(403).json({ ok: false, error: 'Forbidden: Yêu cầu quyền quản trị viên hoặc Admin API Key' });
    }

    settleRound(round);
    return res.json({
      ok: true,
      settled: true,
      round_date: round.date
    });
  }

  return res.json({ ok: false, error: 'Hành động không hợp lệ' });
});

module.exports = router;
