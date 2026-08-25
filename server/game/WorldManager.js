const fs = require('fs');
const path = require('path');

let spotsCache = {};
try {
  const spotsPath = path.join(__dirname, '..', '..', 'data', 'spots_cache.json');
  spotsCache = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));
} catch (err) {
  console.error("Lỗi đọc spots_cache.json trong WorldManager", err);
}

let monMastersCache = {};
try {
  const monMastersPath = path.join(__dirname, '..', '..', 'data', 'mon_masters_cache.json');
  monMastersCache = JSON.parse(fs.readFileSync(monMastersPath, 'utf8'));
} catch (err) {
  console.error("Lỗi đọc mon_masters_cache.json trong WorldManager", err);
}

// Định nghĩa bổ sung spots cho các map thiếu trong spots_cache.json
const ADDITIONAL_SPOTS = {
  3: [
    { name: "Thung lũng Băng Giá", cx: 1125, cy: 1125, radius: 375, lv_min: 40, lv_max: 45, emoji: "❄️" },
    { name: "Động Tuyết Sâu", cx: 1850, cy: 1125, radius: 200, lv_min: 46, lv_max: 54, emoji: "❄️" }
  ],
  6: [
    { name: "Rạn San Hô", cx: 1125, cy: 1125, radius: 375, lv_min: 55, lv_max: 60, emoji: "🌊" },
    { name: "Hải Vực Tối", cx: 1850, cy: 1125, radius: 200, lv_min: 61, lv_max: 69, emoji: "🌊" }
  ],
  10: [
    { name: "Lối vào Rừng Rồng", cx: 1125, cy: 1125, radius: 375, lv_min: 70, lv_max: 75, emoji: "🐉" },
    { name: "Lăng Mộ Cổ", cx: 1850, cy: 1125, radius: 200, lv_min: 76, lv_max: 85, emoji: "🐉" }
  ],
  13: [
    { name: "Tinh Vân Trung Tâm", cx: 1125, cy: 1125, radius: 375, lv_min: 86, lv_max: 92, emoji: "⭐" },
    { name: "Hố Đen Vũ Trụ", cx: 1850, cy: 1125, radius: 200, lv_min: 93, lv_max: 99, emoji: "⭐" }
  ],
  4: [
    { name: "Đấu trường Arena", cx: 1125, cy: 1125, radius: 300, lv_min: 20, lv_max: 99, emoji: "⚔️" }
  ],
  11: [
    { name: "Lâu đài Guild", cx: 1125, cy: 1125, radius: 250, lv_min: 1, lv_max: 10, emoji: "🏯" }
  ],
  12: [
    { name: "Dungeon Tầng 1", cx: 1125, cy: 1125, radius: 300, lv_min: 20, lv_max: 50, emoji: "🕳️" }
  ]
};

// Map các map newbie sang các map chính để lấy spots
const MAP_SPOT_MIRRORS = {
  7: 1, // Map 7 (Newbie Central) dùng spots Map 1
  8: 2, // Map 8 (Newbie Desert) dùng spots Map 2
  9: 3  // Map 9 (Newbie Ice Land) dùng spots Map 3
};

class WorldManager {
  constructor() {
    this.maps = {};
    this.activePlayers = {}; // line_uid -> { name, x, y, lv, mapId, lastSeen }
    this.respawnQueue = []; // Hàng đợi hồi sinh: [{ mapId, spot, respawnTime }]
    this.monMastersCache = monMastersCache;
    
    // Gom nhóm quái vật theo Level để spawn nhanh hơn
    this.monstersByLv = {};
    for (let mid in monMastersCache) {
      const mon = monMastersCache[mid];
      const lv = parseInt(mon.lv);
      if (!this.monstersByLv[lv]) {
        this.monstersByLv[lv] = [];
      }
      this.monstersByLv[lv].push({
        mid: parseInt(mid),
        name: mon.n,
        lv: lv,
        emoji: mon.e
      });
    }

    // Khởi tạo và spawn quái cho tất cả 13 bản đồ
    const allMapIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    for (let mapId of allMapIds) {
      this.maps[mapId] = {
        monsters: [],
        nextMonsterId: 1
      };

      const spots = this.getSpotsForMap(mapId);
      if (spots.length > 0) {
        // Sinh quái mặc định: 36 quái cho mỗi spot
        const targetCount = spots.length * 36;
        for (let i = 0; i < targetCount; i++) {
          this.spawnMonster(mapId);
        }
      }
    }

    this.lastMvpSpawnHour = new Date().getHours();
    this.spawnMvps();
    
    // Vòng lặp hồi sinh và di chuyển chạy mỗi 1 giây để kiểm tra queue hồi sinh nhanh chóng
    setInterval(() => this.tick(), 1000);
  }

  getSpotsForMap(mapId) {
    const id = parseInt(mapId);
    const sourceMapId = MAP_SPOT_MIRRORS[id] || id;
    let spots = spotsCache[sourceMapId] || ADDITIONAL_SPOTS[sourceMapId] || [];
    return spots;
  }

  getMonsterHpMax(lv) {
    if (lv <= 3) {
      return lv * 30; // lv 1 -> 30, lv 2 -> 60, lv 3 -> 90
    }
    if (lv <= 10) {
      return 90 + (lv - 3) * 150; // lv 10 -> 1140
    }
    if (lv <= 20) {
      return 1140 + (lv - 10) * 500; // lv 20 -> 6140
    }
    return 3600 + lv * 250; // lv 21 -> 8850, lv 22 -> 9100, v.v.
  }

  spawnMonster(mapId, targetSpot = null) {
    const map = this.maps[mapId];
    if (!map) return;
    
    const spots = this.getSpotsForMap(mapId);
    if (spots.length === 0) return; // Map không có quái (ví dụ Nhà Map 5)

    const numSpots = spots.length;
    const maxLimit = numSpots * 50; 
    if (map.monsters.length >= maxLimit) return;
    
    // Chọn spot xác định hoặc ngẫu nhiên
    const spot = targetSpot || spots[Math.floor(Math.random() * spots.length)];
    
    // Sinh tọa độ trong vòng tròn của spot
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * spot.radius;
    const x = spot.cx + Math.cos(angle) * r;
    const y = spot.cy + Math.sin(angle) * r;

    // Tìm các loại quái vật hợp lệ trong khoảng lv_min đến lv_max
    let candidates = [];
    for (let l = spot.lv_min; l <= spot.lv_max; l++) {
      if (this.monstersByLv[l]) {
        candidates.push(...this.monstersByLv[l]);
      }
    }

    // Nếu không tìm thấy quái phù hợp, fallback
    let type = { mid: 1, name: 'Gà con', lv: 1 };
    if (candidates.length > 0) {
      type = candidates[Math.floor(Math.random() * candidates.length)];
    }
      
    const hp_max = this.getMonsterHpMax(type.lv);

    map.monsters.push({
      id: map.nextMonsterId++,
      mid: type.mid,
      lv: type.lv,
      hp: hp_max,
      hp_max: hp_max,
      x: Math.round(x),
      y: Math.round(y),
      name: type.name,
      spot_cx: spot.cx,
      spot_cy: spot.cy,
      spot_radius: spot.radius,
      spot: spot // Lưu trữ thông tin spot để đưa vào hàng đợi hồi sinh khi chết
    });
  }

  spawnMvpMonster(mapId, name, lv, mid, emoji) {
    const map = this.maps[mapId];
    if (!map) return;
    
    const spots = this.getSpotsForMap(mapId);
    if (spots.length === 0) return;
    const spot = spots[Math.floor(Math.random() * spots.length)];
    
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * spot.radius;
    const x = spot.cx + Math.cos(angle) * r;
    const y = spot.cy + Math.sin(angle) * r;
    
    const hp_max = this.getMonsterHpMax(lv) * 5; // 5x HP for MVP
    
    map.monsters.push({
      id: map.nextMonsterId++,
      mid: mid,
      lv: lv,
      hp: hp_max,
      hp_max: hp_max,
      x: Math.round(x),
      y: Math.round(y),
      name: name,
      is_mvp: true, // Mark as MVP boss
      sprite_emoji: emoji,
      spot_cx: spot.cx,
      spot_cy: spot.cy,
      spot_radius: spot.radius,
      spot: spot
    });
  }

  spawnMvps() {
    console.log("[WorldManager] Spawning hourly MVP bosses...");
    // Clear any existing MVP monsters to prevent stacking
    for (let mapId in this.maps) {
      this.maps[mapId].monsters = this.maps[mapId].monsters.filter(m => !m.is_mvp);
    }
    
    // Spawn rare monsters on Map 3
    this.spawnMvpMonster(3, "Chúa tể ma cà rồng", 42, 48, "🧛");
    this.spawnMvpMonster(3, "Chúa tể ác quỷ", 52, 54, "😈");
    
    // Spawn Valkyrie on Map 10
    this.spawnMvpMonster(10, "Nữ Thần Valkyrie", 80, 208, "👼");
  }

  updatePlayerPosition(line_uid, name, x, y, lv, mapId) {
    this.activePlayers[line_uid] = {
      name,
      x,
      y,
      lv,
      map: mapId,
      lastSeen: Date.now()
    };
  }

  getOthersOnMap(mapId, excludeUid) {
    const list = [];
    const now = Date.now();
    for (let uid in this.activePlayers) {
      if (uid === excludeUid) continue;
      const p = this.activePlayers[uid];
      if (p.map === mapId && now - p.lastSeen < 15000) {
        list.push({
          name: p.name,
          x: p.x,
          y: p.y,
          lv: p.lv,
          map: p.map,
          ts: Math.floor(p.lastSeen / 1000)
        });
      }
    }
    return list;
  }

  tick() {
    const now = Date.now();

    // 0. Hourly MVP Spawning (Minute 00)
    const d = new Date();
    if (d.getMinutes() === 0 && d.getHours() !== this.lastMvpSpawnHour) {
      this.lastMvpSpawnHour = d.getHours();
      this.spawnMvps();
    }

    // 1. Hồi sinh quái vật đã hết thời gian chờ (cooldown 5 giây)
    const ready = this.respawnQueue.filter(item => now >= item.respawnTime);
    this.respawnQueue = this.respawnQueue.filter(item => now < item.respawnTime);

    for (const item of ready) {
      this.spawnMonster(item.mapId, item.spot);
    }

    // 2. Di chuyển quái vật ngẫu nhiên trong spot của chúng
    for (let mapId in this.maps) {
      const map = this.maps[mapId];
      map.monsters.forEach(m => {
        const nextX = m.x + Math.round(Math.random() * 48 - 24);
        const nextY = m.y + Math.round(Math.random() * 48 - 24);
        
        // Kiểm tra xem tọa độ mới có nằm trong spot không
        const dx = nextX - m.spot_cx;
        const dy = nextY - m.spot_cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist <= m.spot_radius) {
          m.x = nextX;
          m.y = nextY;
        } else {
          // Quay đầu hướng về tâm spot
          const angle = Math.atan2(m.spot_cy - m.y, m.spot_cx - m.x);
          m.x += Math.round(Math.cos(angle) * 17);
          m.y += Math.round(Math.sin(angle) * 17);
        }
      });
    }

    // 3. Dọn dẹp danh sách player không hoạt động (> 60 giây)
    for (let uid in this.activePlayers) {
      if (now - this.activePlayers[uid].lastSeen > 60000) {
        delete this.activePlayers[uid];
      }
    }
  }

  getMonster(mapId, monsterId) {
    const map = this.maps[mapId];
    if (!map) return null;
    return map.monsters.find(m => m.id === monsterId) || null;
  }

  getMonstersInRadius(mapId, cx, cy, radius) {
    const map = this.maps[mapId];
    if (!map) return [];
    
    return map.monsters.filter(m => {
      const dx = m.x - cx;
      const dy = m.y - cy;
      return Math.sqrt(dx*dx + dy*dy) <= radius;
    });
  }

  damageMonster(mapId, monsterId, damage) {
    const map = this.maps[mapId];
    if (!map) return null;
    
    const idx = map.monsters.findIndex(m => m.id === monsterId);
    if (idx === -1) return null;
    
    const m = map.monsters[idx];
    m.hp -= damage;
    
    if (m.hp <= 0) {
      // Đưa vào hàng đợi hồi sinh sau đúng 5 giây tại đúng spot cũ (Không hồi sinh tự động đối với quái MVP)
      if (m.spot && !m.is_mvp) {
        this.respawnQueue.push({
          mapId: mapId,
          spot: m.spot,
          respawnTime: Date.now() + 5000 // 5 giây hồi sinh
        });
      }
      map.monsters.splice(idx, 1);
      // EXP nhận được tăng theo lv quái
      return { killed: true, exp: m.lv * 15 + 10, gold: m.lv * 5 + 15 };
    }
    return { killed: false, hp: m.hp };
  }
}

// Singleton
const worldManager = new WorldManager();
module.exports = worldManager;
