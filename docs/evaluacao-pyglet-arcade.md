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

## 4. GLES: existe, é experimental, e o Mali-G52 tem uma pedra no caminho

O arcade declara, em `doc/programming_guide/gles_raspi_and_sbc.rst`:

> Both Arcade and pyglet can run via OpenGL ES on devices with either:
> OpenGL ES 3.2 or higher, or **OpenGL ES 3.1 with certain extensions**

E o pyglet, em `opengles.rst`:

> Pyglet has **experimental** support for OpenGL ES 3.2, with some limitations.

Nosso panfrost no RK3566 entrega **GLES 3.1** — está no piso declarado. Mas:

| Item | Achado | Consequência |
| --- | --- | --- |
| Shaders do arcade | **todos `#version 330`** (desktop GLSL 3.3) | não são GLSL ES 3.10 |
| Variante ES | **não existe** — nenhum `#version 310 es` no repositório | precisa reescrita em tempo de carga |
| Reescrita em `arcade/gl/program.py` | **não encontrada** | ver abaixo |
| Geometry shader | `collision/col_trans_gs.glsl` usa (`#version 330`) | Mali Bifrost **não tem** estágio de geometry shader |
| Tessellation | o próprio pyglet diz que fica de fora | irrelevante para 2D |
| Texturas | GLES não converte formato no upload; só **RGBA** | imagens RGB dão erro |

**Como ler isto honestamente:** o documento do arcade afirma que GLES funciona,
mas os shaders que estão no pacote são desktop GLSL 330. As duas coisas só se
reconciliam se houver tradução em algum ponto que eu não encontrei — ou se a
afirmação for sobre uma versão mais nova que o `development`.

Isto é **a pergunta número um a medir**, e ela é barata (§7). Não vou afirmar
que funciona nem que não funciona.

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

A pergunta que decide tudo é uma só, e o probe é curto.

**No `generic-x64` (ou em qualquer PC Linux com GLES/desktop GL):**

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

**No handheld, com a pilha que existir (SDL2/KMSDRM ou, se for o caso, X11):**

```bash
# 1. o GLES que o panfrost entrega tem o que o arcade pede?
glxinfo -B 2>/dev/null | grep -i "version"    # se houver X
# ou, sem X, pelo próprio pyglet:
python -c "import pyglet; w=pyglet.window.Window(); print(w.context.get_info())"

# 2. o gamepad aparece pelo evdev?
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
| `get_joysticks()` lista o controle | ✅ o requisito do usuário está atendido no pyglet |
| janela abre e sprite aparece em GLES 3.1 | ✅ arcade viável, caminho (c) ou (d) |
| erro de shader (`#version 330`) | ✗ arcade precisa de reescrita de shader antes de qualquer coisa |
| erro de geometry shader | ⚠️ colisão de sprite cai para o caminho CPU, se houver |
| `get_joysticks()` vazio | ✗ investigar mapping/`/dev/input` antes de tudo |

---

## 9. Recomendação

| Pergunta | Resposta |
| --- | --- |
| pyglet e arcade são elegíveis por licença? | **Sim** — BSD-3 e MIT. Não é aqui que eles caem |
| O gamepad funciona sem servidor gráfico? | **Sim**, pelo evdev — requisito atendido |
| Dá para rodar num handheld hoje? | **Não.** Falta backend de janela em KMSDRM |
| Vale desenvolver jogos com eles? | **Sim**, no `generic-x64`, desde já |
| Qual caminho para o handheld? | Primeiro medir (§8). Se o shader 330 for problema, nada abaixo importa |
| Vale escrever o backend KMSDRM? | Só se Python virar linha de produto. 200–400 linhas + manutenção |
| Existe caminho mais rápido? | **`PySDL2`** — SDL2/KMSDRM que já temos, CC0, custo zero de arquitetura |
| Reabrir quando? | Quando houver medida de: shader GLES do arcade, RAM de um jogo, e janela em KMSDRM |

### Em uma frase

**pyglet e arcade são a escolha certa por licença e a escolha certa por gamepad;
erram só na janela.** Como o resto da stack deles é leve e permissivo, o custo de
consertar essa única peça (backend KMSDRM) é muito menor que o de qualquer
alternativa de UI web — mas ele existe, e é o dobro do esforço se o
`#version 330` do arcade também precisar de tradução.

Se o objetivo for **ter jogos em Python rodando agora**, o PySDL2 resolve com a
arquitetura que já está na imagem. Se o objetivo for **ter uma biblioteca de
jogos de alto nível**, o arcade é a melhor opção a médio prazo, e o trabalho é na
janela.
