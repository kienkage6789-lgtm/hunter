const express = require('express');
const db = require('../db/queries');

const router = express.Router();

// Xem thông tin nhà của người chơi khác
router.post('/', (req, res) => {
  const { line_uid, session_token, action, target } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  db.load();

  const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
  if (!userRow) {
    return res.json({ ok: false, error: 'Unauthorized: Invalid session_token' });
  }

  if (action === 'view') {
    const targetUid = target || line_uid;
    const targetRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(targetUid);
    if (!targetRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi mục tiêu' });
    }

    let pObj = {};
    try {
      pObj = JSON.parse(targetRow.raw_data);
    } catch (e) {
      pObj = {};
    }

    let guards = [];
    if (pObj.home_guards) {
      guards = Array.isArray(pObj.home_guards) ? pObj.home_guards : (typeof pObj.home_guards === 'string' ? JSON.parse(pObj.home_guards || '[]') : []);
    }

    return res.json({
      ok: true,
      owner: {
        uid: targetUid,
        name: pObj.display_name || targetRow.name || 'Người chơi',
        lv: targetRow.lv || pObj.lv || 1,
        country: pObj.country || 'VN'
      },
      house: {
        lv: parseInt(pObj.house_lv) || 0,
        home_lv: parseInt(pObj.home_lv) || 1,
        guards: guards,
        energy: parseInt(pObj.house_energy) || 60,
        x: pObj.house_x || 928,
        y: pObj.house_y || 780
      }
    });
  }

  res.json({ ok: false, error: 'Unknown action' });
});

module.exports = router;
