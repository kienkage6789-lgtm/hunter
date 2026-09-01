# Code Map — `client/xhrpg_canvas.js`

_Cập nhật lần cuối: 31/08/2026_

## Tổng quan

`client/xhrpg_canvas.js` là client game HTML5 Canvas chính của Ragnalok/XHRPG. Toàn bộ mã được bọc trong IIFE và xuất ra global `xhrpg`, vì vậy file này đồng thời đóng vai trò game runtime, renderer, UI controller và API client.

File hiện có khoảng **27.179 dòng**, **~2,9 MB**, với khoảng **382 hàm/thuộc tính public** trong object `return` cuối file. Không nên đọc tuần tự toàn bộ file; hãy bắt đầu từ vùng chức năng bên dưới rồi lần theo hàm được gọi.

## Cấu trúc module

```text
client/xhrpg_canvas.js
└── const xhrpg = (() => {
    ├── Constants / công thức / cấu hình                    1–131
    ├── Audio SFX WebAudio                                  132–181
    ├── Sprite, skin, icon và asset loader                  182–592
    ├── Ground/terrain/map builders                         593–1830
    ├── Tile map, camera, zoom                              1895–2141
    ├── Canvas renderer và entity renderer                  2142–4487
    ├── Bullet, animation, effect, smoothing                 4488–5270
    ├── HUD và công thức client                              5271–5510
    ├── Player UI: stats, ammo, potion, weapon/module       5511–6534
    ├── Item, module, card, egg, pet, divine pet            6535–9088
    ├── Leaderboard, chat, log                               9089–10550+
    ├── Gameplay actions, panels, payment, trade              10550–18991
    ├── Demo mode                                             18992–19326
    ├── Init, polling, movement, offline/PvP/arena            19327–20037
    ├── Equipment, crafting, gacha, auction, guild, VIP        20038–24838
    ├── Market                                               24839–26300
    ├── Guide / release notes                                 26300–27178
    └── return { ...public API }                              27179
```

> Các mốc trên là mốc tra cứu gần đúng theo vùng code; khi file thay đổi lớn nên cập nhật lại số dòng.

## Entry point và lifecycle

| Hàm | Dòng | Mục đích |
|---|---:|---|
| `init(p, url, token)` | 19328 | Gắn player/session, khởi tạo canvas, tải asset, dựng map và bắt đầu client runtime. |
| `startDemo(url)` | 19262 | Chạy game demo phía client trước đăng nhập, không ghi state lên server. |
| `startAnim()` | 4914 | Bật `requestAnimationFrame` loop; idempotent. |
| `_renderLoop(ts)` | 4906 | Cập nhật animation/effect và gọi `render()` mỗi frame. |
| `render()` | 5046 | Render toàn bộ scene: nền, vùng, entity, projectile, loot, text và HUD overlay. |
| `toggleBot()` | 19428 | Bật/tắt AUTO; thay đổi việc client gửi hướng/di chuyển và hiển thị D-pad. |
| `logout()` | 18845 | Gọi logout endpoint, dọn session và quay về màn hình đăng nhập. |

## 1. Constants, state và công thức

### Hằng số và state chính — dòng 1–131, 182–207

- Công thức skill/ATK/AGI cooldown: `aoeM`, `toughHpMul`, `armorUpMul`, `knifeAtkMul`, `swordDblPct`, `turretMul`, `lukDropPct`, `agiCdPct`.
- State runtime: `player`, `monsters`, `others`, `bosses`, `targetMonsterId`, `currentMap`, `canvas`, `ctx`, `groundCanvas`.
- State animation: `bullets`, `explosions`, `floatTexts`, `lootPops`, `groundLoot`, `monGhosts`, `deathMarkers` và các bảng smoothing/effect theo entity id.
- Tài nguyên map: `SPR_TREES`, `SPR_STONE`, `SPR_GREEN`, `SPR_DECOR`, `MON_SIZE`, `SUM`.

### Skin và icon — dòng 214–499

| Nhóm | Hàm tiêu biểu | Vai trò |
|---|---|---|
| Skin stat/XP | `_rollGlobal`, `_skinLv`, `_skinXp`, `_skinCap`, `_skinTier` | Chuẩn hóa stat skin, tính level/XP/cap và tier. |
| Skin size | `_robotBig`, `_heroBig`, `_petBig` | Tính hệ số kích thước theo giá skin. |
| Skin navigation | `skinGrpOpen`, `skinGrpBack` | Mở/thoát nhóm skin trong Premium panel. |
| Icon | `_icoHtml`, `_icoPotionHtml`, `_icoGemHtml`, `_resSvg` | Chuyển emoji/item type thành pixel icon hoặc SVG fallback. |
| Asset | `loadSummerTiles()` | Preload tileset, decor, icon và các asset map. |

## 2. Map, terrain và background bake

| Hàm | Dòng | Mục đích |
|---|---:|---|
| `buildGround()` | 1529 | Chọn builder theo `currentMap`, bake nền vào offscreen canvas. |
| `buildGroundDesert()` | 713 | Dựng map sa mạc, cồn cát, oasis và decor. |
| `buildGroundWinter()` | 838 | Dựng map băng tuyết, hồ băng/nước và decor mùa đông. |
| `buildGroundSeabed()` | 1014 | Dựng map đáy biển sâu, cát/sỏi, san hô và landmark. |
| `buildGroundDragon()` | 1056 | Dựng map rừng/đá rồng cổ đại. |
| `buildGroundHome()` | 1345 | Dựng khu nhà người chơi, đường đá, cây và object cố định. |
| `buildGroundGdun()` / `buildGroundCastle()` | 1159–1166 | Dựng dungeon/guild castle. |
| `drawOasisWater()` / `drawOasisTree()` | 665–712 | Vẽ overlay động của oasis. |
| `drawWinterTree()` | 987 | Vẽ cây băng/landmark trung tâm theo frame. |
| `drawSeabedCenter()` / `drawDragonCenter()` | 1040–1090 | Vẽ landmark trung tâm map biển/rồng. |
| `drawHomeOverlay()` | 1454 | Vẽ khói, ruộng, cây trồng và object nhà phụ thuộc state. |
| `drawCastleOverlay()` | 1283 | Vẽ guild emblem, bảng thành viên và hiệu ứng castle. |

Nền tĩnh được bake một lần; entity, nước/ripple, cây trung tâm, nhà và hiệu ứng được vẽ tiếp trong render loop. Đây là điểm cần giữ khi tối ưu performance.

## 3. Camera, tile và render loop

| Hàm | Dòng | Mục đích |
|---|---:|---|
| `buildTiles()` | 1896 | Tạo dữ liệu tile/object/terrain cho map hiện tại. |
| `resizeCanvas()` | 2102 | Đồng bộ kích thước canvas với viewport/device pixel ratio. |
| `zoom(dir)` | 2089 | Tăng/giảm zoom camera. |
| `getCameraTransform()` | 2124 | Tính scale và offset camera theo player. |
| `toScreen(wx, wy)` | 2137 | Đổi world coordinates sang screen coordinates. |
| `drawTiles()` | 2143 | Blit ground canvas và vẽ decor/object trên nền. |
| `drawZones()` | 2187 | Vẽ vùng farm/zone và thông tin khu vực. |
| `drawRange()` / `drawRobotRanges()` | 2235–2297 | Vẽ tầm đánh của player/robot theo weapon, hardware, house bonus. |
| `drawMinimap()` | 4432 | Vẽ minimap, player, monster và marker. |

## 4. Entity rendering

### Player và companion

| Hàm | Dòng | Mục đích |
|---|---:|---|
| `drawPlayer()` | 3655 | Vẽ hero, hướng nhìn, skin, VIP aura, animation attack/move/death. |
| `drawDog()` | 2299 | Vẽ pet companion của player hiện tại. |
| `drawCat()` / `drawDrone()` | 2892–3080 | Vẽ Cat/Drone và animation theo state server. |
| `drawPriest()` / `drawKnight()` / `drawDivine()` / `drawArcher()` | 2603–2814 | Vẽ các companion Premium/Divine của player. |
| `drawRobot()` | 3089 | Vẽ Titan robot, skin, animation, energy và attack state. |
| `drawHouse()` | 3385 | Vẽ Orion gunship/nhà bay của player. |
| `drawOthers()` | 3944 | Vẽ người chơi khác và các companion tương ứng. |
| `drawOtherDogs()` / `drawOtherPriests()` / `drawOtherArchers()` | 2368–2824 | Vẽ companion của người chơi khác bằng presence snapshot. |
| `drawOtherHouses()` / `drawOtherTurrets()` | 3396 / 24202 | Vẽ gunship và guild turrets của người chơi khác. |

### Monster, combat FX và loot

| Hàm | Dòng | Mục đích |
|---|---:|---|
| `drawMonsters()` | 4091 | Vẽ monster/MVP, HP bar, animation, target và trạng thái combat. |
| `drawMonGhosts()` / `drawDyingMons()` | 4331–4379 | Giữ corpse/fade transition khi monster biến mất giữa các poll. |
| `spawnBullet()` / `updateBullets()` / `drawBullets()` | 4517 / 4575 / 4594 | Tạo, cập nhật và vẽ projectile theo loại vũ khí/skin. |
| `drawExplosions()` | 4921 | Vẽ AoE/explosion effect. |
| `drawTargetLine()` / `drawOthersTargets()` | 4977–5045 | Vẽ đường nhắm và target line của player/others. |
| `drawGroundLoot()` / `drawLootPops()` | 5114 / 5253 | Vẽ item rơi trên đất và popup loot. |
| `spawnFloatText()` / `drawFloatTexts()` | 5221 / 5229 | Pool text cho damage, MISS, EXP và thông báo combat. |

## 5. HUD, stats và combat calculations

| Hàm | Dòng | Mục đích |
|---|---:|---|
| `updateHUD()` | 5316 | Đồng bộ HP/EXP/G/P/level/target và trạng thái AUTO lên DOM. |
| `expNext()` / `expNextHero()` | 5399–5413 | Tính EXP cần cho player và hero. |
| `knifeAtk()` | 5441 | Tính ATK cơ bản của vũ khí cận chiến. |
| `gunUpgCostV2()` / `canUpgGun()` | 6122–6144 | Tính cost và điều kiện nâng cấp súng. |
| `_ammoCarryCap()` / `_potionCarryCap()` | 6159–6164 | Tính sức chứa đạn/potion theo level, house và EQ2. |
| `renderStats()` | 5700 | Render bảng stat, bonus, weapon và thông tin chiến đấu. |
| `renderSkills()` / `upgradeSkill()` | 24268 / 24404 | Render skill tree và gửi nâng cấp skill. |

## 6. Item, module, card, egg, pet và crafting

| Khu vực | Dòng | API public tiêu biểu |
|---|---:|---|
| Module/weapon module | 6249–7052 | `moduleEquip`, `moduleUnequip`, `moduleEnhance`, `openModuleBox`, `moduleDiscard`. |
| Card socket/sacrifice | 6900–8320 | `cardSocket`, `cardUnsocket`, `cardMvpExchange`, `cardSacrifice`. |
| Egg box/sacrifice | 6779–8320 | `openEggBox`, `eggMvpExchange`, `eggSacrifice`. |
| Pet | 8080–8810 | `renderPet`, `petHatchAsk`, `petUpgrade`, `petResetUp`, `petCardSocket`. |
| Divine pet | 8321–9088 | `dvAwaken`, `dvUp`, `dvResetUp`, `dvCardSocket`. |
| Equipment EQ2 | 20038–21000 | `openEq2Panel`, `_eq2Act`, `_eq2Enhance`, `_eqcCraft`, `_eqcRoll`. |
| MDC crafting | 20428–20836 | `_mdcCraft`, `_mdcUpT`, `_mdcUnlock`, `_mdcDestroy`. |

## 7. Gameplay actions và panel systems

Các hàm public ở phần này thường được gọi trực tiếp từ `onclick` trong HTML được tạo bằng `innerHTML`.

| Hệ thống | Hàm chính |
|---|---|
| Player upgrade | `upgradeKnife`, `upgradeGun`, `upgradeArmor`, `upgradeRobot`, `upgradeHouse`, `upgradeCat`, `upgradeDrone`, `priestUp`, `knightUp`, `archerUp`. |
| Movement/map | `setDir`, `warpToMap`, `warpHome`, `warpCenter`, `goToSpot`, `goToBoss`, `openMapSelect`. |
| Potion/ammo | `usePotion`, `usePotionManual`, `toggleAutoPotion`, `setAutoPotionThreshold`, `toggleGunUse`, `toggleAmmTier`. |
| Mine/farm/house | `mineBuild`, `mineUp`, `mineSelectOre`, `mineToggle`, `homePlant`, `homeHarvest`, `homeUp`, `homeVisit`. |
| Offline | `openOfflinePanel`, `_offClose`, `_offRnGo`, `showOfflineReward`. |
| PvP/raid/arena | `openPvpPanel`, `_pvpChallenge`, `raidStart`, `openRaidPanel`, `openArenaPanel`, `_arenaGo`. |
| Guild/castle | `openGuildPanel`, `_gdCreate`, `_gdJoin`, `_gdDonate`, `_gdEmblemSave`, `castleEnter`, `castleExit`. |
| Market/trade/auction | `renderMarket`, `_mktDoSell`, `_mktDoBuy`, `_mktCancel`, `_trInvite`, `_trConfirm`, `openAucPanel`. |
| Gacha/VIP/voucher | `openGachaPanel`, `_gachaSpin`, `openVipPanel`, `vipBoxBuy`, `openVoucherPanel`, `_vcRedeem`. |

## 8. Leaderboard, chat, log và guide

| Hàm | Mục đích |
|---|---|
| `lbShow(uid)` | Mở profile/leaderboard và xem trang bị người chơi. |
| `renderChat()` / `chatSend()` | Render chat, gửi tin nhắn và cập nhật DM/guild chat. |
| `chatPickImage()` / `_chatUploadImg()` | Chọn, upload và preview ảnh chat. |
| `renderLogPanel()` | Render mini log/drop log trong panel. |
| `renderGuide()` / `_guideSetChap()` / `_guideToggle()` | Render guide theo chapter, item mở rộng và pagination. |
| `toggleLang()` | Mở language picker và đổi ngôn ngữ UI. |
| Onboarding/release-note block | 26253–26430 | Carousel onboarding và release note cho người chơi mới. |

## 9. Network/API contract

File dùng các endpoint PHP legacy làm contract với server. Khi sửa payload hoặc action, cần đối chiếu route server tương ứng. Bảng đối chiếu chi tiết đầy đủ 36 route xem tại [`docs/API_CONTRACT.md`](file:///e:/game/ragnalok-private-server/docs/API_CONTRACT.md).

| Nhóm | Endpoint được gọi thật | Ghi chú / Deferred 501 / Unmounted |
|---|---|---|
| Core/auth | `xhrpg_game.php`, `xhrpg_logout.php`, `xhrpg_warp.php`, `xhrpg_online_count.php` (và `/api/login`, `/api/register`, `xhrpg_google_auth.php`) | `xhrpg_config.php` chỉ là mirror hằng số / comment (0 active call). |
| Upgrade/items | `xhrpg_upgrade.php`, `xhrpg_eq2.php`, `xhrpg_mdc.php`, `xhrpg_premium.php`, `xhrpg_vip.php` | `xhrpg_voucher.php` thuộc backlog 501. |
| Social | `xhrpg_chat.php`, `xhrpg_chat_upload.php`, `xhrpg_chat_img.php`, `xhrpg_trade.php`, `xhrpg_guild.php` | Đã implement 100% router thật. |
| PvP/events | `xhrpg_pvp.php`, `xhrpg_raid.php`, `xhrpg_arena.php`, `xhrpg_cwar.php`, `xhrpg_gwar.php`, `xhrpg_orion_raid.php` | Đã implement 100% router thật; các file `*_logic.php` chỉ là comment. |
| Economy/payment | `xhrpg_market.php`, `xhrpg_gacha.php`, `xhrpg_auction.php` | `xhrpg_stripe_topup.php`, `xhrpg_topup_promo.php`, `xhrpg_xsolla_token.php`, `xhrpg_coda_paycode.php`, `xhrpg_migrate.php` thuộc backlog 501; `*_lib.php` chỉ là comment. |
| Data/history | `xhrpg_leaderboard.php`, `xhrpg_droplog.php`, `xhrpg_phistory.php`, `xhrpg_offline.php`, `xhrpg_translate.php` | `xhrpg_report.php` đã thay bằng Chat DM Admin (0 active call). |

### Polling và đồng bộ state

- `POLL_MS = 1250`; game poll gửi trạng thái player/action và nhận snapshot monster/others/events.
- Có cơ chế **hot/cold split**: poll thường giữ lại dữ liệu inventory/card/egg/cold state khi server không gửi lại.
- Các hiệu ứng client như bullet, corpse ghost, floating text, smoothing và optimistic throw chỉ là hiển thị; không được xem là authoritative game state.
- `MON_SEND_R`/`MON_DEAD_R` dùng để phân biệt monster chết với monster chỉ rời vùng snapshot.

## 10. Public API

Object `xhrpg` ở cuối file export toàn bộ entry point được HTML/panel gọi. Các tên public được chia theo nhóm ở trên; danh sách export đầy đủ nằm tại dòng cuối `return { ... }`.

Một số entry point quan trọng nhất:

```js
xhrpg.init(p, url, token)
xhrpg.startDemo(url)
xhrpg.toggleBot()
xhrpg.warpToMap(mapId)
xhrpg.openOfflinePanel()
xhrpg.openPvpPanel(tab)
xhrpg.openArenaPanel()
xhrpg.openGuildPanel()
xhrpg.renderMarket()
xhrpg.openEq2Panel()
xhrpg.openGachaPanel()
xhrpg.openVipPanel()
xhrpg.renderChat()
xhrpg.lbShow(uid)
```

## Notes / điểm cần cẩn thận

1. Đây là **god module**: gameplay, rendering, DOM UI, API và payment nằm chung một IIFE. Thay đổi nhỏ ở state hoặc helper dùng chung có thể ảnh hưởng nhiều panel.
2. Server mới là nguồn sự thật cho combat, inventory, cooldown và tài nguyên. Công thức trong client chủ yếu để hiển thị/preview; các công thức có comment `sync PHP` phải giữ đồng bộ với server.
3. Không đổi tên hàm trong `return { ... }` nếu chưa sửa toàn bộ `onclick="xhrpg...."` và các HTML page liên quan.
4. Nhiều UI được dựng lại bằng `innerHTML`; khi thêm event cần kiểm tra vấn đề mất node/click trong lúc poll re-render.
5. Icon/item từ dữ liệu server phải đi qua helper escape/icon (`_icoHtml`, `_escHtml` và các helper liên quan), không chèn raw value vào `innerHTML`.
6. Terrain tĩnh nên tiếp tục bake vào `groundCanvas`; chỉ vẽ per-frame những phần thực sự animated hoặc phụ thuộc state.
7. Demo mode (dòng 18992–19326) là client-only và không phản ánh đầy đủ server flow.
8. Khi cập nhật file, nên sửa đúng section liên quan trong map này; chỉ đổi lại toàn bộ map sau khi cấu trúc lớn thay đổi.
