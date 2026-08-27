# Sơ đồ Code (Code Map) — Ragnalok Private Server

_Cập nhật lần cuối: 23/08/2026_

## Tổng quan (Overview)
Dự án này là một máy chủ riêng (Private Server) hoàn toàn độc lập dành cho game **Ragnalok Online (XHRPG)**, giúp chạy game nội bộ không phụ thuộc vào máy chủ chính thức `ragnalok.online`. Hệ thống được thiết kế theo mô hình Client-Server: Client là game HTML5 Canvas nguyên bản (được sửa đổi cơ chế đăng nhập và liên kết URL), giao tiếp thông qua giao thức HTTP POST/GET giả lập các API PHP cũ; Server viết bằng Node.js + Express, xử lý mọi logic chiến đấu, phụ bản, vật phẩm, nông trại, bang hội và lưu trữ trạng thái người chơi vào cơ sở dữ liệu dạng JSON.

---

## Cây thư mục dự án (File Tree)
```
ragnalok-private-server/
├── client/                     ← Game client (từ game gốc, đã patch URL & Auth)
│   ├── xhrpg_canvas.js         ← Engine game Canvas chính (chứa toàn bộ logic render & gửi API)
│   ├── xhrpg_lang_vi.js        ← Từ điển dịch thuật Việt hóa Thái → Việt
│   ├── play.html               ← Giao diện đăng nhập local & khung chứa game canvas
│   ├── play_battle.html        ← Giao diện phụ phục vụ đấu trường PVP
│   └── assets/                 ← Hình ảnh sprites quái vật, nhân vật, hiệu ứng, âm thanh
├── server/                     ← Mã nguồn máy chủ Node.js + Express
│   ├── index.js                ← Điểm khởi chạy (Entry Point) của Express server
│   ├── db/                     ← Module quản lý cơ sở dữ liệu
│   │   ├── init.js             ← Khởi tạo schema & seed dữ liệu người chơi mặc định
│   │   └── queries.js          ← Engine truy vấn & ghi cơ sở dữ liệu dạng JSON
│   ├── game/                   ← Core logic tính toán trong game
│   │   ├── WorldManager.js     ← Quản lý spawn/respawn quái vật & vị trí live players
│   │   ├── CombatEngine.js     ← Tính toán sát thương, crit, double attack
│   │   └── DropSystem.js       ← Tính toán tỷ lệ rớt đồ (nguyên liệu, thẻ, trứng, module, trang bị)
│   └── routes/                 ← Định tuyến API giả lập các file PHP của game gốc
├── data/                       ← Dữ liệu tĩnh và tệp lưu trữ DB
│   ├── database.json           ← Database chính lưu thông tin tài khoản và người chơi
│   ├── maps_cache.json         ← Dữ liệu cache của 13 bản đồ game
│   ├── spots_cache.json        ← Tọa độ và thông tin các zone quái vật trên map
│   └── mon_masters_cache.json  ← Dữ liệu cấu trúc quái vật (Level, tên, emoji)
├── tests/                      ← Bộ kiểm thử tự động (Unit Test Suite)
│   └── test_4_skill_trees.js   ← Kiểm thử tự động 17 test case cho 4 nhánh kỹ năng
└── docs/                       ← Tài liệu phân tích và đảo ngược mã nguồn (Reverse Engineering)
```

---

## Liên kết Client-Server (Client-Server Route Mapping)

Dưới đây là bảng ánh xạ chi tiết giữa **hành động/hàm trên Client [xhrpg_canvas.js](file:///e:/game/ragnalok-private-server/client/xhrpg_canvas.js)** và **route xử lý của Server**:

| Endpoint gốc (PHP) | Route xử lý tương ứng | Hàm Client kích hoạt | Chức năng chính |
| :--- | :--- | :--- | :--- |
| `GET /xhrpg_google_auth.php` | [auth.js](file:///e:/game/ragnalok-private-server/server/routes/auth.js) | Khởi chạy game ban đầu | Đăng nhập tài khoản, xác thực phiên (Local Auth thay thế Google LIFF SDK). |
| `POST /xhrpg_game.php` | [game.js](file:///e:/game/ragnalok-private-server/server/routes/game.js) | `xhrpg.postGame()` (gọi liên tục mỗi 900ms) | **Vòng lặp game cốt lõi:** Đồng bộ vị trí player, tìm quái gần nhất, tính sát thương đòn đánh/hồi máu, xử lý kinh nghiệm, nhặt đồ và cấp độ. |
| `POST /xhrpg_warp.php` | [warp.js](file:///e:/game/ragnalok-private-server/server/routes/warp.js) | `xhrpg.warpToMap(mapId)` | Kiểm tra cấp độ yêu cầu của map đích và dịch chuyển tọa độ người chơi (13 Maps). |
| `POST /xhrpg_upgrade.php` | [upgrade.js](file:///e:/game/ragnalok-private-server/server/routes/upgrade.js) | Nút nâng cấp chỉ số, nút dùng Potion thủ công, menu phi thuyền, thu hoạch farm | **Xử lý nâng cấp đa năng:** Cộng stat (`stat_up`), cộng kỹ năng (`skill_up`), nâng đệ tử (Cat, Drone, Priest, Robot), trồng trọt (`home_plant`/`home_harvest`), cộng điểm pet (`pet_up`), xây dựng mỏ (`mine_build`/`mine_up`). |
| `POST /xhrpg_offline.php` | [offline.js](file:///e:/game/ragnalok-private-server/server/routes/offline.js) | Nút `🌙 OFFLINE` (`xhrpg.openOfflinePanel()`) | Tính toán tài nguyên, vàng và kinh nghiệm tích lũy khi người chơi treo máy offline (tối đa 8 giờ). |
| `POST /xhrpg_market.php` | [market.js](file:///e:/game/ragnalok-private-server/server/routes/market.js) | Khung chợ giao dịch (Market) | Lấy danh sách đang bán (`get_listings`), mua vật phẩm (`buy`), đăng bán đồ hoặc hủy bán. |
| `POST /xhrpg_arena.php` | [arena.js](file:///e:/game/ragnalok-private-server/server/routes/arena.js) | Menu Đấu trường (Arena) | Khiêu chiến boss 1v1 đấu trường, xem lịch sử đấu trường. |
| `POST /xhrpg_vip.php` | [vip.js](file:///e:/game/ragnalok-private-server/server/routes/vip.js) | Cửa hàng VIP | Nhận rương VIP hàng ngày, mua các đặc quyền VIP. |
| `POST /xhrpg_guild.php` | [guild.js](file:///e:/game/ragnalok-private-server/server/routes/guild.js) | Bảng Bang hội (Guild) | Tạo bang hội, gia nhập, đóng góp tài nguyên bang hội. |
| `POST /xhrpg_cwar.php` | [cwar.js](file:///e:/game/ragnalok-private-server/server/routes/cwar.js) | Công thành chiến / Nation War | Tham gia hoạt động công thành chiến bang hội. |
| `GET /xhrpg_leaderboard.php` | [leaderboard.js](file:///e:/game/ragnalok-private-server/server/routes/leaderboard.js) | `xhrpg.lbShow(uid)` | Xem hồ sơ trang bị chi tiết của người chơi khác (Profile Inspect) hoặc bảng xếp hạng. |
| `POST /xhrpg_trade.php` | [trade.js](file:///e:/game/ragnalok-private-server/server/routes/trade.js) | Giao diện giao dịch trực tiếp | Tìm kiếm người chơi khác theo tên (`search`), bắt đầu giao dịch an toàn. |
| `POST /xhrpg_droplog.php` | [droplog.js](file:///e:/game/ragnalok-private-server/server/routes/droplog.js) | Nhật ký nhặt đồ | Xem lịch sử nhận trang bị/vật phẩm quý hiếm (Lưu tối đa 100 dòng). |
| `POST /xhrpg_chat.php` | [chat.js](file:///e:/game/ragnalok-private-server/server/routes/chat.js) | Khung chat thế giới / DM | Tải tin nhắn mới (`fetch`/`dms`) và gửi tin nhắn chat (`send`). |
| `GET /xhrpg_online_count.php` | [online_count.js](file:///e:/game/ragnalok-private-server/server/routes/online_count.js) | HUD đếm người chơi | Trả về tổng số bot/player thực tế đang kết nối. |
| `POST /xhrpg_translate.php` | [translate.js](file:///e:/game/ragnalok-private-server/server/routes/translate.js) | Tính năng dịch chat tự động | Dịch tự động ngôn ngữ giữa các người chơi (đã chuyển tiếp không đổi). |

---

## Chi tiết các Module quan trọng (Module Specifications)

### 1. Engine cốt lõi máy chủ (Server Core)
*   **[WorldManager.js](file:///e:/game/ragnalok-private-server/server/game/WorldManager.js):**
    *   *Nhiệm vụ:* Quản lý trạng thái sống của quái vật và Boss MVP trên 13 bản đồ.
    *   *Logic:* Spawn mặc định 36 quái cho mỗi zone (spot) khi khởi động. Sinh Boss MVP loại hiếm mỗi giờ tròn (`spawnMvps()`) cho tất cả bản đồ và cung cấp phương thức `getBossesForMap(mapId)` lấy danh sách Boss toàn map. Chạy một hàm `tick()` mỗi 1 giây để xử lý hàng đợi hồi sinh quái vật (`respawnQueue`) và di chuyển quái vật ngẫu nhiên.
    *   *Đồng bộ:* Lưu trữ danh sách vị trí người chơi thời gian thực (`activePlayers`) phục vụ hiển thị các nhân vật khác cùng bản đồ.
*   **[CombatEngine.js](file:///e:/game/ragnalok-private-server/server/game/CombatEngine.js):**
    *   *Nhiệm vụ:* Tính toán sát thương chi tiết mỗi đòn đánh của nhân vật.
    *   *Logic:* 
        *   Sử dụng công thức nâng cấp Đao Kiếm gốc: `ATK = (STR - 5) * 3 + 10 + (knife_lv - 1) * 8 + knife_atk_lv * 6` (kèm Auto Double Swing: $1\%/\text{cấp} + 1\%$ mỗi 30 AGI).
        *   Sử dụng công thức Phi Đao gốc: `ATK = (DEX - 5) * 3 + 10 + (gun_pistol_lv - 1) * 8 + crit_shot_lv * 10` (+2% mỗi cấp).
        *   Tính tỷ lệ chí mạng chuẩn theo công thức game gốc: $\text{critChance} = (\min(50, \lfloor\frac{STR + LUK}{10}\rfloor) + \text{rag\_crit} \times 0.1) / 100$, nhân đôi sát thương khi chí mạng và trả về định dạng `{ dmg, crit }`.
        *   Giảm trừ qua thủ của quái (`DEF = monster.lv * 1.5`), dao động ngẫu nhiên biên độ $\pm10\%$.
*   **[DropSystem.js](file:///e:/game/ragnalok-private-server/server/game/DropSystem.js):**
    *   *Nhiệm vụ:* Sinh phần thưởng khi tiêu diệt quái vật.
    *   *Công thức nhân tỷ lệ (Multiplier):*
        $$\text{mult} = 1.0 + \text{premium\_drop} + \text{premium\_boost} + \text{vip\_bonus} + \text{luk\_bonus}$$
    *   *Các loại drop:* Nguyên liệu map (Gỗ/Đá/Thảo dược/Đồng/Sắt), Kim cương xanh/đỏ (tỷ lệ $0.035\%$/$0.014\%$), Thẻ bài & Trứng thú cưng (giảm dần từ $0.08\%$ xuống $0.002\%$ dựa theo lv quái), Module T1-T5, Trang bị eq2 (Đầu, Thân, Chân, Nhẫn kèm 1-3 affixes ngẫu nhiên).

### 2. Quản lý dữ liệu (JSON Database Interface)
*   **[queries.js](file:///e:/game/ragnalok-private-server/server/db/queries.js):**
    *   *Nhiệm vụ:* Giả lập thư viện SQLite thông thường nhưng lưu trữ dạng tệp tin phẳng [database.json](file:///e:/game/ragnalok-private-server/data/database.json) để tối giản cài đặt.
    *   *Phương thức:*
        *   `prepare(query).get(...args)`: Tìm kiếm tài khoản hoặc dữ liệu nhân vật bằng hàm `find()` của Javascript.
        *   `prepare(query).run(...args)`: Thêm tài khoản mới, tạo nhân vật mới hoặc cập nhật trạng thái (`UPDATE players SET`). Tự động parse và ghi dữ liệu đồng bộ vào file JSON.

---

## Hướng dẫn dựng lại máy chủ từ đầu (Server Setup & Reconstruction)

Nếu bạn cần dựng lại máy chủ này trên một môi trường mới, hãy thực hiện tuần tự các bước sau:

### Bước 1: Chuẩn bị môi trường
Yêu cầu cài đặt sẵn **Node.js** (Phiên bản khuyến nghị: >= 16.x).

### Bước 2: Tải và cài đặt các thư viện phụ thuộc
Di chuyển vào thư mục gốc dự án và chạy lệnh sau để tải các package cần thiết (`express`, `cors`):
```bash
npm install
```

### Bước 3: Khởi tạo Cơ sở dữ liệu JSON
Chạy script khởi tạo cơ sở dữ liệu để tạo tệp [database.json](file:///e:/game/ragnalok-private-server/data/database.json) cùng tài khoản seed mẫu mặc định:
```bash
node server/db/init.js
```
*Lưu ý:* Script này sẽ đọc dữ liệu mẫu `xhrpg_game_sample_utf8.json` từ thư mục `data/captured_responses/` để tạo nhân vật mẫu đầy đủ trang bị.

### Bước 4: Khởi chạy máy chủ game
Khởi động server trên cổng mặc định (3000):
```bash
npm start
```

### Bước 5: Kết nối và trải nghiệm game
Mở trình duyệt Web của bạn và truy cập đường dẫn:
```
http://localhost:3000/
```
Giao diện đăng nhập cục bộ sẽ xuất hiện. Bạn có thể sử dụng tính năng **Đăng ký** tài khoản mới hoặc đăng nhập bằng tài khoản đã được khởi tạo trong database để vào thế giới Ragnalok độc lập hoàn toàn.
