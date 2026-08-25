# 🛸 PRIVATE SERVER — RAGNALOK ONLINE (XHRPG)
> Dự án xây dựng server riêng hoàn toàn độc lập với `ragnalok.online`
> Cập nhật: 20/08/2026

---

## 📁 CẤU TRÚC DỰ ÁN

```
ragnalok-private-server/
├── client/                     ← Game client (đã copy từ game gốc)
│   ├── xhrpg_canvas.js         ← Engine game chính (2.88MB) — CHỈ CẦN PATCH URL
│   ├── xhrpg_lang_vi.js        ← Từ điển Thái→Việt (171KB)
│   ├── xhrpg_style.css         ← CSS game (52KB)
│   ├── jquery-3.6.0.min.js     ← jQuery
│   ├── play.html               ← Client game HTML (cần sửa auth)
│   ├── play_battle.html        ← Battle UI
│   ├── game_index.html         ← Index game
│   └── assets/                 ← Sprites, tiles, FX, hero (đã có đủ)
│       ├── monsters/           ← 80 PNG sprites quái vật
│       ├── tiles/              ← 6 biome tile sets
│       ├── hero/               ← Sprite nhân vật + companions
│       ├── fx/                 ← 8 hiệu ứng particle
│       └── icons/              ← Icons UI
├── server/                     ← Backend Node.js (cần viết mới)
│   ├── index.js                ← Entry point Express server
│   ├── routes/                 ← API route handlers
│   │   ├── auth.js             ← /xhrpg_google_auth.php (thay bằng local auth)
│   │   ├── game.js             ← /xhrpg_game.php (CORE — phức tạp nhất)
│   │   ├── warp.js             ← /xhrpg_warp.php
│   │   ├── upgrade.js          ← /xhrpg_upgrade.php
│   │   ├── offline.js          ← /xhrpg_offline.php
│   │   ├── market.js           ← /xhrpg_market.php
│   │   ├── arena.js            ← /xhrpg_arena.php
│   │   ├── guild.js            ← /xhrpg_guild.php + /xhrpg_cwar.php
│   │   ├── leaderboard.js      ← /xhrpg_leaderboard.php
│   │   ├── trade.js            ← /xhrpg_trade.php
│   │   └── droplog.js          ← /xhrpg_droplog.php
│   ├── game/                   ← Core game logic
│   │   ├── WorldManager.js     ← Quản lý world state, monster spawn
│   │   ├── CombatEngine.js     ← Tính damage, hit/miss, critical
│   │   ├── DropSystem.js       ← Tính item drop rate
│   │   ├── LevelSystem.js      ← EXP curve, level-up
│   │   └── formulas.js         ← Công thức ATK/DEF/HP từ stats
│   └── db/
│       ├── init.js             ← Khởi tạo schema SQLite
│       └── queries.js          ← Helper functions
├── data/                       ← Dữ liệu tĩnh (seed data)
│   ├── maps_cache.json         ← 13 bản đồ (đã có)
│   ├── spots_cache.json        ← Zones mỗi map (đã có)
│   ├── mon_masters_cache.json  ← Thông tin quái (cần bổ sung)
│   └── monster_defs.json       ← ← CẦN TẠO (stats quái: HP/ATK/DEF/EXP/drops)
├── docs/
│   ├── game_api_reference.md   ← API reference đã reverse (đã copy)
│   └── PLAN.md                 ← File này
├── package.json
└── .gitignore
```

---

## 🗺️ BẢNG ĐỒ GAME (13 Maps)

| ID | Tên | Emoji | Lv yêu cầu |
|---|---|---|---|
| 1 | Cánh đồng trung tâm | 🌿 | 1 |
| 2 | Sa mạc vĩnh hằng | 🏜️ | 25 |
| 3 | Vùng đất băng giá | ❄️ | 40 |
| 4 | Đấu trường | 🏛️ | 20 |
| 5 | Nhà của tôi (Farm) | 🏡 | 1 |
| 6 | Đáy biển sâu | 🌊 | 55 |
| 7 | Cánh đồng (newbie) | 🌿 | 1 |
| 8 | Sa mạc (newbie) | 🏜️ | 25 |
| 9 | Băng giá (newbie) | ❄️ | 40 |
| 10 | Rừng rồng cổ đại | 🐉 | 70 |
| 11 | Lâu đài Guild | 🏯 | 1 |
| 12 | Guild Dungeon | 🕳️ | 1 |
| 13 | ⭐ Cánh đồng trung tâm | 🌿 | 70 |

---

## ⚔️ SKILLS TREE (16 kỹ năng)

### Nhánh Súng (Pistol/Sniper)
| Skill ID | Tên | Req |
|---|---|---|
| `crit_shot` | Bắn chí mạng | — |
| `kill_shot` | Cú bắn tử thần | crit_shot ≥ 3 |
| `explosive_shot` | Đạn nổ | Lv30 + crit_shot≥5 + kill_shot≥5 |
| `lock_on` | Khóa mục tiêu | Lv40 + explosive_shot≥5 |
| `triple_knife` | Tam phi đao | Lv50 + lock_on≥5 |

### Nhánh Phòng Thủ
| Skill ID | Tên | Req |
|---|---|---|
| `tough_body` | Thân thể cứng rắn | — |
| `armor_up` | Tăng cường giáp | tough_body ≥ 3 |
| `hp_regen` | Hồi máu tự động | tough_body ≥ 5 |
| `pull_monster` | Nam châm hút quái | Lv30 + hp_regen≥5 + armor_up≥5 |

### Nhánh Kiếm/Dao
| Skill ID | Tên | Req |
|---|---|---|
| `knife_atk` | Tấn công dao | — |
| `double_attack` | Song kiếm | knife_atk ≥ 5 |
| `spin_attack` | Kiếm xoay | Lv30 + knife_atk≥5 + double_attack≥5 |

### Nhánh Turret
| Skill ID | Tên | Req |
|---|---|---|
| `deploy_turret` | Đặt ụ súng | — |
| `turret_rapid` | Tốc độ bắn | deploy_turret ≥ 3 |
| `twin_turret` | Ụ súng đôi | Lv30 + deploy_turret≥5 + turret_rapid≥5 |

---

## 🐾 26 BOSS MVP (MONSTER_DICT)

| Lv | Tên | ID |
|---|---|---|
| 1 | Sứa Đỏ | mvp_1 |
| 5 | Vua Slime Xanh | mvp_2 |
| 10 | Vua Slime Tím | mvp_3 |
| ... | ... | ... |
| 100 | Nữ Thần Valkyrie | mvp_26 |

> Chi tiết đầy đủ trong `data/mon_masters_cache.json`

---

## 🔌 API ENDPOINTS CẦN IMPLEMENT

| Endpoint | Priority | Status |
|---|---|---|
| `GET /xhrpg_google_auth.php` | 🔴 P0 | ĐÃ XONG |
| `POST /xhrpg_game.php` | 🔴 P0 | ĐÃ XONG |
| `POST /xhrpg_warp.php` | 🔴 P0 | ĐÃ XONG |
| `POST /xhrpg_upgrade.php` | 🟡 P1 | ĐÃ XONG |
| `POST /xhrpg_offline.php` | 🟡 P1 | ĐÃ XONG |
| `POST /xhrpg_market.php` | 🟡 P1 | ĐÃ XONG |
| `POST /xhrpg_arena.php` | 🟢 P2 | ĐÃ XONG |
| `POST /xhrpg_vip.php` | 🟢 P2 | ĐÃ XONG |
| `POST /xhrpg_guild.php` | 🟢 P2 | ĐÃ XONG |
| `POST /xhrpg_cwar.php` | 🟢 P2 | ĐÃ XONG |
| `GET /xhrpg_leaderboard.php` | 🟢 P2 | ĐÃ XONG |
| `POST /xhrpg_trade.php` | 🟢 P2 | ĐÃ XONG |
| `POST /xhrpg_droplog.php` | 🟢 P2 | ĐÃ XONG |

---

## 🗄️ DATABASE SCHEMA (SQLite)

### Bảng `players`
| Column | Type | Notes |
|---|---|---|
| line_uid | TEXT PK | |
| name | TEXT | |
| lv | INT | default 1 |
| exp | INT | |
| hp / hp_max | INT | |
| mp / mp_max | INT | |
| gold | INT | |
| map | INT | default 1 |
| x, y | REAL | spawn coords |
| str,agi,vit,intel,dex,luk | INT | 6 base stats |
| stat_pts / skill_pts | INT | |
| cat_lv / drone_lv / priest_lv / robot_lv | INT | companions |
| house_lv / house_energy | INT | airship mining |
| home_lv | INT | farm |
| pet_mid / pet_exp / pet_mvp / pet_olv | INT | pet |
| pet_up_atk / pet_up_hp / pet_up_reco | INT | pet points |
| vip / rag | INT | vip tier |
| guild_id | INT | |

### Bảng `player_skills`
`(line_uid, skill_id) → lv`

### Bảng `equipment`
`(id, line_uid, slot 0-9, type, lv, affixes JSON)`

### Bảng `inventory`
`(id, line_uid, item_type, item_id, qty, data JSON)`

### Bảng `mines`
`(line_uid, slot 0-5, ore, lv, active)`

### Bảng `home_crops`
`(line_uid, plot, idx, seed_id, planted_at)`

### Bảng `monsters` (live world state)
`(id, map_id, mon_id, x, y, hp, hp_max, is_boss, is_mvp, respawn_at)`

### Bảng `monster_defs` (static data)
`(mon_id, name, lv, hp_max, atk, def, exp, gold_min, gold_max, map_ids JSON, drops JSON)`

### Bảng `market_listings`
`(id, seller_uid, item_type, item_id, qty, price_per, listed_at)`

### Bảng `drop_log`
`(id, line_uid, item_type, item_id, item_name, qty, source, created_at)`

### Bảng `users` (auth)
`(line_uid, username, password_hash, session_token, token_expires, role)`

---

## 📅 LỘ TRÌNH THỰC HIỆN

### GĐ 0 ⚡ — Data Capture [ĐÃ HOÀN THÀNH]
**Mục tiêu**: Thu thập ground-truth data từ game gốc

- [x] F12 → Network → Filter `xhrpg_game.php` → Capture JSON responses
- [x] Capture ở nhiều tình huống: farm, đánh boss, lên cấp, nhặt đồ
- [x] Capture ở nhiều map khác nhau (1→13)
- [x] Ghi lại cấu trúc đầy đủ `player` object (50+ fields)
- [x] Ghi lại `monsters[]` array với HP/ATK/DEF/EXP từng loại
- [x] Lưu vào `data/captured_responses/` để làm reference

**Output:** Đã lưu dữ liệu tại `data/captured_responses/xhrpg_game_sample_utf8.json`.

---

### GĐ 1 — Auth System [ĐÃ HOÀN THÀNH]
**Mục tiêu**: Đăng nhập không cần Google OAuth

```javascript
// server/routes/auth.js
GET /xhrpg_google_auth.php → { ok: true, line_uid, session_token, name }
POST /api/register          → tạo tài khoản mới
POST /api/login             → đăng nhập username/password
```

- [x] Tạo DB table `users` (Chuyển sang JSON file để fix lỗi C++)
- [x] Register/Login với hash password đơn giản
- [x] Session token (UUID, expires 24h)
- [x] Sửa `client/play.html` — xóa Google button, thêm form local

---

### GĐ 2 — Database Init [ĐÃ HOÀN THÀNH]
- [x] Khởi tạo hệ thống lưu trữ JSON (`server/db/queries.js`)
- [x] Viết `server/db/init.js` — khởi tạo database.json
- [x] Tích hợp file mockup từ GĐ 0 làm seed mặc định cho user mới
- [x] Test: tạo player → lưu → đọc lại OK

---

### GĐ 3 🔴 — Core Game Loop [ĐÃ HOÀN THÀNH MVP]
**File**: `server/routes/game.js` + `server/game/WorldManager.js`

**Request nhận:**
```json
{
  "line_uid": "...", "session_token": "...", "lang": "vi",
  "lock_pos": 0, "explore_radius": 300, "explore_cx": 1125, "explore_cy": 1125,
  "bot": 1, "isFull": 0
}
```

**Response trả về:**
```json
{
  "ok": true,
  "player": { /* 50+ fields từ DB */ },
  "monsters": [ /* live monsters gần player */ ],
  "drops": [ /* items vừa nhặt */ ],
  "spots": { /* zones của map này */ },
  "bosses": [ /* MVP bosses trên map */ ],
  "log": [ /* text events */ ]
}
```

**Sub-tasks:**
- [x] WorldManager: per-map monster state, spawn/respawn timer (đã tăng 20% tầm di chuyển ngẫu nhiên, 10% tốc độ hồi phục, và tăng 20% số lượng quái spawn tại spots)
- [x] CombatEngine: player_atk vs monster_def → damage
- [x] Target System & Weapon Toggles: tự động chọn mục tiêu, đồng bộ target_monster_id. Hỗ trợ bật/tắt súng ngắn, súng dài, switch_gun qua `/xhrpg_upgrade.php`. Tầm đánh: Dao găm 35px, Súng ngắn 75px base, Súng dài 100px base (+ DEX/8 và level).
- [ ] DropSystem: drop rate random theo monster_defs.drops (Sẽ làm ở phase sau)
- [x] LevelSystem: EXP threshold, lên cấp (Cơ bản)
- [x] Movement: player "đứng" ở explore_cx/cy, attack monsters trong radius
- [ ] Cooldown: 900ms giữa các attack (server-side enforce)
- [ ] Shared HP: nhiều player cùng map đánh chung 1 con quái

---

### GĐ 4 — Sub-systems [1-2 tuần]
- [ ] `xhrpg_warp.php` — validate lv, update player.map/x/y
- [ ] `xhrpg_upgrade.php` — 20+ action types (stats, skills, gear, mine, farm, pet, companion)
- [ ] `xhrpg_offline.php` — tính EXP+Gold tích lũy khi offline

---

### GĐ 5 — Economy & Social [1 tuần]
- [ ] `xhrpg_market.php` — get_listings, buy, sell, cancel
- [ ] `xhrpg_arena.php` — 1v1 arena, skip/enter
- [ ] `xhrpg_leaderboard.php` — top list, profile inspect
- [ ] `xhrpg_trade.php` — search player by name
- [ ] `xhrpg_droplog.php` — lịch sử nhặt đồ

---

### GĐ 6 — Guild [1 tuần]
- [ ] `xhrpg_guild.php` — create/join/leave/donate
- [ ] `xhrpg_cwar.php` — Nation War

---

### GĐ 7 — Patch Client & Testing [1-2 tuần]
- [ ] Patch `client/xhrpg_canvas.js` — đổi URL `ragnalok.online/human/` → `/`
- [ ] Bỏ/bypass Cloudflare Turnstile check trong canvas.js
- [ ] GM Admin endpoints: set-level, give-gold, give-item, spawn-boss
- [ ] Full test: login → game → combat → level up → warp → upgrade

---

## ⚠️ THÁCH THỨC LỚN

### 🔴 Monster/Item Database — MỐC QUAN TRỌNG NHẤT
Game có **100+ loại quái** với stats chỉ trong MySQL của official server. Cần capture thủ công từ game gốc. **Nếu skip bước này, server sẽ có data sai.**

### 🔴 `xhrpg_game.php` response format
Player object có ~50-100 fields. Canvas.js crash nếu thiếu field quan trọng. Cần capture và implement từng field một.

### 🟡 Combat formula server-side
Không có tài liệu chính thức. Quan sát `log` strings trong response → tìm công thức damage.

### 🟡 Real-time multi-player sync
Nhiều player cùng map cần chia sẻ monster HP → cần WorldManager singleton per map.

---

## 💡 QUICK START (MVP trong 1 tuần)

**Ngày 1**: Auth + DB + `play.html` mới  
**Ngày 2**: `/xhrpg_game.php` trả response tĩnh (hardcode player, không quái)  
**Ngày 3**: Monster spawn random trên Map 1  
**Ngày 4-5**: Combat cơ bản (attack → damage → EXP/Gold → respawn)  
**Ngày 6-7**: Warp + Upgrade skills cơ bản  

→ Sau MVP: iterate từng feature, 1 sub-system mỗi ngày

---

## 📊 CHECKLIST TỔNG QUAN

### FILES ĐÃ CÓ (copy từ game gốc)
- [x] `client/xhrpg_canvas.js` — Game engine 2.88MB
- [x] `client/xhrpg_lang_vi.js` — Vietnamese dict
- [x] `client/xhrpg_style.css` — Game CSS
- [x] `client/play.html` — Game client HTML
- [x] `client/assets/monsters/` — 80 monster sprites
- [x] `client/assets/tiles/` — 6 biome tile sets
- [x] `client/assets/hero/` — Hero + companion sprites
- [x] `client/assets/fx/` — Particle effects
- [x] `data/maps_cache.json` — 13 maps
- [x] `data/spots_cache.json` — Zones per map
- [x] `data/mon_masters_cache.json` — Monster reference
- [x] `docs/game_api_reference.md` — API documentation

### CẦN VIẾT MỚI (private server)
- [x] `server/index.js` — Express entry point (Đã xong)
- [x] `server/db/queries.js` — Quản lý cơ sở dữ liệu JSON (Thay thế SQLite) (Đã xong)
- [x] `server/routes/auth.js` — Local auth & đăng ký/đăng nhập (Đã xong)
- [x] `server/routes/game.js` — Core game loop (Đã xong)
- [x] `server/routes/warp.js` — Dịch chuyển map và nhà riêng (Đã xong)
- [x] `server/routes/upgrade.js` — Toàn bộ hơn 20 tính năng nâng cấp (Đã xong)
- [x] `server/routes/market.js` — Chợ mua bán (Đã xong)
- [x] `server/routes/offline.js` — Treo máy offline & giám sát (Đã xong)
- [x] `server/routes/arena.js` — Boss 1v1 Đấu trường (Đã xong)
- [x] `server/routes/leaderboard.js` — Bảng xếp hạng & kiểm tra (Đã xong)
- [x] `server/routes/vip.js` — Hệ thống VIP & shop ngày (Đã xong)
- [ ] `server/routes/guild.js` — Bang hội (Chưa làm)
- [x] `server/game/WorldManager.js` — Sinh quái & multiplayer (Đã xong)
- [x] `server/game/CombatEngine.js` — Công thức sát thương theo stats/skills (Đã xong)
- [ ] `server/game/DropSystem.js` — Drop rate (Tích hợp trực tiếp)
- [x] `server/game/formulas.js` — Các công thức của game (Đã tích hợp)
- [x] `client/play.html` — Thay đổi flow đăng nhập local (Đã xong)
