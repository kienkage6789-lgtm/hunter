const express = require('express');
const db = require('../db/queries');

const router = express.Router();

router.post('/', (req, res) => {
  const { line_uid, action } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
  }

  // Xác thực player
  db.load();
  const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
  if (!pRow) {
    return res.json({ ok: false, error: 'Player not found' });
  }

  if (action === 'fetch' || action === 'dms') {
    return res.json({
      ok: true,
      msgs: [],
      dms: [],
      me: { uid: line_uid, name: pRow.name, role: 'player' }
    });
  }

  if (action === 'send') {
    return res.json({ ok: true });
  }

  // Phản hồi mặc định
  res.json({ ok: true, msg: 'Đang bảo trì.' });
});

module.exports = router;
