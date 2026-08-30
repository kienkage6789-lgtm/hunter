const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

// Middleware xác thực ADMIN_API_KEY qua HTTP Headers
router.use((req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY || (process.env.NODE_ENV === 'test' ? 'test_admin_secret_key' : null);

  if (!adminKey) {
    return res.status(403).json({ ok: false, error: 'Admin API is disabled (missing ADMIN_API_KEY)' });
  }

  // Chặn tuyệt đối và từ chối nếu truyền key qua query params hoặc request body (ngăn ngừa rò rỉ secret trong logs/URL)
  if ((req.query && (req.query.admin_api_key || req.query.key)) || (req.body && (req.body.admin_api_key || req.body.key))) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: admin_api_key via query or body is prohibited. Use x-admin-api-key or Authorization header.' });
  }

  // Chỉ trích xuất từ Headers
  let token = null;
  const rawHeader = req.headers['x-admin-api-key'] || req.headers['authorization'];
  if (typeof rawHeader === 'string') {
    if (rawHeader.startsWith('Bearer ')) {
      token = rawHeader.slice(7).trim();
    } else {
      token = rawHeader.trim();
    }
  }

  if (!token || token !== adminKey) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing or invalid ADMIN_API_KEY' });
  }

  next();
});

// API cấp P Point cho người chơi
router.post('/give_p', async (req, res) => {
  const { line_uid, amount } = req.body;
  if (!line_uid || amount === undefined) {
    return res.json({ ok: false, error: 'Thiếu line_uid hoặc amount' });
  }

  const pAmount = parseInt(amount);
  if (isNaN(pAmount)) {
    return res.json({ ok: false, error: 'Amount phải là số' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    playerObj.p_points = (playerObj.p_points || 0) + pAmount;
    // Tích lũy tổng nạp
    if (pAmount > 0) {
      playerObj.p_total = (playerObj.p_total || 0) + pAmount;
    }

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    return res.json({ ok: true, msg: `Cấp thành công ${pAmount} P. Số dư hiện tại: ${playerObj.p_points} P.`, player: playerObj });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi cấp P Point:', err);
    return res.json({ ok: false, error: 'Lỗi hệ thống' });
  } finally {
    release();
  }
});

// API cấp Gold cho người chơi
router.post('/give_gold', async (req, res) => {
  const { line_uid, amount } = req.body;
  if (!line_uid || amount === undefined) {
    return res.json({ ok: false, error: 'Thiếu line_uid hoặc amount' });
  }

  const gAmount = parseInt(amount);
  if (isNaN(gAmount)) {
    return res.json({ ok: false, error: 'Amount phải là số' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    playerObj.gold = (playerObj.gold || 0) + gAmount;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    return res.json({ ok: true, msg: `Cấp thành công ${gAmount} Gold. Số dư hiện tại: ${playerObj.gold} Gold.`, player: playerObj });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi cấp Gold:', err);
    return res.json({ ok: false, error: 'Lỗi hệ thống' });
  } finally {
    release();
  }
});

// API thay đổi Level của người chơi
router.post('/set_level', async (req, res) => {
  const { line_uid, level } = req.body;
  if (!line_uid || level === undefined) {
    return res.json({ ok: false, error: 'Thiếu line_uid hoặc level' });
  }

  const lv = parseInt(level);
  if (isNaN(lv) || lv < 1) {
    return res.json({ ok: false, error: 'Level không hợp lệ' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    playerObj.lv = lv;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    return res.json({ ok: true, msg: `Đã cập nhật cấp độ lên Lv.${lv}.`, player: playerObj });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi cập nhật level:', err);
    return res.json({ ok: false, error: 'Lỗi hệ thống' });
  } finally {
    release();
  }
});

module.exports = router;
