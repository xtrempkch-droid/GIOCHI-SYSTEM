# R35S

Console portátil Rockchip **RK3326**, tela 640×480. Mesma base do R36S.

| Campo | Valor |
| --- | --- |
| SoC | Rockchip RK3326 (família PX30), 4× Cortex-A35 |
| GPU | Mali-G31 |
| RAM | 1 GB |
| NPU | **não tem** |
| Tela | 640×480 DSI 4 lanes — **vários modelos por lote** |
| Wi-Fi / Bluetooth | **não tem rádio** |
| Botões | `rocknix-singleadc-joypad` — **driver fora da árvore** |
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

Não há `gpio-keys`. Os 17 botões passam por **multiplexador de ADC**
(`rocknix-singleadc-joypad`, nome `r36s_Gamepad`). Sem esse driver compilado
contra o nosso kernel, **nenhum botão funciona**.

É o mesmo tipo de dependência que fez o NPU ser descartado — mas aqui não é
opcional: é a entrada inteira do console.

### 3. Não tem rádio

Nos DTBs do R33S/R35S/R36S **não existe nó de Wi-Fi**. Só `odroid-go2` e `rgb10`
têm. Se a loja depender de rede no aparelho, este modelo fica de fora — a loja
roda no PC, então dá para contornar por cartão, mas não por download direto.

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

## Estado

- `buttons.map` — **preenchido** com os códigos do DTB (17 botões). Confiança
  média-alta: veio do DTB que a unidade usa, mas não foi confirmado com `evtest`.
- Falta: defconfig, DTB, loader, genimage, overlay de painel, validação.

## Por que a USB não apareceu no PC

O `dwc2` desta placa é OTG com **`default = host`**: ligada ao PC, ela se comporta
como *host*, não como dispositivo. Por isso o Windows não viu nada — não é cabo
nem driver.

Para ter SSH ou ADB no PC, é preciso **forçar o papel de dispositivo** (o
`usb-role-switch` existe no DTB, então é configurável), ou usar Wi-Fi — que esta
placa não tem. Na prática: só com o cartão no leitor.
