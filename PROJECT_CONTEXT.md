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

## WORK LOG & NEXT PLAN
```
ĐÃ HOÀN TẤT:
- TASK-021→TASK-036: hoàn thiện các hệ thống Market, Trade, Upgrade, Auth/Admin, Endpoint Coverage, Chat/Image, Offline opt-in, PvP, Raid, Arena, CWAR, Guild Log, GWAR/Ranking, GM Admin và Logout token revocation.
- TASK-037: release-readiness hardening; master regression 25/25 PASS, syntax/diff check sạch, database sạch, test runner có process exit và đã dọn các runner Node còn sót trong phiên QC.

ĐANG HOÃN:
- Premium Shop/VIP audit: DEFERRED cho tới khi có phương thức thanh toán; không triển khai payment khi chưa có provider/contract.

KẾ HOẠCH TIẾP THEO:
1. Giữ payment endpoints ở safe 501 và không cho UI báo giao dịch thành công giả.
2. Khi có payment provider: lập task riêng audit Premium/VIP, idempotency giao dịch, webhook/signature, replay protection, refund/rollback và test sandbox.
3. Trước phát hành production: chạy lại `node tests/run_all_tests.js`, kiểm tra database/temp artifacts, đóng test file/terminal/background runner và xác nhận không còn process test.
4. Sau khi có payment contract: cập nhật `PROJECT_CONTEXT.md`, `docs/PLAN.md` và release checklist.
```

## RECENT COMPLETED (last 5)
```
[TASK-037] Release-Readiness Hardening, Security Audit & Master Regression Suite (25/25 PASS)  DONE  30/08/2026
[TASK-036] Hoàn thiện Logout session token revocation (P2)  DONE  30/08/2026
[TASK-035] Hoàn thiện GM Admin give-item & spawn-boss  DONE  30/08/2026
[TASK-034] Hoàn thiện Guild War / GWAR server-authoritative & Guild Ranking  DONE  30/08/2026
[TASK-033] Hoàn thiện Guild Audit Log (P2)  DONE  30/08/2026
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
- P1 Arena (TASK-031): đã thay cấp thưởng trực tiếp bằng state machine boss `IDLE→ENTER→ACTIVE→WIN/LOSE/TIMEOUT`, combat HP/damage server-side, ticket/quota, skip có điều kiện, reward idempotent, auth/lock/rollback và poll events; test 9/9 x2 PASS.
- P1 Nation War/CWAR (TASK-032): đã triển khai Country Flag War server-authoritative, Map 4 Colosseum, state machine `IDLE→PRE→OPEN→FIGHT→ENDED`, PvP `PVP_DIV=30`, chặn friendly fire, spawn shield 5s, tính điểm hạ gục Lv>=20 (+5 pts), tie-break timestamp, quorum min 2 countries + 4 players, flag holder (`cwc`), flag buff (`cwf`), auto-return `home_return` sau ended, feed `war_log`, session auth 401, lock/rollback; test 11/11 x2 PASS.
- P2 Guild Log (TASK-033): đã triển khai endpoint `action: 'log'` và tự động ghi nhật ký tại tất cả 12 điểm đột biến (`create`, `join`, `leave`, `kick`, `donate`, `levelup`, `promote`, `demote`, `transfer`, `emblem`, `notice`, `disband`), format `created_at` YYYY-MM-DD HH:mm:ss, prune limit tối đa 50 bản ghi, phân quyền member-only chống rò rỉ bang hội khác, session auth 401, acquireLock và snapshot rollback; test 11/11 x2 PASS.
- P2 Guild War & Ranking (TASK-034): đã triển khai Guild Flag War server-authoritative, Map 4 Colosseum, state machine `IDLE→PRE→OPEN→FIGHT→ENDED`, PvP `PVP_DIV=30`, chặn friendly fire cùng bang và liên minh (alliance), cooldown 48h gia nhập bang (`can: false`, `cd_h`), tính điểm hạ gục target Lv>=40 (+1 pt), chống farm lặp (max 3 pts/nạn nhân/trận chiến), tie-break timestamp, quorum min 2 guilds + 4 players, flag holder & streak, flag buff `gwf = {e: 1.1, g: 1.1}` cho bang và liên minh, auto-return `home_return` sau ended, feed `war_log`, guild ranking real flag holder, tích hợp server-authoritative kill & HP tracking trực tiếp trong game loop `/xhrpg_game.php`, tự động lưu & khôi phục trạng thái runtime (`gwar_runtime`: state, scores, participants, victimKills, processedKills) khi server restart, session auth 401, acquireLock và snapshot rollback; test 14/14 x2 PASS.
- P2 GM Admin (TASK-035): đã bổ sung đủ `give-item` (resources, boxes, cards, eggs, modules max 30 slots, eq2 max 50 slots) và `spawn-boss` (tích hợp WorldManager, map 1-13, tọa độ, custom stats, giới hạn 15 boss/map), bảo mật Header-only API key, chặn query/body key, idempotency `req_id`, admin audit log `admin_logs`, acquireLock và snapshot rollback; test 14/14 x2 PASS.
- P2 Logout (TASK-036): đã chuẩn hóa hàm `logout()` trên Client cho tất cả nhánh (Google, LIFF, Local) gửi POST `xhrpg_logout.php` với timeout 3000ms và fail-safe cleanup; Server thu hồi `session_token = null`, chặn 401 khi token sai/đã thu hồi, chặn 100% token cũ trên mọi game routes, acquireLock và snapshot rollback; test 8/8 x2 PASS.
- TASK-037 Release-readiness Hardening & Security Audit: Master Test Matrix chạy toàn diện 25/25 test suites PASS 100% (48.51s); lifecycle test runner chuẩn hóa process exit sạch sẽ, 0 dangling processes, 0 rò rỉ database, hệ thống sẵn sàng phát hành.

TODO theo ưu tiên:
- P2 Premium Shop / VIP audit — DEFERRED, chờ tích hợp phương thức thanh toán.
```

## LOG
```
[2026-08-30] Hoàn thiện Guild Flag War (TASK-034), Guild Audit Log (TASK-033), Nation War / CWAR (TASK-032), Arena Boss (TASK-031); chuẩn hóa server-authoritative, audit log persistence, session auth 401, atomic rollback và kiểm thử hồi quy 100% PASS.
[2026-08-30] Hoàn thiện TASK-035 GM Admin, TASK-036 Logout token revocation và TASK-037 Release-Readiness Hardening; Premium Shop/VIP tạm hoãn vì chưa có payment provider. Master regression 25/25 PASS, database và test runner đã dọn sạch.
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
