# AGENTS.md — Giochi System

> Handoff técnico do repositório. Leia antes de continuar o trabalho.
> Atualizado em: 03/11/2026 (revisão 4 — **o X55 bootou**: sistema instalado por
> serial + U-Boot, login na console, tela 720x1280 ativa. Ver
> `docs/x55-bringup.md` para o registro medido.)

---

## 1. O que este repositório é

O **Giochi System** produz o Linux limpo de cada aparelho: kernel, rootfs, boot,
drivers, painel e a camada de inicialização. **Sem UI e sem loja** — a interface é
do `Giochi app`, e a junção dos dois é o `Giochi os`.

```text
Giochi System ──imagem por aparelho──▶ Giochi os ◀──pacotes .giochi── Giochi app
```

Cada pasta é **repositório Git individual**. Não há import de código entre eles:
a comunicação é sempre por **artefato declarado explicitamente**.

## 2. Localização

```text
C:\Users\Jussara dias\Desktop\plataforma sistema\
├── Giochi system\    ← este (repo GIOCHI-SYSTEM)
├── Giochi app\       ← repo GIOCHI-APP
└── Giochi os\        ← repo GIOCHI-OS
```

Repositório: `https://github.com/xtrempkch-droid/GIOCHI-SYSTEM` — branch `main`.

> A revisão anterior deste documento apontava `Desktop\Giochi System`. O projeto
> foi movido para dentro de `plataforma sistema\` e os três repos passaram a ser
> inicializados no Git.

## 3. Estado atual

### Concluído e verificado

- Estrutura de repositório, `.gitignore`, `.gitattributes`, licença MIT.
- `device/devices.json` como fonte da verdade da lista **e** da matriz de CI.
- `device.json` por aparelho, validado por schema em `scripts/lib/devices.mjs`.
- 6 aparelhos registrados: `qemu-aarch64` (único habilitado) + 5 drafts.
- Buildroot fixado em **2024.02** (`buildroot.version`).
- Pipeline: `build-device.sh` → `prepare-config.mjs` → `olddefconfig` →
  `assert-config.mjs` → `make` → artefatos + `SHA256SUMS`.
- `assert-config` fechando a falha silenciosa do `olddefconfig` (§12.1).
- ccache no build e no CI, com `BR2_CCACHE_USE_BASEDIR=y` (§12.2).
- Monitor de disco contra cópia recursiva (§12.3).
- Workflows: `build-linux-arm64.yml` (matriz + build) e `validate.yml`.
- Leitura de **device tree**: `scripts/lib/fdt.mjs` + `dtb-inspect`, `dtb-buttons`,
  `dtb-catalog` — sem `dtc`, em Node puro.
- Catálogo de 15 aparelhos RK3326 extraído dos DTBs do ROCKNIX
  (`docs/rk3326-catalog.md` + `.json`).
- `buttons.map` por aparelho, gerado do DTB (`device/*/buttons.map`).
- Camada de boot ligada: `scripts/post-build.sh` acrescenta
  `::respawn:/usr/bin/giochi-init` ao `/etc/inittab` **quando há launcher**
  (`/opt/giochi/apps/launcher/bin/giochi-launcher`) ou o marcador
  `/etc/giochi/boot-layer`. Verificado no rootfs real do X35H.
- **Sistema base** definido: SSH por cabo USB em todos os aparelhos — gadget
  RNDIS + `udhcpd` (PC recebe `10.55.0.1`, aparelho em `10.55.0.2`), OpenSSH com
  `PermitRootLogin yes` e `UseDNS no`, `config/common.busybox.fragment` com
  `udhcpd`/`nc`/`vi`/`ip`/`dmesg`. Ver [`docs/sistema-base.md`](docs/sistema-base.md).
- **X35H definido**: DTS que herda o da X55, painel ST7703 no driver mainline,
  sem rádio, `S96bootlog` gravando diagnóstico na FAT do cartão. Compila e gera
  imagem; **não bootou em hardware**.
- Documentação em `docs/` (12 páginas) + template de issue para aparelho novo.

### Verificado nesta sessão de retomada

| Verificação | Resultado |
| --- | --- |
| `node tests/run-all.mjs` | **36/36** (13 devices + 12 assert-config + 11 fdt) |
| `node scripts/validate-devices.mjs` | OK — 6 devices, 1 habilitado |
| `node scripts/list-devices.mjs --github-matrix` | matriz com `qemu-aarch64` |
| matriz com `--device powkiddy-x55 --allow-draft` | devolve **só** o X55 |
| matriz com `device=all --allow-draft` | **não** puxa rascunho (só `qemu-aarch64`) |
| `bash -n scripts/build-device.sh` | **exit 0** (primeira vez que rodou) |
| `bash -n` em `Giochi app/scripts/migrar-do-antecessor.sh` | exit 0 |
| `sh -n` em `giochi-init`, `giochi-selftest`, `profile.d/giochi-system.sh` | exit 0 |
| Final de linha dos 5 scripts | LF puro, zero CRLF |
| `prepare-config.mjs` com `.config` falso + fragmentos reais | OK: hostname, issue, senha, `BR2_DL_DIR`, `BR2_CCACHE*`, `EXT2_SIZE`, `HOST_QEMU` desligado, overlays anexados ao existente |
| `prepare-config.mjs --kernel-fragment` | emite `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` com caminho absoluto |
| `assert-config.mjs` sobre o mesmo par | OK — 21 símbolos de 2 fragmentos |
| `giochi-selftest` executado num `sh` real | roda de ponta a ponta: PASS 2 · WARN 10 · FAIL 7 · SKIP 3, exit 1 |
| `giochi-init` com launcher falso (sai 7) | 6 reinícios e para, como desenhado |
| `giochi-init` com launcher ausente | espera em vez de sair (antes saía em 99 ms) |
| Workflows YAML | válidos (parse com PyYAML) |

**O que isso NÃO prova:** `bash -n` valida sintaxe, não comportamento. O
`sh` do Git for Windows é o bash em modo POSIX, **não** o busybox ash da imagem —
compatibilidade com ash continua não provada. O build de verdade só o CI prova.

### O X55 BOOTOU (03/11/2026)

Primeiro boot real do projeto em hardware. Registro completo com evidências em
[`docs/x55-bringup.md`](docs/x55-bringup.md). Resumo:

```text
Giochi System 6.12.0 (/dev/console)
giochi-system-x55 login:
```

`giochi-selftest` evoluiu com as correções, medido no mesmo aparelho:

| Estado | Resultado |
| --- | --- |
| primeira imagem que bootou | PASS 15 · WARN 5 · **FAIL 1** · SKIP 2 |
| + patch de DTS + amplificador `=y` | PASS 17 · WARN 4 · **FAIL 0** · SKIP 2 |
| + `S15modules` (autoload) | PASS 18 · WARN 3 · FAIL 0 · SKIP 2 |
| + `CONFIG_JOYSTICK_ADC` + patch 0002 (BTN_MODE) | PASS 20 · WARN 3 · FAIL 0 · SKIP 2 |
| + `Playback Mux` via `alsactl` | **PASS 21 · WARN 3 · FAIL 0 · SKIP 1** |

O que passou e é o que importa para "sair do console":

- painel HX8394: `card0-DSI-1: connected 720x1280`, backlight `833/1666`;
- `/dev/dri/card0` + render node (`panfrost`), driver `rockchip-drm`;
- rootfs em `/dev/root` no cartão, console `ttyS2`;
- **`wlan0` com MAC real** e `iw scan` devolvendo redes (`Kill.exe`, -24 dBm);
- **Bluetooth funcionando**: `hci0` com MAC `A8:4F:A4:C9:98:4C`, firmware
  `0x75b8f098`, scan encontrando o host e outros dispositivos, ligado no boot;
- áudio: `0 [rk817ext]: simple-card - rk817_ext`;
- `hwrng: rockchip-rng`;
- **16 botões de gamepad** que existem fisicamente (`gpio-keys-control`) — o DTS
  declara **17**, mas o `F`/`BTN_MODE` (`gpio3 PB7`, patch 0002) **não existe** no
  gabarito desta revisão (§12.22);
- **4 eixos analógicos** (`adc-joystick`, ABS_X/Y/RX/RY) — exige `CONFIG_JOYSTICK_ADC`;
- `gpio-keys-vol` e `/etc/giochi/buttons.map` (31 linhas);
- **console rotacionado** para paisagem: `160x45` com `fbcon/rotate=3`;
- bateria `40C`, UDC `fcc00000.usb`.

As três falhas fechadas, cada uma com causa medida:

| Sintoma | Causa | Correção |
| --- | --- | --- |
| `--- no soundcards ---` | card `rk817_ext` usa `aux-devs = <&spk_amp>`; `SND_SOC_SIMPLE_AMPLIFIER` estava `=m` e não carrega sem autoload | `=y` no `linux.fragment` |
| `sem hwrng` | `rng@fe388000` nasce `disabled` no `rk356x.dtsi` | `&rng { status = "okay" }` no patch de DTS |
| `nenhuma interface além de lo` | módulos `=m` e o rootfs não tem `/etc/modules` nem `modules-load` | `rootfs-overlay/etc/init.d/S15modules` |
| sem `adc-joystick` | nó do DTS sem driver: `CONFIG_JOYSTICK_ADC` não estava ligado | `=y` no `linux.fragment` + `kernel-required.txt` |

Ganho colateral medido: `random: crng init done` em **0,53 s** (era tarde o
bastante para o `sshd` esperar ~11,7 s no primeiro build). O kernel chega ao
userspace com entropia pronta.

### Avisos de boot que NÃO são defeito

| Mensagem | Por quê |
| --- | --- |
| `mmc0: Failed to initialize a non-removable card` | `mmc0` é o slot de eMMC; **este aparelho não tem eMMC** |
| `rtw_8821cs … sdio read32 failed (0xf0): -110` | probe antes do rádio estabilizar; a linha seguinte já é `Firmware version 24.11.0` |
| `rtw_8821cs … sdio write8 failed (0x1c): -110` | idem, mesmo instante |
| `Card did not respond to voltage select! : -110` (U-Boot) | `mmc2`, eMMC inexistente |

Só é falha se `wlan0` não aparecer ou `iw dev wlan0 link` ficar vazio.

### Instalação remota sem tirar o cartão

O cartão do aparelho não estava no leitor do PC. Caminho usado, e que funciona:

1. `loady <addr>` + YMODEM (`docker/ymodem-send.py`) — validado com CRC32
   conferido dos dois lados;
2. `mmc write` para o MBR;
3. `gzwrite mmc 1 <addr> ${filesize} <wbuf> <offset>` para FAT e rootfs em gzip.

Fato que confunde: **parar o container não interrompe a gravação** — quem executa
`gzwrite` é o U-Boot, não o host.

Tamanhos com `gzip -1`: rootfs 1 GiB → 52 MB; FAT de boot 256 MiB → 17 MB.

### Pendente de verdade

**Estado do CI no fim desta sessão (18 execuções do build):**

| Run | O quê | Resultado |
| --- | --- | --- |
| #15 | push, `qemu-aarch64` | **sucesso** — 22 min 45 s, artefato publicado |
| #16 | push, `qemu-aarch64` | **cancelado** pelo push seguinte (rodava com cache quente) |
| #17 | dispatch, `powkiddy-x55` | **falhou em 1 s** no `discover` — bug do `allow_draft`, corrigido em `d9e81aa` (§12.5) |
| #18 | push `d9e81aa`, `qemu-aarch64` | em andamento no fim da sessão |

- **X55 nunca compilou.** A primeira tentativa morreu antes de compilar (bug do
  `allow_draft`, não do aparelho). Falta reenviar o dispatch com
  `device=powkiddy-x55` e `allow_draft=true`.
- **ccache ainda sem prova de acerto**: o run #15 salvou o cache pela primeira
  vez, e o #16 — que provaria — foi cancelado. O #18 repete o teste.
- **O X55 ainda não tem `rocknix-joypad`, patches de DTS, `rtl8821cs_config.bin`
  nem `genimage`.** É código e layout, não configuração. Ver
  `device/powkiddy x55/README.md`.
- `/etc/inittab` **não** tem a linha de `respawn` do `giochi-init`: o script está
  no rootfs e ninguém o chama (§11).
- `giochi-controllers` (configurador de controles) não existe: só o desenho, em
  `Giochi app/docs/controles.md`.
- `buildrootFragments`, `kernelPatches` e `firmwareFiles` estão **documentados**
  em `device/README.md` mas não são lidos por nenhum script.
- Nenhum aparelho real boota com esta árvore. X35S, X35H, R35S e Steam Deck são
  drafts sem defconfig.
- SHA256 do tarball do Buildroot não é fixado/verificado.
- Sem GitHub Release; artefatos expiram em 14 dias.
- Sem assinatura de imagem, OTA ou atualização.

## 4. Ambiente — o que dá e o que não dá para verificar

Máquina: Windows. Nada de Linux nativo.

| Ferramenta | Estado | Consequência |
| --- | --- | --- |
| `node` | **disponível** — runtime do DSH (v24.21.0) | scripts e testes rodam |
| `git` | **disponível** em `C:\Program Files\Git\cmd\git.exe`, **fora do PATH** | repos existem, commits e push funcionam |
| `bash` / `sh` | **disponível** em `C:\Program Files\Git\{bin,usr\bin}` | `bash -n` e execução de POSIX sh funcionam |
| `WSL` | instalado, **sem distro** | não há Linux de verdade |
| `rustc` / `cargo` | ausente | nada do launcher Rust compila aqui |
| Buildroot / `make` de kernel | ausente | **o build só roda no CI** |

**Detalhe que custa tempo:** o `bash` do Git for Windows falha com
`couldn't create signal pipe, Win32 error 5` quando o sandbox está confinado.
Ele só roda com o sandbox liberado. Não é bug do script.

Chamadas úteis:

```powershell
& "C:\Program Files\Git\cmd\git.exe" status
& "C:\Program Files\Git\bin\bash.exe" -n scripts/build-device.sh
```

## 5. Estrutura de arquivos

```text
Giochi system/
├── buildroot.version                  # 2024.02
├── buildroot.sha256                   # hash do tarball, conferido no build
├── config/common.fragment             # pacotes e opções comuns a todos os aparelhos
├── device/
│   ├── devices.json                   # fonte da verdade: id, folder, arch, enabled
│   ├── README.md                      # modelo de device e camada de drivers
│   ├── common/rootfs-overlay/
│   │   ├── etc/…                      # issue, motd, release, profile.d
│   │   ├── etc/init.d/S96bootlog      # log no cartão; só roda com marcador
│   │   └── usr/bin/
│   │       ├── giochi-init            # mantém o launcher vivo; restaura brilho
│   │       ├── giochi-selftest        # diagnóstico do aparelho até o render 3D
│   │       └── giochi-buttons         # evdev → nome lógico do buttons.map
│   ├── qemu-aarch64/                  # device de referência (habilitado)
│   ├── powkiddy x55/                  # RK3566 — draft
│   │   ├── defconfig                  # base Buildroot (o que bootou no antecessor)
│   │   ├── patches/                   # DTS: HDMI off, SDIO, uart1 DMA, &rng
│   │   ├── kernel-required.txt        # símbolos que o kernel PRECISA ter
│   │   ├── busybox.fragment           # desliga o applet tc (não compila no 6.12)
│   │   ├── device.json, buildroot.fragment, linux.fragment, buttons.map
│   │   └── README.md, rootfs-overlay/
│   ├── powkiddy x35s/                 # RK3566 — draft (irmão do X35H)
│   ├── powkiddy x35h/                 # RK3566 — draft, painel 640x480 ST7703
│   │   ├── patches/0001-…-dts.patch   # DTS que HERDA o da X55
│   │   ├── patches/0002-…-st7703.patch # painel no driver mainline
│   │   └── rootfs-overlay/etc/giochi/boot-log  # liga o S96bootlog
│   ├── r35s/                          # RK3326 — draft, com dts/*.dtb real
│   │   └── dts/rk3326-gameconsole-r36s.dtb
│   ├── steamdeck/                     # x86_64 — draft
│   └── _template/
├── docs/
│   ├── README.md, architecture.md, adding-a-device.md, building-locally.md
│   ├── github-actions.md, flashing.md, troubleshooting.md, security.md
│   ├── package-overrides.mk           # override de pacote do Buildroot (strace)
│   ├── dependencies-manifest.md       # contrato forge.json com o Giochi app
│   ├── button-maps.md                 # mapa evdev por aparelho, a partir do DTS
│   ├── rk3326-catalog.md / .json      # 15 aparelhos extraídos de DTB
│   └── giochi-init.md                 # o que falta para a camada de boot
├── scripts/
│   ├── build-device.sh                # build completo de um device
│   ├── prepare-config.mjs             # mescla fragmentos + hostname/issue/senha
│   ├── assert-config.mjs              # falha se símbolo pedido sumiu (núcleo em lib/)
│   ├── validate-devices.mjs, list-devices.mjs, device-info.mjs
│   ├── dtb-inspect.mjs, dtb-buttons.mjs, dtb-catalog.mjs
│   ├── check-host.sh                   # pré-voo: dependências, disco, hash
│   ├── build-in-container.sh           # build sem root no host (docker)
│   ├── make-sd-image.sh                # imagem de cartão com offsets do RK3566
│   ├── flash-sd.sh                     # grava com guarda de destino + SHA256
│   ├── assert-kernel-config.mjs         # CONFIG_* do kernel (o gap do §12.9)
│   └── lib/{devices,assert-config,assert-kernel-config,fdt}.mjs
├── docker/{builder,serial,serial-logger}.Dockerfile + scripts de serial
├── tests/{devices,assert-config,assert-kernel-config,fdt,prepare-config,buildroot-hash}.test.mjs + run-all.mjs
├── .github/
│   ├── workflows/{build-linux-arm64,validate}.yml
│   └── ISSUE_TEMPLATE/novo-aparelho.yml
├── package.json, Makefile, README.md, AGENTS.md, CONTRIBUTING.md,
│   SECURITY.md, LICENSE, .gitignore, .gitattributes, .editorconfig
```

## 6. Modelo de dispositivo

### Índice: `device/devices.json`

```json
{ "id": "qemu-aarch64", "folder": "qemu-aarch64", "arch": "arm64", "enabled": true }
```

- `id` — slug (`a-z`, `0-9`, `-`); é o nome no build, no artefato e no CI.
- `folder` — a pasta real; **pode conter espaços** (`powkiddy x55`).
- `arch` — precisa coincidir com o `device.json`.
- `enabled` — só entra na matriz se `true`, `status: ready` **e** tiver defconfig.

### `device/<pasta>/device.json`

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| `schemaVersion` | sim | 1 |
| `id` | sim | igual ao índice |
| `name` | sim | nome legível |
| `description` | sim | mínimo 10 caracteres |
| `arch` | sim | `arm64`, `x86_64` ou `arm` |
| `hostname` | sim | hostname válido |
| `buildrootDefconfig` | para `enabled` | ex.: `qemu_aarch64_virt_defconfig` |
| `buildrootFragment` | sim | caminho relativo |
| `rootfsOverlays` | sim | array de diretórios |
| `artifacts` | sim | globs em `output/images` |
| `runner` | sim | ex.: `ubuntu-24.04` |
| `timeoutMinutes` | sim | 60–360 |
| `status` | sim | `ready` ou `draft` |
| `bootNotes` | recomendado | anotações de boot |
| `docs` | sim | README do aparelho |

Campos **aceitos na documentação mas não lidos por script**: `buildrootFragments`,
`kernelPatches`, `firmwareFiles`. Não conte com eles até o loader implementar.

## 7. Pipeline de build

1. `list-devices.mjs` lê `devices.json`, filtra `enabled` + `arch` e gera a matriz.
2. `build-device.sh <id>`:
   - valida id, `enabled`, defconfig, comandos e versão do Buildroot;
   - **aborta se houver menos de `GIOCHI_SYSTEM_MIN_FREE_GB` (15) livres**;
   - baixa/valida o tarball do Buildroot, extrai em `work/<device>`;
   - aplica o defconfig com `make O=<build> <defconfig>`;
   - copia `device/common/rootfs-overlay` e os overlays do aparelho para um
     staging **sem espaços** (`00-common`, `01-device`, …);
   - chama `prepare-config.mjs` (fragmentos + hostname + issue + senha + DL_DIR +
     ccache + overlays);
   - roda `olddefconfig` e **falha** no `assert-config` se um símbolo pedido
     desapareceu ou mudou de valor;
   - confirma `BR2_aarch64=y`/`BR2_x86_64=y`/`BR2_arm=y` e `BR2_ROOTFS_OVERLAY`;
   - compila sob `setsid --wait`, com vigia de disco;
   - copia artefatos, `.config` **redigido**, `device.json`, fragmento, README,
     `build-info.txt` e `SHA256SUMS` para `out/<device>/`.
3. O workflow publica `out/<device>` como artefato.

### Por que staging de overlays

O Buildroot separa `BR2_ROOTFS_OVERLAY` por espaços. Como `device/powkiddy x55`
tem espaço no nome, o script copia cada overlay para `…/giochi-system-overlays/`
e usa caminhos sem espaço. **Não remova esse staging** sem substituir por outra
solução. Efeito colateral bom: `cp -a` preserva o bit de execução — por isso
`giochi-init` e `giochi-selftest` estão `100755` **no índice do Git**, e não
precisam de `chmod` em post-build.

### Por que não sobrescrever `post-build`/`post-image`

Defconfigs de placas reais podem depender dos scripts de pós-build do Buildroot.
`prepare-config` só mexe em hostname/issue/senha/DL_DIR/OVERLAY/ccache — e em
`BR2_ROOTFS_POST_BUILD_SCRIPT` **ACRESCENTA** o nosso `scripts/post-build.sh` à
lista existente, nunca substitui. O script, por sua vez, só ACRESCENTA uma linha
ao `/etc/inittab` (§11); nada do que o Buildroot gerou é removido. Foi assim que
a ligação do `giochi-init` passou a existir sem reabrir esta decisão.

## 8. Workflow e o histórico real do CI

### `.github/workflows/build-linux-arm64.yml`

- `validate` → `discover` → `build` (matriz).
- Dispara em push para `main` que toque `buildroot.version`, `config/**`,
  `device/**`, `scripts/**` ou o próprio workflow. **`docs/**` e `AGENTS.md` não
  disparam build.**
- `concurrency` com `cancel-in-progress: true`: **um push novo mata o build em
  andamento.** Consequência prática: não empurre mudança em `device/` ou
  `scripts/` enquanto houver build rodando — você perde 1–3 h de compilação.
- Entradas manuais: `device`, `arch`, `buildroot_version` e `allow_draft`
  (rascunho com defconfig, pedido **pelo id**; `device=all` nunca puxa draft).
- Caches de chave **estável** (`giochi-system-<device>-<versão>`): com hash de
  config a chave mudava a cada commit e todo build era frio.
- Passo *Free disk space* remove ~20–25 GB de SDKs que o build não usa.
- `GIOCHI_SYSTEM_ROOT_PASSWORD` é opcional; sem ele a senha é a de
  desenvolvimento.
- Artefatos: 14 dias.

### Histórico (02/11/2026 — 00h10 UTC de 03/11)

**18 execuções** do build. As relevantes:

| Run | Commit | Evento | Resultado |
| --- | --- | --- | --- |
| 13 | `5d1a1c0` selftest | push | **cancelado** (push novo) |
| 14 | `55d4345` perf/cache | push | **falhou** — *Build image* morreu em **3 s** |
| 15 | `80e58ee` sem KMSCUBE | push | **sucesso** — 22 min 45 s, artefato publicado |
| 16 | `e980699` X55 | push | **cancelado** pelo push seguinte (rodava com cache quente) |
| 17 | `e980699` X55 | **dispatch** | **falhou em 1 s** — `discover`, bug do `allow_draft` (§12.5) |
| 18 | `d9e81aa` fix | push | em andamento no fim da sessão |

O build do run 15 **passou** e provou o pipeline inteiro: Buildroot 2024.02
baixa, extrai, aplica defconfig, `prepare-config` mescla, `olddefconfig` roda,
`assert-config` aprova, o `make` compila e os artefatos com `SHA256SUMS` sobem.

**A falha de 3 s do run 14 não foi diagnosticada.** Um build que morre em 3 s não
chegou a compilar: os candidatos são a checagem de espaço livre, um `curl` que
falhou ou um erro que mata o script antes do `defconfig`. O log do job **exige
token** (`GET /actions/jobs/<id>/logs` devolve 403 sem autenticação), então não
foi possível ler de fora. Para diagnosticar: `gh run view --log-failed` ou abrir
o log no navegador.

O commit seguinte (`80e58ee`) removeu `BR2_PACKAGE_KMSCUBE` — decisão correta por
si (§12.4), mas provavelmente **não** era a causa dos 3 s.

## 9. Comandos

```bash
node scripts/validate-devices.mjs
node tests/run-all.mjs                          # 36 testes
node scripts/list-devices.mjs
node scripts/list-devices.mjs --github-matrix
node scripts/list-devices.mjs --github-matrix --device powkiddy-x55 --allow-draft
node scripts/device-info.mjs qemu-aarch64 json
node scripts/dtb-inspect.mjs device/r35s/dts/rk3326-gameconsole-r36s.dtb joypad
node scripts/dtb-buttons.mjs <arquivo.dtb> --out device/r35s/buttons.map
node scripts/dtb-catalog.mjs                    # regenera docs/rk3326-catalog.*
bash scripts/check-host.sh                      # pré-voo, sem root, não instala nada
bash scripts/build-in-container.sh --check      # o mesmo dentro do container
bash scripts/build-in-container.sh powkiddy-x55 # build sem dependências no host
bash scripts/build-in-container.sh --sd-image powkiddy-x55   # imagem de cartão
bash scripts/flash-sd.sh --list                 # discos removíveis
bash scripts/gles-probe.sh powkiddy-x35h --run   # GLES/EGL reais, sem pacote novo
bash scripts/build-device.sh qemu-aarch64       # só em Linux/CI
ALLOW_DRAFT=1 bash scripts/build-device.sh powkiddy-x55   # rascunho, de propósito
```

**Não use `node --test tests/`:** o runner spawna um processo por arquivo e sob
sandbox falha com `spawn EPERM`. Use `tests/run-all.mjs`, que importa tudo num
processo só — é o que o `package.json` e os dois workflows usam.

Variáveis do build: `BUILDROOT_VERSION`, `ROOT_PASSWORD` (8–128; letras, números,
`.`, `-`, `_`, `@`), `GIOCHI_SYSTEM_WORK_DIR`, `GIOCHI_SYSTEM_CACHE_DIR`,
`GIOCHI_SYSTEM_CCACHE_DIR`, `GIOCHI_SYSTEM_MIN_FREE_GB` (15),
`GIOCHI_SYSTEM_ABORT_FREE_GIB` (2), `GIOCHI_SYSTEM_DISK_POLL_SECONDS` (20),
`GIOCHI_SYSTEM_GROWTH_LIMIT_MIB` (4096), `GIOCHI_SYSTEM_OUT_DIR`, `JOBS`,
`ALLOW_DRAFT=1`.

## 10. Testes

`node tests/run-all.mjs` → **106/106**:

| Arquivo | Testes | Cobre |
| --- | --- | --- |
| `tests/devices.test.mjs` | 13 | índice, schema, pastas com espaço, matriz, draft habilitado, `allowDraft` por id vs `all`, mensagem de recusa |
| `tests/assert-config.test.mjs` | 12 | símbolo que sobrevive, desaparece, cai `=y`→`=m`, pedido-desligado-veio-ligado, `allow-drop`, aspas |
| `tests/fdt.test.mjs` | 11 | parse de DTB, gpio-keys, adc-joystick, `buttons.map`, truncado/ inválido |
| `tests/cmdline.test.mjs` | 12 | cmdline da X55 idêntica à que bootou, console sem baud, `fbconRotate:0` ≠ ausente, `video=`, recusa de campo desconhecido |
| `tests/device-x35h.test.mjs` | 10 | identidade do aparelho: DTS próprio, ST7703 e não HX8394, sem rádio, patches existem, DTS herda o da X55, 16 botões sem `BTN_MODE` |
| `tests/buttons-map.test.mjs` | 6 | mapa parseável, sem duplicata, 16 obrigatórios, exatamente 1 `OPCIONAL` (o `BTN_MODE`) |
| `tests/prepare-config.test.mjs` | 8 | caminho com espaço recusado, fragmentos anexados, senha |
| `tests/assert-kernel-config.test.mjs` | 8 | `CONFIG_*` que sobrevive/desaparece/cai para `=m`, `--required` |
| `tests/firmware-required.test.mjs` | 5 | `rtl8821cs_*` no override, firmware obrigatório presente |
| `tests/buildroot-hash.test.mjs` | 2 | hash do tarball fixado e usado |
| `tests/base-system.test.mjs` | 19 | contrato do sistema base: udhcpd, RNDIS (não ECM), `os_desc` completo, `PermitRootLogin`/`UseDNS`, dropbear ausente, recusa de build com pacote removido |

## 10-A. O sistema base — acesso antes de interface

Contrato completo em [`docs/sistema-base.md`](docs/sistema-base.md). O resumo do
que é **obrigatório em todo aparelho**, porque muda decisões de build:

| Canal | Serve para quantos aparelhos |
| --- | --- |
| Wi-Fi | só a X55 |
| Bluetooth | só a X55; e BT não é canal de shell |
| Console serial (TTL) | tecnicamente todos — mas exige adaptador, solda ou carcaça aberta |
| **Cabo USB** | **todos**, e é o mesmo cabo que carrega |

Um aparelho sem shell por USB só é acessível abrindo o plástico. Por isso tudo
o que sustenta esse canal mora no **overlay comum**, não no do aparelho:

- `S30usbnet` + `giochi-usbnet`: gadget USB com **RNDIS** (o Windows não tem
  driver de ECM — ECM foi o que se testou primeiro na X55, e o PC criava a
  interface sem fazer nada com ela) e `udhcpd` servindo `10.55.0.1` ao PC.
  Aparelho em **`10.55.0.2`**, e `ssh root@10.55.0.2` funciona sem configurar
  nada no PC.
- `/etc/ssh/sshd_config` **substituindo** o do pacote: o padrão do Buildroot é
  `prohibit-password` (root só com chave — e num aparelho novo não há chave, o
  que torna o primeiro acesso impossível) e `UseDNS yes` (cada conexão trava até
  o timeout no link USB, que não tem DNS).
- **OpenSSH, não dropbear.** Os dois juntos instalam `S50dropbear` E `S50sshd`,
  ambos na porta 22: o segundo a subir falha e o sintoma é "ssh às vezes não
  responde". Medido na imagem da X55: os dois binários estavam no rootfs. Ficou
  o OpenSSH porque o `scp` do 9+ usa SFTP por padrão e o dropbear não tem
  `sftp-server` — `scp` e WinSCP contra dropbear falham em silêncio.
- `config/common.busybox.fragment` com `udhcpd`, `nc`, `vi`, `ip`, `dmesg`. É a
  definição do "sistema base" no que depende do busybox. Fragmento do aparelho
  continua existindo para o que **quebra o build** daquele aparelho (o `tc`).

`tests/base-system.test.mjs` (19 testes) fecha o contrato: `udhcpd` presente,
comum não desliga applet, RNDIS como padrão, `PermitRootLogin`/`UseDNS`,
dropbear ausente dos defconfigs, e o selftest tratando `usb0` como canal padrão.

## 11. A camada de boot — o que falta para o aparelho sair do console

O `respawn` do `/etc/inittab` mantém o launcher vivo. São dois motivos, e o
primeiro já vale hoje:

1. **recuperação** — se o launcher morrer, a tela congelaria até alguém entrar por
   SSH;
2. **pré-requisito do `exec` futuro** — o plano do app é o launcher fazer `exec`
   no jogo, substituindo o próprio processo, para nunca haver dois disputando o
   DRM master.

> **Correção de fato (03/11/2026, apontada pela equipe do app):** o launcher
> **não** faz `exec` hoje. O único uso de processo é `Command::status()` em
> `poweroff`/`reboot` (`fork` + `wait`). O `exec` está registrado no
> `docs/integracao.md` deles como decisão futura. O argumento era certo; o tempo
> verbal não — e este documento repetia o erro em três lugares.

```text
giochi-init ──▶ launcher ──exec──▶ jogo        (exec: ainda NÃO implementado)
     ▲                              │
     └────────── jogo termina ──────┘
```

O script existe, está executável no índice do Git, tem o limite de 5 reinícios em
60 s **testado** (§3) e um comportamento de desistência correto: para de
reiniciar mas continua vivo, porque matar o PID 1 derruba o kernel.

**As três ligações estão feitas e testadas:**

1. **`/etc/inittab` com a linha `::respawn:/usr/bin/giochi-init`** — RESOLVIDO
   por `scripts/post-build.sh`, sem as duas opções ruins que estavam na mesa.
   Não se assume a autoria do `/etc/inittab` (defconfig de placa real pode
   depender do que o Buildroot gerou) e não se sobrescreve
   `BR2_ROOTFS_POST_BUILD_SCRIPT` (perderia o post-build do aparelho): o
   `prepare-config` **acrescenta** o nosso script à lista existente, e o script
   **insere** a linha depois do `rcS`, preservando todo o resto.
   ```
   ::sysinit:/etc/init.d/rcS
   ::respawn:/usr/bin/giochi-init        ← acrescentada, não substitui nada
   console::respawn:/sbin/getty -L console 0 vt100
   ```
   **Só entra quando há launcher** (`/opt/giochi/apps/launcher/bin/giochi-launcher`)
   ou o marcador `/etc/giochi/boot-layer`. Assim não há flag para esquecer: o
   comportamento acompanha o artefato. Enquanto o launcher não é empacotado, a
   imagem fica exatamente como antes.
   Idempotente (rodar duas vezes não duplica), e falha o build se o
   `giochi-init` não estiver executável — linha de inittab apontando para arquivo
   sem `+x` gera erro a cada respawn e o build teria ficado verde.
   `tests/boot-layer.test.mjs` cobre os cinco cenários.
2. **`buttons.map` chega ao rootfs** (feito). O staging copia
   `device/<pasta>/buttons.map` para `etc/giochi/buttons.map` e avisa quando o
   aparelho não tem mapa.
3. **`giochi-init` não sai mais em 99 ms** (feito): medido, ele saía com `exit 1`
   quando o launcher não existia — e com `::respawn:` isso vira ~10 reinícios por
   segundo inundando o console. Agora espera em intervalos de
   `GIOCHI_LAUNCHER_WAIT` (30 s), sem CPU e sem ruído.

Ou seja: **no dia em que o launcher entrar na imagem, ele sobe sozinho** — sem
mexer em configuração deste repositório.

Fora do escopo daqui: `giochi-controllers` (configurador de controles) não
existe. Ele precisa ser **binário separado, iniciado antes do launcher** — se o
mapeamento está errado, o usuário não consegue navegar até a tela de
configuração.

## 11-A. O launcher — contrato com o `Giochi app`

Detalhe em [`docs/launcher.md`](docs/launcher.md). O que muda decisão de build:

**KMSDRM funciona** (relatado pelo usuário). O caminho de render está fechado:
`/dev/dri/card0` + render node, `panfrost`, Mesa GLES 3.1, SDL2 com
`SDL2_KMSDRM` + `SDL2_OPENGLES`. O teste que fecha de verdade é
`SDL_GetCurrentVideoDriver()` devolver `kmsdrm` — a alternativa silenciosa é cair
no driver `dummy`: o processo roda, o log diz que inicializou vídeo, e a tela
fica preta.

**Stack de texto** no `defconfig` de quem tem tela (X55 e X35H):

```text
BR2_PACKAGE_SDL2_TTF=y
BR2_PACKAGE_DEJAVU=y
BR2_PACKAGE_DEJAVU_SANS=y
```

Duas armadilhas, as duas verificadas nos fontes do Buildroot 2024.02:

| Armadilha | Efeito sem a correção |
| --- | --- |
| `SDL2_TTF` **não** é opção do `sdl2`, é pacote à parte — e faz `select FREETYPE`, mas **não** liga harfbuzz (o `.mk` só passa `--enable-harfbuzz` se `BR2_PACKAGE_HARFBUZZ=y` existir) | texto com shaping errado em escrita complexa, **sem erro**. Português não precisa |
| `DEJAVU=y` **sozinho instala zero fontes**: `DEJAVU_FONTS_INSTALL` começa vazio e só cresce dentro de `ifeq ($(BR2_PACKAGE_DEJAVU_<FAMILIA>),y)` | build verde, `/usr/share/fonts/dejavu/` **vazio**, `TTF_OpenFont: Couldn't load font file` |

**Por que não no `common.fragment`:** o QEMU não tem SDL2. `SDL2_TTF` depende de
`SDL2`, então o símbolo nem seria oferecido, o `olddefconfig` descartaria em
silêncio e o `assert-config` reprovaria o build do smoke test. O stack mora
junto do SDL2, e `tests/launcher-deps.test.mjs` exige a invariante: **quem liga
SDL2 liga o texto**.

Caminho combinado do binário (usado pelo `giochi-init` e pelo `post-build`):
`/opt/giochi/apps/launcher/bin/giochi-launcher`. Quando ele existir, o
`respawn` do §11 entra sozinho.

**Ainda não medido:** `fbcon` e DRM master disputando a tela. Ao abrir o KMSDRM
o launcher vira master e o `fbcon` perde o display; o getty do console continua
escrevendo e pode aparecer por cima. Se acontecer, tirar o getty do console
ativo ou desligar o `fbcon` enquanto o launcher roda. Registrar aqui o que for
observado.

## 12. Blindagens contra falha silenciosa

Todas têm o mesmo formato: o build fica **verde** e entrega imagem errada.

### 12.1 `olddefconfig` descartando símbolos

O Buildroot descarta símbolo em silêncio quando o nome não existe, virou legacy
ou o pai está unset. Sintoma real no antecessor: imagem sem áudio porque
`CONFIG_SND_SOC_ROCKCHIP_I2S=y` caiu sem aviso.

`scripts/assert-config.mjs` roda depois do `olddefconfig` e **falha o build**
listando cada símbolo que desapareceu ou mudou de valor. Exceção justificada,
escrita no próprio fragmento:

```make
# giochi-system:allow-drop BR2_PACKAGE_MESA3D motivo curto
```

Não silencie com `allow-drop` sem escrever o motivo — o ponto é justamente
impedir que um símbolo suma sem ninguém notar.

Casos reais que ele pegou neste repositório: `BR2_PACKAGE_BUSYBOX_SHOW_OTHERS`
(desligado no defconfig do QEMU descartava `bash`, `less` e `procps-ng`) e
`BR2_PACKAGE_CURL`, que é **legacy** no 2024.02 e aborta o build sem dizer qual
símbolo é o culpado — o nome atual é `BR2_PACKAGE_LIBCURL_CURL`.

### 12.2 ccache

`prepare-config` emite `BR2_CCACHE=y`, `BR2_CCACHE_DIR` e
**`BR2_CCACHE_USE_BASEDIR=y`**. Sem o último o cache do CI nunca acerta, porque
cada runner monta o repositório num caminho absoluto diferente. Sem `ccache` no
PATH o build continua e avisa.

### 12.3 Cópia recursiva enchendo o disco

**Este foi o bug real** do antecessor: uma pasta copiava o repositório inteiro
para dentro de si mesma, em loop — 66 GB e build travado em `Syncing from source
dir`, horas depois, sem mensagem que ligasse o sintoma à causa.

Mecanismo: `SITE_METHOD = local` com `SITE` na raiz do repositório quando o
diretório de saída mora dentro dele. O rsync copia o próprio `output/`, que na
volta seguinte é copiado de novo.

Defesas: piso de 15 GB antes de começar; monitor a cada 20 s que aborta por
espaço livre (< 2 GiB) **ou** por taxa de crescimento (> 4 GiB no intervalo — pega
a espiral mesmo com disco grande); aviso de aninhamento; `setsid --wait` para o
`kill` derrubar os compiladores filhos; e ~20 GB liberados no CI.

**Ao empacotar o `Giochi app` como fonte local, isso volta:** use um snapshot
congelado das fontes e aponte `SITE` para ele, nunca para a raiz do repo.

### 12.4 Pilha gráfica é opt-in por aparelho

`BR2_PACKAGE_KMSCUBE` **não** sobrevive ao `olddefconfig` no 2024.02 sozinho:
depende de mesa3d (GBM + OpenGL ES + libdrm). Ficou fora do fragmento comum, e o
`giochi-selftest` marca 3D como **SKIP** dizendo que não pode provar — em vez de
assumir que funciona. Provar 3D exige ligar a pilha no fragmento **do aparelho**
(virtio-gpu no QEMU, panfrost no RK3566, Mali-G31 no RK3326).

### 12.5 Entrada `boolean` do Actions chega como string

`workflow_dispatch` com `type: boolean` entrega `github.event.inputs.*` como
**string**. E em expressão do Actions, comparar tipos diferentes faz coerção
numérica — então:

```yaml
# ERRADO: dá false mesmo com a caixa marcada
ALLOW_DRAFT: ${{ github.event.inputs.allow_draft == 'true' && '1' || '0' }}
```

Resultado medido no run #17: `ALLOW_DRAFT=0` sempre, o `discover` recusou
`powkiddy-x55` como desabilitado e o build morreu em **1 s**, antes de compilar
qualquer coisa. O sintoma (`Dispositivo desabilitado`) aponta para o aparelho e a
causa estava no YAML.

Duas defesas, as duas aplicadas:

1. Entrada que vale como flag usa **`type: choice`** com `false`/`true` — string
   de verdade, e aparece como lista em vez de caixa que passa despercebida.
2. Quem **lê** a variável normaliza `1|true|yes|on` (`list-devices.mjs` e
   `build-device.sh`), porque o mesmo valor chega do CI como texto e da mão de
   quem roda local.

### 12.6 Caminho com espaço em lista separada por espaço (o bug do X55)

`BR2_ROOTFS_OVERLAY`, `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` e
`BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES` são **listas separadas por espaço**.
Um caminho com espaço vira dois caminhos, e a mensagem cita só a primeira
metade — nunca o espaço:

```text
Kconfig file or fragment '/work/device/powkiddy' for 'linux' does not exist
```

Medido no build real do X55: o staging já existia para overlays (§7), mas **não**
para o fragmento de kernel nem para o de busybox. Corrigido copiando os dois para
`work/<device>/` antes de chamar o `prepare-config`, e com uma rede de segurança:
`prepare-config.mjs` **recusa** caminho com espaço em overlay, fragmento de
kernel e fragmento de busybox, dizendo o motivo. `tests/prepare-config.test.mjs`
cobre os três.

Regra: qualquer caminho que entre numa variável de lista do Buildroot precisa
passar por staging. O teste diz se passou.

### 12.7 Pacote do Buildroot que não compila contra o kernel do aparelho

`BR2_KERNEL_HEADERS_AS_KERNEL=y` faz os headers do toolchain serem os do kernel
escolhido. Com kernel 6.12, **dois pacotes do Buildroot 2024.02 quebram**, e
nenhuma das mensagens cita a versão do kernel:

| Pacote | Erro | Correção |
| --- | --- | --- |
| `busybox` 1.36.1 (`networking/tc.c`) | `TCA_CBQ_MAX undeclared` (parede de ~40 erros) | `# CONFIG_TC is not set` em `device/<pasta>/busybox.fragment` |
| `strace` 6.7 | `static assertion failed: Unexpected size of sysoff.rsv` | `--enable-bundled=yes` em `config/package-overrides.mk` |

Ambas as correções são de projeto, não contorno: o `tc` do iproute2 (já na
imagem) cobre o applet desligado, e o strace com headers próprios continua
funcionando.

**Armadilha do `BR2_PACKAGE_OVERRIDE_FILE`:** o Buildroot inclui esse arquivo
**antes** de `package/*/*.mk` (`Makefile`, ~linha 530). Um `VAR += opção` ali é
apagado pela atribuição normal da receita, em silêncio. Use `override VAR = …` e
repita as opções padrão da receita. Prova:
`make -p -n | grep STRACE_CONF_OPTS`.

### 12.8 Dois cartões SD removíveis, nenhum aviso

Um aparelho com um cartão dentro e um leitor de cartão no host produzem dois
`/sys/block/*` com `removable=1`, ambos plausíveis, e nada no nome distingue um
do outro. Nesta sessão o X55 tinha um **SE32G de 29,7 GiB** e o leitor tinha um
cartão de **116 GiB**: a gravação foi para o cartão errado e só o `mmc info` do
U-Boot revelou.

Defesa: `scripts/flash-sd.sh --expect-gib <N>`, com o valor que o aparelho
reporta. Depois de gravar, o script relê o cartão e compara o SHA256 — cartão
defeituoso falha ali, não no boot.

### 12.9 O fragmento de kernel é delta e ninguém verificava o resultado

`assert-config` cobre símbolos `BR2_*`. Os `CONFIG_*` do kernel são **outro
Kconfig**, resolvido por outro `olddefconfig`, e não tinham gate nenhum. Medido
no primeiro build real do X55: dos 57 símbolos pedidos em `linux.fragment`, dois
não existem no kernel 6.12 e um caiu para módulo — build verde.

Dois mecanismos, aplicados:

1. `scripts/assert-kernel-config.mjs` compara o `linux.fragment` com o
   `.config` que o kernel **realmente** usou, e falha o build. Exceção
   justificada no próprio fragmento:
   `# giochi-system:allow-drop CONFIG_X motivo`.
2. `device/<pasta>/kernel-required.txt` lista o que o aparelho **precisa ter**
   venha de onde vier. O fragmento é delta: `CONFIG_MMC_DW_ROCKCHIP`,
   `CONFIG_EXT4_FS`, `CONFIG_SERIAL_8250_DW` e o painel vêm do defconfig arm64,
   não do fragmento — sem esta lista, sumiriam sem aviso e a imagem não chega ao
   rootfs.

Achados reais que o gate reproduz:

| Símbolo | O que aconteceu |
| --- | --- |
| `CONFIG_ARM_ROCKCHIP_CPUFREQ` | removido no 6.12; RK3566 usa `cpufreq-dt` |
| `CONFIG_JOYSTICK_ROCKNIX` | driver fora da árvore, ainda não empacotado |
| `CONFIG_BT` | defconfig traz `=m`; exigir `=y` era atrito sem ganho |

### 12.10 `docker` snap tem `/tmp` próprio

Docker instalado por snap roda num namespace com `/tmp` privado: bind-mount de
`/tmp` aponta para o `/tmp` do daemon, e o arquivo "some" do host embora exista
dentro do container. Custou um log de serial que parecia vazio. Todo caminho
montado em container precisa sair de `/tmp` (`build-in-container.sh` recusa).

### 12.11 Patch novo em build retomado NÃO é aplicado

`KEEP_WORK=1` mantém `work/<device>`, e o Buildroot vê `.stamp_patched` e
**pula a fase de patch inteira**. O sintoma é o pior tipo: build verde, log
dizendo `patch: 0001-....patch` como se tivesse entrado, e a imagem sem a
correção. Confirmado com `dtc -I dtb -O dts` no artefato: sem patch.

Defesa em `build-device.sh`: o conjunto de patches é hasheado em
`work/<device>/kernel-patches.state`; se mudou e existe `.stamp_patched`,
`linux-dirclean` roda antes do `make`.

**Armadilha dentro da correção:** `[[ -f "$dir/"* ]]` **não expande glob** no
bash — só `[ ]` e comandos externos fazem pathname expansion. A primeira versão
da detecção nunca disparava. Use `compgen -G`.

### 12.12 `extlinux.conf` sem `TIMEOUT` não boota sozinho

O `extlinux.conf` gerado tinha `default` e nada de tempo. O U-Boot achava a
entrada, imprimia `Enter choice:` e **parava**. Num handheld isso é
indistinguível de "não bootou" — a tela fica no console e ninguém está com a
serial aberta para apertar Enter.

Correção: `timeout 30` (unidade de 1/10 s = 3 s). Verificado com `reboot` no
aparelho: boota sem tecla. Não use `prompt 0` para "resolver" — ele remove o
menu e tira a única forma de escolher outra entrada.

### 12.13 Montar a partição do rootfs e limpá-la destrói o sistema em execução

**Erro cometido nesta sessão.** Para trocar o rootfs pela rede, montei
`/dev/mmcblk1p2` em `/mnt/new` e rodei `rm -rf` para limpar. O rootfs **em
execução** é a mesma partição. Resultado: `/bin/busybox` apagado, shell só com
builtins, SSH devolvendo saída vazia com exit 0 (o `sh` não existia mais para
executar), e `Kernel panic - not syncing: No working init found` no boot
seguinte.

Nunca há motivo para limpar a partição que está montada em `/`. Para substituir
o rootfs, use uma destas vias:

| Via | Como |
| --- | --- |
| `gzwrite` no U-Boot | grava o `.ext4.gz` por offset; não depende do Linux (usado na recuperação) |
| imagem de cartão | `make-sd-image.sh` + `flash-sd.sh`, com o cartão no leitor |
| boot alternativo | montar a partição de um **segundo** cartão/slot, nunca a raiz corrente |

**Recuperação que funcionou**, sem tocar no aparelho:

1. `echo b > /proc/sysrq-trigger` para sair do sistema quebrado (a CPU fica
   parada em panic; é preciso ciclo de energia).
2. `serial-interrupt.py` martela teclas em `Hit any key to stop autoboot` e
   prende o U-Boot em `=>`.
3. `loady` + YMODEM do `rootfs.ext4.gz` (52 MB, ~15 min) e
   `gzwrite mmc 1 0x20000000 ${filesize} 0x100000 0x14000000`.
4. `reset` → sistema de volta, `PASS 18 · FAIL 0`.

Detalhe: o `gzwrite` **não** depende do host depois do envio; parar o container
não interrompe a gravação.

### 12.14 Credencial do usuário nunca pode entrar na imagem

O artefato do CI é público. Um `wpa_supplicant.conf` com `ssid=`/`psk=` no
overlay de um aparelho entrega a senha da rede de quem buildou — e ninguém
percebe, porque o arquivo "só existe no aparelho". O mesmo vale para chave de
host SSH: toda imagem sairia com a mesma identidade.

`build-device.sh` agora **falha** se, no `target/`:

- `etc/wpa_supplicant.conf` tiver linha `ssid=` ou `psk=` (o template do
  Buildroot tem só `key_mgmt=NONE` e passa);
- existir `etc/ssh/ssh_host_*_key` (o sshd gera no primeiro boot).

Credencial de rede é provisionada **no aparelho**:
`wpa_passphrase ... > /etc/wpa_supplicant.conf`. O `S40wifi` conecta se o
arquivo existir e não faz nada se não existir.

### 12.15 Device node que existe e não funciona é pior que ausente

Durante o trabalho de Bluetooth, um symlink de `rtl8821c_fw.bin` (variante USB)
para `rtl8821cs_fw.bin` (UART) fez o `hci0` **aparecer** em
`/sys/class/bluetooth/` — e falhar em seguida com
`download fw command failed (-110)`. Um `ls` mostraria o dispositivo, um teste
superficial passaria, e o rádio não funcionaria.

Regra: prefira a falha explícita (`Direct firmware load ... failed with error
-2`, sem `hci0`) a um nó que existe pela metade. O `giochi-selftest` segue a
mesma linha — conta dispositivos e bits em vez de conferir nomes.

### 12.16 `amixer` não existe no Buildroot, `alsactl` sim

`BR2_PACKAGE_ALSA_UTILS` no 2024.02 traz `alsactl` e `alsamixer`, **não**
`amixer`. Um teste que dependa de `amixer` cai em SKIP silencioso — e SKIP não é
aprovação. Para ler valor de controle de mixer sem `amixer`:

```sh
alsactl -f /tmp/state.conf store
# bloco: name 'Playback Mux' / value HP
```

### 12.17 linux-firmware do Buildroot omite arquivos do RTL8821CS

`BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT` lista `rtl8821a_*` e `rtl8821c_*` mas
**não** `rtl8821cs_*` — que estão no **mesmo** tarball (`linux-firmware-20240115`):

```text
linux-firmware-20240115/rtl_bt/rtl8821cs_fw.bin       56648 B
linux-firmware-20240115/rtl_bt/rtl8821cs_config.bin      25 B
```

Sintoma: build verde, imagem que boota, e Bluetooth que "não funciona" sem erro.
A falha só aparece no dmesg do aparelho:
`firmware file rtl_bt/rtl8821cs_fw not found`.

Correção em `config/package-overrides.mk`:
`LINUX_FIRMWARE_FILES += rtl_bt/rtl8821cs_fw.bin rtl_bt/rtl8821cs_config.bin`
(a variável é montada com `+=` e o override é incluído antes das receitas).

**Armadilha ao investigar isso:** o arquivo oficial **não** é o mesmo que se
gera à mão. O oficial tem baudrate `0x04928002` (1500000) e flow control
**ligado**; gerar "no chute" com 115200 e 3 fios produz um config que o driver
aceita (`cfg_sz 25`) e um rádio que funciona pela metade. Regra: procurar o
firmware no tarball do `linux-firmware` antes de reconstruir qualquer binário.

Gate: `device/<pasta>/firmware-required.txt` + verificação no build. Um arquivo
de firmware ausente não impede o boot, então nada notaria.

### 12.18 Staging de overlay nunca era limpo

`stage_overlay` fazia `cp -a origem/. destino/` a cada build. Copiar sobrescreve,
mas **não apaga**: um arquivo removido do overlay do aparelho continuava no
staging e era aplicado em `target-finalize`, sobrepondo o arquivo de um pacote.

Medido: `rtl8821cs_config.bin` saiu do overlay, mas a cópia de 25 bytes de um
build anterior continuou no staging e **sobrescreveu o firmware oficial** do
`linux-firmware` — mesmo nome, conteúdo diferente. O sintoma seria "Bluetooth não
funciona" com o arquivo presente, que é o pior tipo.

Correção: `rm -rf "$OVERLAY_STAGE"` antes de montar. Consequência para quem usa
`KEEP_WORK=1`: arquivo removido do overlay exige `target/` limpo (ou dirclean do
pacote) para desaparecer de um `target/` já construído.

### 12.19 `fbcon=rotate:N` é ignorado em silêncio sem CONFIG_FRAMEBUFFER_CONSOLE_ROTATION

Sintoma: console na vertical com texto deitado, **com `fbcon=rotate:3` já na
linha de comando**. O painel da X55 é 720x1280 (retrato) e o console saía em
`90x80` — orientação nativa do painel.

Causa: `CONFIG_FRAMEBUFFER_CONSOLE_ROTATION` desligado. O kernel aceita o
parâmetro, não aplica e **não avisa**. Nada tem a ver com o U-Boot.

```text
antes:  90x80    fbcon/rotate=0
depois: 160x45   fbcon/rotate=3     (270° horário = 90° anti-horário)
```

`/sys/class/graphics/fb0/virtual_size` continua `720,1280` porque é o
framebuffer físico; a rotação acontece na camada `fbcon`. A geometria que vale é
a do `dmesg`: `frame buffer device NxM`.

Lição de método: o teste certo olha o **resultado** (`fbcon/rotate` e geometria),
não a intenção (o parâmetro na linha de comando). O `giochi-selftest` agora
compara o `rotate` com o `modes` do DRM e avisa quando o painel é retrato e a
rotação é 0.

### 12.20 `awk` do busybox não tem `strtonum`

O contador de bits do `giochi-selftest` usava `strtonum("0x" $i)`, que é extensão
do **gawk**. No busybox awk a função não existe e a expressão devolve vazio: o
teste "passa" com contagem zero, e um zero que parece válido é pior do que erro.
A versão que ficou conta dígito a dígito com `index`/`substr` e uma tabela de
pesos — funciona em busybox, gawk e mawk.

Regra ao escrever shell para este rootfs: o alvo é **busybox ash + busybox awk**,
não bash + gawk.

### 12.21 `BR2_TARGET_GENERIC_GETTY_BAUDRATE_*` reprograma a UART

Um baud explícito no getty faz o getty **reprogramar** a UART para aquela
velocidade, ignorando o que o kernel configurou. No X55 (console a 1500000), o
`115200` herdado do fragmento comum derrubava a console e a saída virava lixo —
o sintoma parece "console morto", não "baud errado".

Decisão: `BR2_TARGET_GENERIC_GETTY_BAUDRATE_KEEP=y` no
`config/common.fragment`. O getty recebe `0` e não mexe na velocidade; quem
manda no baud é a linha de comando do kernel. Verificado no rootfs do aparelho:
`console::respawn:/sbin/getty -L  console 0 vt100`.

### 12.22 Botão declarado no DTS que não existe no plástico

O `F`/`BTN_MODE` (`gpio3 PB7`) foi acrescentado ao DTS pelo patch 0002 porque o
gabarito tem o furo do botão. Medido no aparelho: **o botão não existe** —
provavelmente saiu numa revisão de hardware anterior a esta. O pino não gera
evento espúrio, então o DTS fica "correto" e mesmo assim há um nó que nunca
responde.

Esse é o pior tipo de divergência para uma ferramenta de teste: `giochi-buttons`
esperava **17** e `giochi-selftest` exigia 17 bits, então as duas ficavam presas
em "falta 1 botão" **para sempre** — e o falso negativo esconde um botão que
realmente quebrou, porque o operador aprende a ignorar a mensagem.

Decisão (o usuário deixou em aberto; este é o padrão atual):

- o nó **continua** no DTS — revisões que tenham o botão funcionam sem rebuild;
- a entrada do `buttons.map` leva o marcador **`OPCIONAL`**;
- `giochi-buttons` espera **16** obrigatórios e trata o `home` como bônus
  (`[OPCIONAL — este aparelho tem o botão]`, sem contar no que falta);
- `giochi-selftest` deriva a quantidade esperada **do próprio mapa** e reporta
  `16 declarados (16 obrigatórios + 1 opcional)`.

`tests/buttons-map.test.mjs` fecha o contrato: 16 `BTN_*` obrigatórios, exatamente
um `OPCIONAL` e ele é o `BTN_MODE`. Mudar a contagem sem querer agora falha o
teste em vez de virar um selftest eternamente vermelho.

Se um dia o marcador for removido sem que o botão exista, o teste não pega — mas
o `giochi-buttons` volta a mentir. O marcador é a fonte da verdade.

### 12.23 Resolução de painel DSI não é parâmetro de build

Pedido real: "quero uma versão com a resolução em 800x600" para uma placa cujo
painel é 640x480. Não existe — e insistir teria custado uma tarde.

Resolução de painel MIPI-DSI é **nativa**. Ela vem do modo que o driver do
painel anuncia (`st7703_get_modes`, `hx8394_get_modes`) e da temporização
gravada no driver/DTS. O `video=` da linha de comando **escolhe entre os modos
que o conector já anuncia**; não cria um. Num painel DSI, `video=DSI-1:800x600`
num painel 640x480 é ignorado — ou aplica um modo inexistente e a tela fica
preta.

`video=` é útil em HDMI/VGA/virtio-gpu, onde há negociação de modo. Num handheld,
não. O `scripts/lib/cmdline.mjs` aceita `video` porque existem aparelhos onde ele
faz sentido (o QEMU), mas nenhum RK3566 desta árvore usa.

Para "interface em 800x600 numa tela de 640x480" o caminho é renderizar maior e
reduzir na GPU, não mudar o modo do painel.

### 12.24 A cmdline do kernel vazando de um aparelho para outro

`make-sd-image.sh` tinha a cmdline da X55 **cravada no código**:

```bash
KERNEL_CMDLINE="... console=ttyS2,1500000n8 earlycon=uart8250,mmio32,0xfe660000 fbcon=rotate:3"
```

Com um aparelho só, inofensivo. No segundo, três parâmetros errados de uma vez,
e o sintoma é o pior tipo: o cartão **boota**, só não mostra nada. Não há
mensagem ligando "tela preta" a "UART errada", e a UART errada nem existe no
aparelho para reclamar.

Correção: a cmdline vem do campo `kernelCmdline` do `device.json`, composta por
`scripts/lib/cmdline.mjs`, e `tests/cmdline.test.mjs` guarda a string da X55
**idêntica à que bootou em hardware**. Validação de forma no `validate-devices`,
e o `make-sd-image.sh` **falha** se o aparelho não declarar — melhor não gerar
imagem do que gerar uma que não dá para diagnosticar.

Corolário: assim que existir o segundo aparelho, todo literal "do aparelho" que
estiver num script de propósito geral é uma dívida. Resolução, UART, baud,
earlycon, rotação e offsets de firmware são todos candidatos.

### 12.25 Editar um script de shell enquanto ele roda

O `bash` **lê o script em blocos**, não de uma vez. Editar `build-device.sh`
enquanto ele executa faz o interpretador reler bytes deslocados e morrer com um
erro de sintaxe **numa linha que está correta**:

```text
scripts/build-device.sh: line 543: syntax error near unexpected token `)'
```

Medido: a linha 543 é `WATCHDOG_REASON="espaço livre caiu para $((...)) GiB"`,
e `bash -n` no mesmo arquivo, depois, dá `exit 0`. O erro não está no arquivo —
está no fato de o arquivo ter mudado no meio da leitura.

O sintoma é traiçoeiro porque:

- `bash -n` **passa** (o arquivo em disco está válido);
- o erro cita uma linha plausível, então a investigação começa no lugar errado;
- acontece no meio de um build de 40 min, e parece bug de código.

Regra: **não edite** `scripts/*.sh`, `docker/*.py` nem qualquer script em
execução. Se precisar mudar algo enquanto um build roda, faça uma cópia
(`cp build-device.sh /tmp/x.sh`, edite a cópia) ou espere. O mesmo vale para
editar um arquivo que outro processo está lendo por `getline`/`tail -f`.

Vale também para o container: o repositório é **bind-mount**, então a edição no
host é vista pelo processo dentro do container no mesmo inode.

### 12.26 Patch de kernel NÃO se compõe entre aparelhos

O `kernelPatches` do X35H lista **só** os patches da pasta dele. O patch `0001`
da X55 (HDMI off, `sdmmc1` com `no-mmc`/`no-sd`, `dma-names` do uart1, `&rng
okay`) **não é aplicado** quando o build é do X35H.

Como o DTS do X35H faz `#include "rk3566-powkiddy-x55.dts"`, ele herda o DTS
da X55 **mainstream** — sem as correções. Resultado medido no DTB gerado:

| Nó | Valor que veio | O que causa |
| --- | --- | --- |
| `rng@fe388000` | `disabled` | sem entropia: o `crng` demora e o `getrandom()` bloqueia — inclusive no `sshd` da primeira conexão |
| `hdmi@fe0a0000` | `okay` | conector fantasma; o probe do `dw-hdmi` atrasa o boot sem uso possível |
| `mmc@fe2c0000` (`sdmmc1`) | `okay` + `non-removable` | o kernel inicializa o cartão SDIO do **RTL8821CS** que esta placa não tem: `-110` repetido e atraso |
| `uart@fe650000` (`uart1`) | `okay` | Bluetooth do mesmo chip, ausente |

Build verde, imagem que boota devagar e sem entropia. É a mesma classe de falha
do §12.1: o build não tem como saber que o aparelho não tem o hardware.

**Regra:** herdar um DTS de outro aparelho exige **reverter explicitamente** o
que aquele aparelho ligava e este não tem. Não basta omitir o patch dele —
omitir deixa o nó como o DTS base declarou.

`tests/device-x35h.test.mjs` verifica os quatro `status` no patch. Herdar DTS de
novo sem esse teste repete tudo em silêncio.

### 12.27 Pacote removido da config continua no `target/` e entra na imagem

Buildroot **nunca apaga** arquivo de `target/` quando um símbolo desaparece do
Kconfig — ele só instala. Então remover `BR2_PACKAGE_X` do defconfig **não**
remove `X` da imagem num build retomado (`KEEP_WORK=1`).

Medido na X55 ao trocar dropbear por OpenSSH:

```text
$ grep DROPBEAR work/powkiddy-x55/build/.config
(nada — o .config novo está correto)

$ ls -l work/powkiddy-x55/build/target/usr/sbin/dropbear
-rwxr-xr-x ... 306448 ...   ← do build ANTERIOR
$ ls work/powkiddy-x55/build/target/etc/init.d/
S50dropbear  S50sshd        ← os dois, ambos na porta 22
```

O sintoma final é exatamente o defeito que a remoção existia para corrigir, e
nada no build indica o problema: `assert-config` passa (o símbolo saiu por
vontade própria, não foi descartado).

**O que NÃO funciona** (medido): apagar `target/` e os `.stamp_{target,staging,
host}_installed` para forçar reinstalação. O Buildroot não reinstala na ordem
necessária e o `target-finalize` morre em:

```text
/bin/bash: .../target/etc/shells: No such file or directory
make: *** [Makefile:727: target-finalize] Error 1
```

**Resposta aplicada:** `build-device.sh` guarda o conjunto de
`BR2_PACKAGE_*=y` em `work/<device>/packages.state` (gravado **só** ao fim de um
build bem-sucedido — gravar antes faz um build que falha "esquecer" a remoção).
Se um pacote sumiu, o build **recusa continuar** e diz para rodar sem
`GIOCHI_SYSTEM_KEEP_WORK=1`:

```text
ERRO: pacote(s) removido(s) desde o último build: DROPBEAR
  O target/ do build anterior ainda tem os arquivos deles e o
  Buildroot NÃO os remove: a imagem sairia com binário que a config
  diz que não existe.
  Rode de novo SEM GIOCHI_SYSTEM_KEEP_WORK=1 (o padrão limpa work/).
```

É a mesma família do §12.11 (patch novo não reaplicado): **`KEEP_WORK=1` só é
seguro quando a configuração não mudou de forma que remova coisa.** Acrescentar
pacote é seguro; remover e renomear, não.

### 12.28 `mount` do busybox não resolve `PARTUUID=`/`UUID=`/`LABEL=`

O `S96bootlog` do X35H montava a partição de boot assim:

```sh
mount -t vfat PARTUUID=47494f43-01 /mnt
```

Nunca funcionou, e o sintoma foi **"não tem giochi-boot.log"** — que num
aparelho sem console serial é indistinguível de "não ligou".

Causa medida no `.config` do busybox da própria imagem:

```text
# CONFIG_FEATURE_MOUNT_LABEL is not set
```

Essa opção é o que dá ao `mount` a capacidade de traduzir `PARTUUID=`, `UUID=` e
`LABEL=` para um dispositivo. Sem ela, a string vai **crua** para o kernel, que
responde `ENODEV`. É recurso do util-linux, não do kernel.

Detalhe que engana: `CONFIG_VFAT_FS=y` estava certo. O filesystem nunca foi o
problema — o nome do dispositivo era.

**Regra:** para montar por identificador dentro da imagem, ou ligue
`CONFIG_FEATURE_MOUNT_LABEL` no fragmento comum de busybox, ou localize a
partição **pelo conteúdo**. A segunda é melhor quando existe um marcador
confiável: o `giochi-bootlog` procura a partição que tem
`extlinux/extlinux.conf` ou `boot.scr`, e isso não depende de applet, de
util-linux nem do nome que o driver deu ao dispositivo (que muda entre
`mmcblk0p1`, `mmcblk1p1`, `sda1`…).

Armadilha secundária, também medida: com a partição **já montada** (udisks2 no
host, ou um serviço antes), o `mount` falha com
`already mounted or mount point busy` — mensagem que não diz o motivo. O script
agora reaproveita o ponto existente e **nunca desmonta o que não montou**.

### 12.29 Build retomado não reconfigura pacote quando uma DEPENDÊNCIA é acrescentada

O §12.27 cobre pacote **removido**. Este é o caso espelho, e é mais silencioso:
um pacote que já foi compilado **não é reconfigurado** quando uma dependência
nova aparece no `.config`.

Medido ao ligar `BR2_PACKAGE_HARFBUZZ=y` com `KEEP_WORK=1`:

```text
.config:            BR2_PACKAGE_HARFBUZZ=y        ← correto
/usr/lib:           libharfbuzz.so.0              ← instalada
build/sdl2_ttf-2.22.0/config.log:
    --disable-harfbuzz
    TTF_USE_HARFBUZZ='0'                          ← o consumidor NÃO usa
```

`libharfbuzz` na imagem e `libSDL2_ttf` sem harfbuzz ao mesmo tempo: o build
fica verde, o pacote novo está lá, e o recurso que motivou a mudança **não está
ativo**. Não há `assert-config` que pegue isso — o símbolo está certo.

Depois de limpar o pacote (`rm -rf build/sdl2_ttf-*`) e reconstruir:

```text
--enable-harfbuzz
TTF_USE_HARFBUZZ='1'
readelf -d libSDL2_ttf-2.0.so.0 → NEEDED  libharfbuzz.so.0
```

**Regra:** `KEEP_WORK=1` é seguro para depurar. Quando a mudança de configuração
altera **com o que um pacote é compilado** (dependência, opção de configure,
flags), limpe o pacote consumidor:

```bash
rm -rf ~/.cache/giochi-system/work/<device>/build/build/<pacote>-*
```

O `giochi-selftest` passou a checar a consequência em vez da causa: além de
listar as cinco bibliotecas do launcher, ele roda `readelf -d` no
`libSDL2_ttf` e avisa quando o harfbuzz **não** está ligado. É a única forma de
ver isso no aparelho — a biblioteca presente não prova que alguém a usa.

### 12.30 Três medidas que só o aparelho deu (X35H, primeiro boot com SSH)

O X35H bootou com tela, `usb0` e SSH — e o `giochi-selftest` acusou **6 FAILs
que eram todos bugs do próprio teste**. Ficam registrados porque os três padrões
se repetem.

| Sintoma no selftest | Causa real |
| --- | --- |
| 5 FAILs "libasound ausente" (etc.) com as cinco em `/usr/lib` | `ls /usr/lib/x.so* /lib/x.so*` retorna **não-zero quando o padrão de UM diretório não casa**, mesmo que o outro exista. Cada caminho tem de ser testado sozinho |
| `FAIL sem usb0 apesar de haver UDC` na mesma saída em que `PASS interfaces: usb0` | `/sys/class/net/usb0` é **symlink pendurado** neste kernel: `ls` mostra a entrada, mas `[ -e ]`, `[ -d ]` e a leitura de `operstate` falham, enquanto `ip link` e o SSH funcionam. Usar `ip` primeiro, sysfs só como reserva |
| `WARN udhcpd parado` com o `udhcpd` dando IP ao PC | `BUSYBOX udhcpd` **não grava pidfile** aqui (rodando como pid 176, sem `/var/run/udhcpd.pid`). O critério certo é `pidof udhcpd` |

Padrão comum: **o teste perguntou a coisa errada**. Presença de arquivo não é
uso; existência de symlink não é existência do alvo; pidfile não é processo.
A regra que funciona é perguntar pela **consequência** (o `ip` responde? o
`pidof` vê? o `readelf` mostra `NEEDED`?) e só usar o indireto como reserva.

#### U-Boot sobrescreve `/model` — a identidade real é o `compatible`

Medido no X35H:

```text
/proc/device-tree/model       -> "RG353M m"      (nome da placa do U-Boot)
/proc/device-tree/compatible  -> "powkiddy,x35h rockchip,rk3566"
```

O DTB carregado **é o nosso** — o `compatible` prova. Mas o U-Boot do defconfig
`anbernic-rgxx3-rk3566` reescreve `/model` com o nome dele, e quem lê só o
`model` conclui que o aparelho é um Anbernic. Isso engana tanto o operador
quanto qualquer app que identifique o dispositivo por `/proc/device-tree/model`.

`giochi-selftest` passou a reportar o `compatible` como identidade e a **avisar**
quando o `model` diverge. Aviso, não falha: o sistema funciona, o rótulo é que
mente. Antes de confiar em `model` para identificar aparelho, leia `compatible`.

### 12.31 Dongle Wi-Fi: hardware do USUÁRIO ≠ hardware ONBOARD

Eu havia tirado `wpa_supplicant`/`iw`/`wireless-regdb` do X35H argumentando
"sem rádio onboard, sem pacote". Estava errado, e o usuário corrigiu: **a
comunidade usa dongle Wi-Fi USB**.

A distinção que passa a valer:

| Tipo de hardware | Ausente | Presente |
| --- | --- | --- |
| **ONBOARD** (RTL8821CS na X55) | não empacote — driver/firmware seria código morto | empacote |
| **FORNECIDO pelo usuário** (dongle, cartão SD) | **empacote mesmo assim** | já está pronto |

Motivo: a imagem é gravada **uma vez** e o hardware chega **depois**. Se o
suporte não estiver lá, o usuário não tem saída sem recompilar. Já o chip
onboard ausente nunca vai aparecer — empacotá-lo só gasta espaço.

O X35H tem **duas portas USB independentes**, então gadget e dongle convivem:

```text
usb@fcc00000  dr_mode=otg   status=okay  → nosso usb0 (SSH)
usb@fd000000  dr_mode=host  status=okay  → dongle Wi-Fi
```

Suporte acrescentado (os dois aparelhos, porque não há fragmento comum de
kernel): `CONFIG_RTL8XXXU=m` + `RTL8XXXU_UNTESTED=y` (cobre 8188CU/EU, 8192CU,
8723AU e **8188FU**, o dongle barato de hoje), `CONFIG_RTL8192CU=m`,
`CONFIG_MT7601U=m`, `CONFIG_ATH9K_HTC=m`. Todos `=m`: carregam por modalias
quando o dongle entra, sem custo se ninguém plugar.

Firmware: `RTL_81XX` e `ATHEROS_9271` têm opção no Buildroot;
`mediatek/mt7601u.bin` **não tem**, e entra por `LINUX_FIRMWARE_FILES +=` no
`config/package-overrides.mk`.

**O gate que faltava:** `assert-config` cobre fragmentos `BR2_*`, não o
`defconfig` — então `BR2_PACKAGE_LINUX_FIRMWARE_RTL_81XX=y` podia ser dropado
em silêncio. Neste caso não foi (conferido no `.config`), mas o firmware
**não apareceu** de primeira por outro motivo, o do §12.29: o pacote já estava
instalado. `rm -rf build/linux-firmware-*` e reconstruir resolveu.

`giochi-selftest` passou a reportar porta USB host, presença de `wlan0` e os
módulos de dongle — sem isso, plugar um dongle é silêncio absoluto.

`tests/dongle.test.mjs` (7 testes) impede a recaída: exige os drivers nos dois
aparelhos, `UNTESTED` para o 8188FU, `=m` e não `=y`, userspace de Wi-Fi no
X35H, o `rtw88` **fora** do X35H, e o firmware declarado.

## 12-B. Canal com o `Giochi app`

O correio entre as duas equipes **não está no repositório**. Ele mora num arquivo
local:

```text
/home/charles/Giochi/chat_de_equipe.txt        máquina  charles-X99-V9S (192.168.1.5)
janela: 08:00 – 18:50 horário de Brasília (UTC−3, sem horário de verão)
```

**A janela de horário é restrição de projeto, não detalhe de conveniência.**
Pergunta bloqueante escrita depois das 18:50 custa uma noite parada; resposta que
exige ação no aparelho e chega às 18:40 não termina. Regra que decorre disso:
**toda mensagem tem de deixar o outro lado com trabalho possível** — pergunta
bloqueante vai junto com o que dá para fazer sem a resposta.

`docs/mensagem-giochi-system.md` é só o **ponteiro**: caminho, máquina, janela e
regras. Não recrie o chat aqui dentro.

Por que saiu do repositório: o arquivo foi trocado de lado três vezes e numa delas
chegou **truncado** — 14 422 bytes viraram 11 150 e mensagem já escrita se perdeu.
Um arquivo único, num só lugar, não tem o que sincronizar.

Regra ao usar: **ler antes de responder** (a última mensagem pode ter mudado o que
se ia dizer — já aconteceu); acrescentar no fim, nunca editar mensagem da outra
equipe. Quando a conversa virar decisão, a decisão vai para o doc de referência
(`launcher.md`, `sistema-base.md`, `giochi-init.md`) e o chat só aponta o link. Sem
isso o arquivo vira uma segunda fonte da verdade que diverge da primeira em
silêncio — a mesma classe de problema do §12.1.

Leia esse arquivo no início de uma sessão: o que está lá é o estado mais recente
do que o app espera do sistema, e pode ter mudado depois deste documento.

### 12.32 CMake 4.x recusa pacote do Buildroot 2024.02 (só em build do zero)

Buildroot 2024.02 é de fevereiro de 2024, e vários pacotes dela ainda declaram
`cmake_minimum_required(VERSION 3.4)`. O **CMake 4.0 removeu a compatibilidade com
versões anteriores a 3.5**. A mensagem cita política, nunca versão de CMake, então
o sintoma não aponta para causa nenhuma:

```text
CMake Error at CMakeLists.txt:1 (CMAKE_MINIMUM_REQUIRED):
  Compatibility with CMake < 3.5 has been removed from CMake.
  ...
  Or, add -DCMAKE_POLICY_VERSION_MINIMUM=3.5 to try configuring anyway.
make[1]: *** [package/pkg-generic.mk:273: .../host-hiredis-1.2.0/.stamp_configured] Error 1
```

Medido nesta máquina (**CMake 4.2.3**) no primeiro pacote de host do build: o
`host-hiredis` 1.2.0. **O CI não reproduz** porque o runner tem CMake 3.x.

**Por que passa despercebido:** só acontece com `work/` vazio. Com a árvore já
populada os pacotes de host estão construídos e nada é reconfigurado — foi por
isso que builds anteriores aqui funcionaram e este, depois de o `/tmp` ser limpo,
morreu.

Correção (a que o próprio CMake sugere): exportar
`CMAKE_POLICY_VERSION_MINIMUM=3.5`. O CMake 4 lê essa variável **do ambiente**
para inicializar o cache de árvores novas
(`/usr/share/cmake-4.2/Help/envvar/CMAKE_POLICY_VERSION_MINIMUM.rst`), e ela não
sobrepõe projetos que já declaram mínimo maior. `build-device.sh` exporta
automaticamente quando detecta CMake ≥ 4 e avisa no log:

```text
CMake do host é 4.2 — exportando CMAKE_POLICY_VERSION_MINIMUM=3.5
```

Some da lista quando o Buildroot for atualizado para uma versão que declare
≥ 3.5. Até lá, build do zero em máquina com CMake 4 exige o export — e o aviso no
log é o que impede alguém de passar horas procurando o problema no pacote.

### 12.33 GCC 15 compila em C23 e quebra os *host tools* do Buildroot 2024.02

Mesma família do §12.32, e aparece **logo depois** dele num build do zero: o
GCC 15 passou a usar `-std=gnu23` por padrão, e a árvore de 2024.02 assume
`gnu17`. O primeiro a quebrar é o `host-m4` 1.4.19 — e a mensagem não fala de
versão de C nem de GCC:

```text
gl_oset.h:275:1: warning: 'nodiscard' attribute ignored [-Wattributes]
  275 | GL_OSET_INLINE _GL_ATTRIBUTE_NODISCARD int
      | ^~~~~~~~~~~~~~
gl_oset.h:275:40: error: expected identifier or '(' before 'int'
make[5]: *** [Makefile:2871: gl_avltree_oset.o] Error 1
make[1]: *** [package/pkg-generic.mk:283: .../host-m4-1.4.19/.stamp_built] Error 2
```

**A causa não está no configure, está no `config.h` gerado** — a escolha é feita
em tempo de compilação:

```c
#if 201710L < __STDC_VERSION__
# define _GL_ATTRIBUTE_NODISCARD [[__nodiscard__]]      /* C23 */
#elif _GL_HAS_ATTRIBUTE (warn_unused_result)
# define _GL_ATTRIBUTE_NODISCARD __attribute__ ((__warn_unused_result__))
```

Com `gnu23`, `__STDC_VERSION__` é `202311L`, a comparação passa e ele usa a forma
C23. Escrita **entre `inline` e `int`**, essa forma é inválida: atributo `[[...]]`
vai no início da declaração. Com `gnu17` o valor é `201710L`, a comparação falha e
ele usa `__attribute__`, aceito em qualquer posição. Por isso sempre funcionou.

Correção em `config/package-overrides.mk`:

```make
HOST_CFLAGS += -std=gnu17
```

Restrito a **HOST** de propósito: o cross-compile do target não é afetado. O
arquivo é incluído na linha 528, depois de `package/Makefile.in` (507), então o
`+=` soma em vez de ser apagado — ao contrário do caso do strace (§12.7), que
precisa de `override`.

#### O efeito colateral que eu neguei — e que quebrou o CI

Escrevi primeiro que `HOST_CXXFLAGS` não herdava o acréscimo, e que os avisos do
g++ eram "inofensivos, só ruído". **As duas afirmações estavam erradas**, e o CI
provou em um build:

```text
cc1plus: error: command-line option '-std=gnu17' is valid for C/ObjC but not for C++ [-Werror]
cc1plus: all warnings being treated as errors
make[2]: *** [src/CMakeFiles/ccache_framework.dir/all] Error 2
make[1]: *** [package/pkg-generic.mk:283: .../host-ccache-4.8.2/.stamp_built] Error 2
```

Duas coisas que eu não tinha pesado:

1. `HOST_CXXFLAGS += $(HOST_CFLAGS)` (`package/Makefile.in:252`) é expansão
   **recursiva**, então avalia `$(HOST_CFLAGS)` no momento do uso — **depois**
   deste arquivo. Herda sim.
2. Aviso só é inofensivo sem `-Werror`. O `host-ccache` compila com `-Werror`, e
   ali o aviso vira erro em cinco arquivos de uma vez.

Correção: redefinir `HOST_CXXFLAGS` de forma **recursiva** (`=`, nunca `:=`),
removendo só as flags que são de C:

```make
override HOST_CXXFLAGS = $(filter-out -std=gnu17 -Wno-error=implicit-function-declaration,$(HOST_CFLAGS))
```

`:=` congelaria a variável no valor daquele instante e pacotes que a estendam
depois perderiam a extensão — trocaria um erro visível por um comportamento
errado e silencioso, que é pior. Verificado com `make -p`:

```text
HOST_CFLAGS  = -O2 -I.../host/include -std=gnu17 -Wno-error=implicit-function-declaration
HOST_CXXFLAGS = -O2 -I.../host/include          ← idêntico ao original
```

#### Terceira armadilha: GCC 14+ trata declaração implícita como erro

`host-libffi` 3.4.4 usa `open_temp_exec_file()` em `src/tramp.c` sem declaração —
a função é `static` em `src/closures.c` e nunca chegou a um header. Até o GCC 13
isso era aviso; do 14 em diante é erro:

```text
src/tramp.c:262:22: error: implicit declaration of function 'open_temp_exec_file'
  [-Wimplicit-function-declaration]
make[1]: *** [package/pkg-generic.mk:283: .../host-libffi-3.4.4/.stamp_built] Error 2
```

**`-std=gnu17` não resolve isto** — a mudança de severidade é do GCC, não do
padrão de C. Downgrade explícito, também só nos tools de host:
`-Wno-error=implicit-function-declaration`. Sai da lista quando o libffi for
atualizado para uma versão que declare a função.

**Por que o CI não reproduz:** o runner do `ubuntu-24.04` traz GCC 13/14, que
ainda compila em `gnu17`. Verde no CI não prova build limpo em máquina nova — é o
mesmo raciocínio do §12.32, e os dois juntos são o argumento para o projeto ter
um `check-host.sh` que olhe versão de GCC e CMake, não só presença de comando.

## 13. Aparelhos

| ID | Pasta | SoC | Arch | Status | Falta |
| --- | --- | --- | --- | --- | --- |
| `qemu-aarch64` | `qemu-aarch64/` | virtual | arm64 | **ready** | nada — é o smoke test do pipeline |
| `powkiddy-x55` | `powkiddy x55/` | RK3566 | arm64 | draft | **boota com tela, áudio, Wi-Fi, BT e 16 botões + 4 eixos**; falta o launcher (do `Giochi app`) |
| `powkiddy-x35s` | `powkiddy x35s/` | **RK3566** | arm64 | draft | DTS (compartilha com o X35H) e build |
| `powkiddy-x35h` | `powkiddy x35h/` | **RK3566** | arm64 | draft | **compila e gera imagem**; falta **bootar**: tela ST7703, A/B, eixos |
| `r35s` | `r35s/` | RK3326 | arm64 | draft | pipeline RK3326 (BL31/DDR/U-Boot), joypad fora da árvore |
| `steamdeck` | `steamdeck/` | x86_64 | x86_64 | draft | kernel, firmware, áudio, Wi-Fi, controle |

**X35H e X35S são RK3566** (4× A55, Mali-G52) — não RK3326. O `AGENTS.md`
dizia o contrário e estava errado; a fonte é o `device.conf` **medido** no
antecessor (`GIOCHI_SOC=rk3566`). O **R35S/R36S é que é RK3326** (Cortex-A35),
com pipeline de boot próprio (DDR init, BL31 e U-Boot diferentes). Trocar os dois
manda o build para o lugar errado e o sintoma é o aparelho não sair do Maskrom.

Mapas de botão: saem do **DTS**, não de banco público (`docs/button-maps.md`).
O R35S é o que está mais avançado nisso: o DTB real está versionado em
`device/r35s/dts/` e o `buttons.map` saiu dele. Confirmação final só com
`evtest` no aparelho.

## 14. Próximos passos, por ordem de risco

1. **Interface de jogos (produto, não sistema).** Os controles de hardware estão
   completos: 16 botões físicos + 4 eixos, medidos no aparelho. O que falta é o
   launcher, que é do `Giochi app` — este repositório entrega o sistema.
2. **~~Firmware de Bluetooth~~ — RESOLVIDO.** O `rtl_bt/rtl8821cs_fw.bin` **é
   oficial** e está no `linux-firmware-20240115`; o Buildroot 2024.02 é que não
   o instala (§12.19). No aparelho: `fw version 0x75b8f098`, `Controller
   A8:4F:A4:C9:98:4C`, scan encontrando dispositivos reais. Rádio liga no boot
   por `AutoEnable = true` em `/etc/bluetooth/main.conf`.
5. **Ligar a camada de boot** (§11): a linha `::respawn:` do `/etc/inittab`.
6. **`genimage` dentro do Buildroot**, substituindo `make-sd-image.sh` como
   etapa externa.
7. **Provar o ccache e o build do QEMU depois das mudanças de fragmento.**
   `config/common.fragment` mudou (getty KEEP, overrides) e o QEMU foi
   revalidado só no `assert-config`, não em build completo.
8. **Fixar SHA256 do U-Boot e do kernel**, como já é feito com o Buildroot.
9. **Release público** em vez de artefato de 14 dias.

## 15. Decisões que não devem ser reabertas sem motivo

- **Buildroot em vez de fork de distro:** configuração declarativa, build em
  runner x86_64.
- **Node.js nos scripts de metadados:** zero dependência npm, portável, testável.
- **`qemu-aarch64` habilitado:** mantém o pipeline executável enquanto não há
  hardware.
- **Drafts desabilitados:** evita publicar imagem que não boota.
- **Pasta com espaço suportada:** atende ao pedido do usuário sem quebrar o
  Buildroot, via staging.
- **Arquitetura por aparelho:** Steam Deck é x86_64 e fica fora do build ARM64.
- **Senha de root por secret** e `.config` **redigido** no artefato.
- **Contrato com o `Giochi app` é `forge.json`, não YAML próprio:** o antecessor
  já tem formato **e validador** testados. App declara **capacidade**, nunca
  `BR2_PACKAGE_*` — quem sabe o empacotamento é este repositório. Ver
  `docs/dependencies-manifest.md`.
- **Launcher fica no `Giochi app`:** este repositório entrega o sistema e a
  camada de boot, não a interface.

## 16. Antecessor: `GIOCHI-KONSOL-OS`

Fonte de **fragmentos comprovados**, não o alvo:
`https://github.com/xtrempkch-droid/GIOCHI-KONSOL-OS`.

Regra ao reaproveitar: copiar de lá exige conferir que ainda se aplica — é
antecessor, não verdade atual. Trechos entram em `device/<pasta>/`, `config/` ou
`docs/` só depois de entendidos, nunca por cópia cega. Se
`docs/architecture.md` conflitar com `architecture-v1.2.md` de lá, o antecessor
tem precedência histórica e a divergência precisa ser resolvida explicitamente.

## 17. Limitações conhecidas

- O build completo do `qemu-aarch64` passou no CI (run #15); nenhum aparelho
  real compilou ainda.
- Nenhum aparelho real é inicializável; só o QEMU é `ready`.
- `bash -n` prova sintaxe, não comportamento; o `sh` local não é busybox ash.
- `.config` interno em `work/` contém a senha real — não publique `work/`.
- `buildroot.config` no artefato é redigido; o hash do `SHA256SUMS` é do arquivo
  redigido, não do `.config` real.
- Sem assinatura, OTA, atualização ou Release.

## 18. Como retomar

### Disponibilidade dos aparelhos — pergunte antes

| Aparelho | Estado | Consequência |
| --- | --- | --- |
| `powkiddy-x55` | **em uso pelo time do `Giochi app`** (launcher) | não usar para teste; **avisar com antecedência** se precisar |
| `powkiddy-x35h` | disponível para teste | é o aparelho de bring-up agora |

A X55 continua conectada (USB e TTL) mas está **ocupada**. Não rode nada nela
sem combinar antes: um reboot ou uma gravação de cartão interrompe o trabalho de
quem está usando. O mesmo vale para `adb`/SSH/serial — conectar já interfere.

Ordem sugerida para a próxima sessão (nada aqui precisa da X55):

```bash
node scripts/validate-devices.mjs      # 6 devices, 1 habilitado
node tests/run-all.mjs                 # 107/107
node scripts/list-devices.mjs --github-matrix
```

Depois, no GitHub (não há como disparar dispatch sem token daqui):

1. Actions → *Build Giochi System ARM64* → Run workflow
2. `device: powkiddy-x55`, `allow_draft: true`
3. Se falhar, o passo que interessa é o **Build image**, e a mensagem do
   `assert-config` vem com o nome do símbolo. Sem token, `GET
   /actions/jobs/<id>/logs` devolve 403 — leia pela interface.

Estado do Git nesta revisão: `main` sincronizado com `origin/main` (`9eb3e6f`),
remoto `https://github.com/xtrempkch-droid/GIOCHI-SYSTEM.git`. **Push por SSH**
(`git@github.com:...`): o HTTPS não tem credencial no host e o push falha com
`unable to get password from user`.

Build real: só em Linux/WSL2 com caminho sem espaços (o script recusa caminho
com espaço), ou pelo GitHub Actions.

### O que NÃO fazer sem pensar

- **Não empurre em `device/**` ou `scripts/**` com build rodando:** o
  `cancel-in-progress` mata o build em andamento.
- **Não silencie `assert-config` com `allow-drop`** sem escrever o motivo.
- **Não marque um aparelho como `ready`/`enabled`** antes de a imagem ter
  bootado num aparelho de verdade.

## 19. O que não deve ser commitado

`out/`, `work/`, `.cache/`, imagens `.img`/`.ext4`/`.ext2`, logs, `.env`,
segredos, `node_modules/`. O `.gitignore` cobre.
