const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');
const arenaManager = require('../game/ArenaManager');

const router = express.Router();

router.post('/', async (req, res) => {
  const { line_uid, session_token, action, mid, pay, count } = req.body;
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

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Player not found' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    // 1. Lấy thông tin đấu trường (action: 'info')
    if (action === 'info') {
      const infoRes = arenaManager.getInfo(playerObj);
      // Lưu lại trạng thái quota reset nếu có
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(playerObj), line_uid
      );
      db.save();
      return res.json(infoRes);
    }

    // 2. Thách đấu Boss (action: 'enter')
    if (action === 'enter') {
      const enterRes = arenaManager.enter(playerObj, mid, pay);
      if (!enterRes.ok) {
        return res.json(enterRes);
      }

      // Lưu thay đổi tiền tệ và arena_run vào Database
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(playerObj), line_uid
      );
      db.save();

      return res.json(enterRes);
    }

    // 3. Càn quét nhanh Boss (action: 'skip')
    if (action === 'skip') {
      const skipRes = arenaManager.skip(playerObj, mid, pay, count);
      if (!skipRes.ok) {
        return res.json(skipRes);
      }

      // Lưu thay đổi phần thưởng, tiền tệ và arena_hist vào Database
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(playerObj), line_uid
      );
      db.save();

      return res.json(skipRes);
    }

    // 4. Lịch sử nhận thưởng của Boss (action: 'hist')
    if (action === 'hist') {
      const histRes = arenaManager.getHist(playerObj, mid);
      return res.json(histRes);
    }

    res.json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi đấu trường:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi đấu trường: ' + (err.message || 'Lỗi hệ thống') });
  } finally {
    release();
  }
});

module.exports = router;
