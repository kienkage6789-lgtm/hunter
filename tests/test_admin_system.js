const assert = require('assert');
const db = require('../server/db/queries');
const worldManager = require('../server/game/WorldManager');
const adminRoutes = require('../server/routes/admin');

function callAdminRoute(reqOptions) {
  return new Promise((resolve) => {
    const req = {
      method: reqOptions.method || 'POST',
      url: reqOptions.url || '/',
      body: reqOptions.body || {},
      query: reqOptions.query || {},
      headers: reqOptions.headers || {},
      ip: '127.0.0.1'
    };
    let statusCode = 200;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        resolve({ status: statusCode, body: data });
      },
      send: (data) => {
        resolve({ status: statusCode, body: data });
      }
    };
    adminRoutes.handle(req, res, () => {
      resolve({ status: statusCode, body: { ok: false, error: 'Route not handled' } });
    });
  });
}

function cleanupData() {
  db.load();
  if (db.data) {
    if (Array.isArray(db.data.users)) {
      db.data.users = db.data.users.filter(u => !u.line_uid.startsWith('test_adm_'));
    }
    if (Array.isArray(db.data.players)) {
      db.data.players = db.data.players.filter(p => !p.line_uid.startsWith('test_adm_'));
    }
    if (Array.isArray(db.data.admin_logs)) {
      db.data.admin_logs = [];
    }
    delete db.data.admin_idempotency;
    db.save();
  }

  // Clear custom bosses from worldManager maps
  for (let mapId in worldManager.maps) {
    worldManager.maps[mapId].monsters = worldManager.maps[mapId].monsters.filter(m => !m.custom_spawn);
  }
}

async function runTest() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ HỆ THỐNG GM ADMIN (GIVE-ITEM & SPAWN-BOSS)');
  console.log('================================================================\n');

  process.env.ADMIN_API_KEY = 'test_admin_secret_key';
  const validHeader = { 'x-admin-api-key': 'test_admin_secret_key' };
  const authBearerHeader = { 'authorization': 'Bearer test_admin_secret_key' };

  cleanupData();

  const testSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const uidAlice = `test_adm_alice_${testSuffix}`;
  const uidBob = `test_adm_bob_${testSuffix}`;
  const uidAdmin = `test_adm_gm_${testSuffix}`;
  const tokAdmin = `tok_gm_${testSuffix}`;

  try {
    db.load();
    db.data.users = db.data.users || [];
    db.data.players = db.data.players || [];

    db.data.users.push(
      { line_uid: uidAlice, username: `u_${uidAlice}`, role: 'user', session_token: 'tok_alice' },
      { line_uid: uidBob, username: `u_${uidBob}`, role: 'user', session_token: 'tok_bob' },
      { line_uid: uidAdmin, username: `gm_${testSuffix}`, role: 'admin', session_token: tokAdmin }
    );

    db.data.players.push(
      {
        line_uid: uidAlice,
        name: 'Alice',
        raw_data: JSON.stringify({
          line_uid: uidAlice,
          name: 'Alice',
          lv: 10,
          gold: 1000,
          p_points: 50,
          wood: 10,
          diamond_blue: 0,
          cards: '{}',
          eggs: '{}',
          module_inventory: '[]',
          sniper_module_inventory: '[]',
          eq2_inv: '[]'
        })
      },
      {
        line_uid: uidBob,
        name: 'Bob',
        raw_data: JSON.stringify({
          line_uid: uidBob,
          name: 'Bob',
          lv: 20,
          gold: 500
        })
      }
    );
    db.save();

    // =========================================================================
    // TEST 1: AUTH & SECURITY (Header-only API Key, Admin Role & Session)
    // =========================================================================
    console.log('▶ Test 1: Auth & Security (Header-only API Key, Admin Role & Session)...');
    {
      // 1. Thiếu header
      const resNoHeader = await callAdminRoute({ url: '/give_p', body: { line_uid: uidAlice, amount: 10 } });
      assert.strictEqual(resNoHeader.status, 401, 'Phải trả về 401 khi thiếu header');

      // 2. Sai key
      const resBadKey = await callAdminRoute({ url: '/give_p', headers: { 'x-admin-api-key': 'wrong_key' }, body: { line_uid: uidAlice, amount: 10 } });
      assert.strictEqual(resBadKey.status, 401, 'Phải trả về 401 khi key không đúng');

      // 3. Key trong query string
      const resQueryKey = await callAdminRoute({ url: '/give_p', query: { admin_api_key: 'test_admin_secret_key' }, body: { line_uid: uidAlice, amount: 10 } });
      assert.strictEqual(resQueryKey.status, 401, 'Chặn truyền key qua query params');

      // 4. Key trong body
      const resBodyKey = await callAdminRoute({ url: '/give_p', body: { admin_api_key: 'test_admin_secret_key', line_uid: uidAlice, amount: 10 } });
      assert.strictEqual(resBodyKey.status, 401, 'Chặn truyền key qua request body');

      // 5. Header hợp lệ (x-admin-api-key & Authorization Bearer)
      const resOkHeader = await callAdminRoute({ url: '/give_p', headers: validHeader, body: { line_uid: uidAlice, amount: 10 } });
      assert.strictEqual(resOkHeader.status, 200);
      assert.strictEqual(resOkHeader.body.ok, true);

      const resOkBearer = await callAdminRoute({ url: '/give_p', headers: authBearerHeader, body: { line_uid: uidAlice, amount: 10 } });
      assert.strictEqual(resOkBearer.status, 200);
      assert.strictEqual(resOkBearer.body.ok, true);

      // 6. User thông thường (role === 'user') cố truyền x-admin-uid -> Phải bị từ chối 403 Forbidden
      const resNonAdminRole = await callAdminRoute({
        url: '/give_p',
        headers: { ...validHeader, 'x-admin-uid': uidAlice, 'x-admin-session-token': 'tok_alice' },
        body: { line_uid: uidAlice, amount: 10 }
      });
      assert.strictEqual(resNonAdminRole.status, 403, 'User role không phải admin phải bị từ chối 403');
      assert.match(resNonAdminRole.body.error, /admin role/);

      // 7. Admin user hợp lệ (role === 'admin') với session token sai -> 401
      const resBadAdminSession = await callAdminRoute({
        url: '/give_p',
        headers: { ...validHeader, 'x-admin-uid': uidAdmin, 'x-admin-session-token': 'fake_token' },
        body: { line_uid: uidAlice, amount: 10 }
      });
      assert.strictEqual(resBadAdminSession.status, 401, 'Admin session token sai phải trả về 401');

      // 8. Admin user hợp lệ (role === 'admin') với session token đúng -> 200 OK
      const resValidAdmin = await callAdminRoute({
        url: '/give_p',
        headers: { ...validHeader, 'x-admin-uid': uidAdmin, 'x-admin-session-token': tokAdmin },
        body: { line_uid: uidAlice, amount: 10 }
      });
      assert.strictEqual(resValidAdmin.status, 200);
      assert.strictEqual(resValidAdmin.body.ok, true);

      // 9. Missing ADMIN_API_KEY in env
      const savedEnvKey = process.env.ADMIN_API_KEY;
      delete process.env.ADMIN_API_KEY;
      const savedNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const resDisabled = await callAdminRoute({ url: '/give_p', headers: validHeader, body: { line_uid: uidAlice, amount: 10 } });
        assert.strictEqual(resDisabled.status, 403, 'Phải trả về 403 khi server chưa cấu hình ADMIN_API_KEY');
      } finally {
        process.env.ADMIN_API_KEY = savedEnvKey;
        process.env.NODE_ENV = savedNodeEnv;
      }

      console.log('  ✓ Xác thực Header-only, Role admin và Session token hoạt động chính xác.');
    }

    // =========================================================================
    // TEST 2: GIVE ITEM VALIDATION
    // =========================================================================
    console.log('\n▶ Test 2: Give Item Payload Validation...');
    {
      // 1. Thiếu line_uid hoặc item_type
      const resNoUid = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { item_type: 'resource', item_id: 'wood', quantity: 10 } });
      assert.strictEqual(resNoUid.body.ok, false);

      // 2. Người chơi không tồn tại
      const resNotFound = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: 'non_existent_uid', item_type: 'resource', item_id: 'wood', quantity: 10 } });
      assert.strictEqual(resNotFound.body.ok, false);
      assert.match(resNotFound.body.error, /Không tìm thấy/);

      // 3. Số lượng âm hoặc bằng 0 hoặc không phải số
      const resNegative = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'resource', item_id: 'wood', quantity: -5 } });
      assert.strictEqual(resNegative.body.ok, false);

      const resZero = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'resource', item_id: 'wood', quantity: 0 } });
      assert.strictEqual(resZero.body.ok, false);

      // 4. item_type không xác định
      const resBadType = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'unknown_magic_type', item_id: 'wood', quantity: 1 } });
      assert.strictEqual(resBadType.body.ok, false);

      // 5. Tài nguyên / Hộp / Slot không hợp lệ
      const resBadRes = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'resource', item_id: 'kryptonite', quantity: 1 } });
      assert.strictEqual(resBadRes.body.ok, false);

      console.log('  ✓ Kiểm tra tính hợp lệ payload give-item nghiêm ngặt.');
    }

    // =========================================================================
    // TEST 3: GIVE RESOURCES & CURRENCIES
    // =========================================================================
    console.log('\n▶ Test 3: Give Resources & Currencies...');
    {
      const resWood = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'resource', item_id: 'wood', quantity: 50 } });
      assert.strictEqual(resWood.body.ok, true);

      const resBlueDia = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'currency', item_id: 'diamond_blue', quantity: 15 } });
      assert.strictEqual(resBlueDia.body.ok, true);

      const resRedDia = await callAdminRoute({ url: '/give-item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'currency', item_id: 'diamond_red', quantity: 5 } });
      assert.strictEqual(resRedDia.body.ok, true);

      db.load();
      const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice);
      const pObj = JSON.parse(pRow.raw_data);
      assert.strictEqual(pObj.wood, 60, 'Gỗ phải tăng từ 10 lên 60');
      assert.strictEqual(pObj.diamond_blue, 15, 'Kim cương xanh phải là 15');
      assert.strictEqual(pObj.diamond_red, 5, 'Kim cương đỏ phải là 5');

      console.log('  ✓ Cấp tài nguyên và tiền tệ (wood, diamond_blue, diamond_red) thành công.');
    }

    // =========================================================================
    // TEST 4: GIVE BOXES
    // =========================================================================
    console.log('\n▶ Test 4: Give Item Boxes...');
    {
      const resModBox = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'box', item_id: 'module_box1', quantity: 3 } });
      assert.strictEqual(resModBox.body.ok, true);

      const resEggBox = await callAdminRoute({ url: '/give_item', headers: validHeader, body: { line_uid: uidAlice, item_type: 'box', item_id: 'egg_box2', quantity: 2 } });
      assert.strictEqual(resEggBox.body.ok, true);

      db.load();
      const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice);
      const pObj = JSON.parse(pRow.raw_data);
      assert.strictEqual(pObj.module_box1, 3);
      assert.strictEqual(pObj.egg_box2, 2);

      console.log('  ✓ Cấp hộp vật phẩm (module_box1, egg_box2) thành công.');
    }

    // =========================================================================
    // TEST 5: GIVE CARDS & EGGS
    // =========================================================================
    console.log('\n▶ Test 5: Give Cards & Eggs...');
    {
      // 1. Thẻ bài thường mid 27 (Vua cây)
      const resCardN = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: { line_uid: uidAlice, item_type: 'card', item_id: 27, quantity: 2, options: { variant: 'n' } }
      });
      assert.strictEqual(resCardN.body.ok, true);

      // 2. Thẻ bài MVP mid 27
      const resCardM = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: { line_uid: uidAlice, item_type: 'card', item_id: 27, quantity: 1, options: { variant: 'm' } }
      });
      assert.strictEqual(resCardM.body.ok, true);

      // 3. Trứng quái vật mid 42 (Vua sói)
      const resEgg = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: { line_uid: uidAlice, item_type: 'egg', item_id: 42, quantity: 5, options: { variant: 'n' } }
      });
      assert.strictEqual(resEgg.body.ok, true);

      db.load();
      const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice);
      const pObj = JSON.parse(pRow.raw_data);
      const cards = typeof pObj.cards === 'string' ? JSON.parse(pObj.cards) : pObj.cards;
      const eggs = typeof pObj.eggs === 'string' ? JSON.parse(pObj.eggs) : pObj.eggs;

      assert.strictEqual(cards['27'].n, 2, 'Thẻ bài thường 27 phải là 2');
      assert.strictEqual(cards['27'].m, 1, 'Thẻ bài MVP 27 phải là 1');
      assert.strictEqual(eggs['42'].n, 5, 'Trứng thường 42 phải là 5');

      console.log('  ✓ Cấp thẻ bài và trứng theo schema JSON chính xác.');
    }

    // =========================================================================
    // TEST 6: GIVE MODULES & 30-SLOT BAG LIMIT
    // =========================================================================
    console.log('\n▶ Test 6: Give Modules & 30-slot Capacity Limit...');
    {
      // 1. Cấp mô-đun súng lục T3
      const resMod1 = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: {
          line_uid: uidAlice,
          item_type: 'module',
          item_id: 'pistol',
          quantity: 2,
          options: { rarity: 3, slot: 'barrel', plus: 2 }
        }
      });
      assert.strictEqual(resMod1.body.ok, true);

      db.load();
      let pObj = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice).raw_data);
      let pistolInv = JSON.parse(pObj.module_inventory);
      assert.strictEqual(pistolInv.length, 2);
      assert.strictEqual(pistolInv[0].rarity, 3);
      assert.strictEqual(pistolInv[0].plus, 2);

      // 2. Cấp thêm 28 mô-đun để đạt đủ 30 slot
      const resMod28 = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: {
          line_uid: uidAlice,
          item_type: 'module',
          item_id: 'pistol',
          quantity: 28,
          options: { rarity: 2, slot: 'sight', plus: 0 }
        }
      });
      assert.strictEqual(resMod28.body.ok, true);

      pObj = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice).raw_data);
      pistolInv = JSON.parse(pObj.module_inventory);
      assert.strictEqual(pistolInv.length, 30, 'Túi đồ mô-đun pistol phải đạt tối đa 30 món');

      // 3. Thử cấp thêm 1 mô-đun khi túi đã đầy 30 món -> Phải bị từ chối
      const resFull = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: {
          line_uid: uidAlice,
          item_type: 'module',
          item_id: 'pistol',
          quantity: 1,
          options: { rarity: 1, slot: 'barrel' }
        }
      });
      assert.strictEqual(resFull.body.ok, false);
      assert.match(resFull.body.error, /đã đầy/);

      console.log('  ✓ Cấp mô-đun và thực thi giới hạn túi đồ tối đa 30 món hoàn hảo.');
    }

    // =========================================================================
    // TEST 7: GIVE EQ2 GEAR & AFFIXES
    // =========================================================================
    console.log('\n▶ Test 7: Give EQ2 Gear & Custom Affixes...');
    {
      const resEq = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: {
          line_uid: uidAlice,
          item_type: 'eq2',
          item_id: 'head',
          quantity: 1,
          options: {
            tier: 4,
            level: 50,
            affixes: [['atk', 25], ['spd', 10], ['def', 15]]
          }
        }
      });
      assert.strictEqual(resEq.body.ok, true);

      db.load();
      const pObj = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice).raw_data);
      const eq2Inv = JSON.parse(pObj.eq2_inv);
      assert.strictEqual(eq2Inv.length, 1);
      assert.strictEqual(eq2Inv[0].s, 'head');
      assert.strictEqual(eq2Inv[0].t, 4);
      assert.strictEqual(eq2Inv[0].lv, 50);
      assert.deepStrictEqual(eq2Inv[0].af, [['atk', 25], ['spd', 10], ['def', 15]]);

      console.log('  ✓ Cấp trang bị EQ2 với chỉ số affixes tùy chỉnh thành công.');
    }

    // =========================================================================
    // TEST 8: IDEMPOTENCY ON GIVE ITEM (Chống lặp request)
    // =========================================================================
    console.log('\n▶ Test 8: Idempotency Key on Give Item...');
    {
      const reqId = `req_idemp_give_${testSuffix}`;

      // Lần 1
      const res1 = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: {
          line_uid: uidAlice,
          item_type: 'resource',
          item_id: 'stone',
          quantity: 100,
          req_id: reqId
        }
      });
      assert.strictEqual(res1.body.ok, true);

      // Lần 2 với cùng req_id
      const res2 = await callAdminRoute({
        url: '/give_item',
        headers: validHeader,
        body: {
          line_uid: uidAlice,
          item_type: 'resource',
          item_id: 'stone',
          quantity: 100,
          req_id: reqId
        }
      });
      assert.strictEqual(res2.body.ok, true);

      db.load();
      const pObj = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice).raw_data);
      assert.strictEqual(pObj.stone, 100, 'Stone chỉ được cộng 100 (không bị nhân đôi lên 200)');

      console.log('  ✓ Idempotency req_id ngăn chặn double-credit hoàn hảo.');
    }

    // =========================================================================
    // TEST 9: ATOMIC ROLLBACK ON DISK ERROR (GIVE ITEM)
    // =========================================================================
    console.log('\n▶ Test 9: Atomic Rollback on Disk Error (Give Item)...');
    {
      const originalSave = db.save;
      try {
        db.save = () => {
          throw new Error('Simulated disk error during admin give_item');
        };

        const res = await callAdminRoute({
          url: '/give_item',
          headers: validHeader,
          body: { line_uid: uidBob, item_type: 'currency', item_id: 'gold', quantity: 9999 }
        });
        assert.strictEqual(res.status, 500, 'Phải trả về 500 khi lưu đĩa thất bại');
      } finally {
        db.save = originalSave;
      }

      db.load();
      const pObjBob = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidBob).raw_data);
      assert.strictEqual(pObjBob.gold, 500, 'Gold của Bob phải được khôi phục nguyên vẹn 500');

      console.log('  ✓ Snapshot rollback nguyên tử khi lỗi đĩa hoạt động an toàn 100%.');
    }

    // =========================================================================
    // TEST 10: SPAWN BOSS VALIDATION
    // =========================================================================
    console.log('\n▶ Test 10: Spawn Boss Payload Validation...');
    {
      // 1. Thiếu map_id
      const resNoMap = await callAdminRoute({ url: '/spawn_boss', headers: validHeader, body: { mid: 27 } });
      assert.strictEqual(resNoMap.body.ok, false);

      // 2. map_id không hợp lệ (ví dụ map 99)
      const resBadMap = await callAdminRoute({ url: '/spawn_boss', headers: validHeader, body: { map_id: 99, mid: 27 } });
      assert.strictEqual(resBadMap.body.ok, false);
      assert.match(resBadMap.body.error, /Bản đồ không hợp lệ/);

      console.log('  ✓ Kiểm tra tính hợp lệ payload spawn-boss nghiêm ngặt.');
    }

    // =========================================================================
    // TEST 11: SPAWN BOSS FUNCTIONALITY & RETRIEVAL
    // =========================================================================
    console.log('\n▶ Test 11: Spawn Boss Functionality & WorldManager Retrieval...');
    {
      // 1. Spawn Valkyrie trên Map 10
      const resValk = await callAdminRoute({
        url: '/spawn_boss',
        headers: validHeader,
        body: {
          map_id: 10,
          mid: 208,
          name: 'Nữ Thần Valkyrie GM',
          lv: 85,
          hp: 100000,
          x: 1200,
          y: 1300,
          emoji: '👼'
        }
      });
      assert.strictEqual(resValk.body.ok, true);
      assert.ok(resValk.body.boss);
      assert.strictEqual(resValk.body.boss.name, 'Nữ Thần Valkyrie GM');
      assert.strictEqual(resValk.body.boss.map, 10);
      assert.strictEqual(resValk.body.boss.hp, 100000);

      // 2. Kiểm tra WorldManager.getBossesForMap(10)
      const bossesMap10 = worldManager.getBossesForMap(10);
      const valkInWorld = bossesMap10.find(b => b.name === 'Nữ Thần Valkyrie GM');
      assert.ok(valkInWorld, 'Boss vừa triệu hồi phải xuất hiện trong danh sách Boss của Map 10');
      assert.strictEqual(valkInWorld.is_mvp, 1);
      assert.strictEqual(valkInWorld.lv, 85);

      console.log('  ✓ Triệu hồi Boss và đồng bộ vào WorldManager/game poll thành công.');
    }

    // =========================================================================
    // TEST 12: SPAWN BOSS CONCURRENT IDEMPOTENCY & CAPACITY LIMIT
    // =========================================================================
    console.log('\n▶ Test 12: Spawn Boss Concurrent Idempotency & 15-Boss Limit...');
    {
      const spawnReqId = `req_idemp_spawn_${testSuffix}`;

      // 1. Gửi đồng thời (Concurrent) 2 requests cùng req_id
      const [resSp1, resSp2] = await Promise.all([
        callAdminRoute({
          url: '/spawn_boss',
          headers: validHeader,
          body: { map_id: 1, mid: 27, req_id: spawnReqId }
        }),
        callAdminRoute({
          url: '/spawn-boss',
          headers: validHeader,
          body: { map_id: 1, mid: 27, req_id: spawnReqId }
        })
      ]);

      assert.strictEqual(resSp1.body.ok, true);
      assert.strictEqual(resSp2.body.ok, true);
      assert.strictEqual(resSp1.body.boss.id, resSp2.body.boss.id, 'Concurrent idempotency phải trả về cùng ID Boss');

      // 2. Capacity limit test: Spawn đến khi đạt 15 Boss tùy chỉnh trên Map 3
      for (let i = 0; i < 15; i++) {
        worldManager.spawnCustomBoss(3, { mid: 48, name: `Demon Lord ${i}` });
      }

      // Thử spawn cái thứ 16 -> Phải bị từ chối
      const resLimit = await callAdminRoute({
        url: '/spawn_boss',
        headers: validHeader,
        body: { map_id: 3, mid: 48, name: 'Demon Lord 16' }
      });
      assert.strictEqual(resLimit.body.ok, false);
      assert.match(resLimit.body.error, /giới hạn tối đa 15 Boss/);

      console.log('  ✓ Lock chống race condition concurrent spawn và giới hạn tối đa 15 Boss hoạt động hoàn hảo.');
    }

    // =========================================================================
    // TEST 13: SPAWN BOSS DISK ERROR ROLLBACK (WORLDMANAGER MEMORY & DB)
    // =========================================================================
    console.log('\n▶ Test 13: Spawn Boss Disk Error Rollback (Memory & DB)...');
    {
      const originalSave = db.save;
      const initialBossesCountMap5 = (worldManager.maps[5] ? worldManager.maps[5].monsters.length : 0);

      try {
        db.save = () => {
          throw new Error('Simulated disk error during spawn_boss');
        };

        const res = await callAdminRoute({
          url: '/spawn_boss',
          headers: validHeader,
          body: { map_id: 5, mid: 75, name: 'Failing Boss' }
        });
        assert.strictEqual(res.status, 500, 'Phải trả về 500 khi lưu đĩa thất bại');
      } finally {
        db.save = originalSave;
      }

      // Xác minh quái không bị lưu rác lại trong WorldManager memory
      const currentBossesCountMap5 = (worldManager.maps[5] ? worldManager.maps[5].monsters.length : 0);
      assert.strictEqual(currentBossesCountMap5, initialBossesCountMap5, 'Boss sinh thất bại phải được xóa sạch khỏi WorldManager');

      console.log('  ✓ Rollback nguyên tử khi lỗi đĩa (xóa quái khỏi memory và phục hồi DB) hoạt động chuẩn xác.');
    }

    // =========================================================================
    // TEST 14: ADMIN AUDIT LOGGING & REGRESSION
    // =========================================================================
    console.log('\n▶ Test 14: Admin Audit Logging & Regression on existing endpoints...');
    {
      db.load();
      assert.ok(Array.isArray(db.data.admin_logs), 'admin_logs phải là mảng');
      assert.ok(db.data.admin_logs.length > 0, 'Phải có các bản ghi nhật ký admin');

      const lastLog = db.data.admin_logs[0];
      assert.ok(lastLog.id.startsWith('alog_'));
      assert.ok(lastLog.action);
      assert.ok(lastLog.created_at);
      assert.ok(lastLog.result);

      // Regression on existing endpoints
      const resP = await callAdminRoute({ url: '/give_p', headers: validHeader, body: { line_uid: uidAlice, amount: 200 } });
      assert.strictEqual(resP.body.ok, true);

      const resGold = await callAdminRoute({ url: '/give_gold', headers: validHeader, body: { line_uid: uidAlice, amount: 5000 } });
      assert.strictEqual(resGold.body.ok, true);

      const resLv = await callAdminRoute({ url: '/set_level', headers: validHeader, body: { line_uid: uidAlice, level: 75 } });
      assert.strictEqual(resLv.body.ok, true);

      db.load();
      const pObj = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uidAlice).raw_data);
      assert.strictEqual(pObj.p_points, 280);
      assert.strictEqual(pObj.gold, 6000);
      assert.strictEqual(pObj.lv, 75);

      console.log('  ✓ Admin Audit Log ghi nhận đầy đủ metadata và các endpoint hiện hữu chạy 100% ổn định.');
    }

    console.log('\n🎉 TẤT CẢ 14 BỘ KIỂM THỬ HỆ THỐNG GM ADMIN ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupData();
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!\n');
  }
}

runTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
