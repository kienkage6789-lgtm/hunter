# 🛸 HƯỚNG DẪN TRA CỨU NHANH API GAME RAGNALOK ONLINE

Tài liệu này ghi lại toàn bộ các hàm cốt lõi, công thức toán học và endpoints kết nối trong client game [xhrpg_canvas.js](file:///C:/Users/Admin/Desktop/auto/xhrpg_canvas.js). Sử dụng tài liệu này để tra cứu nhanh khi cần nâng cấp hoặc mở rộng các tính năng tự động hóa trong tương lai.

---

## 🗺️ 1. Bản đồ & Dịch chuyển (Map & Warping)

Game quản lý bản đồ thông qua file PHP trung chuyển `/xhrpg_warp.php`.

*   **Danh sách Bản đồ**: Được lưu tại hằng số `MAP_DEFS` dòng `10943`:
    ```javascript
    const MAP_DEFS = [
      { id: 1, name: 'ทุ่งกลาง', emoji: '🌿', req: 1 },      // Thung lũng Trung tâm
      { id: 2, name: 'ทะเลทรายนิรันดร์', emoji: '🏜️', req: 25 }, // Sa mạc Vĩnh hằng
      { id: 3, name: 'ดินแดนเยือกแข็ง', emoji: '❄️', req: 40 }, // Vùng đất Băng giá
      { id: 5, name: 'ซากอารยธรรมโบราณ', emoji: '🏛️', req: 55 }, // Tàn tích Cổ đại
      { id: 6, name: 'ภูเขาไฟเดือด', emoji: '🌋', req: 70 }, // Núi lửa Sôi trào
      { id: 4, name: 'สนามประลอง', emoji: '⚔️', req: 20 }     // Đấu trường Arena (PVP)
    ];
    ```
*   **Hàm dịch chuyển**: [warpToMap](file:///C:/Users/Admin/Desktop/auto/xhrpg_canvas.js#L10957-L10972) gửi POST đến `/xhrpg_warp.php` với tham số `target_map`.
*   **Hàm di chuyển đến Zone**: [goToSpot](file:///C:/Users/Admin/Desktop/auto/xhrpg_canvas.js#L10894-L10912) điều khiển di chuyển nhân vật về tọa độ `spot.cx` và `spot.cy` của Zone đã chọn.

---

## 📈 2. Công thức tính chi phí nâng cấp (Upgrade Formulas)

Nằm ở đoạn giữa của [xhrpg_canvas.js](file:///C:/Users/Admin/Desktop/auto/xhrpg_canvas.js#L3890-L3912):

*   **Vàng cơ bản theo cấp**:
    $$\text{tierGold}(lv) = \text{START}[b] + \text{pos} \times \frac{\text{END}[b] - \text{START}[b]}{9}$$
    Trong đó $b = \lfloor(lv - 1) / 10\rfloor$ và $\text{pos} = (lv - 1) \pmod{10}$.
*   **Tài nguyên cơ bản (Res - đá, gỗ, sắt...) theo cấp**:
    $$\text{tierRes}(lv) = \text{START\_RES}[b] + \text{pos} \times \frac{\text{END\_RES}[b] - \text{START\_RES}[b]}{9}$$
*   **Hệ số nhân theo cấp độ mục tiêu**:
    $$\text{\_upgCostMult}(lv\_target) = 1.0 + 0.25 \times (\lfloor lv\_target / 10 \rfloor - 1)$$ (với $lv\_target \ge 20$, nhỏ hơn $20$ hệ số mặc định là $1.0$).

---

## 🐱 3. Quản lý Đệ tử & Robot (Followers & Companions)

Tất cả các hành động này gửi POST đến `/xhrpg_upgrade.php` kèm tham số `action`.

*   **Nâng cấp Mèo (Cat)**: `action: 'upgrade_cat'`. Tăng giới hạn kho và khoảng cách nhặt đồ.
*   **Nâng cấp Drone**: `action: 'upgrade_drone'`. Tự động nhặt đồ và tấn công quái phụ.
*   **Nâng cấp Linh mục hỗ trợ (Priest)**: `action: 'priest_up'`. Tự động hồi phục máu/giáp.
*   **Nâng cấp Titan Robot**: `action: 'robot_body_up'`. Tăng chỉ số sát thương hỗ trợ.

---

## ⛏️ 4. Phi thuyền Orion & Khai thác mỏ (Airship & Mining)

Khai thác mỏ chịu ảnh hưởng bởi cấp độ phi thuyền (`house_lv`) và năng lượng (`house_energy`).

*   **Xây dựng mỏ (Mine Build)**: `action: 'mine_build'`, kèm tham số `slot` (0-5) và `ore` (loại quặng: `gold`, `wood`, `stone`, `iron`, `copper`, `herb`).
*   **Nâng cấp mỏ (Mine Upgrade)**: `action: 'mine_up'`, kèm tham số `slot`.
*   **Bật/Tắt mỏ khai thác (Mine Toggle)**: `action: 'mine_toggle'`, kèm tham số `slot`.
*   **Các bộ sản xuất khí tài**: Tắt/Mở sản xuất qua lệnh `action: 'house_toggle'` kèm `param: 'pistol' | 'sniper' | 'robot'`. Đối với Potion sử dụng `action: 'toggle_house_potion_prod_tier'` kèm `tier: 1` và `on: 1 | 0`.

---

## ⚡ 5. Hệ thống Kỹ năng & Ràng buộc (Skills Tree)

Khai báo hằng số `SKILL_DEFS` nằm tại [xhrpg_canvas.js:L12140](file:///C:/Users/Admin/Desktop/auto/xhrpg_canvas.js#L12140). Bảng điều kiện ràng buộc kỹ năng (Prerequisites):

| Mã Kỹ Năng (ID) | Tên Kỹ Năng | Cấp Yêu Cầu | Yêu cầu Kỹ năng khác |
| :--- | :--- | :--- | :--- |
| `kill_shot` | Cú bắn chí mạng 💀 | - | `crit_shot` $\ge 3$ |
| `explosive_shot` | Dao nổ hỏa lực 💥 | $\ge 30$ | `crit_shot` $\ge 5$ và `kill_shot` $\ge 5$ |
| `lock_on` | Khóa mục tiêu 🧿 | $\ge 40$ | `explosive_shot` $\ge 5$ |
| `triple_knife` | Tam phi đao 🔱 | $\ge 50$ | `lock_on` $\ge 5$ |
| `armor_up` | Tăng cường giáp 🛡️ | - | `tough_body` $\ge 3$ |
| `hp_regen` | Hồi máu tự động 💚 | - | `tough_body` $\ge 5$ |
| `pull_monster` | Nam châm hút quái 🧲 | $\ge 30$ | `hp_regen` $\ge 5$ và `armor_up` $\ge 5$ |
| `double_attack` | Song kiếm hiệp bích ⚔️ | - | `knife_atk` $\ge 5$ |
| `spin_attack` | Kiếm xoay bão lốc 🌀 | $\ge 30$ | `knife_atk` $\ge 5$ và `double_attack` $\ge 5$ |
| `turret_rapid` | Gia tăng tốc độ bắn ⏳ | - | `deploy_turret` $\ge 3$ |
| `twin_turret` | Đặt ụ súng đôi 🗼 | $\ge 30$ | `deploy_turret` $\ge 5$ và `turret_rapid` $\ge 5$ |

---

## 🔒 6. Các Endpoints Quản Lý của Bot Manager (Manager Authentication & Integration)

Dưới đây là danh sách các API và Endpoint nội bộ của Server Bot Manager dùng để quản trị tài khoản game và xác thực phiên:

### A. Quản lý Phiên & Token Đăng Nhập Game
*   **API trích xuất Token qua PHPSESSID**: `POST /api/add-by-phpsessid`
    *   **Tham số**: `{ phpsessid: "chuỗi_cookie_hoặc_raw_phpsessid" }`
    *   **Cơ chế**: Server sử dụng proxy pool gửi GET request kèm header `cookie: PHPSESSID=...` tới `https://ragnalok.online/human/xhrpg_google_auth.php` để lấy về cấu trúc thông tin nhân vật (`line_uid`, `session_token`, tên nhân vật) và tự động tạo bot.
*   **Trình bắt Token tự động (Token Sniffer Proxy)**: `GET /login-helper`
    *   **Cơ chế**: Proxy tải giao diện game và inject script token sniffer ghi đè hàm `window.startGame` và `$.post` của game client. Ngay khi người dùng đăng nhập bằng Google thành công, script sẽ tự động capture `line_uid` & `session_token` rồi gửi về Endpoint `/api/auto-add-account`.
*   **API Lưu Tài Khoản tự động**: `POST /api/auto-add-account`
    *   **Tham số**: `{ line_uid, session_token, name }`
    *   **Cơ chế**: Lưu trữ thông tin bot vào `accounts.json` và kích hoạt luồng bot chạy ngầm lập tức.

### B. Client Treo Máy Cục Bộ (Local Play Interface)
*   **Cổng Game Proxy**: `GET /play?line_uid=...&session_token=...`
    *   **Cơ chế**: Trả về giao diện client game đã được inject các bản vá bypass chống idle kick (`_lastInputAt = Date.now()` và `_tabHiddenAt = 0`). Tất cả dữ liệu game đều đi qua proxy của Manager để vượt qua lỗi CORS và Cloudflare Block.

### C. Quản lý Phiên làm việc (Dashboard Sessions)
*   **Session Token**: Cookie `auth_token` được lưu tự động trên trình duyệt của người dùng (HttpOnly, SameSite=Lax) dùng để xác thực quyền truy cập Dashboard và các API quản lý bot.

### D. Các API Quản trị Tài khoản & Proxy Pool
*   **API Lấy danh sách Tài khoản**: `GET /api/accounts`
    *   **Mô tả**: Trả về danh sách tài khoản game của user hiện tại (hoặc tất cả nếu là admin).
    *   **Bảo mật**: Trường `proxyInfo` chỉ được trả về nếu người dùng đăng nhập có vai trò `admin`.
    *   **Thống kê hiệu suất**: Trả về trường `combatRates` chứa các chỉ số `{ killsPerMin, goldPerMin, expPerMin }` được tính toán thời gian thực theo cơ chế Sliding Window (cửa sổ trượt 5 phút).
    *   **Thông tin săn Boss thời gian thực**: Trả về thêm các trường phục vụ hiển thị banner trạng thái và live list:
        *   `bossHuntActive`: Boolean (`true` nếu đang bật chế độ săn boss khác `'off'`).
        *   `isMvpCycling`: Boolean (`true` nếu đang chạy chu kỳ xoay vòng map săn boss).
        *   `currentMvpBossInfo`: Object `{ id, name, emoji, lv, mapId, startTs }` chứa thông tin chi tiết boss đang bị khóa mục tiêu di chuyển/tấn công (hoặc `null` nếu chưa có target).
        *   `aliveBossCount`: Số lượng boss còn sống trên map hiện tại.
        *   `aliveBosses`: Mảng chứa thông tin các boss đang sống trên map hiện tại.
    *   **Cấu hình Phân quyền Polling**: Trả về thêm thông tin cấu hình nhịp polling của User sở hữu bot:
        *   `ownerPollInterval` (number): Nhịp Polling mặc định của tài khoản User sở hữu (ví dụ `1500` hoặc `1100`).
        *   `ownerAllowEditPollInterval` (boolean): Trạng thái cấp quyền tự chỉnh sửa Nhịp Polling cho User này.
*   **API Cập nhật Cấu hình**: `PUT /api/accounts/:line_uid`
    *   **Tham số**: `{ settings: { targetMap, bossHuntMode, mvpPriorityMode, mvpTargetMaps, pollInterval, ... }, proxyId }`
    *   **Chi tiết Săn Boss**:
        *   `bossHuntActive` / `bossHuntMode`: Chế độ săn boss.
        *   `mvpTargetMaps`: Bản đồ chỉ định cho Loại 2.
    *   **Ràng buộc Nhịp Polling (`pollInterval`)**:
        *   Chỉ cho phép cập nhật `settings.pollInterval` nếu người gọi là `admin` hoặc User được cấp quyền `allowEditPollInterval === true`.
        *   Nếu User thường không có quyền cố tình gửi `pollInterval`, trường này sẽ tự động bị loại bỏ trước khi lưu cấu hình.
    *   **Cấu hình Proxy (Chỉ Admin)**: Hỗ trợ trường `proxyId` (`'auto'`, `'direct'`, hoặc ID proxy cụ thể) để thay đổi proxy gán cho bot và cập nhật cấu hình tài khoản.
    *   **Xác thực bản đồ**: Xác thực cấp độ yêu cầu của bản đồ đích. Trả về mã lỗi HTTP 400 nếu cấp độ của nhân vật (`bot.player.lv`) nhỏ hơn yêu cầu tối thiểu của bản đồ đó.
*   **API Kích hoạt Hành động**: `POST /api/accounts/:line_uid/action`
    *   **Tham số**: 
        *   Dịch chuyển bản đồ: `{ action: 'warp', param: target_map_id }` (Xác thực cấp độ tương ứng).
        *   Bật/tắt kỹ năng tự động: `{ action: 'skill_toggle', extra: { skill_id: 'skill_id_string' } }` (Tự động chuyển tiếp yêu cầu đến `xhrpg_upgrade.php` của game server).
        *   Kích hoạt săn Boss ngay (Force Hunt): `{ action: 'force_mvp_hunt' }`. Tự động thiết lập `bossHuntMode` thành `'type2'`, lưu cấu hình và kích hoạt chu kỳ săn Boss xoay vòng ngay lập tức.
*   **API Thêm Proxy Pool**: `POST /api/admin/proxies` (Chỉ dành cho Admin)
    *   **Tham số**: `{ label, url }`
    *   **Cơ chế**: Backend tự động phân tích cú pháp nếu `url` là chuỗi dạng thô (không bắt đầu bằng http/socks):
        *   `IP:PORT:USER:PASS` -> Tự động chuyển đổi thành `http://USER:PASS@IP:PORT` và tự sinh nhãn (label) `IP:PORT` an toàn (tránh lộ thông tin tài khoản/mật khẩu).
        *   `IP:PORT` -> Tự động chuyển đổi thành `http://IP:PORT` và tự sinh nhãn `IP:PORT`.
*   **API Kiểm tra Kết nối Proxy**: `POST /api/admin/proxies/:id/test` (Chỉ dành cho Admin)
    *   **Mô tả**: Ping thử qua proxy (hoặc direct) tới game server `https://ragnalok.online/human/index.php`. Trả về trạng thái hoạt động `{ success: true, latency }` hoặc `{ success: false, error }`.

---

## 🏡 7. Hệ Thống Nông Trại (Home Farm System)

Nông trại quản lý thông qua file PHP trung chuyển `/xhrpg_upgrade.php` (hoặc `/xhrpg_home.php` cho việc tham quan).

### Cấu Trúc Dữ Liệu Player
* `home_lv`: Cấp độ nhà nông trại (Lv.1 = 1 Plot = 16 ô đất).
* `home_crops`: Mảng thông tin các luống đất đang trồng:
  ```json
  [
    { "p": 0, "i": 0, "s": 7, "t": 1785335276 },
    { "p": 0, "i": 1, "s": 4, "t": 1785335975 }
  ]
  ```
  * `p`: Chỉ số Plot (0..4).
  * `i`: Chỉ số ô đất trong Plot (0..15).
  * `s`: Seed ID (1..24).
  * `t`: Unix timestamp (giây) lúc gieo hạt.
* `home_seeds`: Object số lượng hạt giống trong kho:
  ```json
  { "1": 72, "2": 13, "3": 80 }
  ```
* `home_return`: Vị trí bản đồ gốc khi rời Nông trại `{ map: 7, x: 999.25, y: 1040.85 }`.

### Thời Gian Tăng Trưởng Cây Trồng theo Seed ID (`s`)
* Tier 1 (ID 1-4): 1 giờ (3.600s)
* Tier 2 (ID 5-8): 2 giờ (7.200s)
* Tier 3 (ID 9-12): 4 giờ (14.400s)
* Tier 4 (ID 13-16): 8 giờ (28.800s)
* Tier 5 (ID 17-20): 16 giờ (57.600s)
* Tier 6 (ID 21-24): 24 giờ (86.400s)

### Endpoints Nông Trại (`/xhrpg_upgrade.php`)
* **Thu hoạch & Bán**: `{ action: 'home_harvest' }`
* **Gieo hạt**: `{ action: 'home_plant', seed: target_seed_id, all: 1 | 0 }`
* **Nâng cấp nhà**: `{ action: 'home_up' }`

---

## 🐾 8. Hệ Thống Thú Cưng (Pet & Egg System)

Tất cả các thao tác nâng cấp chỉ số Pet gửi POST tới `/xhrpg_upgrade.php`.

### Cấu Trúc Dữ Liệu Player
* `pet_mid`: ID quái vật Pet đang theo sau (`0` = chưa xuất chiến).
* `pet_exp`: Tổng điểm kinh nghiệm Pet tích lũy (BIGINT).
* `pet_mvp`: Cờ MVP của Pet (`1` = MVP, `0` = Thường).
* `pet_olv`: Level quái vật gốc.
* `pet_up_atk`, `pet_up_hp`, `pet_up_reco`: Số điểm đã cộng vào ATK, DEF/HP, Phục Hồi.
* `pet_batk`, `pet_bhp`: Chỉ số ATK & HP cơ bản.

### Công Thức Cốt Lõi Pet
* **Công thức EXP Lên Cấp Pet (`expNextPet`)**:
  ```javascript
  function expNextPet(lv) {
    if (lv >= 41) return 100000000 + (lv - 41) * 15000000;
    let e = 100;
    for (let k = 2; k <= lv; k++) {
      const b = k <= 10 ? 1.50 : k <= 20 ? 1.45 : k <= 30 ? 1.40 : 1.35;
      e = Math.round(e * b);
    }
    return e;
  }
  ```
* **Số Điểm Nâng Cấp Khả Dụng (`st.pts`)**:
  $$\text{st.pts} = \max\left(0, (\text{Pet Level} - 1) - (\text{pet\_up\_atk} + \text{pet\_up\_hp} + \text{pet\_up\_reco})\right)$$
* **Chỉ Số Chiến Đấu**:
  * $\text{ATK} = \max\left(1, \text{Math.round}(\text{pet\_batk} \times (2 + 0.20 \times \text{petLv} + 0.30 \times \text{pet\_up\_atk}) \times \text{mvp})\right)$
  * $\text{DEF} = \max\left(0, \text{Math.round}((\text{pet\_olv} + \text{petLv} + 2 \times \text{pet\_up\_hp}) \times \text{mvp})\right)$
  * $\text{HP Max} = \max\left(1, \text{Math.round}(0.5 \times \text{pet\_bhp} \times (1 + 0.25 \times \text{petLv}) \times \text{mvp})\right)$
  * $\text{Regen} = 1.0 + 0.20 \times \text{pet\_up\_reco}\quad (\%/\text{giây})$

### Endpoints Thú Cưng (`/xhrpg_upgrade.php`)
* **Cộng điểm Pet**: `{ action: 'pet_up', stat: 'atk' | 'hp' | 'reco' }`

---

## 🔍 9. API Truy Vấn & Xem Trang Bị Người Chơi Khác (Inspect & Player Query APIs)

Dưới đây là các API chính thức của game dùng để tra cứu và xem chi tiết trang bị của người chơi khác:

### A. API Tra Cứu UID Theo Tên Người Chơi
Dùng để tìm kiếm UID của một người chơi dựa vào Tên hiển thị (Tên trên bản đồ).
*   **Endpoint**: `/xhrpg_trade.php`
*   **Phương thức**: `POST`
*   **Tham số gửi**:
    ```json
    {
      "action": "search",
      "q": "Tên_người_chơi_cần_tìm",
      "line_uid": "line_uid_của_bạn",
      "session_token": "session_token_của_bạn",
      "lang": "vi"
    }
    ```
*   **Cấu trúc dữ liệu trả về**:
    ```json
    {
      "ok": true,
      "players": [
        {
          "uid": "U12345678",
          "name": "Tên_người_chơi",
          "cc": "VN",
          "vip": 5,
          "lv": 70
        }
      ]
    }
    ```

### B. API Tải Chi Tiết Trang Bị & Sức Mạnh (Profile Inspect)
Dùng để xem toàn bộ thông tin trang bị, stats, card, trứng của người chơi đó (Hàm `xhrpg.lbShow(uid)` gốc gọi API này).
*   **Endpoint**: `/xhrpg_leaderboard.php`
*   **Phương thức**: `GET`
*   **Tham số gửi**: `{ show: "uid_người_chơi_cần_xem" }`
*   **Cấu trúc dữ liệu trả về**:
    ```json
    {
      "ok": true,
      "uid": "U12345678",
      "name": "Tên_người_chơi",
      "lv": 70,
      "rag": 2,
      "def": 15240,
      "stat": {
        "str": 120,
        "agi": 80,
        "vit": 50,
        "int": 5,
        "dex": 80,
        "luk": 5
      },
      "eq": [
        {
          "t": 6,
          "p": 5,
          "lv": 50,
          "af": [["Tấn công%", 120]]
        }
      ],
      "cards": { "t": 12 },
      "eggs": { "t": 4 },
      "book": [...]
    }
    ```

---

## 🏪 10. Hệ Thống Tự Động Mua Chợ Giá Rẻ (Auto Market Buy System)

Hệ thống Auto Market Buy tự động kết nối với chợ game qua Endpoint `/xhrpg_market.php` để tìm kiếm và mua vật phẩm thỏa mãn bộ lọc với mức giá tốt nhất.

### A. Endpoints Chợ Game Client (`/xhrpg_market.php`)
* **Lấy Danh Sách Vật Phẩm Đang Bán**:
  * **Endpoint**: `/xhrpg_market.php`
  * **Phương thức**: `POST`
  * **Tham số**: `{ action: 'get_listings', line_uid, session_token, lang: 'vi' }`
  * **Dữ liệu trả về**:
    ```json
    {
      "ok": true,
      "listings": [
        { "id": 101, "item_name": "การ์ด ไก่เจี๊ยบ (1⭐)", "item_type": "card", "price_per": 500, "qty": 1 },
        { "id": 201, "item_name": "โมดูลมีด T3", "item_type": "module_knife", "price_per": 2500, "qty": 1 }
      ]
    }
    ```
* **Mua Vật Phẩm Trực Tiếp**:
  * **Endpoint**: `/xhrpg_market.php`
  * **Phương thức**: `POST`
  * **Tham số**: `{ action: 'buy', line_uid, session_token, listing_id, qty: 1, lang: 'vi' }`
  * **Dữ liệu trả về**:
    * Mua thành công: `{ ok: true, player: { gold, ... } }`
    * Thất bại (đồ bị mua trước): `{ ok: false, error: "Sản phẩm đã bị người khác mua mất" }`

### B. Endpoints Nội Bộ Quản Lý Lịch Sử Mua Hàng (Bot Manager APIs)
* **Lấy Lịch Sử Mua Hàng**: `GET /api/accounts/:line_uid/market-buy-history`
  * Trả về mảng `history` (tối đa 50 lượt mua gần nhất).
* **Xóa Lịch Sử Mua Hàng**: `DELETE /api/accounts/:line_uid/market-buy-history`
  * Trả về `{ ok: true, message: "Đã xóa lịch sử mua chợ" }`.

### C. Thuật Toán Phân Loại 9 Nhóm Vật Phẩm (`getItemCategory`)
1. `card_box`: Hộp thẻ bài.
2. `egg_box`: Hộp trứng thú cưng.
3. `module_box`: Hộp module.
4. `card`: Thẻ quái vật lẻ (72 quái thường + 72 MVP = 144 loại).
5. `egg`: Trứng thú cưng lẻ (72 quái thường + 72 MVP = 144 loại).
6. `module`: Module trang bị lẻ (Phân theo Tier T1 đến T5).
7. `collectible`: Đồ sưu tầm (Linh kiện Titan, Phi thuyền, Bảo vật, Khung đúc...).
8. `diamond`: Kim cương.
9. `resource`: Nguyên liệu rác (Đá, Thuốc, Đạn, Gỗ, Quặng...) — **Mặc định OFF**.

### D. Cấu Trúc Cấu Hình Settings Bot
```json
{
  "autoMarketBuy": true,
  "marketMaxPrice": 10000,
  "marketScanInterval": 10,
  "marketCategories": {
    "module": true,
    "card": true,
    "egg": true,
    "collectible": true,
    "resource": false,
    "card_box": true,
    "egg_box": true,
    "module_box": true,
    "diamond": true
  },
  "marketSelectedCards": ["Gà con", "Vua Slime tím"],
  "marketSelectedEggs": ["Slime xanh lá"],
  "marketSelectedModuleTiers": ["T1", "T2", "T3", "T4", "T5"],
  "marketSelectedCollectibles": ["Linh kiện Titan", "Bảo vật"]
}
```

---

## 🎮 11. Các API Bảng Điều Khiển Cốt Lõi (Core Control Panel APIs)

Các API này phục vụ cho các thẻ giao diện trên thanh công cụ và hộp thoại của client game:

### A. API Lịch sử Nhặt đồ (Drop Log)
*   **Endpoint**: `/xhrpg_droplog.php`
*   **Phương thức**: `POST`
*   **Tham số**: `{ line_uid, session_token }`
*   **Dữ liệu trả về**: `{ ok: true, drops: [ { a: action_type, n: item_name, q: quantity, ts: timestamp }, ... ] }` (Lưu tối đa 100 dòng gần nhất trong DB).

### B. API Hệ thống Trò chuyện (Chat System)
*   **Endpoint**: `/xhrpg_chat.php`
*   **Phương thức**: `POST`
*   **Tham số**:
    *   Tải tin nhắn: `{ action: 'fetch' | 'dms', line_uid, session_token, lang }`
    *   Gửi tin nhắn: `{ action: 'send', line_uid, session_token, text, to_uid (nếu gửi DM), room }`
*   **Dữ liệu trả về**: 
    *   Tải thành công: `{ ok: true, msgs: [ { id, name, msg, ts, role, ... } ], me: { uid, name, role } }`
    *   Gửi thành công: `{ ok: true }`

### C. API Bang hội (Guild System)
*   **Endpoint**: `/xhrpg_guild.php`
*   **Phương thức**: `POST`
*   **Tham số**: `{ action: 'fetch_my' | 'detail' | ..., line_uid, session_token }`
*   **Dữ liệu trả về**: `{ ok: true, guild: null, none: true }` (Mặc định báo hiệu chưa có bang hội) hoặc object thông tin bang hội chi tiết nếu đã gia nhập.

### D. API Giao dịch (Trade System)
*   **Endpoint**: `/xhrpg_trade.php`
*   **Phương thức**: `POST`
*   **Tham số**: `{ action: 'status' | 'history' | ..., line_uid, session_token }`
*   **Dữ liệu trả về**: `{ ok: true, room: null, rows: [] }`

### E. API Số người Online (Online Count)
*   **Endpoint**: `/xhrpg_online_count.php`
*   **Phương thức**: `GET`
*   **Dữ liệu trả về**: `{ ok: true, online_count: 168 }`

### F. API Dịch tự động (Chat Translate)
*   **Endpoint**: `/xhrpg_translate.php`
*   **Phương thức**: `POST`
*   **Tham số**: `{ line_uid, session_token, text, target }`
*   **Dữ liệu trả về**: `{ ok: true, text: "Nội dung văn bản được dịch" }` (Proxy trả về nguyên văn để tránh vòng lặp retry gây tắc nghẽn mạng).

---

## 🎲 12. Hệ Thống Drop Đồ & Tỉ Lệ Chuẩn (Drop Rate System Formulas)

Toàn bộ logic tính toán tỉ lệ rớt đồ được xử lý tự động trong tệp tin [`DropSystem.js`](file:///e:/game/ragnalok-private-server/server/game/DropSystem.js) dựa trên cơ sở cấu hình của game gốc:

### A. Công thức tính Hệ số nhân Drop (Multiplier)
$$\text{mult} = 1.0 + \text{premium\_drop} + \text{premium\_boost} + \text{vip\_bonus} + \text{luk\_bonus}$$
*   $\text{premium\_drop} = 1.0$ nếu Gói Drop hoạt động.
*   $\text{premium\_boost} = 0.25$ (Newcome Pack) / $0.25$ (Premium Pack) / $0.50$ (Pack Pro).
*   $\text{vip\_bonus} = \text{vip\_lv} \times 0.05$.
*   $\text{luk\_bonus} = \lfloor\text{luk\_eff} / 10\rfloor \times 0.01$.

### B. Tỷ lệ rớt Nguyên liệu (Resources)
$$\text{resChance} = \min\left(0.48, 0.20 + (\text{luk} - 5) \times 0.01\right)$$
*   Nếu thành công, rớt ngẫu nhiên 1 loại nguyên liệu (từ danh sách tương thích của Map) với số lượng $1 \to 3$ cái.
*   Danh sách nguyên liệu của Map:
    *   Map 1 & 7: Gỗ (`wood`), Đá (`stone`), Thảo dược (`herb`).
    *   Map 2 & 8: Đá (`stone`), Đồng (`copper`).
    *   Map 3 & 9: Sắt (`iron`), Thảo dược (`herb`).
    *   Các map khác: Toàn bộ các tài nguyên.

### C. Tỷ lệ rớt Kim cương (Diamonds)
*   **Kim cương xanh (💎)**: Tỉ lệ cơ bản $0.035\% \times \text{mult}$.
*   **Kim cương đỏ (💎)**: Chỉ rơi khi quái vật Lv $\ge 25$:
    *   Quái thường: $0.014\% \times \text{mult}$.
    *   Boss MVP: $30.0\% \times \text{mult}$.

### D. Tỷ lệ rớt Thẻ bài (Card) & Trứng thú cưng (Egg)
Tỷ lệ rớt giảm dần (tuyến tính) dựa trên cấp độ quái vật:
*   **Thẻ bài thường**: $0.080\% \to 0.004\%$ tương ứng từ Lv.1 $\to$ Lv.100.
*   **Trứng thường**: $0.080\% \to 0.002\%$ tương ứng từ Lv.1 $\to$ Lv.100.
*   **Thẻ bài MVP**: $0.100\% \to 0.020\%$ tương ứng từ Lv.1 $\to$ Lv.100.
*   **Trứng MVP**: $0.050\% \to 0.010\%$ tương ứng từ Lv.1 $\to$ Lv.100.

### E. Tỷ lệ rớt Mô-đun (Module)
Cấp bậc mô-đun tăng dần dựa theo khoảng cấp độ quái vật:
*   **Quái thường**: Tỷ lệ cơ bản $0.003\%$ (Lv.1-60), $0.002\%$ (Lv.61-80), $0.001\%$ (Lv.81-100). Độ hiếm mô-đun tương ứng từ T1 $\to$ T5.
*   **Boss MVP**: Tỷ lệ cơ bản $0.625\%$ (Lv.1-60), $0.313\%$ (Lv.61-80), $0.156\%$ (Lv.81-100). Độ hiếm mô-đun tương ứng từ T2 $\to$ T5.

### F. Tỷ lệ rớt Trang bị D2 (eq2)
*   **Quái thường**: $0.080\%$ (T1), $0.020\%$ (T2), $0.008\%$ (T3), $0.003\%$ (T4), $0.00075\%$ (T5).
*   **Boss MVP**: $25.0\%$ (T1), $15.0\%$ (T2), $10.0\%$ (T3), $3.75\%$ (T4), $1.875\%$ (T5), $0.375\%$ (T6).
*   *Trang bị eq2* được sinh ngẫu nhiên bộ phận (Đầu/Thân/Chân/Nhẫn) và đính kèm $1 \to 3$ affixes ngẫu nhiên theo Tier.

---

## 🔍 Nơi tìm kiếm thông tin khi thiếu sót

*   **Tài liệu hướng dẫn của AGY**: Đọc tài liệu skill [antigravity-guide](file:///C:/Users/Admin/.gemini/antigravity-cli/builtin/skills/antigravity_guide/SKILL.md) để biết cách tinh chỉnh CLI, MCP và Customizations.
*   **Log hoạt động của Client**: Theo dõi tab **Nhật Ký (Logs)** trên bảng điều khiển local hoặc đọc trực tiếp file dữ liệu [accounts.json](file:///C:/Users/Admin/Desktop/auto/accounts.json).
*   **Trình gỡ lỗi Client**: Bấm `F12` trong tab Client game local (`/play`) để xem các gói dữ liệu JSON gửi đi và nhận về từ `/xhrpg_game.php`.


