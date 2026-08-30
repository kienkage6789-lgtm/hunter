const express = require('express');
const db = require('../db/queries');

const router = express.Router();

// Lấy lịch sử giao dịch nạp P Point của người chơi
router.post('/', (req, res) => {
  const { line_uid, session_token } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  db.load();

  const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
  if (!userRow) {
    return res.json({ ok: false, error: 'Unauthorized: Invalid session_token' });
  }

  const allHistory = db.data.topup_history || [];
  const myHistory = allHistory
    .filter(h => h.line_uid === line_uid)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  res.json({
    ok: true,
    history: myHistory
  });
});

module.exports = router;
