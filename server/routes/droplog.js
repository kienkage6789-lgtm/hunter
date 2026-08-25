const express = require('express');
const db = require('../db/queries');

const router = express.Router();

router.post('/', (req, res) => {
  const { line_uid } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
  }

  db.load();
  const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
  if (!pRow) {
    return res.json({ ok: false, error: 'Player not found' });
  }

  let pObj;
  try {
    pObj = JSON.parse(pRow.raw_data);
  } catch (e) {
    pObj = {};
  }

  // Lấy lịch sử nhặt đồ (nếu có)
  const drops = pObj.drop_log || [];

  res.json({
    ok: true,
    drops: drops
  });
});

module.exports = router;
