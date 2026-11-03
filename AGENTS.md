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
- Camada de boot inicial no overlay comum: `giochi-init` e `giochi-selftest`.
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
| + `CONFIG_JOYSTICK_ADC` + patch 0002 (BTN_MODE) | **PASS 20 · WARN 3 · FAIL 0 · SKIP 2** |

O que passou e é o que importa para "sair do console":

- painel HX8394: `card0-DSI-1: connected 720x1280`, backlight `833/1666`;
- `/dev/dri/card0` + render node (`panfrost`), driver `rockchip-drm`;
- rootfs em `/dev/root` no cartão, console `ttyS2`;
- **`wlan0` com MAC real** e `iw scan` devolvendo redes (`Kill.exe`, -24 dBm);
- áudio: `0 [rk817ext]: simple-card - rk817_ext`;
- `hwrng: rockchip-rng`;
- **17 botões de gamepad** (`gpio-keys-control`, inclui BTN_MODE pelo patch 0002);
- **4 eixos analógicos** (`adc-joystick`, ABS_X/Y/RX/RY) — exige `CONFIG_JOYSTICK_ADC`;
- `gpio-keys-vol` e `/etc/giochi/buttons.map` (31 linhas);
- bateria `40C`, UDC `fcc00000.usb`.

As três falhas fechadas, cada uma com causa medida:

| Sintoma | Causa | Correção |
| --- | --- | --- |
| `--- no soundcards ---` | card `rk817_ext` usa `aux-devs = <&spk_amp>`; `SND_SOC_SIMPLE_AMPLIFIER` estava `=m` e não carrega sem autoload | `=y` no `linux.fragment` |
| `sem hwrng` | `rng@fe388000` nasce `disabled` no `rk356x.dtsi` | `&rng { status = "okay" }` no patch de DTS |
| `nenhuma interface além de lo` | módulos `=m` e o rootfs não tem `/etc/modules` nem `modules-load` | `rootfs-overlay/etc/init.d/S15modules` |
| sem `adc-joystick` | nó do DTS sem driver: `CONFIG_JOYSTICK_ADC` não estava ligado | `=y` no `linux.fragment` + `kernel-required.txt` |

Ganho colateral medido: boot até o `sshd` caiu de **11,7 s para 2,1 s** com
entropia disponível desde o começo.

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
│   │   └── usr/bin/
│   │       ├── giochi-init            # mantém o launcher vivo; restaura brilho
│   │       └── giochi-selftest        # diagnóstico do aparelho até o render 3D
│   ├── qemu-aarch64/                  # device de referência (habilitado)
│   ├── powkiddy x55/                  # RK3566 — draft
│   │   ├── defconfig                  # base Buildroot (o que bootou no antecessor)
│   │   ├── patches/                   # DTS: HDMI off, SDIO, uart1 DMA, &rng
│   │   ├── kernel-required.txt        # símbolos que o kernel PRECISA ter
│   │   ├── busybox.fragment           # desliga o applet tc (não compila no 6.12)
│   │   ├── device.json, buildroot.fragment, linux.fragment, buttons.map
│   │   └── README.md, rootfs-overlay/
│   ├── powkiddy x35s/                 # RK3326 — draft
│   ├── powkiddy x35h/                 # RK3326 — draft
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
`prepare-config` só mexe em hostname/issue/senha/DL_DIR/OVERLAY/ccache. Isso é o
que torna a instalação do `/etc/inittab` uma decisão em aberto (§11).

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

`node tests/run-all.mjs` → **36/36**:

| Arquivo | Testes | Cobre |
| --- | --- | --- |
| `tests/devices.test.mjs` | 13 | índice, schema, pastas com espaço, matriz, draft habilitado, `allowDraft` por id vs `all`, mensagem de recusa |
| `tests/assert-config.test.mjs` | 12 | símbolo que sobrevive, desaparece, cai `=y`→`=m`, pedido-desligado-veio-ligado, `allow-drop`, aspas |
| `tests/fdt.test.mjs` | 11 | parse de DTB, gpio-keys, adc-joystick, `buttons.map`, truncado/ inválido |

## 11. A camada de boot — o que falta para o aparelho sair do console

O launcher **não faz `fork`**: faz `exec` para abrir um jogo, para nunca haver
dois processos disputando o DRM. Quem o reinicia quando o jogo termina é o
`giochi-init`.

```text
giochi-init ──▶ launcher ──exec──▶ jogo
     ▲                              │
     └────────── jogo termina ──────┘
```

O script existe, está executável no índice do Git, tem o limite de 5 reinícios em
60 s **testado** (§3) e um comportamento de desistência correto: para de
reiniciar mas continua vivo, porque matar o PID 1 derruba o kernel.

**Uma ligação falta; as outras duas já estão feitas e testadas:**

1. **`/etc/inittab` sem a linha `::respawn:/usr/bin/giochi-init`.** Sem ela, o
   `giochi-init` está na imagem e ninguém o chama.
   O caminho óbvio (`BR2_ROOTFS_POST_BUILD_SCRIPT`) é justamente o que a §7 evita
   sobrescrever. As opções são: (a) assumir a autoria completa do `/etc/inittab`
   no overlay comum; (b) usar post-build e aceitar o acoplamento com defconfigs
   de placa. **É uma decisão em aberto, não um bug.**
2. **`buttons.map` chega ao rootfs** (feito). O staging copia
   `device/<pasta>/buttons.map` para `etc/giochi/buttons.map` e avisa quando o
   aparelho não tem mapa.
3. **`giochi-init` não sai mais em 99 ms** (feito): medido, ele saía com `exit 1`
   quando o launcher não existia — e com `::respawn:` isso vira ~10 reinícios por
   segundo inundando o console. Agora espera em intervalos de
   `GIOCHI_LAUNCHER_WAIT` (30 s), sem CPU e sem ruído.

Fora do escopo daqui: `giochi-controllers` (configurador de controles) não
existe. Ele precisa ser **binário separado, iniciado antes do launcher** — se o
mapeamento está errado, o usuário não consegue navegar até a tela de
configuração.

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

### 12.15 `awk` do busybox não tem `strtonum`

O contador de bits do `giochi-selftest` usava `strtonum("0x" $i)`, que é extensão
do **gawk**. No busybox awk a função não existe e a expressão devolve vazio: o
teste "passa" com contagem zero, e um zero que parece válido é pior do que erro.
A versão que ficou conta dígito a dígito com `index`/`substr` e uma tabela de
pesos — funciona em busybox, gawk e mawk.

Regra ao escrever shell para este rootfs: o alvo é **busybox ash + busybox awk**,
não bash + gawk.

### 12.16 `BR2_TARGET_GENERIC_GETTY_BAUDRATE_*` reprograma a UART

Um baud explícito no getty faz o getty **reprogramar** a UART para aquela
velocidade, ignorando o que o kernel configurou. No X55 (console a 1500000), o
`115200` herdado do fragmento comum derrubava a console e a saída virava lixo —
o sintoma parece "console morto", não "baud errado".

Decisão: `BR2_TARGET_GENERIC_GETTY_BAUDRATE_KEEP=y` no
`config/common.fragment`. O getty recebe `0` e não mexe na velocidade; quem
manda no baud é a linha de comando do kernel. Verificado no rootfs do aparelho:
`console::respawn:/sbin/getty -L  console 0 vt100`.

## 13. Aparelhos

| ID | Pasta | SoC | Arch | Status | Falta |
| --- | --- | --- | --- | --- | --- |
| `qemu-aarch64` | `qemu-aarch64/` | virtual | arm64 | **ready** | nada — é o smoke test do pipeline |
| `powkiddy-x55` | `powkiddy x55/` | RK3566 | arm64 | draft | **boota com tela, áudio, Wi-Fi e 17 botões + 4 eixos**; falta firmware de BT (`rtl8821cs_fw.bin`) |
| `powkiddy-x35s` | `powkiddy x35s/` | RK3326 | arm64 | draft | o mesmo + driver de joypad |
| `powkiddy-x35h` | `powkiddy x35h/` | RK3326 | arm64 | draft | o mesmo |
| `r35s` | `r35s/` | RK3326 | arm64 | draft | pipeline RK3326 (BL31/DDR/U-Boot), joypad fora da árvore |
| `steamdeck` | `steamdeck/` | x86_64 | x86_64 | draft | kernel, firmware, áudio, Wi-Fi, controle |

Mapas de botão: saem do **DTS**, não de banco público (`docs/button-maps.md`).
O R35S é o que está mais avançado nisso: o DTB real está versionado em
`device/r35s/dts/` e o `buttons.map` saiu dele. Confirmação final só com
`evtest` no aparelho.

## 14. Próximos passos, por ordem de risco

1. **Interface de jogos (produto, não sistema).** Os controles de hardware estão
   completos: 17 botões + 4 eixos, medidos no aparelho. O que falta é o launcher,
   que é do `Giochi app` — este repositório entrega o sistema.
2. **Firmware de Bluetooth**: `rtl_bt/rtl8821cs_fw.bin` não vem no
   `linux-firmware` (só `rtl8821c_fw.bin`). O `hci_uart` carrega e o chip
   responde, mas o download falha com `-2`. Junto com o `rtl8821cs_config.bin`
   de 25 bytes, é o último item de rádio.
3. **`amixer` ausente no rootfs** — o selftest não consegue conferir o
   `Playback Mux` em `HP`. Adicionar `BR2_PACKAGE_ALSA_UTILS` com o applet.
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

Ordem sugerida para a próxima sessão:

```bash
cd "C:\Users\Jussara dias\Desktop\plataforma sistema\Giochi system"
node scripts/validate-devices.mjs      # 6 devices, 1 habilitado
node tests/run-all.mjs                 # 36/36
node scripts/list-devices.mjs --github-matrix
```

Depois, no GitHub (não há como disparar dispatch sem token daqui):

1. Actions → *Build Giochi System ARM64* → Run workflow
2. `device: powkiddy-x55`, `allow_draft: true`
3. Se falhar, o passo que interessa é o **Build image**, e a mensagem do
   `assert-config` vem com o nome do símbolo. Sem token, `GET
   /actions/jobs/<id>/logs` devolve 403 — leia pela interface.

Estado do Git nesta revisão: `main` limpo, sincronizado com `origin/main`
(`d9e81aa`), remoto `https://github.com/xtrempkch-droid/GIOCHI-SYSTEM.git`.

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
