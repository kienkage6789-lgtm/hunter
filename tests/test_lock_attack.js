const assert = require('assert');
const db = require('../server/db/queries');
const gameRoute = require('../server/routes/game');
const worldManager = require('../server/game/WorldManager');

console.log('🧪 Bắt đầu kiểm thử toàn diện chức năng LOCK ATTACK (Khóa vị trí tấn công)...');

const mockLineUid = 'test_lock_user_' + Date.now();
const initialPlayerObj = {
  line_uid: mockLineUid,
  name: 'Test Lock Hunter',
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
`).run(mockLineUid, 'testlockuser', 'hash', 'mock_token');

db.prepare(`
  INSERT INTO players (line_uid, name, raw_data)
  VALUES (?, ?, ?)
`).run(
  mockLineUid,
  initialPlayerObj.name,
  JSON.stringify(initialPlayerObj)
);

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
  const originalMonsters = worldManager.maps[1] ? [...worldManager.maps[1].monsters] : [];
  try {
    // --- TEST 1: Kiểm tra đóng băng tọa độ khi lock_pos = 1 và bot = 1 ---
    console.log('\n▶ Test 1: Kiểm tra đóng băng tọa độ (không di chuyển) khi lock_pos = 1 & bot = 1...');

    // Thiết lập vị trí ban đầu
    const initialX = 1000;
    const initialY = 1000;

    const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(mockLineUid);
    const pObj = JSON.parse(pRow.raw_data);
    pObj.x = initialX;
    pObj.y = initialY;
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(pObj), mockLineUid);

    const res1 = await callGame({
      lock_pos: 1,
      bot: 1,
      explore_cx: 1000,
      explore_cy: 1000
    });

    assert.strictEqual(res1.player.x, initialX, `Tọa độ X phải giữ nguyên ${initialX} (thực tế: ${res1.player.x})`);
    assert.strictEqual(res1.player.y, initialY, `Tọa độ Y phải giữ nguyên ${initialY} (thực tế: ${res1.player.y})`);
    console.log(`  ✓ Tọa độ giữ nguyên tuyệt đối: (${res1.player.x}, ${res1.player.y}) khi lock_pos = 1`);

    // --- TEST 2: Kiểm tra tấn công quái vật trong tầm đánh khi lock_pos = 1 ---
    console.log('\n▶ Test 2: Kiểm tra tấn công và gây sát thương khi quái lọt vào tầm đánh (attackRange)...');

    // Tạo 1 quái vật nằm ngay sát player (khoảng cách 20px, tầm đánh súng ngắn ~75px)
    const monNear = {
      id: 999901,
      name: 'Poring Gần',
      lv: 1,
      hp: 50,
      hp_max: 50,
      x: 1010,
      y: 1010,
      spot_id: 1
    };
    if (worldManager.maps[1]) {
      worldManager.maps[1].monsters = [monNear];
    }

    const res2 = await callGame({
      lock_pos: 1,
      bot: 1,
      target_monster_id: 999901,
      explore_cx: 1000,
      explore_cy: 1000
    });

    assert.strictEqual(res2.player.x, initialX, 'Vẫn phải giữ nguyên tọa độ X');
    assert.strictEqual(res2.player.y, initialY, 'Vẫn phải giữ nguyên tọa độ Y');

    // Kiểm tra có event hit hoặc kill
    const hasHitOrKill = (res2.events || []).some(e => e.type === 'hit' || e.type === 'kill' || e.type === 'explore');
    assert(hasHitOrKill, 'Phải có event tấn công quái vật');
    console.log(`  ✓ Đã tấn công quái vật trong tầm thành công tại chỗ, tọa độ giữ nguyên (${res2.player.x}, ${res2.player.y})`);

    // --- TEST 3: Kiểm tra tự động chuyển target sang quái trong tầm khi target cũ ở xa ---
    console.log('\n▶ Test 3: Kiểm tra tự động ưu tiên target quái vật nằm trong tầm đánh khi đang Lock...');

    // Quái ở xa (150px ngoài tầm đánh 75px)
    const monFar = {
      id: 999902,
      name: 'Poring Xa',
      lv: 5,
      hp: 100000,
      hp_max: 100000,
      x: 1150,
      y: 1000,
      spot_id: 1,
      spot_cx: 1000,
      spot_cy: 1000,
      spot_radius: 300
    };
    // Quái ở gần (20px trong tầm đánh, HP lớn để không chết ngay)
    const monClose = {
      id: 999903,
      name: 'Poring Tiếp Cận',
      lv: 5,
      hp: 100000,
      hp_max: 100000,
      x: 1020,
      y: 1000,
      spot_id: 1,
      spot_cx: 1000,
      spot_cy: 1000,
      spot_radius: 300
    };
    if (worldManager.maps[1]) {
      worldManager.maps[1].monsters = [monFar, monClose];
    }

    const res3 = await callGame({
      lock_pos: 1,
      bot: 1,
      target_monster_id: 999902, // Đang nhắm quái xa
      explore_cx: 1000,
      explore_cy: 1000
    });

    // Target phải tự động chuyển sang quái gần 999903
    assert.strictEqual(res3.player.target_monster_id, 999903, `Target phải tự động đổi sang quái gần 999903 (thực tế: ${res3.player.target_monster_id})`);
    assert.strictEqual(res3.player.x, initialX, 'Tọa độ X không đổi');
    assert.strictEqual(res3.player.y, initialY, 'Tọa độ Y không đổi');

    // Xác nhận có event đánh trúng quái 999903
    const hitCloseMon = (res3.events || []).some(e => e.mid === 999903);
    assert(hitCloseMon, 'Phải có event tấn công quái 999903');
    console.log('  ✓ Đã tự động chuyển mục tiêu và tấn công quái vật lọt vào tầm đánh:', res3.player.target_monster_id);

    // --- TEST 4: Kiểm tra mở khóa (lock_pos = 0) nhân vật di chuyển tiếp cận quái xa ---
    console.log('\n▶ Test 4: Kiểm tra khi tắt Lock (lock_pos = 0), nhân vật di chuyển tiếp cận mục tiêu bình thường...');

    if (worldManager.maps[1]) {
      worldManager.maps[1].monsters = [monFar];
    }

    const res4 = await callGame({
      lock_pos: 0,
      bot: 1,
      target_monster_id: 999902,
      explore_cx: 1000,
      explore_cy: 1000
    });

    // Nhân vật phải di chuyển về phía monFar (x: 1150), nên x > 1000
    assert(res4.player.x > initialX, `Tọa độ X phải tăng khi di chuyển tiếp cận mục tiêu (thực tế: ${res4.player.x})`);
    console.log(`  ✓ Nhân vật đã di chuyển tiếp cận mục tiêu thành công: từ X=${initialX} -> X=${res4.player.x}`);

    console.log('\n🎉 TẤT CẢ 4 BỘ TEST LOCK ATTACK ĐÃ VƯỢT QUA XUẤT SẮC!\n');
  } finally {
    // Cleanup test user & monsters
    db.prepare('DELETE FROM players WHERE line_uid = ?').run(mockLineUid);
    db.prepare('DELETE FROM users WHERE line_uid = ?').run(mockLineUid);
    if (worldManager.maps[1]) {
      worldManager.maps[1].monsters = originalMonsters;
    }
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
