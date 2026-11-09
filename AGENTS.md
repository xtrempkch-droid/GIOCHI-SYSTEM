# AGENTS.md — Giochi System

> Handoff técnico do repositório. Leia antes de continuar o trabalho.
> Atualizado em: 08/11/2026 (revisão 8 — **auditoria em três passadas + uma no aparelho**. Vinte e três defeitos encontrados, todos do tipo "verde e errado", e todos
> com teste que os prende. Os mais graves: o gate do harfbuzz **nunca disparou**
> (dependia de variável `BR2_*` que o Buildroot não exporta ao post-build); um
> patch de kernel ausente matava o build **sem imprimir nada**; **dois dos três
> Kconfigs da árvore não tinham verificação nenhuma** (busybox e o `defconfig`
> do aparelho); e o **`tar gzip` e o `depmod` estavam fora da imagem** — o que a
> leitura de `Kconfig` previu e o X55 ligado por SSH confirmou. Ver §12.59 a
> §12.62. A quarta passada foi medida **no X55**, com a imagem anterior a todas
> as correções: o splash ficava na tela para sempre (`/tmp/psplash_fifo` nunca
> existiu — o real é `/run/`), o console de texto nunca aparecia
> (`DEFERRED_TAKEOVER` sem gatilho), e **1203 das 1260 linhas do `dmesg`** eram
> ruído de carregador, o que tornava inútil o log de bring-up. Ver §12.62.)

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
- 7 aparelhos registrados: `qemu-aarch64` (único habilitado) + 6 drafts.
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
| `node tests/run-all.mjs` | **510/510** (host-compat 6, dongle 7, buttons-map, cmdline, bootlog, base-system, boot-layer, launcher-deps, devices 13, assert-config 12, fdt 11, gpu-bench 16, …) |
| `node scripts/validate-devices.mjs` | OK — 7 devices, 1 habilitado |
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

- ~~**`buildrootFragments` (plural)** e **`firmwareFiles`** seguem aceitos na
  documentação e **não** lidos por script.~~ **Corrigido em 08/11/2026:** os dois
  são lidos. `build-device.sh` faz `mapfile -t EXTRA_FRAGMENTS < <(device-info
  buildrootFragments)` e passa cada um ao `prepare-config` (staging sem espaço,
  depois do fragmento principal), e faz `mapfile -t FIRMWARE_DECL < <(device-info
  firmwareFiles)` copiando para `/lib/firmware` com a subpasta preservada.
  Os dois têm validação de existência no schema e teste no `validate-devices`.
  `firmware-required.txt` continua sendo a conferência de **presença no rootfs** —
  é outra pergunta ("o arquivo saiu na imagem?"), não a de origem.
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

Campos lidos pelos scripts: `buildrootFragments` (por área, depois do
principal), `kernelPatches` (`BR2_LINUX_KERNEL_PATCH`, com hash de estado),
`firmwareFiles` (copiados para `/lib/firmware`), `dtsPaths`, `bootloader`,
`kernelCmdline`, `panel`.

> Esta linha dizia o contrário até 08/11/2026 — que os três primeiros eram
> "aceitos na documentação mas não lidos por script". O `build-device.sh` já os
> lia; o documento é que estava velho. Campo que a doc diz que não funciona e
> funciona é dívida na direção oposta, e custa o mesmo: alguém reimplementa o que
> existe.

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
node tests/run-all.mjs                          # 510 testes
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
bash scripts/gpu-bench.sh powkiddy-x55 --run --repetir 3   # throughput: fill, ALU, textura, draw (§12.63)
bash scripts/gpu-bench.sh powkiddy-x55          # só compila o benchmark
bash scripts/audio-alerta.sh --alar             # tom pela via SDL2 -> ALSA
bash scripts/engine-build.sh r35s --instalar    # compila a GIOCHI-ENGINE
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

`node tests/run-all.mjs` → **510/510**, em **56 arquivos**. A tabela abaixo é uma
seleção dos que prendem contratos de projeto; a lista completa é `ls tests/` e
`tests/runner-coverage.test.mjs` **falha** se algum arquivo existir sem estar
importado no `run-all.mjs` — foi assim que dois testes desta revisão quase
ficaram fora da contagem.

| Arquivo | Testes | Cobre |
| --- | --- | --- |
| `tests/devices.test.mjs` | 13 | índice, schema, pastas com espaço, matriz, draft habilitado, `allowDraft` por id vs `all`, mensagem de recusa |
| `tests/assert-config.test.mjs` | 12 | símbolo que sobrevive, desaparece, cai `=y`→`=m`, pedido-desligado-veio-ligado, `allow-drop`, aspas |
| `tests/busybox-config.test.mjs` | 7 | o terceiro Kconfig da árvore, que não tinha gate nenhum: applet que existe, applet renomeado (§12.16) e applet impossível (`depends on`) |
| `tests/defconfig-gate.test.mjs` | 4 | o `defconfig` do aparelho passa pelo `assert-config`: símbolo pedido não pode sumir em silêncio, e pacote que depende de fragmento não pode morar no defconfig |
| `tests/fdt.test.mjs` | 11 | parse de DTB, gpio-keys, adc-joystick, `buttons.map`, truncado/ inválido |
| `tests/cmdline.test.mjs` | 12 | cmdline da X55 idêntica à que bootou, console sem baud, `fbconRotate:0` ≠ ausente, `video=`, recusa de campo desconhecido |
| `tests/device-x35h.test.mjs` | 10 | identidade do aparelho: DTS próprio, ST7703 e não HX8394, sem rádio, patches existem, DTS herda o da X55, 16 botões sem `BTN_MODE` |
| `tests/buttons-map.test.mjs` | 6 | mapa parseável, sem duplicata, 16 obrigatórios, exatamente 1 `OPCIONAL` (o `BTN_MODE`) |
| `tests/prepare-config.test.mjs` | 8 | caminho com espaço recusado, fragmentos anexados, senha |
| `tests/assert-kernel-config.test.mjs` | 8 | `CONFIG_*` que sobrevive/desaparece/cai para `=m`, `--required` |
| `tests/firmware-required.test.mjs` | 5 | `rtl8821cs_*` no override, firmware obrigatório presente |
| `tests/buildroot-hash.test.mjs` | 2 | hash do tarball fixado e usado |
| `tests/gpu-bench.test.mjs` | 16 | as seis formas de o benchmark mentir (§12.63): shader de cor constante, laço afim colapsado, tile não reescrito, `glGetUniformLocation` no laço, `300 es` no compute, e a subtração de custo fixo por diferencial (que mede desenho eliminado) |
| `tests/audio-alerta.test.mjs` | 3 | a duração anunciada chega ao probe e nenhum aparelho está cravado no script (§12.65) |
| `tests/base-system.test.mjs` | 19 | contrato do sistema base: udhcpd, RNDIS (não ECM), `os_desc` completo, `PermitRootLogin`/`UseDNS`, dropbear ausente, recusa de build com pacote removido |
| `tests/post-build-harfbuzz.test.mjs` | 5 | o gate do harfbuzz roda no `EXTRA_ENV` REAL do Buildroot (sem nenhum `BR2_*`); reprova biblioteca presente + `sdl2_ttf` sem ela, e aceita "não pediu" |
| `tests/flash-guards.test.mjs` | 4 | a classe inteira: `flash-sd.sh` **e** `flash-dd.sh` recusam o disco de `/` e `/boot`, antes do `dd` |
| `tests/ci-cache-e-sd-image.test.mjs` | 6 | cache do CI salva o `BR2_DL_DIR` que o script usa (`.cache/dl`), docs batem, e `make-sd-image.sh` não tem DTB de reserva de outro aparelho |
| `tests/build-device-vars.test.mjs` | 7 | variável não atribuída aborta o build; o estado de patches/fragmento roda de verdade, inclusive com patch ausente (falha alto, não em silêncio) |
| `tests/serial-login-path.test.mjs` | 3 | o caminho de recuperação de login do `serial-push-blob.py` (`str`/`bytes`), executado com um `serial` falso — o caminho que só roda quando o console NÃO está no shell |
| `tests/help-sentinels.test.mjs` | 4 | nenhum script fatia `--help` por número de linha (a classe que quebrou em 2 de 13) |
| `tests/bootlog-dmesg-spam.test.mjs` | 4 | o `awk` REAL do `giochi-bootlog` sobre 300 repetições do charger: agrupa, conta, e **preserva** as duas linhas de `fbcon` que estavam no meio |
| `tests/hardware-x55.test.mjs` | 5 | o que o X55 desmentiu: `model`×`compatible` normalizados, `present=0` ≠ 0%, fbcon ausente ≠ `CONFIG_ROTATION` desligado, sem `dropbear` no status, `giochi-usb` sem role-switch |

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

### 12.16 `amixer` existe no Buildroot — mas como subopção DESLIGADA

**Esta seção estava errada por onze revisões.** O que estava escrito: "o
`BR2_PACKAGE_ALSA_UTILS` não traz `amixer`". O fato, lido no `Config.in` do
2024.02:

```text
package/alsa-utils/Config.in
  config BR2_PACKAGE_ALSA_UTILS_ALSACTL
      default y
  config BR2_PACKAGE_ALSA_UTILS_ALSAMIXER
      default y
  config BR2_PACKAGE_ALSA_UTILS_AMIXER      ← existe; SEM default
  config BR2_PACKAGE_ALSA_UTILS_APLAY       ← existe; SEM default
  config BR2_PACKAGE_ALSA_UTILS_SPEAKER_TEST ← existe; SEM default
```

Ou seja: só `alsactl` e `alsamixer` entram sozinhos. Todo o resto —
`amixer`, `aplay`, `arecord`, `speaker-test` — é subopção explícita. "Não
existe" e "não vem ligado" dão o **mesmo** sintoma numa imagem, e por isso a
confusão sobreviveu tanto tempo: o `command -v amixer` falha nos dois casos.

Medido no rootfs do R35S antes da correção:

```text
/usr/bin:  alsamixer
/usr/sbin: alsactl
(faltando: amixer, aplay, arecord, speaker-test)
```

Consequência que dói: sem `aplay` nem `speaker-test`, **não há como provar que o
alto-falante toca** numa imagem recém-gravada. E sem `amixer` o script não lê
controle de mixer em uma linha — `alsactl -f /tmp/s.state store` funciona, mas
devolve o estado inteiro em formato de arquivo, não um valor.

Correção: os três estão ligados nos defconfigs dos dois aparelhos com tela.
`speaker-test` de propósito — é o único teste de áudio que não precisa de arquivo
de mídia, e a imagem não tem mídia.

**Regra que fica:** antes de escrever "o Buildroot não tem X", ler o
`package/<x>/Config.in` e procurar `BR2_PACKAGE_<X>_<SUFIXO>`. A maioria dos
pacotes de ferramentas é um menu com subopções, e o default costuma ser mínimo.
A diferença entre "não empacotado" e "empacotado e desligado" muda a correção: a
primeira exige receita nova, a segunda é uma linha.

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
| `scripts/gerar-patch-modulos.mjs` | gera o patch a partir do fonte; o `.c` continua sendo a fonte da verdade. Gera **os dois** (`joypad` e `painel`), e `--check` confere que o patch continua em dia |
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

### 12.51 `softpipe` responde "GLES 3.1" — a versão não prova que a GPU existe

Medido no R35S em 06/11/2026, com a nossa imagem (`commit=779fc64`).

O fragmento do aparelho declarava:

```make
# GPU. `=m` como no vendor: o driver pode ser carregado depois, e assim o
# `mali_kbase` proprietário também pode, se algum dia a loja oferecer.
CONFIG_DRM_PANFROST=m
```

O raciocínio foi copiado do vendor e é errado por duas vias. A primeira é que o
rootfs do Buildroot **não tem `/etc/modules` nem `modules-load`**: o `.ko` fica
no disco e ninguém o carrega. A segunda é que `mali_kbase` e panfrost disputam o
mesmo nó `gpu@ff400000` — nunca conviveriam carregados, então o `=m` não comprava
nada. É a armadilha do §12.43, uma camada acima.

O resultado no aparelho: `/dev/dri/` com só `card0`, nenhum `renderD128`.

**O que faz isso ser perigoso, e não só quebrado.** Sem panfrost a Mesa cai no
`swrast`, e o probe responde:

```text
com panfrost:  GL_RENDERER = Mali-G31 (Panfrost)   GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
sem panfrost:  GL_RENDERER = softpipe              GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
```

**A `GL_VERSION` é idêntica**, e o veredito do probe ("GLES respondeu") também.
Quem pergunta "tem GLES 3.1?" — que é a pergunta que o `forge.json` faz para
declarar capacidade, e a que qualquer teste ingênuo faz — recebe **sim** nos dois
casos, com o aparelho renderizando na CPU de 1 GB. `kmscube` também roda.

A única pergunta que separa GPU de CPU é **`GL_RENDERER`**. É a mesma família do
§12.29 ("biblioteca presente não prova uso") e do §12.30 ("o teste perguntou a
coisa errada"): o indireto respondeu, e a resposta não distinguia nada.

**Regra que fecha:** GPU é hardware **onboard**, presente em todo boot — então
`=y`, como já era no X55 e no X35H. `=m` é para hardware que pode **não estar
lá** (dongle Wi-Fi, §12.31), nunca para o que sustenta a tela.

Peças da correção:

| Peça | Por quê |
| --- | --- |
| `CONFIG_DRM_PANFROST=y` no fragmento do R35S | onboard: carrega no boot, sem depender de script |
| `CONFIG_DRM_PANFROST=y` na `kernel-required.txt` dos **três** aparelhos com GPU | o fragmento é delta; sem o gate o símbolo some e a imagem sai verde e sem GPU |
| `tests/gpu-drivers.test.mjs` | proíbe `CONFIG_DRM_PANFROST=m` em qualquer aparelho e exige o símbolo no `kernel-required.txt` |
| `giochi-selftest` | sem render node, ele agora **nomeia o módulo** e a correção (`=y`, não `=m`) em vez de "3D pode não inicializar" |

#### A GPU não estava sozinha: bateria e térmica caíram na mesma armadilha

Depois de corrigir o panfrost, os dois WARNs que sobravam no selftest —
`sem bateria detectada` e `sem zona térmica` — foram investigados por serem
suspeitos: o R35S **tem** bateria. Os dois eram o mesmo defeito, na mesma imagem,
na mesma sessão. E o hardware respondeu a um `modprobe` manual em ambos:

| Peça | DT declara | Antes | `modprobe` → | Depois |
| --- | --- | --- | --- | --- |
| bateria | nó `charger` no `rk817`, com `monitored-battery` para o `simple-battery` | `/sys/class/power_supply/` **vazio** | `rk817-battery` (`TYPE=Battery PRESENT=1 STATUS=Discharging`) + `rk817-charger` (`TYPE=USB`) | `CONFIG_CHARGER_RK817=y` |
| térmica | `thermal-zones` com `soc-thermal` e `gpu-thermal` | só `cooling_device0/1` órfãos, nenhum `thermal_zone*` | `thermal_zone0 = soc-thermal 44090`, `thermal_zone1 = gpu-thermal 47727` | `CONFIG_ROCKCHIP_THERMAL=y` |

Os dois símbolos vinham **`=m` do defconfig arm64**, e o fragmento do R35S
simplesmente não os mencionava — enquanto o X55 e o X35H já os tinham `=y` desde
o começo. Ou seja: não foi uma decisão, foi um **esquecimento**, e a diferença
entre os aparelhos é o que o denuncia. É o §12.26 na forma silenciosa: o que não
está escrito não dá erro.

Consequência de produto, não de laboratório: sem `power_supply`, a interface não
tem nível de carga para mostrar e o aparelho desliga sem aviso; sem
`thermal_zone`, não há proteção térmica — o `tsadc` fica sem cliente.

`tests/onboard-drivers.test.mjs` prende a invariante nos três aparelhos RK:
`CONFIG_DRM_PANFROST`, `CONFIG_CHARGER_RK817` e `CONFIG_ROCKCHIP_THERMAL` têm de
estar `=y` **e** na `kernel-required.txt`. Não é sobre estes três nomes: é sobre
hardware que existe em todo boot não poder depender de um autoload que o rootfs
não tem.

**O amplificador continua `=m`, de propósito.** `CONFIG_SND_SOC_SIMPLE_AMPLIFIER=m`
é o que o X55 precisou mudar para `=y` (§3) porque o DTS dele tem
`aux-devs = <&spk_amp>`. O `rk817-sound` do R35S **não tem** `aux-devs` — conferido
no DT do aparelho —, então lá o módulo é código morto e não faz falta.

#### O selftest também perguntava ao dispositivo errado
O bloco de 3D lia o driver de **`card0`** e comparava com uma lista de GPUs. Mas
`card0` é o controlador de *display* (`rockchip-drm`, `msm`…) — o panfrost mora no
**render node**, outro minor. Em aparelho saudável o resultado era sempre

```text
[WARN] driver DRM 'rockchip-drm' — não é GPU conhecida; 3D pode ser software
```

— um WARN falso em cima de uma GPU funcionando. Agora a pergunta é feita a
`/sys/class/drm/renderD128/device/driver`, com as `card*` como reserva. Medido nos
dois estados no aparelho: `[PASS] driver de GPU reconhecido: panfrost` com, e o
WARN com a causa sem.

#### `gles-probe.sh` nunca tinha compilado

O script usava `-static -lEGL -lGLESv2`. O Buildroot não instala `libEGL.a`, então
ele morria no linker com `cannot find -lEGL` — e ninguém percebeu porque o script
está na lista dos que não têm teste. Ligar estaticamente também estaria errado
por princípio: mediria a Mesa do **sysroot**, embutida, não a do **aparelho**.
Agora é dinâmico, e o aviso na saída diz para ler `GL_RENDERER`, não `GL_VERSION`.

#### Fragmento do kernel mudou com `KEEP_WORK=1`: mesma família do §12.11

Editar `linux.fragment` num build retomado **não** reconfigura o kernel — o
`.stamp_configured` já existe, o `olddefconfig` não roda de novo, e o
`assert-kernel-config` falha dizendo que o símbolo pedido não entrou, **sem citar
`KEEP_WORK`**. O gate está certo (imagem errada não sai), mas não havia saída
óbvia. `build-device.sh` passou a hashear o fragmento em
`work/<device>/kernel-fragment.state` e a rodar `linux-dirclean` quando ele muda,
como já fazia com os patches.

### 12.52 A regra do X55 dava `PASS` no R35S com o falante mudo

Medido no R35S em 06/11/2026, procurando o que os WARNs escondiam.

O `Playback Mux` do RK817 tem dois valores, `HP` e `SPK`, e o driver mainline
**não** tem opinião sobre qual usar: é `SOC_ENUM_SINGLE_VIRT` — controle virtual
de DAPM, nenhum registrador guarda o valor, e não existe propriedade de DT para
ele (conferido em `sound/soc/codecs/rk817_codec.c`). Quem decide é userspace. O
default é `HP`.

A tabela de rotas do próprio driver diz o que cada valor faz:

```text
{"Playback Mux", "HP",  "DAC L"},  {"Playback Mux", "HP",  "DAC R"},
{"Playback Mux", "SPK", "SPK DAC"},
{"SPKO", NULL, "Playback Mux"}, {"HPOL", ...}, {"HPOR", ...}
```

E o roteamento de cada aparelho decide qual é o certo:

| Aparelho | `simple-audio-card,routing` | Mux correto |
| --- | --- | --- |
| X55 | `"Speaker Amp INL", "HPOL"` — o amplificador é alimentado por HPOL/HPOR | **HP** |
| R35S | `"Speaker", "SPKO"` — o falante está no class-D | **SPK** |

O `giochi-selftest` testava `MUX = HP → pass`, herdado da X55, e reportava no
R35S:

```text
[PASS] Playback Mux = HP (falante roteado por HPOL/HPOR)
```

com o falante **sem sinal**: em `HP` só HPOL/HPOR recebem o DAC; o `SPKO` fica
mudo. O texto do `PASS` era falso em duas coisas ao mesmo tempo — o aparelho não
tem amplificador, e o caminho não era aquele.

É pior que um `FAIL` falso (§12.34), porque encerra a investigação: ninguém olha
de novo para um bloco verde. E é o §12.26 em forma de teste — **herdar a premissa
de outro aparelho e não perceber**.

Correção em três peças:

| Peça | O que faz |
| --- | --- |
| `giochi-selftest` | deriva o Mux esperado do **DT do próprio aparelho** (`Speaker -> SPK*` ⇒ SPK; `Speaker -> HPO*` ⇒ HP), e o `FAIL` cita o roteamento e a consequência |
| `device/r35s/rootfs-overlay/etc/giochi/asound.state` | estado do mixer com `Playback Mux = SPK` (formato do `alsactl store`) |
| `device/common/rootfs-overlay/etc/init.d/S51mixer` | restaura `/etc/giochi/asound.state` **se ele existir**; ausente não é erro (X55 e X35H seguem no default do driver) |

Verificado no aparelho, ponta a ponta: com `Mux = HP` o selftest passou a
reportar

```text
[FAIL] Playback Mux = HP — o DTS roteia 'Speaker -> SPKO', então precisa ser SPK
```

e depois de `/etc/init.d/S51mixer start`, `[PASS] Playback Mux = SPK (casa com o
DTS: Speaker -> SPKO)`. `tests/onboard-drivers.test.mjs` prende o par: o valor do
`asound.state` tem de casar com o roteamento do DTSI no repositório.

**Por que `alsactl restore` e não `amixer`:** na época da correção `amixer` não
estava na imagem. A razão real é que ele é subopção desligada por padrão
(§12.16), não ausência do Buildroot — e foi corrigido: `amixer`, `aplay` e
`speaker-test` agora estão nos defconfigs. `alsactl` continua sendo o mecanismo
certo para **aplicar estado de placa**: é o que o ALSA prevê para isso, e o
formato é um arquivo versionado no repositório, não uma sequência de comandos.

#### A ferramenta que não descia

A primeira versão da correção procurava o nó com
`find /proc/device-tree -maxdepth 3 -name 'simple-audio-card,routing'`. O `find`
do **busybox não desce em `/proc/device-tree`**: `find /proc/device-tree -maxdepth 1`
devolve só a raiz. O bloco caía num WARN ("não permitiu decidir o esperado") que
parece dado ausente e é ferramenta errada. Trocado por glob de shell em dois
níveis, que funciona — e é o que responde a pergunta. Detectado só porque o teste
foi feito no aparelho, não no desktop.

### 12.53 `set -euo pipefail` + `2>/dev/null` = build morre em 0 s, sem dizer nada

Encontrado pelo **CI**, não localmente — e essa é a parte que vale registrar.

O commit `dc030b0` passou aqui (build do R35S verde, 79 símbolos de kernel
verificados, testes 400/400) e **falhou no CI em zero segundo**:

```text
2026-11-06T22:38:07Z Giochi System
2026-11-06T22:38:07Z   device:    qemu-aarch64 (QEMU AArch64 Virt)
2026-11-06T22:38:07Z   arch:      arm64
2026-11-06T22:38:07Z   buildroot: 2024.02
2026-11-06T22:38:07Z   work:      …/work/qemu-aarch64
2026-11-06T22:38:07Z   cache:     …/.cache
2026-11-06T22:38:07Z   out:       …/out/qemu-aarch64
2026-11-06T22:38:07Z ##[error]Process completed with exit code 1.
```

O cabeçalho, e mais nada. Nenhuma linha de erro, nenhum nome de arquivo — a
assinatura de comando que falhou com o `stderr` redirecionado para `/dev/null`.

A linha era minha, do §12.51:

```bash
CURRENT_FRAGMENT="$(sha256sum "$DEVICE_DIR/linux.fragment" 2>/dev/null | awk '{print $1}')"
```

O `qemu-aarch64` **não tem** `linux.fragment` (usa o config default do
`qemu_aarch64_virt_defconfig`). Sem `pipefail`, a atribuição devolveria o status
do `awk` — zero — e o script seguiria com `CURRENT_FRAGMENT` vazio. Com
`pipefail`, a pipeline inteira devolve o não-zero do `sha256sum`, e o `set -e`
mata o script. O `2>/dev/null` garantia que ninguém visse por quê.

**Por que passou local e falhou no CI:** aqui eu buildei o **R35S**, que tem
fragmento de kernel; o CI builda o **qemu-aarch64**, que não tem. Um caso de cada
lado, e o de lá é o único aparelho habilitado — ou seja, era o caminho principal
que eu nunca exercitei com aquela linha.

Correção, e o que ela evita:

```bash
CURRENT_FRAGMENT=""
if [[ -f "$DEVICE_DIR/linux.fragment" ]]; then
  CURRENT_FRAGMENT="$(sha256sum "$DEVICE_DIR/linux.fragment" | awk '{print $1}')"
fi
```

Guarda explícita, não `|| true`: com `-f` na frente não há status não-zero para
ignorar, e o `stderr` pode voltar a aparecer.

**A lição de método** é a mesma do §12.34 com outra roupa: o teste perguntou pela
coisa errada. Aqui não foi um teste — foi **um build só**. "Build verde" num
aparelho não diz nada sobre o outro, e o `qemu-aarch64` é justamente o que
sustenta o pipeline enquanto não há hardware.

`tests/build-device-vars.test.mjs` ganhou o par executável: extrai o bloco entre
`giochi-system:kernel-fragment-state:{begin,end}` do próprio script e roda num
bash real com `set -euo pipefail`, contra um aparelho **com** fragmento e outro
**sem**. Verificado nos dois sentidos — reintroduzir a linha sem guarda faz o
teste falhar (4/5), e era isso que faltava. `bash -n` passa nos dois casos, então
sintaxe nunca ia pegar.

### 12.54 As bibliotecas de SDL2 do HOST servem o launcher x86_64 — e envenenam o aarch64

Esta máquina tem o stack de desenvolvimento SDL2/EGL instalado por apt
(`libsdl2-dev`, `libsdl2-image-dev`, `libsdl2-mixer-dev`, `libsdl2-ttf-dev`,
`libdrm-dev`, `libgbm-dev`, `libegl1-mesa-dev`, `libgles2-mesa-dev`,
`libudev-dev`, `libasound2-dev`). Medido: **146 MB em 111 pacotes** — os 13
pedidos mais ~100 dependências automáticas (X11 dev, glib, ICU, harfbuzz,
freetype, wayland, pulse).

**Para que servem, e é legítimo:** o launcher compilado **nativamente em x86_64**,
que é como a equipe do app roda `--tamanho 1280x720` no PC para medir letterbox
sem hardware. O `compilar-launcher.sh` deles monta um prefixo próprio
(`~/.cache/giochi-sdl2/root/`) com symlinks para `/usr/lib/x86_64-linux-gnu/`.
Sem isso o `cargo` morre em `rust-lld: unable to find library -lSDL2`.

**Impacto no build do Buildroot: nenhum.** Cross-compile usa o toolchain, o
`host/` e o sysroot que o próprio Buildroot constrói; biblioteca de
desenvolvimento do host não é consultada em momento algum. E não há risco de
vazamento por acidente, porque o `pkg-config` do Buildroot é embrulhado com
`PKG_CONFIG_LIBDIR`/`PKG_CONFIG_SYSROOT_DIR`. Medido no host, sem embrulho:

```text
$ pkg-config --cflags --libs sdl2
-I/usr/include/SDL2 -D_REENTRANT -lSDL2        ← x86_64, sem sysroot
```

É exatamente o que **não** pode entrar num build de target.

**O risco real, e é silencioso:** usar esse `pkg-config` para compilar o launcher
**para aarch64**. O configure acha o `.pc`, o link passa, e o binário sai ligado
em `libSDL2-2.0.so.0` de **x86_64** — ou o link "funciona" no PC e o aparelho
recusa com `wrong ELF class` / biblioteca ausente. Nenhuma etapa avisa, porque
cada uma, isolada, está correta.

Regra: compilar para o aparelho é **sempre** com o staging do Buildroot —

```bash
PKG_CONFIG_SYSROOT_DIR=$WORK/build/staging \
PKG_CONFIG_LIBDIR=$WORK/build/staging/usr/lib/pkgconfig:$WORK/build/staging/usr/share/pkgconfig
```

ou, melhor, com o SDK (`BR2_PACKAGE_HOST_ENVIRONMENT_SETUP=y` + `make sdk`), que
gera um `environment-setup-*` com tudo já apontado.

**Corolário de método:** o mesmo comando `apt install` que resolve o build nativo
não tem efeito nenhum sobre o build do aparelho, e as duas coisas convivem na
mesma máquina sem se cruzar — desde que ninguém use o `pkg-config` errado. Vale
para qualquer dependência futura do mesmo tipo: enquanto o caminho do
cross-compile for explícito, o host pode ter o que quiser.

### 12.55 O `sdl2-config` do sistema vence o do Buildroot — e o gcc pega, não o build

Consequência direta do §12.54, e apareceu no dia seguinte: ao ligar
`BR2_PACKAGE_SDL2_MIXER` (que a GIOCHI-ENGINE exige), o `sdl2_mixer` 2.6.3 não
compilou.

```text
aarch64-buildroot-linux-gnu-gcc: ERROR: unsafe header/library path used in
cross-compilation: '-I/usr/include/SDL2'
make[2]: *** [Makefile:187: build/music_cmd.lo] Error 1
```

A causa em três camadas, e nenhuma delas está no pacote:

1. `BR_PATH = "$(HOST_DIR)/bin:$(HOST_DIR)/sbin:$(PATH)"` (`Makefile:468`) — o
   PATH do sistema entra na conta do configure.
2. O `sdl2-config` do Buildroot é instalado em
   **`$(STAGING_DIR)/usr/bin/sdl2-config`**, que **não** está nesse PATH.
3. O `configure` do SDL2_mixer procura com
   `AC_PATH_TOOL(SDL2_CONFIG, sdl2-config)` e acha `/usr/bin/sdl2-config` do
   Ubuntu, que responde `-I/usr/include/SDL2`.

Note que `sdl2_image` e `sdl2_ttf` **não** quebraram: eles usam pkg-config, e o
pkg-config do Buildroot é embrulhado com `PKG_CONFIG_LIBDIR`/`SYSROOT_DIR`. O
`sdl2_mixer` é o único da família que ainda usa `sdl2-config`. Sem o
`libsdl2-dev` do host instalado o problema não existiria — o que o torna
dependente de máquina, e portanto do tipo que só quebra na máquina de alguém.

**Quem salvou o build foi a trava do próprio gcc do Buildroot** (`unsafe
header/library path`). Sem ela, o mixer linkaria contra o SDL2 de x86_64 e o
binário sairia "válido" e inútil no aparelho — §12.54 na forma consumada.

Correção em `config/package-overrides.mk`:

```make
override SDL2_MIXER_CONF_ENV += SDL2_CONFIG=$(STAGING_DIR)/usr/bin/sdl2-config
```

`AC_PATH_TOOL` respeita a variável já definida no ambiente. `override ... +=` e
não `=` porque, se uma versão futura do Buildroot passar a definir
`SDL2_MIXER_CONF_ENV`, o acréscimo soma em vez de ser apagado (§12.7).

### 12.58 O relatório da equipe da engine: o que confere e o que não confere

Recebido em 07/11/2026 (`GIOCHI-ENGINE-3D`). Itens verificados um a um no
aparelho, e **três dos oito já estavam resolvidos** — o relatório mediu uma
imagem mais antiga que a do cartão.

| Item do relatório | Medido agora | Veredito |
| --- | --- | --- |
| P0 `SDL2_image` sem PNG/JPEG | corrigido no defconfig + gate (§12.57) | **real, corrigido** |
| P1 sysroot sem headers de libc | `/usr/include` com **0** entradas | **real, e pior** |
| P1 headers das satélites | idem — nem SDL2 está lá | **real** |
| P2 `fuser`/`lsof`/`strace`/`readelf` | **todos presentes** | **desatualizado** |
| P2 `timeout` | ausente | **real, corrigido** |
| P2 `python3` | ausente | real, **não** corrigido (decisão de licença) |
| P3 bateria não carrega | `rk817-charger online = 0` | **hardware** |
| P4 supervisor hostil | desistência já grava marcador | real; corrigido o resto |

#### P3 — `online = 0` fecha a questão

```text
rk817-charger:  online = 0
rk817-battery:  status = Discharging, capacity = 0
```

`online = 0` significa que o driver **não vê energia** chegando pelo PMIC. Como
o cabo USB é a própria porta de dados (o gadget RNDIS), a porta não fornece
carga — é hardware. O relatório chegou à mesma conclusão pela hipótese certa:
"se existe `rk817-charger` com `online=0`, é a porta".

Consequência prática que vale registrar: **qualquer sessão longa de
desenvolvimento neste aparelho é uma aposta** enquanto a bateria não for
resolvida. Hub USB com alimentação resolve sem tocar no software.

#### P2 — três ferramentas que o relatório pede já estavam lá

`fuser`, `lsof`, `strace` e `readelf` respondem no aparelho. A mensagem "sem
`fuser` precisei varrer `/proc/*/fd/*`" não se aplica a esta imagem — quem
escreveu mediu uma anterior.

`timeout` realmente faltava, e o custo de corrigir era **1 KB**: o applet do
busybox existe (`CONFIG_TIMEOUT`) e só estava desligado. `BR2_PACKAGE_COREUTILS`
traria o applet e mais ~100 utilitários sem uso — mesmo raciocínio do `tc`
(§12.7).

`python3` fica de fora por decisão anterior registrada: `pygame` é LGPL-2.1 e a
regra de licença recusa LGPL na imagem assinada. O interpretador sozinho é
permissivo, mas incluí-lo abriria a porta para o que motivou a recusa. Um smoke
test em Python pode rodar no host contra o aparelho por SSH.

#### P1 — copiar `include/` não é a correção, o SDK é

O relatório propõe exportar um SDK em vez de copiar `lib/` e `include/`, e está
certo: copiar para o rootfs aumentaria a imagem e **continuaria sem os headers
de libc**. `BR2_PACKAGE_HOST_ENVIRONMENT_SETUP=y` + `make sdk` gera um tarball
auto-contido com sysroot, toolchain e `environment-setup-*` — e, o que resolve o
problema de origem, com `PKG_CONFIG_SYSROOT_DIR` e `PKG_CONFIG_LIBDIR` já
apontados para o sysroot certo. É exatamente o que faltava nos §12.54 e §12.55.

### 12.57-A `IMG_Init` combinado derruba TODOS os formatos quando um falta

Relatado pela equipe da engine (`GIOCHI-ENGINE-3D`) em 07/11/2026, e é a
consequência que torna o §12.57 pior do que "PNG não abre":

```c
IMG_Init(IMG_INIT_PNG | IMG_INIT_JPG)
```

**falha inteira** se qualquer flag pedida faltar. O retorno é `0`, e um app que
confia nele conclui que o subsistema de imagem está morto — mesmo com BMP, TGA,
PNM e QOI funcionando perfeitamente. **Um formato ausente derruba todos**, e o
sintoma não distingue "falta PNG" de "imagem não funciona".

A correção deles foi defensiva e certa: abrir com `InitFlag::empty()` e sondar
cada formato separadamente (`ADR-034`). Mas é **contorno de imagem quebrada**.
Se ficar depois de a imagem ser corrigida, vira dívida permanente — código
carregando complexidade para um defeito que não existe mais, sem ninguém saber
quando remover.

`scripts/img-init-probe.c` existe para dizer, com número, quando o contorno pode
sair. Três medições:

1. `IMG_Init(PNG|JPG|WEBP)` combinado — o que devolve de fato;
2. um formato por vez — o que cada um entrega;
3. **decodifica de verdade?** um PNG 1x1 sintético por `IMG_Load_RW`.

O item 3 é o que separa "flag aceita" de "decodifica". Uma biblioteca pode
aceitar `IMG_INIT_PNG` e falhar ao abrir o arquivo — e aí o contorno continua
necessário por um motivo diferente do original.

### 12.57 `SDL2_image` sem PNG — e o gate que eu escrevi errado sobre isso

Terceiro caso da mesma família dos §12.16 e §12.56. Todos têm a mesma forma:

```make
# package/<consumidor>/<consumidor>.mk
ifeq ($(BR2_PACKAGE_<LIB>),y)
<CONSUMIDOR>_CONF_OPTS += --enable-<recurso>
```

O símbolo do **recurso** não existe: existe o pacote da **biblioteca**, e o
consumidor pergunta por ele no configure. Repetiu em `alsa-utils`
(`amixer`/`aplay`), `sdl2` (ALSA) e agora `sdl2_image`:

```make
# package/sdl2_image/sdl2_image.mk
ifeq ($(BR2_PACKAGE_LIBPNG),y)  -> --enable-png
ifeq ($(BR2_PACKAGE_JPEG),y)   -> --enable-jpg
ifeq ($(BR2_PACKAGE_WEBP),y)   -> --enable-webp
```

Medido no R35S em 07/11/2026: `libpng` **não** estava no defconfig, então
`--disable-png`, então `LOAD_PNG` ausente do `DEFS`. Sintoma:

```text
IMG_isPNG existe e responde "PNG images are not supported"
```

O erro aparece no **app**, não no build, e parece bug de quem chamou. Foi assim
que chegou: "o sistema não decodifica PNG".

#### O gate que eu escrevi errado

Escrevi um gate que exigia o `libSDL2_image` referenciar `libpng`. O build
seguinte **falhou** acusando PNG, JPEG e WebP ausentes — com o `config.log`
dizendo `--enable-png --enable-jpg --enable-webp`.

A causa: **a partir do SDL2_image 2.8, PNG e JPEG são decodificados pelo
`stb_image` EMBUTIDO** (`-DUSE_STBIMAGE=1`). A biblioteca nunca lista libpng ou
libjpeg como `NEEDED`, mesmo com o suporte ligado. Medido nos dois binários:

| .so | `stbi_` | `libpng` | `IMG_isPNG` |
| --- | --- | --- | --- |
| com `--enable-png` | **1** | 0 | 2 |
| com `--disable-png` | **0** | 0 | 1 |

O marcador é `stbi_`, não `libpng`. E `libpng` continua necessário no defconfig —
mas como **chave** que liga o `--enable-png`, não como biblioteca vinculada.

É a mesma lição do `debugfs` ausente e do §12.30: **o gate perguntou pela
implementação de um formato, e a implementação mudou de biblioteca.** Perguntar
pela consequência ("o decodificador foi compilado dentro?") sobrevive a isso;
perguntar por "está ligado na lib que eu esperava?" não.

#### WebP: quarta armadilha, e é subopção de novo

`BR2_PACKAGE_WEBP=y` **não basta**. O configure do SDL2_image procura
`libwebpdemux`, não `libwebp`:

```text
Package 'libwebpdemux', required by 'virtual:world', not found
```

E `--enable-webp` é **aceito sem efeito**: `LOAD_WEBP` nunca entra no `DEFS`, e o
WebP fica fora sem nenhum aviso. Precisa de `BR2_PACKAGE_WEBP_DEMUX=y`.

TIFF ficou **fora de propósito**: puxa `libdeflate` + `xz` e jogo não usa.

#### Regra que fecha a família

Ao revisar um `defconfig`, para cada pacote consumidor, ler o `.mk` dele e
procurar `ifeq ($(BR2_PACKAGE_`. Cada linha dessas é um recurso que **não** vem
com o consumidor e **não** falha o build se faltar — só o runtime. Três dos
quatro casos deste projeto vieram daí.

### 12.56 SDL2 sem ALSA: o `.config` está certo, o `config.log` diz o contrário

Descoberto em 07/11/2026 **rodando a GIOCHI-ENGINE no R35S**, não no build. O
aparelho boota, a UI funciona, os botões respondem — e a engine avisou:

```text
[WARN] áudio indisponível, seguindo sem som: não foi possível abrir o
       dispositivo de áudio: dsp: No such audio device
```

`dsp` é o backend **OSS**, que não existe em kernel moderno sem emulação.
Medido:

| Onde | `strings libSDL2-2.0.so.0.2800.5 \| grep -c alsa` |
| --- | --- |
| imagem do X35H (`out/`) | **14** |
| imagem do R35S (`out/`) | **0** |
| build do X35H (`work/`) | 71 |

Causa, e é o §12.29 na forma mais silenciosa:

```make
# package/sdl2/sdl2.mk:160
ifeq ($(BR2_PACKAGE_ALSA_LIB),y)
SDL2_DEPENDENCIES += alsa-lib
SDL2_CONF_OPTS += --enable-alsa
```

Isso é decidido **no configure do `sdl2`**. No build do R35S:

```text
sdl2/.stamp_configured   2026-11-06 06:20
build/.config            2026-11-06 19:33   ← ALSA_LIB entrou 13 h depois
config.log:              --disable-alsa
```

Os dois arquivos estão internamente coerentes: o `.config` diz que ALSA está
ligado, o `config.log` diz que o sdl2 foi compilado sem. **Buildroot não
reconfigura pacote construído quando uma dependência aparece** (§12.29), e
nada no build aponta a discrepância — `assert-config` passa, porque o símbolo
foi acrescentado de propósito.

O sintoma não parece config: build verde, imagem boota, UI desenha, e "sem
áudio" parece driver de placa. Só aparece quando **um app SDL tenta tocar som**
— e antes da engine não havia nenhum que tentasse.

**Gate** em `scripts/post-build.sh`: se `libasound` está em `target/` e o
`libSDL2` não menciona `alsa` uma única vez, o build **falha** com causa e
correção escritas. A checagem é sobre a consequência (a biblioteca referencia
ALSA?), não sobre o que o `.config` declara.

```text
post-build: ERRO — o SDL2 desta imagem foi compilado SEM ALSA
            Efeito: o SDL2 cai no backend OSS ('dsp: No such audio device')
                    e TODO app SDL fica mudo — inclusive a engine.
            Causa: o sdl2 foi configurado ANTES de BR2_PACKAGE_ALSA_LIB existir
            Correção:
              rm -rf <build>/build/sdl2-*
```

`tests/sdl2-alsa.test.mjs` roda o post-build de verdade em três cenários
(com ALSA, sem ALSA com alsa-lib presente, sem alsa-lib nenhuma) e num quarto
que executa **duas vezes** — porque a primeira versão do gate ficou depois de um
`exit 0` do bloco do inittab e só rodava no primeiro build (§12.49). Dois bugs
meus na mesma checagem, os dois pegos por teste, não por leitura.

**Duas armadilhas dentro da correção:**

1. `grep -c` imprime `0` **e** sai com status 1 quando não casa. Com
   `n=$(grep -c ... || echo 0)` o valor vira `"0\n0"`, o `[ -eq ]` falha em
   silêncio e o gate **passa exatamente no caso que existe para pegar**.
2. `$BUILD_DIR` **não** está no ambiente do post-build (o Buildroot passa só
   `TARGET_DIR` e `BINARIES_DIR`). Com `set -u`, a linha que imprime a correção
   abortava o script com "unbound variable" — o operador via a mensagem cortada
   e o build falhava pelo motivo errado (§12.53). Correção:
   `${BUILD_DIR:-<build>}`.

Verificado no aparelho depois de reconstruir o `sdl2` do R35S com ALSA: a engine
abre `/dev/dri/card0` **e** `/dev/snd/pcmC0D0p`, e não emite mais o aviso.

**Imagem corrigida e gravada em 07/11/2026** (`out/r35s/giochi-system-r35s-sd.img`,
2 GiB, SHA256 `88906105…`), depois de rebuild do `r35s` com os quatro símbolos
novos. Verificado **lendo o cartão de volta**, não o `dd`:

```text
p2: SDL2 com 14 menções a ALSA (era 0)
    amixer, aplay, arecord, speaker-test, alsamixer, alsactl — todos OK
    libSDL2_mixer, libSDL2_ttf, libSDL2_image, libasound — OK
p1: extlinux.conf com fdt correto e SEM `menu title` (§12.38)
```

**Prova de áudio pela via SDL2, não só ALSA.** `speaker-test` fala ALSA direto e
toca normalmente num aparelho onde o SDL2 foi compilado com `--disable-alsa` —
foi exatamente o defeito acima. O que precisa de prova é a camada do meio.
`scripts/audio-alerta.sh` (+ `scripts/sdl-audio-probe.c`) usa o mesmo caminho do
jogo e imprime o driver escolhido. Medido no R35S com a imagem corrigida:

```text
driver de audio SDL2: alsa
dispositivo aberto: 48000 Hz, 2 canal(is), 1024 amostras/buffer
/proc/asound/card0/pcm0p/sub0/status:  state RUNNING, owner_pid <o probe>
```

`state: RUNNING` com `owner_pid` do próprio processo é a prova que importa: não
é "abriu o dispositivo", é "havia dados indo para o DAC naquele instante".

**Registrador do RK817: `0x00` é volume MÁXIMO, não zero.** Ao investigar
silêncio no R35S, `DDAC_VOLL`/`DDAC_VOLR` (0x31/0x32) liam `0x00`. O reflexo é
concluir "volume zerado". Errado: o kcontrol é

```c
SOC_DOUBLE_R_RANGE_TLV("Master Playback Volume", RK817_CODEC_DDAC_VOLL,
    RK817_CODEC_DDAC_VOLR, 0, 0x00, 0xff, 1, rk817_vol_tlv)
                                           ^ xinvert = 1
```

com `xinvert=1` o valor é gravado invertido: usuário 255 (máximo) → registrador
`0xff + 0x00 - 255 = 0x00`. Ou seja `0x00` é **0 dB**, e `0xff` seria mudo. O
mixer mostrava `255/255`, coerente. Ler o registrador sem ler o `xinvert` leva à
conclusão oposta à verdade.

`DDAC_MUTE_MIXCTL` (0x38) lido como `0xb0`: bit 0 = 0 = `DACMT_DISABLE`, também
correto. E `ACLASSD_CFG1` (0x40) = `0xa9`, bit 7 = 1 = class-D ligado.

Ou seja: com PCM `RUNNING`, `Speaker: On` no DAPM, mux `SPK`, volume máximo,
DAC desmutado e class-D ligado, **a cadeia de software está correta até o
registrador** — e mesmo assim não sai som. Nesse ponto a investigação é física
(falante, conector de fone com chave mecânica travada), não de configuração.

Armadilha de verificação que custou um susto: `debugfs` **não** está no pacote
`e2fsprogs` do Alpine — é `e2fsprogs-extra`. Com o primeiro, o comando vira
"not found", o `grep -q Inode` falha e **todo arquivo aparece AUSENTE**: o cartão
parecia vazio com o rootfs correto gravado. O que desmentiu foi o magic `53 ef`
lido direto no offset 320 MiB. A lição é a mesma do §12.30: ferramenta ausente
não é dado ausente — quando tudo dá "não tem", o suspeito é o instrumento.

### 12.59 A auditoria de 08/11/2026: nove defeitos, todos "verde e errado"

Varredura completa da árvore, sem aparelho ligado. O critério foi o que este
documento sempre usou: **o que faz o build passar e a imagem sair errada, sem
mensagem**. Nove achados, todos corrigidos, cada um com teste que falha se
voltar. Nenhum apareceu por leitura de código apenas — os dois primeiros foram
reproduzidos em shell, e o resto só apareceu ao comparar script com script.

| # | Onde | Defeito | Como se manifestava |
| --- | --- | --- | --- |
| 1 | `post-build.sh` | `verifica_harfbuzz` começava com `[ "${BR2_PACKAGE_HARFBUZZ:-n}" = "y" ] \|\| return 0`; o Buildroot **não exporta `BR2_*`** ao post-build | o gate **nunca rodou**: build verde e zero cobertura |
| 2 | `build-device.sh` | `... \| xargs ... sha256sum {} 2>/dev/null` sob `set -euo pipefail` | patch ausente derrubava o script com **exit 123 e nenhuma saída** |
| 3 | `build-device.sh` | só os patches de **kernel** eram hasheados | editar `uboot-patches/` ou `uboot.fragment` com `KEEP_WORK=1` dava U-Boot velho (§12.11 para o outro pacote) |
| 4 | `flash-sd.sh` | tinha `--grow` e SHA256, **não** tinha a guarda "não é o disco de `/`" que o `flash-dd.sh` tem | gravar um SSD USB/cartão que sustenta o sistema apaga o host |
| 5 | `make-sd-image.sh` | `DTB_NAME="${DTB_NAME:-rk3566-powkiddy-x55}"` | aparelho novo sem `INTREE_DTS_NAME` gravaria o **painel da X55** |
| 6 | workflow + docs | o cache salvava `.cache/buildroot-dl`; o script usa `$CACHE_ROOT/dl` | cache sempre vazio: todo build baixava tudo de novo |
| 7 | `giochi-selftest` | `grep -c '^\s*[0-9]'` e `LEASES=$(grep -c ... \|\| echo 0)` | `\s` não é POSIX (busybox) e o `\|\| echo 0` produz `"0\n0"` — os dois dão `FAIL nenhuma placa de som` com som |
| 8 | `build-device.sh` | `rm -rf "$OUT_DIR"` **antes** do `make` | build que falhava apagava a última imagem boa (o `out/_anterior-…` da §21 foi feito à mão por causa disso) |
| 9 | `package-overrides.mk` | cabeçalho dizia "incluído *depois* das receitas" | a ordem real é antes (`Makefile:528` vs `:531`); quem cresse no comentário escreveria `+=` e perderia a opção em silêncio |

**O achado 1 é o mais instrutivo.** O gate nasceu com a justificativa certa
(§12.29), a mensagem certa e a correção certa — e a primeira linha o desligava.
O próprio arquivo, cinquenta linhas acima, documenta que o Buildroot passa só
`PATH, BR2_DL_DIR, BUILD_DIR, CONFIG_DIR, O` ao post-build. A regra que sai:
**gate não pode depender de ambiente que não foi medido.** A versão nova pergunta
pela consequência e não lê variável nenhuma: `libharfbuzz` na imagem + `libSDL2_ttf`
sem citá-la = build construído antes da dependência existir.

**O achado 2 é o §12.53 de novo, e a lição é sobre onde procurar.** A correção
do §12.53 foi aplicada na linha que doeu (`linux.fragment`), não na **classe**
(comando em pipeline que pode falhar com `stderr` mudo). A linha dos patches
nunca foi olhada, e ficou dois meses esperando um aparelho com patch removido
para matar um build em 0 s. `hash_entradas()` agora falha alto, dizendo qual
caminho falta.

**O achado 4 é o §12.50 aplicado a script:** a guarda existia num dos dois
scripts que gravam cartão. Defeito de classe coberto por caso é cobertura
aparente — `tests/flash-guards.test.mjs` percorre a lista `DESTRUTIVOS` em vez
de testar um arquivo.

Testes novos, e o que cada um prende:

| Arquivo | Testes | Prende |
| --- | --- | --- |
| `tests/post-build-harfbuzz.test.mjs` | 5 | o gate roda no `EXTRA_ENV` **real** (sem `BR2_*`) e reprova o caso que motiva |
| `tests/flash-guards.test.mjs` | 4 | os **dois** scripts recusam o disco de `/` e `/boot`, antes do `dd` |
| `tests/ci-cache-e-sd-image.test.mjs` | 6 | o cache do CI é o caminho que o script escreve; `make-sd-image.sh` sem DTB de reserva |
| `tests/build-device-vars.test.mjs` | 8 (era 5) | estado de patches executa de verdade, inclusive com patch ausente; `out/` limpo só depois do `make` |
| `tests/rk3326-legacy-boot.test.mjs` | 18 (era 17) | inclui o nome do alvo `uboot-dirclean` e o estado de `uboot.fragment` + `uboot-patches/` |
| `tests/selftest-contract.test.mjs` | 16 (era 12) | nenhum `\s` em grep, nenhum `grep -c \|\| echo 0`, nenhuma contagem morta, e a lenda do `amixer` fora do código |
| `tests/busybox-config.test.mjs` | 7 | o gate do busybox morde nos três casos medidos (símbolo inexistente, dependência não satisfeita, string pedida como bool) |
| `tests/defconfig-gate.test.mjs` | 4 | o defconfig do aparelho entra no assert, com os placeholders já resolvidos |
| `tests/help-sentinels.test.mjs` | 4 | nenhum `--help` recortado por linha, sentinelas completas, e o `--help` do rootfs sem prosa |

**Documentação que estava mentindo, e foi corrigida:** `buildrootFragments` e
`firmwareFiles` eram descritos como "aceitos na doc e não lidos por script" —
o `build-device.sh` já os lia (§6); a contagem de testes dizia 402 e eram 433;
`docs/x55-bringup.md` repetia que `amixer` "não existe no Buildroot" (§12.16); e
`docs/security.md` pedia para "adicionar um SHA256 do tarball" que já existe em
`buildroot.sha256` desde a primeira revisão.

**O que a auditoria NÃO achou:** nenhum defeito nos gates de `assert-config` /
`assert-kernel-config`, no `prepare-config.mjs`, no `chave-da-loja.sh`, no
`giochi-init` e nos overrides de pacote — estes foram conferidos contra a árvore
real do Buildroot 2024.02 em `~/.cache/giochi-system/work/*/buildroot-2024.02`,
não contra a lembrança. Em particular, `override STRACE_CONF_OPTS` repete as
quatro opções da receita **de propósito**: `override` congela a variável, então
o `+=` condicional do `strace.mk` (libunwind/libiberty) deixa de alcançá-la —
verificado com `make -p` e com o `config.log` do build do R35S, que registra
`--enable-mpers=no --enable-bundled=yes --without-libunwind --without-libiberty`.

### 12.60 Segunda passada: o Kconfig do busybox e o defconfig sem gate

A §12.59 varreu os scripts de build e o post-build. Esta passada foi nas áreas
que **não** tinham sido lidas: os 13 scripts Python de serial, os 8 init scripts
do overlay, os geradores Node, o `prepare-config`, o `chave-da-loja`, os
`defconfig` e os fragmentos de configuração. Quatro achados, e os dois primeiros
eram o mesmo buraco em arquivos diferentes.

| # | Onde | Defeito | Sintoma |
| --- | --- | --- | --- |
| 1 | `config/common.busybox.fragment` | 4 símbolos que **não fazem o que dizem** (abaixo) | `tar xzf` não funcionava no aparelho |
| 2 | `build-device.sh` | o fragmento de busybox era o **único Kconfig sem gate** | os 4 de cima passaram meses sem ninguém ver |
| 3 | `device/*/defconfig` | `BR2_PACKAGE_KMOD_TOOLS=y` descartado em silêncio nos dois aparelhos | `modprobe` do busybox, que não resolve `modules.dep.bin` |
| 4 | `docker/serial.Dockerfile` | copiava 10 de 13 scripts | `can't open file '/work/serial-push-blob.py'` |
| 5 | 9 scripts | `--help` recortado por número de linha | 2 já sangravam prosa/código na ajuda |

#### O busybox é o terceiro Kconfig, e era o único sem verificação

`assert-config` cobre `BR2_*`; `assert-kernel-config` cobre `CONFIG_*` do
kernel. O busybox resolve o **próprio** `.config` com o **próprio**
`olddefconfig`, e ninguém comparava o resultado. Medido no `.config` real do
`busybox-1.36.1` do R35S:

| Linha do fragmento | O que realmente acontecia |
| --- | --- |
| `CONFIG_FEATURE_TAR_GZIP=y` | símbolo **não existe** desde o 1.31 (é `FEATURE_SEAMLESS_GZ`) → `# ... is not set` |
| `CONFIG_FEATURE_TAR_XZ=y` | idem (`FEATURE_SEAMLESS_XZ`); ligou por acidente via `AUTODETECT` |
| `CONFIG_FEATURE_PS_WIDE=y` | `depends on (PS \|\| MINIPS) && !DESKTOP`, e `CONFIG_DESKTOP=y` → **impossível** |
| `CONFIG_FEATURE_CROND_DIR=y` | é **string**, não bool (`default "/var/spool/cron"`): o `=y` foi descartado |

O primeiro é o que dói: o fragmento prometia gzip no `tar`, e o `tar` da imagem
só entendia `.xz`. `tar xzf` é justamente o que a documentação do sistema base
usa para mover arquivo por `nc` quando não há `scp`.

`scripts/assert-busybox-config.mjs` fecha o buraco reusando a lógica do assert
do kernel (a pergunta é a mesma; duplicar o código não). Roda no build depois do
`olddefconfig`, antes da coleta, e **falha** o build.

#### O defconfig é lido ANTES dos fragmentos — e o kconfig aplica `depends on`

`BR2_PACKAGE_KMOD_TOOLS` tem `depends on BR2_PACKAGE_BUSYBOX_SHOW_OTHERS`, e
essa dependência só é satisfeita pelo `config/common.fragment`. A sequência é:

```text
1. make <defconfig>        kconfig aplica depends on; SHOW_OTHERS ainda =n
                           -> KMOD_TOOLS não entra no .config (nem como "is not set")
2. prepare-config          SHOW_OTHERS=y entra
3. make olddefconfig       o símbolo passa a existir, com o DEFAULT (n)
                           -> o =y do defconfig nunca é lido de novo
```

Medido em 08/11/2026 reproduzindo o pipeline da X55 sem compilar
(`make <defconfig>` → `prepare-config` → `make olddefconfig`):

```text
assert dos FRAGMENTOS:  OK — 25 símbolos
assert do DEFCONFIG:    BR2_PACKAGE_KMOD_TOOLS descartado
```

Depois da correção (símbolo no `buildroot.fragment`), o mesmo replay dá
**OK — 98 símbolos**, porque o defconfig do aparelho passou a ser verificado
também. O gate usa o defconfig **instalado** em `$BR2_DIR/configs/`, onde os
placeholders de U-Boot já viraram caminho — assertar o original acusaria
divergência em todo aparelho com U-Boot customizado.

**Regra que fica:** símbolo cuja `depends on` é satisfeita por um fragmento mora
no **fragmento**, nunca no defconfig. E o `defconfig` do aparelho entra no
`assert-config`; o do Buildroot (`qemu-aarch64`) não, porque ele contém símbolos
que o próprio Buildroot ajusta e afirmar sobre ele daria falso positivo no único
aparelho habilitado.

#### `--help` por número de linha: nove lugares, dois já errados

O padrão `sed -n '2,20p' "$0"` já estava registrado como defeito pelo
`tests/flash-grow.test.mjs`, e continuava em nove scripts. Dois **já** estavam
errados de fato, e os dois são do rootfs, onde `--help` é a única documentação
que existe sem SSH:

```text
giochi-usb --help       imprimia "## Por que isto existe" e mais nada
giochi-usbnet --help    imprimia 39 linhas, 30 delas de justificativa
```

Todos passaram a usar sentinelas `# giochi-system:help:begin` / `:end`, como o
`giochi-buttons` já fazia. `tests/help-sentinels.test.mjs` fecha a classe: proíbe
o recorte por linha em qualquer script, exige os **dois** marcadores (meio par é
pior que nenhum — o `awk` imprime o arquivo inteiro), e confere que o `--help`
do rootfs não imprime título de seção nem vaza shell.

#### O resto da segunda passada

- `docker/serial.Dockerfile` passou a fazer `COPY *.py`: três scripts
  (`serial-cmd.py`, `serial-pull.py`, `serial-push-blob.py`) existiam no
  repositório e não iam para a imagem. É o §12.50 na forma de Dockerfile — a
  correção anterior tinha acrescentado **um** nome à lista, não fechado a classe.
- `tests/serial-tools.test.mjs` compila **todos** os `.py` (era só quatro) e
  verifica o `COPY` contra a pasta, não contra uma lista.
- `.gitignore` ganhou `__pycache__/`: `python3 -m py_compile` cria a pasta e o
  `git status` fica sujo sem ninguém ter mexido em fonte.
- CI passou a instalar `gawk` e `zlib1g-dev`, que estavam no `check-host.sh` e no
  `docker/builder.Dockerfile` e **não** no workflow. Funciona hoje porque o
  runner já os traz — o que é depender do runner, não do build.

### 12.61 Terceira passada: o caminho de recuperação que nunca tinha sido exercitado

As duas primeiras passadas cobriram os scripts de build e as configurações.
Esta foi na **lógica de execução** dos scripts Python de serial e dos binários
do overlay — e, pela primeira vez, na pergunta inversa: *os testes testam o que
dizem testar?*

#### `serial-push-blob.py`: o login estava quebrado por TIPOS, e ninguém viu

O caminho de recuperação (console fora do shell: login expirado, `giochi-init`
imprimindo no meio) tinha dois erros de tipo:

```python
if b"login:" in saida:          # saida é STR (o drenar decodifica)
print(saida[-500:].decode(...)) # str não tem .decode
```

O primeiro dava `TypeError`, o segundo `AttributeError` — os dois **no caminho
que só roda quando o login é necessário**. O caminho feliz (sessão já aberta)
nunca passava por ali, então o script "funcionou" por meses com a recuperação
morta. É a mesma forma do gate do harfbuzz (§12.59): o código existe, a
justificativa existe, e a primeira linha o desliga — aqui por tipos em vez de
ambiente.

**Por que nenhum teste pegou:** a suíte fazia `ast.parse` nos scripts Python.
Sintaxe passa; o erro é de TIPOS em tempo de execução.

**O teste que falta agora existe** (`tests/serial-login-path.test.mjs`):
executa o script DE VERDADE com um módulo `serial` falso e respostas
roteirizadas (`login: ` → `# ` → `wc` → `md5`), e percorre o caminho completo
até o `OK: md5 confere dos dois lados`. Verificado nos dois sentidos:
reintroduzir o defeito faz o teste morrer com o `TypeError` exato.

Duas lições de método que ficam:

1. **`ast.parse` prova sintaxe, não comportamento.** Script que fala com
   hardware só se prova com hardware falso — o `serial` do pyserial é módulo
   normal e pode ser substituído por stub em `sys.modules`.
2. **O roteiro tem de respeitar o protocolo do script**: o `drenar` lê em laço
   até a janela fechar, então o stub precisa servir **um item por drenagem**
   (na primeira leitura após um `write`), senão a primeira drenagem consome a
   fila inteira e o teste testa outra coisa. As duas primeiras tentativas do
   stub erraram exatamente isso (relógio falso dessincronizando as janelas, e
   fila inteira na primeira leitura) — e o sintoma era o teste reprovando o
   código CORRETO, que é o defeito espelhado.

#### O status do SSH apontava para o servidor errado

`giochi-usbnet --status` dizia "dropbear NÃO está rodando" **para sempre**: a
imagem usa OpenSSH desde a §10-A e o `pidof dropbear` nunca acha nada. Um status
que aponta para o servidor errado manda procurar defeito onde não há — agora
reporta `sshd` (OpenSSH). Mesma classe da tabela do §12.58 ("fuser/lsof/strace
já estavam lá; o relatório mediu imagem velha").

#### O que esta passada CONFERIU e não achou defeito

- `giochi-init` inteiro: cota de restart por tipo de saída, janela deslizante,
  marcador de desistência, restauração de brilho, configurador de controles.
  A única sutileza é o `window_start` reusar o `now` lido antes do lançamento —
  inofensivo, porque a próxima volta relê o uptime e o reset ocorre de qualquer
  forma quando o launcher rodou > 60 s (que é o comportamento desejado).
- `S30usbnet`, `S40wifi`, `S01splash`, `S15modules`, `giochi-godot`,
  `giochi-bootlog` (incluindo a busca de partição por conteúdo e a ordem
  calculada pelo disco do rootfs) e `giochi-usb`.
- A guarda do mass-storage do `giochi-usbnet` (major:minor via `/sys/dev/block`,
  sem `strtonum` — o §12.44 segue como descrito).
- `serial-cmd.py`, `serial-push.py`, `ymodem-send.py`, `serial-log.py`,
  `serial-boot.py`, `serial-interrupt.py`, `serial-loopback.py` — sem misturas
  de str/bytes; o ymodem já está provado em hardware.
- `lib/fdt.mjs`, `lib/dsi-panel.mjs`, `lib/assert-config.mjs` — as assinaturas
  conferem com os testes existentes.
- Referências `docs/controles.md` e `docs/integracao.md`: parecem mortas, mas
  são do repo do `Giochi app` (`Giochi app/docs/...`) — corretas.
- O `docs/x55-bringup.md` diz "SSH (dropbear) responde na porta 22": é o
  REGISTRO da época em que dropbear estava na imagem, e por isso fica como
  estava — bringup é documento histórico, não verdade atual.

### 12.62 Quarta passada: com o X55 ligado por SSH, o que o aparelho desmentiu

As três passadas anteriores foram de leitura e execução local. Esta foi feita
**no aparelho**, por SSH em `10.55.0.2`, com a imagem `commit=60e326f`
(`built_at 2026-11-07T17:49:22Z`) — ou seja, **anterior a todas as correções
acima**. Isso tem uma consequência de método que é o ponto desta seção: cada
defeito encontrado nas passadas 1–3 pôde ser **reproduzido em hardware**, e cada
correção pôde ser **medida antes e depois no mesmo aparelho**.

O hábito que fez a diferença: **medir antes de afirmar**. Três das coisas que eu
ia reportar como defeito não eram (a lista está no fim), e a única forma de
separar as duas categorias foi rodar o comando.

#### O que a passada 2 tinha previsto, e o aparelho confirmou

| Correção da passada 2 | Comando no aparelho | Resultado na imagem `60e326f` |
| --- | --- | --- |
| `FEATURE_TAR_GZIP` → `SEAMLESS_GZ` | `tar czf /tmp/x.tgz /etc` | `tar: invalid option -- 'z'` |
| `BR2_PACKAGE_KMOD_TOOLS` | `command -v modprobe depmod modinfo` | só `/bin/busybox`; `depmod`/`modinfo` ausentes |

Ou seja: as duas não eram hipótese de leitura de `Kconfig`. O `tar` sem gzip e
o kernel **sem `depmod`** estavam na imagem que bootou, e `modprobe` resolvendo
para o applet do busybox é a diferença entre "carrega o módulo" e "carrega e não
sabe das dependências".

#### Defeito A — o splash nunca saía, e o caminho estava errado em três arquivos

`psplash.c` faz:

```c
rundir = getenv("PSPLASH_FIFO_DIR");
if (!rundir) rundir = "/run";
chdir(rundir);
mkfifo(PSPLASH_FIFO);        /* #define PSPLASH_FIFO "psplash_fifo" — RELATIVO */
```

O FIFO real é **`/run/psplash_fifo`**. O nosso código testava
`/tmp/psplash_fifo` em três lugares (`S01splash` na espera e no `stop`,
`giochi-init`), e `/tmp` **nunca** tem o arquivo. Consequência medida:

```text
$ ps  (via /proc, §12.46)
psplash  starttime 1.68s   uptime 12017s   fds em /dev/fb0: 1
```

O `stop_splash` do `giochi-init` começava com `[ -p /tmp/psplash_fifo ] || return 0`
e **retornava sempre** — o splash ficou 3h20 na tela, segurando `/dev/fb0`, ao
lado do launcher. E o `S01splash` imprimia a cada boot um aviso sobre a
ferramenta ("psplash não criou o FIFO"), não sobre o splash.

Verificado no aparelho depois da correção, com o `S01splash` novo:

```text
splash: psplash rodando (pid 8887, fifo /run/psplash_fifo)
prw-------  1 root root 0 /run/psplash_fifo        ← /tmp/psplash_fifo: No such file
... sh S01splash stop  →  psplash morto, FIFO removido
```

**O detalhe que torna isso um §12** e não um commit: `psplash-write` faz o mesmo
`chdir`, então o `QUIT` sempre funcionou — o que nunca funcionou foi *decidir* se
havia um FIFO. Um `[ -p ]` no caminho errado não falha, não avisa e não deixa
rastro; ele só faz o `if` tomar o ramo errado para sempre.

**Confirmado num SEGUNDO aparelho** (R35S, 08/11/2026, imagem `12b431d`), o que
fecha a dúvida de ser específico da X55 — o código está no overlay **comum**,
logo vale para os três:

```text
uptime 3571 s ; psplash pid 105 starttime 176 (= 1,76 s depois do boot)
  fds em /dev/fb0: 1
/run/psplash_fifo : prw-r-----  (existe)
/tmp/psplash_fifo : No such file or directory
launcher DRM master: nenhum      <- a sessão inteira rodou com o splash na frente
```

Ou seja: o splash ficou ~59 min na tela e o launcher, quando subiu, não era o
master do `card0`. É o mesmo defeito, com outro SoC (RK3326) e outro painel
(640x480) — o que se espera de código comum, e é a razão de a correção estar em
`S01splash`/`giochi-init` e não no aparelho.

#### Defeito B — o console de texto nunca existia, e o Kconfig estava certo

Três avisos do selftest na imagem velha apontavam para `CONFIG_`:

```text
[WARN] console sem rotação (rotate=0) — painel é retrato, texto sai deitado
```

com `fbcon=rotate:3` **na linha de comando** e
`CONFIG_FRAMEBUFFER_CONSOLE_ROTATION=y` no kernel. Medido:

```text
/sys/class/vtconsole/vtcon*/name   ->  (S) dummy device      ← só isso
stty size < /dev/tty0              ->  25 80                 ← geometria default
/sys/class/graphics/fbcon/rotate   ->  0
```

e depois de **uma** linha escrita em `/dev/tty0`:

```text
vtcon1 -> (M) frame buffer device ; stty size -> 45 160 ; fbcon/rotate -> 3
fbcon: Taking over console
Console: switching to colour frame buffer device 160x45
```

A causa é o `CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y` — ligado de
propósito em `c04747d` para não haver janela preta antes do splash. Com ele, o
fbcon **não assume** até alguém escrever no VT; e o getty deste sistema está em
`console` = `ttyS2` (serial), então ninguém escreve. O `giochi-init` passou a
fazer o empurrão (`assumir_console`), e **só quando não há launcher** — que é
exatamente o caso em que o console é a interface.

**A verificação de segurança que importa** (feita no aparelho, não deduzida):
depois do takeover, `/sys/kernel/debug/dri/0/clients` continua
`giochi-launcher 3386 0 y y`, e o launcher continuou desenhando. O console de
texto **não rouba o DRM master** de quem já o tem; a tela dividida que o §11-A
temia não acontece nesta ordem (launcher primeiro, fbcon depois).

#### Defeito C — o log de boot era 99,8% ruído de carregador

`giochi-bootlog` existe para gravar o diagnóstico do boot na FAT do cartão, para
quando o aparelho não sobe. Medido no aparelho **sem bateria**:

```text
$ dmesg | wc -l
1260
$ dmesg | grep -c "below minimum voltage"
1203
```

O `rk817-charger` imprime `Battery voltage NNNN below minimum voltage 3400000` a
cada ~8 s, e o buffer inteiro do `dmesg` havia rotacionado para fora. Sobraram
duas linhas — e as duas eram o `fbcon` que **eu** tinha acabado de provocar. O
log de bring-up seria 100% ruído, no aparelho onde ele é a única saída.

Correção: agrupar por **assinatura** — timestamp removido e dígitos trocados por
`N` — e só comprimir a partir de 3 repetições. Por que assinatura e não
igualdade: cada linha traz timestamp **e tensão** diferentes, então `$0` nunca
agrupa. Por que o limite 3: duas linhas de mesma forma com números diferentes
(`mmc0`/`mmc1` com endereços distintos) são informação, não laço.

Medido no aparelho, com o `awk` real extraído do script:

```text
linhas reais: 1260
--- agrupado:
[ 2859.756756] rk817-charger ... Battery voltage 18540 below minimum voltage 3400000
    ... 1127 linha(s) no mesmo padrao ...
[12094.546881] fbcon: Taking over console
[12094.547878] Console: switching to colour frame buffer device 160x45
    ... 129 linha(s) no mesmo padrao ...
```

**1260 → 8 linhas, e as duas de `fbcon` sobreviveram.** É o ponto: comprimir
ruído só vale se o sinal que estava espremido nele aparecer.

#### Defeito D — "bateria 0%" num aparelho sem bateria

```text
[PASS] bateria: 0% (Not charging)
```

`present=0` significa **não há célula**; `capacity=0` com a célula presente
significa descarregada. São diagnósticos opostos — "procurar o chicote" contra
"carregar" — e o texto era o mesmo. Agora:

```text
[WARN] bateria AUSENTE (present=0) — sem célula neste aparelho;
       'capacidade 0%' aqui não é bateria vazia
```

Este aparelho é o caso do §12.58 (P3): `rk817-charger online = 0` e o cabo USB
não carrega. A consequência prática continua valendo — sessão longa nele é
aposta, e hub alimentado resolve sem tocar em software.

#### Defeito E — o status do USB mandava consular um nó que não falta

```text
$ giochi-usb --status          (imagem velha)
papel da porta USB: indisponivel
papel desconhecido: o DTS deste aparelho tem `usb-role-switch`?
```

Num aparelho cujo USB **é** o canal por onde o comando chegou. A X55 tem
`dr_mode = "otg"` no DT, nenhum `/sys/class/usb_role/*`, e
`/sys/class/udc/fcc00000.usb` com `state=configured`. O papel não é
"desconhecido": é **fixo no DT**. Agora:

```text
papel da porta USB: DEVICE (fixo no DT, sem role-switch)
  UDC fcc00000.usb: configured — gadget no ar
  o papel não é alternável neste aparelho (--host/--device não se aplicam)
  usb0: 10.55.0.2/24
```

Vale a regra do §12.30: perguntar pela **consequência** (o UDC existe e está
`configured`?) em vez de pelo indireto (existe role-switch?).

#### Os falsos avisos que eu quase reportei

Ficam registrados porque a próxima sessão vai passar por eles:

| Suspeita | Medição | Veredito |
| --- | --- | --- |
| `hci0` com `address`/`bus` vazios no sysfs | `bluetoothctl show` → `Controller A8:4F:A4:C9:98:4C`, `Powered: yes` | **funciona**; sysfs incompleto, não defeito |
| `udhcpd.leases` "binário" | é o formato binário de lease do busybox | normal |
| `wlan0` "Not connected" | não há `wpa_supplicant.conf` provisionado (§12.14) | esperado |
| `[WARN] model` | `"Powkiddy x55"` vs `"powkiddy,x55"` — mesma coisa, convenções diferentes | **falso positivo**, corrigido |
| "dois launchers rodando" | o segundo PID era **o meu próprio `sh`**, cuja cmdline continha `giochi-launcher` | armadilha do §12.46 do lado do teste |

O último virou correção de código: o `giochi-selftest` conta processos lendo
`/proc/*/cmdline`, e agora **pula `$$` e `$PPID`**. Sem isso, rodar o teste de
um shell cuja linha de comando cite `giochi-launcher` faria um launcher **morto**
passar por vivo — falso negativo, que é pior que o falso positivo do §12.34.

#### Antes e depois, no mesmo aparelho

| | imagem `60e326f` | scripts corrigidos |
| --- | --- | --- |
| `giochi-selftest` | PASS 41 · WARN 3 · FAIL 0 · SKIP 1 | **PASS 42 · WARN 1 · FAIL 0 · SKIP 1** |
| aviso de `model` | presente (falso) | ausente |
| bateria | `[PASS] bateria: 0% (Not charging)` | `[WARN] bateria AUSENTE (present=0)` |
| `giochi-usb --status` | "papel desconhecido: o DTS tem usb-role-switch?" | `DEVICE (fixo no DT)`, UDC `configured`, `usb0: 10.55.0.2/24` |
| `giochi-usbnet --status` | `dropbear NÃO está rodando` (com `ssh root@10.55.0.2` na linha de baixo) | `sshd rodando (OpenSSH)` |
| `S01splash start` | "psplash rodando mas sem fifo" | `fifo /run/psplash_fifo` |
| `S01splash stop` | não matava (FIFO "inexistente") | psplash morto, FIFO removido |
| `giochi-bootlog` (dmesg) | 1260 linhas de ruído | 8 linhas, `fbcon` preservado |

O único `WARN` que sobra é o da bateria, e ele é **verdadeiro** — o aparelho não
tem célula. Um selftest que não tem nada a dizer precisa dizer isso; um que
reporta 0% está inventando.

#### O que esta passada NÃO prova

- **A imagem no aparelho é anterior a todas as correções.** Medir aqui exigiu
  copiar cada script para `/tmp` e rodá-lo de lá; o que está instalado continua
  velho. Levar isso ao aparelho é rebuild + regravação, não `scp`.
- `giochi-init` **não** foi substituído em execução (§12.25): as funções
  (`psplash_fifo`, `stop_splash`, `assumir_console`) foram extraídas e chamadas
  isoladamente. O caminho completo `wait_for_launcher → assumir_console` só roda
  num aparelho **sem** launcher, e a X55 tem launcher.
- O `assumir_console` foi verificado com o launcher **já** rodando; a ordem
  inversa (console primeiro, launcher depois) não foi medida.

#### Defeito F — `modprobe rtl_bt`: o módulo que não existe, na linha que não avisa

O `S15modules` da X55 carregava três módulos, e um deles **não existe**:

```sh
load_module() { modprobe "$1" 2>/dev/null && echo "  $1" || true; }
load_module hci_uart
load_module rtl_bt          # <- rtl_bt.ko não existe
```

Medido no aparelho: `/lib/modules/6.12.0/kernel/drivers/bluetooth/` não tem
`rtl_bt*`, porque o suporte RTL do RTL8821CS por UART é compilado **dentro** de
`hci_uart.ko` por `CONFIG_BT_HCIUART_RTL=y`. O `hci0` sobe com `hci_uart`
carregado (e `hci_h5` **não** é módulo separado — está lá dentro também).

O que faz disso um §12 e não um commit de limpeza é o **helper**: com
`&& echo ... || true`, o módulo que falha simplesmente não aparece na lista. A
saída do boot era

```text
Carregando módulos do X55:
  rtw88_8821cs
  hci_uart
```

— que parece sucesso completo mesmo quando um dos três não carregou. Provei no
aparelho chamando o helper antigo e o novo com o nome inexistente:

```text
antigo:  Carregando módulos do X55:
           (fim — parece sucesso)
novo:      rtl_bt FALHOU (modprobe saiu 1) — verifique /lib/modules e o firmware
```

`tests/onboard-drivers.test.mjs` passou a prender as três peças: sem
`load_module rtl_bt`, com ramo de erro que **nomeia** o módulo, e com
`CONFIG_BT_HCIUART_RTL=y` no fragmento (é ele que sustenta a correção — sem esse
símbolo o BT do chip não existe em módulo nenhum).

#### Um risco da passada 2 que o aparelho descartou

Instalar `BR2_PACKAGE_KMOD_TOOLS` troca o `modprobe` do busybox pelo do `kmod`,
que **exige** `modules.dep` (o do busybox tolera a ausência). Se o Buildroot não
gerasse `modules.dep`, a correção da passada 2 trocaria "sem `depmod`" por
"nenhum módulo carrega" — pior. Medido no aparelho antes de confiar:

```text
/lib/modules/6.12.0/modules.dep       117449 B
/lib/modules/6.12.0/modules.dep.bin   176337 B
```

O `.bin` só é gerado pelo `depmod` do kmod, então quem o gerou foi o próprio
build. A troca é segura — mas o fato de ter sido preciso medir é o ponto.

### 12.62-B O CI reprovou o mesmo commit que tinha passado: a cota podia ser desligada por leitura falha

O commit da quarta passada passou no *Validate* de um push e **falhou** no do
push seguinte — mesmo código, `esperado 5 tentativas, veio 9`. Localmente nunca
reproduziu, nem sob 8× de carga de CPU, e a explicação óbvia (teste lento demais)
não fecha: máquina lenta dá **menos** tentativas, não mais.

A conta que fecha 9 é `5 + 4`: a cota zerou no meio. E o único lugar que zera
`restarts` é a janela deslizante:

```sh
now=$(uptime_seconds)          # cut -d. -f1 /proc/uptime || echo 0
if [ $((now - window_start)) -ge $RESTART_WINDOW ]; then
    restarts=0; window_start=$now
fi
```

Se `uptime_seconds` devolve vazio, `$(( ))` trata como 0; na volta seguinte
`now - 0` passa de 60 s, a janela reinicia e a contagem recomeça. Medido no
script real, com janelas diferentes:

```text
janela 3600 s ->  5 tentativas
janela   60 s ->  5
janela    2 s -> 12      <- é este caminho que produz 9
```

**O defeito não era o teste estar errado — era a proteção poder ser desligada.**
No aparelho, um `/proc/uptime` ilegível por um instante transformaria a cota em
"reinicia para sempre", que é precisamente o que ela existe para impedir: a tela
piscando sem parar, sem mensagem.

Correções, todas pequenas:

| Peça | O que faz |
| --- | --- |
| `case "$now" in ''|*[!0-9]*) now=0 ;; esac` | leitura inválida não entra em aritmética |
| `[ "$now" -gt 0 ] && [ "$now" -ge $((window_start + RESTART_WINDOW)) ]` | sem valor inválido, e só anda para frente |
| `GIOCHI_RESTART_WINDOW` / `GIOCHI_UPTIME_FILE` | o teste fixa a janela e simula o relógio |
| `uptime=${now}s` no log da queda | o dado que faltava para diagnosticar isso pelo stderr |

Dois testes, e o principal **falha se a janela for desligada** (verificado
mutando `if false; then`): "uptime ilegível não zera a cota" roda com janela de
1 s, que resetaria a cada volta se a guarda não existisse; e "um salto real de
uptime zera a cota, de propósito" prende o outro lado — sem ele, alguém
"consertaria" a cota removendo a janela, e quedas espaçadas por horas passariam a
punir o usuário.

**A lição de método:** um teste intermitente é uma informação, não um estorvo.
Aqui ele apontou um caminho real de desligamento da proteção. E o que destravou
foi olhar o **número**: 9 = 5 + 4 diz que a contagem zerou depois da quinta, e
não "o teste foi mais rápido".

### 12.63 Benchmark que responde — e cinco jeitos de ele mentir

`scripts/gpu-bench.c` + `gpu-bench.sh` existem para comparar GPU entre aparelhos
no NOSSO stack. A primeira versão (08/11/2026, X55) rodou de primeira e devolveu
cinco números, todos plausíveis à vista e **quatro deles falsos**:

| Medido | Real | Causa |
| --- | --- | --- |
| `cpu_memcpy = inf GB/s` | 3,07 GB/s | o compilador apagou o `memcpy`: o destino nunca era lido |
| `fill 1280x720 = 13406 Mpix/s` (maior que 640x480 = 4426) | 941 vs 568 | cor constante ⇒ panfrost troca o tile por `clear`; tile com CRC igual não é reescrito |
| `alu = 15575 GFLOP/s` num G52 de ~51 de pico | 28,9 | recorrência afim colapsada; e cálculo só de uniform é feito uma vez por quad |
| `many_draws` = 68 kdraws/s | 90,7 (CPU fixada) | `glGetUniformLocation` dentro do laço: media-se a Mesa, não o draw |
| `compute` = `SKIP (sem ES 3.1)` | 12,3 GFLOP/s | shader usava `#version 300 es`; SSBO é 310 es. E `glBindImageTexture` liga TEXTURA, não SSBO |

O sinal que denuncia o terceiro sem olhar o código é **aritmética**: 4096
flops/pixel × 3,8 Gpx/s = 15,6 TFLOP/s, 300× o pico do chip. Número que excede o
teto teórico do hardware não é descoberta, é erro de instrumento.

#### O quinto, e é o mais caro: o driver ELIMINA desenhos de tela cheia

Medido na X55: 200 quadros enfileirados sem sincronizar levam **49 ms**; **um**
quadro com `glFinish` leva **44 ms**. Nem `glReadPixels` depois do lote força a
execução — 200 quadros continuam custando 49 ms.

A explicação inicial ("o lote não executa o trabalho") estava incompleta. A curva
t(K) medida no R35S com o shader de ALU (141,7 ms por desenho) mostra a causa:

```text
K=1  141,673 ms      K=8   141,992 ms
K=2  142,137 ms      K=16  141,960 ms
```

141 ms × 16 seria 2,3 s; mediram-se 142 ms. **Quinze desenhos foram descartados**:
cada um sobrescreve o quadro inteiro e só o último determina a imagem. É
otimização legítima, e é o que a curva de ALU plana prova — não é falha de
sincronização.

Duas consequências, e a segunda custou uma rodada:

1. a medição é síncrona, um desenho por quadro, calibrada para ~0,5 s por teste;
2. **"tirar o custo fixo" por diferença entre K=1 e K=4 é inválido aqui** — ela
   mede o desenho que o driver eliminou. A tentativa produziu `fill` a
   8,9 Gpix/s num G31 cujo pico é ~1 Gpix/s (9× o teto) e derrubou `alu` e `tex`
   para `INVALIDO`. A regra que fica: **número acima do teto teórico do hardware
   não é descoberta, é erro de instrumento** — e o teto tem de estar escrito
   antes da medição, não deduzido depois dela.

**A trava que fecha a classe inteira:** todo teste limpa o FBO com cor sentinela,
lê o pixel de volta com `glReadPixels` e, se nada foi escrito, imprime
`INVALIDO` em vez do número. Ela denunciou três dos cinco defeitos na segunda
execução. É o §12.30 de novo: perguntar pela consequência ("o pixel mudou?"), não
pela intenção ("o comando foi enviado?").

`tests/gpu-bench.test.mjs` (12 casos) prende cada correção por texto: shader lê
`gl_FragCoord`, recorrência não-linear, `u_cycle` por quadro, nenhum
`glGetUniformLocation` em laço de desenho, `#version 310 es`, verificação em todo
teste, e o script fixando **GPU e CPU** — `governor` é o nome no devfreq e
`scaling_governor` no cpufreq, e procurar só o primeiro deixava a CPU livre
(+31% no teste CPU-bound ao fixar).

#### O resultado: G52 × G31, e a conta que valida a medida

08/11/2026, mesmo binário, Mesa 24.0.0 nos dois, governors fixados:

| Medida | R35S G31 @480 | X55 G52 @800 | Razão |
| --- | --- | --- | --- |
| `fill 640x480` | 192 Mpix/s | **568** | 2,96× |
| `fill 1280x720` | 260 | **941** | 3,62× |
| `alu_fragment` | 8,90 GFLOP/s | **28,9** | 3,25× |
| `texture_bilinear` | 28,7 Mtexels/s | **78,6** | 2,74× |
| `blend_overdraw_x8` | 304 Mpix/s | **942** | 3,10× |
| `many_draws_4000` | 49,0 kdraws/s | **90,7** | 1,85× |
| `vertex_throughput` | 7,09 Mvert/s | **15,1** | 2,13× |
| `compute_fma` | 3,77 GFLOP/s | **12,3** | 3,26× |
| `cpu_fma` | 1,28 GFLOP/s | **3,43** | 2,68× |

A validação não é a razão, é a **porcentagem do pico**: G31 MP2 = 16 lanes ×
480 MHz × 2 = 15,4 GFLOP/s de teto, medidos 8,90 (**58%**); G52 MP2 = 32 ×
800 × 2 = 51,2, medidos 28,9 (**56%**). As duas entregam a mesma fração do
próprio pico com o mesmo shader, e 3,25× ≈ 2 (lanes) × 1,67 (clock). Se um dos
dois estivesse com driver degradado, as porcentagens não casariam — é a mesma
conferência que `size` × refresh fez nos painéis (13-A).

E o item de menor ganho é o único de CPU: **1,85× em `many_draws`**, porque o
que limita é a submissão, não a GPU. Consequência de produto: no R35S um quadro
com 4000 draws pequenos tem teto de ~12 fps e na X55 ~23, **com a GPU ociosa**.
Otimizar shader não move esse número.

### 12.64 Dois aparelhos no mesmo PC: IP e MAC fixos não distinguem

O `giochi-usbnet` usa `DEV_MAC=02:47:49:4f:43:49` e `HOST_MAC=…:48` fixos, e todo
aparelho atende em `10.55.0.2`. Isso é deliberado (endereço previsível, DHCP
determinístico), mas com **dois** handhelds plugados ao mesmo tempo os dois
respondem ao mesmo IP com o mesmo MAC. Medido em 08/11/2026 com R35S e X55
ligados juntos:

```text
enx0247494f4348   10.55.0.1/24    ← X55   (usb 2-2, serial giochi-system-x55-)
usb0              10.55.0.1/24    ← R35S  (usb 2-9, serial giochi-system-r35s-)
ip neigh show dev usb0 → 10.55.0.2 lladdr 02:47:49:4f:43:49   ← mesmo MAC
```

O sintoma é o pior tipo: **tudo funciona**, e o comando vai para o aparelho
errado. `scp` para o "R35S" subiu o binário na X55; a medição teria saído com o
resultado da X55 rotulado como R35S.

**O que NÃO resolveu:** `ssh -o BindInterface=usb0`. O tráfego continuou saindo
pela interface do primeiro aparelho — conferido nos contadores
`/sys/class/net/*/statistics/rx_packets`, que não se moveram na `usb0`. A opção
existe no OpenSSH 10.2 e mesmo assim não bastou.

**O que resolve:** `SO_BINDTODEVICE` — o mesmo mecanismo do `ping -I`, e neste
kernel (6.17) **sem exigir root**. `scripts/ssh-por-iface.py` é o ProxyCommand
mínimo que faz isso; `gpu-bench.sh --iface usb0` monta a opção.

**Quem identifica o aparelho é o serial USB**, não o endereço:

```bash
for p in /sys/bus/usb/devices/*/serial; do echo "$p: $(cat $p)"; done
/sys/bus/usb/devices/2-2/serial: giochi-system-x55-
/sys/bus/usb/devices/2-9/serial: giochi-system-r35s-
```

Corolário para qualquer script que fale com "o aparelho": com mais de um plugado,
`10.55.0.2` é ambíguo, e a interface é o único discriminante. Ver
[`docs/sistema-base.md`](docs/sistema-base.md) §2-A.

### 12.65 As três varreduras de 08/11/2026: seis defeitos, e um deles era da correção anterior

Três passadas sobre o que tinha acabado de ser commitado (`3a59192`). Nenhum
defeito apareceu na compilação: `-Wall -Wextra -Wshadow -Wconversion`,
`shellcheck -S warning`, ASan/UBSan no host e `py_compile` passaram **limpos**.
Os seis que existiam precisaram de execução, leitura de curva ou de um servidor
de teste.

**Passada 1 — o proxy SSH (`ssh-por-iface.py`), dois bugs:**

| Defeito | Como apareceu | Efeito |
| --- | --- | --- |
| Sentinela `b"\0"` para "nada neste ciclo" no `recv` | servidor de eco local: 4 bytes enviados, **2 recebidos** | SSH é binário: um `0x00` que chegue sozinho é descartado e desincroniza o protocolo |
| `select(..., 60)` com `return 0` no timeout | `sleep 70` remoto | a sessão **morre** depois de 60 s sem tráfego — qualquer comando silencioso cai |

Nenhum dos dois aparece num teste de "conecta e lê um echo": o primeiro depende
do tamanho do chunk, o segundo do tempo. Corrigidos; `tests/gpu-bench.test.mjs`
prende os dois por texto e o segundo foi refeito com `sleep 70` real.

**Passada 2 — a medição do benchmark, e aqui eu tinha quebrado o que funcionava:**

A tentativa de "tirar o custo fixo por quadro" com `(t(K=4) − t(K=1))/3`
produziu `fill` a 8,9 Gpix/s num G31 cujo pico é ~1 Gpix/s. A curva explicou:
o driver **elimina** os desenhos que sobrescrevem o quadro inteiro, então a
diferença media desenho descartado. Também apareceu um erro de unidade:
`medir()` passou a devolver o custo de UM desenho e os chamadores continuaram
multiplicando por `frames` — inflação de 200×. Revertido para K=1 com
`custo_glFinish_vazio` medido e publicado (0,081 ms contra 1,63 ms de um
preenchimento), e o R35S reproduziu os números originais dentro de 5%.

**Passada 3 — a varredura no resto do repositório:**

| Defeito | Onde | Efeito |
| --- | --- | --- |
| `r35s` cravado em `out/`, `work/` e na mensagem de erro | `scripts/audio-alerta.sh` | apontado para a X55, cross-compilava com o sysroot do R35S; os dois são aarch64 e o `libSDL2` liga dinâmico, então "funcionava" |
| duração só cosmética: anunciava `${DURACAO_S}s` e chamava o probe **sem argumento** | idem | `--alar` (3 × 0,35 s) tocava 1,5 s cada, e a saída dizia 0,35 |

O aparelho agora é descoberto no `build-info.txt` da imagem (com
`GIOCHI_DEVICE` para sobrepor), e a duração chega ao binário em ms.

**O que NÃO era defeito:** `local` num script `#!/bin/sh` foi acusado pelo
shellcheck (SC3043) e testado antes de "corrigir" — `dash` e o `ash` do busybox
implementam `local`, e o teste com `/bin/sh` e com `bash` passou nos dois. Trocar
por variável global teria sido mudança sem ganho, e num script com `set -u` o
risco de vazar valor entre chamadas.

**A lição de método, e é a terceira vez que ela aparece:** os dois defeitos da
passada 3 são a mesma família do §12.30 — a ferramenta relatando a intenção em
vez do que fez. O script *dizia* 350 ms; o binário tocava 1500. E o `r35s`
cravalo fazia o script compilar "com sucesso" para o aparelho errado. Nenhum dos
dois produzia mensagem de erro.

### 12.62-C O segundo aparelho: dois avisos que estavam certos no fato e errados no veredito

Depois da quarta passada, o endereço `10.55.0.2` passou a servir um **R35S** com
imagem construída por outra sessão (`12b431d`, 07/11/2026). Rodar o selftest
corrigido nele deu `PASS 39 · WARN 2`, e os dois WARNs eram falsos — os dois pelo
mesmo defeito de método: **o teste perguntou pela existência, e a pergunta que
importa é pela consequência** (§12.30, §12.34, §12.46, §12.51).

#### O `model` — confirmado como falso positivo em outro SoC

```text
[WARN] model "Game Console R36S" não corresponde ao compatible
compatible -> gameconsole,r35s gameconsole,r36s rockchip,rk3326
model      -> Game Console R36S
```

Normalizado, `gameconsoler36s` **está** dentro do `compatible`: são o mesmo
aparelho escrito em duas convenções. Com o `_norm` da quarta passada, o aviso
sumiu — e o R35S é outro SoC (RK3326), outra família de DTS e outro painel, o
que fecha a correção como sendo da regra, não do aparelho.

#### `sem hwrng` — o nó que o SoC não tem

```text
[WARN] sem hwrng — crng pode demorar; ver nó &rng no DTS
dmesg:   [    1.758725] random: crng init done
entropy_avail: 256
```

O aviso estava factual (não há `/dev/hwrng`) e a recomendação era **impossível de
seguir**: `rk3326.dtsi` é literalmente um `#include "px30.dtsi"`, e **nenhum dos
dois declara nó de rng ou crypto** no mainline (conferido no fonte do v6.12). O
`&rng` que nasce `disabled` e precisa de patch é o do `rk356x.dtsi` da **X55** —
o aviso mandava procurar o defeito de outro aparelho, num aparelho que não tem o
nó. E enquanto isso a entropia estava pronta em **1,76 s**.

A medida passou a ser a consequência: quando o `crng` ficou pronto, lido do
dmesg. O `hwrng` virou informação de apoio (`crng init em 1s, hwrng nenhum`).

| Estado | Veredito |
| --- | --- |
| `crng init` ≤ 5 s | **PASS** — é o que importa; o `sshd` não espera |
| `crng init` tarde | **WARN** — com o tempo, porque é acionável (§3: 11,7 s no primeiro boot) |
| nó de rng no DT, sem `/dev/hwrng` | **WARN** — falta `CONFIG_HW_RANDOM` ou o driver do SoC |
| sem dmesg e sem nó | **WARN** dizendo "este SoC não declara TRNG" — não dá para afirmar que está ruim |
| hwrng ativo, dmesg rotacionado | **PASS** — o registro positivo ainda vale |

#### `console de texto NÃO está na tela` — o estado correto tratado como defeito

Este aviso nasceu na quarta passada, para separar "fbcon não assumiu" de
"`CONFIG_ROTATION` desligado". No R35S ele apareceu com o **launcher rodando e
desenhando**:

```text
pidof giochi-launcher -> 4772
/sys/class/vtconsole/vtcon*/name -> (S) dummy device     (só)
```

Com o launcher dono do DRM master, **um console de texto por cima seria o
defeito**. A pergunta certa não é "o fbcon assumiu?", é "há algo desenhando na
tela?" — e a resposta depende de quem deveria estar lá:

| Quem é a interface | fbcon fora da tela | Veredito |
| --- | --- | --- |
| launcher rodando | esperado | **PASS** (com o motivo escrito) |
| launcher instalado, parado | nada desenha | **WARN** — tela parada, §12.45 |
| sem launcher | o console É a interface | **WARN** — é o caso que o `assumir_console` do `giochi-init` corrige |

Antes/depois no mesmo aparelho, mesma imagem (`12b431d`), rodando o script a
partir de `/tmp`:

```text
imagem:            PASS 39 · WARN 2 · FAIL 0 · SKIP 4
corrigido:         PASS 41 · WARN 0 · FAIL 0 · SKIP 3
```

O `SKIP` que virou `PASS` é o do `evtest`, por diferença de contagem entre as
duas versões do script; o que interessa é `WARN 2 → 0` com os dois motivos
nomeados.

#### O padrão, escrito de novo porque já é a quinta vez

Um WARN que não pode ser seguido é pior que nenhum: ele ensina o operador a
ignorar o bloco inteiro (§12.22, §12.34). Antes de escrever o aviso, a pergunta
é sempre a mesma — **qual é a consequência, e ela pode ser medida agora?** Aqui:
"o crng ficou pronto a tempo?" e "há algo desenhando na tela?". As duas cabiam no
`/proc` e no `dmesg` deste aparelho.

## 13. Aparelhos

| ID | Pasta | SoC | Arch | Status | Falta |
| --- | --- | --- | --- | --- | --- |
| `qemu-aarch64` | `qemu-aarch64/` | virtual | arm64 | **ready** | nada — é o smoke test do pipeline |
| `powkiddy-x55` | `powkiddy x55/` | RK3566 | arm64 | draft | **boota com tela, áudio, Wi-Fi, BT e 16 botões + 4 eixos**; falta o launcher (do `Giochi app`) |
| `powkiddy-x35s` | `powkiddy x35s/` | **RK3566** | arm64 | draft | DTS (compartilha com o X35H) e build |
| `powkiddy-x35h` | `powkiddy x35h/` | **RK3566** | arm64 | draft | **boota com tela 640x480, `usb0` e SSH**; imagem de 04/11 já tem o `respawn`. Falta o launcher, o teste A/B de cartão e os eixos analógicos |
| `r35s` | `r35s/` | RK3326 | arm64 | draft | **BOOTOU em 06/11/2026 e testado por SSH em 06/11**: tela 640x480, `r36s_Gamepad` com 16 botões + 4 eixos, áudio (`rk817_int`), bateria, térmica e GPU (§12.51, §12.52) |
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
- **O R35S tem áudio** — medido em 06/11/2026 na imagem `779fc64`:
  `placas de som: 0 [rk817int]: simple-card - rk817_int` e `Playback Mux = HP`,
  com `libasound` presente. O `--- no soundcards ---` da primeira sessão estava
  resolvido pelo par `CONFIG_SND_SIMPLE_CARD=y` + `BR2_PACKAGE_ALSA_LIB` (§12.43).
- **R35S: GPU, bateria e térmica só funcionam com `=y`** — a imagem `779fc64`
  saía com `panfrost`, `rk817_charger` e `rockchip_thermal` todos `=m` e sem
  autoload: `softpipe` no 3D, `/sys/class/power_supply` vazio e nenhum
  `thermal_zone`. Os três foram medidos com `modprobe` no aparelho e corrigidos
  (§12.51); a imagem com a correção é a próxima a ser gerada.
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
| Código e configuração | **pronto** — 510/510 testes |
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

0. **GIOCHI-ENGINE: aguardando decisão de virar item obrigatório.** O dono do
   projeto decidirá com a equipe do app. O que já está medido, para a decisão não
   ser tomada no escuro:

   | Verificação | Resultado |
   | --- | --- |
   | compila contra o sysroot do Buildroot | OK, `scripts/engine-build.sh` |
   | dependências do binário | `libSDL2_image`, `libSDL2_mixer`, `libSDL2`, `libgcc_s`, `libc` — as 5 na imagem |
   | vídeo | `driver de vídeo SDL2 ativo: KMSDRM`, `master = y` |
   | prova de desenho | `framebuffer[N] allocated by = hello_rect, refcount = 2`, 640x480 XR24 |
   | prova visual | **fundo azul com quadrado se movendo**, confirmado pelo dono do aparelho |
   | input | `gamepad conectado: r36s_Gamepad` |
   | áudio | `WARN = 0`, `/dev/snd/pcmC0D0p` aberto |
   | erros no log | 0 |

   **O que falta decidir, e é decisão de produto, não técnica:** a engine é
   *biblioteca + exemplo* (`giochi-demo`), não aplicativo. Empacotar o
   `giochi-demo` no rootfs prova a stack, mas quem o usuário abre é o **launcher**,
   que é do `Giochi app` e entra por overlay. As duas perguntas concretas:
   (a) a imagem passa a levar o `giochi-demo` como smoke test de GPU/áudio, ou
   (b) a engine fica só como dependência de *build* do launcher, e nada dela vai
   no rootfs.

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

   **O número do NOSSO stack foi medido em 06/11/2026**, no R35S com a nossa
   imagem, `gles-probe.c` compilado pelo cross-toolchain do build (§12.51):

   ```text
   GL_RENDERER         = Mali-G31 (Panfrost)
   GL_VERSION          = OpenGL ES 3.1 Mesa 24.0.0
   GLSL_VERSION        = OpenGL ES GLSL ES 3.10
   GL_MAX_TEXTURE_SIZE = 8192
   extensões GL        = 128
   GL_OES_geometry_shader     = NÃO
   GL_OES_tessellation_shader = NÃO
   GL_OES_texture_float       = SIM
   ```

   O A/B que este item pedia (`rmmod mali_kbase` + `modprobe panfrost`) não foi
   necessário: o blob da ARM não está na nossa imagem, então o "antes" saiu de
   tirar o panfrost — mesmo aparelho, mesmo stack.

   A decisão do §15 está confirmada com medição, não com expectativa: GLES 3.1
   com compute, sem geometry shader. Registro também o que quase a invalidou —
   sem panfrost o probe devolve **a mesma `GL_VERSION`** com `GL_RENDERER =
   softpipe`. `GL_VERSION` não distingue GPU de CPU; `GL_RENDERER` sim.
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
node scripts/validate-devices.mjs      # 7 devices, 1 habilitado
node tests/run-all.mjs                 # 510/510
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

## 20. Salva-vidas: estado no fim da sessão de 06/11/2026

**O shell desta sessão morreu.** Todo comando passou a devolver
`Exec format error (os error 8)` — inclusive `/bin/echo` e `true`, ou seja, o
problema é de criação de processo no ambiente, não de PATH nem de script. As
ferramentas de arquivo continuam funcionando (`view`, `edit`), então o trabalho
foi preservado em disco mas **não pôde ser commitado** pelo agente.

### O que JÁ está em `origin/main`

```text
4b1ee8f  flash-dd: o método tradicional (dd puro), e o r35s gravado no cartão
779fc64  flash-sd: --grow usa o cartão todo (2 GiB de imagem num cartão de 128 GB)
c04747d  r35s: RTC persistente, quota de restart por tipo de saída, splash e dongle
```

`node tests/run-all.mjs` → **386/386** no último run antes da morte do shell.

### O que ficou SEM commit (dois arquivos — este e o README)

`device/r35s/README.md` — a frase "o loader do fabricante é o único que liga
nesta placa; o U-Boot mainline testado deu tela preta sem print no serial"
estava **desatualizada e errada**. O mainline liga desde 06/11/2026: a causa era
`rk_board_late_init()` do `odroid-go2` lendo o SARADC e dando
`Unable to detect device type: -6` → `### ERROR ### Please RESET the board ###`, e
as duas correções (`uboot-patches/0001-…-adc-nao-fatal.patch` +
`uboot.fragment`) já estão no repositório e o build de hoje as aplicou
(`uboot: fragmento aplicado (5 símbolos)`, `uboot: 1 patch(es) de U-Boot`).

**Para commitar quando o shell voltar:**

```bash
cd /home/charles/Giochi/GIOCHI-SYSTEM
node tests/run-all.mjs                                   # esperado: 510/510
git add device/r35s/README.md AGENTS.md
git commit -m "r35s: o U-Boot mainline liga; a frase do README estava desatualizada

O README dizia que 'o loader do fabricante é o único que liga nesta placa' e
que 'o U-Boot mainline testado deu tela preta sem print no serial'. Era o
registro do SINTOMA antes da causa ser encontrada, e virou fato por repetição.

A causa medida: rk_board_late_init() do odroid-go2 lê o SARADC canal 0 e
compara com a tabela de resistores da Hardkernel; o R35S não tem esse resistor,
então 'Unable to detect device type: -6' -> '### ERROR ### Please RESET the
board ###' — invisível porque a console do U-Boot estava a 115200 e a do
kernel a 1500000.

As duas correções já estavam no repositório (uboot-patches/0001 + uboot.fragment)
e o build de 06/11 as aplicou. O README é que não tinha sido atualizado.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push git@github.com:xtrempkch-droid/GIOCHI-SYSTEM.git HEAD:main
```

### O cartão do R35S: gravado e conferido (não se perde)

Cartão **SE32G de 29,7 GiB**, `/dev/sdb`, gravado com `dd` puro
(`scripts/flash-dd.sh`, 2 GiB em 61 s a 35 MB/s, via `pkexec`).

Conferido **lendo o cartão**, sem confiar no `dd`:

| Parte | SHA256 medido | Igual a |
| --- | --- | --- |
| firmware no setor 64 | `1770c1a0…` | `out/r35s/u-boot-rockchip.bin` |
| FAT: `Image` | md5 `35d8eb3c…` | `out/r35s/Image` |
| FAT: DTB | md5 `7be37912…` | `rk3326-gameconsole-r36s-giochi.dtb` |
| `p2` (1024 MiB) | `0e45addb…` | `out/r35s/rootfs.ext4` |

`extlinux.conf` no cartão: `fdt /dtbs/rk3326-gameconsole-r36s-giochi.dtb`,
`timeout 30`, cmdline com `console=ttyS2,1500000n8` e **sem** `menu title` (§12.38).

O `build-info.txt` **dentro** do cartão diz `commit=779fc64…` — foi a correção
desta sessão: antes só o `out/build-info.txt` levava o commit, então a imagem no
aparelho não dizia de onde veio.

### O que NÃO foi feito

- **Não bootou.** O cartão está gravado e desmontado; falta colocar no aparelho e
  ler a serial (1500000). Nada foi medido no hardware nesta rodada.
- **O cartão de 128 GB** (116,1 GiB) não está mais no leitor. O de 29,7 GiB é o
  que estava. Suspeita registrada: a gravação anterior foi para o de 128 GB e o
  cartão que voltou ao leitor foi o pequeno — a `.img` do X35H de 03/11 que está
  nele (antes desta gravação) era a antiga, com `menu title` e `Image` de 03/11.
- **`--grow` não foi exercitado em cartão real**, só em arquivo: `sfdisk -N 2 ',+'`
  cresceu 200 → 896 MiB num disco de 1024 MiB e `resize2fs` foi de 200 MiB para
  2 GiB. A `.img` do R35S no cartão de 29,7 GiB ficou com os 2 GiB da imagem
  (a gravação foi `dd` puro, sem `--grow`).

### A lição que fica

O shell morrer no meio não apagou nada porque cada passo tinha sido **medido e
escrito** antes do passo seguinte. O que faltou foi o commit — por isso esta
seção existe. Se a próxima sessão começar com `git status` mostrando só
`device/r35s/README.md` modificado, está tudo consistente com o que está aqui.


## 21. X55 reconstruído e o cartão de 116 GiB gravado (07/11/2026)

A `.img` do X55 em `out/` era de **04/11** (`commit=151b416`), 30 commits atrás.
Entre ela e `60e326f` entraram SDL2 image/ttf/mixer, ALSA utils, `giochi-usb`,
`giochi-usbnet` com mass storage, `giochi-godot`, `S01splash`, `S50hwclock`,
`S51mixer`, as duas chaves da loja e o `--grow`. Por isso o build foi **do zero**:
as mudanças acrescentam dependência de pacote, e `KEEP_WORK=1` não reconfigura
pacote já compilado (§12.29).

```text
commit     60e326f35ac34a7bb86abb0931a69643495da8bb   (= origin/main)
built_at   2026-11-07T18:47:04Z
assert-config        25 símbolos de 2 fragmentos
assert-kernel-config 72 símbolos (2 allow-drop: JOYSTICK_ROCKNIX, ARM_ROCKCHIP_CPUFREQ)
sha256 img           ba8f4afd1783f11ce4160d3f61bae273c7211ff2716ed5cc00916339b53d1ef6
```

O `built_at` acima é o de `out/<device>/build-info.txt`, gravado no fim do
build. O `/etc/giochi/build-info.txt` **dentro da imagem** leva o instante do
`post-build.sh` (aqui `17:49:22Z`, ~1 h antes, porque o `make` continuou depois
dele). Os dois têm o mesmo `commit=`, e é o commit que identifica a imagem. O
ano desse arquivo é o piso do RTC (§12.48) — 2026 nos dois.

Conferido **lendo o cartão**, não o `out/`:

| Parte | Medida | Igual a |
| --- | --- | --- |
| firmware no setor 64 (18348 setores) | `a84f2fa6…` | `out/…/u-boot-rockchip.bin` |
| FAT: `Image` | md5 `d1e6b234…` | `out/…/Image` |
| FAT: `rk3566-powkiddy-x55.dtb` | md5 `4edab3eb…` | `out/…/rk3566-powkiddy-x55.dtb` |
| `/etc/inittab` linha 30 | `::respawn:/usr/bin/giochi-init` | — |
| scripts `S??*` e `giochi-init` | todos `0755` | §12.50 |
| inodes usados | 3603 nos dois | `out/…/rootfs.ext4` |
| `e2fsck -n` no p2 | `clean` | — |

`extlinux.conf` no cartão: `timeout 30`, **sem** `menu title` (§12.38), `fdt`
próprio, cmdline `console=ttyS2,1500000n8 … fbcon=rotate:3` com
`root=PARTUUID=47494f43-02`.

**`--grow` exercitado em cartão real pela primeira vez.** Cartão Multi-Reader de
**116,1 GiB** em `/dev/sdd`, gravado com `flash-sd.sh --expect-gib 116 --grow` a
43,6 MB/s: o SHA256 dos 2 GiB foi conferido **antes** de crescer, e o `p2` passou
de 1,7 GiB para **115,8 GiB** (`30356480` blocos, `e2fsck -n` limpo). A diferença
de blocos usados entre a imagem (53 500) e o cartão (526 517) é a tabela de
inodes criada pelo `resize2fs` — 926 grupos × 512 blocos ≈ 473 mil — e não
conteúdo perdido: os 3603 inodes usados e as 242 entradas de `/usr/bin` batem.

**Sem `sudo` no host:** a gravação foi por container privilegiado com `/dev` e
`/sys` do host (`docker run --privileged --user 0:0 -v /dev:/dev`), que é o
caminho que o próprio `flash-sd.sh` documenta. `lsblk` falha dentro do container
(erro de libc, já previsto no script) — a conferência de partições foi por
`sfdisk -d` e `blockdev --getsize64`.

**O que esta rodada NÃO prova:** nada foi medido no aparelho. O cartão está
gravado, conferido e desmontado; falta colocá-lo no X55 e ler a serial a
1500000. A imagem anterior ficou em `out/_anterior-x55-20261104/` para rollback.
