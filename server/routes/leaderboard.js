const express = require('express');
const db = require('../db/queries');

const router = express.Router();

router.get('/', (req, res) => {
  const { show, tab, uid, cc } = req.query;

  db.load();

  // 1. Xem chi tiết người chơi khác (Profile Inspect)
  if (show) {
    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(show);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi!' });
    }

    let pObj;
    try {
      pObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      pObj = {};
    }

    return res.json({
      ok: true,
      uid: show,
      name: pObj.display_name || pRow.name || 'Người chơi ẩn danh',
      lv: pObj.lv || pRow.lv || 1,
      rag: pObj.rag_lv || 1,
      def: pObj.armor || 100,
      stat: {
        str: pObj.str || 5,
        agi: pObj.agi || 5,
        vit: pObj.vit || 5,
        int: pObj.intel || 5,
        dex: pObj.dex || 5,
        luk: pObj.luk || 5
      },
      eq: pObj.equipment || [],
      cards: { t: Object.keys(pObj.cards || {}).length },
      eggs: { t: Object.keys(pObj.eggs || {}).length },
      book: []
    });
  }

  // 2. Lấy danh sách bảng xếp hạng (Leaderboard)
  const players = db.data.players || [];
  const tabType = tab || 'lv';

  // Sắp xếp người chơi
  let sortedPlayers = [...players];
  if (tabType === 'gold') {
    sortedPlayers.sort((a, b) => (b.gold || 0) - (a.gold || 0));
  } else {
    // Mặc định sắp xếp theo level và exp
    sortedPlayers.sort((a, b) => {
      if ((b.lv || 1) !== (a.lv || 1)) {
        return (b.lv || 1) - (a.lv || 1);
      }
      return (b.exp || 0) - (a.exp || 0);
    });
  }

  // Lọc theo quốc gia nếu có
  const filterCc = cc ? String(cc).toUpperCase() : null;
  if (filterCc) {
    sortedPlayers = sortedPlayers.filter(p => {
      try {
        const raw = JSON.parse(p.raw_data);
        return raw.country === filterCc;
      } catch (e) {
        return false;
      }
    });
  }

  // Định dạng danh sách bảng xếp hạng
  const list = sortedPlayers.slice(0, 50).map((p, idx) => {
    let raw = {};
    try {
      raw = JSON.parse(p.raw_data);
    } catch(e) {}

    return {
      rank: idx + 1,
      uid: p.line_uid,
      name: raw.display_name || p.name || 'Vô danh',
      cc: raw.country || 'VN',
      vip: raw.vip_lv || 0,
      lv: p.lv || 1,
      exp: p.exp || 0,
      gold: p.gold || 0,
      rag_lv: raw.rag_lv || 1,
      gm: raw.role === 'admin' ? 1 : 0,
      cl: 0,
      gd: null
    };
  });

  // Tìm vị trí xếp hạng của tôi
  let me = null;
  if (uid) {
    const myIdx = sortedPlayers.findIndex(p => p.line_uid === uid);
    if (myIdx !== -1) {
      const myPlayer = sortedPlayers[myIdx];
      let myRaw = {};
      try {
        myRaw = JSON.parse(myPlayer.raw_data);
      } catch(e) {}

      me = {
        rank: myIdx + 1,
        uid: myPlayer.line_uid,
        name: myRaw.display_name || myPlayer.name,
        cc: myRaw.country || 'VN',
        vip: myRaw.vip_lv || 0,
        lv: myPlayer.lv || 1,
        exp: myPlayer.exp || 0,
        gold: myPlayer.gold || 0,
        rag_lv: myRaw.rag_lv || 1
      };
    }
  }

  res.json({
    ok: true,
    list: list,
    me: me,
    ccs: ['VN', 'TH', 'PH', 'JP', 'TW'] // Danh sách quốc gia hỗ trợ
  });
});

module.exports = router;
