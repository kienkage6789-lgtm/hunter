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
[TASK-013] Thêm nút Trang bị (🛡️) vào menu dưới để mở bảng Equipment  DONE  25/08/2026
[TASK-012] Di chuyển nút Xếp hạng lên góc trên trái cạnh nút âm lượng  DONE  25/08/2026
[TASK-011] Sửa lỗi sai chức năng khi click nút Trang bị (Equipment) và Vật phẩm (Item)  DONE  25/08/2026
[TASK-010] Đồng bộ cơ chế thuộc tính và chiến đấu theo game gốc  DONE  25/08/2026
[TASK-009] Tạo Premium Shop Route (xhrpg_premium.php)  DONE  25/08/2026
```

## KNOWN ISSUES
```
Không có lỗi nghiêm trọng nào được ghi nhận.
```

## DECISIONS LOG (last 5, newest first)
```
[2026-08-25] Thêm nút Trang bị (🛡️) vào hàng 2 menu dưới, kích hoạt bảng Equipment (openEq2Panel).
[2026-08-25] Di chuyển nút Xếp hạng (🏆) từ thanh menu dưới lên thành nút tròn nhỏ (26px) cạnh nút âm lượng.
[2026-08-25] Đồng bộ lại mảng _menu trong applyLang() khớp thứ tự DOM thực tế và bổ sung dịch từ 'Chợ' cho 'ตลาด·เทรด'.
[2026-08-25] Cập nhật CombatEngine, game.js và upgrade.js đồng bộ thuộc tính và sát thương game gốc.
[2026-08-25] Điều chỉnh tốc độ hồi giáp cơ bản từ Math.max(1, vit / 10) lên cố định 5 giáp mỗi giây.
```

## SESSION NOTES
```
Đã hoàn thành hệ thống Bang hội (Guild) & Quốc chiến (cwar) cục bộ, máy chủ hoạt động tốt.
Đã đồng bộ cơ chế thuộc tính (Stats), sát thương đa vũ khí và chỉ số phòng thủ DEF chuẩn theo game gốc.
Đã điều chỉnh tốc độ hồi giáp mặc định lên 5 giáp/s theo phản hồi người dùng.
Đã tích hợp cơ chế tự động hồi phục Giáp/MP và hấp thụ sát thương qua Giáp cho người chơi.
```
