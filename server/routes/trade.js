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

  if (action === 'status') {
    // Trả về null cho room để thể hiện không đang trong phòng giao dịch nào
    return res.json({ ok: true, room: null });
  }

  if (action === 'history') {
    // Trả về mảng rỗng cho lịch sử giao dịch
    return res.json({ ok: true, rows: [] });
  }

  if (action === 'search_name') {
    const q = req.body.q || '';
    // Tìm người chơi khác có tên chứa q
    const matches = db.prepare("SELECT * FROM players WHERE name LIKE ? COLLATE NOCASE LIMIT 20").all(`%${q}%`);
    const results = matches.map(m => {
      let p; try { p = JSON.parse(m.raw_data); } catch(e) { p = {}; }
      return { id: m.line_uid, name: m.name, lv: m.lv, vip: p.vip_lv || 0 };
    });
    return res.json({ ok: true, matches: results });
  }

  // Phản hồi mặc định cho các action khác để không bị treo
  res.json({ ok: true, msg: 'Đang phát triển tính năng này.' });
});

module.exports = router;
