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
[TASK-018] Hoàn thiện tính năng Mỏ khoáng Phi thuyền (Airship Mining System)  DONE  27/08/2026
[TASK-017] Sửa lỗi Boss MVP giờ tròn (:00) không xuất hiện & phát sóng Boss toàn map  DONE  27/08/2026
[TASK-016] Khắc phục lỗi di chuyển giữa các Zone (Spots) & đóng băng lưu dữ liệu do SQL mismatch  DONE  26/08/2026
[TASK-015] Khắc phục lỗi tranh chấp chuyển bản đồ (Warp Race Condition) với acquireLock  DONE  26/08/2026
[TASK-014] Khắc phục hiển thị & tính chỉ số khảm thẻ bài vào Module (backfillModuleCards)  DONE  26/08/2026
```

## KNOWN ISSUES
```
Không có lỗi nghiêm trọng nào được ghi nhận.
```

## LOG
```
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
- Đã khắc phục triệt để lỗi không xuất hiện Boss MVP lúc giờ tròn (:00):
  + WorldManager.js đã được cấu hình spawn các loại boss hiếm cho tất cả bản đồ (Map 1, 2, 3, 6, 7, 8, 9, 10, 13).
  + game.js trả về danh sách Boss MVP toàn bản đồ thay vì lọc trong phạm vi 300px quanh người chơi, giúp thanh HUD hiện nút Boss ngay lập tức.
- Đã chuẩn hóa cơ chế lưu dữ liệu SQL 7 tham số tương thích với Mock DB JSON (queries.js) giúp việc tự động di chuyển giữa các Zone hoạt động chính xác.
- Đã tích hợp acquireLock chống xung đột ghi đè giữa Warp và Game loop tick.
```
