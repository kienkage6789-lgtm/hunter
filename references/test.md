# Game Test Reference

Đọc khi user cần: bug report, test case, QA checklist, playtest session, release check.

---

## BUG REPORT FORMAT

```
[BUG-XXX] [Tên ngắn — mô tả hành vi sai]
Severity:  Critical | High | Medium | Low
Status:    Open | WIP | Fixed | Won't Fix
Frequency: Always | Sometimes (X/10) | Rare

Repro:
  1. [Bước 1]
  2. [Bước 2]
  3. [Kết quả bug xuất hiện]

Expected: [Điều gì nên xảy ra]
Actual:   [Điều gì thực sự xảy ra]
Platform: [OS, Engine version]
Log:      [Stack trace rút gọn — chỉ dòng quan trọng]
```

**Severity guide:**
| Level | Ý nghĩa |
|---|---|
| Critical | Game không chạy / data loss / softlock không thoát |
| High | Feature chính broken, không có workaround |
| Medium | Feature bị ảnh hưởng, có workaround tạm |
| Low | Visual glitch nhỏ, typo, minor UX |

---

## TEST CASE FORMAT

```
[TC-XXX] [Tên test]
Category:  Gameplay | UI | Save | Audio | Perf | Edge case
Pre-cond:  [Setup cần thiết]
Steps:
  1. [...]
  2. [...]
Pass:      [Kết quả mong đợi]
Fail:      [Kết quả sai — crash / wrong output / hang]
Priority:  Must | Should | Nice
Auto:      Yes | No | Partial
```

---

## MILESTONE QA CHECKLISTS

### M1 — Foundation
```
[ ] Game launch không crash trên target OS
[ ] Main scene/menu load < 3 giây (cold start)
[ ] Input response cảm giác < 100ms
[ ] RAM stable sau 10 phút không active
[ ] Quit/close hoạt động bình thường
[ ] Không có missing asset error trong console
```

### M2 — Core Gameplay
```
[ ] Full loop: Start → Play → Win/Lose → Restart
[ ] Không có softlock (stuck, không quit được)
[ ] Save → quit → Load → đúng state, đúng progress
[ ] Audio: không crackle, không cut đột ngột
[ ] Không crash trong 30 phút play liên tục
[ ] Console clean: không warning/error liên tục trong gameplay
```

### M3 — Content
```
[ ] 100% levels/scenes chơi được từ đầu đến cuối
[ ] Không có placeholder text hoặc art ("TODO", "TEMP", white box)
[ ] Difficulty curve hợp lý (qua playtest thực tế, không phỏng đoán)
[ ] Unlock/achievement tracking chính xác
[ ] Không có missing SFX (action xảy ra mà không có sound)
```

### M4 — Polish
```
[ ] FPS ≥ 30 stable trên hardware tối thiểu target
[ ] Không visual glitch rõ: z-fighting, flickering, pop-in
[ ] Text không bị cắt hoặc overflow ở mọi resolution hỗ trợ
[ ] Volume balance: SFX không clip, music không át dialog
[ ] Transition giữa scenes mượt, không giật / màn đen dài
[ ] UI không bị che bởi notch / safe area (mobile)
```

### Release Checklist
```
[ ] Build chạy clean trên machine chưa cài engine/dev tools
[ ] File size phù hợp platform
[ ] Version string đúng (vX.Y.Z) — hiển thị trong game
[ ] Debug log / console output tắt hết trong release build
[ ] Credits đầy đủ: engine, library, font, asset packs
[ ] Ảnh thumbnail/icon đúng kích thước platform yêu cầu
[ ] Privacy policy / ToS nếu có thu thập bất kỳ data nào
[ ] Thử crash-recovery: tắt đột ngột → load lại → không mất data
```

---

## REGRESSION SUITE (Chạy sau mỗi merge / commit lớn)

```
CORE (bắt buộc — < 5 phút):
□ Game start/quit OK
□ Main gameplay 1 full cycle OK
□ Save → Load OK
□ Settings apply và persist sau restart OK

CRITICAL PATH (custom cho mỗi game — điền vào):
□ [Điền gameplay path quan trọng nhất]
□ [Điền tính năng dễ break nhất]
□ [Điền edge case từng gặp bug]
```

---

## PLAYTEST SESSION FORMAT

```
### Playtest — [DATE] v[X.Y]
Tester:   [Self | Friend | Stranger]
Duration: [X phút]
Platform: [OS, screen]

Timeline observations:
[mm:ss] [Hành vi / phản ứng quan sát được]
[mm:ss] [...]

Issues:
[BUG-XXX] [Mô tả ngắn]

Feel rating: [1–10] — "[Lý do ngắn gọn]"
Confused at: [Điểm nào player không biết làm gì / hỏi]
Highlight:   [Khoảnh khắc nào player tỏ ra engaged nhất]
```

**Playtest rule:** Không giải thích gì khi player đang chơi. Chỉ observe và ghi. Giải thích sau.

---

## AI-ASSISTED PLAYTEST ANALYSIS

Paste prompt này khi cần Claude phân tích UX mà không cần code:

```
Game: [Tên] — [Genre] — [Engine]
Mechanic đang xét: [Mô tả]
Observation: "Player làm [X] sau khi [Y]"
Context: Player đang ở [level/state], có [resource/info]

Câu hỏi: Tại sao player lại phản ứng như vậy?
Đây có phải UX problem không? Nếu có, fix hướng nào?
```

---

## PERFORMANCE BASELINE

| Metric | Target | Cách đo |
|--------|--------|---------|
| FPS avg | ≥ 30 | Play 5 phút scene nặng nhất → check |
| FPS min spike | ≥ 15 | Spawn nhiều object cùng lúc → check |
| Load time | < 3s | Cold start từ desktop |
| RAM avg | < 512MB | Task Manager / htop trong gameplay |
| RAM peak | < 800MB | Trong scene nặng nhất |
| Save file | < 5MB | Check sau 1 full playthrough |

Đo thực tế trên hardware tối thiểu target, không phải dev machine.
