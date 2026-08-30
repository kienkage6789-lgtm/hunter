const express = require('express');
const db = require('../db/queries');
const { acquireLock, acquireTwoLocks } = require('../utils/lock');
const raidManager = require('../game/RaidManager');

const router = express.Router();

router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid || !session_token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  const targetUid = req.body.target;
  const isTwoUserMutation = action === 'start' && targetUid && targetUid !== line_uid;
  const release = isTwoUserMutation ? await acquireTwoLocks(line_uid, targetUid) : await acquireLock(line_uid);

  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!userRow) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid session_token' });
    }

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.status(404).json({ ok: false, error: 'Player not found' });
    }

    let myPlayerObj;
    try {
      myPlayerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      myPlayerObj = {};
    }
    myPlayerObj.line_uid = line_uid;
    myPlayerObj.name = myPlayerObj.name || pRow.name || 'Người chơi';
    myPlayerObj.lv = parseInt(myPlayerObj.lv) || parseInt(pRow.lv) || 1;

    // ─────────────────────────────────────────────────────────────
    // 1. ACTION: LIST (Danh sách nhà mục tiêu để cướp)
    // ─────────────────────────────────────────────────────────────
    if (action === 'list') {
      const page = parseInt(req.body.page) || 0;
      const sort = req.body.sort || 'gold';
      const result = raidManager.getTargetsList(line_uid, myPlayerObj, page, sort);
      return res.json(result);
    }

    // ─────────────────────────────────────────────────────────────
    // 2. ACTION: FEED (Nhật ký cướp toàn server)
    // ─────────────────────────────────────────────────────────────
    if (action === 'feed') {
      const feed = raidManager.getRaidFeed();
      return res.json({
        ok: true,
        feed: feed
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. ACTION: HIST (Lịch sử cướp của tôi)
    // ─────────────────────────────────────────────────────────────
    if (action === 'hist') {
      const hist = raidManager.getRaidHist(line_uid);
      return res.json({
        ok: true,
        me: line_uid,
        hist: hist
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ACTION: START (Bắt đầu cuộc đột kích cướp nhà)
    // ─────────────────────────────────────────────────────────────
    if (action === 'start') {
      if (!targetUid) {
        return res.json({ ok: false, error: 'missing_target', msg: 'Chưa chọn nhà mục tiêu để cướp!' });
      }

      const raidResult = raidManager.executeRaid(line_uid, targetUid, false);
      return res.json(raidResult);
    }

    return res.json({ ok: false, error: 'Unknown Raid action' });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi Raid route:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi máy chủ Raid: ' + (err.message || 'Lỗi hệ thống') });
  } finally {
    release();
  }
});

module.exports = router;

