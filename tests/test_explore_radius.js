const assert = require('assert');
const db = require('../server/db/queries');
const gameRoute = require('../server/routes/game');
const worldManager = require('../server/game/WorldManager');

console.log('🧪 Bắt đầu kiểm thử toàn diện chức năng EXPLORE RADIUS (Chuẩn hóa bán kính và chọn mục tiêu)...');

const mockLineUid = 'test_explore_user_' + Date.now();
const initialPlayerObj = {
  line_uid: mockLineUid,
  name: 'Test Explore Hunter',
  lv: 30,
  hp: 1000,
  hp_max: 1000,
  mp: 200,
  gold: 5000,
  exp: 0,
  str: 30,
  dex: 30,
  agi: 20,
  vit: 20,
  intel: 20,
  luk: 10,
  x: 1000,
  y: 1000,
  map: 1,
  active_gun: 0,
  gun_use_pistol: 1,
  gun_pistol_lv: 5,
  skills: JSON.stringify({ double_attack: 1 })
};

db.prepare(`
  INSERT INTO users (line_uid, username, password_hash, session_token)
  VALUES (?, ?, ?, ?)
`).run(mockLineUid, 'testexploreuser', 'hash', 'mock_token');

db.prepare(`
  INSERT INTO players (line_uid, name, raw_data)
  VALUES (?, ?, ?)
`).run(
  mockLineUid,
  initialPlayerObj.name,
  JSON.stringify(initialPlayerObj)
);

// Lưu trữ quái vật gốc để khôi phục sau khi test xong
let originalMonsters = [];
if (worldManager.maps[1]) {
  originalMonsters = [...worldManager.maps[1].monsters];
}

async function callGame(body) {
  // Chờ 850ms để vượt qua cơ chế chống spam (rate limit 800ms) của server
  await new Promise(r => setTimeout(r, 850));
  return new Promise((resolve, reject) => {
    gameRoute.handle(
      {
        method: 'POST',
        url: '/',
        body: {
          line_uid: mockLineUid,
          session_token: 'mock_token',
          explore_cx: 1000,
          explore_cy: 1000,
          explore_radius: 300,
          ...body
        }
      },
      {
        json: (res) => {
          if (res.ok === false) {
            reject(new Error(res.error || 'Game route returned ok: false'));
          } else {
            resolve(res);
          }
        }
      },
      (err) => { if (err) reject(err); }
    );
  });
}

async function runTests() {
  // --- TEST 1: Kiểm tra các preset hợp lệ (100, 200, 300) ---
  console.log('\n▶ Test 1: Kiểm tra các preset hợp lệ (100, 200, 300)...');
  
  for (const radius of [100, 200, 300]) {
    const res = await callGame({ explore_radius: radius });
    assert.strictEqual(res.player.explore_radius, radius, `Với input ${radius}, explore_radius phải là ${radius} (thực tế: ${res.player.explore_radius})`);
    console.log(`  ✓ Đã chấp nhận bán kính hợp lệ: ${radius}`);
  }

  // --- TEST 2: Kiểm tra chuẩn hóa các giá trị không hợp lệ (fallback về 300) ---
  console.log('\n▶ Test 2: Kiểm tra các giá trị không hợp lệ (150, 250, 400, "invalid", null)...');
  
  const invalidCases = [150, 250, 400, 50, 999, 'invalid', null, undefined];
  for (const val of invalidCases) {
    const res = await callGame({ explore_radius: val });
    assert.strictEqual(res.player.explore_radius, 300, `Với input ${val}, explore_radius phải fallback về 300 (thực tế: ${res.player.explore_radius})`);
    console.log(`  ✓ Đã chuẩn hóa input [${val}] về 300`);
  }

  // --- TEST 3: Kiểm tra tự động chọn mục tiêu dựa trên bán kính explore_radius ---
  console.log('\n▶ Test 3: Kiểm tra tự động chọn mục tiêu dựa trên bán kính explore_radius...');
  
  // Xóa sạch quái cũ của map 1 trong thời gian test để tránh nhiễu từ quái mặc định
  if (worldManager.maps[1]) {
    worldManager.maps[1].monsters = [];
  }

  // Tạo quái 1: Khoảng cách ~150px (tại 1150, 1000)
  const mon150 = {
    id: 999911,
    name: 'Poring 150m',
    lv: 1,
    hp: 500,
    hp_max: 500,
    x: 1150,
    y: 1000,
    spot_id: 1,
    spot_cx: 1000,
    spot_cy: 1000,
    spot_radius: 300
  };

  // Tạo quái 2: Khoảng cách ~250px (tại 1250, 1000)
  const mon250 = {
    id: 999912,
    name: 'Poring 250m',
    lv: 1,
    hp: 500,
    hp_max: 500,
    x: 1250,
    y: 1000,
    spot_id: 1,
    spot_cx: 1000,
    spot_cy: 1000,
    spot_radius: 300
  };

  worldManager.maps[1].monsters.push(mon150, mon250);

  // Case A: explore_radius = 100
  // Cả hai quái đều nằm ngoài 100px -> không được target quái nào
  console.log('  Case A: explore_radius = 100 (Không có quái nào trong tầm 100px)...');
  const resA = await callGame({ explore_radius: 100 });
  assert.strictEqual(resA.player.target_monster_id, null, `Không được target quái nào khi bán kính là 100 (thực tế target: ${resA.player.target_monster_id})`);
  console.log('    ✓ Chính xác: Không target quái nào.');

  // Case B: explore_radius = 200
  // Quái mon150 nằm trong tầm 200px, quái mon250 nằm ngoài -> Chỉ target được mon150
  console.log('  Case B: explore_radius = 200 (Chỉ có quái 999911 trong tầm 200px)...');
  const resB = await callGame({ explore_radius: 200 });
  assert.strictEqual(resB.player.target_monster_id, 999911, `Phải target quái 999911 trong tầm 200px (thực tế target: ${resB.player.target_monster_id})`);
  console.log('    ✓ Chính xác: Đã target quái 999911.');

  // Case C: explore_radius = 300
  // Cả hai quái nằm trong tầm, ưu tiên quái gần hơn (999911 cách 150px vs 999912 cách 250px)
  console.log('  Case C: explore_radius = 300 (Cả hai quái trong tầm, chọn quái gần nhất)...');
  const resC = await callGame({ explore_radius: 300 });
  assert.strictEqual(resC.player.target_monster_id, 999911, `Phải chọn quái gần nhất 999911 (thực tế target: ${resC.player.target_monster_id})`);
  console.log('    ✓ Chính xác: Đã target quái gần nhất 999911.');

  console.log('\n🎉 TẤT CẢ CÁC BỘ TEST EXPLORE RADIUS ĐÃ VƯỢT QUA XUẤT SẮC!\n');
}

runTests().then(() => {
  // Cleanup test user & monsters
  db.prepare('DELETE FROM players WHERE line_uid = ?').run(mockLineUid);
  db.prepare('DELETE FROM users WHERE line_uid = ?').run(mockLineUid);
  if (worldManager.maps[1]) {
    worldManager.maps[1].monsters = originalMonsters;
  }
  process.exit(0);
}).catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  // Khôi phục ngay cả khi lỗi
  if (worldManager.maps[1]) {
    worldManager.maps[1].monsters = originalMonsters;
  }
  process.exit(1);
});
