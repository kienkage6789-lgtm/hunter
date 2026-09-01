const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');
const cwarManager = require('../game/CWarManager');
const gwarManager = require('../game/GWarManager');

const router = express.Router();

router.post('/', async (req, res) => {
  const { line_uid, session_token, action, kind } = req.body;
  if (!line_uid || !session_token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    // 1. Xác thực session token
    const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!userRow) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid session_token' });
    }

    // 2. Load player data
    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Player not found' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = { line_uid };
    }

    // 3. Action: 'war_log'
    if (action === 'war_log') {
      if (kind === 'gw') {
        const logRes = gwarManager.getWarLog('gw');
        return res.json(logRes);
      }
      const logRes = cwarManager.getWarLog(kind || 'cw');
      return res.json(logRes);
    }

    // 4. Action: 'cwar_join'
    if (action === 'cwar_join') {
      const joinRes = cwarManager.joinWar(playerObj);
      if (!joinRes.ok) {
        return res.json(joinRes);
      }

      // Cập nhật vị trí Map 4 và thông tin tham chiến vào Database
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(playerObj), line_uid
      );
      db.save();

      return res.json(joinRes);
    }

    // Fallback response for unknown actions
    res.json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi router CWar:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi chiến trường: ' + (err.message || 'Lỗi hệ thống') });
  } finally {
    release();
  }
});

module.exports = router;
