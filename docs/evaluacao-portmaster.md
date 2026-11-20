# PortMaster: dá para pôr? quanto custa

> **Veredito curto:** cabe — como **app de loja**, instalado em `/user`, não
> dentro da imagem.
>
> Medido em 20/11/2026 contra o release `2026.11.17-0700` do
> [`PortsMaster/PortMaster-GUI`](https://github.com/PortsMaster/PortMaster-GUI)
> e o registry [`PortsMaster/PortMaster-New`](https://github.com/PortsMaster/PortMaster-New).
>
> | Onde | Custo | Situação |
> | --- | --- | --- |
> | **imagem** | python3 (15–25 MB **estimado**) + 24,6 MB do pacote, em todo aparelho | **bloqueado pela nossa regra de licença** (§4) |
> | **cartão (`/user`)** | 24,6 MB do pacote + **614 MiB** (runtimes "popular") ou **1,87 GiB** ("all") + os jogos | é onde ele deve morar |
> | **engenharia** | 3 peças nossas (pequenas) + 1 no `Giochi app` | §3 |
>
> O que **não** é custo: gráfico, entrada e sistema de arquivos. O nosso
> SDL2/KMSDRM, o controle virtual com GUID estável e o kernel com squashfs +
> loop já são exatamente o que o PortMaster espera — medido no §2.

---

## 1. O que o PortMaster é, medido

| Peça | O que é | Número |
| --- | --- | --- |
| `PortMaster-GUI` | a GUI/loja | **MIT** (`license.spdx_id` da API) |
| `PortMaster.zip` (release) | o pacote que roda no aparelho | **24 642 993 B** (23,5 MiB) |
| `PortMaster/pugwash` | o programa | **3 087 B**, `#!/usr/bin/env python3` → **precisa de python3 no alvo** |
| `pylibs.zip` (embutido) | `requests`, `urllib3`, `certifi`, `idna`, `charset_normalizer`, `loguru`, `ansimarkup`, `colorama`, `fastjsonschema`, `qrcode`, `png.py`, `typing_extensions`, `sdl2` (PySDL2) + tema | Python puro, sem pip |
| `PortMaster-New` (registry) | catálogo de ports | **MIT**, `ports/` com **≥1000** entradas (a API de listagem corta em 1000) |
| runtimes | squashfs baixados sob demanda | `runtimes.popular.aarch64.zip` = **644 376 025 B** (614 MiB); `runtimes.all.aarch64.zip` = **2 007 136 147 B** (1,87 GiB) |

Binários **pré-compilados** que vêm dentro do `PortMaster.zip` (não são compilados
por nós, e é isso que decide o §4):

| Arquivo | Tamanho | Licença |
| --- | --- | --- |
| `7zzs.aarch64` (+ armhf, x86_64) | 3 113 720 B cada | 7-Zip: **LGPL-2.1** + restrição unRAR |
| `gptokeyb2`, `gptokeyb2.aarch64` | 134 408 / 67 824 B | **GPL-2.0** (API do repo `gptokeyb2`) |
| `gptokeyb` (+ variantes) | 68 136 B | de `christianhaitian/gptokeyb` |
| `innoextract.aarch64` | 1 580 472 B | zlib |
| `astcenc.aarch64` | 725 240 B | Apache-2.0 (ARM) |
| `libinterpose.aarch64.so` | 66 384 B | do próprio projeto (MIT) |

Famílias de runtime no registry (contagem do diretório `runtimes/`): 36 `godot`,
26 `frt`, 14 JDKs `zulu`, 8 `pyxel`, `mono` (5 partes), `renpy`, `solarus`,
`qt6-eglfs`, `dotnet` 3.1 e 8.0, `ags`, `mesa_pkg`, `weston_pkg`, `rlvm`,
`python`, `pmjs`. **Não é uma coisa só** — é um catálogo de blobs de terceiros.

## 2. O que o nosso sistema já entrega (medido nos builds em cache)

| Necessidade do PortMaster | Onde medimos | Resultado |
| --- | --- | --- |
| SDL2 para desenhar a GUI | `device/*/defconfig` + imagem | SDL2 + KMSDRM, `SDL_GetCurrentVideoDriver() = kmsdrm` |
| `PYSDL2_DLL_PATH=/usr/lib` | layout do Buildroot | libs em `/usr/lib` ✔ |
| montar runtime `.squashfs` | `.config` do kernel (r35s, x35h) | `CONFIG_SQUASHFS=y`, `CONFIG_BLK_DEV_LOOP=y`, `CONFIG_TMPFS=y` |
| `losetup`, `mount -o loop`, `unzip`, `tar` | `.config` do busybox 1.37.0 | todos `=y` — **nenhum pacote novo** |
| `/dev/uinput` para `gptokeyb` | `CONFIG_INPUT_UINPUT=y` (§29) | presente |
| gamepad previsível | `Giochi Gamepad`, GUID `06005931091200000100000001000000` | mapeamento estável (§29) |
| rede para baixar | `usb0`/Wi-Fi + `requests` (TLS) | precisa de `_ssl` no python |
| raiz para montar/chmod | o sistema roda como root | `ESUDO=""` é caminho suportado (`control.txt`: "No sudo present.") |

Ou seja: **a camada difícil já existe**. O que falta é python3 e três arquivos de
configuração.

## 3. O que falta, peça por peça

### 3.1 python3 — o único custo real de imagem

Não está na imagem: `work/r35s/build/target/usr/bin/python3*` e
`usr/lib/libpython3*` **não existem**; `BR2_PACKAGE_PYTHON3` aparece hoje só como
`BR2_TARGET_UBOOT_NEEDS_PYTHON3` (host).

O Buildroot 2025.02 traz **Python 3.12.9** (`package/python3/python3.mk`). O
`pugwash` declara suporte a 3.7+ (o release baixa wheels `--python-version 3.7`),
então a versão serve. Subopções que o PortMaster precisa, lidas no `Config.in`:

| Símbolo | Por quê |
| --- | --- |
| `BR2_PACKAGE_PYTHON3_SSL` | `requests`/`urllib3` → `https`. Sem ele, `_ssl` e `_hashlib` viram `n/a` |
| `BR2_PACKAGE_PYTHON3_ZLIB` | `zipfile` (o `pylibs.zip` é extraído pelo próprio `pugwash`) |
| `BR2_PACKAGE_PYTHON3_UNICODEDATA` | `idna` (IDNA de domínio) importa `unicodedata`; sem ele o `requests` quebra em host não-ASCII |
| `libffi` | `ctypes` (o `PySDL2` é ctypes puro) — já é dependência automática do pacote |

`BR2_PACKAGE_PYTHON3_BZIP2` e `_XZ` **não** são necessários para o fluxo normal
(`.zip`); só se algum port trouxer `.tar.bz2`.

**Tamanho: 15–25 MB — estimado, não medido.** A conta: `libpython3.12.so`
(~5 MB) + stdlib sem testes (`≈8–12 MB`, e `unicodedata` sozinho ~1 MB) +
módulos. Para virar número, o comando é um só, num `work/` já construído
(acrescentar pacote é seguro, §12.27):

```bash
# depois de BR2_PACKAGE_PYTHON3=y + os três módulos no common.fragment
GIOCHI_SYSTEM_KEEP_WORK=1 bash scripts/build-in-container.sh r35s
du -sh ~/.cache/giochi-system/work/r35s/build/target/usr/lib/python3.12
```

### 3.2 o diretório dos ports: nós não temos `/roms`

`control.txt` fixa `export directory="roms"` → os ports vão para
`/roms/ports/<jogo>`. Nós não temos `/roms`; temos `/user` **já declarado** em
[`pontos-de-montagem`](../device/common/rootfs-overlay/etc/giochi/pontos-de-montagem).

O PortMaster foi desenhado para CFW desconhecida: `pm_launch.txt` e **todo** port
script fazem

```bash
source $controlfolder/control.txt
[ -f "${controlfolder}/mod_${CFW_NAME}.txt" ] && source "${controlfolder}/mod_${CFW_NAME}.txt"
get_controls
```

Então o gancho existe e é oficial: `mod_<CFW>.txt` roda **depois** do
`control.txt` e **antes** de o port calcular `GAMEDIR="/$directory/ports/<jogo>"`.
Um `export directory=user` ali move tudo para `/user/ports` sem patch nenhum.

`CFW_NAME` vem de `OS_NAME` → `NAME` → `ID` do `/etc/os-release`
(`device_info.txt` linhas 107–115). Hoje o nosso `os-release` diz
`NAME=Buildroot` (medido no target do r35s), então o nome do arquivo seria
`mod_Buildroot.txt` — que colide com qualquer imagem Buildroot pura. Melhor:
`OS_NAME=Giochi` no `os-release` (hoje ele está em `/etc/giochi-system-release`,
que o PortMaster **não lê**) e o gancho `mod_Giochi.txt`.

### 3.3 o nome do aparelho mente — e já sabemos disso

`DEVICE_NAME` cai em `/proc/device-tree/model` quando nenhum arquivo conhecido
existe. Esse `model` é **reescrito pelo U-Boot** (§12.30: no X35H sai
`RG353M m`). O PortMaster usa `DEVICE_NAME` para escolher ajuste de
`gamecontrollerdb`, não para decidir se roda — então é cosmético, mas é o mesmo
defeito que já nos custou uma sessão. Um `~/.config/.DEVICE` resolve, e é o
caminho que o próprio `device_info.txt` procura.

### 3.4 o `gamecontrollerdb.txt` deles não chega — e não precisa

`control.txt` exporta **`SDL_GAMECONTROLLERCONFIG_FILE`**, e essa variável
**não funciona** no nosso SDL2 (§29: medido duas vezes, só a de conteúdo vale).
O efeito é o bom: `giochi-init` exporta `SDL_GAMECONTROLLERCONFIG` (conteúdo) e
ela atravessa para os filhos, então a GUI enxerga o **nosso** mapeamento do
`Giochi Gamepad` — `a = BTN_EAST`, a convenção do plástico (§12.74) — em vez do
`a = BTN_SOUTH` que o SDL inventa.

### 3.5 DRM master: quem abre o PortMaster tem de ser o app

KMSDRM é exclusivo. Medido no §12.72: o `kmscube` **falha** com o launcher no ar.
A GUI do PortMaster também abre KMSDRM. Logo, o caminho não é "abrir junto": é o
launcher entregar o display — exatamente o `exec` que o §11 registra como
**não implementado** no `Giochi app`.

Isso não é bloqueio de arquitetura; é ordem de trabalho. Hoje, a alternativa
funcional é o PortMaster ser iniciado **pelo** launcher (que fecha o DRM antes) e
o `giochi-init` não reiniciar nada no meio.

### 3.6 os ports rodam como root e montam squashfs

Exemplo medido (`ports/stardewvalley/StardewValley.sh`): monta
`mono-6.12.0.122-aarch64.squashfs` com `$ESUDO mount`, roda o jogo, desmonta.
Vários fazem `chmod 666 /dev/tty0`, `pidof`/`kill -9` do `gptokeyb` e
`systemctl restart oga_events` (esse último é no-op fora do ArkOS).

Consequência: **não dá para rodar PortMaster como usuário sem privilégio.** Ele
é, por desenho, código de terceiro com root. É o assunto do §5.

### 3.7 uma família de ports exige RetroArch

`ports/2048/2048.sh` (medido) não roda o jogo: chama
`retroarch -L 2048_libretro.so.<arch>`. O `port.json` dele diz
`"runtime": null` — quem declara a dependência é o **script**, não o metadado.
Então "instalar o PortMaster" não entrega todos os ports: a família libretro
precisa de um RetroArch na imagem (GPL-3.0, §4) ou de um runtime próprio.

## 4. O bloqueio que decide: licença

A regra do projeto ([§15](../AGENTS.md) e
[`evaluacao-quiver-launcher.md`](evaluacao-quiver-launcher.md)): **GPL, AGPL e
LGPL ficam fora da imagem assinada.**

O `PortMaster.zip` traz **`gptokeyb2` (GPL-2.0)** e **7-Zip (LGPL-2.1 + unRAR)**.
Não são opcionais de verdade: o `gptokeyb2` é o que traduz gamepad em teclado nos
ports que precisam, e o `7zzs` extrai `.7z`. (Módulo de kernel GPL é caso à
parte: o kernel já é GPL-2.0 — a regra é sobre o *userspace* da imagem.)

Isso **não** bloqueia o caminho de app de loja: é o usuário que baixa, como
qualquer outro programa. Bloqueia **embarcar** o pacote no rootfs.

Se um dia for preciso embarcar, a saída é a mesma do `libmali`
([`gpu-drivers.md`](gpu-drivers.md) §4.2): **pela loja**, nunca na imagem base —
e o artefato de CI é público, então a pergunta de redistribuição é nossa.

## 5. O segundo bloqueio: o modelo de confiança é o oposto do nosso

O nosso contrato de loja são **duas chaves** (§12.41): uma diz "veio da Giochi",
a outra "este aparelho pagou". O PortMaster baixa `.zip` **sem assinatura** de
um repositório público e executa o `.sh` de dentro **como root** — sem chave, sem
hash publicado por nós, sem revisão.

Se ele entrar, entra como **sideload explícito**: o usuário instala o app, o app
instala o que quiser em `/user/ports`, e o sistema **não** endossa. O que não
pode acontecer é isso virar invisível: o launcher precisa marcar esses jogos como
"não assinados" (é o mesmo campo que a loja já usa), e o
`/etc/giochi/pontos-de-montagem` já deixa `/user` fora da inferência do disco do
sistema.

## 6. Três caminhos, com preço

### A. PortMaster como app de loja em `/user` — **recomendado**

| Item | Custo |
| --- | --- |
| imagem | **0 MB** |
| cartão | 24,6 MB + 614 MiB (popular) ou 1,87 GiB (all) + jogos |
| nosso código | `mod_Giochi.txt` (~10 linhas), `PortMaster.sh` stub, `OS_NAME=Giochi` no os-release |
| `Giochi app` | enumerar `/user/ports/*.sh` e lançar (pedido deles); fechar o DRM antes |
| licença | ok — nada GPL na imagem |
| segurança | sideload declarado (§5) |

O runtime python pode vir como **payload do app** (a loja já tem o conceito de
`runtime` no `forge.json`: `godot | retroarch | proton` — um `python` entraria
como o quarto). Aí a imagem continua sem python3 e só quem instala paga.

### B. Embarcar a GUI na imagem

| Item | Custo |
| --- | --- |
| imagem | 24,6 MB do pacote (dá para cortar ~6 MB removendo os 7z de armhf/x86_64) **+ python3**: 15–25 MB estimado |
| licença | **bloqueado** (§4) |
| ganho | o PortMaster está lá sem depender da loja |

### C. Não fazer

Válido, e é o estado atual. O custo de C é a funcionalidade, não o risco — e é
por isso que este documento existe: para a decisão ser tomada com os números, não
com "parece legal".

## 7. O que NÃO está medido

1. **O tamanho do python3** — 15–25 MB é estimativa com a conta aberta no §3.1.
   O comando para medir está lá.
2. **Se o PortMaster sobe numa CFW desconhecida.** Lido no código: `CFW_NAME`
   vira `Buildroot`, `param_device` fica vazio, `DEVICE` fica vazio e ele copia o
   `gamecontrollerdb.txt` inteiro — nada aborta. Mas **ler não é rodar**: o teste
   é extrair o `PortMaster.zip` em `/user` num aparelho e chamar `./pugwash`.
3. **RetroArch** não está na imagem, e uma família de ports depende dele (§3.7).
4. **Desempenho real** — o R35S tem 1 GB; o `box64`+jogo é o cenário mais pesado
   do catálogo, e nada disso foi medido aqui.
5. **A partição de dados** (`/user`) **não existe** ainda (§18, item 3). O
   caminho A depende dela para ser mais que um punhado de MB no rootfs.

## 8. Se for para frente: a ordem barata

1. **10 minutos, zero build:** extrair `PortMaster.zip` em `/user/ports` no
   aparelho que estiver livre, com um `mod_Buildroot.txt` de 3 linhas, e chamar
   `./pugwash`. Isso responde o §7.2 e o §7.3 sem tocar na imagem.
2. **Só então** medir o python3 (§3.1) — se o passo 1 já funcionar com o python
   de um runtime da loja, a imagem não paga nada.
3. A decisão de produto (loja x imagem) fica com o dono do projeto; o que este
   documento entrega é o preço de cada lado.
