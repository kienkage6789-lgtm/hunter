const express = require('express');
const db = require('../db/queries');

const router = express.Router();

router.post('/', (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
  }

  db.load();

  // Verify user session
  if (session_token) {
    const user = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!user) {
      return res.json({ ok: false, error: 'Invalid session' });
    }
  }

  // Load player raw_data
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

  if (action === 'war_log') {
    let myName = pRow.name || 'Tôi';
    if (playerObj.display_name) myName = playerObj.display_name;

    const mockFeed = [
      { t: Math.floor(Date.now() / 1000) - 300, k: "Knight_Legend", kt: 1, v: "Dark_Soul", vt: 2, p: 5 },
      { t: Math.floor(Date.now() / 1000) - 150, k: "Master_Shooter", kt: 2, v: "Valkyrie_Fan", vt: 1, p: 5 },
      { t: Math.floor(Date.now() / 1000) - 10, k: myName, kt: 1, v: "Enemy_Bot", vt: 2, p: 5 }
    ];

    return res.json({ 
      ok: true, 
      feed: mockFeed, 
      ppk: 5, 
      mlv: 50 
    });
  }

  if (action === 'cwar_join') {
    playerObj.home_return = { map: playerObj.map || 1, x: playerObj.x || 1125, y: playerObj.y || 1125 };
    playerObj.map = 11; // Warp to Map 11 (Guild Castle / Battlefield)
    playerObj.x = 1000;
    playerObj.y = 1000;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(playerObj), line_uid);
    db.save();

    return res.json({
      ok: true,
      map: 11,
      x: 1000,
      y: 1000
    });
  }

  // Fallback response for other actions
  res.json({ ok: true, msg: 'Tính năng đang bảo trì.' });
});

module.exports = router;
