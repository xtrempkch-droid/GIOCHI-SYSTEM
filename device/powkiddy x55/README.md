# Powkiddy X55

Handheld Rockchip **RK3566** (4× Cortex-A55, Mali-G52, 2 GB de RAM) com painel
MIPI-DSI **720×1280**. É o único aparelho do projeto que já bootou em hardware
real — no antecessor `GIOCHI-KONSOL-OS`. Este diretório traz aquele
conhecimento para cá.

Status: **draft** — mas **boota em hardware real** com tela 720x1280, áudio,
Wi-Fi, console, **17 botões de gamepad e 4 eixos analógicos**. Relatório medido
em [`docs/x55-bringup.md`](../../docs/x55-bringup.md). Continua draft porque falta
firmware de Bluetooth e a interface de jogos (que é do `Giochi app`).

## De onde veio cada coisa

| Fonte | O que foi aproveitado |
| --- | --- |
| `GIOCHI-KONSOL-OS/buildroot/configs/giochi_x55_defconfig` | a base do `defconfig` deste diretório |
| `GIOCHI-KONSOL-OS/device/x55/device.conf` | SoC, DTB, painel, rotação, rádio, U-Boot, versões |
| `GIOCHI-KONSOL-OS/docs/hardware-e-drivers.md` | arquitetura de hardware, armadilhas medidas, receitas F1–F12 |
| DTS mainline | `buttons.map`: o mapa evdev dos 17 botões |

Regra que continua valendo: é **antecessor, não verdade atual**. Nada aqui foi
copiado sem conferência, e o que não foi verificado está marcado como tal.

## Hardware que importa

| Bloco | Detalhe |
| --- | --- |
| Painel | Himax **HX8394**, `powkiddy,x55-panel`, 720×1280@~60 Hz, `rotation = <270>` |
| Backlight | PWM no `pwm4`, período 25000 ns |
| Entrada | **17 botões + 4 eixos** pelo driver fora da árvore `rocknix-joypad`; volume por `gpio-keys` |
| Áudio | codec **RK817** em `i2s1_8ch`, placa `rk817_ext` |
| Wi-Fi | **RTL8821CS** por SDIO (`rtw88_8821cs`) |
| Bluetooth | o mesmo chip por UART (`hci_h5`, tratado como 3 fios) |
| USB | `dwc3` OTG, gadget `g_ether` → `usb0` **10.55.0.2/24** (sem DHCP) |
| Console | **`ttyS2` @ 1500000n8** |

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `defconfig` | base Buildroot (kernel 6.12, U-Boot 2024.10, rkbin, DTS, gráficos, firmware) |
| `buildroot.fragment` | deltas deste repositório (tamanho do rootfs, e o que ficou fora) |
| `linux.fragment` | símbolos `CONFIG_*` do kernel — painel, áudio, entrada, rádio |
| `busybox.fragment` | desliga o applet `tc` do busybox, que não compila contra os headers do 6.12 |
| `buttons.map` | nome lógico → código evdev (vira `/etc/giochi/buttons.map`) |
| `rootfs-overlay/` | `motd`, `device-id` e `etc/init.d/S15modules` (autoload de `rtw88_8821cs`/`hci_uart`) |

## Três armadilhas que já custaram imagem quebrada

1. **PHY DSI tem de ser `=y`, nunca `=m`.** Como módulo ele carrega depois do
   controlador, o painel recebe `-517` (EPROBE_DEFER) e desiste: sem
   `/dev/dri/card0`, tela preta, nenhuma mensagem ligando sintoma à causa.
2. **`Playback Mux` do RK817 tem de ficar em `HP`.** O amplificador do falante é
   alimentado por `HPOL`/`HPOR`; em `SPK` o aparelho fica **mudo** (o `SPK DAC` é
   o class-D interno do RK817 e não está roteado nesta placa).
3. **O `tc` do busybox não compila contra os headers do 6.12.** `TCA_CBQ_*` e
   `struct tc_cbq_lssopt` foram removidos junto com o qdisc CBQ, e o erro sai
   como uma parede de "undeclared identifier" em `networking/tc.c` que não cita
   kernel nem headers. Medido no primeiro build real deste aparelho: parou o
   rootfs inteiro. Corrigido em `busybox.fragment` (`# CONFIG_TC is not set`);
   o `tc` do iproute2, que está na imagem, cobre o uso.
4. **O `olddefconfig` descarta filho de pai unset em silêncio.** Sem
   `CONFIG_SND_SOC_ROCKCHIP`, o `I2S` some e o `simple-audio-card` fica em
   deferred probe para sempre. É exatamente o que o `assert-config` existe para
   pegar.

## O que falta para o aparelho sair do console

Nenhum item é configuração de símbolo — são código e layout:

1. ~~**`rocknix-joypad`**~~ — **desnecessário para a X55.** Medido no aparelho: o
   DTS mainline já declara 16 botões em `gpio-keys-control` (com os mesmos
   códigos `BTN_*` do mapa deste diretório), e o `adc-joystick` cobre os 4 eixos
   com `CONFIG_JOYSTICK_ADC=y`. O 17º botão (`BTN_MODE`, `gpio3 PB7`) entra pelo
   patch `patches/0002-giochi-system-x55-btn-mode.patch`. O driver fora da árvore
   só seria necessário para algo que o DTS não declare.
2. **Patches de DTS** (receitas F2/F3/F4 da doc de hardware):
   - `&hdmi { status = "disabled" }` e `&hdmi_sound { status = "disabled" }`;
   - `&sdmmc1 { no-mmc; no-sd; sd-uhs-sdr50; }` — sem isso o probe do Wi-Fi falha
     com `-110`;
   - `&uart1 { dma-names = "tx", "rx" }` — sem isso o Bluetooth não sobe.
3. **`&rng { status = "okay" }`**: o TRNG do RK3566 fica desligado no
   `rk356x.dtsi` (quem liga é o `rk3568.dtsi`). Sem entropia o `crng` inicializa
   tarde e o `getrandom()` bloqueia — medido em 11 s num boot e **1024 s** em
   outro.
4. **`rtl8821cs_config.bin`** — **RESOLVIDO**, gerado por
   `scripts/gen-rtl8821cs-config.mjs` (25 bytes, offset `0x0c`, baud 115200).
   O driver aceita: `cfg_sz 25, total sz 34941`.
   **Falta `rtl8821cs_fw.bin`** (firmware de UART): o `rtl8821c_fw.bin` é do
   variante USB e o download falha em `-110`; o binário correto vem no pacote do
   fabricante. Sem ele, `hci0` não é criado — e isso é intencional: um `hci0`
   que aparece e não funciona engana o diagnóstico.
5. **`genimage`**: hoje o build entrega `Image`, `rootfs.ext4`, `idbloader.img` e
   `u-boot.itb` soltos. A imagem de cartão precisa do layout: p1 FAT 128 MB com
   `Image` + `dtbs/` + `extlinux.conf` (`FDT /dtbs/rk3566-powkiddy-x55.dtb`),
   p2 rootfs ext4, `idbloader.img` no setor 64.
6. **`giochi-init` no `/etc/inittab`** — hoje o script está na imagem e ninguém
   o chama. Ver `docs/giochi-init.md`.

## Como tentar o build

O aparelho está `enabled: false`, então o CI não o constrói. Para tentar:

```bash
# local, em Linux/WSL2 com caminho sem espaços
ALLOW_DRAFT=1 bash scripts/build-device.sh powkiddy-x55

# sem instalar nada no host (imagem giochi-builder)
ALLOW_DRAFT=1 bash scripts/build-in-container.sh powkiddy-x55

# retomar de onde parou, sem apagar work/
GIOCHI_SYSTEM_KEEP_WORK=1 ALLOW_DRAFT=1 bash scripts/build-in-container.sh powkiddy-x55

# no CI
Actions → Build Giochi System ARM64 → Run workflow
  device: powkiddy-x55
  allow_draft: true
```

O primeiro build é o que valida o `defconfig`: se algum símbolo não existir no
Buildroot 2024.02, o `assert-config` falha com o nome na mão — e é assim que
deve ser. Nenhuma linha deste diretório foi compilada ainda.

## Depois de gravar, no aparelho

```sh
giochi-selftest        # do DTB ao render: DSI, backlight, entrada, ALSA, rádio
cat /proc/device-tree/model          # "Powkiddy x55"
cat /sys/class/drm/card0-DSI-1/modes # 720x1280
dmesg | grep -i joypad               # axes: 4, buttons: 17
amixer -c 0 sget "Playback Mux"      # Item0: 'HP'
```

Se a tela ficar preta com backlight aceso, o suspeito nº 1 é DTB errado — a X55
com o DTB da X35S usa o driver de painel errado. Foi essa regressão que originou
toda a documentação de hardware do antecessor.
