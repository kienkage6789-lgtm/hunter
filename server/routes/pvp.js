const express = require('express');
const db = require('../db/queries');
const { acquireLock, acquireTwoLocks } = require('../utils/lock');
const pvpManager = require('../game/PvPManager');

const router = express.Router();

router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid || !session_token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  const targetUid = req.body.target;
  const isTwoUserMutation = (action === 'challenge' || action === 'shadow_challenge') && targetUid && targetUid !== line_uid;
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
    myPlayerObj.name = myPlayerObj.name || pRow.name || 'Player';
    myPlayerObj.lv = parseInt(myPlayerObj.lv) || parseInt(pRow.lv) || 1;

    // ─────────────────────────────────────────────────────────────
    // 1. ACTION: LIST (Danh sách người chơi)
    // ─────────────────────────────────────────────────────────────
    if (action === 'list') {
      const page = Math.max(0, parseInt(req.body.page) || 0);
      const pageSize = 25;

      const playerList = (db.data.players || [])
        .filter(p => p && p.line_uid)
        .map(p => {
          let parsed;
          try { parsed = JSON.parse(p.raw_data); } catch (e) { parsed = {}; }
          return {
            uid: p.line_uid,
            name: parsed.name || p.name || 'Người chơi',
            lv: parseInt(parsed.lv) || parseInt(p.lv) || 1,
            cc: parsed.country || parsed.last_cc || 'VN',
            vip: parseInt(parsed.vip_lv) || 0
          };
        });

      playerList.sort((a, b) => b.lv - a.lv);

      const totalPages = Math.max(1, Math.ceil(playerList.length / pageSize));
      const validPage = Math.min(page, totalPages - 1);
      const pageSlice = playerList.slice(validPage * pageSize, (validPage + 1) * pageSize);

      return res.json({
        ok: true,
        page: validPage,
        pages: totalPages,
        players: pageSlice
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. ACTION: SHADOW_CHALLENGE (Thách đấu bóng tức thì)
    // ─────────────────────────────────────────────────────────────
    if (action === 'shadow_challenge') {
      if (!targetUid) return res.json({ ok: false, error: 'missing_target', msg: 'Chưa chọn đối thủ!' });
      if (targetUid === line_uid) return res.json({ ok: false, error: 'cannot_challenge_self', msg: 'Không thể tự thách đấu chính mình!' });

      const targetRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(targetUid);
      if (!targetRow) return res.json({ ok: false, error: 'target_not_found', msg: 'Không tìm thấy đối thủ!' });

      let targetPlayerObj;
      try { targetPlayerObj = JSON.parse(targetRow.raw_data); } catch (e) { targetPlayerObj = {}; }
      targetPlayerObj.line_uid = targetUid;
      targetPlayerObj.name = targetPlayerObj.name || targetRow.name || 'Bóng';
      targetPlayerObj.lv = parseInt(targetPlayerObj.lv) || parseInt(targetRow.lv) || 1;

      const duel = pvpManager.createShadowDuel(myPlayerObj, targetPlayerObj);
      if (!duel) return res.json({ ok: false, error: 'duel_create_failed', msg: 'Không thể tạo trận đấu bóng!' });

      return res.json({
        ok: true,
        msg: `Bắt đầu thách đấu bóng với ${targetPlayerObj.name}!`
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. ACTION: CHALLENGE (Gửi lời mời thách đấu trực tiếp)
    // ─────────────────────────────────────────────────────────────
    if (action === 'challenge') {
      if (!targetUid) return res.json({ ok: false, error: 'missing_target', msg: 'Chưa chọn đối thủ!' });
      if (targetUid === line_uid) return res.json({ ok: false, error: 'cannot_challenge_self', msg: 'Không thể tự thách đấu chính mình!' });

      const targetRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(targetUid);
      if (!targetRow) return res.json({ ok: false, error: 'target_not_found', msg: 'Không tìm thấy đối thủ!' });

      let targetPlayerObj;
      try { targetPlayerObj = JSON.parse(targetRow.raw_data); } catch (e) { targetPlayerObj = {}; }
      targetPlayerObj.line_uid = targetUid;
      targetPlayerObj.name = targetPlayerObj.name || targetRow.name || 'Đối thủ';
      targetPlayerObj.lv = parseInt(targetPlayerObj.lv) || parseInt(targetRow.lv) || 1;

      if (targetPlayerObj.pvp_off) {
        return res.json({ ok: false, error: 'target_pvp_disabled', msg: 'Đối thủ đã tắt nhận lời mời PvP!' });
      }

      const inviteResult = pvpManager.createLiveDuelInvite(myPlayerObj, targetPlayerObj);
      return res.json(inviteResult);
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ACTION: ACCEPT (Chấp nhận lời mời thách đấu)
    // ─────────────────────────────────────────────────────────────
    if (action === 'accept') {
      const invite = pvpManager.pendingInvites.get(line_uid);
      if (!invite) return res.json({ ok: false, error: 'no_invite', msg: 'Không có lời mời nào!' });

      const cUid = invite.challengerUid;
      const cRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(cUid);
      if (!cRow) return res.json({ ok: false, error: 'challenger_not_found', msg: 'Không tìm thấy người thách đấu!' });

      let challengerPlayerObj;
      try { challengerPlayerObj = JSON.parse(cRow.raw_data); } catch (e) { challengerPlayerObj = {}; }
      challengerPlayerObj.line_uid = cUid;
      challengerPlayerObj.name = challengerPlayerObj.name || cRow.name || invite.challengerName;
      challengerPlayerObj.lv = parseInt(challengerPlayerObj.lv) || parseInt(cRow.lv) || invite.challengerLv;

      const acceptRes = pvpManager.acceptInvite(line_uid, myPlayerObj, challengerPlayerObj);
      return res.json(acceptRes);
    }

    // ─────────────────────────────────────────────────────────────
    // 5. ACTION: DECLINE (Từ chối lời mời thách đấu)
    // ─────────────────────────────────────────────────────────────
    if (action === 'decline') {
      const declineRes = pvpManager.declineInvite(line_uid);
      return res.json(declineRes);
    }

    // ─────────────────────────────────────────────────────────────
    // 6. ACTION: FORFEIT (Đầu hàng)
    // ─────────────────────────────────────────────────────────────
    if (action === 'forfeit') {
      const forfeitRes = pvpManager.forfeitDuel(line_uid);
      return res.json(forfeitRes);
    }

    // ─────────────────────────────────────────────────────────────
    // 7. ACTION: LOG (Lịch sử trận đấu gần đây)
    // ─────────────────────────────────────────────────────────────
    if (action === 'log') {
      const logs = pvpManager.getPvpLogs();
      return res.json({
        ok: true,
        log: logs
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 8. ACTION: RANK (Bảng xếp hạng PvP)
    // ─────────────────────────────────────────────────────────────
    if (action === 'rank') {
      const ranks = pvpManager.getPvpRanks();
      return res.json({
        ok: true,
        rank: ranks
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 9. ACTION: PVP_TOGGLE (Bật/tắt chế độ nhận thách đấu)
    // ─────────────────────────────────────────────────────────────
    if (action === 'pvp_toggle') {
      myPlayerObj.pvp_off = !myPlayerObj.pvp_off;
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(myPlayerObj), line_uid
      );
      return res.json({
        ok: true,
        pvp_off: myPlayerObj.pvp_off,
        msg: myPlayerObj.pvp_off ? 'Đã tắt nhận lời mời thách đấu!' : 'Đã bật nhận lời mời thách đấu!'
      });
    }

    return res.json({ ok: false, error: 'Unknown PvP action' });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi PvP route:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi máy chủ PvP: ' + (err.message || 'Lỗi hệ thống') });
  } finally {
    release();
  }
});

module.exports = router;

