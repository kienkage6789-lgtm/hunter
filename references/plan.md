# Game Plan Reference

Đọc khi user cần: tạo GDD, milestone, task breakdown, sprint planning, quản lý backlog.

---

## GDD FORMAT (Compact — tối đa 1 trang)

```
## GDD: [GAME_NAME] v[X.X] — [DATE]

ONE-LINER: [Mô tả game trong 1 câu]
GENRE:     [Genre] | REF: [Game tham khảo gần nhất]
PLATFORM:  [PC | Web | Mobile | ...] | ENGINE: [...]
SCOPE:     [X màn/level] | [Y giờ content] | [Z tuần dev est.]

### Core Loop (1 cycle)
[VERB] → [NOUN] → [FEEDBACK] → repeat
Ví dụ: Shoot → Enemies → Score+Loot → Next wave

### Core Mechanics (≤ 7, mỗi cái 1 dòng)
1. [Mechanic] — [Mô tả ngắn]
...

### Feel Words
[3–5 từ: fast, tense, satisfying, ...]

### MVP Scope
MUST: [5 thứ không thể thiếu để game playable]
NICE: [5 thứ có thể skip nếu trễ deadline]
OUT:  [Liệt kê rõ những gì KHÔNG làm trong dự án này]
```

Khi viết GDD: đặt câu hỏi "Nếu bỏ cái này, game có còn là chính nó không?" để phân loại MUST vs NICE.

---

## MILESTONE TEMPLATE

```
[M1] Foundation        | ~2-4 tuần
     Done when: Tech stack confirm + 1 mechanic prototype chạy được

[M2] Core Gameplay     | ~4-6 tuần
     Done when: Full loop Start→Play→End/Win/Lose không crash

[M3] Content           | ~3-5 tuần
     Done when: [X] levels/units hoàn chỉnh, không placeholder

[M4] Polish            | ~2-3 tuần
     Done when: 3 người playtest không báo critical issue trong 20 phút

[M5] Release           | ~1-2 tuần
     Done when: Upload lên [platform] thành công, link live
```

**Quy tắc Done When:** Phải là tiêu chí **khách quan, testable** — không phải "cảm giác xong".

---

## TASK FORMAT

```
[TASK-XXX] [Tên ngắn gọn — động từ + danh từ]
Type:      Feature | Bug | Refactor | Content | Art | Sound | Config
Priority:  P1-Critical | P2-High | P3-Medium | P4-Low
Milestone: M1 | M2 | M3 | M4 | M5
Estimate:  XS<1h | S<4h | M<1day | L<3day | XL>3day
Depends:   [TASK-YYY, ...]  (hoặc None)
Scope:
  - [Việc cụ thể 1]
  - [Việc cụ thể 2]
Done when: [Tiêu chí hoàn thành — testable trong < 5 phút]
```

---

## SPRINT PLANNING (Solo Dev — 1 tuần)

```
Capacity: 3 tasks P1-P2 + 1 buffer task (P3, dễ, làm nếu xong sớm)
Rule:     Không thêm task giữa sprint trừ P1-Critical
Focus:    1 task WIP tại 1 thời điểm — không multitask
```

**Output khi planning sprint:**

| ID | Task | Type | Est. | Priority |
|----|------|------|------|----------|
| TASK-XXX | [Tên] | Feature | M | P2 |

Kết thúc bằng: "Next action → [Việc đầu tiên cần làm ngay khi bắt đầu sprint]"

---

## BACKLOG FORMAT (Compressed Table)

```
| ID       | Title                  | M  | Pri | Est | Status |
|----------|------------------------|----|-----|-----|--------|
| TASK-001 | [Tên ngắn]             | M1 | P1  | S   | Done   |
| TASK-002 | [Tên ngắn]             | M2 | P2  | M   | WIP    |
| TASK-003 | [Tên ngắn]             | M2 | P3  | L   | TODO   |
```

Backlog tối đa 20-30 tasks trong context. Tasks đã Done quá 2 milestone → lược bỏ để tiết kiệm token.

---

## OUTPUT RULES

1. Luôn theo thứ tự: GDD → Milestone → Sprint tasks → Next action
2. Milestone: max 2 dòng mô tả + done-when criterion
3. Sprint output: table format, không prose dài
4. Khi hỏi scope GDD: hỏi đúng 1 câu rồi viết, không hỏi từng phần
