# O launcher — o que o sistema precisa entregar

Este repositório não entrega a interface: o launcher é do `Giochi app`. Mas ele
roda **dentro** desta imagem, e há coisas que só o sistema pode fornecer. Esta
página é o contrato — o que já está pronto, o que falta, e as armadilhas que
deixam o build verde com a tela sem texto.

## Estado, por evidência

| Item | Estado | Fonte |
| --- | --- | --- |
| `/dev/dri/card0` + render node | **OK** | medido no X55: `panfrost` + `rockchip-drm`, `card0-DSI-1: connected 720x1280` |
| console na orientação certa | **OK** | medido: `160x45` com `fbcon=rotate:3` (X55) |
| SDL2 com KMSDRM compilado | **OK** | `BR2_PACKAGE_SDL2_KMSDRM=y` + `SDL2_OPENGLES=y` (o KMSDRM exige o segundo, senão é descartado em silêncio) |
| Mesa com panfrost + GLES | **OK** | `BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_PANFROST=y`, `SWRAST` como fallback |
| **KMSDRM "real" (não dummy)** | **relatado pelo usuário** | ainda não registrado em log de `giochi-selftest`; quando houver, colar aqui |
| rasterizador de texto + fonte | **adicionado nesta revisão** | ver abaixo |
| `giochi-init` chamado pelo init | **OK** | `scripts/post-build.sh` acrescenta `::respawn:` ao `/etc/inittab` §11 |
| launcher empacotado | **falta** | é do `Giochi app` |

"KMSDRM real" importa porque a alternativa silenciosa é o SDL2 cair no driver
`dummy`: o processo roda, o log diz que inicializou vídeo, e nada aparece na
tela. Quando o launcher existir, o teste que fecha isso é
`SDL_GetCurrentVideoDriver()` devolver `kmsdrm` — não "abriu a janela".

## O stack de texto, e as duas armadilhas

Configurado no `defconfig` de cada aparelho **com SDL2** (X55 e X35H):

```text
BR2_PACKAGE_SDL2_TTF=y
BR2_PACKAGE_HARFBUZZ=y
BR2_PACKAGE_DEJAVU=y
BR2_PACKAGE_DEJAVU_SANS=y
```

As quatro bibliotecas que o launcher carrega, medidas na imagem:

| Biblioteca | Estado |
| --- | --- |
| `libasound` (ALSA) | presente — `BR2_PACKAGE_ALSA_LIB` |
| `libfreetype` | presente — `SDL2_TTF` faz `select` |
| `libharfbuzz` | presente — e ligado no `SDL2_ttf` (ver armadilha 3) |
| `libSDL2_ttf` | presente |

### Armadilha 1 — `SDL2_TTF` é pacote à parte, e `harfbuzz` não vem junto

`BR2_PACKAGE_SDL2_TTF` **não** é uma opção do pacote `sdl2` como
`SDL2_IMAGE`/`SDL2_KMSDRM`. É um pacote próprio (`package/sdl2_ttf/`).

Ele faz `select BR2_PACKAGE_FREETYPE` — o rasterizador vem. Mas **harfbuzz não
vem**: o `.mk` só passa `--enable-harfbuzz` quando `BR2_PACKAGE_HARFBUZZ=y`
existe por conta própria.

| Escrita | Precisa harfbuzz? |
| --- | --- |
| português, inglês (Latim) | **não** |
| árabe, hindi, tailandês, hebraico | **sim** |

A falta **não dá erro**: o texto sai com shaping errado (letras desligadas,
ordem trocada). Para ligar: `BR2_PACKAGE_HARFBUZZ=y` no defconfig do aparelho.
Custo: mais um pacote grande no build.

### Armadilha 2 — `DEJAVU=y` sozinho instala ZERO fontes

O `dejavu.mk` começa com a lista vazia e só a preenche dentro de um `ifeq` por
família:

```make
DEJAVU_FONTS_INSTALL =
ifeq ($(BR2_PACKAGE_DEJAVU_MONO),y)   # ← só aqui a lista cresce
...
```

Consequência de `BR2_PACKAGE_DEJAVU=y` sem sub-opção:

```text
build: verde
/usr/share/fonts/dejavu/    ← existe, e está VAZIO
launcher: TTF_OpenFont: Couldn't load font file
```

A sub-opção da família é **obrigatória**. Aqui: `BR2_PACKAGE_DEJAVU_SANS=y`.

### Armadilha 3 — a dependência nova não reconfigura o pacote antigo

Esta foi medida neste repositório e é a mais traiçoeira das três.

Ligar `BR2_PACKAGE_HARFBUZZ=y` **não basta**. O `sdl2_ttf` já estava compilado
de um build anterior, e o Buildroot **não reconfigura** pacote pronto só porque
uma dependência apareceu. O estado ficou assim:

```text
/usr/lib/libharfbuzz.so.0                  ← instalada
build/sdl2_ttf-2.22.0/config.log:
    --disable-harfbuzz
    TTF_USE_HARFBUZZ='0'                   ← ninguém usa
```

Build verde, biblioteca na imagem, e o recurso que motivou a mudança inativo.
Nenhum gate pega: o símbolo no `.config` está certo.

Correção — limpar o pacote **consumidor** e reconstruir:

```bash
rm -rf ~/.cache/giochi-system/work/<device>/build/build/sdl2_ttf-*
```

Depois: `TTF_USE_HARFBUZZ='1'` e

```text
readelf -d libSDL2_ttf-2.0.so.0 → NEEDED  libharfbuzz.so.0
```

Por isso o `giochi-selftest` **não** se contenta em ver a biblioteca presente:
ele roda `readelf -d` no `SDL2_ttf` e avisa quando o harfbuzz não está ligado.
Presença de `.so` não prova uso.

Mesma regra do `KEEP_WORK`: seguro para depurar, perigoso quando muda **com o
que** um pacote é compilado. `AGENTS.md` §12.29.

`tests/launcher-deps.test.mjs` fecha as três: exige que todo defconfig com
`BR2_PACKAGE_SDL2=y` tenha os quatro símbolos (`SDL2_TTF`, `HARFBUZZ`,
`DEJAVU`, `DEJAVU_SANS`), que `DEJAVU` nunca apareça sem família, e que
harfbuzz não arraste glib/cairo/icu sem necessidade.

### Por que estas linhas não estão no `config/common.fragment`

Porque **o QEMU não tem SDL2**. `BR2_PACKAGE_SDL2_TTF` depende de
`BR2_PACKAGE_SDL2`; sem ele o Kconfig **nem oferece** o símbolo, o
`olddefconfig` descarta em silêncio e o `assert-config` reprova o build — do
aparelho que existe justamente para provar o pipeline.

Então o stack de texto mora junto do SDL2, no `defconfig` de quem tem tela. O
teste garante que a invariante vale para aparelho novo: quem liga SDL2 liga o
texto.

### Se o launcher for Godot

Godot embarca o próprio freetype e **não usa `SDL2_ttf`**. Nesse caso as duas
primeiras linhas só custam tempo de build; a fonte de sistema continua fazendo
falta para texto fora do Godot. Vale confirmar contra o `forge.json` do app
(`runtime: godot | retroarch | proton`) antes de otimizar.

## O que o launcher pode assumir da imagem

| Recurso | Onde |
| --- | --- |
| SDL2 com KMSDRM e GLES | `/usr/lib/libSDL2*.so` |
| Mesa panfrost + swrast (fallback) | `/usr/lib/dri/` |
| `libdrm`, `gbm` | `/usr/lib/` |
| fontes | `/usr/share/fonts/dejavu/DejaVuSans.ttf` |
| hostname/issue | `/etc/hostname`, `/etc/issue` |
| mapa de botões | `/etc/giochi/buttons.map` (por aparelho) |
| ferramenta de teste de controle | `giochi-buttons` |
| log do boot | `giochi-boot.log` na partição FAT (aparelhos com marcador) |
| estado do mixer do aparelho | `/etc/giochi/asound.state` (só onde o roteamento exige) |

Caminho combinado para o binário (usado pelo `giochi-init` e pelo `post-build`):

```text
/opt/giochi/apps/launcher/bin/giochi-launcher
```

**O `giochi-init` é chamado sozinho, sempre** — `scripts/post-build.sh`
acrescenta `::respawn:/usr/bin/giochi-init` ao `/etc/inittab` em toda imagem. Não
há flag de configuração, e a linha **não** depende de o launcher estar presente.

A primeira versão condicionava a linha à existência do launcher, para não deixar
um processo esperando binário inexistente. Estava errado por um motivo que só
apareceu ao inspecionar a imagem que a equipe do app tinha em mãos:

> **O launcher não vem desta árvore.** Ele é empacotado pela equipe do app e
> entra no rootfs por overlay, **sobre uma imagem nossa**. Se a linha só existe
> quando o launcher já está lá, ela nunca existe na imagem entregue — e o binário
> fica no disco sem ninguém para chamar.

Sem launcher o custo é zero: o `giochi-init` espera em intervalos de
`GIOCHI_LAUNCHER_WAIT` (30 s), sem CPU e sem inundar o console (§11 do AGENTS).

Regra que fica: **não condicione o artefato entregue à presença de algo que o
cliente da imagem é quem instala.**

## O que muda para o launcher: `GL_RENDERER`, e por quê

Medido no R35S em 06/11/2026 (detalhe em `AGENTS.md` §12.51). A imagem que
estava no aparelho saía com `CONFIG_DRM_PANFROST=m`, e o rootfs do Buildroot não
tem `/etc/modules` nem `modules-load` — ninguém carregava o driver. Resultado:
**sem render node**, e a Mesa caía no `swrast`.

O que torna isso perigoso do lado do app é que **a resposta não muda**:

```text
com panfrost:  GL_RENDERER = Mali-G31 (Panfrost)   GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
sem panfrost:  GL_RENDERER = softpipe              GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
```

Mesma `GL_VERSION`, mesmo "GLES respondeu", e o mesmo `kmscube` rodando. A
diferença é só o campo que ninguém lê. Um launcher que valida "tem GLES 3.1?"
declara o aparelho pronto e entrega 15 fps na CPU de 1 GB.

**Contrato para o launcher:**

1. **Não conclua nada de `GL_VERSION`.** Leia `glGetString(GL_RENDERER)` e
   registre no log (e no `--dump-frame`, e no diagnóstico).
2. Trate `softpipe` / `llvmpipe` como **degradação**, não como sucesso: avise na
   tela ou no log, com o texto do renderer.
3. Não bloqueie por isso — o jogo roda, só mal. Quem conserta é a imagem
   (`CONFIG_DRM_PANFROST=y`), não o app.

Detecção em uma linha, para o diagnóstico:

```sh
ls /dev/dri/renderD128 || echo "sem render node — 3D na CPU"
```

### Estado por imagem

| Imagem | GPU | O que o launcher vai ver |
| --- | --- | --- |
| `779fc64` (no cartão, estado anterior) | panfrost `=m`, sem autoload | `softpipe` |
| `dc030b0` (gerada em 06/11, `out/r35s/`) | panfrost `=y` | `Mali-G31 (Panfrost)` |

Se o renderer disser `softpipe` num aparelho com a imagem nova, o problema não é
configuração — é outro, e vale abrir com a gente.

## Áudio: o `Playback Mux` agora é por aparelho

O controle `Playback Mux` do RK817 (`HP` | `SPK`) é virtual: nenhum registrador
guarda o valor e o driver não lê nada do device tree — quem escolhe é userspace,
e o default é `HP`.

No **R35S** isso está errado: o DTS roteia `Speaker -> SPKO`, e em `HP` só
HPOL/HPOR recebem o DAC, então o falante fica mudo. Corrigido com
`/etc/giochi/asound.state` por aparelho + `/etc/init.d/S51mixer`, que restaura o
estado **se o aparelho declarar um** (X55 e X35H não declaram e ficam no default,
que é o certo neles).

Para o launcher e o app:

1. **Não assuma `HP`.** Se for mexer no mixer, leia o valor atual e restaure o
   que estava, em vez de escrever uma constante.
2. **Não sobrescreva `/etc/giochi/asound.state`** com um estado salvo do aparelho
   de vocês: o arquivo é declarativo, vem da imagem, e é por aparelho.
3. O volume (`Master Playback Volume`, 0–255) é livre para vocês — o
   `asound.state` traz 255/255, e o `S51mixer` só roda no boot.

Referência do roteamento de cada placa: `device/<aparelho>/README.md`.

## Coisas que vão morder, em ordem de probabilidade

1. **`fbcon` e DRM master disputando.** Ao abrir o KMSDRM o launcher vira DRM
   master; o `fbcon` perde a tela. O getty do console continua escrevendo e
   pode aparecer por cima ou corromper o quadro. Se acontecer, a saída é tirar o
   getty do console ativo (`/etc/inittab`) ou desligar o `fbcon` enquanto o
   launcher roda. **Não medido aqui** — anotar o que acontecer.
2. **`SDL_VIDEODRIVER`.** Sem a variável o SDL2 escolhe; com `SDL_VIDEODRIVER=dummy`
   escolhido errado, roda sem desenhar. Fixar `kmsdrm` explicitamente é
   diagnóstico melhor que "não aparece nada".
3. **Permissão no DRM.** O launcher roda como root nesta imagem, então não há
   problema de grupo `video`. Se um dia houver usuário não-root, ele precisa de
   acesso a `/dev/dri/card0` e ao render node.
4. **CPU do X35H.** RK3566 igual à X55, então o que for medido numa vale na
   outra — exceto painel e rotação (640×480 / `rotate:0`).
5. **Entropia na primeira conexão.** O `sshd` bloqueia esperando `crng` se o
   `&rng` não estiver ligado. Já está (patch do DTS de cada aparelho).

## Como verificar no aparelho

```sh
giochi-selftest                 # bloco "render 3D" e "rede por USB"
giochi-usbnet --status          # acesso: UDC, usb0, leases, sshd
giochi-buttons                  # 16 botões + 4 eixos, nome lógico
ls -l /usr/share/fonts/dejavu/  # tem de ter .ttf, não só o diretório
```

E do launcher:

```c
SDL_GetCurrentVideoDriver()      // tem de dizer "kmsdrm"
TTF_Init()                       // falha = freetype ou fonte ausente
```

## Quando o launcher entrar

1. Copiar o binário para `/opt/giochi/apps/launcher/bin/giochi-launcher`.
2. Buildar (ou, se a imagem já foi entregue, copiar o binário e reiniciar — a
   linha do `inittab` já está lá de qualquer forma).
3. No aparelho: `giochi-selftest` deve dizer `inittab chama giochi-init` e
   `launcher: /opt/giochi/apps/launcher/bin/giochi-launcher`.

Se o `giochi-selftest` disser `inittab NÃO chama giochi-init` com o launcher
presente, o `post-build` não rodou — e aí o launcher nunca subiria sem uma pista
do motivo.

## GIOCHI-ENGINE: o que a imagem tem de entregar

A engine própria (`GIOCHI-ENGINE`) declara no `Cargo.toml`:

```toml
sdl2 = { version = "0.38", default-features = false,
         features = ["image", "mixer", "ttf"] }
```

Quatro módulos SDL e ALSA. **Três deles a imagem já tinha; o mixer faltava.**
Medido no sysroot do Buildroot:

```text
sdl2         OK        sdl2.pc
SDL2_image   OK        SDL2_image.pc
SDL2_ttf     OK        SDL2_ttf.pc
SDL2_mixer   AUSENTE   ← bloqueava o build
```

O erro que isso produz **não cita a imagem**:

```text
Perhaps you should add the directory containing `SDL2_mixer.pc'
Package 'SDL2_mixer' not found
The system library `SDL2_mixer` required by crate `sdl2-sys` was not found.
```

Quem lê isso procura no `PKG_CONFIG_PATH`, no crate `sdl2-sys`, no Rust — e o
arquivo que falta é uma linha de `defconfig`. Corrigido nos três aparelhos com
tela; `tests/engine-deps.test.mjs` prende a invariante.

### A receita de cross-compile que funciona

O `cross` **não** é o caminho para o nosso alvo, e a engine documenta por quê: o
SDL2 que ele produz vem com backends de desktop (`libsndio`, `libwayland-egl`,
`libjack`, `libpulse`, `libpipewire`) — nenhum existe numa imagem Buildroot, e o
binário morre em `error while loading shared libraries: libsndio.so.7`.

O caminho que serve é o **sysroot do próprio Buildroot**, que é a mesma fonte que
gerou a imagem:

```bash
W=~/.cache/giochi-system/work/<device>/build
R=$W/host/aarch64-buildroot-linux-gnu/sysroot

PKG_CONFIG_ALLOW_CROSS=1 \
PKG_CONFIG_SYSROOT_DIR="$R" \
PKG_CONFIG_LIBDIR="$R/usr/lib/pkgconfig:$R/usr/share/pkgconfig" \
CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="$W/host/bin/aarch64-buildroot-linux-gnu-gcc" \
cargo build --release --target aarch64-unknown-linux-gnu \
      --no-default-features --features sdl2-system
```

Isso substitui **quatro** gambiarras que a documentação da engine descreve como
necessárias ao montar sysroot copiando do aparelho:

| O que eles copiam à mão | Por que não é preciso aqui |
| --- | --- |
| `libgcc_s.so.1` | o sysroot do Buildroot já tem |
| `Scrt1.o`/`crti.o`/`crtn.o` | idem — o `rust-lld` não é driver cc, mas o gcc do Buildroot é: ele injeta |
| `--dynamic-linker /lib/ld-linux-aarch64.so.1` | o gcc do toolchain já passa o `--dynamic-linker` correto |
| `libc.so.6`/`libm.so.6` do aparelho (glibc 2.38) | o sysroot é glibc **2.38**, a mesma do aparelho |

A raiz do problema deles é usar o `aarch64-linux-gnu-gcc` **do Ubuntu** (sysroot
glibc 2.35) contra um aparelho com glibc 2.38. Trocar o linker para o do
Buildroot resolve os quatro de uma vez, porque o gcc do Buildroot carrega o
próprio sysroot por padrão.

Verificado nesta árvore: um binário Rust cruzado pelo gcc do Buildroot sai com
`INTERP /lib/ld-linux-aarch64.so.1` e exige no máximo `GLIBC_2.34` — mais baixo
que os 2.38 disponíveis, portanto compatível.

## Ver também

- [`sistema-base.md`](sistema-base.md) — SSH por cabo USB, sistema base.
- [`x55-bringup.md`](x55-bringup.md) — o que foi medido no aparelho.
- [`dependencies-manifest.md`](dependencies-manifest.md) — contrato `forge.json`.
- `AGENTS.md` §11 — a camada de boot e o `giochi-init`.
