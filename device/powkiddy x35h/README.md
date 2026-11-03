# Powkiddy X35H

Console portátil **Rockchip RK3566** com painel de **640×480**. Variante de
painel menor da X55, e irmão do X35S — os dois compartilham o mesmo hardware de
tela e o mesmo DTS.

| Campo | Valor |
| --- | --- |
| SoC | Rockchip RK3566 (4× Cortex-A55, Mali-G52) |
| Arch | `arm64` |
| Painel | **Sitronix ST7703**, 640×480, 4 lanes, rotação 0 |
| Bateria | 3000 mAh (`charge-full-design-microamp-hours`) |
| Entrada | 16 botões por `gpio-keys` + 4 eixos por `adc-joystick` |
| Rádio | **nenhum** — sem Wi-Fi, sem Bluetooth |
| Console | `ttyS2` @ 1500000 (pads; **não há TTL exposto**) |
| U-Boot | mainline 2024.10, `anbernic-rgxx3-rk3566` |
| Status | `draft` — **não testado em hardware** |

## Por que ele é derivado da X55

Porque é o único aparelho desta árvore que **boota de verdade**. O RK3566, o
layout de `gpio-keys`, o `adc-joystick`, o RK817 de áudio e até o `&rng` são os
mesmos. Divergir do que funciona só cria diferença sem motivo, e diferença sem
motivo é onde os bugs moram.

O que muda é pouco e foi medido:

| Item | X55 | X35H | Como foi sabido |
| --- | --- | --- | --- |
| Painel | Himax HX8394 720×1280, rotação 270 | Sitronix ST7703 640×480, rotação 0 | `device.conf` do antecessor (`GIOCHI_PANEL=640x480`, `GIOCHI_ROTATION=0`) + sequência de init do patch 0016 da ROCKNIX |
| Bateria | 4000 mAh | 3000 mAh | patch 0016 da ROCKNIX |
| Rádio | RTL8821CS (Wi-Fi + BT) | ausente | `GIOCHI_WIFI=none`, `GIOCHI_BT=none` no antecessor |

## O painel é ST7703, e isso foi deduzido — não adivinhado

A ROCKNIX usa o driver **fora da árvore** `rocknix,generic-dsi`, o que faz
parecer que o painel não tem driver mainline. Não é o caso: a sequência de
inicialização que o DTS do X35S publica usa **só** comandos que o
`panel-sitronix-st7703.c` do 6.12 já implementa:

```text
B9 B1 B2 B3 B4 B5 B6 B8 BA BC BF C0 C1 C6 C7 C8 CC E0 E3 E9 EA EF
```

Todos existem como `ST7703_CMD_*` no driver mainline, e o conjunto é o mesmo que
os outros Powkiddy RK3566 (`rgb10max3`, `rgb30`) usam por esse driver. Daí o
patch `0002`: um `compatible` novo (`powkiddy,x35h-panel`) com a sequência
transcrita e as temporizações medidas (30 MHz, 640×480, 58,5 Hz).

**O que isso ainda não prova:** que o painel acenda. A sequência é a mesma, mas
tela é a parte que só o hardware confirma.

## Os dois patches

| Patch | O que faz |
| --- | --- |
| `0001-...-x35h-dts.patch` | Cria `rk3566-powkiddy-x35h.dts`, que **inclui** o da X55 e troca `model`, `compatible`, bateria e painel. Registra o DTB no `Makefile` do `rockchip`. |
| `0002-...-panel-st7703.patch` | Acrescenta o painel `powkiddy,x35h-panel` ao driver mainline: modo 640×480 e sequência de init. |

Nenhum dos dois usa `rocknix-joypad` nem `rocknix,generic-dsi`. Ambos foram
verificados aplicando sobre o kernel **original do tarball**, sem fuzz e sem
rejeitos.

## Sem console: como este aparelho se diagnostica

Não há TTL, não há Wi-Fi, não há Bluetooth. O único canal é a tela — e se a tela
for justamente o que está quebrado, não sobra nada.

Por isso o `rootfs-overlay` deste aparelho traz o marcador
`/etc/giochi/boot-log`, que liga o `S96bootlog` (comum). Ele monta a **partição
FAT** do cartão, grava `giochi-boot.log` e desmonta. Procedimento:

```text
1. liga o aparelho, espera ~40 s
2. desliga, tira o cartão, põe no PC
3. abre a partição GIOCHI_BOOT → giochi-boot.log
```

O log traz cmdline, `dmesg` completo, `/proc/bus/input/devices`, estado do DRM
(`/sys/class/drm/*/status`, `*/modes`), backlight, rede, partições e a saída do
`giochi-selftest`. É a diferença entre "não ligou" e "morreu no probe do painel
com `-517`".

Em aparelho com console (X55) o marcador não existe e o script sai na primeira
linha.

## O que NÃO foi confirmado

Tudo abaixo exige o aparelho na mão:

1. **A tela acende** com o driver ST7703. Se não acender, o próximo passo é
   comparar o `dmesg` do log com a sequência do patch.
2. **A/B** na posição física esperada. A ROCKNIX troca os códigos de A e B no
   DTS do X35S, o que sugere plástico diferente do da X55.
3. **Inversão dos eixos** do analógico. A ROCKNIX usa `invert-absx`/`invert-absy`
   no driver fora da árvore; aqui a inversão viria da faixa do `adc-joystick`, e
   a herdada da X55 pode não servir.
4. **Baud da UART** (1500000 herdado). Não importa sem TTL, mas é o valor a
   tentar quando houver um.
5. **U-Boot** `anbernic-rgxx3-rk3566`: o mainline não tem defconfig para X35S/
   X35H. É o mesmo RK3566 de referência que o antecessor mediu como bootável
   nesta família — plausível, não provado neste aparelho.

## Como gerar a imagem

```bash
ALLOW_DRAFT=1 bash scripts/build-in-container.sh powkiddy-x35h
bash scripts/build-in-container.sh --sd-image powkiddy-x35h
```

Gravar (cartão de ~30 GiB, como na X55):

```bash
docker run --rm --privileged --user 0:0 -v /dev:/dev -v "$PWD:/work" -w /work \
  --entrypoint bash giochi-builder:2 -c \
  'bash scripts/flash-sd.sh out/powkiddy-x35h/giochi-system-powkiddy-x35h-sd.img /dev/sdX --expect-gib 30'
```

Login: `root` / `giochi-dev` (ou `ROOT_PASSWORD` no build).
