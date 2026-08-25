# 🛸 Ragnalok Private Server

> Private Server hoàn toàn độc lập cho game **Ragnalok Online (XHRPG)**
> Không phụ thuộc vào `ragnalok.online`

## Quick Start

```bash
npm install
node server/db/init.js   # Khởi tạo database
npm start                # Chạy server port 3000
```

Mở `http://localhost:3000/play` trong trình duyệt.

## Tài liệu

- [📋 PLAN.md](docs/PLAN.md) — Kế hoạch chi tiết xây dựng
- [🔌 game_api_reference.md](docs/game_api_reference.md) — API reference đã reverse-engineer

## Cấu trúc

| Thư mục | Mục đích |
|---|---|
| `client/` | Game client (xhrpg_canvas.js, assets) — đã có sẵn |
| `server/` | Backend Node.js + Express — cần viết |
| `data/` | Dữ liệu tĩnh (map, zone, monster defs) |
| `docs/` | Tài liệu và kế hoạch |
