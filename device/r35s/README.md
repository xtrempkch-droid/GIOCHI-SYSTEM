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

## O painel é uma loteria de lote

O mesmo aparelho sai de fábrica com telas diferentes. Não há detecção automática
(painel DSI não tem EDID), e o U-Boot da ROCKNIX lê ADC para descobrir o **modelo
da placa**, não o painel.

O caminho que funciona: overlay `mipi-panelN.dtbo` na partição de boot.
A unidade de referência é **panel4** (52×70 mm, 29 MHz). Se a tela ficar preta, é
o overlay — trocar até ligar, não mexer no resto.

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

**Continua faltando:**

- **defconfig** — nenhum. O loader desta placa é o do fabricante
  (`px30_bl31`, DDR `px30_ddr_333MHz`, U-Boot `odroid-go2`); o mainline testado
  deu tela preta. Nada disso foi reproduzido por nós.
- **Trazer o joypad para a árvore** — o fonte é GPL e existe, mas ainda não foi
  compilado contra o nosso kernel 6.12. Sem ele, **nenhum botão funciona**.
- **Overlay de painel** — a loteria de lote continua: esta unidade aceita
  `panel4`, a próxima pode não aceitar.
- **genimage** e validação de build.

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
