# Ragnalok Online (XHRPG) Private Server — Project Context

## GAME
```
Name:     Ragnalok Online (XHRPG) Private Server
Genre:    MMORPG
Engine:   Node.js + Express
Language: JavaScript
Platform: Web
Concept:  Server riêng độc lập cho game Ragnalok Online (XHRPG), giả lập API PHP cũ của game gốc.
Status:   Alpha / WIP
```

## ARCHITECTURE
```
Pattern:  Client-Server, Express routes giả lập API PHP, WorldManager singleton điều phối spawn quái và vị trí người chơi theo chu kỳ (tick).
Save sys: Flat JSON file (database.json) thay cho SQLite.
Key libs: express, cors, compression.
Notes:    - Dùng JSON Database Interface giả lập SQLite (`queries.js`).
          - WorldManager quản lý live world state (monsters spawn, active players).
          - CombatEngine tính sát thương dựa trên chỉ số base và level kỹ năng (đã tích hợp).
          - DropSystem sinh phần thưởng khi giết quái vật (đã tích hợp).
```

## PROJECT STRUCTURE
```
ragnalok-private-server/
├── client/                     ← Game client (từ game gốc, đã patch URL & Auth)
│   ├── xhrpg_canvas.js         ← Engine game Canvas chính
│   ├── xhrpg_lang_vi.js        ← Từ điển tiếng Việt
│   └── play.html               ← Giao diện đăng nhập local & canvas
├── server/                     ← Mã nguồn máy chủ Node.js + Express
│   ├── index.js                ← Entry Point của Express server
│   ├── db/                     ← Quản lý cơ sở dữ liệu JSON
│   ├── game/                   ← Core logic (WorldManager, CombatEngine, DropSystem)
│   └── routes/                 ← Các route giả lập PHP endpoints
├── data/                       ← Dữ liệu tĩnh và tệp lưu trữ DB
└── docs/                       ← Tài liệu phân tích
```

## DESIGN CORE
```
Loop:  Treo máy/Chiến đấu → Nhận EXP/Vàng/Vật phẩm → Nâng cấp chỉ số/Kỹ năng/Đồng hành → Chiến đấu map/Boss cấp cao hơn.
Win:   Đạt cấp độ tối đa, sở hữu trang bị cực phẩm, đứng đầu Arena/Guild War.
Lose:  Không áp dụng (game nhàn rỗi treo máy).
Mechs: - Tự động tấn công quái vật gần nhất trong bán kính explore_radius.
       - Nâng cấp Stats (STR, AGI, VIT, INT, DEX, LUK) và 16 Skills (Pistol, Defense, Dagger, Turret).
       - Đồng hành Cat, Drone, Priest, Robot hỗ trợ chiến đấu/khai thác.
       - Trồng trọt nông trại (Farm) và phi thuyền khai thác mỏ.
       - Arena 1v1, Chợ giao dịch Market, và hệ thống Bang hội (Guild).
```

## MILESTONES
```
[M1] Foundation        [DONE]  20/08/2026
[M2] Core Gameplay     [DONE]  22/08/2026
[M3] Sub-systems       [DONE]  22/08/2026
[M4] Guild System      [DONE]  23/08/2026
[M5] Release & Polish  [WIP]   26/08/2026
```

## CURRENT STATUS
```
Sprint:  #1 — Bắt đầu: 23/08/2026
Goal:    Hoàn thiện hệ thống quản trị GM Admin endpoints, Premium shop và phát hành chính thức.
Active:  None (đang chờ chốt TASK tiếp theo)
Scope:   Xác minh hoạt động hệ thống game trên môi trường thực tế.
```

## RECENT COMPLETED (last 5)
```
[TASK-023] Hoàn thiện Chat backend + session security  DONE  30/08/2026
[TASK-024] Hoàn thiện Upgrade backend: đủ 9 action + session/rollback  DONE  30/08/2026
[TASK-025] Chuẩn hóa session auth + bảo mật Admin API  DONE  30/08/2026
[TASK-026] Phủ endpoint backlog P1: Phase A + safe 501 contracts  DONE  30/08/2026
[TASK-027] Hoàn thiện Chat Image Storage an toàn  DONE  30/08/2026
[TASK-028] P1 Offline Farming opt-in, không ép offline  DONE  30/08/2026
[TASK-029] Hoàn thiện PvP 1v1 server-authoritative  DONE  30/08/2026
[TASK-030] Hoàn thiện Raid/cướp nhà server-authoritative  DONE  30/08/2026
[TASK-031] Hoàn thiện Arena Boss server-authoritative  DONE  30/08/2026
[TASK-022] Hoàn thiện Trade 1-1 backend + atomic rollback  DONE  30/08/2026
[TASK-021] Hoàn thiện Market backend + atomic rollback  DONE  30/08/2026
[TASK-020] Khắc phục hiện tượng quái vật trong zone tự chết & đồng bộ hiển thị Client  DONE  27/08/2026
[TASK-019] Sửa lỗi tính năng Khóa vị trí tấn công (Lock Attack) không hoạt động  DONE  27/08/2026
[TASK-018] Hoàn thiện tính năng Mỏ khoáng Phi thuyền (Airship Mining System)  DONE  27/08/2026
[TASK-017] Sửa lỗi Boss MVP giờ tròn (:00) không xuất hiện & phát sóng Boss toàn map  DONE  27/08/2026
[TASK-016] Khắc phục lỗi di chuyển giữa các Zone (Spots) & đóng băng lưu dữ liệu do SQL mismatch  DONE  26/08/2026
```

## KNOWN ISSUES
```
DONE:
- P0 Market: đã có `cancel`, `get_history`, `get_my_listings`, atomic rollback; test 7/7.
- P0 Trade 1-1: đã có `search/invite/respond/lock/unlock/confirm/cancel`, escrow, timeout, rollback; test 10/10.
- P0 Upgrade: đã triển khai đủ 9 action (`araid_set`, `archer_up`, `cc_change`, `cc_list`, `guard_remove`, `guard_set`, `job2_unlock`, `toggle_drone`, `vip_box_buy`), session validation, chống double-submit và atomic rollback; test 10/10 x2.
- P0 Auth/Admin: 8 user routes bắt buộc cặp `line_uid + session_token`; `/api/admin` chỉ nhận `ADMIN_API_KEY` qua HTTP header, chặn query/body key; test Auth/Security PASS và cleanup DB.
- P1 Endpoint Coverage: triển khai `logout`, `phistory`, `home`; 13 endpoint Phase B/C trả HTTP 501 an toàn, không giả success/payment; test 16/16 PASS.
- P1 Chat Image Storage: upload/serve JPEG, PNG, WebP với session auth, magic-byte/size validation, atomic write và chống path traversal; test PASS 100%.
- P1 Chat: đã có Global/DM/Guild, persistence, unread, anti-spam, duplicate suppression, rollback và session validation; test 11/11.
- P1 Offline farming: đã dùng dữ liệu monster/spot thực tế, session auth, opt-in zone/start; tab hidden/inactivity/d.idle/OTB không còn dừng poll hoặc ép offline; test offline PASS 100% x2.
- P1 PvP 1v1: đã mount route thay 501, state invite/count/fight/end, combat tick/HP/damage, timeout/forfeit, auth, lock/rollback, history/rank; test 8/8 PASS.
- P1 Raid/cướp nhà: đã triển khai list/feed/hist/start, combat guard→owner, quota VIP, shield, settlement crop/gold, auth, lock/rollback và raidpop; test 7/7 x2 PASS.
- P1 Arena: đã thay cấp thưởng trực tiếp bằng state machine boss `IDLE→ENTER→ACTIVE→WIN/LOSE/TIMEOUT`, combat HP/damage server-side, ticket/quota, skip có điều kiện, reward idempotent, auth/lock/rollback và poll events; test 9/9 x2 PASS.

TODO theo ưu tiên:
- P1 Chat images: `xhrpg_chat_upload.php` và `xhrpg_chat_img.php` chưa có storage backend; `report_img` hiện trả `storage_unavailable` có chủ đích.
- P1 Nation War/CWAR: mới warp map 11 và battle feed mô phỏng.
- P2 Guild: client gọi `log` nhưng server chưa xử lý; war/rank còn mô phỏng.
- P2 GM Admin: còn thiếu `give-item` và `spawn-boss`; chưa có E2E/security audit cho Admin và Premium Shop.
- P2 Logout: mới xóa trạng thái trình duyệt; server chưa thu hồi session token.
```

## LOG
```
[2026-08-30] Hoàn thiện Market (TASK-021), Trade 1-1 (TASK-022), Chat + session security (TASK-023), Upgrade (TASK-024), Auth/Admin security (TASK-025), Endpoint Coverage (TASK-026), Chat Image Storage (TASK-027); mỗi hệ thống có test route, atomic rollback và cleanup DB.
[2026-08-27] Khắc phục triệt để lỗi quái vật tự chết trong zone: bỏ ép bật Thần hộ mệnh Anubis/Đồng hành từ Lv.1 trong routes/game.js, bổ sung getMonstersInView gửi đầy đủ quái bao phủ màn hình, phân biệt quái chết thật vs quái ra khỏi tầm nhìn (fade out) trên Client xhrpg_canvas.js, và áp dụng hồi sinh so le ngẫu nhiên 3-7s trong WorldManager.js.
[2026-08-27] Khắc phục lỗi chức năng Lock Attack: trích xuất lock_pos trên server routes/game.js, đóng băng di chuyển khi isLocked = true, tự động ưu tiên target quái vật lọt vào tầm đánh (attackRange) và đồng bộ _syncLockBtn trên client.
[2026-08-27] Hoàn thiện hệ thống Mỏ khoáng Phi thuyền: chuẩn hóa mine_build, mine_up, mine_select_ore, mine_toggle, toggle_burn_wood và tích hợp vòng lặp game tick sản xuất quặng thời gian thực.
[2026-08-27] Cập nhật hệ thống Boss MVP giờ tròn: cấu hình quái hiếm MVP cho toàn bộ 13 map, phát sóng danh sách Boss toàn map qua getBossesForMap.
[2026-08-26] Khắc phục lỗi SQL 7 tham số cho Mock DB giúp nhân vật di chuyển giữa các zone mượt mà và lưu dữ liệu chính xác.
[2026-08-26] Bổ sung acquireLock cho warp.js và backfillModuleCards cho hệ thống khảm thẻ module/pet/anubis.
[2026-08-25] Thêm nút Trang bị (🛡️) vào hàng 2 menu dưới, kích hoạt bảng Equipment (openEq2Panel).
[2026-08-25] Di chuyển nút Xếp hạng (🏆) từ thanh menu dưới lên thành nút tròn nhỏ (26px) cạnh nút âm lượng.
[2026-08-25] Đồng bộ lại mảng _menu trong applyLang() khớp thứ tự DOM thực tế và bổ sung dịch từ 'Chợ' cho 'ตลาด·เทรด'.
[2026-08-25] Cập nhật CombatEngine, game.js và upgrade.js đồng bộ thuộc tính và sát thương game gốc.
```

## SESSION NOTES
```
- Đã khắc phục triệt để lỗi hiện tượng quái vật trong zone tự chết:
  + Bỏ force-enable Anubis 2748 dmg / Đồng hành từ Lv.1 trên Server, chỉ kích hoạt khi nhân vật thực sự mở khóa.
  + Thêm getMonstersInView bao phủ cả vị trí người chơi và explore center tối thiểu 350px.
  + Sửa logic Client xhrpg_canvas.js phân biệt rõ quái chết thật (có sát thương/HP <= 0) vs quái đi ra khỏi tầm nhìn (fade out trong 440ms thay vì ngã gục thành xác chết).
  + WorldManager.js hồi sinh ngẫu nhiên 3-7s giúp quái xuất hiện so le tự nhiên.
```
