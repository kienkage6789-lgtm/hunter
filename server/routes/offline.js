const express = require('express');
const db = require('../db/queries');

const router = express.Router();

router.post('/', (req, res) => {
  const { line_uid, action, map, zones } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
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

  db.load();

  // 1. Xem trước hiệu suất offline (action === 'preview')
  if (action === 'preview') {
    const mapId = parseInt(map) || 1;
    // Tính toán tỷ lệ EXP/Gold ước tính dựa trên Map
    const expRate = mapId * 15;
    const goldRate = mapId * 8;

    return res.json({
      ok: true,
      exp: expRate * 60,
      gold: goldRate * 60,
      rate: {
        exp: expRate,
        gold: goldRate
      }
    });
  }

  // 2. Thiết lập Zone offline (action === 'set')
  if (action === 'set') {
    playerObj.offline_zones = zones;
    playerObj.offline_zones_map = parseInt(map) || 1;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    return res.json({
      ok: true,
      msg: 'Thiết lập offline farm thành công!'
    });
  }

  // 3. Sync màn hình giám sát Bot (action === 'monitor_sync')
  if (action === 'monitor_sync') {
    // Trả về dữ liệu giám sát giả lập
    return res.json({
      ok: true,
      exp: 1000,
      gold: 500,
      kills: 12,
      cards: 0,
      eggs: 0,
      mods: 0,
      bexp: 150,
      bgold: 75,
      feed: [
        { t: Date.now(), s: "🛡️ Chế độ giám sát rảnh tay hoạt động tốt...", c: "#38bdf8", q: 1 },
        { t: Date.now() - 3000, s: "🤖 Bot đang tìm quái vật xung quanh...", c: "#64748b", q: 2 }
      ]
    });
  }

  // 4. Lấy feed logs (action === 'feed_pull')
  if (action === 'feed_pull') {
    return res.json({
      ok: true,
      q: [
        { t: Date.now(), s: "⚔️ Tiêu diệt quái nhận +25 EXP và +15 Gold", c: "#4ade80" }
      ]
    });
  }

  // 5. Trạng thái idle check (action === 'idlestat')
  if (action === 'idlestat') {
    return res.json({
      ok: true,
      ci: 3600 // Trả về nhịp check-in (ví dụ 3600 giây)
    });
  }

  res.json({ ok: false, error: 'Unknown action' });
});

module.exports = router;
