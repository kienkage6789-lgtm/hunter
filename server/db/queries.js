const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'database.json');

class JSONDatabase {
  constructor() {
    this.data = { users: [], players: [] };
    this.load();
  }
  
  load() {
    if (fs.existsSync(dbPath)) {
      const content = fs.readFileSync(dbPath, 'utf8');
      try {
        this.data = JSON.parse(content);
        this.data.guilds = this.data.guilds || [];
        this.data.alliances = this.data.alliances || [];
        console.log(`[DB Load] Users count: ${this.data.users.length}, Players count: ${this.data.players.length}, Guilds count: ${this.data.guilds.length}`);
      } catch (err) {
        console.error("[DB Load] Lỗi parse JSON:", err);
      }
    }
  }

  save() {
    fs.writeFileSync(dbPath, JSON.stringify(this.data, null, 2));
  }

  prepare(query) {
    return {
      get: (...args) => {
        this.load();
        console.log(`[DB Query] GET: ${query} | Args: ${JSON.stringify(args)}`);
        if (query.includes('FROM users WHERE username = ? AND password_hash = ?')) {
          return this.data.users.find(u => u.username === args[0] && u.password_hash === args[1]);
        }
        if (query.includes('FROM users WHERE username = ?')) {
          return this.data.users.find(u => u.username === args[0]);
        }
        if (query.includes('FROM users WHERE line_uid = ? AND session_token = ?')) {
          console.log(`[DB Query] Users list: ${JSON.stringify(this.data.users)}`);
          console.log(`[DB Query] Args: line_uid=${args[0]} (type: ${typeof args[0]}), token=${args[1]} (type: ${typeof args[1]})`);
          const match = this.data.users.find(u => u.line_uid === args[0] && u.session_token === args[1]);
          console.log(`[DB Query] Match: ${JSON.stringify(match)}`);
          return match;
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
