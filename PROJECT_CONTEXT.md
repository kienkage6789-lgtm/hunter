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
Active:  None
Scope:   Xác minh hoạt động hệ thống game trên môi trường thực tế.
```

## RECENT COMPLETED (last 5)
```
[TASK-009] Tạo Premium Shop Route (xhrpg_premium.php)  DONE  25/08/2026
[TASK-007] GM Admin Endpoints (give_p, give_gold, set_level)  DONE  25/08/2026
[TASK-008] Hồi MP/Giáp tự động & cơ chế hấp thụ sát thương  DONE  23/08/2026
[TASK-001] Triển khai hệ thống Bang hội & Quốc chiến  DONE  23/08/2026
[TASK-002] Tích hợp DropSystem  DONE  22/08/2026
```

## KNOWN ISSUES
```
Không có lỗi nghiêm trọng nào được ghi nhận.
```

## DECISIONS LOG (last 5, newest first)
```
[2026-08-25] Điều chỉnh tốc độ hồi giáp cơ bản từ Math.max(1, vit / 10) lên cố định 5 giáp mỗi giây.
[2026-08-25] Khắc phục lỗi crash trong combat loop khi target chết (null pointer và duplicate reward handles).
[2026-08-25] Tích hợp lock để tránh race condition trên database JSON phẳng cho Premium Shop.
[2026-08-25] Hoàn thành Premium Shop endpoint (xhrpg_premium.php) và GM Admin endpoints.
[2026-08-23] Tích hợp hồi MP/Giáp tự động và hấp thụ sát thương qua giáp ở server.
```

## SESSION NOTES
```
Đã hoàn thành hệ thống Bang hội (Guild) & Quốc chiến (cwar) cục bộ, máy chủ hoạt động tốt.
Đã điều chỉnh tốc độ hồi giáp mặc định lên 5 giáp/s theo phản hồi người dùng.
Đã tích hợp cơ chế tự động hồi phục Giáp/MP và hấp thụ sát thương qua Giáp cho người chơi.
Đã hoàn thành Premium Shop (xhrpg_premium.php) và GM Admin API.
Sửa lỗi crash combat loop (`TypeError: Cannot read properties of null (reading 'id')`) trong `game.js`.
```
