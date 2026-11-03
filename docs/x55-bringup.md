# Powkiddy X55 — registro do primeiro boot

> Documento de **evidência**, não de intenção. Tudo aqui foi medido no aparelho
> físico em 03/11/2026. Onde não foi medido, está escrito que não foi.

## Resultado

O aparelho boota o Giochi System a partir do cartão SD, com login na console
serial:

```text
Giochi System 6.12.0 (/dev/console)
giochi-system-x55 login:
```

`uname -a` dentro do aparelho:

```text
Linux giochi-system-x55 6.12.0 #2 SMP PREEMPT Tue Nov  3 06:31:13 UTC 2026 aarch64 GNU/Linux
```

**Estado do aparelho:** `status: draft` continua correto. O sistema boota, mas
ainda faltam botões, Wi-Fi, Bluetooth e áudio (lista no fim).

## Cadeia de boot observada

```text
BootROM
  └── setor 64     idbloader.img        assinatura RKNS
      └── setor 16384  u-boot.itb       FIT d0 0d fe ed
          └── U-Boot 2024.10            "Model: Powkiddy x55", "DRAM: 2 GiB", "PMIC: RK817"
              └── boot.scr em mmc 1:1   carrega Image + DTB, booti
                  └── Linux 6.12.0      console=ttyS2,1500000n8
                      └── rootfs ext4   PARTUUID=47494f43-02
                          └── login     giochi-system-x55
```

O `bootcmd` gravado no U-Boot do aparelho é:

```text
bootcmd=for d in 1 0; do if load mmc ${d}:1 ${scriptaddr} boot.scr; then setenv giochi_mmc ${d}; source ${scriptaddr}; fi; done; echo GIOCHI: nenhum boot.scr legivel (mmc 1 e 0)
```

Por isso a imagem grava **`boot.scr` além do `extlinux.conf`**: sem o script o
U-Boot para no prompt, mesmo com `extlinux.conf` presente e correto. Os dois
convivem — `extlinux.conf` serve ao U-Boot mainline com distro boot.

## Layout de cartão medido

| Offset | Conteúdo | Verificação |
| --- | --- | --- |
| setor 0 | MBR, id de disco `0x47494f43` ("GIOCHI") | `part list mmc 1` |
| setor 64 (32 KiB) | `idbloader.img` (TPL + SPL, `RKNS`) | `md.b` no U-Boot |
| setor 16384 (8 MiB) | `u-boot.itb` (FIT) | `md.b` no U-Boot |
| 64 MiB | p1 FAT32 `GIOCHI_BOOT`, 256 MiB | `fatls mmc 1:1` |
| 320 MiB | p2 ext4 `GIOCHI`, resto do cartão | `mount` |

`part list mmc 1` no aparelho, com a imagem instalada:

```text
Part	Start Sector	Num Sectors	UUID		Type
  1	131072    	524288    	47494f43-01	0c Boot
  2	655360    	3538944   	47494f43-02	83
```

O PARTUUID **não é aleatório**: `make-sd-image.sh` fixa `label-id: 0x47494f43`
no `sfdisk`, então `47494f43-02` é determinístico entre builds e não depende de
`blkid` nem de udev.

### Linha de comando do kernel

```text
root=PARTUUID=47494f43-02 rootwait rw rootfstype=ext4 \
console=ttyS2,1500000n8 earlycon=uart8250,mmio32,0xfe660000 fbcon=rotate:3
```

Cada parâmetro tem motivo medido:

| Parâmetro | Por quê |
| --- | --- |
| `console=ttyS2,1500000n8` | a UART do console é ttyS2 a **1500000**, não 115200 |
| `earlycon=uart8250,mmio32,0xfe660000` | saída desde o começo; sem ela, falha antes do console é silêncio total |
| `fbcon=rotate:3` | o painel é montado a 270°; sem isso o console aparece deitado |
| `rootwait` | cartão SD enumera depois do rootfs |

## Diagnóstico do aparelho (`giochi-selftest`)

Evolução medida, mesma máquina, com as correções entrando uma a uma:

| Build | Resultado | O que mudou |
| --- | --- | --- |
| primeira imagem que bootou | `PASS 15 · WARN 5 · FAIL 1 · SKIP 2` | sem patch de DTS, amplificador `=m` |
| com `patches/0001-…-dts.patch` e amplificador `=y` | `PASS 17 · WARN 4 · FAIL 0 · SKIP 2` | `hwrng` e placa de som aparecem |
| com `S15modules` (autoload dos módulos) | `PASS 18 · WARN 3 · FAIL 0 · SKIP 2` | `wlan0` sobe no boot |
| com `CONFIG_JOYSTICK_ADC` + patch 0002 (BTN_MODE) | `PASS 20 · WARN 3 · FAIL 0 · SKIP 2` | 4 eixos e 17º botão aparecem |
| `Playback Mux` via `alsactl` | **`PASS 21 · WARN 3 · FAIL 0 · SKIP 1`** | áudio conferido de verdade |
| firmware oficial do RTL8821CS + `AutoEnable` | **`PASS 21 · WARN 3 · FAIL 0 · SKIP 1`** | **Bluetooth funcionando e ligado no boot** |

O boot também caiu de **11,7 s para 2,1 s** até o `sshd` subir: com o `&rng
okay`, o `crng` está pronto quando o userspace começa, e nada espera entropia.

### Passou

- `device tree: Powkiddy x55`
- rootfs em `/dev/root`, cartão `mmcblk1 29.7G`
- `/dev/dri/card0` + render node, driver `rockchip-drm`
- **conector `card0-DSI-1: connected 720x1280`** — o painel HX8394 sobe
- backlight `833/1666`
- 3 dispositivos de entrada (`rk805 pwrkey`, `gpio-keys-control`, `gpio-keys-vol`)
- `/etc/giochi/buttons.map` com 31 entradas
- UDC `fcc00000.usb`
- bateria e temperatura (`36C`)

Ou seja: **tela, backlight, armazenamento, console, volume e energia
funcionam**. Era o que faltava para o aparelho sair do console.

### Falhou (antes das correções)

| Item | Causa medida | Correção aplicada |
| --- | --- | --- |
| áudio | `--- no soundcards ---`; o card `rk817_ext` declara `aux-devs = <&spk_amp>` e o amplificador estava `CONFIG_SND_SOC_SIMPLE_AMPLIFIER=m`, que não carrega (sem autoload por modalias) | `=y` no `linux.fragment` — hoje `[PASS] placas de som: 0 [rk817ext]` |
| entropia | `rng@fe388000` nasce `disabled` no `rk356x.dtsi`; o RK3566 não herda o `okay` do `rk3568.dtsi` | `&rng { status = "okay" }` no patch de DTS — hoje `[PASS] hwrng: rockchip-rng` |
| rede | módulos `=m` sem autoload: o rootfs do Buildroot **não tem** `/etc/modules` nem `modules-load` | `rootfs-overlay/etc/init.d/S15modules` — hoje `[PASS] interfaces: wlan0` |

### Wi-Fi validado

Depois do `S15modules`, `rtw88_8821cs` carrega no boot, baixa o firmware
(`Firmware version 24.11.0`) e cria `wlan0` com MAC real. O SDIO sobe em
**SDR50** (`mmc3: new ultra high speed SDR50 SDIO card`) — no antecessor era só
High Speed, o `sd-uhs-sdr50` do patch de DTS fez diferença.

`iw dev wlan0 scan` no aparelho devolveu redes reais:

```text
SSID: Kill.exe
	signal: -24.00 dBm
```

Ou seja: **o rádio funciona**. O `rtl8821cs_config.bin` de 25 bytes continua
pendente para estabilidade (aparecem `sdio read32 failed (0xf0): -110` durante o
probe), mas o caminho ponta a ponta está provado.

### Bluetooth: funcionando — o arquivo existe, o Buildroot é que o omite

Correção de uma conclusão errada registrada antes neste documento. O
`rtl8821cs_fw.bin` **existe** e é oficial: está no `linux-firmware`, o
repositório de firmware do próprio kernel. Conferido no tarball que este build
usa:

```text
linux-firmware-20240115/rtl_bt/rtl8821cs_fw.bin       56648 bytes
linux-firmware-20240115/rtl_bt/rtl8821cs_config.bin      25 bytes
```

O problema é a **lista do Buildroot**: `BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT`
em `package/linux-firmware/linux-firmware.mk` instala `rtl8821a_*` e
`rtl8821c_*` e **esquece `rtl8821cs_*`**, na mesma versão do pacote. O sintoma é
fiel ao padrão deste repositório: build verde, imagem que boota, e Bluetooth que
"não funciona" sem uma linha de erro — o arquivo simplesmente não está lá.

Correção em `config/package-overrides.mk`:

```make
LINUX_FIRMWARE_FILES += rtl_bt/rtl8821cs_fw.bin rtl_bt/rtl8821cs_config.bin
```

`LINUX_FIRMWARE_FILES` é montada com `+=`, e o arquivo de override é incluído
antes das receitas, então o acréscimo soma à lista. Prova:

```text
$ make -p -n | grep '^LINUX_FIRMWARE_FILES'
… rtl8821cs_fw.bin rtl8821cs_config.bin …
```

Resultado no aparelho:

```text
hci0: RTL: cfg_sz 25, total sz 36953
hci0: RTL: fw version 0x75b8f098          ← firmware carregado
Controller A8:4F:A4:C9:98:4C (public)
	Manufacturer: 0x005d (93)     ← Realtek
```

E o scan encontra dispositivos de verdade — com o host anunciando como
`charles-X99-V9S`, o aparelho viu:

```text
[NEW] Device AC:ED:5C:28:73:C2 charles-X99-V9S
[NEW] Device 59:5D:A8:D3:A7:2D 59-5D-A8-D3-A7-2D
```

### O config oficial não é o que estava sendo gerado à mão

Vale registrar a diferença, porque ela decide se o rádio funciona:

| Campo | Config oficial (linux-firmware) | O que se gerava à mão |
| --- | --- | --- |
| baudrate (`data[0..3]`) | `0x04928002` → **1500000** | `0x0252c014` → 115200 |
| flow control (`data[12]` bit 2) | **ligado** | desligado |

O oficial é idêntico ao `rtl8761b_config.bin` (o `WHENCE` do `linux-firmware`
declara `Link: rtl_bt/rtl8821cs_config.bin -> rtl8761b_config.bin`). Ou seja: o
hardware usa 4 fios a 1500000, coerente com `uart-has-rtscts` no DTS — não 3 fios
como a documentação do projeto supunha. Gerar o arquivo à mão era pior do que não
ter arquivo nenhum: o driver aceitava (`cfg_sz 25`) e o rádio funcionava pela
metade.

Lição: antes de reconstruir um binário de firmware, procurar o oficial no tarball
do `linux-firmware` — ele quase sempre está lá, e quando a lista do Buildroot não
o instala, a correção é acrescentar à lista, não reescrever o arquivo.

### Rádio ligado no boot

`bluez5-utils` não instala `/etc/bluetooth/main.conf`, e o padrão de compilação
tem `AutoEnable=false`: o controlador aparecia em `bluetoothctl list` e ficava
`Powered: no`. Para quem pega o aparelho, isso é indistinguível de "Bluetooth
quebrado". O overlay traz um `main.conf` mínimo com `AutoEnable = true`;
depois do boot, `Powered: yes` sem nenhum comando.

### `amixer` não existe, e o teste de áudio aprendeu isso

O Buildroot 2024.02 empacota `alsactl` e `alsamixer`, **não** `amixer`. O
`giochi-selftest` usava `amixer` para conferir o `Playback Mux` e caía em SKIP.
Agora o caminho principal é `alsactl store`, que despeja todos os controles com
nome e valor:

```text
name 'Playback Mux'
value HP
```

No aparelho: `[PASS] Playback Mux = HP (falante roteado por HPOL/HPOR)`.
O placar subiu para **PASS 21 · SKIP 1** — o único SKIP restante é o 3D, que
depende de `kmscube`.

### Avisos com causa conhecida

| Aviso | Causa |
| --- | --- |
| `sem hwrng` | `rng@fe388000` nasce `disabled` no `rk356x.dtsi`; o RK3566 não herda o `okay` do `rk3568.dtsi` |
| `nenhuma interface além de lo` | Wi-Fi depende do SDIO, corrigido no patch de DTS, e do `rtl8821cs_config.bin` gerado (ainda não existe) |
| `giochi-init não é o PID 1` | falta a linha `::respawn:` no `/etc/inittab` (decisão em aberto, `docs/giochi-init.md`) |
| `sem /opt/giochi/apps/index.json` | a grade é do `Giochi app`, não deste repositório |
| `driver DRM rockchip-drm` | o render node é `panfrost`; o selftest olha o nome do DRM de display |

## Instalação remota, sem tirar o cartão

O cartão do aparelho **não estava no leitor** do computador. O caminho usado foi
serial + U-Boot:

1. `loady <addr>` + YMODEM (`docker/ymodem-send.py`) para levar o arquivo à RAM.
   Medido: 10240 bytes com CRC32 conferido (`8d12ebe6` nos dois lados).
2. `mmc write` para o MBR (512 bytes, setor 0).
3. `gzwrite mmc 1 <addr> ${filesize} <wbuf> <offset>` para FAT e rootfs
   comprimidos com gzip.

Vantagem: o U-Boot executa `gzwrite` sozinho depois de receber o arquivo, e
**nada é interrompido** ao desconectar o host. Detalhe que quase custou o
diagnóstico: parar o container no meio não interrompeu a gravação — quem estava
gravando era o U-Boot.

Tamanhos medidos com `gzip -1`:

| Arquivo | Cru | Comprimido |
| --- | --- | --- |
| `rootfs.ext4` | 1 GiB | 52 MB |
| partição FAT de boot | 256 MiB | 17 MB |
| imagem de cartão inteira | 2 GiB | 73 MB |

## Gadget USB (usb0) — funciona, mas não foi usado para transferir

Montado em runtime no aparelho, sem mudar o kernel:

```sh
mount -t configfs none /sys/kernel/config
cd /sys/kernel/config/usb_gadget && mkdir g1 && cd g1
echo 0x1d6b > idVendor; echo 0x0104 > idProduct
mkdir -p strings/0x409 configs/c.1/strings/0x409 functions/ecm.usb0
echo GIOCHI > strings/0x409/manufacturer; echo x55 > strings/0x409/product
echo 0001 > strings/0x409/serialnumber
echo ECM > configs/c.1/strings/0x409/configuration
ln -s functions/ecm.usb0 configs/c.1/
echo fcc00000.usb > UDC
ip link set usb0 up
ip addr add 10.55.0.2/24 dev usb0
```

Resultado medido:

- host cria `enx323a584c0d05` com `32:3a:58:4c:0d:05`;
- aparelho cria `usb0` com `da:79:96:dc:d5:5e`;
- **`ping6` do host para o aparelho: 0% de perda, 0.3 ms**.

O que faltou para transferir: o host não tem IPv4 na interface nova (sem `sudo`
para `ip addr add`) e o aparelho não ganhou rota IPv6 para o link. Com um IPv4
nos dois lados, é o caminho mais rápido — o link é USB 2.0.

## Menu extlinux sem `TIMEOUT`: o aparelho não boota sozinho

Bug real, encontrado com a primeira imagem de cartão: o `extlinux.conf` gerado
tinha `default giochi` e mais nada de tempo. O U-Boot encontrava a entrada,
imprimia

```text
Giochi System
1:	giochi
Enter choice:
```

e **parava ali**. Num handheld isso é indistinguível de "não bootou": a tela
fica no console e ninguém está com a serial aberta para apertar Enter.

Correção em `scripts/make-sd-image.sh`: `timeout 30` no `extlinux.conf`
(a unidade é 1/10 s, então 3 s). Verificado no aparelho com `reboot`: o U-Boot
escolhe a entrada sozinho e chega ao `login:` sem nenhuma tecla.

Não use `prompt 0` para "resolver": ele remove o menu e tira a única forma de
escolher outra entrada quando houver mais de uma.

### Também não é bug: `Boot failed (err=-14)` antes do extlinux

O log mostra, antes de achar a entrada boa:

```text
Scanning global bootmeth 'efi_mgr':
No EFI system partition
Loading Boot0000 'mmc 1' failed
EFI boot manager: Cannot load any image
Boot failed (err=-14)
```

É o `bootstd` tentando `efi_mgr` primeiro e falhando porque o cartão é MBR com
FAT, não uma ESP. O `bootstd` segue para o próximo método (`extlinux`) e boota.
Também aparece `Card did not respond to voltage select! : -110` — é o `mmc2`
(eMMC), que este aparelho não tem. Nenhum dos dois precisa de correção.

## Modo Maskrom: quando o BootROM não lê o cartão

Sintoma medido em 03/11/2026, ao testar a imagem de cartão pronta: o aparelho
apareceu no host como

```text
Bus 002 Device 008: ID 2207:350a Fuzhou Rockchip Electronics Company
```

`2207:350a` é o **Maskrom** do RK3566 — o BootROM não achou um loader válido no
cartão e caiu no modo de recuperação por USB. Consequência prática: **a falha é
anterior ao kernel**, então nenhum ajuste de DTS, driver ou rootfs explica ou
conserta esse caso.

O que verificar, nesta ordem:

1. **Cartão não estava no aparelho, ou entrou pela metade.** O Maskrom persiste
   até um ciclo de energia; inserir o cartão depois não reinicia o BootROM.
2. **Cartão SDXC grande demais para este BootROM** (hipótese descartada depois:
   o `SD128` de 116 GiB bootou normalmente). O cartão que bootou primeiro é um
   `SE32G` de 29,7 GiB; o gravado é de **116 GiB** (SDXC). O Maskrom observado
   apontava para o cartão, mas o teste seguinte com o cartão grande bootou — a
   causa real era o cartão **fora do aparelho** no momento da energização. O
   conteúdo, byte a byte, era correto nos dois:
   - setor 64: `52 4b 4e 53 00 00 00 00 80 01 02 00 01 00 00 00` (`RKNS`)
   - setor 16384: `d0 0d fe ed 00 00 0e 00 …` (FIT)

   Como esses são exatamente os bytes do cartão que funcionou, um Maskrom com
   este cartão aponta para **compatibilidade do cartão**, não para o conteúdo.
3. **Ciclo de energia de verdade.** Desligar e religar pelo botão (não reset por
   software): o Maskrom só sai assim.

Para capturar o próximo boot sem adivinhar:

```bash
docker run -d --name x55-serial --restart unless-stopped --device=/dev/ttyUSB0 \
  -v "$HOME/.cache/giochi-system/serial:/work/log" --entrypoint python3 \
  giochi-serial:1 /work/serial-log.py /dev/ttyUSB0 1500000 /work/log/boot-novo.log
```

O log traz a sequência `U-Boot SPL` → `U-Boot` → kernel. Se ele começar com
`RKNS`/`d0 0d fe ed`, o firmware foi encontrado; se ficar vazio e o host mostrar
`2207:350a`, o BootROM não leu o cartão.

## Recuperação: o rootfs em execução é a partição do cartão

Registro de um erro real, para não repetir. Durante a validação, a partição do
rootfs foi montada em `/mnt/new` e limpa com `rm -rf` para receber uma cópia
nova. Só que `/dev/mmcblk1p2` **é** a raiz em execução: `/bin/busybox`
desapareceu, o shell ficou só com builtins e o boot seguinte terminou em

```text
Kernel panic - not syncing: No working init found.
```

O que ainda funcionava e permitiu a recuperação sem tocar no aparelho:

- `/tmp` é tmpfs (RAM), então o `rootfs.ext4.gz` já enviado sobreviveu;
- o firmware do U-Boot (setores 64 e 16384) não é tocado por nada disso;
- o U-Boot tem `loady` e `gzwrite`, que gravam por offset sem Linux.

Sequência usada:

```text
1. sysrq 'b'            sai do sistema quebrado (a CPU fica parada em panic)
2. serial-interrupt.py   martela teclas em "Hit any key to stop autoboot"
3. loady 0x20000000      YMODEM do rootfs.ext4.gz (52 MB, ~15 min)
4. gzwrite mmc 1 0x20000000 ${filesize} 0x100000 0x14000000
5. reset                 boot volta ao normal
```

Resultado: `PASS 18 · FAIL 0` de novo, com `S15modules` e `wlan0` no boot.

**Regra:** nunca limpar a partição montada em `/`. Para trocar o rootfs, use
`gzwrite` no U-Boot, a imagem de cartão com o cartão no leitor, ou um segundo
cartão — nunca a raiz corrente.

## Orientação da tela: era o kernel, não o U-Boot

Sintoma relatado: console na vertical, texto deitado. A linha de comando já
tinha `fbcon=rotate:3` desde a primeira imagem, e mesmo assim o console saía em
**90x80** (720/8 × 1280/16), que é a orientação nativa do painel.

Causa: `CONFIG_FRAMEBUFFER_CONSOLE_ROTATION` estava **desligado**. Sem essa
opção o kernel **ignora `fbcon=rotate:N` em silêncio** — não avisa, não reclama,
apenas usa a orientação nativa. Nada no U-Boot participa disso.

```text
antes:  framebuffer device 90x80    fbcon/rotate = 0    (retrato, deitado)
depois: framebuffer device 160x45   fbcon/rotate = 3    (paisagem, correto)
```

`rotate=3` é 270° no sentido horário, equivalente a **90° anti-horário** (para a
esquerda) — exatamente o que o aparelho precisa. Corrigido em `linux.fragment`
(e exigido em `kernel-required.txt` para não sumir sem aviso).

Nota: `/sys/class/graphics/fb0/virtual_size` continua `720,1280` — é o
framebuffer **físico**. A rotação do console acontece na camada `fbcon`, então a
geometria que importa é a do `dmesg` (`frame buffer device NxM`).

O `giochi-selftest` passou a conferir isso **pelo resultado**: se o painel está
em `720x1280` e `fbcon/rotate` é 0, avisa que o texto vai sair deitado. Testar a
intenção (o parâmetro na linha de comando) não pegaria este bug.

## Teste de botões: `giochi-buttons`

Ferramenta que fica na imagem, porque testar controle é rotina e não evento.

```sh
giochi-buttons            # 17 botões de gamepad, com contagem do que falta
giochi-buttons --axes     # 4 eixos, com barra de posição
giochi-buttons --volume   # só volume
giochi-buttons --all      # um dispositivo por vez
giochi-buttons --list     # dispositivos e mapa, sem capturar
giochi-buttons --raw      # evtest cru
```

Saída medida no aparelho:

```text
== gpio-keys-control (/dev/input/event3) ==
Esperando 17 botão(ões). Cada um que responder reduz o que falta.

  [ 1/17] a          pressionado   (faltam 16)
  [ 2/17] b          pressionado   (faltam 15)
  ...
  eixo RX (direito horizontal)  512  [----------#----------]
```

Traduz o código evdev para o **nome lógico do `buttons.map`** (`BTN_EAST` → `a`,
`BTN_MODE` → `home`), então serve tanto para conferir hardware quanto para
validar o mapa que o launcher vai ler.

### Duas decisões de implementação

1. **Base no `evtest`, não em leitura direta de `/dev/input`.** O evtest 1.35 faz
   `setbuf(stdout, NULL)`: evento aparece na hora. Um `cat`/pipe com stdio
   bufferizado mostraria tudo de uma vez só no fim — inútil para "aperte e veja".
   A dependência está em `BR2_PACKAGE_EVTEST` e o selftest avisa se faltar.
2. **Tradução em `awk` do busybox.** O parser separa a linha do evtest por `", "`
   antes de procurar o nome do código. Sem isso, o primeiro parêntese da linha
   (`(EV_KEY)`) é capturado no lugar de `(BTN_EAST)` — foi um bug real durante o
   desenvolvimento, e todo evento aparecia como `EV_KEY`.

## Avisos no dmesg que NÃO são defeito

Três mensagens aparecem em todo boot e nenhuma delas indica problema. Registradas
aqui porque, sem isso, o próximo a investigar gasta tempo nas três:

| Mensagem | O que é |
| --- | --- |
| `mmc0: Failed to initialize a non-removable card` | `mmc0` é o slot de eMMC, que **este aparelho não tem**. O controlador existe no SoC; não há cartão para inicializar. |
| `rtw_8821cs mmc3:0001:1: sdio read32 failed (0xf0): -110` | primeira tentativa do driver durante o probe, antes do power-on do rádio estabilizar. O driver tenta de novo e segue: `Firmware version 24.11.0` vem na linha seguinte. |
| `rtw_8821cs mmc3:0001:1: sdio write8 failed (0x1c): -110` | idem, mesmo instante do probe. |
| `Card did not respond to voltage select! : -110` (U-Boot) | também `mmc2`/eMMC inexistente. |

Prova de que os `-110` do Wi-Fi são transitórios, medido depois do boot:

```text
wlan0  UP  192.168.1.6/24
iw dev wlan0 link → SSID: Kill.exe         signal: -29.00 dBm
ping 1.1.1.1      → 2 pacotes, 0% de perda, 9 ms
```

Só tratar como falha se o `wlan0` **não** aparecer ou se o `iw link` ficar vazio.

## Controles: 17 botões e 4 eixos, sem driver fora da árvore

Correção de um diagnóstico anterior deste repositório. A documentação dizia que
"16 dos 17 botões não funcionam" e que o `rocknix-joypad` era obrigatório. Ao
ler o DTS mainline do 6.12 direto na árvore do kernel:

```text
gpio-keys-control: 16 botões com códigos BTN_* próprios
   EAST/SOUTH/NORTH/WEST, DPAD-UP/DOWN/LEFT/RIGHT,
   TL/TR/TL2/TR2, SELECT, START, THUMBL, THUMBR
gpio-keys-vol: 2 botões (KEY_VOLUMEUP/DOWN)
```

Os GPIOs conferem com o mapa do projeto (`gpio3 PD3` = EAST, `gpio4 PA0` =
DPAD-UP, etc.). Ou seja: **16 dos 17 já funcionavam pelo driver mainline**. O
`rocknix-joypad` só seria necessário para algo que o DTS não declare.

O que realmente faltava eram **duas** coisas, agora medidas no aparelho:

| Falta | Causa | Correção |
| --- | --- | --- |
| botão `F` (MODE, `gpio3 PB7`) | o DTS mainline não o declara | `patches/0002-giochi-system-x55-btn-mode.patch` |
| 4 eixos analógicos | `CONFIG_JOYSTICK_ADC` não estava ligado — o nó `adc-joystick` do DTS ficava sem driver | `=y` no `linux.fragment` e em `kernel-required.txt` |

Prova no aparelho, lendo o bitmap de capacidades do kernel:

```text
antes:  key 6fdb000000000000 …      → 16 botões
depois: key 7fdb000000000000 …      → 17 botões (novo bit 0x13c = BTN_MODE)

adc-joystick | abs: 1b              → ABS_X|ABS_Y|ABS_RX|ABS_RY
```

`giochi-selftest` passou a **contar** em vez de listar nomes:

```text
  [PASS] botões de gamepad: 17 (gpio-keys-control)
  [PASS] eixos analógicos: 4 (adc-joystick)
  [PASS] /etc/giochi/buttons.map (31 entradas)
```

### Duas armadilhas dentro da correção

1. **`awk` do busybox não tem `strtonum`.** A primeira versão do contador de
   bits usava `strtonum("0x" $i)`, que é extensão do gawk: no busybox devolve
   vazio em silêncio e o teste "passa" com contagem zero. A versão que ficou
   conta dígito a dígito com `index`/`substr`.
2. **`kernel-required.txt` é separado do fragmento por um motivo.** O
   `assert-kernel-config` acusou na hora: `CONFIG_JOYSTICK_ADC: pedido =y, ficou
   is not set`. O `str.replace` do script de edição não aplicou (texto do
   comentário diferente) e o fragmento ficou sem a linha — o gate pegou o que um
   build manual não pegaria.

## Wi-Fi conecta sozinho no boot

`config/common/rootfs-overlay/etc/init.d/S40wifi` conecta **se** existir
`/etc/wpa_supplicant.conf`. O arquivo não vem na imagem: contém a senha da rede
e senha não se versiona. Provisionamento é um comando só:

```sh
wpa_passphrase 'MINHA-REDE' 'MINHA-SENHA' > /etc/wpa_supplicant.conf
chmod 600 /etc/wpa_supplicant.conf
```

Depois disso, medido após `reboot`: `wlan0` fica `UP 192.168.1.6/24` e o SSH
responde sem nenhuma intervenção. Sem o arquivo, o script sai em silêncio — a
maioria dos boots de diagnóstico não tem rede configurada e erro a cada boot
vira ruído.

## Wi-Fi com internet (medido)

Com a rede associada por `wpa_supplicant` e DHCP:

```text
wlan0  UP  192.168.1.6/24  fd00::aa4f:a4ff:fec9:984b/64
default via 192.168.1.1 dev wlan0
ping 1.1.1.1 → 3 pacotes, 0% de perda, 8,8 ms
```

SSH (dropbear) responde na porta 22 e, com uma chave em
`/root/.ssh/authorized_keys`, dá acesso sem senha. **A chave é instalada em
tempo de execução, não vai no repositório** — uma chave pública commitada dá
acesso a quem tiver a privada.

Credenciais de Wi-Fi também não entram no repositório: são passadas em tempo de
execução (`wpa_passphrase` no aparelho).

## O que ainda falta (ordem de risco)

1. **`rocknix-joypad`** — driver fora da árvore. Sem ele, **16 dos 17 botões não
   funcionam**; só o volume responde (`gpio-keys`). O `assert-kernel-config`
   falha se alguém remover o `allow-drop` sem trazer o driver.
2. **~~Validação do patch de DTS em hardware~~ — FEITO.** O patch
   `patches/0001-giochi-system-x55-dts.patch` está no aparelho e os quatro
   efeitos foram observados: `hwrng: rockchip-rng` (o `&rng okay`), SDIO em
   SDR50, HDMI fora do `card` de display e `dma-names` aceito pelo uart1.
3. **Firmware de Bluetooth do RTL8821CS.** O driver pede
   `rtl_bt/rtl8821cs_fw.bin` e o `linux-firmware` só traz `rtl8821c_fw.bin`.
   Sem ele o `hci0` não sobe. Junto com o `rtl8821cs_config.bin` de 25 bytes
   (offset `0x0c`), é o último item de rádio.
4. **`giochi-init` no `/etc/inittab`** — o script está na imagem e ninguém o
   chama; `giochi-selftest` avisa.
5. **`genimage` dentro do Buildroot** — hoje a imagem de cartão é montada por
   `scripts/make-sd-image.sh`, fora do Buildroot.

## Como reproduzir

```bash
# 1. host auditável (não instala nada, não precisa de root)
bash scripts/check-host.sh

# 2. build completo sem instalar dependências no host
ALLOW_DRAFT=1 bash scripts/build-in-container.sh powkiddy-x55

# 3. imagem de cartão (firmware nos offsets, MBR, FAT, ext4)
bash scripts/build-in-container.sh --sd-image powkiddy-x55

# 4. gravar, com guarda de tamanho e SHA256 conferido relendo o cartão
docker run --rm --privileged --user 0:0 -v /dev:/dev -v "$PWD:/work" -w /work \
  --entrypoint bash giochi-builder:2 -c \
  'bash scripts/flash-sd.sh out/powkiddy-x55/giochi-system-powkiddy-x55-sd.img /dev/sdX --expect-gib 30'

# 5. console e diagnóstico
docker run --rm --device=/dev/ttyUSB0 --entrypoint python3 giochi-serial:1 \
  /work/uboot-serial.py /dev/ttyUSB0 1500000 /dev/null "giochi-selftest"
```

Login: `root` / `giochi-dev` (ou `ROOT_PASSWORD` no build).
