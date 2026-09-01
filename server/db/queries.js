const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'database.json');
const dbDir = path.dirname(dbPath);
const backupPath = path.join(dbDir, 'database.backup.json');
const backupDir = path.join(dbDir, 'backups');

class JSONDatabase {
  constructor() {
    this.dbPath = dbPath;
    this.dbDir = dbDir;
    this.backupPath = backupPath;
    this.backupDir = backupDir;
    this.maxBackups = 10;
    this.data = { users: [], players: [], guilds: [], alliances: [] };

    this._ensureDirectories();
    this.load();
  }

  _ensureDirectories() {
    try {
      if (!fs.existsSync(this.dbDir)) {
        fs.mkdirSync(this.dbDir, { recursive: true });
      }
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
    } catch (err) {
      console.error('[DB Init] Lỗi tạo thư mục database/backups:', err);
    }
  }

  /**
   * Kiểm tra tính toàn vẹn cấu trúc của dữ liệu JSON
   * @param {any} dataObj 
   * @returns {boolean}
   */
  verifyIntegrity(dataObj) {
    if (!dataObj || typeof dataObj !== 'object') return false;
    if (!Array.isArray(dataObj.users)) return false;
    if (!Array.isArray(dataObj.players)) return false;
    return true;
  }

  /**
   * Tải dữ liệu từ database.json, có cơ chế tự động khôi phục từ backup nếu bị corrupt
   */
  load() {
    this._ensureDirectories();
    let loaded = false;

    // 1. Thử tải từ database.json chính
    if (fs.existsSync(this.dbPath)) {
      try {
        const content = fs.readFileSync(this.dbPath, 'utf8');
        if (content && content.trim().length > 0) {
          const parsed = JSON.parse(content);
          if (this.verifyIntegrity(parsed)) {
            this.data = parsed;
            this.data.guilds = this.data.guilds || [];
            this.data.alliances = this.data.alliances || [];
            console.log(`[DB Load] Users count: ${this.data.users.length}, Players count: ${this.data.players.length}, Guilds count: ${this.data.guilds.length}`);
            loaded = true;

            // Đồng bộ sang backup chính nếu backup chưa tồn tại
            if (!fs.existsSync(this.backupPath)) {
              try {
                fs.copyFileSync(this.dbPath, this.backupPath);
              } catch (e) {}
            }
          } else {
            console.error('[DB Load] LỖI: Dữ liệu database.json không hợp lệ (thiếu users/players).');
          }
        }
      } catch (err) {
        console.error('[DB Load] CẢNH BÁO: Lỗi parse JSON từ database.json:', err.message);
      }
    }

    // 2. Nếu file chính lỗi/corrupt, tự động khôi phục từ database.backup.json
    if (!loaded && fs.existsSync(this.backupPath)) {
      try {
        console.warn('[DB Load] ⚠️ database.json bị hỏng! Đang thử khôi phục từ primary backup (database.backup.json)...');
        const backupContent = fs.readFileSync(this.backupPath, 'utf8');
        const backupParsed = JSON.parse(backupContent);
        if (this.verifyIntegrity(backupParsed)) {
          this.data = backupParsed;
          this.data.guilds = this.data.guilds || [];
          this.data.alliances = this.data.alliances || [];
          this.save();
          console.warn('[DB Load] ✅ PHỤC HỒI THÀNH CÔNG từ database.backup.json!');
          loaded = true;
        }
      } catch (backupErr) {
        console.error('[DB Load] Primary backup cũng bị lỗi parse:', backupErr.message);
      }
    }

    // 3. Nếu backup chính cũng hỏng, quét thư mục backups/ tìm snapshot gần nhất
    if (!loaded && fs.existsSync(this.backupDir)) {
      try {
        console.warn('[DB Load] ⚠️ Đang quét thư mục snapshots data/backups/ để khôi phục...');
        const backupFiles = fs.readdirSync(this.backupDir)
          .filter(f => f.startsWith('database_') && f.endsWith('.json'))
          .map(f => ({
            name: f,
            fullPath: path.join(this.backupDir, f),
            mtime: fs.statSync(path.join(this.backupDir, f)).mtimeMs
          }))
          .sort((a, b) => b.mtime - a.mtime);

        for (const bFile of backupFiles) {
          try {
            const snapContent = fs.readFileSync(bFile.fullPath, 'utf8');
            const snapParsed = JSON.parse(snapContent);
            if (this.verifyIntegrity(snapParsed)) {
              this.data = snapParsed;
              this.data.guilds = this.data.guilds || [];
              this.data.alliances = this.data.alliances || [];
              this.save();
              console.warn(`[DB Load] ✅ PHỤC HỒI THÀNH CÔNG từ snapshot ${bFile.name}!`);
              loaded = true;
              break;
            }
          } catch (snapErr) {
            // Thử snapshot tiếp theo
          }
        }
      } catch (dirErr) {
        console.error('[DB Load] Lỗi quét thư mục backups:', dirErr.message);
      }
    }

    // 4. Fallback an toàn nếu hoàn toàn không có dữ liệu
    if (!loaded) {
      if (!this.data || !Array.isArray(this.data.users)) {
        this.data = { users: [], players: [], guilds: [], alliances: [] };
      }
      console.warn('[DB Load] Khởi tạo dữ liệu in-memory mặc định an toàn.');
    }
  }

  /**
   * Ghi dữ liệu nguyên tử (Atomic Write) qua Temp File + Atomic Rename
   * Chống hỏng file khi crash/mất điện giữa chừng
   */
  save() {
    this._ensureDirectories();
    const payload = JSON.stringify(this.data, null, 2);
    const tmpPath = path.join(this.dbDir, `database.json.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`);

    try {
      // 1. Ghi hoàn chỉnh vào file tạm
      fs.writeFileSync(tmpPath, payload, 'utf8');

      // 2. Thay thế nguyên tử sang file đích
      try {
        fs.renameSync(tmpPath, this.dbPath);
      } catch (renameErr) {
        // Fallback an toàn trên Windows khi file lock (EPERM / EBUSY / EEXIST)
        if (process.platform === 'win32') {
          fs.copyFileSync(tmpPath, this.dbPath);
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        } else {
          throw renameErr;
        }
      }

      // 3. Cập nhật bản sao lưu chính database.backup.json
      try {
        fs.copyFileSync(this.dbPath, this.backupPath);
      } catch (bErr) {}

    } catch (err) {
      // Dọn dẹp file tạm nếu có lỗi
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (e) {}
      console.error('[DB Save] LỖI GHI ĐĨA NGHIÊM TRỌNG:', err.message);
      throw err;
    }
  }

  /**
   * Tạo bản sao lưu có timestamp vào thư mục data/backups/
   * @param {string} [label] 
   * @returns {string} Đường dẫn file backup đã tạo
   */
  createBackup(label = '') {
    this._ensureDirectories();
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const tag = label ? `_${label.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
    const targetFile = path.join(this.backupDir, `database_${ts}${tag}.json`);

    const payload = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(targetFile, payload, 'utf8');
    this._rotateSnapshots();
    return targetFile;
  }

  /**
   * Xoay vòng giữ lại N bản snapshot gần nhất
   */
  _rotateSnapshots() {
    try {
      if (!fs.existsSync(this.backupDir)) return;
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('database_') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          fullPath: path.join(this.backupDir, f),
          mtime: fs.statSync(path.join(this.backupDir, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > this.maxBackups) {
        const toDelete = files.slice(this.maxBackups);
        for (const f of toDelete) {
          try { fs.unlinkSync(f.fullPath); } catch (e) {}
        }
      }
    } catch (err) {
      console.error('[DB Backup Rotate] Lỗi xoay vòng backup:', err.message);
    }
  }

  /**
   * Khôi phục database từ một file backup chỉ định
   * @param {string} backupFilePath 
   * @returns {boolean}
   */
  restoreBackup(backupFilePath) {
    if (!fs.existsSync(backupFilePath)) {
      throw new Error(`File backup không tồn tại: ${backupFilePath}`);
    }
    const content = fs.readFileSync(backupFilePath, 'utf8');
    const parsed = JSON.parse(content);
    if (!this.verifyIntegrity(parsed)) {
      throw new Error('Dữ liệu file backup không đảm bảo tính toàn vẹn (thiếu users/players).');
    }
    this.data = parsed;
    this.save();
    return true;
  }

  /**
   * Lấy danh sách các bản backup hiện có
   * @returns {Array<{ name: string, path: string, size: number, mtime: number }>}
   */
  getBackupList() {
    this._ensureDirectories();
    try {
      return fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('database_') && f.endsWith('.json'))
        .map(f => {
          const fullPath = path.join(this.backupDir, f);
          const st = fs.statSync(fullPath);
          return {
            name: f,
            path: fullPath,
            size: st.size,
            mtime: st.mtimeMs
          };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch (e) {
      return [];
    }
  }

  prepare(query) {
    return {
      get: (...args) => {
        this.load();
        const cleanArgs = args.map((arg, idx) => {
          if (query.includes('password_hash = ?') && idx === 1) return '[REDACTED]';
          if (query.includes('session_token = ?') && idx === 1) return '[REDACTED]';
          return arg;
        });
        console.log(`[DB Query] GET: ${query} | Args: ${JSON.stringify(cleanArgs)}`);
        if (query.includes('FROM users WHERE username = ? AND password_hash = ?')) {
          return this.data.users.find(u => u.username === args[0] && u.password_hash === args[1]);
        }
        if (query.includes('FROM users WHERE username = ?')) {
          return this.data.users.find(u => u.username === args[0]);
        }
        if (query.includes('FROM users WHERE line_uid = ? AND session_token = ?')) {
          return this.data.users.find(u => u.line_uid === args[0] && u.session_token === args[1]);
        }
        if (query.includes('FROM players WHERE line_uid = ?')) {
          return this.data.players.find(p => p.line_uid === args[0]);
        }
        return null;
      },
      run: (...args) => {
        this.load();
        if (query.includes('INSERT INTO users')) {
          this.data.users.push({
            line_uid: args[0], username: args[1], password_hash: args[2], session_token: args[3], role: 'user'
          });
          this.save();
        }
        else if (query.includes('INSERT INTO players')) {
          this.data.players.push({
            line_uid: args[0], name: args[1], lv: 1, exp: 0, hp: 300, hp_max: 300, gold: 0, map: 1, raw_data: args[2]
          });
          this.save();
        }
        else if (query.includes('UPDATE users SET session_token = ?')) {
          const u = this.data.users.find(u => u.line_uid === args[1]);
          if (u) u.session_token = args[0];
          this.save();
        }
        else if (query.includes('UPDATE players SET')) {
          if (query.includes('raw_data = ? WHERE line_uid = ?') && args.length === 2) {
            const p = this.data.players.find(p => p.line_uid === args[1]);
            if (p) {
              p.raw_data = args[0];
              try {
                const parsed = JSON.parse(args[0]);
                if (parsed.exp !== undefined) p.exp = parsed.exp;
                if (parsed.gold !== undefined) p.gold = parsed.gold;
                if (parsed.lv !== undefined) p.lv = parsed.lv;
                if (parsed.map !== undefined) p.map = parsed.map;
              } catch(e) {}
            }
          } else {
            const p = this.data.players.find(p => p.line_uid === args[6]);
            if (p) {
              p.x = args[0]; p.y = args[1]; p.exp = args[2]; p.gold = args[3]; p.lv = args[4]; p.raw_data = args[5];
              try {
                const parsed = JSON.parse(args[5]);
                if (parsed.map !== undefined) p.map = parsed.map;
              } catch(e) {}
            }
          }
          this.save();
        }
        else if (query.includes('DELETE FROM users WHERE line_uid = ?')) {
          this.data.users = this.data.users.filter(u => u.line_uid !== args[0]);
          this.save();
        }
        else if (query.includes('DELETE FROM players WHERE line_uid = ?')) {
          this.data.players = this.data.players.filter(p => p.line_uid !== args[0]);
          this.save();
        }
      }
    };
  }
}

module.exports = new JSONDatabase();
