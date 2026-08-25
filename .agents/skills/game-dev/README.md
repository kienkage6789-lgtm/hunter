# Game Dev Skill Set

Bộ skill phát triển game cá nhân chuyên nghiệp cho Claude.  
Tối ưu token, duy trì ngữ cảnh xuyên session, workflow từ plan đến release.

---

## Cấu trúc

```
game-dev-skill/
├── SKILL.md                            ← Master skill (Claude đọc đây đầu tiên)
├── references/
│   ├── plan.md                         ← GDD, milestone, task, sprint
│   ├── design.md                       ← Mechanic, loop, balance, UX
│   ├── code.md                         ← Architecture, engine patterns, bug fix
│   └── test.md                         ← Bug report, QA, playtest, release
└── assets/
    └── PROJECT_CONTEXT_TEMPLATE.md     ← Template file bạn tự maintain
```

---

## Cài đặt

### Option A — Drag & Drop (Khuyến nghị)
1. Tải file `.skill` về
2. Kéo thả vào cửa sổ Claude → Bấm **Save skill**
3. Skill xuất hiện trong danh sách của bạn

### Option B — Thủ công
1. Giải nén folder `game-dev-skill/`
2. Trong Claude: Settings → Skills → Add custom skill
3. Upload folder hoặc từng file

---

## Workflow cơ bản

### Bắt đầu dự án mới
```
Bạn: "Tôi muốn làm game [mô tả]. Giúp tôi tạo GDD và setup project context."
→ Claude load SKILL.md + references/plan.md → tạo GDD + context template
→ Bạn điền thông tin vào PROJECT_CONTEXT_TEMPLATE.md
```

### Mỗi session làm việc
```
1. Mở file PROJECT_CONTEXT.md (local)
2. Copy toàn bộ nội dung
3. Paste vào đầu chat với Claude
4. Claude parse → xác nhận → bắt đầu làm việc

Cuối session:
5. Claude tạo SESSION SUMMARY
6. Bạn cập nhật PROJECT_CONTEXT.md với summary đó
7. Đóng chat → session sau tiếp tục từ đây
```

### Chỉ định task cụ thể
```
"[GAME_CODE] Fix bug player xuyên tường khi dash"
"[GAME_DESIGN] Thiết kế mechanic upgrade cho weapon"
"[GAME_PLAN] Breakdown task cho milestone M3"
"[GAME_TEST] Viết test case cho save/load system"
```

---

## Token Budget

| Approach | Token/session | Ghi chú |
|---|---|---|
| Paste toàn bộ conversation history | 3000-10000+ | ❌ Tốn, không scale |
| Dùng PROJECT_CONTEXT.md | **400-600** | ✅ Compact, đủ context |
| Session focused (1 task) | **200-400** overhead | ✅ Tối ưu nhất |

**Tip tiết kiệm token:**
- 1 session = 1 task. Xong task → kết thúc session, update context.
- Không paste code file dài nếu chỉ hỏi về 1 function — paste function đó thôi.
- Dùng `[GAME_CODE]` prefix để Claude load đúng reference, không load tất cả.

---

## Ví dụ PROJECT_CONTEXT.md đã điền (mini)

```markdown
# ZombieGrid — Project Context
v0.4 | Updated: 2025-01-15

## GAME
Name: ZombieGrid | Genre: Tower Defense | Engine: Pygame | Language: Python
Platform: PC | Status: Alpha
Concept: Game tower defense top-down, đặt súng để diệt zombie qua 20 wave.

## ARCHITECTURE
Pattern: ECS đơn giản (entity list + system loop) | Save: JSON file
Key libs: pygame 2.5, pytmx (map), pygame_gui (UI)
Notes: Config wave trong data/waves.json | Tất cả entity dùng Component dict

## DESIGN CORE
Loop: Place towers → Wave start → Survive → Earn gold → Upgrade → Next wave
Win: Survive 20 waves | Lose: Base HP = 0
Mechs: Tower placement (grid snap), Wave spawner, Gold economy, HP system

## MILESTONES
[M1] Foundation    DONE  2025-01-01
[M2] Core Gameplay WIP   2025-01-20
[M3] Content       TODO  2025-02-10

## CURRENT STATUS
Sprint: #3 — Tuần: 2025-01-13
Goal: Hoàn thiện wave spawner + enemy pathfinding
Active: TASK-012 Enemy A* pathfinding WIP
Scope: Implement A* từ spawn point đến base, cache path khi grid không đổi
Files: src/systems/pathfind.py, src/entities/enemy.py

## RECENT COMPLETED
TASK-011 Tower shoot system  DONE 2025-01-12
TASK-010 Gold economy        DONE 2025-01-10

## KNOWN ISSUES
BUG-003 Tower bullet xuyên wall khi enemy đứng sát M priority Open
DEBT-001 Wave config hardcode, chưa load từ JSON M priority

## DECISIONS LOG
2025-01-12 Dùng A* thay vì flow field — Map nhỏ (<30x30), A* đủ dùng, đơn giản hơn
2025-01-08 Không dùng Pygame sprite group cho enemy — Cần custom update order

## SESSION NOTES
Cần fix path cache invalidation khi player place tower giữa wave
```
