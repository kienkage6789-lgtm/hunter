# Game Code Reference

Đọc khi user cần: viết feature mới, fix bug, refactor, architecture decision, code review.

---

## PRE-CODE CHECKLIST (Check trước khi viết)

```
[ ] Biết engine + language từ PROJECT_CONTEXT?
[ ] Scope task rõ ràng? (nếu không → hỏi 1 câu)
[ ] File/module nào bị ảnh hưởng?
[ ] Có pattern nào trong project có thể reuse?
[ ] Sửa hay thêm mới? (Modify vs New file)
```

---

## CODE OUTPUT FORMAT

```
### [TASK-ID] — [Tên task]
File:        path/to/file.ext
Change type: New | Modify | Delete
─────────────────────────────────────
[CODE BLOCK]
─────────────────────────────────────
Usage:       [1-2 dòng cách dùng]
Test nhanh:  [Cách verify trong < 2 phút]
Side effect: [Module nào khác bị ảnh hưởng]
```

**Khi sửa file có sẵn:** Chỉ show đoạn thay đổi + đủ context xác định vị trí. Không paste toàn bộ file.

---

## BUG FIX FORMAT

```
### Fix: [Mô tả bug ngắn]
Root cause:  [Nguyên nhân gốc — không phải symptom]
Location:    [file.ext:line hoặc function/class]
Fix:         [Code change]
Regression:  [Test case để verify fix không break thứ khác]
```

---

## ARCHITECTURE PRINCIPLES (Solo Game Dev)

```
1. KISS first     — Đơn giản trước, optimize khi có profiler data thực tế
2. Data-driven    — Config ra JSON/CSV, không hardcode magic number
3. Event-based    — Dùng event/signal thay vì direct reference chồng chéo
4. Serialize-safe — Mọi game state phải save/load được dễ dàng
5. Single pass    — Không refactor + add feature trong cùng 1 commit
```

---

## ENGINE PATTERNS

### Python / Pygame

```python
# Delta time — movement không phụ thuộc FPS
self.pos += self.vel * dt

# Sprite Group — hiệu quả hơn loop thủ công
all_sprites = pygame.sprite.Group()
all_sprites.update(dt)
all_sprites.draw(screen)

# Cache tính toán nặng
from functools import lru_cache
@lru_cache(maxsize=256)
def get_tile_neighbors(x: int, y: int) -> tuple:
    return tuple((x+dx, y+dy) for dx, dy in DIRS)

# Asset manager cơ bản
class Assets:
    _cache: dict = {}
    @classmethod
    def image(cls, path: str) -> pygame.Surface:
        if path not in cls._cache:
            cls._cache[path] = pygame.image.load(path).convert_alpha()
        return cls._cache[path]
```

### JavaScript / Phaser

```javascript
// Object Pool — tránh GC spike khi spawn nhiều
class BulletPool {
  constructor(scene, size = 60) {
    this.pool = scene.physics.add.group({
      classType: Bullet, maxSize: size, runChildUpdate: true
    });
  }
  fire(x, y, angle) {
    const b = this.pool.get(x, y);
    if (b) b.launch(angle);
  }
}

// Tween thay vì setInterval/update countdown
scene.tweens.add({
  targets: obj, alpha: 0, duration: 300,
  onComplete: () => obj.destroy()
});

// Texture atlas — 1 file thay vì nhiều ảnh riêng
this.load.atlas('chars', 'chars.png', 'chars.json');
this.anims.create({
  key: 'run', frames: this.anims.generateFrameNames('chars', {prefix:'run_', end:7}),
  repeat: -1, frameRate: 12
});
```

### Godot 4 / GDScript

```gdscript
# Signal thay vì direct call giữa node
signal health_changed(new_val: int)

func take_damage(amount: int) -> void:
    health = max(0, health - amount)
    health_changed.emit(health)
    if health == 0:
        die()

# @export để config từ Inspector — không hardcode
@export var speed: float = 200.0
@export var jump_force: float = 450.0

# Object pool đơn giản
var _bullet_pool: Array[Node] = []
const BULLET = preload("res://entities/bullet.tscn")

func _get_bullet() -> Node:
    return _bullet_pool.pop_back() if _bullet_pool.size() > 0 else BULLET.instantiate()

func _return_bullet(b: Node) -> void:
    b.visible = false
    _bullet_pool.append(b)
```

### Unity / C#

```csharp
// ScriptableObject cho data — tách data khỏi logic
[CreateAssetMenu(menuName = "Game/EnemyData")]
public class EnemyData : ScriptableObject {
    public float speed = 3f;
    public int maxHealth = 100;
    public int damage = 10;
}

// Coroutine thay vì countdown trong Update()
IEnumerator SpawnWave(float delay) {
    yield return new WaitForSeconds(delay);
    SpawnEnemies();
}

// Object pool (Unity 2021+)
private ObjectPool<GameObject> _bulletPool;
void Awake() {
    _bulletPool = new ObjectPool<GameObject>(
        createFunc:      () => Instantiate(bulletPrefab),
        actionOnGet:     obj => obj.SetActive(true),
        actionOnRelease: obj => obj.SetActive(false),
        defaultCapacity: 50
    );
}
```

---

## SAVE / LOAD PATTERN (Generic — Python)

```python
import json
from dataclasses import dataclass, field, asdict

@dataclass
class GameState:
    level:     int   = 1
    score:     int   = 0
    inventory: list  = field(default_factory=list)
    settings:  dict  = field(default_factory=lambda: {"vol": 1.0, "sfx": 1.0})

SAVE_PATH = "save.json"

def save(state: GameState) -> None:
    with open(SAVE_PATH, "w", encoding="utf-8") as f:
        json.dump(asdict(state), f, indent=2, ensure_ascii=False)

def load() -> GameState:
    try:
        with open(SAVE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return GameState(**{k: v for k, v in data.items()
                            if k in GameState.__dataclass_fields__})
    except (FileNotFoundError, KeyError, TypeError, json.JSONDecodeError):
        return GameState()  # Fresh state — không crash khi corrupt
```

---

## STATE MACHINE (Minimal)

```python
# Đủ cho hầu hết game — không cần lib nặng
class StateMachine:
    def __init__(self, owner):
        self.owner = owner
        self.state = None

    def change(self, new_state):
        if self.state:
            self.state.exit()
        self.state = new_state
        self.state.enter(self.owner)

    def update(self, dt):
        if self.state:
            self.state.update(self.owner, dt)

class IdleState:
    def enter(self, owner): owner.anim.play("idle")
    def update(self, owner, dt):
        if owner.input.move_vec.length() > 0:
            owner.fsm.change(RunState())
    def exit(self): pass
```

---

## CODE REVIEW FORMAT (Token-efficient)

```
[CRITICAL] file.ext:42  — Memory leak trong loop → break reference sau dùng
[WARN]     file.ext:78  — Magic number 0.85 → đặt FRICTION_COEF = 0.85 ở top
[SUGGEST]  file.ext:103 — Duplicate với EnemyAI.move() → extract _move_toward()
```

Không rewrite toàn bộ code khi chỉ cần comment vị trí và fix direction.

---

## REFACTOR RULES

```
Chỉ refactor khi:
  - Code duplicate > 3 lần (DRY violation)
  - Bug khó fix vì structure
  - Performance bottleneck đã đo được

Không refactor khi:
  - "Code xấu nhưng chạy đúng" và không có deadline sắp tới
  - Đang giữa sprint feature

Output: diff/patch style — không paste toàn bộ file.
```

---

## PERFORMANCE CHECKLIST

```
Trước khi optimize, đo thực tế:
[ ] FPS drop ở scene/state nào cụ thể?
[ ] CPU hay GPU bottleneck? (profiler)
[ ] Memory leak hay spike?
[ ] Chỉ optimize phần đã đo — không đoán mò
```
