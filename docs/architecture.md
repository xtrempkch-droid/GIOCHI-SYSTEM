# Arquitetura

## Visão geral

O Giochi System é uma árvore de configuração sobre o [Buildroot](https://buildroot.org/). O repositório não mantém um fork do Buildroot: ele baixa a versão fixada em [`buildroot.version`](../buildroot.version), aplica o defconfig de cada dispositivo, mescla um fragmento comum e fragmentos específicos e então compila uma imagem Linux.

```text
device/devices.json
        │
        ▼
scripts/list-devices.mjs ──► matriz do GitHub Actions
        │
        ▼
scripts/build-device.sh <device>
        │
        ├── baixa Buildroot (versão fixada)
        ├── aplica <buildrootDefconfig>
        ├── mescla config/common.fragment + device/buildroot.fragment
        ├── copia overlays para um staging sem espaços
        ├── make olddefconfig
        ├── make -j
        └── copia artefatos + Buildroot .config + SHA256SUMS
```

## Fonte da verdade

### `device/devices.json`

Lista os dispositivos e o estado de habilitação:

```json
{
  "id": "qemu-aarch64",
  "folder": "qemu-aarch64",
  "arch": "arm64",
  "enabled": true
}
```

- `id`: slug estável usado no CI, nos artefatos e no `device-info`.
- `folder`: pasta real em `device/`. Pode conter espaços.
- `arch`: precisa bater com o `device.json`.
- `enabled`: só entra na matriz de build quando `true`.

### `device/<pasta>/device.json`

Descreve o hardware e o contrato de build:

```json
{
  "id": "qemu-aarch64",
  "name": "QEMU AArch64 Virt",
  "arch": "arm64",
  "hostname": "giochi-system-qemu",
  "buildrootDefconfig": "qemu_aarch64_virt_defconfig",
  "buildrootFragment": "buildroot.fragment",
  "rootfsOverlays": ["rootfs-overlay"],
  "artifacts": ["Image", "rootfs.ext*"],
  "runner": "ubuntu-24.04",
  "timeoutMinutes": 300,
  "status": "ready"
}
```

Campos relevantes:

| Campo | Uso |
| --- | --- |
| `buildrootDefconfig` | Nome de um defconfig da árvore Buildroot. Obrigatório para devices habilitados. |
| `buildrootFragment` | Fragmento com opções específicas do hardware. |
| `buildrootFragments` | Opcional. Lista ordenada de fragmentos por área (`panel`, `input`, `audio`…). Quando presente, é aplicada após `buildrootFragment`. |
| `kernelPatches` | Opcional. Pastas ou arquivos em `patches/kernel/` aplicados ao kernel antes do build. |
| `firmwareFiles` | Opcional. Arquivos em `firmware/` instalados no rootfs. |
| `rootfsOverlays` | Pastas copiadas para o rootfs, em ordem, depois do overlay comum. |
| `artifacts` | Padrões de arquivo procurados em `output/images/`. |
| `runner` | Runner do GitHub Actions. |
| `timeoutMinutes` | Timeout do job de build (60–360). |
| `status` | `ready` ou `draft`. |
| `arch` | `arm64`, `x86_64` ou `arm`. O build padrão é `arm64`. |

Os três campos marcados como opcionais (`buildrootFragments`, `kernelPatches`, `firmwareFiles`) são aditivos: um `device.json` que não os declara continua válido e não muda de comportamento.

## Mesclagem de configuração

O Buildroot não tem um merge de fragmentos universal. O script [`prepare-config.mjs`](../scripts/prepare-config.mjs) faz:

1. Lê o `.config` gerado pelo defconfig.
2. Aplica `config/common.fragment`.
3. Aplica o fragmento do device; a última definição vence.
4. Define `BR2_TARGET_GENERIC_HOSTNAME`, `BR2_TARGET_GENERIC_ISSUE` e `BR2_TARGET_GENERIC_ROOT_PASSWD`.
5. Define `BR2_DL_DIR` para o cache.
6. Anexa os overlays comuns e do device a `BR2_ROOTFS_OVERLAY`, preservando o que o defconfig já tiver.
7. O build roda `make olddefconfig` para resolver dependências e remover símbolos desconhecidos.

Os scripts de pós-build e pós-imagem do defconfig **não são sobrescritos**. Isso é essencial para placas que dependem do `post-build.sh`/`post-image.sh` do Buildroot (por exemplo, Raspberry Pi e outras SBCs).

## Overlays e caminhos com espaços

`BR2_ROOTFS_OVERLAY` é uma lista separada por espaços; caminhos com espaços quebram o Buildroot. Por isso, o build copia os overlays para:

```text
<work>/<device>/build/giochi-system-overlays/00-common/
<work>/<device>/build/giochi-system-overlays/01-device/
...
```

E usa esses caminhos sem espaços no `.config`. A pasta de origem pode ser `device/powkiddy x55/` sem problemas.

## Artefatos

O build copia para `out/<device>/`:

- arquivos que casarem com `artifacts` (por exemplo, `Image`, `rootfs.ext4`, `sdcard.img`);
- `buildroot.config` — configuração final resolvida;
- `device.json` e `buildroot.fragment` — configuração usada;
- `DEVICE.md` — documentação do device;
- `build-info.txt` — versão, commit, data, host e arquitetura;
- `SHA256SUMS` — checksums de todos os arquivos.

## Camada de drivers e painel (por dispositivo)

O Giochi System é uma base **limpa**: kernel + rootfs + imagem de boot. Tudo que é específico de hardware — driver de painel, backlight, toque, botões, analógicos, áudio, Wi-Fi — mora em `device/<pasta>/`, nunca em `device/common/`.

Regra de ouro: **se o arquivo só faz sentido para um aparelho, ele pertence à pasta daquele aparelho.** O código comum não conhece nenhum painel nem nenhum SoC.

### Áreas do dispositivo

```text
device/<pasta>/
├── device.json               # contrato de build (defconfig, overlays, artefatos)
├── buildroot.fragment        # opções Buildroot exclusivas (kernel, DTB, pacotes)
├── patches/                  # patches aplicados antes do build
│   ├── kernel/               #   ex.: painel DSI, backlight, GPIO keys
│   └── buildroot/            #   ex.: ajustes de pacote
├── firmware/                 # blobs que vão para o rootfs (Wi-Fi, BT, DSP)
├── rootfs-overlay/           # arquivos finais montados no rootfs
│   ├── etc/giochi-system/       #   device-id, notes
│   └── usr/share/            #   dados de calibração, mapeamentos
└── README.md                 # hardware, pinout, pendências
```

`patches/` e `firmware/` são **opcionais**; um device que não precisa deles simplesmente não cria as pastas. `device.json` aponta para elas quando existirem, de modo que o script de build só as processa se estiverem declaradas.

### Fragmentos de driver

Cada device pode declarar **vários fragmentos**, em vez de um só arquivo monolítico. A ordem de aplicação é sempre a mesma:

```text
config/common.fragment          ← base do projeto
device/<pasta>/buildroot.fragment      ← opções gerais do hardware
device/<pasta>/buildroot.<area>.fragment ← fragmentos por área
```

Fragmentos por área nomeiam o domínio do hardware, por exemplo:

| Fragmento | Conteúdo típico |
| --- | --- |
| `buildroot.panel.fragment` | `CONFIG_DRM_PANEL_*`, `BACKLIGHT_*`, `DRM_PANIC_SCREEN`, modo gráfico |
| `buildroot.input.fragment` | `INPUT_GPIO_KEYS`, `INPUT_JOYDEV`, `REGULATOR_*` do toque |
| `buildroot.audio.fragment` | codec (`SND_SOC_*`), `SOF_FIRMWARE`, `ALSA_UCM` |
| `buildroot.wifi.fragment` | driver da placa de rede + `linux-firmware` mínimo |
| `buildroot.boot.fragment` | U-Boot, `genimage`, layout de partições |

A regra da mesclagem continua sendo "a última definição vence". O build aplica `common` → `buildroot.fragment` → fragmentos por área em ordem alfabética, então um fragmento de área pode eclipsar uma opção do fragmento geral de propósito, mas nunca o comum.

O campo `buildrootFragments` no `device.json` lista os fragmentos na ordem desejada e substitui `buildrootFragment` (que continua aceito para compatibilidade com os devices existentes).

### Quando o fragmento não basta: `buildroot-external/`

Fragmento só muda **símbolo de Kconfig**. Há ajustes que precisam mexer nas
opções de configuração de um pacote, e para esses existem dois mecanismos, com
uma diferença que decide onde cada coisa mora:

| Mecanismo | Quando entra no Makefile | `VAR +=` na receita |
| --- | --- | --- |
| `config/package-overrides.mk` | **antes** das receitas (`:528`) | sobrescrito (`=`) |
| `buildroot-external/external.mk` | **depois** das receitas (`:545`) | **soma** |

Regra que decorre: ajuste que **acrescenta** opção, aproveitando o que o
`.config` do aparelho já decidiu, mora no `external.mk`. Ajuste que
**substitui** variável inteira mora no `package-overrides.mk`, com `override`.

Hoje a árvore externa tem **uma** linha — `--enable-video-dummy` no SDL2, porque
a receita do Buildroot desliga o driver em opção fixa e não há símbolo de
Kconfig. Dependências de pacote entram no `Config.in` dela, não no
`common.fragment`.

> **`BR2_EXTERNAL` tem de ser exportado em toda invocação do `make`.** O
> Buildroot regenera `$(O)/.br2-external.mk` a partir da variável; sem ela o
> arquivo é zerado em silêncio e os pacotes são construídos **sem** os ajustes.
> O `build-device.sh` exporta; quem depurar à mão dentro de
> `work/<device>/build` precisa repetir, com caminho absoluto.


### Driver de painel

O painel é o caso mais crítico, porque combina quatro peças independentes:

1. **DTB** — o panel node do device tree (timings, `compatible`, rotação, DSİ/eDP).
2. **Kernel** — o `CONFIG_DRM_PANEL_<nome>` correspondente precisa estar ligado.
3. **Backlight** — `CONFIG_BACKLIGHT_PWM` ou `BACKLIGHT_GPIO`, mais o `pwm-backlight` no DTB.
4. **Usuário** — orientação, brilho persistido e calibração do toque ficam no rootfs-overlay.

O DTB e os patches de kernel entram por `patches/kernel/`; as opções de compilação, por `buildroot.panel.fragment`. A calibração do toque (matriz `uinput`/`evdev`) vive em `rootfs-overlay/usr/share/giochi-system/` e é específica da unidade — não pode ser compartilhada entre aparelhos.

Por isso **o Giochi System não tenta um driver genérico de painel**: cada device declara o próprio painel pelo fragmento e pelo DTB, e a base comum não ativa `CONFIG_DRM_PANEL_*` nenhum.

### O que fica fora do Giochi System

O Giochi System entrega o kernel com o painel funcionando em console/framebuffer. Camadas de UI, emuladores e a aplicação **Giochi app** rodam sobre essa base e não fazem parte do build do sistema — ver [Escopo](#escopo).

## Por que Buildroot?

- Gera kernel, rootfs e imagem de cartão de forma integrada.
- Cross-compila ARM64 a partir de runners x86_64.
- É determinístico quando a versão, defconfig e fragmentos são fixados.
- Não exige um fork do projeto para cada dispositivo.
- Funciona bem em CI, com cache de downloads.

## Escopo

O Giochi System é uma base limpa de sistema. Ele **não** implementa interface gráfica, emuladores, loja de aplicativos ou integração com Steam. Isso fica para as camadas específicas de cada dispositivo ou para um projeto derivado.

O **Giochi System** (`Giochi system`) produz apenas o sistema operacional pronto para cada aparelho. A interface, a loja e a experiência do usuário pertencem ao **Giochi app**, que é um projeto separado e consome as imagens geradas por aqui.
