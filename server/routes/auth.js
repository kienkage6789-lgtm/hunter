const express = require('express');
const crypto = require('crypto');
const db = require('../db/queries');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Hàm tạo hash đơn giản (cho MVP)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Hàm sinh UID và Token
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// API Đăng ký
router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: 'Thiếu username/password' });

  const existing = db.prepare('SELECT line_uid FROM users WHERE username = ?').get(username);
  if (existing) return res.json({ ok: false, error: 'Username đã tồn tại' });

  const line_uid = 'local_' + generateId();
  const session_token = generateId();
  const passHash = hashPassword(password);
  
  // Lưu user
  db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
    line_uid, username, passHash, session_token
  );

  // Khởi tạo Player mặc định dựa trên mẫu capture
  let defaultPlayerRaw = "{}";
  try {
    const samplePath = path.join(__dirname, '..', '..', 'data', 'captured_responses', 'xhrpg_game_sample_utf8.json');
    if (fs.existsSync(samplePath)) {
      let content = fs.readFileSync(samplePath, 'utf8');
      if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
      }
      const sample = JSON.parse(content);
      if (sample.player) {
        sample.player.line_uid = line_uid;
        sample.player.display_name = username;
        sample.player.lv = 1;
        sample.player.exp = 0;
        sample.player.exp_next = 100;
        sample.player.gold = 500000;
        sample.player.hp = 300;
        sample.player.hp_max = 300;
        sample.player.mp = 50;
        sample.player.mp_max = 50;
        sample.player.map = 1;
        sample.player.x = 1125;
        sample.player.y = 1125;
        sample.player.explore_cx = 1125;
        sample.player.explore_cy = 1125;
        sample.player.str = 5;
        sample.player.agi = 5;
        sample.player.vit = 5;
        sample.player.intel = 5;
        sample.player.dex = 5;
        sample.player.luk = 5;
        sample.player.stat_pts = 100;
        sample.player.skill_pts = 20;
        sample.player.skills = "{}";
        sample.player.gun_pistol_lv = 1;
        sample.player.gun_sniper_lv = 1;
        sample.player.knife_lv = 1;
        sample.player.armor_lv = 1;
        sample.player.armor = 10;
        sample.player.cat_lv = 0;
        sample.player.drone_lv = 0;
        sample.player.priest_lv = 0;
        sample.player.knight_lv = 0;
        sample.player.robot_lv = 0;
        sample.player.robot_axe_lv = 0;
        sample.player.robot_gun_lv = 0;
        sample.player.robot_railgun_lv = 0;
        sample.player.robot_stun_lv = 0;
        sample.player.house_lv = 0;
        sample.player.orion_gun_lv = 0;
        sample.player.orion_cannon_lv = 0;
        sample.player.turret_lv = 0;
        sample.player.pet_mid = 0;
        sample.player.pet_exp = 0;
        sample.player.pet_up_atk = 0;
        sample.player.pet_up_hp = 0;
        sample.player.pet_up_reco = 0;
        sample.player.mine_lv = "[0,0,0,0,0,0]";
        sample.player.mine_ore = "[\"\",\"\",\"\",\"\",\"\",\"\"]";
        sample.player.mine_on = "[0,0,0,0,0,0]";
        sample.player.home_lv = 0;
        sample.player.home_seeds = "{}";
        sample.player.kills = 0;
        sample.player.vip_lv = 0;
        sample.player.p_points = 500;
        sample.player.p_total = 500;
        sample.player.diamond_blue = 5000;
        sample.player.diamond_red = 500;
        sample.player.diamond_green = 0;
        sample.player.wood = 25000;
        sample.player.stone = 25000;
        sample.player.iron = 25000;
        sample.player.copper = 25000;
        sample.player.herb = 25000;
        sample.player.ammo_pistol = 100;
        sample.player.ammo_sniper = 100;
        sample.player.ammo_robot_gun = 100;
        sample.player.hp_potion = 10;
        defaultPlayerRaw = JSON.stringify(sample.player);
      }
    }
  } catch (err) {
    console.error("Lỗi đọc file mẫu:", err);
  }

  db.prepare(`
    INSERT INTO players (
      line_uid, name, lv, exp, hp, hp_max, gold, map, raw_data
    ) VALUES (?, ?, 1, 0, 300, 300, 500000, 1, ?)
  `).run(line_uid, username, defaultPlayerRaw);

  res.json({ ok: true, line_uid, session_token });
});

// API Đăng nhập
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: 'Thiếu username/password' });

  const passHash = hashPassword(password);
  const user = db.prepare('SELECT line_uid, session_token FROM users WHERE username = ? AND password_hash = ?').get(username, passHash);
  
  if (!user) return res.json({ ok: false, error: 'Sai username hoặc mật khẩu' });

  // Tạo token mới mỗi lần đăng nhập
  const session_token = generateId();
  db.prepare('UPDATE users SET session_token = ? WHERE line_uid = ?').run(session_token, user.line_uid);

  res.json({ ok: true, line_uid: user.line_uid, session_token });
});

// Mock endpoint gốc để client không lỗi nếu nó gọi
router.get('/xhrpg_google_auth.php', (req, res) => {
  res.json({ ok: false, error: 'Please use local login' });
});

module.exports = router;
