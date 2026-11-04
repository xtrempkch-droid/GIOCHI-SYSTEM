"""Mede o arcade com e sem geometry shader, e compara.

Roda duas vezes, em processos separados:

  A = caminho normal. Prova que o ambiente funciona e que o arcade usa o
      caminho com geometry shader (`SpriteListBufferData`).
  B = o link de QUALQUER programa com geometry shader falha, que e o que o
      panfrost faz (o Mesa nao expoe `GL_EXT_geometry_shader`). Sem o remendo
      isto levanta antes de aparecer qualquer coisa; com o remendo tem de
      abrir, desenhar e colidir em CPU.

A prova de desenho e no ponto em que a SpriteList entrega os sprites a GPU:
o `render()` da classe de dados. Ler pixel no Xvfb/llvmpipe devolve preto
tambem no caminho que funciona, entao pixel nao serve aqui — e o registro
disso esta no README.

Uso: arcade_probe.py <A|B>
"""
import sys

MODO = sys.argv[1] if len(sys.argv) > 1 else "A"
REMENDO = len(sys.argv) > 2 and sys.argv[2] == "--remendo"

import arcade  # noqa: E402
import arcade.context as actx  # noqa: E402
from arcade.gl.exceptions import ShaderException  # noqa: E402
from arcade.sprite_list.sprite_list import (  # noqa: E402
    SpriteListBufferData,
    SpriteListTextureData,
)

if MODO == "B":
    _orig_load = actx.ArcadeContext.load_program

    def sem_geometry(self, *args, **kwargs):
        """Emula a plataforma sem GL_EXT_geometry_shader."""
        if kwargs.get("geometry_shader"):
            raise ShaderException(
                "Program link error: simulado — plataforma sem GL_EXT_geometry_shader"
            )
        return _orig_load(self, *args, **kwargs)

    actx.ArcadeContext.load_program = sem_geometry

chamadas = []


def instrumenta(cls, nome):
    original = cls.render

    def render(self, **kwargs):
        chamadas.append({"impl": nome, "count": kwargs.get("count"), "erro": None})
        try:
            return original(self, **kwargs)
        except Exception as exc:  # noqa: BLE001
            chamadas[-1]["erro"] = f"{type(exc).__name__}: {str(exc)[:80]}"
            raise

    cls.render = render


instrumenta(SpriteListBufferData, "SpriteListBufferData")
instrumenta(SpriteListTextureData, "SpriteListTextureData")

SPRITES = 2


class Jogo(arcade.Window):
    def __init__(self):
        super().__init__(320, 240, f"arcade-probe-{MODO}")
        arcade.set_background_color((10, 10, 40))
        self.sp = arcade.SpriteList()
        self.sp_cpu = arcade.SpriteList(use_spatial_hash=True)
        for x, cor in ((80, (240, 160, 40)), (160, (200, 60, 200))):
            s = arcade.Sprite(arcade.make_soft_square_texture(48, cor, 255, 1.0))
            s.center_x, s.center_y = x, 140
            self.sp.append(s)

    def on_draw(self):
        self.clear()
        self.sp.draw()
        arcade.draw_rect_filled(arcade.XYWH(210, 40, 70, 50), (60, 200, 120))
        arcade.draw_text("abc", 215, 170, (255, 255, 255), 16)


falhas = []

try:
    w = Jogo()
except Exception as exc:  # noqa: BLE001
    print(f"MODO {MODO}: LEVANTOU {type(exc).__name__}: {str(exc)[:110]}")
    if MODO == "B" and not REMENDO:
        print(f"MODO {MODO}: OK — falha reproduzida (esperado sem remendo)")
        sys.exit(0)
    print(f"MODO {MODO}: FALHOU — nao deveria levantar")
    sys.exit(1)

impl = type(w.sp.data).__name__
has_geo = getattr(w.ctx, "has_geometry_shaders", "N/A")
print(f"MODO {MODO}: implementacao = {impl} | has_geometry_shaders = {has_geo}")

# --- 1. desenho: qual caminho, com quantos sprites, sem erro ---------------
chamadas.clear()
try:
    w.on_draw()
except Exception as exc:  # noqa: BLE001
    print(f"MODO {MODO}: on_draw levantou {type(exc).__name__}: {str(exc)[:110]}")
    falhas.append("on_draw falhou")

for c in chamadas:
    print(f"MODO {MODO}: render {c['impl']} count={c['count']} erro={c['erro']}")

if not chamadas:
    falhas.append("nenhum render de SpriteList foi chamado")
else:
    if chamadas[-1]["erro"]:
        falhas.append(f"render levantou: {chamadas[-1]['erro']}")
    if max((c["count"] or 0) for c in chamadas) != SPRITES:
        falhas.append(f"render com count != {SPRITES}")

esperada = "SpriteListBufferData" if MODO == "A" else "SpriteListTextureData"
usadas = {c["impl"] for c in chamadas}
if usadas and usadas != {esperada}:
    falhas.append(f"esperado {esperada}, usado {sorted(usadas)}")

# --- 2. colisao por GPU ----------------------------------------------------
try:
    w.sp.get_nearby_sprites_gpu((80, 140), (40, 40))
    if MODO == "B":
        falhas.append("colisao GPU deveria levantar CollisionUnavailable")
    else:
        print(f"MODO {MODO}: colisao GPU disponivel (com geo): sim")
except Exception as exc:  # noqa: BLE001
    nome = type(exc).__name__
    if MODO == "B":
        if nome == "CollisionUnavailable":
            print(f"MODO {MODO}: colisao GPU -> CollisionUnavailable (erro claro): sim")
        elif nome == "TypeError":
            falhas.append("colisao GPU deu TypeError — o guard nao pegou")
        else:
            falhas.append(f"colisao GPU deu {nome}, esperado CollisionUnavailable")
    else:
        falhas.append(f"colisao GPU falhou no modo A: {nome}")

# --- 3. colisao por CPU (spatial hash) ------------------------------------
try:
    s = arcade.SpriteSolidColor(20, 20, color=(255, 0, 0))
    s.center_x, s.center_y = 50, 50
    w.sp_cpu.append(s)
    perto = arcade.get_sprites_at_point((50, 50), w.sp_cpu)
    if not perto:
        falhas.append("spatial hash nao encontrou o sprite")
    else:
        print(f"MODO {MODO}: colisao CPU (spatial hash): {len(perto)} sprite(s): sim")
except Exception as exc:  # noqa: BLE001
    falhas.append(f"colisao CPU falhou: {type(exc).__name__}: {str(exc)[:70]}")

if falhas:
    print(f"MODO {MODO}: FALHOU — {'; '.join(falhas)}")
    sys.exit(1)

print(f"MODO {MODO}: OK")
