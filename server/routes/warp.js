const express = require('express');
const db = require('../db/queries');

const router = express.Router();

const MAP_DEFS = {
  1: { name: 'Cánh đồng trung tâm', req: 1 },
  2: { name: 'Sa mạc vĩnh hằng', req: 25 },
  3: { name: 'Vùng đất băng giá', req: 40 },
  4: { name: 'Đấu trường', req: 20 },
  5: { name: 'Nhà của tôi', req: 1 },
  6: { name: 'Đáy biển sâu', req: 55 },
  7: { name: 'Cánh đồng (newbie)', req: 1, cap: 40 },
  8: { name: 'Sa mạc (newbie)', req: 25, cap: 59 },
  9: { name: 'Băng giá (newbie)', req: 40, cap: 59 },
  10: { name: 'Rừng rồng cổ đại', req: 70 },
  11: { name: 'Lâu đài Guild', req: 1 },
  12: { name: 'Guild Dungeon', req: 1 },
  13: { name: '⭐ Cánh đồng trung tâm', req: 70, ragReq: 40 }
};

router.post('/', async (req, res) => {
  const { line_uid, session_token, target_map, home_exit } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  const { acquireLock } = require('../utils/lock');
  const release = await acquireLock(line_uid);

  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!userRow) {
      return res.json({ ok: false, error: 'Unauthorized: Invalid session_token' });
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

    // Khởi tạo các giá trị tọa độ nếu chưa có
    if (playerObj.x === undefined) playerObj.x = 1125;
    if (playerObj.y === undefined) playerObj.y = 1125;
    if (playerObj.map === undefined) playerObj.map = pRow.map || 1;

    // 1. Thoát khỏi nhà (Map 5)
    if (home_exit == '1' || home_exit == 1) {
      const hr = playerObj.home_return || { map: 1, x: 1125, y: 1125 };
      playerObj.map = hr.map;
      playerObj.x = hr.x;
      playerObj.y = hr.y;
      playerObj.explore_cx = hr.x;
      playerObj.explore_cy = hr.y;
      playerObj.target_monster_id = null;
      delete playerObj.home_return;

      // Cập nhật DB
      db.prepare(`
        UPDATE players SET 
          x = ?, y = ?, exp = ?, gold = ?, lv = ?, raw_data = ?
        WHERE line_uid = ?
      `).run(playerObj.x, playerObj.y, playerObj.exp || pRow.exp, playerObj.gold || pRow.gold, playerObj.lv || pRow.lv, JSON.stringify(playerObj), line_uid);

      return res.json({
        ok: true,
        map: playerObj.map,
        x: playerObj.x,
        y: playerObj.y
      });
    }

    // 2. Dịch chuyển tới Map cụ thể
    if (target_map !== undefined) {
      const mapId = parseInt(target_map);
      const mapDef = MAP_DEFS[mapId];
      if (!mapDef) {
        return res.json({ ok: false, error: 'Bản đồ không tồn tại' });
      }

      const playerLv = playerObj.lv || 1;

      // Kiểm tra giới hạn Level tối thiểu
      if (playerLv < mapDef.req) {
        return res.json({ ok: false, error: 'level_locked', need: mapDef.req });
      }

      // Kiểm tra giới hạn Level tối đa (cho map newbie)
      if (mapDef.cap && playerLv > mapDef.cap) {
        return res.json({ ok: false, error: 'level_too_high', cap: mapDef.cap });
      }

      // Kiểm tra yêu cầu Rag Level (cho map sao ⭐)
      const playerRagLv = playerObj.rag_lv || 1;
      if (mapDef.ragReq && playerRagLv < mapDef.ragReq) {
        return res.json({ ok: false, error: 'level_locked', need: mapDef.ragReq });
      }

      // Nếu vào nhà (Map 5)
      if (mapId === 5) {
        playerObj.home_return = {
          map: playerObj.map,
          x: playerObj.x,
          y: playerObj.y
        };
        playerObj.map = 5;
        playerObj.x = 928; // Tọa độ nhà mặc định
        playerObj.y = 780;
        playerObj.explore_cx = 928;
        playerObj.explore_cy = 780;
        playerObj.target_monster_id = null;
      } else {
        playerObj.map = mapId;
        playerObj.x = 1125; // Tọa độ tâm bản đồ mới
        playerObj.y = 1125;
        playerObj.explore_cx = 1125;
        playerObj.explore_cy = 1125;
        playerObj.target_monster_id = null;
      }

      // Cập nhật DB
      db.prepare(`
        UPDATE players SET 
          x = ?, y = ?, exp = ?, gold = ?, lv = ?, raw_data = ?
        WHERE line_uid = ?
      `).run(playerObj.x, playerObj.y, playerObj.exp || pRow.exp, playerObj.gold || pRow.gold, playerObj.lv || pRow.lv, JSON.stringify(playerObj), line_uid);

      return res.json({
        ok: true,
        map: playerObj.map,
        x: playerObj.x,
        y: playerObj.y
      });
    }

    // 3. Dịch chuyển về tâm bản đồ hiện tại (warpCenter)
    playerObj.x = 1125;
    playerObj.y = 1125;
    playerObj.explore_cx = 1125;
    playerObj.explore_cy = 1125;
    playerObj.target_monster_id = null;

    db.prepare(`
      UPDATE players SET 
        x = ?, y = ?, exp = ?, gold = ?, lv = ?, raw_data = ?
      WHERE line_uid = ?
    `).run(playerObj.x, playerObj.y, playerObj.exp || pRow.exp, playerObj.gold || pRow.gold, playerObj.lv || pRow.lv, JSON.stringify(playerObj), line_uid);

    res.json({
      ok: true,
      map: playerObj.map,
      x: playerObj.x,
      y: playerObj.y
    });
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi dịch chuyển:', err);
    return res.json({ ok: false, error: 'Lỗi dịch chuyển: ' + (err.message || 'Lỗi hệ thống') });
  } finally {
    release();
  }
});

module.exports = router;
