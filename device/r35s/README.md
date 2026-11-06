# R35S

Console portátil Rockchip **RK3326**, tela 640×480. Mesma base do R36S.

| Campo | Valor |
| --- | --- |
| SoC | Rockchip RK3326 (família PX30), 4× Cortex-A35 |
| GPU | Mali-G31 |
| RAM | 1 GB |
| NPU | **não tem** |
| Tela | 640×480 DSI — **vários modelos por lote** (640×480 medido em `modes`) |
| Wi-Fi / Bluetooth | **não tem rádio** |
| Botões | `rocknix-singleadc-joypad` (`r36s_Gamepad`, `js0`+`event3`) — **driver fora da árvore**, GPL |
| Console serial | `ttyS2` @ **1500000** — medido no aparelho, ver abaixo |
| Status | `draft` — não inicializável |

## As três coisas que tornam esta placa diferente

### 1. Ela quebra a premissa do RK3566

É **outro SoC**. Nada do pipeline atual serve: muda o defconfig do U-Boot
(`odroid-go2`), o BL31 (`px30_bl31`, porque `rkbin` não tem `rk3326`), o blob de
DDR (`px30_ddr_333MHz`), o DTS e o painel. É um **segundo alvo de build**, não um
ajuste de configuração.

O loader do fabricante é o único que liga nesta placa — o U-Boot mainline testado
deu tela preta sem print no serial.

### 2. Os botões exigem driver fora da árvore

Não há `gpio-keys`. Os botões passam por **multiplexador de ADC**
(`rocknix-singleadc-joypad`, nome `r36s_Gamepad`, exposto como `js0` + `event3`).
Sem esse driver compilado contra o nosso kernel, **nenhum botão funciona**.

É o mesmo tipo de dependência que fez o NPU ser descartado — mas aqui não é
opcional: é a entrada inteira do console.

O que mudou em 06/11/2026: o driver **não é código fechado**. Medido no aparelho,
`modinfo` devolve `license: GPL`, `author: ROCKNIX`, e o módulo mora em
`/lib/modules/<versão>/rocknix-joypad/`. Ou seja, existe fonte para trazer para a
árvore — o que falta é compilar contra o nosso kernel 6.12 (§ *Medido no
aparelho*). O `.ko` que está no cartão não serve: foi compilado para o kernel
7.1.2 e o `vermagic` é diferente.

### 3. Não tem rádio

Nos DTBs do R33S/R35S/R36S **não existe nó de Wi-Fi**. Só `odroid-go2` e `rgb10`
têm. Se a loja depender de rede no aparelho, este modelo fica de fora — a loja
roda no PC, então dá para contornar por cartão, mas não por download direto.

## Console serial — a única saída de diagnóstico

Esta placa não tem rádio (§3) e o `dwc2` nasce como *host* (última seção), então
**o TTL é o único canal** para saber o que aconteceu num boot. Vale saber onde ele
está sem precisar procurar.

Não é chute: o DTB versionado em `dts/rk3326-gameconsole-r36s.dtb` declara o
console em `/chosen`:

```text
/chosen/stdout-path  = "serial2:1500000n8"
/aliases/serial2     = "/serial@ff160000"
/serial@ff160000      compatible = "rockchip,px30-uart", "snps,dw-apb-uart"
                      reg        = 0xff160000, 0x100
                      dmas       = tx 4 / rx 5,  reg-shift = 2
```

Conferir de novo é barato e não depende de hardware:

```bash
strings -a device/r35s/dts/rk3326-gameconsole-r36s.dtb | grep -E 'serial2:|stdout-path'
node scripts/dtb-inspect.mjs device/r35s/dts/rk3326-gameconsole-r36s.dtb --props | grep -A3 '^/chosen'
```

| Parâmetro | Valor | De onde veio |
| --- | --- | --- |
| UART | **UART2** (`serial2`) | `/chosen/stdout-path` no DTB |
| Endereço | **`0xff160000`** | `reg` de `/serial@ff160000` |
| Baud | **1500000**, 8N1 | `/chosen/stdout-path` |

`earlycon` correspondente, para quando houver `kernelCmdline` neste aparelho:

```text
console=ttyS2,1500000n8 earlycon=uart8250,mmio32,0xff160000
```

> **Cuidado ao diagnosticar linha "muda".** Medido em 04/11/2026 com o adaptador
> CH341: uma varredura de 12 bauds devolveu **só ruído, e só em 1500000** — o
> mesmo baud que o DTB declara. Ou seja, o baud estava certo e o que faltava era
> nível elétrico, não velocidade.
>
> A assinatura que distingue os dois casos:
>
> | O que chega | Significa |
> | --- | --- |
> | bytes **variados**, texto quebrado | baud errado — varrer de novo |
> | **um byte constante repetido** (`0xED`, `0xFF`, `0x00`) | nível elétrico: RX flutuando ou sem GND |
> | **zero bytes** | linha muda de verdade, ou TX/RX trocados |
>
> E **não** use `errors="replace"` para ler: 47 bytes crus viram `EF BF BD` e a
> evidência some. Ler sempre o `.bin` cru.
>
> Receita: [`docs/troubleshooting.md`](../../docs/troubleshooting.md) § *Console
> serial: linha muda, ruído, ou adaptador caindo*.

## O painel é uma loteria de lote — agora com os cinco medidos

O mesmo aparelho sai de fábrica com telas diferentes. Não há detecção automática
(painel DSI **não tem EDID**), e o U-Boot lê ADC para descobrir o **modelo da
placa**, não o painel.

O caminho que funciona continua sendo overlay `mipi-panelN.dtbo` na partição de
boot e trocar até ligar. O que mudou é que agora os cinco estão descritos em
texto, com números, em [`panels/`](panels/README.md):

```bash
node scripts/panel-inspect.mjs device/r35s/panels/*.txt
```

| Painel | `size` | refresh (calc.) | modos | comandos de init |
| --- | --- | --- | --- | --- |
| `r36s_clone` | 153×85 | 58,50 Hz | 12 | 24 |
| `r36s-panel1` | 52×70 | 68,54 Hz | 3 | 25 |
| `r36s-panel2` | 52×70 | 77,38 Hz | 3 | 187 |
| `r36s-panel3` | 52×70 | 77,38 Hz | 3 | 188 |
| `r36s-panel4` | 52×70 | **59,94 Hz** | 3 | 155 |

Todos 640×480, 4 lanes, `rgb888`. O **panel4** é a unidade de referência, e é o
único que declara o refresh pretendido em comentário (`# 60`, `# 50`, `# 75`) —
o que permitiu **validar a conta** `refresh = clock ÷ (htotal × vtotal)` contra a
intenção do autor: 59,94 / 50,02 / 75,03 Hz. Fecha nos três.

Dois avisos que saíram daí, e que ficam como aviso porque o dado não deixa
decidir:

- `r36s_clone` declara painel 16:9 (`size=153,85`) com todos os modos 4:3, e é o
  único **sem `#END`** — provavelmente descrição de outro clone, não desta placa;
- `panel1`/`panel2`/`panel3` a 29 MHz dão 68,5 e 77,4 Hz, não 60. Pode ser real
  ou clock escolhido para outro alvo; sem datasheet não se resolve.

O que isso **não** resolve: dizer qual painel está dentro de um aparelho sem
ligá-lo. Não existe consulta para isso em DSI.

## Áudio: cuidado, é diferente da X55

| Item | X55 | R35S/R36S |
| --- | --- | --- |
| Card | `rk817_ext` | `rk817_int` |
| Roteamento do falante | `Speaker Amp INL ← HPOL` (**HP**) | `Speaker → SPKO` |

A armadilha do "Playback Mux tem de ficar em HP" **é da X55**. Nesta placa o
caminho é SPKO. Não copiar a configuração de áudio de um para o outro.

Backlight: PWM1, período 25 µs, 256 níveis.

## Medido no aparelho — 06/11/2026, pela console serial

Depois da solda no TTL, a linha ficou limpa e o aparelho respondeu. Tudo abaixo
foi lido **do aparelho**, não deduzido. O firmware que estava no cartão é ROCKNIX
(kernel 7.1.2), não o nosso — é a única referência que existe desta placa.

### Identidade e linha de comando

```text
$ cat /proc/cmdline
boot=UUID=04BC-500B disk=UUID=23b59f64-e621-4896-b31d-684e2b69be0e quiet \
console=ttyS2,1500000 console=tty0 systemd.debug_shell=ttyS2 uboot.hwid_adc=a,r33s

$ cat /proc/device-tree/compatible
gameconsole,r35s gameconsole,r36s rockchip,rk3326

$ cat /proc/device-tree/model
Game Console R36S

$ uname -r
7.1.2
```

Três leituras que valem destacar:

| Observação | Consequência |
| --- | --- |
| `console=ttyS2,1500000` **e** `console=tty0` | o console vai para o serial **e** para a tela ao mesmo tempo — não é um ou outro |
| `systemd.debug_shell=ttyS2` | é isto que entrega o `#` de root no serial sem login. Numa imagem nossa, o equivalente é o `getty` do `/etc/inittab` |
| `quiet` | o boot log fica suprimido por padrão; só aparece o que é `printk` de erro. Foi por isso que a captura passiva rendeu **uma linha só** |

O `compatible` é **idêntico** ao do DTB versionado em `dts/` — está confirmado
que copiamos o device tree certo, e não um parecido.

> **`uboot.hwid_adc=a,r33s` — pendência, não conclusão.** O U-Boot lê um ADC para
> descobrir o modelo da placa, e nesta unidade ele reporta **`r33s`**, enquanto o
> `compatible` diz `r35s`/`r36s` e o `model` diz R36S. Não sei ainda se o valor
> `a` significa "r33s" na tabela do U-Boot ou se a tabela foi reaproveitada. Fica
> registrado como medido e **não resolvido** — é exatamente o tipo de coisa que
> escolhe overlay de painel errado se alguém adivinhar.

### Painel

```text
$ cat /sys/class/drm/card0-DSI-1/modes
640x480
640x480
640x480
$ ls /sys/class/drm/
card0  card0-DSI-1  version
```

640×480 confirmado, **só DSI** (não há HDMI nem conector fantasma). Três modos
listados com o mesmo tamanho são as três taxas de refresh do driver do painel,
não três resoluções.

### Entrada

```text
N: Name="rk805 pwrkey"            H: Handlers=kbd event0
N: Name="rk817_int Headphones"    H: Handlers=event1
N: Name="gpio-keys-vol"           H: Handlers=kbd event2
N: Name="r36s_Gamepad"            H: Handlers=js0 event3
```

O `rk817_int` confirma a seção de áudio abaixo. Os botões principais **não** são
`gpio-keys` — só o volume é. O gamepad é o driver fora da árvore:

```text
$ modinfo rocknix_singleadc_joypad
filename:    /lib/modules/7.1.2/rocknix-joypad/rocknix-singleadc-joypad.ko
license:     GPL
description: ROCKNIX singleadc joypad driver
author:      ROCKNIX
import_ns:   IIO_CONSUMER
import_ns:   PWM
```

Dois fatos que mudam o plano:

1. é **GPL** e identifica autor — o código existe e pode ser trazido para a nossa
   árvore, em vez de reescrito às cegas;
2. o `.ko` **não serve** para nós: foi compilado para o kernel **7.1.2** e o nosso
   é 6.12. `vermagic` diferente, módulo recusado. O caminho é o fonte, não o
   binário.

O `import_ns` de `PWM` explica o backlight compartilhar o mesmo driver de ADC.

### Armazenamento — o desenho que já funciona

```text
$ cat /proc/partitions
 179   0  121753600 mmcblk1
 179   1    2097152 mmcblk1p1
 179   2  119640064 mmcblk1p2
   7   0    1299456 loop0

$ df -h
/dev/mmcblk1p1   2.0G  1.3G  750.5M  63%  /flash
/dev/loop0       1.2G  1.2G       0 100%  /
/dev/mmcblk1p2  113.6G  613.4M 113.0G   1%  /storage
```

Isto é **artefato direto para a pendência da partição de dados** (AGENTS.md §18,
"piso de 4 GiB + o resto do cartão"): o ROCKNIX já faz exatamente isso, com um
detalhe a mais que resolve o problema do tamanho fixo.

| Partição | Tamanho | Papel |
| --- | --- | --- |
| `p1` | 2 GiB fixos, FAT | `/flash`: kernel, DTB, extlinux **e a imagem do rootfs** |
| `p2` | **o resto do cartão** (~114 GiB) | `/storage`: dados do usuário, quase vazio |
| `/` | `loop0` de 1,2 GiB | rootfs **imutável**, montado como `loop` de um arquivo dentro da `p1` |

O truque que faltava na nossa proposta: o rootfs não é uma partição, é um
**arquivo** dentro da FAT. Assim o "resto do cartão" pode ir inteiro para dados
sem que a imagem precise crescer, e a raiz fica somente-leitura — o que também
deixa o A/B trivial (é só ter dois arquivos e trocar qual o extlinux aponta).
Custo: escrever no rootfs exige remontar em `rw`, e o `loop` come RAM em cima de
um aparelho de 1 GB.

Não implementado aqui; é prior art medido, para decidir com número na mão.

### Resto

```text
$ free -m
              total   used   free   shared  buff/cache  available
Mem:            981    287    254       10         521        694
```

981 MiB visíveis de 1 GB — o resto do firmware reserva para o Mali/ramo do
TrustZone. `lsblk` **não existe** nessa imagem; `/proc/partitions` e `df` sim.

## Port para o nosso kernel 6.12 — o que já compila

Extraído do aparelho e montado em 06/11/2026. **Não é estimativa: cada item abaixo
foi compilado contra a árvore 6.12 deste repositório.**

| Peça | Resultado | Evidência |
| --- | --- | --- |
| DTS do R36S (`dts/src/`) | **compila** contra o 6.12 | `rk3326-gameconsole-r36s.dtb`, 49 983 B |
| DTS com painel próprio | **compila**, 160 strings no `panel_description` | `rk3326-gameconsole-r36s-giochi.dtb`, 54 469 B |
| `rocknix-singleadc-joypad` | **compila** (`DEVICE=RK3326`) | `rocknix-singleadc-joypad.ko`, 136 904 B |
| `rocknix-joypad` | **compila** | `rocknix-joypad.ko`, 92 856 B |
| `panel-generic-dsi` | **compila** | `panel-generic-dsi.ko`, 106 144 B |

O que isso resolve: o README dizia "os botões exigem driver fora da árvore" como
se fosse bloqueio. Não é — o fonte é **GPL**, está vendorizado em
[`kernel-modules/`](kernel-modules/) e **compila no 6.12 sem uma linha de
adaptação**. Não houve quebra de API de PWM nem de `drm_panel`.

### Dois detalhes que quase passaram

**1. O `Makefile` do joypad esconde o módulo errado.** Ele faz:

```make
ifeq ($(DEVICE),$(filter $(DEVICE), S922X RK3588))
  obj-m := rocknix-joypad.o
```

Com `DEVICE` **vazio**, `$(filter ,...)` também é vazio, e `empty == empty` é
**verdadeiro** — então a receita da ROCKNIX, que chama `make` sem `DEVICE`,
compila só o `rocknix-joypad.o` e nunca toca no `singleadc`. Passa verde. Por isso
o build nosso passa `DEVICE=RK3326` explicitamente.

**2. `joypad_input_g` nunca é definido.** O `singleadc` declara `extern` e só
atribui; nenhum dos dois arquivos define. Compilando os dois módulos como a
receita pede, o `modpost` falha:

```text
ERROR: modpost: "joypad_input_g" [rocknix-singleadc-joypad.ko] undefined!
```

A correção é de uma linha e está no próprio fonte vendorizado, com o motivo
escrito ao lado: o símbolo é só escrito e nunca lido, então defini-lo não muda
comportamento.

### O painel: do overlay para o DTS

O ROCKNIX aplica o painel por `.dtbo` em `FDTOVERLAYS` no extlinux. Nós **não
precisamos de overlay**: o nó `panel@0` já existe no DTS base, então o gerador
[`scripts/panel-to-dtsi.mjs`](../../scripts/panel-to-dtsi.mjs) escreve a
propriedade direto num `.dtsi` incluído pelo DTS. Uma peça móvel menos no boot.

O formato importa: o driver lê com `of_property_read_string_index`, ou seja,
**lista de strings** — 160 elementos (1 `G` + 3 `M` + 155 `I` + `#END`). Uma
string única com quebras de linha dentro seria **um** elemento, e o driver leria
lixo.

```bash
node scripts/panel-to-dtsi.mjs device/r35s/panels/r36s-panel4.txt \
  --out device/r35s/dts/generated/panel-panel4.dtsi \
  --wrapper device/r35s/dts/generated/rk3326-gameconsole-r36s-giochi.dts \
  --base device/r35s/dts/src/rk3326-gameconsole-r36s.dts
```

### O carregador de boot: por que a imagem pode ser gerada

**Correção de uma afirmação errada deste README.** Eu havia escrito que a imagem
"não podia ser gerada" por falta de loader. Estava errado, e a verificação é
trivial — eu não tinha feito:

| Peça | Existe? | Onde |
| --- | --- | --- |
| DDR init do PX30 | **sim** | `rkbin: bin/rk33/px30_ddr_333MHz_v2.08.bin` |
| BL31 do PX30 | **sim** | `rkbin: bin/rk33/px30_bl31_v1.33.elf` |
| U-Boot para RK3326 | **sim** | `u-boot: configs/odroid-go2_defconfig` |

O `odroid-go2_defconfig` tem `CONFIG_ROCKCHIP_PX30=y`, `CONFIG_TPL_RAM=y` e
`CONFIG_ROCKCHIP_SDRAM_COMMON=y` — a pilha TPL/SPL completa. E o mais conveniente:
`CONFIG_DEBUG_UART_BASE=0xFF160000`, que é **exatamente a UART do R35S**. O
console de debug do U-Boot aparece sem ajuste nenhum.

Os offsets do `make-sd-image.sh` também servem: o BootROM do RK3326 e o do RK3566
leem o idbloader no **setor 64** e o U-Boot em **16384**.

**O que continua não provado:** que essa combinação boota. O antecessor testou
U-Boot mainline nesta placa e obteve tela preta sem print no serial. Isso não quer
dizer que o mainline não funciona — quer dizer que *aquela* configuração não
funcionou, e o motivo nunca foi isolado.

**Plano de boot, na ordem em que os sintomas separam as causas:**

| O que acontece | Leitura |
| --- | --- |
| Serial mostra U-Boot | o loader funciona; qualquer problema adiante é kernel/rootfs |
| Serial **mudo**, tela preta | o TPL/DDR não subiu — é o caso do antecessor |
| Serial fala, mas para no kernel | DTB ou rootfs; aí o `earlycon` entra |

Se o TPL não subir, o próximo passo é extrair os primeiros setores do cartão que
**já boota** neste aparelho (`dd` dos primeiros ~16 MiB) e usar o loader do
fabricante. Ver [`extracted/README.md`](extracted/README.md) para o layout.

### Dois caminhos de DTS, e por que ficou o patch

`BR2_LINUX_KERNEL_CUSTOM_DTS_PATH` parecia o certo: copia DTS sem manter patch.
**Não serve para esta placa**, e a razão está no fonte do Buildroot
(`linux/linux.mk`, linha 504): ele copia os arquivos para
`arch/arm64/boot/dts/` — a **raiz** — e só gera `.dtb` para `.dts` listados ali.

O problema: o Makefile da raiz usa `subdir-y += rockchip`, e o DTS do aparelho
faz `#include "rk3326-gameconsole-r3xs.dtsi"`, que vive em `rockchip/`. Tentar
compilar deu:

```text
arm64/boot/dts/arm64/boot/dts/rk3326-gameconsole-r36s-giochi.dtb  — sem regra
```

Então o caminho é o **patch** `patches/0001-giochi-system-r35s-dts-e-painel.patch`
(988 linhas), que põe os arquivos em `rockchip/` e acrescenta uma linha no
Makefile. Verificado do zero: `patch -p1` limpo e `.dtb` de 54 469 B gerado.

O campo `dtsPaths` do `device.json` continua existindo e testado — só não é o
caminho deste aparelho.

## Estado

**Confirmado no aparelho (06/11/2026):**

- **DTB** — o `compatible` da unidade em execução é idêntico ao do arquivo em
  `dts/`. Não é mais "provável", é o mesmo device tree.
- **Console** — `ttyS2` a 1500000, agora declarado em `device.json`
  (`kernelCmdline`), não só no README. A string composta é
  `console=ttyS2,1500000n8`, que é a mesma do aparelho com o `n8` explícito.
- **Painel** — 640×480 em `card0-DSI-1`, medido em `modes`.
- **Gamepad** — driver `rocknix_singleadc_joypad`, GPL, com o código existindo
  (`/lib/modules/7.1.2/rocknix-joypad/`). É a peça que parecia impossível e agora
  tem procedência.

**Feito depois, no mesmo dia (ver "Port para o nosso kernel 6.12"):**

- ~~Trazer o joypad para a árvore~~ — **feito**: GPL vendorizado, **compila no
  6.12**.
- ~~Driver do painel~~ — **feito**: `panel-generic-dsi` vendorizado, compila.
- ~~Overlay de painel~~ — **não é mais overlay**: o `panel_description` do
  `panel4` vai num `.dtsi` gerado, incluído pelo DTS.
- ~~DTS~~ — **compila** contra o 6.12.

**Continua faltando:**

- **O boot em hardware** — a imagem é gerável (U-Boot mainline `odroid-go2` +
  rkbin PX30), mas **não bootou ainda**. O antecessor teve tela preta com serial
  mudo no mainline, e a causa nunca foi isolada.
- **`genimage`** dentro do Buildroot, substituindo `make-sd-image.sh` como etapa
  externa (pendência do projeto inteiro, não só desta placa).
- **Os cinco painéis** — o `panel4` é a referência; uma unidade com `panel1`/
  `panel2`/`panel3` precisa de outro `.dtsi` gerado (é um comando).

**Riscos medidos, ainda não resolvidos:**

- o `uboot.hwid_adc` desta unidade reporta `r33s`, divergindo do `compatible`
  (`r35s`/`r36s`). Se algum dia usarmos esse ADC para escolher painel, essa
  divergência precisa estar entendida antes — senão é overlay errado em silêncio.

## Por que a USB não apareceu no PC

O `dwc2` desta placa é OTG com **`default = host`**: ligada ao PC, ela se comporta
como *host*, não como dispositivo. Por isso o Windows não viu nada — não é cabo
nem driver.

Para ter SSH ou ADB no PC, é preciso **forçar o papel de dispositivo** (o
`usb-role-switch` existe no DTB, então é configurável), ou usar Wi-Fi — que esta
placa não tem. Na prática: só com o cartão no leitor.
