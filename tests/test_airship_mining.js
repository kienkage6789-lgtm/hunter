const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test environment
const db = require('../server/db/queries');
const upgradeRoute = require('../server/routes/upgrade');
const gameRoute = require('../server/routes/game');

console.log('🧪 Bắt đầu kiểm thử toàn diện hệ thống Mỏ khoáng Phi thuyền (Airship Mining System)...');

// 1. Tạo mock player để test
const mockLineUid = 'test_miner_' + Date.now();
const initialPlayerObj = {
  line_uid: mockLineUid,
  name: 'Test Miner',
  lv: 50,
  house_lv: 30, // Đủ để mở slot 0 (cần 20)
  gold: 100000,
  wood: 10000,
  stone: 10000,
  iron: 10000,
  copper: 10000,
  herb: 10000,
  mine_lv: "[0,0,0,0,0,0]",
  mine_ore: "[\"\",\"\",\"\",\"\",\"\",\"\"]",
  mine_on: "[0,0,0,0,0,0]",
  house_energy: 1000,
  solar_cell_lv: 5,
  house_burn_wood: 1,
  burn_wood: 1,
  premium_miner_expires: 0
};

db.prepare(`
  INSERT INTO users (line_uid, username, password_hash, session_token)
  VALUES (?, ?, ?, ?)
`).run(mockLineUid, 'testminer', 'hash', 'mock_token');

db.prepare(`
  INSERT INTO players (line_uid, name, raw_data)
  VALUES (?, ?, ?)
`).run(
  mockLineUid,
  initialPlayerObj.name,
  JSON.stringify(initialPlayerObj)
);

async function runTests() {
  // --- TEST 1: Kiểm tra mở khóa slot theo cấp Phi thuyền ---
  console.log('\n▶ Test 1: Kiểm tra điều kiện mở khóa Slot theo cấp Phi thuyền...');
  
  // Thử xây slot 1 (Cần house_lv 40, hiện tại 30) -> Phải thất bại
  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'mine_build', slot: 1, ore: 'wood' } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, false, 'Slot 1 không được phép mở khi house_lv < 40');
          console.log('  ✓ Chặn đúng khi chưa đủ cấp Phi thuyền:', res.error);
          resolve();
        }
      },
      () => {}
    );
  });

  // Thử xây slot 3 (Cần Premium Miner) -> Phải thất bại khi chưa có Premium
  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'mine_build', slot: 3, ore: 'wood' } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, false, 'Slot 3 không được phép mở khi chưa có Premium Miner');
          console.log('  ✓ Chặn đúng khi chưa có Premium Miner:', res.error);
          resolve();
        }
      },
      () => {}
    );
  });

  // --- TEST 2: Xây mỏ slot 0 hợp lệ (house_lv >= 20) ---
  console.log('\n▶ Test 2: Xây mỏ Slot 0 với tài nguyên hợp lệ...');
  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'mine_build', slot: 0, ore: 'iron' } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, true, 'Xây mỏ slot 0 phải thành công');
          const p = res.player;
          const mineLv = JSON.parse(p.mine_lv);
          const mineOre = JSON.parse(p.mine_ore);
          const mineOn = JSON.parse(p.mine_on);
          assert.strictEqual(mineLv[0], 1, 'Slot 0 phải ở Lv.1');
          assert.strictEqual(mineOre[0], 'iron', 'Slot 0 phải là quặng iron');
          assert.strictEqual(mineOn[0], 1, 'Slot 0 phải ở trạng thái bật (1)');
          console.log('  ✓ Xây mỏ slot 0 thành công. mine_lv:', mineLv);
          resolve();
        }
      },
      () => {}
    );
  });

  // --- TEST 3: Nâng cấp mỏ slot 0 (Lv.1 -> Lv.2) ---
  console.log('\n▶ Test 3: Nâng cấp mỏ Slot 0 lên Lv.2...');
  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'mine_up', slot: 0 } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, true, 'Nâng cấp mỏ slot 0 phải thành công');
          const p = res.player;
          const mineLv = JSON.parse(p.mine_lv);
          assert.strictEqual(mineLv[0], 2, 'Slot 0 phải lên Lv.2');
          console.log('  ✓ Nâng cấp mỏ slot 0 lên Lv.2 thành công. mine_lv:', mineLv);
          resolve();
        }
      },
      () => {}
    );
  });

  // --- TEST 4: Đổi quặng (mine_select_ore) & Bật/Tắt (mine_toggle) ---
  console.log('\n▶ Test 4: Đổi quặng sang copper và tạm dừng mỏ...');
  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'mine_select_ore', slot: 0, ore: 'copper' } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, true);
          const mineOre = JSON.parse(res.player.mine_ore);
          assert.strictEqual(mineOre[0], 'copper');
          console.log('  ✓ Đổi quặng sang copper thành công');
          resolve();
        }
      },
      () => {}
    );
  });

  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'mine_toggle', slot: 0 } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, true);
          const mineOn = JSON.parse(res.player.mine_on);
          assert.strictEqual(mineOn[0], 0, 'Slot 0 phải chuyển sang 0 (tạm dừng)');
          console.log('  ✓ Tạm dừng mỏ slot 0 thành công');
          resolve();
        }
      },
      () => {}
    );
  });

  // Bật lại mỏ
  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'mine_toggle', slot: 0 } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, true);
          const mineOn = JSON.parse(res.player.mine_on);
          assert.strictEqual(mineOn[0], 1, 'Slot 0 phải bật lại (1)');
          console.log('  ✓ Bật lại mỏ slot 0 thành công');
          resolve();
        }
      },
      () => {}
    );
  });

  // --- TEST 5: Toggle Burn Wood ---
  console.log('\n▶ Test 5: Kiểm tra toggle_burn_wood đồng bộ cả house_burn_wood và burn_wood...');
  await new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: mockLineUid, session_token: 'mock_token', action: 'toggle_burn_wood' } },
      {
        json: (res) => {
          assert.strictEqual(res.ok, true);
          assert.strictEqual(res.player.house_burn_wood, 0);
          assert.strictEqual(res.player.burn_wood, 0);
          console.log('  ✓ Tắt đốt gỗ đồng bộ cả house_burn_wood và burn_wood thành công');
          resolve();
        }
      },
      () => {}
    );
  });

  // --- TEST 6: Vòng lặp game tick khai thác quặng thời gian thực ---
  console.log('\n▶ Test 6: Kiểm tra vòng lặp Game Tick sản xuất quặng thời gian thực...');
  
  // Set thời gian sản xuất trước đó 60 giây (1 phút)
  const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(mockLineUid);
  const pObj = JSON.parse(pRow.raw_data);
  const nowSec = Math.floor(Date.now() / 1000);
  pObj.house_last_prod = nowSec - 60; // 60 giây trước
  const prevCopper = pObj.copper || 0;
  const prevGold = pObj.gold || 0;
  pObj.house_energy = 500;
  
  db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
    JSON.stringify(pObj), mockLineUid
  );

  // Gửi request game tick
  await new Promise((resolve) => {
    gameRoute.handle(
      {
        method: 'POST',
        url: '/',
        body: { line_uid: mockLineUid, session_token: 'mock_token', x: 1125, y: 1125, explore_cx: 1125, explore_cy: 1125, map: 1 }
      },
      {
        json: (res) => {
          assert.strictEqual(res.ok, 1, 'Game tick phải thành công');
          const p = res.player;
          // Mỏ Lv.2 tốc độ 2 * 8 = 16 quặng/phút. Trong 60s sẽ sản xuất 16 quặng copper!
          const expectedProduced = 16;
          assert.strictEqual(p.copper, prevCopper + expectedProduced, `Copper phải tăng đúng ${expectedProduced}`);
          assert(p.house_last_prod >= nowSec - 1, 'house_last_prod phải được cập nhật');
          console.log(`  ✓ Game tick hoạt động chính xác: Sản xuất +${expectedProduced} Copper (từ ${prevCopper} lên ${p.copper}), house_energy=${p.house_energy}, house_last_prod=${p.house_last_prod}`);
          resolve();
        }
      },
      () => {}
    );
  });

  console.log('\n🎉 TẤT CẢ 6 BỘ TEST ĐÃ VƯỢT QUA XUẤT SẮC!\n');
}

runTests().then(() => {
  // Cleanup test user
  db.prepare('DELETE FROM players WHERE line_uid = ?').run(mockLineUid);
  db.prepare('DELETE FROM users WHERE line_uid = ?').run(mockLineUid);
  process.exit(0);
}).catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
