const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

// Xử lý đăng xuất phiên người chơi và thu hồi session_token
router.post('/', async (req, res) => {
  const { line_uid, session_token } = req.body;
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

    // Thu hồi session token (đặt null)
    db.prepare('UPDATE users SET session_token = ? WHERE line_uid = ?').run(null, line_uid);

    return res.json({
      ok: true,
      msg: 'Đăng xuất thành công'
    });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi khi đăng xuất line_uid %s: %s', line_uid, err.message);
    return res.status(500).json({ ok: false, error: 'Lỗi máy chủ khi đăng xuất: ' + (err.message || 'Lỗi hệ thống') });
  } finally {
    release();
  }
});

module.exports = router;
