const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'database.json');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const defaultData = { users: [], players: [], guilds: [], alliances: [] };
fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2));

console.log('Khởi tạo Database JSON thành công tại:', dbPath);
