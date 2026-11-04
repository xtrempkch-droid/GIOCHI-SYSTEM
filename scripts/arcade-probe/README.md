# `arcade-probe` — o arcade roda sem geometry shader?

Mede, em ambiente fechado, se o remendo de tolerância a `GL_EXT_geometry_shader`
faz o [arcade](https://github.com/pythonarcade/arcade) funcionar numa plataforma
que não tem esse estágio de shader — como o **panfrost** do RK3566.

Contexto e veredito completo: [`docs/evaluacao-pyglet-arcade.md`](../../docs/evaluacao-pyglet-arcade.md).

```bash
bash scripts/arcade-probe/run.sh
bash scripts/arcade-probe/run.sh --rebuild   # refazer a imagem
```

Roda em container (`ubuntu:24.04` + `arcade==3.3.3` + Xvfb + llvmpipe). Não toca
no host além deste diretório e não precisa de aparelho.

---

## Por que este probe existe

O estudo concluiu, por leitura de código, que o arcade **não inicia** no panfrost:
o Mesa não expõe `GL_EXT_geometry_shader` para o panfrost
(`docs/features.txt`: `DONE (freedreno/a6xx, nvc0, r600, softpipe, v3d)` —
panfrost não está), e o arcade carrega programas com geometry shader na
inicialização.

Conclusão por leitura de código é hipótese. Aqui ela vira medida.

---

## O que o arcade 3.3.3 realmente carrega

Cinco programas exigem geometry shader, e **três deles são de desenho** — não só
colisão:

| Programa em `context.py` | Para que serve | Tem fallback sem geo? |
| --- | --- | --- |
| `sprite_list_program_no_cull` | desenhar `SpriteList` | `sprite_list_program_no_geo` ✅ |
| `sprite_list_program_cull` | desenhar com culling | `sprite_list_program_no_geo` ✅ |
| `sprite_program_single` | desenhar sprite único | `sprite_program_single_simple` ✅ |
| `collision_detection_program` | colisão por GPU | não — CPU (`hitbox`/`spatial_hash`) |
| `collision_detection_program_simple` | colisão por GPU | não — CPU |

Ou seja: **o fallback de shader existe para tudo que desenha.** O que não existia
era a escolha: em `sprite_list.py`, o caminho sem geo estava **comentado**:

```python
# Desktop GL (with geo shader)
self._data = SpriteListBufferData(...)
# WebGL (without geo shader)
# self._data = SpriteListTextureData(...)      <- pronto, mas desligado
```

O `SpriteListTextureData` é código real, escrito para WebGL. O remendo só o liga
quando não há geometry shader.

---

## O remendo

[`patch-sem-geometry-shader.py`](patch-sem-geometry-shader.py), idempotente,
oito trocas:

1. `context.py`: os cinco `load_program` com `geometry_shader` ficam em
   `try/except ShaderException` e viram `None` em vez de levantar;
2. `context.py`: ganha `has_geometry_shaders` (bool);
3. `sprite_list.py`: escolhe `SpriteListTextureData` quando
   `has_geometry_shaders` é `False`;
4. `sprite_list.py`: colisão por GPU levanta `CollisionUnavailable` (erro com
   nome) em vez de `TypeError: 'NoneType' object is not subscriptable`.

---

## Resultado medido — 04/11/2026

```text
########## A: caminho normal (com geometry shader) ##########
MODO A: implementacao = SpriteListBufferData
MODO A: render SpriteListBufferData count=2 erro=None
MODO A: colisao GPU disponivel (com geo): sim
MODO A: colisao CPU (spatial hash): 1 sprite(s): sim
MODO A: OK

########## B sem remendo: a falha tem de aparecer ##########
MODO B: LEVANTOU ShaderException: Program link error: simulado ...
MODO B: OK — falha reproduzida (esperado sem remendo)

########## B com remendo: tem de abrir e desenhar ##########
MODO B: implementacao = SpriteListTextureData | has_geometry_shaders = False
MODO B: render SpriteListTextureData count=2 erro=None
MODO B: colisao GPU -> CollisionUnavailable (erro claro): sim
MODO B: colisao CPU (spatial hash): 1 sprite(s): sim
MODO B: OK
```

Leitura: **o remendo funciona.** Sem ele o arcade levanta na inicialização; com
ele abre, usa o caminho de dados sem geo, desenha os dois sprites (o `render` da
`SpriteListTextureData` roda com `count=2` e sem erro), colide em CPU e dá erro
com nome quando se pede colisão por GPU.

---

## O que este probe NÃO prova

Registrado porque a diferença importa mais que o resultado.

| Não prova | Por quê |
| --- | --- |
| Que roda no **panfrost** | o driver aqui é llvmpipe (software). A falha é **injetada** no mesmo ponto (`load_program` com `geometry_shader`), não produzida pelo driver |
| Que roda em **GLES 3.1** | Xvfb dá desktop GL 4.5. O caminho `gl_api="opengles"`, onde o pyglet reescreve os shaders para `#version 310 es`, **não foi exercitado** |
| Que existe **janela em KMSDRM** | continua não existindo no pyglet: `pyglet/display/` só tem xlib, cocoa, win32 e headless |
| **Desempenho** | llvmpipe é software; qualquer número de FPS aqui é ficção |
| Que **pixel saiu na tela** | medir pixel no Xvfb falhou: `arcade.get_image()` e `glReadPixels` devolvem preto **também no caminho que funciona**. Por isso a prova é por `render()` interceptado |

O item do GLES é o próximo a medir, e exige um ambiente com EGL + driver que
entregue GLES — não Xvfb.

---

## O que fazer com o remendo

1. **Upstream.** É pequeno, defensável e beneficia qualquer SBC sem geometry
   shader (panfrost, etnaviv, lima). A frase de defesa: *"geometria é otimização,
   não requisito — e o fallback sem geo já existe no pacote."*
2. **Se não subir upstream:** fork mantido, com o custo de reaplicar a cada
   release (as âncoras do patch são linhas exatas da 3.3.3, e o script **falha
   alto** se não achar — não aplica pela metade).
3. **Não** embarcar no rootfs enquanto a janela em KMSDRM não existir. O que
   este probe destrava é a **viabilidade**, não a integração.
