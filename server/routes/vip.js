const express = require('express');
const db = require('../db/queries');

const router = express.Router();

// Mảng yêu cầu điểm P tích lũy cho từng mốc VIP (từ VIP 0 tới VIP 15)
const VIP_REQ = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5200, 6600, 8200, 10000, 12000, 14500, 17500];
const VIP_QUOTA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

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
  } catch(e) {
    pObj = {};
  }

  const vip = pObj.vip_lv || 0;
  const nextReq = VIP_REQ[vip + 1] !== undefined ? VIP_REQ[vip + 1] : VIP_REQ[VIP_REQ.length - 1];

  res.json({
    ok: true,
    vip: vip,
    p_total: pObj.p_total || 0,
    req: VIP_REQ,
    quota: VIP_QUOTA,
    next_req: nextReq,
    buy_total: pObj.p_buy_total || 0,
    spend_total: pObj.p_spend_total || 0
  });
});

module.exports = router;
