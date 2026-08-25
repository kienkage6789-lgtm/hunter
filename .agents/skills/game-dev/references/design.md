# Game Design Reference

Đọc khi user cần: phân tích/thiết kế mechanic, game loop, cân bằng số liệu, progression, UX, level design.

---

## MECHANIC ANALYSIS FORMAT

```
### Mechanic: [Tên]
Feel:      [Verb player thực hiện — "nhảy", "bắn", "xây", "merge"]
Input:     [Trigger gì kích hoạt mechanic]
Output:    [Kết quả trực tiếp, tức thì]
Feedback:  [Visual | Audio | Haptic | Number pop]
Trade-off: [Đánh đổi gì — resource, risk, opportunity cost]
Counter:   [Mechanic nào vô hiệu hóa/counter được]
Synergy:   [Mechanic nào combo mạnh cùng]
```

Sau khi phân tích: chỉ đưa tối đa **2 variant** để chọn, kèm trade-off ngắn gọn.

---

## GAME LOOP FORMAT

```
### [Tên] Loop
Frequency: [Giây | Phút | Giờ | Session]
──────────────────────────────────────────
ACTION → OUTCOME → DECISION → next ACTION
[Mô tả từng bước, 1 dòng mỗi bước]
──────────────────────────────────────────
Emotion arc: [Tension→Release | Challenge→Mastery | Curiosity→Discovery]
Player drive: [Completion | Power | Discovery | Social | Expression]
```

**Cấu trúc 3 loop lồng nhau (chuẩn):**

| Level | Frequency | Ví dụ |
|-------|-----------|-------|
| Micro | Giây | Core mechanic — aim, jump, match |
| Macro | Phút | Session goal — clear stage, defeat boss |
| Meta  | Giờ/ngày | Long-term — unlock, progress story |

Game thiếu 1 trong 3 loop thường cảm giác thiếu chiều sâu hoặc mục tiêu.

---

## BALANCE FRAMEWORK

```
### Balance Check: [System/Mechanic tên]
Current:     [Số liệu/giá trị hiện tại]
Feel:        [Quá dễ | OK | Quá khó | Quá chậm | Quá nhanh]
Levers:      [Biến có thể điều chỉnh — list ra]
Constraints: [Biến KHÔNG được thay — tại sao]
Test case:   [Cách verify nhanh — < 5 phút play]
```

**Binary search approach:**
1. Tìm giá trị "quá dễ" (X) và "quá khó" (Y)
2. Test giá trị giữa `(X+Y)/2`
3. Lặp 3-4 vòng → hội tụ về sweet spot

**Công thức balance cơ bản:**
```
DPS/TTK:   damage_per_hit × hits_per_second / enemy_health
Econ rate: resource_per_minute / cost_per_upgrade
Risk/reward: (reward × win_chance) vs (loss × lose_chance)
```

---

## PROGRESSION DESIGN

```
### Progression: [Tên — skill | power | content | unlock]
Type:        Linear | Branching | Emergent
Arc:         Từ [trạng thái đầu] → [trạng thái cuối] sau [X giờ]
Unlock rate: ~[X] items per hour (expected)
Power delta: [Mạnh hơn ~X% sau mỗi upgrade tier]
Ceiling:     [Max power — khi nào player "done" với progression]
Catch-up:    [Cơ chế cho player mới/tụt hậu — hoặc None]
```

**Progression feel checklist:**
- [ ] Mỗi unlock cảm giác meaningful (không phải +1% vô nghĩa)
- [ ] Không có "dead zones" — khoảng trống dài không có gì mới
- [ ] Early game: nhiều unlock nhỏ (dopamine hits)
- [ ] Late game: ít unlock lớn (impactful rewards)

---

## LEVEL DESIGN (Macro Template)

```
### Level [X] — [Tên]
Type:      Tutorial | Normal | Challenge | Boss | Secret
New mech:  [Mechanic mới introduce — hoặc None]
Remix:     [Mechanic cũ dùng theo cách mới — hoặc None]
Duration:  [X phút expected]
Intensity: [1–10]
Win cond:  [Điều kiện thắng level]
Fail cond: [Điều kiện thua + retry từ đâu]
```

**Level pacing pattern (đề xuất):**
```
L1: Tutorial mechanics A
L2: Practice A
L3: Introduce B, practice A+B
L4: Challenge A+B (no new stuff)
L5: Introduce C, easy A+B+C
L6: Boss — combine A+B+C creatively
```

---

## UX GAME CHECKLIST

```
[ ] Player biết làm gì tiếp theo trong 3 giây đầu mỗi màn
[ ] Mọi input có feedback visible trong 100ms
[ ] Failure state rõ nguyên nhân — không blame oan player
[ ] Tutorial không xuất hiện trước khi player cần mechanic đó
[ ] Pause / quit accessible bất cứ lúc nào
[ ] Không có dead-end / softlock không thoát được
[ ] 30 giây đầu tiên: player hiểu game về cái gì
[ ] Error message giải thích được, không chỉ "ERROR"
```

---

## DESIGN ANTI-PATTERNS — Flag khi thấy

| Anti-pattern | Vấn đề | Fix hướng |
|---|---|---|
| Mechanic không có counter | Single dominant strategy → boring | Thêm weakness/cost |
| Reward không xứng effort | Feel bad → drop | Tăng reward hoặc giảm effort |
| Tutorial front-loaded | Overwhelm → quit | Teach Just-in-time |
| UI che gameplay | Immersion break | Redesign layout |
| Mechanic quá complex để explain | Accessibility fail | Simplify hoặc split |
| Catch-up quá mạnh | Negates skill → frustrating | Tune multiplier |

---

## OUTPUT FORMAT

1. Phân tích mechanic/system theo format phù hợp
2. Tối đa **2 variant** để chọn
3. Trade-off mỗi variant: 1-2 dòng
4. Recommendation + lý do ngắn
5. "Prototype test nhanh nhất: [cách verify trong < 5 phút]"
