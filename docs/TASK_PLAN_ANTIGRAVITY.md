# Antigravity Execution Plan — Ragnalok Private Server

Ngày lập: 01/09/2026  
Leader: Codex  
Workspace: `E:\game\ragnalok-private-server`

## Mục tiêu sprint

Đưa server từ trạng thái **core gameplay alpha** lên trạng thái có thể kiểm chứng qua HTTP thật, giảm rủi ro bảo mật trước release và làm rõ chính xác những endpoint nào đã hoàn thiện hoặc còn backlog.

Không triển khai payment thật trong sprint này. Không được biến endpoint đang deferred thành success giả.

## Trạng thái điều phối

- `TASK-038`: **DONE** — endpoint coverage đã phân biệt implemented/501/missing; regression PASS.
- `TASK-039`: **DONE** — HTTP smoke test qua Express thật PASS; đã nghiệm thu.
- `TASK-040`: **DONE** — đã nghiệm thu remediation sensitive logging ngày 01/09/2026.
- `TASK-041`: **DONE** — đã nghiệm thu API contract audit ngày 01/09/2026.
- `TASK-042`: **DONE** — đã nghiệm thu implementation và regression ngày 01/09/2026.
- `TASK-043`: **DONE** — đã leader review và nghiệm thu độc lập ngày 01/09/2026.
- `TASK-044`: **DONE** — đã leader kiểm tra độc lập và nghiệm thu ngày 01/09/2026.
- `TASK-045`: **FROZEN — READ-ONLY AUDIT APPROVED / MUTATION BLOCKED** — đã đóng băng chờ business data.
- `TASK-046`: **SKIPPED / BLOCKED** — đã bỏ qua do thiếu provider/sandbox credentials.
- `TASK-047`: **DONE** — đã hoàn thành hardening JSON database, backup/recovery, lock timeout, và fix triệt để test isolation ngày 01/09/2026.
- `TASK-048`: **DONE** — đã hoàn thành Browser Playtest & Release QA trên trình duyệt thật (Chrome/Edge qua CDP), test độc lập PASS (8.76s), master regression 33/33 suites PASS (59.92s), screenshot lưu trong workspace artifact ngày 01/09/2026.

## Bối cảnh bắt buộc

- Client chính: `client/xhrpg_canvas.js`, khoảng 27.179 dòng.
- Server: Node.js + Express, database JSON, server-authoritative cho combat/economy.
- Regression hiện tại: `32/32` suite PASS; đã có HTTP smoke, sensitive logging và API contract coverage.
- Server có route thật cho core, market, trade, chat, offline, PvP, raid, arena, guild, CWAR/GWAR, equipment, pet, admin, gacha, auction và Orion Raid.
- Các endpoint hiện chủ động trả HTTP 501: migrate, voucher, Stripe topup, topup promo, CodaPay và XSolla.

## Quy tắc leader

1. Mỗi lần chỉ làm **một task đang WIP**.
2. Không refactor lớn ngoài phạm vi task.
3. Không sửa logic game đã pass nếu task không yêu cầu.
4. Không fake response thành công cho tính năng chưa triển khai.
5. Mọi mutation database phải có auth, lock/rollback hoặc cơ chế atomic tương ứng.
6. Mọi task phải có test trước khi báo DONE.
7. Nếu phát hiện scope mới, dừng và báo leader; không tự mở rộng task.
8. Giữ tương thích với public API và `onclick="xhrpg...."` của client.

## Thứ tự thực hiện

### TASK-038 — Đồng bộ endpoint coverage test

Type: Test/Refactor  
Priority: P1-Critical  
Estimate: S (<4 giờ)  
Depends: None

Files dự kiến:

- `tests/test_endpoint_coverage.js`
- Có thể thêm helper test nếu cần, nhưng không đổi production logic.

Việc cần làm:

- Đọc route mount thật trong `server/index.js`.
- Xóa việc coi PvP/Raid là 501 giả lập; kiểm tra router thật.
- Tách ba trạng thái: implemented, intentionally deferred 501, missing/unmounted.
- Kiểm tra HTTP status và JSON shape của từng endpoint.
- Giữ test cho 501 backlog payment và feature chưa làm.

Done when:

- Test không còn false positive cho PvP/Raid.
- Test phản ánh đúng các route 501 thực tế.
- `node tests/test_endpoint_coverage.js` PASS.

Status: **DONE** — nghiệm thu ngày 01/09/2026.

### TASK-039 — HTTP integration smoke test

Type: Test  
Priority: P1-Critical  
Estimate: M (<1 ngày)  
Depends: TASK-038
Status: **DONE** — nghiệm thu ngày 01/09/2026.

Evidence: `node tests/test_http_smoke.js` PASS; `node tests/run_all_tests.js` PASS (26/26 suites).
Review note: phát hiện rủi ro logging `req.body` chưa redact credential; chuyển sang TASK-040, chưa coi là lỗi của TASK-039.

Files dự kiến:

- Tạo `tests/test_http_smoke.js`.
- Chỉ sửa `server/index.js` nếu cần để hỗ trợ test lifecycle an toàn.

Critical flow cần test qua Express HTTP thật:

1. Register hoặc login.
2. Nhận `line_uid` và `session_token`.
3. Gọi `/xhrpg_game.php`.
4. Gọi một action upgrade hợp lệ.
5. Warp map hợp lệ và map không đủ level.
6. Market hoặc chat request.
7. Request sai token phải trả 401/Unauthorized.
8. Logout.
9. Dùng token cũ sau logout phải bị từ chối.
10. Kiểm tra gacha/auction/payment deferred trả 501, không trả `ok: true`.

Yêu cầu:

- Khởi động server child process hoặc dùng app factory an toàn.
- Không để lại process Node sau test.
- Dọn test records khỏi database.
- Không phụ thuộc vào server đang chạy sẵn.
- Không sửa production gameplay logic; nếu cần refactor `server/index.js` để export app thì phải giữ `npm start` tương thích.
- Không dùng port cố định nếu có thể dùng port test động; luôn đóng child process trong `finally`.
- Nếu phát hiện route thật trả status/shape sai, ghi nhận blocker và chỉ sửa trong phạm vi integration setup, không tự nhảy sang TASK-041.

Done when:

- Smoke test chạy độc lập bằng một lệnh.
- Pass qua HTTP thật, không gọi router trực tiếp.
- Không còn process test và không còn test data rác.

### TASK-040 — Redact sensitive request logging

Type: Security  
Priority: P1-Critical  
Estimate: S (<4 giờ)  
Depends: None

File chính:

- `server/index.js`

Việc cần làm:

- Không log plaintext `session_token`, password, API key, payment token hoặc raw payment payload.
- Tạo helper sanitize body trước khi log.
- Có chế độ log rõ ràng cho development/production.
- Giữ method/path/status cần thiết cho debug.
- Không làm thay đổi request body đi vào route.

Done when:

- Test hoặc kiểm tra log chứng minh secret bị redacted.
- Core request vẫn hoạt động bình thường.
- Không có credential nhạy cảm trong output production log.

Status: **DONE** — remediation đã xóa log raw users/match, redact query args nhạy cảm, mở rộng test bao phủ toàn bộ console output của request flow (HTTP + DB), và leader đã kiểm tra độc lập: test security PASS, regression 27/27 PASS, database sạch.

### TASK-041 — Audit client–server API contract

Type: Audit/Documentation  
Priority: P2-High  
Estimate: M (<1 ngày)  
Depends: TASK-038, TASK-039

Status: **DONE** — Đã audit 100% 36 server routes và toàn bộ client call sites, lập bảng đặc tả tại docs/API_CONTRACT.md, sửa mismatch route GET /xhrpg_google_auth.php trong server/routes/auth.js, cải thiện error path client cho HTTP 501 trong client/xhrpg_canvas.js, cập nhật CODE_MAP.md, và tạo suite kiểm thử tests/test_api_contract.js (28/28 suites PASS).

Files:

- `client/xhrpg_canvas.js`
- `server/index.js`
- `server/routes/*.js`
- Cập nhật `CODE_MAP.md` hoặc tạo tài liệu contract nếu cần.

Việc cần làm:

- Trích các endpoint và action client thực sự gọi.
- Map từng endpoint tới server route và status.
- Kiểm tra field bắt buộc trong request/response game.
- Kiểm tra các endpoint missing như `report`, `config` và helper PHP có thực sự bị gọi hay chỉ là comment/mirror.
- Ghi rõ deferred feature và cách UI phải xử lý lỗi 501.

Done when:

- Có bảng contract endpoint/action/status.
- Không còn endpoint client gọi nhầm path.
- Mọi endpoint user-facing chưa làm đều có error path rõ ràng.

## Backlog sau khi sprint hardening PASS

### TASK-042 — Implement Gacha

Priority: P2-High, Estimate: L, Depends: TASK-041

Status: **DONE** — Hoàn tất ngày 01/09/2026.

- Triển khai server-authoritative Gacha tại `server/routes/gacha.js` mount trên `POST /xhrpg_gacha.php`.
- Hỗ trợ đầy đủ action `info` và `spin`, xác thực `line_uid` + `session_token`.
- Bậc thang chi phí Ladder: `[0, 10, 10, 15, 15, 15, 20, 20, 20, 25]` P (spin 1 miễn phí).
- Công thức thưởng Gold server-authoritative: `base = lv * 200`, `amount = base * mult` với bộ trọng số CSPRNG `[50, 20, 18, 10, 5, 2]` cho các hệ số `[1, 2, 3, 4, 5, 6]`.
- Giới hạn 10 lượt quay/ngày, tự động reset theo ngày (UTC+7).
- Hỗ trợ Idempotency caching chống duplicate retry và async Mutex queue per-user chống race condition / double charge.
- Bộ kiểm thử toàn diện `tests/test_gacha_system.js` PASS 100%. Ma trận kiểm thử 29/29 suites PASS.

### TASK-043 — Implement Auction

Priority: P2-High, Estimate: L, Depends: TASK-041

Status: **DONE** — Đã leader review sau remediation và nghiệm thu độc lập: Auction test PASS, API contract/endpoint/HTTP smoke PASS, full regression 30/30 PASS, database sạch. Ghi chú quy trình: agent đã triển khai bản đầu trước approval, sau đó đã sửa theo review.

- Triển khai server-authoritative Daily Auction tại endpoint `POST /xhrpg_auction.php` theo lịch canonical 11:00–20:30 UTC+7.
- Hệ thống 6 slots thẻ bài mỗi ngày (P×3, G×3) từ pool `data/mon_masters_cache.json` không trùng lặp, server-owned (`seller_uid: 'system'`).
- Giá khởi điểm và bước tăng giá authoritative `inc`: P `[1, 5, 10, 20, 50]`, G `[100k, 500k, 1M, 2M, 5M]`.
- Outbid tự động hoàn tiền tức thì 100% cho người dẫn đầu cũ; tự nâng giá chỉ trả phần chênh lệch `increment`.
- Chống trượt giá qua `seen` (`moved: true`); chống số dư âm; chống client tampering.
- Tuần tự hóa concurrent bids qua async slot mutex lock; settlement idempotent trao thẻ vào `player.cards`.
- Hỗ trợ 4 actions client thật (`state`, `bid`, `hist`, `prev`) và 1 action nội bộ `settle`.
- Toàn bộ 13 ca kiểm thử HTTP integration `tests/test_auction_system.js` PASS 100%. Ma trận 30/30 test suites PASS.

### TASK-044 — Implement Orion Space Expedition (Orion Raid)

Priority: P2-High, Estimate: L, Depends: TASK-041

Status: **DONE** — leader đã kiểm tra độc lập: Orion test PASS, full regression PASS 31/31, database sạch. Lần chạy full đầu tiên có 1 lỗi flaky ở `test_explore_radius.js`, nhưng chạy riêng và chạy lại toàn ma trận đều PASS; không xem đó là blocker của TASK-044.
- Triển khai router server-authoritative `server/routes/orion_raid.js` tại `POST /xhrpg_orion_raid.php`.
- Xử lý chuẩn xác 3 actions client: `info`, `send`, `rush`.
- 3 Tiers chuẩn: Tier 1 (8h, `house_lv >= 30`), Tier 2 (16h, `house_lv >= 60`), Tier 3 (24h, `house_lv >= 90`).
- Hạn ngạch 1 chuyến/ngày theo giờ UTC+7, reset 00:00:00. Chi phí Rush = 1P/giờ còn lại.
- Cơ chế Auto-settle trên `xhrpg_game.php` khi hết giờ, trả về `oraid_done` trong snapshot poll. Tỷ lệ thành công 50%, thất bại nhận khoáng sản an ủi `stone/iron/copper`.
- Bảo vệ bằng Auth guard, Mutex lock per-user (`acquireLock`), Idempotency cache và JSON DB atomic rollback.
- Bộ test `tests/test_orion_raid_system.js` (12 phần) PASS 100%. Ma trận kiểm thử 31/31 Test Suites PASS. DB sạch sẽ 100%.

### TASK-045 — Migrate account và Voucher

Priority: P3-Medium, Estimate: M, Depends: TASK-041

Status: **WIP — READ-ONLY AUDIT APPROVED / MUTATION BLOCKED** — Execution boundary đã được thiết lập:
- Read-only audit & specification đã được Leader phê duyệt (Catalog active callers từ Premium HUD `migrateRedeem` và Voucher Panel `openVoucherPanel`, audit contract HTTP 501, error handling `.fail()`, schema-gap report, acceptance checklist và test specification; không mutate economy).
- RGK redeem (`POST /xhrpg_migrate.php`), RGV buy/redeem (`POST /xhrpg_voucher.php`), database schema/seed creation và economy mutation vẫn **BLOCKED** khi chưa có Business Owner authority.
- Blockers bắt buộc: Cần Business Owner cung cấp source/inventory database hoặc Secret Key + algorithm của `RGK`, identity mapping, pts mapping, expiry/acceptance/replay policy; voucher tiers/face/fee/currency, issuer/admin authority, ownership/self-redeem, expiry, refund.
- Next: Chờ Business Owner authority/data; sau đó mới xin leader duyệt mutation.
- Tuyệt đối không sửa mã sản xuất, không tạo database seed giả lập, không tự bịa economy, và chưa được bắt đầu TASK-046.

### TASK-046 — Payment provider integration

Priority: P2-High, Estimate: XL, Depends: provider contract  
Status: BLOCKED

Chỉ bắt đầu khi có provider, sandbox credentials và webhook contract. Bắt buộc có signature verification, idempotency, replay protection, refund/rollback và test sandbox.

### TASK-047 — JSON database production hardening

Priority: P2-High, Estimate: M, Depends: TASK-039

Status: **DONE** (Hoàn thành & Nghiệm thu 01/09/2026)

- Triển khai ghi nguyên tử (Atomic Write) qua Temp File + Atomic Rename trong `server/db/queries.js`.
- Tự động tạo và đồng bộ Primary Backup (`database.backup.json`) và Snapshot xoay vòng (`data/backups/`).
- Tự động phát hiện lỗi corrupt (invalid/broken JSON) và tự phục hồi từ primary backup hoặc snapshot gần nhất.
- Bổ sung Lock Timeout (10s) chống deadlock trong `server/utils/lock.js`.
- Xử lý an toàn khi lỗi ghi đĩa (Disk Failure ENOSPC/EACCES) mà không làm mất dữ liệu in-memory và file gốc.
- Sửa triệt để root cause test isolation: cách ly `worldManager.respawnQueue` trong `test_explore_radius.js` và dynamic snapshot/restore trong `test_database_hardening.js`.
- Bộ test `tests/test_database_hardening.js` (9 kịch bản) PASS 100%. Ma trận kiểm thử hệ thống 32/32 Test Suites PASS (51.48s). DB sạch sẽ 100% (6 users / 6 players).

### TASK-048 — Browser playtest và release QA

Priority: P1-Critical, Estimate: M, Depends: TASK-039, TASK-040

Status: **DONE** (Hoàn thành & Nghiệm thu 01/09/2026)

- Khởi động Browser Chrome/Edge headless qua CDP với dynamic port `net.createServer()`, bắt stderr/stdout, polling TCP/HTTP readiness `/json/version` đảm bảo kết nối 100% không bị `ECONNREFUSED`.
- Lưu ảnh screenshot artifact an toàn bên trong thư mục workspace `artifacts/browser/browser_playtest_mobile.png`, không ghi ra ngoài workspace, tự tạo thư mục an toàn.
- Smoke flow trên trình duyệt thật: Đăng ký/Login -> Vào game -> Khởi tạo Canvas/HUD -> Combat (Auto Bot) -> Bơm máu khẩn cấp -> Zoom -> Warp -> Logout.
- Tương tác giao diện & gọi mạng thực tế các hệ thống: Chợ (Market), Trò chuyện (Chat), Bang hội (Guild), Đấu trường (PvP), Boss Raid, Vòng quay Gacha, Đấu giá (Auction), Thẻ quà tặng P (Voucher), Bảng xếp hạng (Rank), Hướng dẫn tân thủ (Guide).
- Sửa triệt để các phát hiện QA: bọc `try/catch` an toàn cho `liff.isLoggedIn()` trong `client/xhrpg_canvas.js:18858`, gắn `window.xhrpg = xhrpg` khi game init trong `client/play.html:378`, gắn route `/favicon.ico` 204 trong `server/index.js:80`, và xử lý kiểm tra giờ chiến tranh quốc gia trong `tests/test_upgrade_system.js:155`.
- Audit Console Logs (0 unhandled exceptions), Network Integrity (0 lỗi 404 missing assets).
- Bộ test `tests/test_browser_playtest.js` PASS độc lập 100% (8.76s, exit code 0). Ma trận kiểm thử hệ thống 33/33 Test Suites PASS (59.92s, exit code 0). DB sạch sẽ 100% (6 users / 6 players).

## Tiêu chí báo cáo sau mỗi task

Antigravity phải báo theo đúng format:

```text
[TASK-XXX] DONE | BLOCKED | FAILED
Changed:
- file:line — mô tả ngắn
Tests:
- command — PASS/FAIL
Evidence:
- output hoặc lỗi quan trọng
Risks:
- rủi ro còn lại
Next:
- task tiếp theo hoặc câu hỏi cần leader quyết định
```

Không báo DONE nếu chưa có command test và kết quả thực tế.
