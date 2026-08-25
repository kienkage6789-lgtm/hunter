const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/queries'); // Ensure DB is loaded

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url} - Body:`, req.body);
  next();
});

// Cung cấp các file tĩnh của client
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/client', express.static(path.join(__dirname, '..', 'client')));
// (Một số file có thể tải từ /js, /css)
app.use('/js', express.static(path.join(__dirname, '..', 'client')));
app.use('/css', express.static(path.join(__dirname, '..', 'client')));

// Routes
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const upgradeRoutes = require('./routes/upgrade');
const warpRoutes = require('./routes/warp');
const marketRoutes = require('./routes/market');
const offlineRoutes = require('./routes/offline');
const arenaRoutes = require('./routes/arena');
const leaderboardRoutes = require('./routes/leaderboard');
const vipRoutes = require('./routes/vip');
const droplogRoutes = require('./routes/droplog');
const tradeRoutes = require('./routes/trade');
const cwarRoutes = require('./routes/cwar');
const guildRoutes = require('./routes/guild');
const chatRoutes = require('./routes/chat');
const onlineCountRoutes = require('./routes/online_count');
const translateRoutes = require('./routes/translate');
const premiumRoutes = require('./routes/premium');
const adminRoutes = require('./routes/admin');

app.use('/api', authRoutes);
// Game gốc dùng đường dẫn php này
app.use('/xhrpg_game.php', gameRoutes);
app.use('/xhrpg_upgrade.php', upgradeRoutes);
app.use('/xhrpg_warp.php', warpRoutes);
app.use('/xhrpg_market.php', marketRoutes);
app.use('/xhrpg_offline.php', offlineRoutes);
app.use('/xhrpg_arena.php', arenaRoutes);
app.use('/xhrpg_leaderboard.php', leaderboardRoutes);
app.use('/xhrpg_vip.php', vipRoutes);
app.use('/xhrpg_droplog.php', droplogRoutes);
app.use('/xhrpg_trade.php', tradeRoutes);
app.use('/xhrpg_cwar.php', cwarRoutes);
app.use('/xhrpg_guild.php', guildRoutes);
app.use('/xhrpg_chat.php', chatRoutes);
app.use('/xhrpg_online_count.php', onlineCountRoutes);
app.use('/xhrpg_translate.php', translateRoutes);
app.use('/xhrpg_premium.php', premiumRoutes);
app.use('/api/admin', adminRoutes);
app.use('/xhrpg_google_auth.php', authRoutes); // fallback

app.get('/', (req, res) => {
  res.redirect('/client/play.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Ragnalok Private Server MVP đang chạy tại http://localhost:${PORT}`);
});
