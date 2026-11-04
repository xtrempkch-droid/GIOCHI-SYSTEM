# pyglet e arcade — estudo de viabilidade

Avaliação de [pyglet](https://github.com/pyglet/pyglet) e
[arcade](https://github.com/pythonarcade/arcade) para executar jogos em Python
com suporte a gamepad no Giochi System. Medido em 04/11/2026.

> **Veredito: os dois são elegíveis por licença e o gamepad funciona sem
> servidor gráfico — mas nenhum dos dois consegue desenhar na tela de um
> handheld desta árvore.** O `pyglet` só sabe abrir janela em **X11**
> (`xlib.py`), macOS ou Windows; não existe backend KMSDRM nem Wayland. Como o
> arcade roda em cima do pyglet, o bloqueio é o mesmo para os dois.
>
> Isto é o **oposto** do que aconteceu com o Quiver: lá a licença matava e o
> desenho era caro (WebKitGTK, 700 MB). Aqui a licença é livre e o app é leve —
> o que falta é uma peça de encanamento de 300 linhas (ou um X server).

---

## 1. O que é cada um

| | pyglet | arcade |
| --- | --- | --- |
| O que faz | janela + OpenGL + entrada, baixo nível | biblioteca de jogos 2D em cima do pyglet |
| Linguagem | Python puro, `ctypes` | Python puro |
| Licença | **BSD-3-Clause** ✅ | **MIT** ✅ |
| Dependências | **nenhuma** | `pillow`, `pytiled-parser`, `pyglet==3.0.dev11` |
| Python exigido | ≥ 3.8 | **≥ 3.11** |

**Licença resolvida de saída.** O `pygame` foi recusado porque é **LGPL-2.1**, e
a regra desta árvore recusa copyleft na imagem assinada. `pyglet` é BSD-3 e
`arcade` é MIT: os dois passam no validador sem exceção.

---

## 2. A boa notícia: o gamepad funciona sem servidor gráfico

Este era o requisito do usuário, e é a parte que **está pronta**.

`pyglet/input/linux/__init__.py` liga `get_joysticks()` e `get_controllers()` ao
**evdev**, não ao XInput2:

```python
from .evdev import get_joysticks
from .evdev import get_controllers
from .x11_xinput import get_devices as x11xinput_get_devices   # só teclado/mouse
```

E `pyglet/input/linux/evdev.py` (21 KB) importa **apenas stdlib**:

```python
import os, time, ctypes, select, warnings, threading
```

Abre `/dev/input/event*` direto. As assinaturas confirmam que o display é
opcional e ignorado por esse caminho:

```python
def get_joysticks(display=None): ...
def get_controllers(display=None): ...
```

Também vem junto um banco de mapeamentos de **196 KB**
(`pyglet/input/controller_db.py`), derivado do banco do SDL: botões com nome,
dpad, analógicos. É a mesma ideia do nosso `buttons.map`, em escala maior.

O arcade só embrulha isso:

```python
# arcade/joysticks.py
def get_joysticks(): return pyglet.input.get_joysticks()
# arcade/controller.py
def get_controllers(): return pyglet.input.get_controllers()
```

**Encaixe com o nosso hardware:** os 16 botões do `gpio-keys` e os 4 eixos do
`adc-joystick` aparecem como um device evdev com `BTN_*` e `ABS_*` — exatamente
o que o evdev do pyglet lê. O que falta é uma **entrada no banco de mapeamentos**
para o nosso aparelho (dado, não código), e isso é do mesmo tamanho do
`buttons.map` que já mantemos.

---

## 3. O bloqueio: não existe backend de janela em KMSDRM

`pyglet/display/` tem quatro backends, e **nenhum serve**:

| Arquivo | Plataforma | Serve aqui? |
| --- | --- | --- |
| `xlib.py` (17 KB) | X11 | só com X server |
| `cocoa.py` | macOS | não |
| `win32.py` | Windows | não |
| `headless.py` (2 KB) | EGL **offscreen** | renderiza, não mostra |

Confirmações independentes, todas do repositório oficial:

- **`headless.py`** cria um `HeadlessScreen` de 1920x1080 fixo e um
  `HeadlessCanvas` **sem surface** — é para render offline (FBO), não para
  colocar pixel na tela. A própria docstring diz `TODO: fix this placeholder`.
- **`RELEASE_NOTES`** (1504 linhas) menciona Wayland, KMS e `libdrm` **zero
  vezes** como backend. As únicas ocorrências de "headless" e "EGL" são sobre o
  modo offscreen.
- **O guia de OpenGL ES** (`doc/programming_guide/opengles.rst`) abre a janela
  assim, mesmo em GLES:

  ```python
  display = pyglet.display.get_display()      # no Linux: xlib
  config.opengl_api = "gles"
  window = pyglet.window.Window(config=config)
  ```

  Ou seja: **até o caminho GLES passa por X11.**

Não há `wayland.py`, não há `kmsdrm.py`, não há suporte a EGL-on-GBM com surface.
E o arcade não tem camada própria de janela — usa a do pyglet.

### Por que o Raspberry Pi deles funciona e o nosso aparelho não

O arcade declara suporte verificado a RPi 4 e 5 — mas rodando **Raspberry Pi OS**,
que é um desktop com Wayland/XWayland. É a mesma situação do Quiver: "funciona no
Pi" ali significa "funciona sobre um compositor", não "funciona em KMSDRM puro".

---

## 4. GLES: o arcade traduz — mas exige uma extensão que o panfrost não tem

Esta era a pergunta em aberto, e foi **respondida por leitura do código** (não por
estimativa). O arcade **traduz** os shaders em tempo de carga, em
`arcade/gl/backends/opengl/glsl.py`:

```python
# GLES specific modifications
if ctx.gl_api == "opengles":
    # TODO: Use the version from the context
    self._lines[0] = "#version 310 es"
    self._lines.insert(1, "precision mediump float;")

    if self._type == gl.GL_GEOMETRY_SHADER:
        self._lines.insert(1, "#extension GL_EXT_geometry_shader : require")
```

Então o `#version 330` **não** é problema: ele é reescrito para `#version 310 es`
e ganha `precision mediump float;` — exatamente o que GLSL ES exige. O pyglet
declara GLES 3.2 experimental, e o arcade se apoia nisso.

**O problema é a linha seguinte.** Para geometry shader, o arcade exige a
extensão `GL_EXT_geometry_shader`. E o Mesa não a expõe no panfrost:

```text
$ grep -i "geometry_shader" mesa/docs/features.txt
  Geometry shaders            DONE (freedreno/a6xx, crocus)
  GL_OES_geometry_shader      DONE (freedreno/a6xx, nvc0, r600, softpipe, v3d)
```

`freedreno` é Adreno, `nvc0` é NVIDIA, `v3d` é **Raspberry Pi** — é literalmente
por isso que a equipe do arcade verificou o Pi 4 e o 5 e o nosso aparelho não está
na lista. **`panfrost` não aparece.**

### Por que isso é pior que "colisão mais lenta"

O `Context` do arcade carrega os programas com geometry shader
**incondicionalmente** na inicialização, e `load_program` **levanta**, não
degrada:

```python
raise ShaderException(f"Program link error: {log.value.decode()}")
```

Não há `try/except` em volta. Consequência: em panfrost, `arcade.Window()`
levanta `ShaderException` **antes de qualquer coisa aparecer na tela**. Não é
"a colisão por GPU não funciona" — é **o arcade não inicia**.

### O que isso quer dizer, sem exagero

**Correção de uma afirmação anterior deste documento.** Eu tinha escrito que só
os dois programas de colisão exigem geometry shader, e que "todo o caminho de
renderização 2D funciona". Isso está **errado** para a 3.3.3 (a versão estável
que o `pip install arcade` traz). Medido no código instalado: são **cinco**
programas, e **três são de desenho**.

| Programa em `context.py` | Para que serve | Fallback sem geo |
| --- | --- | --- |
| `sprite_list_program_no_cull` | desenhar `SpriteList` | `sprite_list_program_no_geo` ✅ |
| `sprite_list_program_cull` | desenhar com culling | `sprite_list_program_no_geo` ✅ |
| `sprite_program_single` | sprite único | `sprite_program_single_simple` ✅ |
| `collision_detection_program` | colisão GPU | não — CPU (`hitbox`) |
| `collision_detection_program_simple` | colisão GPU | não — CPU (`hitbox`) |

O fallback de shader **existe para tudo que desenha**. O que faltava era a
escolha: em `sprite_list.py` o caminho sem geo está **comentado**:

```python
# Desktop GL (with geo shader)
self._data = SpriteListBufferData(...)
# WebGL (without geo shader)
# self._data = SpriteListTextureData(...)      <- pronto, mas desligado
```

`SpriteListTextureData` é código real, escrito para WebGL. O remendo só o liga.

### O remendo foi medido, e funciona

Estimativa anterior: "~10 linhas". **Errado também** — o remendo real tem oito
trocas (ver [`scripts/arcade-probe/`](../../scripts/arcade-probe/README.md)),
porque não basta tolerar a ausência: é preciso escolher a implementação de dados
sem geo e transformar o `TypeError` da colisão num erro com nome.

Resultado em ambiente fechado (arcade 3.3.3, Xvfb + llvmpipe), com a falha
injetada no mesmo ponto (`load_program` com `geometry_shader`):

| Cenário | Resultado |
| --- | --- |
| A — caminho normal | `SpriteListBufferData`, render `count=2`, colisão GPU ok |
| B — sem geo, **sem** remendo | `ShaderException` na inicialização |
| B — sem geo, **com** remendo | abre, `SpriteListTextureData`, render `count=2`, colisão CPU ok, colisão GPU → `CollisionUnavailable` |

**O que isso NÃO prova**, e está registrado no README do probe: o driver foi
llvmpipe, não panfrost; a falha foi injetada, não produzida pelo driver; e o
caminho **GLES** (`gl_api="opengles"`, onde o pyglet reescreve para
`#version 310 es`) não foi exercitado, porque Xvfb entrega desktop GL 4.5.
Medir GLES exige EGL + driver GLES, que é outro ambiente.

### Texturas: a outra limitação, que é do pyglet

O guia do pyglet avisa que em GLES **só RGBA** é aceito no upload — GLES não
converte formato durante `glTexImage`, e o desktop converte. Imagem RGB (PNG sem
canal alfa) dá erro na hora de virar textura. Isso afeta asset de jogo e é
contornável (converter para RGBA no empacotamento do pacote).

---

## 5. Toolchain e empacotamento

| Requisito | Estado na árvore |
| --- | --- |
| Python ≥ 3.11 (arcade) | ✅ **3.11.8** no Buildroot 2024.02 |
| `pillow` (dependência com C) | ✅ existe `python-pillow` no Buildroot |
| `numpy` | ✅ existe `python-numpy` (pyglet não exige; alguns jogos sim) |
| `pyglet` | ❌ não empacotado — mas é **Python puro**, instala por `pip`/cópia |
| `arcade` | ❌ idem, Python puro |
| `pymunk` (física, opcional) | ❌ **extensão C**, não existe no Buildroot |
| `pyglet==3.0.dev11` | ⚠️ **pré-release fixado exato** |

Dois riscos concretos:

1. **`pymunk` é dependência binária.** O próprio arcade avisa: *"If one of these
   packages hasn't been compiled for your SBC's CPU architecture, you will not
   be able to install Arcade."* Só afeta jogo que usa física, mas nesse caso não
   há saída sem compilar para aarch64 fora do aparelho.
2. **`pyglet==3.0.dev11` é `dev`.** Pin exato num pré-release significa: não está
   na árvore do Buildroot, muda de API entre `dev` e `dev`, e um dia o arquivo
   sai do PyPI. O jogo tem de **vendorizar** o runtime dele — que é justamente o
   modelo de loja que já combinamos, então é custo administrável, não bloqueio.

### O contrato com o `Giochi app` precisa de um valor novo

`forge.json` hoje aceita `runtime: godot | retroarch | proton`. **Não existe
`python`.** Um jogo em Python não consegue se declarar no contrato atual.

Isso é mudança **do lado deles** — a mesma que já registraram no canal: *"hoje
`runtime: "native"` não expressa 'preciso de runtime X' — é mudança de contrato
nossa, não de vocês"*. Registro aqui para não virar surpresa.

---

## 6. Memória: o problema é outro, e é menor

Comparação com o que já medimos:

| Launcher | RAM | Fonte |
| --- | --- | --- |
| Quiver via WebKitGTK | 490–770 MiB (pico 1,3 GiB) | medido por eles, `CEF-SPIKE.md` |
| Python + pyglet + arcade | **a medir** | — |

O que a medição tem de cobrir, e a ordem de grandeza esperada:

| Componente | Observação |
| --- | --- |
| CPython 3.11 | interpretador + stdlib importada |
| pillow | carrega libjpeg/libpng |
| pyglet + arcade | puro Python, mas o tree de objetos de sprite pesa |
| X server (se for por esse caminho) | **é a peça que não existe hoje** |
| framebuffers da GPU | `/dev/mali`/panfrost, fora do RSS do processo |

**Não vou inventar número.** O que se pode afirmar com segurança é a **ordem de
grandeza relativa**: um jogo 2D em Python fica na casa das **dezenas a poucas
centenas de MB**, contra 490–1.300 MiB do WebKitGTK. No X35H (964 MB) isso é
plausível; no X55 (2 GB) é folgado. Mas "plausível" não é "medido", e aqui a
diferença importa.

---

## 7. Os quatro caminhos, do mais barato ao mais caro

### (a) `generic-x64` — hoje, custo zero

No PC já existe X11/Wayland, D-Bus e RAM. `pip install arcade` e roda. Serve
para **desenvolver e testar os jogos**, e é o mesmo encaixe que o Quiver tem lá.

Não resolve o handheld, mas destrava a produção de conteúdo sem tocar na imagem.

### (b) `PySDL2` — o caminho que já está pronto no aparelho

Não foi pedido, mas é a comparação honesta: **nós já temos SDL2 com KMSDRM** na
imagem dos dois handhelds, com joystick e gamepad funcionando.

| | |
| --- | --- |
| Licença | **CC0 / domínio público / zlib** |
| Natureza | wrapper `ctypes` puro sobre o SDL2 que já está lá |
| Janela | **KMSDRM**, o que já funciona |
| Gamepad | o subsistema `SDL_Joystick`/`SDL_GameController`, que já funciona |

O custo é que o PySDL2 é baixo nível: sem `SpriteList`, sem `Scene`, sem
atlas automático. Para um jogo pequeno dá; para o que o arcade entrega, não é
comparável.

Mas ele responde a pergunta do usuário **hoje**: "jogos em Python com suporte a
gamepad" — sim, sem mudar arquitetura nenhuma.

### (c) Backend KMSDRM para o pyglet — o certo, e o mais trabalhoso

O pyglet já tem tudo de que precisa, menos a última milha:

- `pyglet/libs/egl/` — bindings EGL prontos;
- `pyglet/display/headless.py` — já chama `eglGetPlatformDisplayEXT` com
  `EGL_PLATFORM_DEVICE_EXT`;
- falta: `libgbm` + `drmModeSetCrtc` para criar a **surface** que o
  `HeadlessCanvas` não tem.

Ordem de grandeza: **200–400 linhas** num `pyglet/display/kmsdrm.py`, contra o
que existe em `xlib.py` (17 KB) e `headless.py` (2 KB). Dá para fazer como
contribuição upstream (beneficia todo SBC) ou como fork mantido por nós.

**Não é projeto de uma tarde**, e a manutenção é real: cada release do pyglet
pode mexer no contrato de `Display`/`Canvas`/`Screen`.

### (d) X server na imagem — funciona, e quebra a nossa própria regra

Xorg + `xf86-video-modesetting` roda sobre KMS e resolve pyglet e arcade de uma
vez. Em memória é muito mais barato que WebKitGTK.

Mas tem uma consequência que precisa ficar explícita: **`BR2_PACKAGE_XORG7` em
defconfig de handheld é proibido por teste** — foi o gate que escrevi depois de
avaliar o Quiver:

```js
// tests/graphics-stack.test.mjs
["BR2_PACKAGE_XORG7", "Xorg"],
```

Esse teste existe para que a decisão não seja desfeita por uma linha. Escolher
este caminho significa **alterar o gate com a decisão registrada**, não contorná-lo.
É exatamente o comportamento desejado: a decisão fica visível em revisão.

---

## 8. O que medir, e como

A leitura de código já respondeu a pergunta do shader (§4). O que resta é
**medir em máquina**, e são três números.

**No `generic-x64` (ou em qualquer PC Linux com GL/GLES) — o mais barato, e
serve para desenvolver:**

```bash
pip install arcade
python -c "
import arcade, pyglet
print('pyglet', pyglet.version, 'arcade', arcade.VERSION)
w = arcade.Window(640, 480, 'probe')
print('gl', w.ctx.gl_version, 'renderer', w.ctx.info.get('GL_RENDERER'))
arcade.SpriteList()          # força carregar o shader de sprite
"
```

Isto **não** prova nada sobre o handheld (o PC tem geometry shader), mas prova
que o jogo funciona e é onde ele deve ser desenvolvido.

**No handheld, quando houver janela (caminho c ou d):**

```bash
# 1. o panfrost expõe a extensão que o arcade exige?
python -c "
import pyglet; pyglet.options.shadow_window = False
w = pyglet.window.Window()
print('GLES:', w.context.get_info().get_version())
print('extensões com geometry:', [e for e in w.context.get_info().get_extensions() if 'geometry' in e])
"

# 2. o gamepad aparece pelo evdev?   (não depende de janela — pode rodar hoje)
python -c "
import pyglet.input
for j in pyglet.input.get_joysticks(): print(j, j.device.name, len(j.get_buttons()), len(j.get_axes()))
"

# 3. RAM de um jogo real
python meu_jogo.py & sleep 20; grep -E "VmRSS|VmHWM" /proc/$!/status
```

O que cada resultado decide:

| Resultado | Significa |
| --- | --- |
| `get_joysticks()` lista os 16 botões e 4 eixos | ✅ o requisito do usuário está atendido — e **isto pode ser medido hoje**, sem janela |
| lista de extensões **sem** `geometry_shader` | ✗ confirma o §4: precisa do remendo (já medido em `scripts/arcade-probe/`) antes de o arcade abrir |
| lista **com** `GL_EXT_geometry_shader` | ✅ o §4 estava conservador — o arcade roda sem patch |
| janela abre e sprite aparece em GLES 3.1 | ✅ arcade viável, caminho (c) ou (d) |
| `ShaderException` no `arcade.Window()` | ✗ esperado pelo §4; é o patch de tolerância |
| `get_joysticks()` vazio | ✗ investigar mapping/`/dev/input` antes de tudo |

---

## 9. Recomendação

| Pergunta | Resposta |
| --- | --- |
| pyglet e arcade são elegíveis por licença? | **Sim** — BSD-3 e MIT. Não é aqui que eles caem |
| O gamepad funciona sem servidor gráfico? | **Sim**, pelo evdev — requisito atendido |
| Dá para rodar num handheld hoje? | **Não.** Falta backend de janela em KMSDRM |
| O `#version 330` do arcade é problema? | **Não** — ele reescreve para `#version 310 es` no load |
| O que trava o arcade no panfrost? | **`GL_EXT_geometry_shader`**, que o Mesa não expõe no panfrost. Derruba o boot, não só a colisão |
| Vale desenvolver jogos com eles? | **Sim**, no `generic-x64`, desde já |
| Qual caminho para o handheld? | (c) backend KMSDRM no pyglet **+** o remendo de geometry shader, **já medido e funcionando** |
| Vale escrever o backend KMSDRM? | Só se Python virar linha de produto. 200–400 linhas + manutenção |
| Existe caminho mais rápido? | **`PySDL2`** — SDL2/KMSDRM que já temos, CC0, custo zero de arquitetura |
| Reabrir quando? | Quando houver medida de RAM de um jogo real e de janela em KMSDRM |

### Em uma frase

**pyglet e arcade são a escolha certa por licença e a escolha certa por gamepad;
erram na janela, e o arcade erra mais um pouco no geometry shader.** Os dois
consertos são conhecidos e pequenos — backend KMSDRM (200–400 linhas) e tolerância
à ausência de `GL_EXT_geometry_shader` (oito trocas, já medido) —, e nenhum deles é o tipo de
trabalho que pode ser evitado com configuração.

Comparado com o Quiver, o custo é **muito menor**: lá eram WebKitGTK + GTK3 +
compositor Wayland + 700 MiB de RAM; aqui é uma extensão EGL e dois programas de
shader. Mas o custo existe, e é o dobro do esforço se as duas peças precisarem
ser mantidas contra mudanças de upstream.

Se o objetivo for **ter jogos em Python rodando agora**, o PySDL2 resolve com a
arquitetura que já está na imagem. Se o objetivo for **ter uma biblioteca de
jogos de alto nível**, o arcade é a melhor opção a médio prazo, e o trabalho é na
janela e nos dois programas de colisão.
