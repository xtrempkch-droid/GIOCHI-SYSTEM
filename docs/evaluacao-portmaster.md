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
> | **imagem** | **22,9 MiB medidos** (python3 + bubblewrap) — e **nada** do pacote | é o `GIOCHI_WITH_PORTMASTER=1`, opt-in (§3.1) |
> | **cartão (`/user`)** | 24,6 MB do pacote + **614 MiB** (runtimes "popular") ou **1,87 GiB** ("all") + os jogos | é onde ele deve morar |
> | **engenharia** | 3 peças nossas (pequenas) + 1 no `Giochi app` | §3 |
>
> O que **não** é custo: gráfico, entrada e sistema de arquivos. O nosso
> SDL2/KMSDRM, o controle virtual com GUID estável e o kernel com squashfs +
> loop já são exatamente o que o PortMaster espera — medido no §2.
>
> **O pacote continua bloqueado pela nossa regra de licença** (`gptokeyb2`
> GPL-2.0, `7zzs` LGPL-2.1): o que a imagem ganha é o **runtime** (python3 +
> bubblewrap), opt-in por `GIOCHI_WITH_PORTMASTER=1`; o pacote é instalado em
> `/user` pelo usuário ou pela loja.

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

**Tamanho: 22,9 MiB — MEDIDO** em 20/11/2026 no build do r35s:

| Peça | Tamanho |
| --- | --- |
| `usr/lib/python3.12/` (stdlib em `.pyc`) | 15,4 MiB |
| `usr/lib/libpython3.12.so.1.0` | 7,1 MiB |
| `usr/bin/python3.12` | 8,7 KiB |
| `usr/bin/bwrap` + `libcap` | 144 KiB |
| `libffi`, `liblzma`, `libexpat` | ~0,4 MiB |

**Dois módulos que a estimativa não previa**, e os dois só apareceram rodando:

| Símbolo | Sem ele |
| --- | --- |
| `BR2_PACKAGE_PYTHON3_PYEXPAT` | `ModuleNotFoundError: No module named 'xml'` no import do `harbourmaster/util/proxy.py` — a GUI **não abre** |
| `BR2_PACKAGE_PYTHON3_XZ` | `unable to extract the Noto fonts: lzma module is not available` — aviso, e as fontes CJK não entram |

`BR2_PACKAGE_PYTHON3_BZIP2` fica de fora: o único uso é o sink de log `.bz2` do
`loguru` (`_file_sink.py`), que este fluxo nunca escolhe.

### 3.2 o diretório dos ports: `/roms` → `/user` (medido, e o `mod` NÃO resolve)

`control.txt` fixa `export directory="roms"` → os ports vão para
`/roms/ports/<jogo>`. Nós não temos `/roms`; temos `/user` **já declarado** em
[`pontos-de-montagem`](../device/common/rootfs-overlay/etc/giochi/pontos-de-montagem).

A primeira proposta foi um `mod_<CFW>.txt` com `export directory=user`. **A
medição derrubou essa ideia, por duas razões independentes:**

1. **O `control.txt` recalcula `controlfolder` antes de o mod rodar.** Ele tem
   uma cadeia fixa (`/PortMaster`, `/opt/system/Tools/PortMaster`,
   `/opt/tools/PortMaster`, senão `/$directory/ports/PortMaster`) e **ignora a
   variável que o stub passou**. Como ele usa `$directory` *antes* de o mod ser
   carregado, mudar `directory` no mod não muda `controlfolder`.
2. **28% dos ports citam `/roms/` literalmente.** Medido numa amostra de 25
   ports do registry (20/11/2026): **7 com `/roms/` literal** e **7 com
   `$directory`**. Reescrever `directory` conserta metade e deixa a outra metade
   apontando para um caminho que não existe.

O que funciona é **um symlink**: `/roms` → `/user`. Ele conserta os dois grupos,
porque `/$directory/ports` e `/roms/ports` passam a ser o mesmo inode. O
`directory` fica `roms`, que é o default deles e o que menos surpreende código
de terceiro.

Medido no R35S em 20/11/2026, com o symlink e `OS_NAME=Giochi`:

```text
CFW_NAME      = [Giochi]                    (era "Buildroot")
controlfolder = [/roms/ports/PortMaster]    (o symlink resolve)
directory     = [roms]
funcs.txt carregado? pm_finish=[function]   (sem o symlink, falhava em SILÊNCIO)
device_info carregado? PM_VERSION, capabilities
```

Sem o symlink, o `control.txt` falha com `No such file or directory` ao carregar
`device_info.txt` e `funcs.txt` **e continua** — os ports ficam sem
`pm_finish`/`pm_message`, e o sintoma é "o jogo abre e não volta".

O `mod_Giochi.txt` continua existindo, mas para o que é **nosso** (marcar a CFW,
exportar ambiente), nunca para reescrever caminho.

### 3.2-A `OS_NAME` no `os-release` é o que faz a CFW ser reconhecida

O `device_info.txt` resolve o nome por `OS_NAME` → `NAME` → `ID`. O
`/etc/os-release` do Buildroot diz `NAME=Buildroot`, então sem correção o
`CFW_NAME` sai **`Buildroot`** — um nome que colide com qualquer imagem
Buildroot do mundo, e que faz o `source mod_${CFW_NAME}.txt` procurar o arquivo
errado.

O Buildroot **sempre** regrava `/usr/lib/os-release` em `target-finalize`
(`Makefile`, linha 773 no 2025.02), então um arquivo no overlay seria
sobrescrito. O post-build roda **depois** (linha 808) e é lá que se escreve.

E há o efeito colateral que prova o mecanismo: o `harbourmaster` do PortMaster
**detecta o aparelho** por esse nome. Medido no R35S com a imagem de teste:

```text
{'name': 'giochi', 'version': '2025.02', 'kernel_version': '6.12.0',
 'device': 'game console r36s', 'model': 'Game Console R36S',
 'resolution': (640, 480), 'refresh_rate': 60, 'gpu_driver': 'panfrost',
 'glibc': '2.41', 'ram': 1024,
 'capabilities': ['1gb', '4:3', '640x480', 'aarch64', 'analog_0', 'analog_1',
                  'analog_2', 'power', 'restore', 'rumble', 'en_US']}
```

Ou seja: ele **não** recusou o aparelho desconhecido. Ele o classificou, com GPU,
RAM e resolução corretas.

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

### 3.6 o sandbox: `bubblewrap`, medido no aparelho

Os ports rodam como root e montam squashfs (`$ESUDO mount mono-….squashfs`), e
o código é de terceiro, baixado **sem assinatura**. A resposta não é confiar:
é cercar. `giochi-ports` (no overlay comum) executa o `pugwash` sob `bwrap`;
sem `bwrap` ele **recusa** rodar, a menos que se peça `--sem-sandbox`.

Medido no R35S em 20/11/2026, com o kernel desta árvore (6.12, `CONFIG_USER_NS=y`):

| Teste | Resultado |
| --- | --- |
| escrever no rootfs (`/usr/bin/racunho`) | `Read-only file system` — **bloqueado** |
| escrever em `/user/ports/` | **OK** |
| processos visíveis de dentro | **5** (de ~40 fora do namespace) |
| o launcher aparece de dentro? | **não** |
| rede | compartilhada (`--share-net`), 2 interfaces |
| `/roms` → `/user` de dentro | visível e correto |

E a GUI rodou **dentro** do sandbox: `harbourmaster` detectou o aparelho, e a
captura do `debugfs` do DRM mostra o processo como master e dono de dois
framebuffers:

```text
             command  tgid dev master a
             python3  4564   0   y    y

    allocated by = python3   refcount=2
    allocated by = python3   refcount=1
```

**O que o sandbox NÃO dá**, e está escrito no cabeçalho do script para não virar
promessa:

- **privacidade de dados**: `/user` é gravável e é onde ficam os jogos;
- **contenção de recursos**: não há cgroup nem limite de CPU/RAM;
- **drop de privilégio**: o sistema roda como root e o `bwrap` mapeia o uid; o
  ganho é não alcançar o que está fora das montagens, não virar usuário comum.

E um custo de operação que apareceu no teste: **dois `giochi-init` ao mesmo tempo
sobem dois launchers disputando o DRM**, o segundo falha cinco vezes e o
supervisor desiste — regravando o marcador de parada. Não suba o `giochi-init`
à mão com o `respawn` do inittab ativo; para pegar o DRM use
`/run/giochi/dev-free-console`, que existe exatamente para isso.

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
| imagem | **22,9 MiB** (python3 + bwrap) se ligar `GIOCHI_WITH_PORTMASTER=1`; **0 MB** se o python vier como payload do app |
| cartão | 24,6 MB + 614 MiB (popular) ou 1,87 GiB (all) + jogos |
| nosso código | `giochi-ports` (~180 linhas), `OS_NAME=Giochi` no post-build, `/roms` → `/user`, `config/portmaster.fragment`, gate do `python3-dirclean` |
| `Giochi app` | enumerar `/user/ports/*.sh`, lançar, e **fechar o DRM antes** (o `exec` do §11) |
| licença | ok — nada GPL na imagem |
| segurança | sideload declarado (§5) |

O runtime python pode vir como **payload do app** (a loja já tem o conceito de
`runtime` no `forge.json`: `godot | retroarch | proton` — um `python` entraria
como o quarto). Aí a imagem continua sem python3 e só quem instala paga.

### B. Embarcar a GUI na imagem

| Item | Custo |
| --- | --- |
| imagem | 24,6 MB do pacote (dá para cortar ~6 MB removendo os 7z de armhf/x86_64) **+ 22,9 MiB** de python3/bwrap **medidos** |
| licença | **bloqueado** (§4) |
| ganho | o PortMaster está lá sem depender da loja |

### C. Não fazer

Válido, e é o estado atual. O custo de C é a funcionalidade, não o risco — e é
por isso que este documento existe: para a decisão ser tomada com os números, não
com "parece legal".

## 7. O que foi MEDIDO em 20/11/2026, no R35S

Tudo abaixo é do aparelho, com a imagem `commit=e0d74e6` mais o runtime
instalado à mão em `/user/opt` — não é leitura de código.

| Verificação | Resultado |
| --- | --- |
| `python3` 3.12.9 com `ssl`, `zlib`, `ctypes`, `unicodedata`, `xml`, `lzma` | **roda** |
| `bwrap` 0.11.0 | **roda**, rootfs read-only, `/user` gravável, 5 processos visíveis |
| `control.txt` com `/roms` → `/user` e `OS_NAME=Giochi` | `CFW_NAME=Giochi`, `funcs.txt` carregado |
| `pugwash` detecta o aparelho | `device: game console r36s`, `gpu_driver: panfrost`, `glibc: 2.41` |
| GUI no KMSDRM | **DRM master + 2 framebuffers alocados** (debugfs) |
| GUI dentro do `bwrap` | idem, com o rootfs congelado |
| `giochi-selftest` | `PASS 42 · WARN 1 · FAIL 0 · SKIP 3`, com o bloco novo de ports |

## 7-A. O que continua NÃO medido

1. **Um port de verdade instalado e jogado.** O que rodou foi a **GUI** e a
   detecção; baixar um port depende de DNS no aparelho (o teste usou o `zip`
   enviado por `scp`). O `giochi-ports --version` imprime a detecção e sai — é
   um smoke test, não uma partida.
2. **A instalação pela GUI com rede.** O aparelho não tinha DNS configurado; a
   GUI anunciou `No internet connection found, running in offline mode`.
3. **RetroArch**, de que a família libretro depende (§3.7). GPL-3.0, fora da
   imagem — teria de vir pela loja.
4. **Desempenho de `box64`/wine** num aparelho de 1 GB: o cenário mais pesado do
   catálogo, e nada disso foi exercitado.
5. **A partição de dados** (`/user`) não existe: hoje `/user` é um diretório no
   rootfs, criado pelo post-build (§18, item 3).
6. **O `exec` do launcher** — sem ele, abrir o PortMaster exige o launcher sair
   antes. Foi assim que o teste obteve o DRM master.

## 8. Como repetir o teste (o que foi feito, na ordem)

O caminho que funcionou, sem reflashar imagem — e é o que serve para o próximo
aparelho:

1. **Runtime fora do rootfs.** Compile `python3` + `bubblewrap` no `work/` do
   aparelho e copie para `/user/opt`. É o que permite testar sem rebuild de 2 h.
   ```bash
   GIOCHI_WITH_PORTMASTER=1 docker run ... make python3 bubblewrap
   scp <runtime>.tgz root@10.55.0.2:/tmp/
   ```
2. **`/roms` → `/user`** e **`OS_NAME=Giochi`** no `/etc/os-release` do aparelho
   (o post-build da imagem final fará os dois).
3. **O pacote**: baixar `PortMaster.zip` no PC e `scp` (o aparelho de teste não
   tinha DNS), extrair em `/user/ports`.
4. **Provar o vídeo** com o DRM livre. O caminho **seguro** é
   `touch /run/giochi/dev-free-console` e reiniciar o launcher; o caminho que
   usei (matar o launcher) funciona e deixa o marcador de desistência, que o
   `giochi-init` passou a limpar numa arrancada nova.

O que o teste **provou**: o PortMaster 2026.11.17 roda, identifica o aparelho e
desenha, com o rootfs congelado. O que **não** provou: um port baixado e jogado.

## 9. O que falta, e é do `Giochi app`

Só uma peça: o launcher precisa **sair** (ou fazer `exec`) antes de abrir o
PortMaster, porque o KMSDRM é exclusivo — medido duas vezes, no `kmscube`
(§12.72) e aqui. Sem isso, `giochi-ports` responde `kmsdrm not available` e a
tela não muda.

A ordem que funciona hoje, e não exige código novo do app:

```text
giochi-init → launcher (DRM) → usuário escolhe "Ports"
           → launcher SAI → giochi-ports (DRM) → GUI
           → GUI sai → ::respawn: sobe o launcher de novo
```

O `::respawn:` do inittab já devolve o launcher quando o `giochi-ports` termina.
É o mesmo ciclo que o `giochi-godot` usa (§ godot.fragment).
