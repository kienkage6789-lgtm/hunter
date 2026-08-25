const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

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
    console.error('Lỗi cập nhật level:', err);
    return res.json({ ok: false, error: 'Lỗi hệ thống' });
  } finally {
    release();
  }
});

module.exports = router;
