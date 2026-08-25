# [GAME_NAME] — Project Context
<!--
  HOW TO USE:
  1. Copy file này → đặt tên PROJECT_CONTEXT.md trong thư mục game
  2. Điền thông tin, xóa các comment <!-- --> này
  3. Mỗi session Claude: paste toàn bộ nội dung file vào đầu chat
  4. Cuối session: copy SESSION SUMMARY từ Claude → cập nhật phần CURRENT STATUS và DECISIONS LOG
  Target size khi đầy: < 600 token | Version: v0.1 | Updated: [DATE]
-->

## GAME
```
Name:     [Tên game]
Genre:    [RPG | Puzzle | Action | Strategy | Platformer | ...]
Engine:   [Godot 4 | Unity | Pygame | Phaser | Custom | ...]
Language: [GDScript | C# | Python | JavaScript | ...]
Platform: [PC | Web | Mobile | ...]
Concept:  [1 câu mô tả — "Game về X, player làm Y để đạt Z"]
Status:   [Planning | Proto | Alpha | Beta | Release]
```

## ARCHITECTURE
```
Pattern:  [ECS | OOP | MVC | Event-driven | ...]
Save sys: [JSON file | PlayerPrefs | Binary | ...]
Key libs: [List thư viện quan trọng]
Notes:    [Quyết định kiến trúc đã chốt — 1 dòng/cái]
          [Ví dụ: "Dùng State Machine cho player, không inheritance"]
          [Ví dụ: "All config trong /data/*.json, không hardcode"]
```

## PROJECT STRUCTURE
```
[Paste cây thư mục 2-3 level từ IDE/terminal]
Ví dụ:
src/
  ├── core/        (game loop, state machine)
  ├── entities/    (player, enemy, items)
  ├── systems/     (physics, audio, save)
  └── ui/          (hud, menus)
assets/
data/              (json configs)
```

## DESIGN CORE
```
Loop:  [VERB → NOUN → FEEDBACK → repeat]
       [Ví dụ: Shoot → Enemies → Score+Drop → Next wave]
Win:   [Điều kiện thắng game]
Lose:  [Điều kiện thua game]
Mechs: [3-5 mechanic chính, 1 dòng/cái]
       [Ví dụ: "Movement — WASD + dash với cooldown 2s"]
       [Ví dụ: "Combat — projectile aim + charge shot"]
```

## MILESTONES
```
[M1] Foundation    [DONE|WIP|TODO]  [date est.]
[M2] Core Gameplay [DONE|WIP|TODO]  [date est.]
[M3] Content       [DONE|WIP|TODO]  [date est.]
[M4] Polish        [DONE|WIP|TODO]  [date est.]
[M5] Release       [DONE|WIP|TODO]  [date est.]
```

## CURRENT STATUS
```
Sprint:  [#X — Tuần bắt đầu: DATE]
Goal:    [Mục tiêu sprint này trong 1 câu]
Active:  [TASK-XXX] [Tên task] [TODO|WIP|REVIEW]
Scope:   [Mô tả ngắn việc cần làm trong task này]
Files:   [File/module liên quan đến task]
```

## RECENT COMPLETED (last 5)
```
[TASK-XXX] [Tên]  DONE  [date]
[TASK-XXX] [Tên]  DONE  [date]
[TASK-XXX] [Tên]  DONE  [date]
```

## KNOWN ISSUES
```
[BUG-XXX] [Mô tả ngắn]  [H|M|L]  [Open|WIP]
[DEBT-XXX] [Tech debt]  [H|M|L]
```

## DECISIONS LOG (last 5, newest first)
```
[DATE] [Quyết định chốt] — [Lý do ngắn]
[DATE] [Quyết định chốt] — [Lý do ngắn]
```

## SESSION NOTES
```
[Ghi chú tạm — context cần nhắc Claude trong session này]
[Xóa sau khi giải quyết xong]
```

---
<!--
HƯỚNG DẪN CẬP NHẬT SAU SESSION:
1. Copy SESSION SUMMARY từ Claude
2. Cập nhật "Active" trong CURRENT STATUS → task tiếp theo
3. Di chuyển task vừa xong vào RECENT COMPLETED
4. Thêm decision mới vào DECISIONS LOG (xóa cái cũ nhất nếu > 5)
5. Cập nhật milestone status nếu có thay đổi
6. Tăng version (v0.1 → v0.2) và cập nhật Updated date
-->
