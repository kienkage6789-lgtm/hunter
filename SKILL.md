---
name: game-dev
description: Professional solo game development workflow. Use this skill for ANY game dev task — project planning (GDD, milestones, task breakdown), gameplay design (mechanics, loops, balance), game coding (features, bug fixes, architecture), and game testing (QA, bug reports, playtest). Trigger on: làm game, game dev, GDD, gameplay mechanic, game loop, game code, game bug, game test, PROJECT_CONTEXT, phát triển game, thiết kế game, game architecture, sprint planning cho game. Always use this skill when the user is working on or discussing a game project.
---

# Game Dev — Solo Professional Workflow

Skill điều phối quy trình phát triển game cá nhân. Tối ưu token, duy trì ngữ cảnh xuyên session.

## ⚡ TOKEN BUDGET — Quy tắc cứng (không vi phạm)

1. **Parse trước, hỏi sau**: Đọc PROJECT_CONTEXT ngay khi được paste. Không hỏi lại thông tin đã có.
2. **One task at a time**: Không tự mở rộng scope. Nếu scope chưa rõ → hỏi đúng 1 câu.
3. **No recap**: Không tóm tắt lại những gì user vừa nói. Đi thẳng vào làm.
4. **Output compact**: Kết quả phải có thể paste ngược vào PROJECT_CONTEXT cho session sau.
5. **Code production-ready**: Không viết placeholder/TODO trừ khi được yêu cầu rõ ràng.
6. **Load reference on demand**: Chỉ đọc reference file khi cần cho task hiện tại.

---

## 🚀 SESSION START PROTOCOL

**Khi user paste PROJECT_CONTEXT.md:**
```
1. Parse context (không comment dài, không hỏi lại)
2. Reply ngắn:
   "✓ [GAME_NAME] | M[X] | Task: [TASK-ID] — [tên]
    Tiếp tục task này hay có task mới?"
3. Đợi confirm → bắt đầu ngay
```

**Khi KHÔNG có context:**
```
→ Project mới: Đọc references/plan.md, tạo GDD + context template
→ Đã có context trong conversation: Dùng luôn, không hỏi lại
```

---

## 🗂️ SKILL ROUTING

Đọc đúng reference file cho task hiện tại. Không load tất cả cùng lúc.

| User cần | Reference file |
|---|---|
| GDD, milestone, task breakdown, sprint, backlog | `references/plan.md` |
| Mechanic, game loop, balance, progression, level design | `references/design.md` |
| Viết code, architecture, refactor, bug fix, review | `references/code.md` |
| Bug report, test case, QA checklist, playtest, release | `references/test.md` |

---

## 🏁 SESSION END PROTOCOL

**Bắt buộc** kết thúc mỗi session bằng block này:

```
┌─────────────────────────────────────────────────┐
│ SESSION SUMMARY — [YYYY-MM-DD]                  │
│ Done:     [TASK-ID list]                        │
│ Decisions:[Key choices — 1 dòng/cái]            │
│ Next:     [TASK-ID] — [tên task tiếp theo]      │
│ Update context: [Dòng/section nào cần sửa]      │
└─────────────────────────────────────────────────┘
```

User copy block này → cập nhật vào `PROJECT_CONTEXT.md` local.

---

## ⚠️ ANTI-PATTERNS — Luôn tránh

- ❌ Hỏi nhiều câu cùng lúc → tối đa 1 câu/lần
- ❌ Giải thích code dài khi không được hỏi
- ❌ Suggest thêm feature ngoài scope đã định
- ❌ Paste toàn bộ file khi chỉ sửa 1 đoạn
- ❌ Tạo nhiều variant không cần thiết
- ❌ Dùng placeholder trong production code

---

## 📎 Tài nguyên đi kèm

| File | Mục đích |
|---|---|
| `references/plan.md` | GDD, milestone, task, sprint planning |
| `references/design.md` | Mechanic, loop, balance, UX |
| `references/code.md` | Code patterns, architecture, engine tips |
| `references/test.md` | Bug report, QA, playtest, release |
| `assets/PROJECT_CONTEXT_TEMPLATE.md` | Template context user tự maintain |

**Workflow cơ bản:**
1. User copy `PROJECT_CONTEXT_TEMPLATE.md` → điền thông tin game
2. Mỗi session: paste nội dung file đó vào đầu conversation
3. Claude parse → làm việc → tạo SESSION SUMMARY
4. User cập nhật context file với summary → session sau tiếp tục mượt
