# AGENTS.md — Giochi System

> Handoff técnico do repositório. Leia antes de continuar o trabalho.
> Atualizado em: 06/11/2026 (revisão 5 — **o R35S falou**: a linha serial, que
> devolvia só ruído em 04/11, ficou limpa depois da solda no TTL. Console
> `ttyS2@1500000` medido e preso em teste; joypad com fonte GPL confirmada; o
> desenho de partição de dados do ROCKNIX medido; os **cinco** painéis em texto
> comparável; e a **decisão de driver de GPU** fechada — o panfrost custa
> exatamente um item, e ele tem patch. Ver §13-A e
> [`docs/gpu-drivers.md`](docs/gpu-drivers.md).)

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
- **X35H definido e bootado**: DTS que herda o da X55, painel ST7703 no driver
  mainline, sem rádio onboard (com suporte a dongle USB, §12.31), `S96bootlog`
  gravando diagnóstico na FAT do cartão. Compila, gera imagem e **bootou em
  hardware com tela, `usb0` e SSH** (`docs/x35h-bringup.md`). Esse boot é de
  antes do `respawn` incondicional — a imagem em `out/` não tem a linha.
- Documentação em `docs/` (12 páginas) + template de issue para aparelho novo.

### Verificado nesta sessão de retomada

| Verificação | Resultado |
| --- | --- |
| `node tests/run-all.mjs` | **150/150** (host-compat 6, dongle 7, buttons-map, cmdline, bootlog, base-system, boot-layer, launcher-deps, devices 13, assert-config 12, fdt 11, …) |
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

**Corrigido nesta revisão (estava errado aqui e em outros três lugares):**

| Afirmação antiga | Fato medido |
| --- | --- |
| "X55 nunca compilou" | compilou duas vezes: 03/11 (build completo) e 04/11 (retomado, com `assert-kernel-config` OK em 70 símbolos) |
| "`/etc/inittab` não tem o `respawn`" | **tem**, linha 30, conferida com `debugfs` dentro do `rootfs.ext4` |
| "SHA256 do Buildroot não é fixado" | é: `buildroot.sha256`, e o build imprime `sha256: OK` (§9) |
| "`kernelPatches` não é lido por nenhum script" | é: `device-info.mjs kernelPatches` → `BR2_LINUX_KERNEL_PATCH`, com hash de estado (§12.11) |
| "Nenhum aparelho real boota" | X55 e X35H bootaram com tela, `usb0` e SSH (§3, `docs/x35h-bringup.md`) |

**Continua pendente:**

- **`buildrootFragments` (plural)** e **`firmwareFiles`** seguem aceitos na
  documentação e **não** lidos por script. O que existe e funciona é
  `buildrootFragment` (singular) e `firmware-required.txt` (verificação de
  presença, não download). Ou implementar, ou remover da doc.
- **`rocknix-joypad`** (driver fora da árvore) não está empacotado — o X55 tem
  16 botões via `gpio-keys` e 4 eixos via `adc-joystick`, sem ele.
- **`genimage`** dentro do Buildroot, substituindo `make-sd-image.sh` como etapa
  externa.
- **`giochi-controllers`** (configurador de controles) não existe: só o desenho,
  em `Giochi app/docs/controles.md`.
- **ccache ainda sem prova de acerto** — o cache é salvo e reusado, mas nenhum
  build seguido de mesmo commit foi cronometrado mostrando ganho.
- **Partição de dados da loja** (piso 4 GiB + resto do cartão) não implementada;
  ver as duas consequências de desenho em [`docs/flashing.md`](docs/flashing.md).
- **`gles-probe`** escrito; executado em 06/11/2026 **no R35S com ROCKNIX**, que
  usa o blob da ARM — mede o hardware, não o nosso panfrost (§18, item 2).
- **X55 com o launcher:** a imagem agora tem a linha do `respawn`, mas o
  binário é do `Giochi app` e entra por overlay — falta a rodada deles.
- SHA256 do **U-Boot e do kernel** não é fixado como o do Buildroot.
- Sem GitHub Release; artefatos expiram em 14 dias. Sem assinatura, OTA ou
  atualização.

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
│   ├── r35s/                          # RK3326 — extraído do aparelho; ver §13-A
│   │   └── dts/rk3326-gameconsole-r36s.dtb
│   ├── steamdeck/                     # x86_64 — draft
│   ├── generic-x64/                   # x86_64 — draft, PC comum com UEFI
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
│   ├── panel-inspect.mjs, lib/dsi-panel.mjs   # painel MIPI-DSI (R35S)
│   ├── gles-probe.py                          # GLES/EGL por ctypes, sem compilar
│   ├── check-host.sh                   # pré-voo: dependências, disco, hash
│   ├── build-in-container.sh           # build sem root no host (docker)
│   ├── make-sd-image.sh                # imagem de cartão com offsets do RK3566
│   ├── flash-sd.sh                     # grava com guarda de destino + SHA256
│   ├── assert-kernel-config.mjs         # CONFIG_* do kernel (o gap do §12.9)
│   └── lib/{devices,assert-config,assert-kernel-config,fdt}.mjs
├── docker/{builder,serial,serial-logger}.Dockerfile + scripts de serial
│   (serial-push.py envia arquivo ao aparelho por base64 em blocos)
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
node scripts/panel-inspect.mjs device/r35s/panels/*.txt   # compara os 5 painéis
node scripts/panel-inspect.mjs --extract <arquivo.dtbo>   # painel → texto
bash scripts/check-host.sh                      # pré-voo, sem root, não instala nada
bash scripts/build-in-container.sh --check      # o mesmo dentro do container
bash scripts/build-in-container.sh powkiddy-x55 # build sem dependências no host
bash scripts/build-in-container.sh --sd-image powkiddy-x55   # imagem de cartão
bash scripts/flash-sd.sh --list                 # discos removíveis
bash scripts/gles-probe.sh powkiddy-x35h --run   # GLES/EGL reais, sem pacote novo
python3 scripts/gles-probe.py                    # idem sem compilar (usa o python3 da imagem)
docker run --rm --privileged -v /dev:/dev -v ./docker:/work/push:ro ... \
  /work/push/serial-push.py /dev/ttyUSB0 1500000 <arquivo> '<comando>'  # enviar por serial
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

Duas do wrapper de container: `GIOCHI_CONTAINER_CACHE` (onde fica o cache no
host) e `GIOCHI_CONTAINER_SAME_PATHS=1` (monta o cache no **mesmo caminho
absoluto** do host — §12.40).

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

### 12.40 O Buildroot grava o caminho ABSOLUTO no RPATH — container e host não se misturam

`work/<device>` construído fora do container **não pode** ser retomado dentro
dele. O Buildroot grava o caminho absoluto de `host/lib` no `RPATH` de cada
binário que produz, e `support/scripts/check-host-rpath` falha quando o valor não
bate com o `host/lib` do momento. Medido em 06/11/2026 ao retomar o `work/r35s`:

```text
*** ERROR: package host-cmake installs executables without proper RPATH:
***   /cache/work/r35s/build/host/sbin/sfdisk
***   ... 238 binários ...
make: *** [package/pkg-generic.mk:295: .../host-cmake-3.28.1/.stamp_host_installed] Error 1
```

A mensagem **acusa o pacote errado**: ela cita `host-cmake`, que é o pacote
instalando naquele instante, e lista binários de outros pacotes (`sfdisk`,
`nettle-hash`, `lscpu`…). Quem procura o problema no CMake perde a tarde. A causa
é a mistura de layouts, e o número real está no `readelf`:

```text
$ readelf -d work/r35s/build/host/sbin/sfdisk | grep -i runpath
 (RUNPATH)  [/home/charles/.cache/giochi-system/work/r35s/build/host/lib:...]
```

Dois caminhos para resolver, e a escolha depende do que se quer:

| Situação | Use |
| --- | --- |
| build do zero | padrão (cache em `/cache` no container) — caminho curto e estável |
| `work/` já construído no host, com poucas horas de build dentro | `GIOCHI_CONTAINER_SAME_PATHS=1`, que monta o cache no **mesmo caminho absoluto** |

`GIOCHI_CONTAINER_SAME_PATHS=1` também torna container e build nativo
intercambiáveis, o que é útil quando o host tem as dependências e o container é
só conveniência. O que não se faz é **misturar**: um `work/` começado num layout e
retomado no outro sempre falha, e o erro nunca cita o layout.

### 12.41 A loja pede DUAS chaves, e iguais seria o mesmo que uma

Pedido da equipe do app em 06/11/2026 10:20. São duas perguntas diferentes:

| Arquivo | Pergunta |
| --- | --- |
| `/etc/giochi/loja-publica.pem` | "este pacote veio da Giochi?" |
| `/etc/giochi/licenca-publica.pem` | "este aparelho pagou?" |

A razão de separar é a que fecha a pirataria: se a assinatura do pacote fosse
também a prova de compra, **um** arquivo copiado de um aparelho para outro
serviria em todos. Com a licença separada, o `.giochi` não basta — a licença
carrega a chave pública do aparelho que comprou, e outro aparelho recusa.

Consequência direta para este repositório: `scripts/chave-da-loja.sh` agora trata
**dois** pares (`loja` e `licenca`), e `--verificar` **falha** quando as duas
públicas são iguais. Chaves iguais reproduzem exatamente o defeito que a
separação existe para evitar, e o sintoma apareceria só na loja — pacote
liberado de graça, nada no build indicando.

O binário `verificador-ed25519` recebe o caminho da chave como **terceiro
argumento** (`pacote sig chave`), então não muda nada nele para servir às duas.

`/etc/giochi/pontos-de-montagem` entrou junto: um caminho absoluto por linha,
`#` comenta. Inclui `/media` de propósito — sem essa linha a partição de dados
aparece como mídia removível e os jogos de `/user` aparecem **duas vezes** na
lista. `/user` ainda não existe na imagem (partição de dados não implementada),
mas está declarado: caminho que falta numa lista de exclusão é jogo invisível,
caminho que sobra é inofensivo.

A terceira chave, `/user/.config/giochi/device.key`, **não** é gerada aqui: ela
nasce no aparelho no primeiro boot. Quem a gera é o app, para não haver corrida
entre launcher e loja.

### 12.42 USB gadget no RK3326: `dr_mode = "otg"` não funciona, `peripheral` sim

Medido no R35S em 06/11/2026, cabo plugado na única porta USB. **Duas** peças
faltavam, e as duas são invisíveis em mensagem de erro:

| Peça | Estado no DTS do vendor | Efeito |
| --- | --- | --- |
| `u2phy_otg` (`otg-port` do PHY) | `status = "disabled"` | nenhum PHY criado; `phys = <&u2phy_otg>` fica pendurado |
| `&usb20_otg` | `dr_mode = "otg"` | dwc2 espera `bvalid` do PHY antes de conectar o pullup |

Com as duas corrigidas (`otg-port` okay **e** `dr_mode = "peripheral"`):

```text
/sys/class/udc/ff300000.usb/state   ->  configured
usb0                                ->  <BROADCAST,MULTICAST,UP,LOWER_UP> state UP
dmesg (aparelho)                    ->  dwc2: new device is high-speed / new address 13
dmesg (PC)                          ->  rndis_host 2-2:1.0 usb0: register 'rndis_host'
                                        Product: Giochi System / Manufacturer: Giochi
ping 10.55.0.2                      ->  0% loss, 0,5 ms
porta 22                            ->  SSH-2.0-OpenSSH_9.6
```

E o PC recebe `10.55.0.1` por DHCP sozinho — o `udhcpd` do `usb0` funciona sem
configurar nada no host, como o `docs/sistema-base.md` promete.

**Ligar só o `otg-port` não bastou, e isso foi medido:** depois de corrigir o
`status`, o PHY passou a existir (o IRQ do dwc2 mudou de 61 para 63, sinal de que
o port foi inicializado) e o estado continuou `not attached`. Ou seja, o
`otg-port` é condição necessária e **não suficiente**.

#### O que `bvalid` tem a ver com o carregador

Em modo `otg` o dwc2 consulta o `bvalid` do PHY — o sinal de que há 5 V no pino
VBUS — antes de conectar o pullup de D+. Neste aparelho esse sinal não chega: a
alimentação entra pelo carregador do PMIC `rk817`, não pelo pino VBUS do
controlador. Em modo `peripheral` o `dwc2_hsotg_pullup`
(`drivers/usb/dwc2/gadget.c`) conecta o pullup **sem esperar VBUS**, e o host
enumera.

#### A consequência que dói, e é de hardware

Com `peripheral` esta porta **não funciona como host**. O R35S não tem rádio
onboard, então **dongle Wi-Fi/USB não é opção nesta placa** — a regra do §12.31
("hardware fornecido pelo usuário também se empacota") não se aplica aqui porque
não há porta para ele. Fica o shell por USB, que é o canal do sistema base.

Duas conclusões de método que valem além desta placa:

1. **`dr_mode` não é preferência de configuração, é o que o hardware consegue
   fazer.** `otg` é o valor "certo" no papel e o que não funciona aqui.
2. **Duas peças, um sintoma.** `otg-port` desligado e `dr_mode` errado dão
   exatamente o mesmo `NO-CARRIER`, e corrigir uma não move o sintoma — o que
   faz parecer que a correção estava errada. Foi preciso corrigir as duas e
   reiniciar para o link subir.

### 12.42-A `status = "disabled"` num subnó de PHY é USB morto, sem erro

Medido no R35S em 06/11/2026, com o cabo plugado na porta OTG:

```text
/sys/class/udc/ff300000.usb/state      ->  not attached
/sys/kernel/config/usb_gadget/*/UDC    ->  ff300000.usb      (gadget vinculado)
ip link show usb0                      ->  NO-CARRIER, com 10.55.0.2 atribuído
dmesg                                  ->  "bound driver configfs-gadget.giochi"
```

O gadget estava armado, o UDC existia, o endereço de IP estava lá — e o link
nunca subia. Nenhuma mensagem de erro em lugar nenhum.

A causa está no DTS do vendor, e não parece um defeito:

```dts
&u2phy {
	status = "okay";
	host-port { status = "okay"; };

	u2phy_otg: otg-port {
		status = "disabled";      /* <- aqui */
	};
};
```

`rockchip_usb2phy_probe` percorre os filhos com `for_each_available_child_of_node`
(`drivers/phy/rockchip/phy-rockchip-inno-usb2.c`), que **pula** nó `disabled`.
Resultado: **nenhum PHY é criado** para o OTG. E o controlador pede exatamente
esse PHY:

```text
usb@ff300000   phys = <&u2phy_otg>   →  /syscon@ff2c0000/usb2phy@100/otg-port
               vbus-supply = <&otg_switch>
```

Sem PHY não há detecção de VBUS, e o dwc2 fica em `not attached` para sempre.

**Por que o DTS do vendor funciona para eles:** não sabemos, e é irrelevante —
o que está medido é que **não funciona para nós**. O R35S tem **uma** porta USB
(`usb@ff300000`, `dr_mode=otg`); as outras duas do PX30 (`ff340000`, `ff350000`)
estão `disabled`. Ou seja, sem o `otg-port` não há USB nenhum, nem para shell.

Lição que vale além desta placa: **`status` em subnó de PHY não é detalhe de
configuração — é a existência do dispositivo.** Um DTS com o nó desligado compila,
gera DTB válido, e produz um aparelho sem o barramento. O sintoma (`NO-CARRIER`)
aponta para rede, e a causa está em outra camada.

O gerador `scripts/gerar-patch-dts.mjs` passou a **recusar** publicar DTS com o
`u2phy_otg` desligado, junto das outras duas checagens de significado
(`rocknix,generic-dsi` no painel e `gameconsole,r35s` no compatible) — as três
que já custaram um boot.

### 12.44 MTP não existe no kernel mainline — e "existe" é o que importa

Pedido de "confirmar o MTP" em 06/11/2026. A verificação deu **negativo**, e o
resultado é medido, não suposto:

```text
$ ls drivers/usb/gadget/function/ | grep -i mtp
(nada)
$ grep -r CONFIG_USB_CONFIGFS_MTP drivers/usb/gadget/Kconfig
(nada)
```

O kernel mainline **não tem `f_mtp`**. MTP existe no Android porque ele precisa
de um protocolo para expor mídia sem entregar o armazenamento cru ao PC —
restrição que este aparelho não tem. Trazer `f_mtp` seria mais um driver fora da
árvore (seria o quarto) para resolver um problema que `mass_storage` resolve.

O que foi feito em vez disso: `giochi-usbnet --ms <partição>` expõe uma partição
como disco removível. Medido no aparelho:

```text
(aparelho)  giochi-usbnet: modo armazenamento: /dev/mmcblk1p1 exposta como disco removível
(PC)        sde  256M  disk  usb  File-Stor Gadget  RM=1
            sd 1:0:0:0: [sde] 524288 512-byte logical blocks: (268 MB/256 MiB)
            sd 1:0:0:0: [sde] Attached SCSI removable disk
            /run/media/charles/GIOCHI_BOOT  (montou sozinho)
```

E o `md5sum` do `Image` lido **pelo PC**, através da USB, bate com o build. É o
`cp` direto, sem cliente nem daemon no aparelho.

#### A guarda que quase não existiu, e o defeito que ela própria tinha

Expor o rootfs a outro computador deixa o host escrever num filesystem **em uso**
— o kernel do aparelho não sabe, e o dano aparece no boot seguinte. A primeira
versão da guarda comparava `/proc/mounts` com o part via `readlink -f`:

```text
/proc/mounts  ->  /dev/root         (nome de conveniência)
readlink -f   ->  /dev/root         (o node NÃO existe)
ls /dev/root  ->  No such file or directory
```

`readlink -f` de caminho inexistente devolve o próprio caminho, então
`/dev/root` ≠ `/dev/mmcblk1p2` e a guarda **deixava passar**. E passou: o teste
no aparelho expôs `mmcblk1p2` ao PC antes de eu perceber.

O método que funciona compara **major:minor**, que é o que o kernel usa e não
depende de nome de node:

```text
/proc/self/mountinfo  ->  "24 1 179:2 / / rw,relatime - ext4 /dev/root rw"
/sys/dev/block/179:2  ->  .../mmcblk1/mmcblk1p2
```

E a primeira tentativa de conversão hex→decimal usou `strtonum` do awk — que
**não existe no busybox** (§12.20, o mesmo erro do contador de bits). A versão
que ficou lê o número decimal direto do nome do symlink em `/sys/dev/block`, que
o kernel já publica pronto.

Verificado no aparelho depois da correção:

```text
# giochi-usbnet --ms /dev/mmcblk1p2
giochi-usbnet: RECUSADO: /dev/mmcblk1p2 é a partição que sustenta o / deste aparelho.
exit=1
```

A lição: **a guarda de segurança também precisa de teste no dispositivo.** Um
teste de unidade da lógica não pegaria, porque a lógica estava certa para os
dados que eu inventei — e os dados reais (`/dev/root`) têm uma forma que eu não
previ.

### 12.43 Codec e I2S ligados, e mesmo assim `--- no soundcards ---`

Medido no R35S em 06/11/2026, com a imagem que já bootava:

```text
CONFIG_SND_SOC_RK817=y
CONFIG_SND_SOC_ROCKCHIP_I2S=y
CONFIG_MFD_RK8XX_I2C=y
rk808-regulator ... registered
--- no soundcards ---
```

Faltavam **duas** peças independentes, com o mesmo sintoma:

| Peça | Estado | Efeito |
| --- | --- | --- |
| `CONFIG_SND_SIMPLE_CARD` | `=m` (default do arm64) | o `.ko` existia em `/lib/modules/…/snd-soc-simple-card.ko` e **nada o carregava** |
| `BR2_PACKAGE_ALSA_LIB` | ausente | rootfs sem `libasound.so`; o SDL2 não abre dispositivo |

O `simple-audio-card` é quem **lê** o nó `rk817-sound` do DTS e monta o card.
Codec e CPU-DAI sozinhos não criam card nenhum — eles ficam registrados,
esperando alguém ligá-los.

É a **mesma armadilha do X55** (§3, `S15modules`): módulo presente na imagem,
nenhum autoload, build verde, hardware mudo. O R35S não tem `/etc/modules` nem
`S15modules`, então `=m` significa "no disco e morto". Áudio é hardware **onboard**
(aparece em todo boot, não é acessório), então `=y`.

Regra que decorre: **ao revisar um nó de hardware no DTS, conte as peças do card
— codec, CPU-DAI, e o próprio card.** Um `grep` por `SND_SOC_RK817` acha duas das
três e dá a impressão de que está resolvido.

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

#### O que o CI alcança e o que ele não alcança (medido)

Isto ficou claro num único build de CI, e vale como régua:

| Problema | Quebra em | CI pegou? |
| --- | --- | --- |
| CMake 4.x × mínimo 3.4 | CMake ≥ 4 | **não** — runner tem CMake 3.x |
| `[[nodiscard]]` C23 no m4 | GCC ≥ 15 | **não** — passou pelo `host-m4` |
| declaração implícita no libffi | GCC ≥ 14 | **não** — passou pelo `host-libffi` |
| `-std=gnu17` em C++ com `-Werror` | **qualquer** GCC | **sim**, em `host-ccache` |

A leitura: o CI parou no `host-ccache`, o que prova que ele **atravessou** o
`host-m4` e o `host-libffi` sem tropeçar — ou seja, o runner tem GCC antigo o
bastante para os dois, mas o `-Werror` do ccache vale em qualquer versão. Por isso
o CI pegou exatamente o único dos quatro que não depende de versão.

Conclusão prática, e é o argumento para o `check-host.sh` olhar **versão** e não
só presença de comando: **CI verde não prova build limpo em máquina nova.** Só o
build local do zero prova, e é por isso que estes quatro ficam documentados em
vez de apenas corrigidos.

### 12.34 `ls A* B*` volta não-zero quando UM dos padrões não casa

O `giochi-selftest` testava as bibliotecas do launcher assim:

```sh
if ls /usr/lib/${lib}.so* /lib/${lib}.so* >/dev/null 2>&1; then pass ...; fi
```

`ls` recebe **dois** argumentos. Se `/usr/lib/libasound.so*` casa e
`/lib/libasound.so*` não (no Buildroot `/lib` **não** é symlink para `/usr/lib`,
é diretório real), o `ls` lista o primeiro, reclama do segundo e **sai com 1** —
o `if` então trata como ausente.

Sintoma medido no X35H em 04/11/2026: **cinco `[FAIL]` falsos** num aparelho onde
as cinco bibliotecas estavam em `/usr/lib` e o launcher rodava com texto.

```text
ls /usr/lib/libasound.so*                       ; echo $?   # 0
ls /lib/libasound.so*                           ; echo $?   # 1
ls /usr/lib/libasound.so*  /lib/libasound.so*   ; echo $?   # 1   <- o bug
```

Correção: um `ls` por diretório, num laço (`lib_existe()`), nunca dois globs no
mesmo comando.

**Por que isto merece um §12 e não só um commit:** um `FAIL` falso é pior que
teste nenhum. Ele manda caçar dependência que está no lugar e, na terceira vez
que aparece, o operador aprende a ignorar o bloco inteiro — inclusive quando ele
estiver certo. É o espelho exato da regra de "biblioteca presente não prova uso"
(§12.29): o teste tem de perguntar pela **consequência**, e "o arquivo existe" é
uma pergunta, "o launcher carrega" é outra.

`tests/selftest-contract.test.mjs` executa `lib_existe()` num diretório sintético
com os três casos: só em `/usr/lib`, só em `/lib`, e ausente nos dois (esse
último impede que a correção vire um `PASS` sempre-verde, que é o defeito
oposto).

### 12.35 O BMP prova o conteúdo, não a posição

O `--dump-frame` do launcher grava o framebuffer com `read_pixels`, e essa
chamada **não respeita o deslocamento do viewport**: devolve o conteúdo a partir
de (0,0). Quem mede *onde* a faixa preta está no arquivo conclui "faixa só
embaixo" — e o time do app quase documentou um bug de renderização a partir
disso, quando a tela estava correta (60 px em cima **e** embaixo).

| Medida no BMP | Vale? |
| --- | --- |
| percentual de preto | **sim** — o total independe do offset |
| comparação pixel a pixel com a referência | **sim** — as duas têm o mesmo artefato |
| posição da faixa (topo × base) | **não** — só olhando a tela |

Isso não afeta nenhum script desta árvore (não há `read_pixels`/`--dump-frame`
aqui), mas fica registrado porque o `giochi-selftest` vai crescer na direção de
imagem, e a armadilha é da mesma família do §12.20: a ferramenta responde uma
pergunta que não é a que se fez.

### 12.36 O launcher prova harfbuzz sem `readelf`

`readelf -d` é a prova exata de que o `libSDL2_ttf` usa harfbuzz (entrada
`NEEDED`). Mas `readelf` não está na imagem, e no Buildroot ele só vem com
`BR2_PACKAGE_BINUTILS_TARGET=y`, que instala a **toolchain inteira** no aparelho
(`ar`, `as`, `ld`, `objdump`, `strip`…) para servir a um diagnóstico.

Resultado medido no X35H: o bloco saía `[SKIP]` justamente no item que importa.

Decisão: não instalar binutils. Melhor que `grep`: o **loader dinâmico**, que já
está em toda imagem dinâmica, responde a mesma pergunta.

```sh
/lib/ld-linux-aarch64.so.1 --list /usr/lib/libSDL2_ttf-2.0.so.0
```

Isso imprime as dependências que o loader **resolve** — o mesmo conjunto que
`readelf -d` mostra como `NEEDED`, mais `linux-vdso.so.1` e o próprio loader.
Conferido no host contra `libpng16.so.16`: `--list` deu `libz`/`libm`/`libc`,
idêntico ao `readelf -d`. Zero pacote novo.

Três provas, e o texto do `PASS` diz qual foi usada:

| Prova | O que garante |
| --- | --- |
| `readelf -d` → `NEEDED` | o ligador exigiu a biblioteca |
| `ld.so --list` → resolve | o loader a resolve **agora**; pega também a que é pedida e não está instalada |
| `grep -a` → soname no `.dynstr` | o nome está lá; na prática equivale a `NEEDED`, mas não distingue um `dlopen()` opcional (que o SDL2_ttf não faz) |

#### A armadilha dentro da correção: `--list` não escreve nada quando falta dependência

Forjando um ELF com `NEEDED` trocado para `libqqq.so` (CUIDADO: só em `/tmp`):

```text
$ ld.so --list /tmp/fake.so ; echo $?
/tmp/fake.so: error while loading shared libraries: libqqq.so: cannot open...
127
```

Exit **127** e a lista **nem é escrita**. Então `--list | grep -q libharfbuzz`
devolve falso, a cascata cai no `grep -a` do binário — que **acha** o soname — e o
bloco dava `PASS` exatamente no caso que importa: biblioteca pedida e ausente.

Correção: capturar a saída **e o exit code**, e tratar `PEDE=1` com loader que
falhou como `WARN`, nunca `PASS`.

```sh
LISTA="$("$LOADER" --list "$TTF_LIB" 2>&1)" && LOADER_OK=1
```

Três casos provados contra o loader real do host:

| Caso | Resultado |
| --- | --- |
| `libpng16` + `libz` (existe) | `PASS resolvido pelo loader` |
| `libpng16` + `libharfbuzz` (não usa) | `WARN SEM a dependência` |
| ELF forjado + `libqqq` (pede, ausente) | `WARN pede e o loader FALHOU` |

O que **não** se faz é transformar "não deu para medir" em `FAIL`: `FAIL` falso
custa confiança no bloco inteiro (§12.34).

### 12.37 `#END` começa com `#`, então um parser de comentário o apaga

Ao ler `panel_description` (o formato do painel DSI do R35S, §13-A) escrevi:

```js
const { body, comment } = splitComment(line);   // separa em `#`
if (body.length === 0) continue;                // descarta linha vazia
if (body === "#END" || line === "#END") { ended = true; continue; }
```

`#END` não tem corpo: tudo nele é comentário. A linha era descartada no `continue`
antes de chegar ao teste, e `ended` ficava `false` **para os cinco painéis**,
inclusive os quatro que têm `#END` de verdade.

O que isso produzia não era erro: era o relatório imprimindo
`init 155 comandos, 220 ms de espera (SEM #END)` em todos — uma informação
plausível, errada, e visível na saída que eu tinha acabado de gerar. Eu li e não
questionei, porque "uns painéis podem não fechar a sequência" soa razoável. O
teste (`as linhas vêm separadas por NUL`) pegou.

Duas lições, e a segunda é a que vale:

1. marcador que começa com o caractere de comentário tem de ser testado **antes**
   da separação de comentário;
2. **eu tinha a saída na frente e não conferi.** O defeito não estava no parser —
   estava em tratar saída plausível como saída verificada. É a mesma família do
   §12.30 ("o teste perguntou a coisa errada") e do §12.35 (o BMP prova o
   conteúdo, não a posição): a ferramenta respondeu, e a resposta não foi lida
   com desconfiança.

O teste que fecha isso não é sobre `#END`: é `round-trip` — a mesma descrição em
texto e em NUL tem de produzir o mesmo painel, e `ended` tem de ser `true` nos
quatro que fecham e `false` no único que não fecha.

### 12.38 O menu do `extlinux` que não sai nunca — e o `not found` que engana

Sintoma medido no R35S em 06/11/2026, o aparelho em `Enter choice:` para sempre:

```text
Giochi System
1:	giochi
Enter choice: 
 not found
Giochi System
1:	giochi
Enter choice: 
 not found
```

Três coisas somadas produzem esse laço, e cada uma engana de um jeito:

1. **`menu title` no `extlinux.conf` desliga o `timeout`.** A keyword `menu` faz
   `cfg->prompt = 1` em `boot/pxe_utils.c` (`case T_MENU:`), e `common/menu.c`
   documenta prompt=1 como "prompted for input REGARDLESS OF THE VALUE OF
   TIMEOUT". Com `timeout 30` logo acima, o countdown simplesmente não vale.
2. **Qualquer CR vira uma tentativa de escolha.** `menu_interactive_choice()`
   chama `cli_readline_into_buffer("Enter choice: ", cbuf, m->timeout)`; com
   linha vazia, `menu_item_by_key(m, "")` devolve `NULL` e ele imprime
   `printf("%s not found\n", cbuf)` — daí o **espaço antes de `not found`**.
   Esse espaço é a assinatura do defeito: não é nome de arquivo nem de label.
3. **Depois de uma escolha inválida o menu deixa de expirar.** Duas linhas abaixo,
   `if (!choice_item) m->timeout = 0;`. O timeout que já não valia agora é zero
   explícito: o laço é definitivo.

O ruído do adaptador serial injeta CRs sozinho, então o laço se auto-alimenta:
cada byte repetido emite mais um `not found`.

**O que ele custou:** eu estava perseguindo `mmc read ... 0 blocks read: ERROR` e
`## Unknown partition table type 0`, que apareciam no mesmo log — e que eram
**sintoma**, não causa. O `bootflow scan mmc0` já tinha encontrado
`mmc@ff370000.bootdev.part_1` e lido o `extlinux.conf`. Li as mensagens de erro
na ordem em que apareceram no arquivo em vez de na ordem em que aconteceram no
boot.

Regra: `prompt=1` e `timeout` são **mutuamente exclusivos** no U-Boot, e o
`extlinux.conf` desta árvore não usa `menu title` por isso.
`tests/rk3326-legacy-boot.test.mjs` prende a ausência.

### 12.39 Driver fora da árvore que ninguém compila

Medido no cartão gravado em 06/11/2026, olhando o rootfs **do cartão** (não o
`target/`): 1285 `.ko` em `/lib/modules/6.12.0`, e **zero** `rocknix-*`.

O DTS declara:

```dts
joypad: odroidgo3-joypad {
        compatible = "rocknix-singleadc-joypad";
```

e o fonte estava versionado em `device/r35s/kernel-modules/rocknix-joypad/`
desde a extração do aparelho. Faltava o elo: **nenhum script levava o `.c` para
dentro da árvore do kernel**. O `Buildroot` só copia para lá o que vem em
`BR2_LINUX_KERNEL_CUSTOM_DTS_PATH`, e isso vale apenas para DTS.

A imagem que isso produz é da pior classe: boota, mostra o login do `getty`, e
os 16 botões e os 4 eixos simplesmente não existem. O kernel **não reclama** de
um `compatible` que ninguém atende — o nó fica órfão em silêncio. É o §12.15 na
forma mais cara: não é um device node pela metade, são dezesseis botões que nunca
aparecem.

Correção em quatro peças, cada uma com teste:

| Peça | Por quê |
| --- | --- |
| `scripts/gerar-patch-joypad.mjs` | gera o patch a partir do fonte; o `.c` continua sendo a fonte da verdade |
| `device/r35s/patches/0002-…patch` | leva os arquivos e **liga** `Kconfig`/`Makefile` — arquivo na árvore sem gancho não compila |
| `CONFIG_JOYSTICK_ODROIDGO3=y` | `=y` e não `=m`: módulo que depende do `S15modules` é gamepad que pode não existir no boot |
| `kernel-required.txt` | se o patch parar de aplicar, o símbolo some e o build **falha** em vez de gerar imagem sem botão |

#### O símbolo tem o nome do fornecedor, não um nome bonito

O driver é o mesmo da ROCKNIX, e a config do kernel do aparelho
(`device/r35s/extracted/kernel-config.gz`, md5 `93bf213f…`) tem:

```text
CONFIG_JOYSTICK_ODROIDGO2=y
CONFIG_JOYSTICK_ODROIDGO3=y
CONFIG_JOYSTICK_RGB20S=y
CONFIG_JOYSTICK_XU10=y
```

`ODROIDGO3` é a variante de **um** canal de SARADC atrás de multiplexador — a do
R35S, cujo nó no DTS do vendor se chama `odroidgo3-joypad`. Nomear diferente
("`JOYSTICK_ROCKNIX_SINGLEADC`", que foi minha primeira tentativa) quebra a
única regra que torna o fragmento verificável: **todo símbolo pedido tem de ter
sido observado no aparelho**. O teste do vendor me acusou na hora —
`símbolos inventados: JOYSTICK_ROCKNIX_SINGLEADC` — e estava certo. Nome feio com
prova vale mais que nome bom com exceção.

#### O `ifeq` do Makefile do fornecedor compila a variante errada

```make
ifeq ($(DEVICE),$(filter $(DEVICE), S922X RK3588))
	obj-m := rocknix-joypad.o
else ifeq ($(DEVICE),$(filter $(DEVICE), H700 RK3399))
	obj-m := rocknix-singleadc-joypad.o
```

Dentro do kernel, `DEVICE` nunca está definido. `$(filter ,...)` também é vazio,
então `ifeq (,)` é **verdadeiro** e a primeira variante ganha — sempre. O
resultado seria módulo presente, `modprobe` sem erro, e nenhum botão: o modo de
falha que este repositório existe para não ter. O patch substitui o `ifeq` por
dois símbolos de Kconfig independentes.

#### A regra que faltava no método

O defeito só apareceu porque a verificação foi feita **no cartão**, montando o
`rootfs.ext4` gravado, e não no `target/` do build. O `out/r35s/` tinha `Image`,
DTB e `rootfs.ext4` íntegros; nada nele dizia "falta driver". Quem descobre isso
é `find /lib/modules -name '*joypad*'` no sistema de arquivos que vai para o
aparelho — a mesma lição do §12.27, aplicada ao conteúdo em vez da config.

#### Integrar driver fora da árvore: três armadilhas em sequência

Levar um `.c` de fora da árvore do kernel por patch tem um caminho de falha
próprio, e as três primeiras tentativas falharam por motivos diferentes. Ficam
registradas porque cada uma custou um build:

| Sintoma | Causa | Regra |
| --- | --- | --- |
| `Hunk #1 FAILED at 31` | o patch foi gerado contra uma árvore que **já tinha** o patch, então o `a/` do diff continha as linhas que ele mesmo insere | gere sempre contra fonte limpa; o gerador tem guard que recusa árvore patcheada |
| `No rule to make target '…/rocknix-singleadc-joypad.o'` | `obj-$(CONFIG_X) += foo.o` procura o `.o` em `drivers/input/joystick/`, mas ele nasce em `drivers/input/joystick/rocknix-joypad/` | o caminho do subdiretório é **obrigatório** na linha do Makefile: `+= rocknix-joypad/foo.o`, como `stmm/tee_stmm_efi.o` |
| `modpost: "símbolo" undefined` | dois `.c` num mesmo diretório, cada um como módulo próprio, compartilhando símbolo | um variante por símbolo de Kconfig, nunca os dois juntos |

A terceira já era conhecida do README do aparelho; as duas primeiras não. E
nenhuma das três é detectável por `bash -n` nem por teste de metadados — só um
`patch --dry-run` e um build de verdade pegam. Por isso o teste do patch faz o
dry-run: custa 1 s e teria evitado dois builds.

### 12.45 A ferramenta de diagnóstico consumindo a cota que existe para o defeito

Relatado pela equipe do `Giochi app` em 06/11/2026, medido no R35S:

> Cada `verificar` meu derruba o launcher uma vez para capturar o quadro (o
> KMSDRM é exclusivo). Depois de 5, o `giochi-init` **para de reiniciar** e
> dorme — correto para não entrar em laço de crash, mas o resultado em campo é
> "aparelho ligado, tela parada, nenhum erro na tela".

O `RESTART_MAX=5` estava certo contra a ameaça que ele foi escrito para conter
(launcher quebrado piscando a tela em laço). O erro foi não distinguir **quem**
matou o processo:

| Como o launcher saiu | `$?` | Conta na cota? |
| --- | --- | --- |
| o usuário fechou / o app pediu para sair | `0` | **não** |
| morto por `SIGHUP`/`SIGINT`/`SIGTERM` | `129`/`130`/`143` | **não** |
| segfault, panic, `exit 7`… | qualquer outro | sim |

`128 + sinal` é o que o shell devolve para filho morto por sinal — não há número
inventado aqui. Saída deliberada **zera** a cota (`restarts=0`), em vez de só
deixar de contar: um `verificar` a cada duas horas nunca deve chegar perto do
limite em nenhum cenário, e zerar é mais fácil de provar do que "decrementar".

O que **não** mudou: um launcher que crasha de verdade com cinco segfaults em
60 s continua parando de ser reiniciado. Afrouxar isso trocaria um problema
visível por um pior.

**A segunda metade é o rastro.** "Tela parada" num handheld é indistinguível de
"não ligou", e o console serial (único canal quando o USB não sobe) não é
visível para quem tem o aparelho na mão. A desistência agora grava
`/run/giochi/launcher-parado`:

```text
motivo=quedas_repetidas
quedas=5
janela_s=60
ultimo_status=139
launcher=/opt/giochi/apps/launcher/bin/giochi-launcher
uptime_s=4213
```

O `giochi-selftest` transforma isso em `[FAIL] giochi-init DESISTIU de
reiniciar o launcher: <conteúdo>` — motivo junto, porque "desistiu" sem o porquê
só obriga a abrir o arquivo por SSH.

`tests/giochi-init.test.mjs` cobre os quatro casos rodando o script de verdade
(SIGTERM zera, `exit 0` zera, `exit 139` **continua** consumindo, e a marca é
escrita com `quedas=5`). O caso do crash é o que impede a correção de virar
"nunca desiste de nada".

### 12.46 `/bin/ps` desta imagem mostra só a própria TTY

Medido pela equipe do app no R35S, e é a explicação de um diagnóstico errado
que quase saiu de lá:

```text
$ ps
  169 ttyS2  sh
  184 ttyS2  ps
$ ls -d /proc/[0-9]* | wc -l
94
```

94 processos em `/proc`, dois no `ps`. Entre os invisíveis estavam o `init`, o
`sshd`, o `giochi-init` **e o launcher** — e a conclusão que quase foi escrita
foi "o launcher não está rodando" com ele desenhando a 99,2% na tela.

**Não é defeito.** `/bin/ps` desta imagem é `procps-ng 3.3.17` (`strings
target/bin/ps | grep procps-ng`), e o `ps` do procps-ng **sem argumento**
seleciona "mesmo euid e mesmo terminal" — comportamento herdado do Unix,
documentado no man. O busybox também tem `CONFIG_PS=y`, mas o binário real do
procps-ng ganha do symlink no `target/`.

| Comando | O que lista |
| --- | --- |
| `ps` | só a própria TTY (o que engana) |
| `ps -ef` | tudo |
| `pidof <nome>` | acerta (usa `/proc`) |
| ler `/proc/*/cmdline` | acerta sempre |

**Regra:** ferramenta de diagnóstico desta árvore não usa `ps`. `/proc` não tem
seleção implícita, responde a pergunta feita, e funciona igual em busybox e
procps-ng. `tests/selftest-contract.test.mjs` falha se um `ps` voltar ao
`giochi-selftest`, e um teste irmão confirma que a imagem realmente traz
procps-ng (se um dia o applet do busybox ganhar, o comentário estaria mentindo e
o teste avisa antes).

Família do §12.30 e do §12.34: **o teste perguntou a coisa errada.** Ali foi
`ls` com dois globs, aqui é `ps` com seleção implícita. O padrão que funciona é
perguntar pela consequência — `/proc` responde "este processo existe?" sem
precisar de opção.

### 12.47 `work/` com o caminho do host cravado não retoma dentro do container

`scripts/build-in-container.sh` monta o cache em `/cache` por padrão (caminho
curto e estável). Mas o Buildroot grava o **caminho absoluto** do `host/` no
`RPATH` de cada binário, e o `bin/fakeroot` é um script de shell com o prefixo
literal:

```text
FAKEROOT_PREFIX=/home/charles/.cache/giochi-system/work/r35s/build/host
PATHS=/home/charles/.cache/giochi-system/work/r35s/build/host/lib:...
```

Consequência medida em 06/11/2026, ao retomar um `work/r35s` construído fora do
container: o build compilou **tudo**, chegou ao fim e morreu em `fs/ext2`:

```text
fakeroot: preload library `libfakeroot.so' not found, aborting.
make: *** [fs/ext2/ext2.mk:66: .../images/rootfs.ext2] Error 1
```

A mensagem cita a **biblioteca**, nunca o caminho. `libfakeroot.so` está em
`host/lib` — só que o `host/lib` que o script procura não existe dentro do
container. Meia hora de compilação perdida no último passo.

Antes isto era `GIOCHI_CONTAINER_SAME_PATHS=1`, uma flag para lembrar. Flag que
se esquece não é defesa: agora o script **lê o prefixo cravado** no
`work/<device>/build/host/bin/fakeroot` e monta o cache no caminho que ele
espera, avisando qual foi:

```text
cache:     /home/charles/.cache/giochi-system no container ← ... no host
           (work/ existente foi construído com o caminho do host)
```

Três layouts são reconhecidos, e um quarto é recusado com instrução: prefixo
igual ao `work/` do host (monta no caminho do host), prefixo `/cache/...`
(monta em `/cache`), wrapper sem prefixo (fica no padrão), e **qualquer outro**
— típico de `work/` vindo de outra máquina — aborta antes de compilar nada:

```text
ERRO: o work/r35s existente espera /outra/maquina/work/r35s/build/host,
      que não existe nem no host nem em /cache dentro do container.
      Esse work/ veio de outra máquina: rode sem GIOCHI_SYSTEM_KEEP_WORK=1.
```

`GIOCHI_CONTAINER_SAME_PATHS=1` continua existindo para forçar o layout do host,
mas deixou de ser necessária. A regra geral é a do §12.11 e §12.27: **`KEEP_WORK`
é seguro só quando o ambiente não mudou** — e "ambiente" inclui o caminho onde o
build mora.

### 12.48 Relógio errado gravado no RTC é pior que relógio que se perde

Pergunta da equipe do app em 06/11/2026, medida no R35S:

> O relógio diz 2017, sem RTC e sem rádio. Isso quebrava a licença: emitida em
> 2026, o veredito era "não sei julgar", e não liberava — **nenhuma licença com
> prazo funcionaria no R35S, nunca**. […] tem como o R35S guardar hora?

**Tem.** O `rk808-rtc` está lá e persiste — gravei 13:30:00, li 13:31:57 depois
de um ciclo de energia; o delta é o tempo do boot. E o kernel já faz a leitura:
`CONFIG_RTC_CLASS=y`, `CONFIG_RTC_HCTOSYS=y`, `CONFIG_RTC_DRV_RK808=y`.

O que faltava não era hardware nem símbolo de kernel: era o **caminho de volta**.
Ninguém gravava a hora acertada no RTC, então o boot seguinte voltava para a data
que estava lá. `S50hwclock` fecha isso no `stop` do `rcK` (o `inittab` já tem
`::shutdown:/etc/init.d/rcK`).

Duas decisões de desenho, e a segunda é a que importa:

**1. No `stop`, não no `start`.** No boot o relógio do sistema acabou de vir DO
RTC; gravar de volta é `hwclock -w` de um valor idêntico — escrita em NVRAM sem
ganho. O momento em que o sistema sabe mais que o RTC é o desligamento.

**2. Piso de ano, vindo do build.** Só grava quando o ano do sistema ≥ o ano de
construção da imagem. Sem essa guarda, um boot com bateria de RTC descarregada
(1970) faz o aparelho **nascer** em 1970 para sempre — e nenhum piso de tempo,
nem o do catálogo assinado do app, corrige para trás. Um relógio errado gravado
é pior que um relógio errado que se perde.

O piso tem de ser um dado do build, não um número escrito à mão que envelhece.
`out/<device>/build-info.txt` **não está na imagem** (é artefato de CI), então
`build-device.sh` exporta `GIOCHI_BUILD_INFO_LINHAS` e o `post-build.sh` grava
`/etc/giochi/build-info.txt` no `TARGET_DIR`. Export, não argumento: o Buildroot
chama o post-build com só `TARGET_DIR` e `BINARIES_DIR` (a mesma armadilha do
`HOST_DIR` já documentada no próprio `post-build.sh`).

Sem o arquivo, o reserva é 2024 — funciona, mas é exatamente o tipo de constante
que envelhece em silêncio. `tests/rtc-clock.test.mjs` (7 testes) roda o script de
verdade com `hwclock` instrumentado e cobre: piso do build, recusa em 1970,
gravação em ano válido, ausência de `/dev/rtc0` (desligamento não pode travar),
data ilegível (não pode virar gravação às cegas) e a assimetria `start`/`stop`.

Corolário para o app: depois de acertar o relógio pela UI ou pelo catálogo
assinado, **basta um desligamento normal** para o RTC guardar. Não é preciso
chamar nada — mas se chamarem `hwclock -w` explicitamente também funciona,
porque o applet está na imagem (`CONFIG_HWCLOCK=y` no busybox).

### 12.49 Código depois de um `exit 0` é código morto — e o build fica verde

Ao acrescentar o `/etc/giochi/build-info.txt` (piso do relógio, §12.48), escrevi
o bloco **no fim** do `scripts/post-build.sh`. O build passou, `EXIT=0`, nenhum
aviso:

```text
post-build: verificador-ed25519 compilado
post-build: inittab já chama giochi-init          <- exit 0 aqui
```

O arquivo não apareceu na imagem e o log não disse nada — porque o `echo` que
anunciaria a gravação também estava depois do `exit 0`. A linha 183 é:

```sh
if grep -qxF "$ENTRADA" "$INITTAB" 2>/dev/null; then
    echo "post-build: inittab já chama giochi-init"
    exit 0                     # <- tudo depois disto nunca roda
fi
```

Esse `exit 0` está **certo**: se o inittab já tem a linha, não há o que fazer
*naquele item*. O erro é de estrutura — assumir que "o fim do arquivo" é "o fim
do trabalho". Em build do zero a linha ainda não existe, o `grep` falha, e o
código do fim roda. Só o build **retomado** (o caso normal quando se está
depurando) executa o caminho do `exit 0` e pula o resto.

É a mesma família do §12.11 e do §12.27: **trabalho que depende de "isto ainda
não está feito" não pode ficar depois de um `exit 0` de outro item.** Regra:

- `exit` só no fim lógico do arquivo, nunca no meio de um bloco condicional que
  outros blocos posteriores precisam atravessar;
- blocos independentes vêm **antes** de qualquer `exit` condicional;
- se precisar sair cedo, use uma flag (`JA_TEM_LINHA=1`) e decida no fim.

`tests/rtc-clock.test.mjs` verifica a **ordem** no texto: o índice do bloco do
`build-info.txt` tem de ser menor que o do early-exit do inittab. Teste de
ordem é frágil por natureza, então ele falha com mensagem explícita se um dos
dois marcadores sumir — quem reestruturar o arquivo é obrigado a olhar.

### 12.50 Arquivo criado sem bit de execução é serviço que não sobe

`S50hwclock` foi criado com modo `0644`. `cp -a` do staging preservou o modo, e
o arquivo chegou ao `target/` assim. O build ficou **verde**.

O `rcS` e o `rcK` chamam cada `/etc/init.d/S??*` como `$i start` / `$i stop`:

```sh
for i in $(ls -r /etc/init.d/S??*) ;do
     ...
     $i stop
done
```

Sem `+x` isso é `Permission denied` — uma linha no console entre outras duzentas,
que ninguém lê. O RTC nunca seria gravado, e o sintoma ("a hora não guarda") não
aponta para modo de arquivo.

O `post-build.sh` **já tinha** essa guarda, mas para um arquivo só:

```sh
[ -x "$INIT_BIN" ] || { echo "...giochi-init não está executável"; exit 1; }
```

Ela valia para o `giochi-init` porque foi ele que doeu na primeira vez. É
exatamente o erro de escopo do §12.34: **o teste perguntando por um caso quando
o defeito é da classe inteira.** Agora a guarda varre o diretório:

```text
post-build: script(s) de init sem bit de execução: S50hwclock
post-build: o rcS/rcK chama "$script start" — sem +x o serviço não sobe
```

E `tests/rtc-clock.test.mjs` tem o par barato (10 ms, antes do commit):
todo `S??*` do overlay é executável. O gate do build custa 40 min para descobrir;
o teste custa nada.

**Armadilha do Git:** `chmod +x` no disco não é o que o checkout de outra máquina
vê — o modo vem do índice. Para arquivo novo, `git add` normal já grava `100755`
se o disco estiver certo, mas se ele foi adicionado antes do `chmod`, corrija com
`git update-index --chmod=+x <arquivo>` (ou `git add --chmod=+x`). Conferir com
`git ls-files -s`: a primeira coluna tem de ser `100755`.

## 13. Aparelhos

| ID | Pasta | SoC | Arch | Status | Falta |
| --- | --- | --- | --- | --- | --- |
| `qemu-aarch64` | `qemu-aarch64/` | virtual | arm64 | **ready** | nada — é o smoke test do pipeline |
| `powkiddy-x55` | `powkiddy x55/` | RK3566 | arm64 | draft | **boota com tela, áudio, Wi-Fi, BT e 16 botões + 4 eixos**; falta o launcher (do `Giochi app`) |
| `powkiddy-x35s` | `powkiddy x35s/` | **RK3566** | arm64 | draft | DTS (compartilha com o X35H) e build |
| `powkiddy-x35h` | `powkiddy x35h/` | **RK3566** | arm64 | draft | **boota com tela 640x480, `usb0` e SSH**; imagem de 04/11 já tem o `respawn`. Falta o launcher, o teste A/B de cartão e os eixos analógicos |
| `r35s` | `r35s/` | RK3326 | arm64 | draft | **BOOTOU em 06/11/2026: tela 640x480, `r36s_Gamepad` com 16 botões + 4 eixos, shell serial** (§13-B). Falta áudio e launcher |
| `steamdeck` | `steamdeck/` | x86_64 | x86_64 | draft | kernel, firmware, áudio, Wi-Fi, controle |
| `generic-x64` | `generic-x64/` | x86_64 | x86_64 | draft | **nunca compilado**; `pc_x86_64_efi_defconfig` declarado para permitir dispatch com `allow_draft` |

**X35H e X35S são RK3566** (4× A55, Mali-G52) — não RK3326. O `AGENTS.md`
dizia o contrário e estava errado; a fonte é o `device.conf` **medido** no
antecessor (`GIOCHI_SOC=rk3566`). O **R35S/R36S é que é RK3326** (Cortex-A35),
com pipeline de boot próprio (DDR init, BL31 e U-Boot diferentes). Trocar os dois
manda o build para o lugar errado e o sintoma é o aparelho não sair do Maskrom.

Mapas de botão: saem do **DTS**, não de banco público (`docs/button-maps.md`).
O R35S é o que está mais avançado nisso: o DTB real está versionado em
`device/r35s/dts/` e o `buttons.map` saiu dele. Confirmação final só com
`evtest` no aparelho.

## 13-A. O R35S medido pela serial (06/11/2026)

Primeira leitura real desta placa. O firmware que estava no cartão é **ROCKNIX
(kernel 7.1.2)**, não o nosso — mas é a única referência de hardware que existe,
e ela é medida, não deduzida. Registro completo em
[`device/r35s/README.md`](device/r35s/README.md).

```text
cmdline    boot=UUID=04BC-500B quiet console=ttyS2,1500000 console=tty0
           systemd.debug_shell=ttyS2 uboot.hwid_adc=a,r33s
compatible gameconsole,r35s gameconsole,r36s rockchip,rk3326
model      Game Console R36S
painel     640x480, só card0-DSI-1
entrada    r36s_Gamepad -> js0 + event3
RAM        981 MiB de 1 GB
```

O que isso corrige ou resolve:

| Achado | Consequência |
| --- | --- |
| `/chosen/stdout-path = "serial2:1500000n8"` → `0xff160000` | o console **estava no DTB versionado** desde sempre. A varredura de 12 bauds de 04/11 procurou o que já estava no repositório. Agora está em `device.json` e num teste |
| `compatible` da unidade == o do DTB em `dts/` | confirmado que é o device tree dela, não um parecido da pasta rk3326 |
| `modinfo` → `license: GPL`, `author: ROCKNIX` | o joypad **tem fonte**. Não é caixa-preta; é trabalho de portar |
| o `.ko` é do kernel 7.1.2 | não serve para nós (6.12, `vermagic` diferente). O caminho é o fonte |
| `/` é `loop0` (1,2 GiB) dentro da FAT, e `p2` leva 114 GiB | **prior art** para a partição de dados pendente (ver abaixo) |
| `lsblk` não existe nessa imagem | usar `/proc/partitions` e `df` |

**Herança para a decisão da partição de dados** (o "piso 4 GiB + resto do
cartão" que segue como proposta do dono do projeto): o ROCKNIX resolve o
problema do tamanho fixo **não** tendo o rootfs como partição. A raiz é um
arquivo dentro da FAT de 2 GiB, montado por `loop`; o resto do cartão é uma
partição de dados inteira. Assim a imagem não precisa crescer no primeiro boot,
e o A/B fica trivial (dois arquivos, o extlinux escolhe). Custo medido: escrever
no rootfs exige remontar em `rw`, e o `loop` consome RAM num aparelho de 1 GB.

### Os cinco painéis, medidos

O aparelho sai de fábrica com painéis diferentes. Os cinco overlays do ROCKNIX
foram lidos e guardados em texto em
[`device/r35s/panels/`](device/r35s/panels/README.md) — texto e não `.dtbo`
porque binário no Git não mostra o que mudou.

O driver `rocknix,generic-dsi` **não tem timing no código**: recebe a descrição
como dado, na propriedade `panel_description`, separada por **NUL** (procurar
`\n` devolve tudo numa linha e o parse falha em silêncio).

| Painel | `size` mm | refresh (calc.) | modos | init |
| --- | --- | --- | --- | --- |
| `r36s_clone` | 153×85 | 58,50 Hz | 12 | 24 |
| `r36s-panel1` | 52×70 | 68,54 Hz | 3 | 25 |
| `r36s-panel2` | 52×70 | 77,38 Hz | 3 | 187 |
| `r36s-panel3` | 52×70 | 77,38 Hz | 3 | 188 |
| `r36s-panel4` | 52×70 | **59,94 Hz** | 3 | 155 |

A conta é `refresh = clock ÷ (htotal × vtotal)`. Validação obtida: o `panel4` é o
único que declara o refresh pretendido em comentário (`# 60`, `# 50`, `# 75`), e
a conta dá 59,94 / 50,02 / 75,03 — fecha nos três. Sem essa conferência o modelo
seria só plausível.

**`size` é (lado curto, lado longo), não (largura, altura).** Medido: 70/52 =
1,346 contra 640/480 = 1,333 confere; lido ao contrário daria 0,743 e acusaria
erro em quatro painéis corretos. A checagem de geometria é sem rotação de
propósito.

Avisos que ficam como aviso (o dado não permite decidir):

| Achado | Por que não é `FAIL` |
| --- | --- |
| `r36s_clone`: `size=153,85` (16:9, ~7") com todos os modos 4:3, e é o único **sem `#END`** | 35% de divergência; parece descrição de outro clone, mas não se prova |
| `panel1/2/3` a 29 MHz dão 68,5 e 77,4 Hz, não 60 | pode ser refresh real ou clock para outro alvo; sem datasheet não se resolve |
| `panel2` e `panel3` diferem em um comando | são painéis diferentes; "tanto faz" está errado |

Armadilha medida: o `panel4` tem **dois** `0x11` e **dois** `0x29` (um par no meio
com payload, outro no fim). Procurar "existe 0x11" acha o do meio e o teste passa
a verificar a coisa errada. O que vale é **os dois últimos comandos, nesta
ordem**: `0x29` antes do `0x11` deixa a tela apagada com o driver reportando
sucesso.

Isso **não** permite identificar o painel de um aparelho sem ligá-lo — DSI não
tem EDID. O que passou a existir é comparação: "o panel4 é o de 60 Hz com 155
comandos" em vez de "tenta o panel3".

O material tem valor mesmo com driver diferente: nós usamos mainline (`hx8394` na
X55, `st7703` na X35H), e o caro de obter não é o driver, são as **sequências de
inicialização** — 155 a 188 comandos DCS por painel, agora em texto portável.

### O carregador: gerável, não provado

Uma sessão antes eu escrevi que a imagem "não podia ser gerada" por falta de
loader. **Estava errado e não tinha verificado.** Todos os componentes existem:

| Peça | Onde |
| --- | --- |
| DDR init PX30 | `rkbin: bin/rk33/px30_ddr_333MHz_v2.08.bin` (commit pinado do 2024.02) |
| BL31 PX30 | `rkbin: bin/rk33/px30_bl31_v1.33.elf` |
| U-Boot RK3326 | `u-boot: configs/odroid-go2_defconfig` |

`odroid-go2_defconfig` traz `CONFIG_ROCKCHIP_PX30=y`, `CONFIG_TPL_RAM=y` e
`CONFIG_ROCKCHIP_SDRAM_COMMON=y` — pilha TPL/SPL completa — e, de graça,
`CONFIG_DEBUG_UART_BASE=0xFF160000`, que é **a UART do R35S**. Os offsets do
`make-sd-image.sh` também servem: BootROM do RK3326 e do RK3566 leem o idbloader
no setor 64.

O que continua **não provado** é que boote: o antecessor teve tela preta com
serial mudo no mainline e nunca isolou a causa. A ordem de diagnóstico está no
README do aparelho (serial fala ⇒ loader ok; serial mudo ⇒ TPL/DDR).

### `CUSTOM_DTS_PATH` não serve para esta placa

`BR2_LINUX_KERNEL_CUSTOM_DTS_PATH` copia os DTS para `arch/arm64/boot/dts/` — a
**raiz** (`linux/linux.mk` linha 504) — e o Makefile de lá usa `subdir-y +=
rockchip`. O DTS do R35S faz `#include "rk3326-gameconsole-r3xs.dtsi"`, que vive
em `rockchip/`, então compilar deu:

```text
arm64/boot/dts/arm64/boot/dts/rk3326-gameconsole-r36s-giochi.dtb — sem regra
```

O caminho que funciona é **patch** (`patches/0001-giochi-system-r35s-dts-e-painel.patch`,
988 linhas), que põe os arquivos em `rockchip/` e acrescenta uma linha no
Makefile. Verificado do zero: `patch -p1` limpo, `.dtb` de 54 469 B.

**O campo `dtsPaths` continua no schema** (validado e testado) porque serve para
aparelho cujo DTS não precise de `#include` de irmão. Só não é o caminho deste.

**Pendência sem resposta:** `uboot.hwid_adc` desta unidade reporta **`r33s`**,
divergindo do `compatible` (`r35s`/`r36s`) e do `model` (R36S). Não se sabe se é
a tabela do U-Boot ou reaproveitamento. Enquanto não estiver entendido, **não**
usar esse ADC para escolher overlay de painel — seria a mesma classe de falha do
§12.26 (herdar premissa de outro aparelho e não perceber).

**O teste que prende isso:** `tests/device-r35s-console.test.mjs` (7 casos) lê o
DTB versionado e exige que `device.json` declare o mesmo console. Mexer num sem o
outro falha ali, não num aparelho com tela preta. Ele já pegou uma sutileza: com
`#address-cells = 2` o `reg` é endereço de 64 bits, e ler só o primeiro u32
devolve zero — teste que passaria sem testar nada.

E `tests/dsi-panel.test.mjs` (16 casos) prende os cinco painéis: identidade,
refresh declarado contra calculado, geometria sem rotação, e a armadilha dos dois
`0x11`. Os dois testes que falharam na primeira execução eram **bug meu no
parser** (`#END` começava com `#` e era descartado como comentário vazio, então
todo painel saía "SEM #END") e uma premissa errada (`.find()` pegava o `0x11` do
meio). Vale como lembrete: teste que falha costuma estar certo.

## 13-B. O R35S BOOTOU — tela, botões e shell (06/11/2026)

**Primeiro boot com a nossa imagem.** Não é estimativa: o console serial a
1500000 entregou o login, e tudo abaixo foi lido por SSH serial no aparelho.

```text
Giochi System 6.12.0 (/dev/console)
giochi-system-r35s login:
# uname -a
Linux giochi-system-r35s 6.12.0 #1 SMP PREEMPT ... aarch64 GNU/Linux
```

| Capacidade | Estado medido |
| --- | --- |
| Boot até o `getty` | **PASS** — `::respawn:/usr/bin/giochi-init` no inittab |
| Painel | **640x480, `card0-DSI-1` connected**, `fbcon` em 80x30, backlight 128/255 |
| `/dev/dri` | `card0` (era **vazio** antes do patch do painel) |
| Gamepad | `r36s_Gamepad` em `event1`, EV_KEY + EV_ABS + EV_FF |
| Botões | **16 bits** em `capabilities/key` |
| Eixos | **8 bits** em `capabilities/abs` (4 pares) |
| `usb0` | UP, `10.55.0.2` (o PC não tinha RNDIS, então foi por serial) |
| Áudio | **sem soundcard** — `--- no soundcards ---` |
| Launcher | ausente (é do `Giochi app`) |

`giochi-selftest`: **PASS 27 · WARN 8 · FAIL 4 · SKIP 5** — e **dois dos quatro
FAIL eram falso negativo**, corrigidos nesta mesma sessão (abaixo).

### As três causas que impediram o boot, na ordem em que apareceram

| Sintoma no aparelho | Causa | Onde está |
| --- | --- | --- |
| `Enter choice:` para sempre, `not found` repetindo | `menu title` liga `prompt=1` e ignora o timeout; CR vazio vira escolha inválida e `m->timeout = 0` | §12.38 |
| Boota, login, **tela preta** | `compatible = "rocknix,generic-dsi"` sem driver → `panel@0` órfão → sem conector → sem `/dev/dri` | §12.39 |
| Botões e eixos ausentes (antes do patch) | `compatible = "rocknix-singleadc-joypad"` sem driver | §12.39 |

As duas últimas são a **mesma classe**: o DTS declara um `compatible` fora da
árvore, e ninguém levava o `.c` para dentro do kernel. O kernel não reclama de nó
órfão, então as duas falhas são invisíveis no `dmesg` — só `ls /dev/dri` e
`/proc/bus/input/devices` denunciam.

### Dois FAIL falsos, e o padrão que eles repetem

Com a tela funcionando, o `giochi-selftest` ainda acusava:

```text
[FAIL] sem gpio-keys-control — nenhum botão de gamepad
[FAIL] sem adc-joystick — os analógicos não existem (CONFIG_JOYSTICK_ADC?)
```

Os dois eram falsos: `r36s_Gamepad` estava em `event1` com 16 botões e 8 bits de
eixo. O teste procurava o **nome do driver dos outros aparelhos** (X55/X35H usam
`gpio-keys`, mainline usa `adc-joystick`) e o R35S usa o `rocknix-joypad`.

Correção pelo mesmo princípio do §12.30/§12.34: perguntar pela **consequência**.
Agora ele aceita os três nomes, conta `capabilities/key` e `capabilities/abs` de
quem existir, escolhe o nó com mais botões (para não pegar `gpio-keys-vol`) e
**reporta o nome de origem** no `PASS`. `tests/selftest-contract.test.mjs` prova a
lógica em sysfs sintético, com os dois nós.

### O que a tela preta ensinou sobre diagnosticar

Enquanto eu perseguia MMC e tabela de partição, o kernel **já estava bootando**.
O que separou os dois mundos foi ler o console em vez de inferir pelo sintoma
visual: "tela preta + LED aceso" tem pelo menos quatro causas com o mesmo
aspecto — kernel que não carrega, kernel sem driver de painel, painel sem
backlight, e backlight sem conteúdo. Só o texto da serial distingue.

### Como atualizar o aparelho sem tirar o cartão

O cartão estava dentro do aparelho e o PC só tinha TTL (sem RNDIS no `usb0`).
`docker/serial-push-blob.py` envia por heredoc + base64 com md5 dos dois lados:
14,9 MB (o `Image` comprimido) em **193 s a ~100 kB/s**.

Duas armadilhas medidas, as duas silenciosas:

| Armadilha | Efeito |
| --- | --- |
| eco do tty ligado | o arquivo remoto ficou com **0 byte** e o shell entrou em modo continuação (`>`), porque uma linha chegou cortada no meio de uma aspa |
| um `printf` por bloco (700 chars) | o shell parseia 14 mil comandos; quando o buffer do tty enche, bytes são descartados sem erro — md5 divergia a 38 kB/s, que parecia "ok" |

Heredoc não parseia linha nenhuma: `cat` copia e a linha do base64 atravessa na
velocidade do link. A troca subiu a taxa de 38 para 100 kB/s **e** o md5 passou a
bater. O destino é `Image.new`, e o `Image` só é substituído depois de o md5
conferir no aparelho — se a transferência cair, o aparelho continua bootando.

## 14. Próximos passos, por ordem de risco

1. **Interface de jogos (produto, não sistema).** Os controles de hardware estão
   completos: 16 botões físicos + 4 eixos, medidos no aparelho. O que falta é o
   launcher, que é do `Giochi app` — este repositório entrega o sistema.

   **A dúvida do driver de GPU não bloqueia este item.** Medido e decidido em
   [`docs/gpu-drivers.md`](docs/gpu-drivers.md): o panfrost entrega GLES 3.1 com
   compute e sem geometry shader, e **launcher, SDL2 e Godot 4 Compatibility não
   precisam de geometry shader**. O driver custa exatamente uma coisa — arcade
   sem o nosso patch — e essa já tem solução medida. Não reabrir a discussão sem
   ler aquele documento.
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

- **GPU: Mesa/panfrost na imagem, blob da ARM fora dela.** O panfrost entrega
  GLES 3.1 com compute e sem geometry shader; o `libmali` da ARM entrega 3.2 com
  geometry shader e é proprietário (~59 MB, termos próprios).
  Decidido em 06/11/2026, com o `features.txt` do Mesa 24.0.0 da própria árvore
  lido e o hardware medido: [`docs/gpu-drivers.md`](docs/gpu-drivers.md).
  O custo do panfrost é **um** item (arcade sem patch, e o patch existe);
  launcher, SDL2 e Godot 4 Compatibility passam. O blob, se um dia for
  necessário, vai **pela loja**, nunca na imagem base — o artefato de CI é
  público e a pergunta de redistribuição não tem resposta nossa.
  `tests/gpu-drivers.test.mjs` falha se alguém puser `libmali` num fragmento.
- **Handheld renderiza em SDL2 + KMSDRM, sem servidor gráfico.** Avaliado o
  [Quiver Launcher](docs/evaluacao-quiver-launcher.md) em 04/11/2026 e
  **recusado** por quatro bloqueios independentes: licença BSL 1.1 (proíbe
  distribuir para terceiros), GTK3/WebKit exigirem servidor gráfico, Rust 1.90
  contra 1.74.1 da árvore, e 490–770 MiB de RAM (picos de 1,3 GiB) num aparelho
  de 2 GB. Quem quiser o app instala pela loja; para o `generic-x64` ele roda
  como qualquer binário de desktop. `tests/graphics-stack.test.mjs` impede a
  volta por uma linha de defconfig.
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

- **X55, X35H e R35S bootam com a NOSSA imagem** (X55: tela, áudio, Wi-Fi, BT,
  16 botões e 4 eixos; X35H: tela 640x480, `usb0` e SSH; R35S: tela 640x480,
  `r36s_Gamepad` com 16 botões + 4 eixos e shell serial, §13-B). Os três
  continuam `draft` porque `ready` exige a interface, que é do `Giochi app`.
- **O R35S ainda não tem áudio**: `--- no soundcards ---` e `libasound` ausente.
  O card `rk817_int` não aparece, provavelmente `deferred probe` do ASoC.
- X35S e Steam Deck nunca bootaram; X35S nem tem defconfig.
- O build completo do `qemu-aarch64` passou no CI (run #15). O build local do X55
  passou em 04/11, mas **nunca no CI** — o dispatch do X55 ainda não foi reenviado.
- `bash -n` prova sintaxe, não comportamento; o `sh` local não é busybox ash.
- `.config` interno em `work/` contém a senha real — não publique `work/`.
- `buildroot.config` no artefato é redigido; o hash do `SHA256SUMS` é do arquivo
  redigido, não do `.config` real.
- Sem assinatura, OTA, atualização ou Release.

## 18. Como retomar

### Estado no fim da sessão de 04/11/2026 — leia isto primeiro

**A imagem do X55 com o `respawn` EXISTE e foi verificada dentro do
`rootfs.ext4`.** O build retomado com `KEEP_WORK=1` terminou com exit 0, o
`post-build` reinseriu a linha e o `debugfs` a encontrou no arquivo que vai para
o cartão — não só no `target/`.

| Item | Estado |
| --- | --- |
| Código e configuração | **pronto** — 150/150 testes, tudo no `origin` |
| Imagem X55 (`Image` + `rootfs.ext4` + DTB + bootloader) | **existe** em `out/powkiddy-x55/`, `built_at_utc=2026-11-04T21:05:13Z` |
| `/etc/inittab` na imagem | **linha 30: `::respawn:/usr/bin/giochi-init`** — conferida com `debugfs` no `rootfs.ext4` |
| `work/` do X55 | preservado em `~/.cache/giochi-system/work/powkiddy-x55` (17 GB, já com `target/` finalizado) |
| Imagem X35H em `out/` | **refeita em 04/11** (`built_at_utc=21:14:18Z`), agora com o `respawn`; a `.img` de cartão continua a de 03/11 |

O comando que retoma (ou refaz a etapa final) sem recompilar tudo:

```bash
ALLOW_DRAFT=1 GIOCHI_SYSTEM_KEEP_WORK=1 bash scripts/build-in-container.sh powkiddy-x55
```

Detalhe medido no retomado: **`KEEP_WORK=1` não pula o `target-finalize`.** O
`make` do Buildroot chega ao fim em poucos minutos e o `post-build` roda de
novo — é por isso que a linha do `respawn` entrou sem rebuild dos pacotes. Se o
`work/` fosse apagado, seriam ~40 min.

A verificação que a equipe do app pediu, e que é barata, roda sem root:

```bash
docker run --rm -v "$PWD/out/powkiddy-x55:/a:ro" --entrypoint bash giochi-builder:2 \
  -c 'debugfs -R "cat /etc/inittab" /a/rootfs.ext4' | grep giochi-init
```

Sem essa linha, a interface não sobe no boot e é exatamente o teste que eles não
conseguem simular.

### As quatro falhas de host, e por que a sessão parou aqui

Todas são do AMBIENTE (GCC 15.2, CMake 4.2.3), não do projeto, e todas só
aparecem em build do zero — CI verde não prova nada sobre elas. Detalhe em §12.32
e §12.33; resumo:

| Falha | Onde morreu | Correção |
| --- | --- | --- |
| CMake 4.x recusa mínimo 3.4 | `host-hiredis` | `CMAKE_POLICY_VERSION_MINIMUM=3.5` no `build-device.sh` |
| C23 `[[nodiscard]]` inválido | `host-m4` | `HOST_CFLAGS += -std=gnu17` |
| declaração implícita é erro no GCC 14+ | `host-libffi` | `-Wno-error=implicit-function-declaration` |
| `-std=gnu17` em C++ com `-Werror` | `host-ccache` (**CI**) | `override HOST_CXXFLAGS = $(filter-out …)` |

A última foi **causada por mim** e derrubou o CI: eu tinha escrito que as flags
de C não vazavam para C++. Vazam, porque `HOST_CXXFLAGS += $(HOST_CFLAGS)` é
expansão recursiva. Vale ler esse trecho do §12.33 antes de mexer nas flags de
host de novo — a lição não é sobre flags, é sobre eu ter declarado "inofensivo"
sem medir o build completo.

### Pendências que não são de build

1. **As três perguntas ao time do app foram respondidas** (04/11, no canal):
   - **Godot 4 = Compatibility (GLES3).** Vulkan não se declara. Não é economia
     de espaço, é contrato: `graphics_api_min: vulkan` no `forge.json` é sempre
     recusado pelo validador, e Forward+ está fora por isso.
   - **`python3` não entra no rootfs**, e o motivo não é o tamanho: `pygame` é
     LGPL-2.1 e a regra de licença recusa LGPL na imagem assinada. Jogo que
     precisa de Python vai pela loja (`distribution: store`), com o runtime no
     `/user`.
   - **Dados da loja: piso de 4 GiB + o resto do cartão.** É proposta deles, o
     número é do dono do projeto — não implementado (item 3 abaixo).
2. **~~`gles-probe` nunca executado~~ — EXECUTADO em 06/11/2026 no R35S**, pela
   variante em Python (`scripts/gles-probe.py`) porque o aparelho não tem
   compilador. Resultado medido, e o que ele **não** prova:

   ```text
   GL_RENDERER = Mali-G31 · GL_VERSION = OpenGL ES 3.2 · MAX_SAMPLES = 4
   GL_OES_geometry_shader = SIM   (104 extensões)
   ```

   Esse número é do **blob da ARM** (`libmali-bifrost-g31-g29p1.so`, 59 MB,
   `mali_kbase` carregado), que é o que o ROCKNIX entrega. **O nosso sistema
   entrega Mesa/panfrost**, e é o panfrost que não expõe geometry shader. A
   diferença não é de chip, é de driver empacotado — ver
   [`docs/evaluacao-pyglet-arcade.md`](docs/evaluacao-pyglet-arcade.md).

   Continua pendente o que o probe foi escrito para responder: **o número do
   nosso stack** (Mesa 24.x do Buildroot 2024.02, `panfrost`). Para isso é
   preciso a nossa imagem num aparelho livre, ou o A/B `rmmod mali_kbase` +
   `modprobe panfrost` — que **não foi feito** porque congelaria a tela de um
   aparelho que não é nosso e estava em uso.
3. **Partição de dados da loja** — proposta de piso 4 GiB + resto do cartão. Não
   implementado, e há duas consequências de desenho antes de codar: a `.img` tem
   tamanho fixo (2 GiB hoje), então "o resto do cartão" só existe se a partição
   crescer no primeiro boot; e gravar a imagem apaga os dados do usuário. Ver
   [`docs/flashing.md`](docs/flashing.md).
4. **Janela do chat: 08:00–18:50 (Brasília).** Fora dela não há troca de
   mensagem. Ver [`docs/mensagem-giochi-system.md`](docs/mensagem-giochi-system.md).

### Disponibilidade dos aparelhos — pergunte antes

| Aparelho | Estado | Consequência |
| --- | --- | --- |
| `powkiddy-x55` | **em uso pelo time do `Giochi app`** (launcher) | não usar para teste; **avisar com antecedência** se precisar |
| `powkiddy-x35h` | **conectado, mas em uso** (04/11) | **indisponível momentaneamente** — nem SSH, nem serial, nem reboot |

A X55 continua conectada (USB e TTL) mas está **ocupada**. Não rode nada nela
sem combinar antes: um reboot ou uma gravação de cartão interrompe o trabalho de
quem está usando. O mesmo vale para `adb`/SSH/serial — conectar já interfere.

Ordem sugerida para a próxima sessão (nada aqui precisa da X55):

```bash
node scripts/validate-devices.mjs      # 6 devices, 1 habilitado
node tests/run-all.mjs                 # 150/150
node scripts/list-devices.mjs --github-matrix
```

Depois, no GitHub (não há como disparar dispatch sem token daqui):

1. Actions → *Build Giochi System ARM64* → Run workflow
2. `device: powkiddy-x55`, `allow_draft: true`
3. Se falhar, o passo que interessa é o **Build image**, e a mensagem do
   `assert-config` vem com o nome do símbolo. Sem token, `GET
   /actions/jobs/<id>/logs` devolve 403 — leia pela interface.

Estado do Git nesta revisão: `main` sincronizado com `origin/main`, remoto
`https://github.com/xtrempkch-droid/GIOCHI-SYSTEM.git`. **Push por SSH**
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
