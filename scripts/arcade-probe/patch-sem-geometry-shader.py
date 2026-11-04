"""Remendo — tolerar ausencia de GL_EXT_geometry_shader no arcade 3.3.3.

O arcade 3.3.3 carrega CINCO programas que exigem geometry shader, e a escolha
da implementacao de SpriteList esta com o fallback comentado:

    # Desktop GL (with geo shader)
    self._data = SpriteListBufferData(...)
    # WebGL (without geo shader)
    # self._data = SpriteListTextureData(...)      <- pronto, mas desligado

Entao nao e "so colisao": sem geometry shader o arcade nem inicia. O remendo:

  1. context.py: os programas com geo viram None quando o link falha, em vez de
     levantar, e o contexto ganha `has_geometry_shaders`.
  2. sprite_list.py: escolhe SpriteListTextureData (o caminho sem geo, que ja
     existe e o WebGL usa) quando nao houver programas com geo.
  3. sprite_list.py: colisao por GPU levanta CollisionUnavailable em vez de
     TypeError, e a colisao por CPU (spatial hash) nao depende disto.

Idempotente.
"""
import pathlib
import sys

SITE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/venv/lib/python3.12/site-packages")
CONTEXT = SITE / "arcade/context.py"
SPRITES = SITE / "arcade/sprite_list/sprite_list.py"
MARCA = "giochi-system:sem-geo"

ANTES_SPRITE_PROGS = '''        self.sprite_list_program_no_cull: Program = self.load_program(
            vertex_shader=":system:shaders/sprites/sprite_list_geometry_vs.glsl",
            geometry_shader=":system:shaders/sprites/sprite_list_geometry_no_cull_geo.glsl",
            fragment_shader=":system:shaders/sprites/sprite_list_geometry_fs.glsl",
        )
        self.sprite_list_program_no_cull["sprite_texture"] = 0
        self.sprite_list_program_no_cull["uv_texture"] = 1

        self.sprite_list_program_cull: Program = self.load_program(
            vertex_shader=":system:shaders/sprites/sprite_list_geometry_vs.glsl",
            geometry_shader=":system:shaders/sprites/sprite_list_geometry_cull_geo.glsl",
            fragment_shader=":system:shaders/sprites/sprite_list_geometry_fs.glsl",
        )
        self.sprite_list_program_cull["sprite_texture"] = 0
        self.sprite_list_program_cull["uv_texture"] = 1
'''

DEPOIS_SPRITE_PROGS = '''        # (''' + MARCA + ''') These two need a geometry shader. When the platform has no
        # GL_EXT_geometry_shader (panfrost, etnaviv, ...) they cannot be linked, and
        # refusing to start makes the library unusable for an optimisation. They
        # become None and sprite_list.py falls back to SpriteListTextureData, the
        # implementation that already exists for WebGL.
        try:
            self.sprite_list_program_no_cull: Program = self.load_program(
                vertex_shader=":system:shaders/sprites/sprite_list_geometry_vs.glsl",
                geometry_shader=":system:shaders/sprites/sprite_list_geometry_no_cull_geo.glsl",
                fragment_shader=":system:shaders/sprites/sprite_list_geometry_fs.glsl",
            )
            self.sprite_list_program_no_cull["sprite_texture"] = 0
            self.sprite_list_program_no_cull["uv_texture"] = 1

            self.sprite_list_program_cull: Program = self.load_program(
                vertex_shader=":system:shaders/sprites/sprite_list_geometry_vs.glsl",
                geometry_shader=":system:shaders/sprites/sprite_list_geometry_cull_geo.glsl",
                fragment_shader=":system:shaders/sprites/sprite_list_geometry_fs.glsl",
            )
            self.sprite_list_program_cull["sprite_texture"] = 0
            self.sprite_list_program_cull["uv_texture"] = 1
        except ShaderException:
            self.sprite_list_program_no_cull = None
            self.sprite_list_program_cull = None
            self.has_geometry_shaders = False
        else:
            self.has_geometry_shaders = True
'''

ANTES_SINGLE = '''        self.sprite_program_single = self.load_program(
            vertex_shader=":system:shaders/sprites/sprite_single_vs.glsl",
            geometry_shader=":system:shaders/sprites/sprite_list_geometry_no_cull_geo.glsl",
            fragment_shader=":system:shaders/sprites/sprite_list_geometry_fs.glsl",
        )
        self.sprite_program_single["sprite_texture"] = 0
        self.sprite_program_single["uv_texture"] = 1
        self.sprite_program_single["spritelist_color"] = 1.0, 1.0, 1.0, 1.0
'''

DEPOIS_SINGLE = '''        # (''' + MARCA + ''') Same reason as above. draw/rect.py already uses
        # sprite_program_single_simple, so this only matters for direct users.
        try:
            self.sprite_program_single = self.load_program(
                vertex_shader=":system:shaders/sprites/sprite_single_vs.glsl",
                geometry_shader=":system:shaders/sprites/sprite_list_geometry_no_cull_geo.glsl",
                fragment_shader=":system:shaders/sprites/sprite_list_geometry_fs.glsl",
            )
            self.sprite_program_single["sprite_texture"] = 0
            self.sprite_program_single["uv_texture"] = 1
            self.sprite_program_single["spritelist_color"] = 1.0, 1.0, 1.0, 1.0
        except ShaderException:
            self.sprite_program_single = None
'''

ANTES_COLISAO = '''        # NOTE: These should not be created when WebGL is used
        # SpriteList collision resources
        # Buffer version of the collision detection program.
        self.collision_detection_program = self.load_program(
            vertex_shader=":system:shaders/collision/col_trans_vs.glsl",
            geometry_shader=":system:shaders/collision/col_trans_gs.glsl",
        )
        # Texture version of the collision detection program.
        self.collision_detection_program_simple = self.load_program(
            vertex_shader=":system:shaders/collision/col_tex_trans_vs.glsl",
            geometry_shader=":system:shaders/collision/col_tex_trans_gs.glsl",
        )
        self.collision_detection_program_simple["pos_angle_data"] = 0
        self.collision_detection_program_simple["size_data"] = 1
        self.collision_detection_program_simple["index_data"] = 2

        self.collision_buffer = self.buffer(reserve=1024 * 4)
        self.collision_query = self.query(samples=False, time=False, primitives=True)
'''

DEPOIS_COLISAO = '''        # (''' + MARCA + ''') GPU collision needs geometry shaders too. It is an
        # optimisation: arcade.hitbox does collision on the CPU, and
        # SpriteList(use_spatial_hash=True) needs nothing from here.
        try:
            # Buffer version of the collision detection program.
            self.collision_detection_program = self.load_program(
                vertex_shader=":system:shaders/collision/col_trans_vs.glsl",
                geometry_shader=":system:shaders/collision/col_trans_gs.glsl",
            )
            # Texture version of the collision detection program.
            self.collision_detection_program_simple = self.load_program(
                vertex_shader=":system:shaders/collision/col_tex_trans_vs.glsl",
                geometry_shader=":system:shaders/collision/col_tex_trans_gs.glsl",
            )
            self.collision_detection_program_simple["pos_angle_data"] = 0
            self.collision_detection_program_simple["size_data"] = 1
            self.collision_detection_program_simple["index_data"] = 2

            self.collision_buffer = self.buffer(reserve=1024 * 4)
            self.collision_query = self.query(samples=False, time=False, primitives=True)
        except ShaderException:
            self.collision_detection_program = None
            self.collision_detection_program_simple = None
            self.collision_buffer = None
            self.collision_query = None
'''

ANTES_ESCOLHA = '''        # NOTE: Instantiate the appropriate spritelist data class here
        # Desktop GL (with geo shader)
        self._data = SpriteListBufferData(self.ctx, capacity=self._buf_capacity, atlas=self._atlas)
        # WebGL (without geo shader)
        # self._data = SpriteListTextureData(
        #     self.ctx, capacity=self._buf_capacity, atlas=self._atlas
        # )
'''

DEPOIS_ESCOLHA = '''        # NOTE: Instantiate the appropriate spritelist data class here
        #
        # (''' + MARCA + ''') The choice is not "desktop vs web" any more: it is
        # "has geometry shaders or not". SpriteListBufferData needs them;
        # SpriteListTextureData does not, and was already written for WebGL.
        if getattr(self.ctx, "has_geometry_shaders", True):
            self._data = SpriteListBufferData(
                self.ctx, capacity=self._buf_capacity, atlas=self._atlas
            )
        else:
            self._data = SpriteListTextureData(
                self.ctx, capacity=self._buf_capacity, atlas=self._atlas
            )
'''

EXCECAO = '''

class CollisionUnavailable(RuntimeError):
    """(''' + MARCA + ''') GPU collision is unavailable: no geometry shaders."""

'''

GUARDA_BUFFER = '''        ctx = self.ctx
        ctx.collision_detection_program["check_pos"] = pos
'''
GUARDA_BUFFER_NOVO = '''        ctx = self.ctx
        if ctx.collision_detection_program is None:
            raise CollisionUnavailable(
                "colisao por GPU indisponivel nesta plataforma (sem "
                "GL_EXT_geometry_shader); use SpriteList(use_spatial_hash=True)"
            )
        ctx.collision_detection_program["check_pos"] = pos
'''

GUARDA_TEXTURA = '''        ctx = self.ctx
        buffer = ctx.collision_buffer
        program = ctx.collision_detection_program_simple
'''
GUARDA_TEXTURA_NOVO = '''        ctx = self.ctx
        if ctx.collision_detection_program_simple is None:
            raise CollisionUnavailable(
                "colisao por GPU indisponivel nesta plataforma (sem "
                "GL_EXT_geometry_shader); use SpriteList(use_spatial_hash=True)"
            )
        buffer = ctx.collision_buffer
        program = ctx.collision_detection_program_simple
'''


def troca(arquivo, antes, depois, rotulo, marcador):
    texto = arquivo.read_text()
    if marcador in texto:
        print(f"  {rotulo}: ja aplicado")
        return False
    if antes not in texto:
        raise SystemExit(f"ERRO: ancora nao encontrada em {arquivo.name} ({rotulo})")
    arquivo.write_text(texto.replace(antes, depois, 1))
    print(f"  {rotulo}: aplicado")
    return True


print("Aplicando remendo:")
troca(CONTEXT, ANTES_SPRITE_PROGS, DEPOIS_SPRITE_PROGS, "context: sprite list",
      "self.has_geometry_shaders = False")
troca(CONTEXT, ANTES_SINGLE, DEPOIS_SINGLE, "context: sprite single",
      "self.sprite_program_single = None")
troca(CONTEXT, ANTES_COLISAO, DEPOIS_COLISAO, "context: colisao",
      "self.collision_query = None")
troca(SPRITES, ANTES_ESCOLHA, DEPOIS_ESCOLHA, "sprite_list: escolha da classe",
      "SpriteListTextureData(\n                self.ctx")

ctx = CONTEXT.read_text()
if "from arcade.gl.exceptions import ShaderException" not in ctx:
    ctx = ctx.replace(
        "from arcade.gl import BufferDescription, Context",
        "from arcade.gl import BufferDescription, Context\n"
        "from arcade.gl.exceptions import ShaderException",
        1,
    )
    CONTEXT.write_text(ctx)
    print("  context: import ShaderException: aplicado")

sp = SPRITES.read_text()
if "class CollisionUnavailable" not in sp:
    idx = sp.find("\nclass ")
    sp = sp[:idx] + EXCECAO + sp[idx:]
    SPRITES.write_text(sp)
    print("  sprite_list: CollisionUnavailable: aplicado")

troca(SPRITES, GUARDA_BUFFER, GUARDA_BUFFER_NOVO, "sprite_list: guarda buffer",
      "if ctx.collision_detection_program is None:")
troca(SPRITES, GUARDA_TEXTURA, GUARDA_TEXTURA_NOVO, "sprite_list: guarda textura",
      "if ctx.collision_detection_program_simple is None:")

print("Remendo aplicado.")
