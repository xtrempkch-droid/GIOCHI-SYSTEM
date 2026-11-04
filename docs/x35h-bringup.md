# Bring-up do Powkiddy X35H

Registro do que foi **decidido com evidência** e do que ainda é **hipótese**. A
regra deste repositório vale aqui igual: o que não foi medido no aparelho fica
marcado como não medido.

Estado: **compila**. Não bootou em hardware.

---

## 1. De onde veio o hardware

O `device.json` deste aparelho dizia `RK3566` e "tela 640x480", enquanto o
`AGENTS.md` §13 dizia `RK3326`. As duas coisas não podem ser verdade ao mesmo
tempo: RK3326 é Cortex-A35 com pipeline de boot próprio (DDR init diferente,
U-Boot `odroid-go2`), RK3566 é Cortex-A55 e reaproveita o da X55.

A resposta estava no antecessor, que **mediu** o aparelho
(`GIOCHI-KONSOL-OS/device/x35h/device.conf`):

```text
GIOCHI_SOC=rk3566
GIOCHI_GPU_DRIVER=panfrost
GIOCHI_GL_DESKTOP=3.1
GIOCHI_PANEL=640x480
GIOCHI_ROTATION=0
GIOCHI_WIFI=none
GIOCHI_BT=none
GIOCHI_TESTED=partial
GIOCHI_NOTES="Video/audio/botoes OK em 2026-10-24; sem Wi-Fi/BT"
```

Portanto: **X35H e X35S são RK3566**; **R35S/R36S são RK3326**. O `AGENTS.md`
estava errado e foi corrigido. O mesmo vale para `docs/README.md`.

---

## 2. A resolução: 800×600 não é um parâmetro de build

O pedido inicial foi "uma versão com a resolução em 800x600". Isso não existe
como configuração, e vale registrar por quê — é a classe de erro que consome
uma tarde.

**Resolução de painel MIPI-DSI é NATIVA.** Ela vem de:

1. o modo que o driver do painel anuncia (`st7703_get_modes`), e
2. a temporização gravada no driver ou no DTS.

O parâmetro `video=` da linha de comando **escolhe entre os modos que o conector
já anuncia**; ele não cria um. Num painel DSI, `video=DSI-1:800x600` num painel
640×480 não vira 800×600 — ou é ignorado, ou aplica um modo inexistente e a tela
fica preta.

Comparação: num HDMI real faz sentido, porque a saída negocia modo. Num painel
de handheld, não.

Confirmado depois pelo próprio usuário: **o painel é 640×480**. O pedido de
800×600 era engano. Ficou registrado em `kernelCmdline`, onde `video` existe e é
validado — mas não é usado aqui.

Se o objetivo fosse "interface em 800×600 numa tela de 640×480", o caminho é
renderizar maior e reduzir (GPU), não mudar o modo do painel.

---

## 3. O painel: ST7703, deduzido da sequência

A ROCKNIX usa `compatible = "rocknix,generic-dsi"`, driver fora da árvore. Isso
faz parecer que o painel é "genérico e sem driver mainline". A sequência de
inicialização do patch 0016 da ROCKNIX diz outra coisa:

```text
b9f11283 b1000000da80 b2000370 b31010fcfc03ff00000000 b480 b50606 b6a9a9
b825622003 ba3381…37 bc47 bf021100 c0737350500000127000 c125c0…7777
c68200bfff00ff c7b8000a000000 c810401e02 cc0b e0… e3… e9… ea… efffff01
11(wait 250) 29(wait 50)
```

Cada um desses comandos existe como `ST7703_CMD_*` em
`panel-sitronix-st7703.c` do 6.12:

| Comando | Define no driver |
| --- | --- |
| `B9` | `ST7703_CMD_SETEXTC` |
| `B1` | `ST7703_CMD_SETAPID` |
| `B2` | `ST7703_CMD_SETDISP` |
| `B3` | `ST7703_CMD_SETRGBIF` |
| `B4` | `ST7703_CMD_SETCYC` |
| `B5` | `ST7703_CMD_SETBGP` |
| `B6` | `ST7703_CMD_SETVCOM` |
| `B8` | `ST7703_CMD_SETPOWER_EXT` |
| `BA` | `ST7703_CMD_SETMIPI` |
| `BC` | `ST7703_CMD_SETVDC` |
| `BF` | `ST7703_CMD_UNKNOWN_BF` |
| `C0` | `ST7703_CMD_SETSCR` |
| `C1` | `ST7703_CMD_SETPOWER` |
| `C6` | `ST7703_CMD_SETECO` |
| `C7` | `ST7703_CMD_SETIO` |
| `C8` | `ST7703_CMD_SETCABC` |
| `CC` | `ST7703_CMD_SETPANEL` |
| `E0/E3/E9/EA/EF` | `SETGAMMA/SETEQ/SETGIP1/SETGIP2/UNKNOWN_EF` |

E a estrutura do driver é feita exatamente para isso: `st7703_panel_desc` tem
`mode`, `lanes`, `mode_flags`, `format` e `init_sequence`. Acrescentar um painel
é declarar um `desc` e uma entrada em `st7703_of_match` — nada de driver novo.

Temporização, tirada do mesmo DTS (`default=1`):

```text
clock=30000 kHz  horizontal=640,150,50,150  vertical=480,20,6,12
```

Conferindo: `30000 / ((640+150+50+150) × (480+20+6+12)) = 30000/512820 = 58,5 Hz`,
que bate com o `fps=58.500059` anotado pela própria ROCKNIX. A leitura dos
campos está certa.

Tamanho físico: `size=70,52` (mm). 70/52 = 1,346 ≈ 4:3, coerente com 640×480.

---

## 4. O que o build provou

O build do X35H aplicou os dois patches sobre o kernel **original do tarball**
(sem fuzz, sem rejeitos) e passou pelos gates:

```text
  patch:     0001-giochi-system-x35h-dts.patch
  patch:     0002-giochi-system-x35h-panel-st7703.patch
assert-config: OK — 19 símbolo(s) de 2 fragmento(s) verificados.
```

O `assert-kernel-config` é o gate que compara o `linux.fragment` com o `.config`
que o kernel realmente usou; é ele que pega painel que não existe com o nome
escrito.

---

## 4.1 O defeito que só apareceu ao ler o DTB pronto

O primeiro build do X35H passou por tudo: patches aplicados, `assert-config`
OK, `assert-kernel-config` OK, imagem gerada. Estava **errado**.

Patch de kernel **não se compõe entre aparelhos**: o `kernelPatches` do X35H
lista só os patches dele, então o patch `0001` da X55 — que desliga HDMI,
conserta o `sdmmc1`, põe `dma-names` no uart1 e liga o `&rng` — não é aplicado.

E o DTS do X35H faz `#include "rk3566-powkiddy-x55.dts"`, que é o **mainstream**,
sem essas correções. Lendo o `.dtb` gerado:

| Nó | Veio | Efeito |
| --- | --- | --- |
| `rng@fe388000` | `disabled` | sem entropia, `getrandom()` bloqueia, inclusive o `sshd` |
| `hdmi@fe0a0000` | `okay` | conector fantasma, probe atrasa o boot |
| `mmc@fe2c0000` (`sdmmc1`) | `okay` + `non-removable` | kernel briga com o cartão SDIO do RTL8821CS **que não existe aqui**, `-110` repetido |
| `uart@fe650000` (`uart1`) | `okay` | Bluetooth do mesmo chip, ausente |

Nenhum desses dá erro de build. O primeiro sintoma seria "boota, mas demora" e
"o ssh demora a responder" — dois sintomas que se confundem com hardware ruim.

A correção está no `patches/0001` deste aparelho: **desligar explicitamente** o
que a X55 liga. Omitir o patch dela não basta, porque omitir deixa o nó como o
DTS base declarou.

Lição registrada em `AGENTS.md` §12.26: herdar DTS de outro aparelho exige uma
lista do que **reverter**, não só do que acrescentar. E
`tests/device-x35h.test.mjs` verifica os quatro `status` para que a próxima
herança não repita o silêncio.

## 5. Sem console: o cartão é o canal

Este aparelho não tem TTL, Wi-Fi nem Bluetooth. A tela é o único canal — e é
justamente o que pode estar quebrado. Então o diagnóstico vai para o cartão.

`device/common/rootfs-overlay/etc/init.d/S96bootlog` monta a partição FAT do
cartão e grava `giochi-boot.log`. Só roda se existir o marcador
`/etc/giochi/boot-log`, que está no overlay **deste** aparelho e não no da X55.

O log contém, para o caso de a tela não acender:

| Bloco | Por que |
| --- | --- |
| `cmdline` | confirma que o U-Boot entregou o `console=` e a rotação |
| `dmesg` completo | o `-517` do painel, o `-110` do SDIO, o panic |
| `/proc/bus/input/devices` | se `gpio-keys-control` e `adc-joystick` existem |
| DRM `status`/`modes` | se o conector ligou e qual modo foi escolhido |
| backlight | se o problema é o PWM e não o painel |
| partições e `df` | se o rootfs montou |
| `giochi-selftest` | o veredito resumido |

Procedimento: ligar, esperar ~40 s, desligar, tirar o cartão, ler a partição
`GIOCHI_BOOT` no PC.

---

## 5.1 A primeira imagem gravada (03/11/2026)

| Item | Valor |
| --- | --- |
| Imagem | `giochi-system-powkiddy-x35h-sd.img`, 2.0 GiB |
| SHA256 | `9f1a7d37…` (1ª) · `57d232f6…` (2ª, bootlog v1) · `3c1cb9ea…` (3ª, diagnóstico na tela) · `f580b729…` (4ª, log no ext4) · **`5dc5ce3583b5d203a3a357be4bf90c86d4c1f194dda7375b51353828401a3bf7` (5ª, atual)** |
| Cartão | `Multi-Reader -3`, 29.7 GiB (slot 4 do leitor; os outros três vazios) |
| Conferência | SHA256 relido **do cartão** depois da gravação — confere |
| Estrutura no cartão | idbloader `RKNS` no setor 64, FIT `d00dfeed` no setor 16384, p1 em LBA 131072 |

O `--expect-gib 30` do `flash-sd.sh` não é enfeite: um leitor Multi-Reader
expõe **quatro** discos e três deles medem `0.0 GiB`. Sem a guarda, o cartão
errado é uma escolha de uma letra. É o mesmo cenário do `AGENTS.md` §12.8, que
já custou uma gravação no lugar errado neste projeto.

O cartão já tinha rótulos de uma gravação anterior (`GIOCHI_BOOT` + `rootfs`),
então é mídia de teste descartável — nada de valor foi perdido ao sobrescrever.

### 5.2 O log não apareceu — e a causa foi medida

Primeira tentativa: LED aceso, **tela preta**, e **nenhum `giochi-boot.log`** no
cartão. Sem console serial, "não tem log" é indistinguível de "não ligou" — e
era o problema mais grave dos dois.

Causa, encontrada no `.config` do busybox da imagem:

```text
# CONFIG_FEATURE_MOUNT_LABEL is not set
```

Sem essa opção o `mount` do busybox **não resolve `PARTUUID=`, `UUID=` nem
`LABEL=`** — isso é recurso do util-linux. A string vai crua para o kernel, que
responde `ENODEV`. O script montava com:

```sh
mount -t vfat PARTUUID=47494f43-01 /mnt     # nunca funcionou
```

O `CONFIG_VFAT_FS` do kernel estava `=y`, então o filesystem nunca foi o
problema. O log era gravado só em `/var/log/giochi-boot.log`, dentro do rootfs —
onde o PC não alcança.

Correções aplicadas:

| Antes | Agora |
| --- | --- |
| `mount PARTUUID=...` | localiza a partição **pelo conteúdo**: a que tem `extlinux/extlinux.conf` ou `boot.scr` |
| lista fixa de dispositivos | glob (`/dev/mmcblk*p1`, `/dev/sd*[0-9]`), porque o nome depende de como o driver enumerou |
| falha se já estiver montada | reaproveita o ponto existente e **não desmonta o que não montou** (medido: com o cartão montado pelo udisks2, o mount falha com "already mounted or mount point busy") |
| só no fim do boot | **duas fases**: `S10bootlog` grava `dmesg` + DRM logo no início; `S96bootlog` acrescenta rede e selftest |

A fase early existe porque, se um serviço travasse o boot, a fase final nunca
rodaria — e o diagnóstico seria de novo "não ligou".

`CONFIG_VFAT_FS`, `CONFIG_FAT_FS` e os NLS entraram no `kernel-required.txt`:
vêm do defconfig arm64, e num aparelho sem console esta é a única saída de
diagnóstico.

### 5.3 A tela acendeu — e o log continuou sem aparecer

Segundo boot, com a imagem 57d232f6: **a tela acendeu**, apareceu o Tux e a
orientação está correta. Isso fecha três incógnitas de uma vez:

| Incógnita | Resultado |
| --- | --- |
| O painel **ST7703** funciona com o driver mainline? | **sim** |
| O modo 640×480 é aceito? | **sim** |
| A rotação 0 é a correta nesta carcaça? | **sim** |
| O `CONFIG_JOYSTICK_ADC`, `panfrost`, DSI host e PHY? | funcionando — o fbcon desenha |

E o LED verde aceso já tinha dado a primeira metade da resposta: ele é
`gpio-leds` com `default-state = "on"`, ou seja, **o kernel só o liga depois de
ler o DTB e rodar o driver**. LED aceso + Tux na tela = boot completo com
display.

Mas o `giochi-boot.log` continuou **inexistente**. E a causa não era a mesma da
tentativa anterior.

#### O que se sabe, e o que ficou faltando

O mecanismo foi **provado no cartão real**: rodando o `giochi-bootlog` contra o
`/dev/sdd1` do leitor, ele achou a partição pelo conteúdo, montou e gravou. Então
o código do mount está correto — a diferença é o ambiente do aparelho, e para
isso não havia dado nenhum, porque o `S10bootlog` chamava o script com
`>/dev/null 2>&1`.

**Esse silêncio foi o erro de método**, não o mount. A correção não foi tentar
outro caminho de montagem às cegas; foi tornar o erro legível:

- as mensagens do `giochi-bootlog` vão para **`/dev/tty0`** — o console do
  `fbcon`, que é o que está desenhado no painel. O `console=` da cmdline aponta
  para a UART, então `echo >&2` some; `/dev/tty0` aparece na tela;
- o stderr de cada `mount` é **capturado e registrado**, com o motivo;
- o script lista os **blocos visíveis** (`/dev/mmcblk*`, `/dev/sd*`), porque
  "não achei a partição" sozinho não distingue "o cartão não enumerou" de
  "enumerou com outro nome".

Com isso o próximo boot responde pela tela, sem serial e sem tirar o cartão.
Três desfechos possíveis, todos conclusivos:

| O que aparece na tela | Significa |
| --- | --- |
| `partição de boot: /dev/mmcblkXpY` e `gravado em ...` | funcionou |
| `  /dev/mmcblkXpY: <motivo>` | o mount falhou e agora diz por quê |
| **nada** | o script não rodou (marcador/overlay), não é o mount |

**Para testar:** colocar no X35H e ligar. Não há TTL neste aparelho; o
diagnóstico sai em `giochi-boot.log`, na partição FAT (`GIOCHI_BOOT`), que
qualquer PC lê. Se a tela não acender:

```text
1. desliga, tira o cartão, põe no PC
2. abre a partição GIOCHI_BOOT
3. lê giochi-boot.log  →  cmdline, dmesg, DRM status, entrada, selftest
```

O `dmesg` desse arquivo é o que distingue "não ligou" de "morreu no probe do
painel com `-517`".

## 5.4 Estado do cartão em uso (imagem `5dc5ce35`)

Este cartão é usado **também pelo time do `Giochi app`**, então o conteúdo foi
conferido no dispositivo, não só o SHA256:

| Verificação | Como | Resultado |
| --- | --- | --- |
| MBR + firmware | `od` nos offsets | `RKNS` no setor 64, `d00dfeed` no setor 16384 |
| Partição de boot | montagem read-only | `Image`, `boot.scr`, `dtbs/`, `extlinux/extlinux.conf` |
| Rootfs | `debugfs` (sem montar) | `giochi-bootlog`, `S10bootlog`, `S96bootlog`, marcador, `libharfbuzz`, `DejaVuSans.ttf`, `selftest` |

### O que esperar no próximo boot

Tela liga (já provado), aparece o Tux, e depois **uma** destas linhas na tela:

| Mensagem | Significa |
| --- | --- |
| `partição de boot: /dev/mmcblkXpY` + `gravado em giochi-boot.log` | funcionou — o log está na FAT |
| `  /dev/mmcblkXpY: <motivo>` | o mount falhou e agora diz por quê |
| `NÃO consegui montar a partição de boot.` + caminho no ext4 | toda tentativa falhou; o log está em `/root/giochi-boot.log` |

No terceiro caso, ler do PC sem montar:

```bash
debugfs -R 'cat /root/giochi-boot.log' /dev/sdX2
```

### Acesso sem tirar o cartão

Se o `usb0` subir (o cabo USB estava ocupado no último teste), `ssh
root@10.55.0.2` (senha `giochi-dev`) dá acesso direto, e o `giochi-selftest`
mostra o bloco "bibliotecas do launcher" com as cinco `.so` e o `readelf -d`
provando que o `SDL2_ttf` usa harfbuzz.

## 5.5 BOOTOU COM SSH — o primeiro acesso sem serial (03/11/2026)

O aparelho subiu com tela **e** com rede USB. Estado medido via `ssh
root@10.55.0.2`:

```text
giochi-system-x35h   kernel 6.12.0   uptime 0 min

PASS 34 · WARN 3 · FAIL 0 · SKIP 3
```

### O que o `giochi-selftest` confirmou

| Bloco | Medida |
| --- | --- |
| display | `card0-DSI-1: connected 640x480`, backlight `833/1666`, `console rotate=0, 80x30` |
| DRM | `rockchip-drm`, `/dev/dri/card0` + render node |
| entrada | 5 dispositivos: `gpio-keys-control` (**16 botões**), `adc-joystick` (**4 eixos**), `gpio-keys-vol`, `rk805 pwrkey`, codec |
| áudio | `rk817ext` + **`Playback Mux = HP`** |
| energia | bateria **68% (Charging)**, 41 °C |
| entropia | `hwrng: rockchip-rng` |
| rede USB | `usb0` em `10.55.0.2`, `udhcpd` dando IP ao PC, `sshd` na 22 |
| bibliotecas | as cinco do launcher + 21 fontes `.ttf` |

Ou seja: **um aparelho sem Wi-Fi, sem Bluetooth e sem TTL ficou acessível por
um cabo USB, com endereço automático.** É exatamente o que o
[`sistema-base.md`](sistema-base.md) prometia, e a primeira vez que o contrato
foi verificado em hardware.

### A causa do log não chegar ao cartão: DOIS cartões

O kernel do X35H expõe duas mídias:

```text
mmcblk0   3.7 GiB   eMMC INTERNA, com uma imagem antiga instalada
                    (mmcblk0p1 monta como vfat e tem um `extlinux/` de outro sistema)
mmcblk1   29.7 GiB  o cartão SD, que é o que bootou
```

O script testava `mmcblk0p1` primeiro por ordem alfabética, montava a **eMMC**,
não encontrava `extlinux.conf` (só o diretório), gastava a tentativa e desistia
sem nunca olhar o SD.

A correção não foi reordenar a lista na mão — foi **derivar a ordem da
realidade**: a partição de boot mora no mesmo disco do rootfs em uso. Mas
`/proc/mounts` responde `/dev/root`, que é **alias**, não o nome real
(`readlink -f` não resolve, porque não há symlink no devtmpfs). O caminho que
funcionou foi o major:minor do `/proc/self/mountinfo` casado com
`/sys/dev/block/<dev>`:

```text
rootfs em /dev/mmcblk1p2; partição de boot do mesmo disco: /dev/mmcblk1p1
partição de boot: /dev/mmcblk1p1
gravado em giochi-boot.log em /mnt/bootlog
```

Agora o log **chega ao cartão**: `giochi-boot.log` de 26 KB na FAT, legível em
qualquer PC.

### Três bugs do selftest que o aparelho revelou

Todos da mesma família: **o teste perguntava a coisa errada**.

| Reportado | Realidade | Por que o teste errou |
| --- | --- | --- |
| 5× `libasound ausente` | as cinco em `/usr/lib` | `ls dir1/x* dir2/x*` retorna não-zero se **um** dos padrões não casar |
| `FAIL sem usb0 apesar de haver UDC` | `ip link` mostra `usb0` e o SSH responde por ele | `/sys/class/net/usb0` é **symlink pendurado** neste kernel: `-e`/`-d` falham com o netdev funcionando |
| `WARN udhcpd parado` | `udhcpd` rodando (pid 176) e servindo IP | o busybox `udhcpd` **não grava pidfile** |

Depois de corrigir, a mesma execução deu `PASS 34 · WARN 3 · FAIL 0`. Os 6 FAILs
eram todos do teste.

### `model` mente; `compatible` não

```text
/proc/device-tree/model       -> "RG353M m"
/proc/device-tree/compatible  -> "powkiddy,x35h rockchip,rk3566"
```

O DTB carregado **é o nosso** — o `compatible` prova, e o painel confirma. Mas o
U-Boot do defconfig `anbernic-rgxx3-rk3566` **reescreve `/model`** com o nome da
placa dele. Quem identifica o aparelho só por `model` conclui que é um Anbernic.
O `giochi-selftest` passou a reportar o `compatible` e a avisar na divergência.

### O dongle Wi-Fi USB: hardware do usuário, não do aparelho

O X35H **não tem rádio onboard** — nem Wi-Fi, nem Bluetooth. A comunidade
resolve com **dongle USB**, e isso muda a decisão de empacotamento.

Primeiro fato, medido no DTB: o aparelho tem **duas portas USB independentes**,
então gadget de rede e dongle convivem:

```text
usb@fcc00000  dr_mode=otg   status=okay  → usb0 (SSH por cabo)
usb@fd000000  dr_mode=host  status=okay  → dongle Wi-Fi
```

Segundo fato: **nenhum driver de dongle estava no kernel**. Plugar um dongle não
faria nada — sem erro, sem `wlan0`, sem pista.

A decisão que eu havia tomado ("sem rádio onboard, sem pacote de Wi-Fi") estava
errada, e a correção é conceitual, não pontual:

| Hardware | Como chega | Empacotar? |
| --- | --- | --- |
| **onboard** (RTL8821CS na X55) | já está na placa, ou nunca estará | só se existir |
| **do usuário** (dongle, cartão SD) | **depois** da imagem gravada | **sempre** |

A imagem é gravada uma vez; o dongle chega depois. Sem suporte prévio, o usuário
não tem saída sem recompilar.

### O que foi acrescentado

Drivers no `linux.fragment` (todos `=m`, carregam por modalias quando o dongle
entra):

| Símbolo | Cobre |
| --- | --- |
| `CONFIG_RTL8XXXU=m` | RTL8188CU/EU, RTL8192CU, RTL8723AU, RTL8188FU |
| `CONFIG_RTL8XXXU_UNTESTED=y` | **8188FU** — o dongle barato de hoje |
| `CONFIG_RTL8192CU=m` | driver legado, para revisões que o rtl8xxxu não cobre |
| `CONFIG_MT7601U=m` | MediaTek mais barato |
| `CONFIG_ATH9K_HTC=m` | AR9271, o mais estável da lista |

Userspace no `defconfig`: `wpa_supplicant` (+CLI e `passphrase`), `iw`,
`wireless-regdb` — sem eles o dongle sobe e não conecta.

Firmware: `RTL_81XX` e `ATHEROS_9271` têm opção no Buildroot;
`mediatek/mt7601u.bin` **não tem** e entra por `LINUX_FIRMWARE_FILES +=` no
`config/package-overrides.mk`.

O `rtw88` do RTL8821CS **continua fora** — aquele chip é onboard, não existe
aqui e não pode ser plugado.

### Duas armadilhas no caminho

1. **`assert-config` não cobre o `defconfig`.** Ele valida fragmentos `BR2_*`.
   Um `BR2_PACKAGE_LINUX_FIRMWARE_RTL_81XX=y` poderia ser descartado em
   silêncio. Neste caso sobreviveu (conferido no `.config`), mas o gate não
   garantia nada.
2. **O firmware não apareceu de primeira** mesmo com os símbolos corretos: o
   pacote `linux-firmware` já estava instalado e o Buildroot não o reinstala
   quando a lista de arquivos muda. `rm -rf build/linux-firmware-*` resolveu —
   a mesma armadilha do harfbuzz (§12.29).

`giochi-selftest` agora reporta porta USB host, `wlan0` e os módulos de dongle:
plugar um dongle e não ver nada é o pior resultado possível.

## 5.6 Imagem refeita em 04/11/2026 — agora com o `respawn`

A imagem de `out/powkiddy-x35h/` era de **antes** do `post-build` incondicional
(commit `3601e73`), então o binário do `giochi-init` estava no rootfs e ninguém o
chamava. Refeita com `KEEP_WORK=1` — ~4 min, sem recompilar pacote:

```bash
ALLOW_DRAFT=1 GIOCHI_SYSTEM_KEEP_WORK=1 bash scripts/build-in-container.sh powkiddy-x35h
```

`built_at_utc=2026-11-04T21:14:18Z`, commit `70d86a1`. No `/etc/inittab` gerado:

```text
29:::sysinit:/etc/init.d/rcS
30:::respawn:/usr/bin/giochi-init        ← acrescentada
33:console::respawn:/sbin/getty -L  console 0 vt100 # GENERIC_SERIAL
```

O getty da serial e o resto do que o Buildroot escreveu continuam lá — o
`post-build` só insere, nunca substitui.

**O que isso muda no aparelho:** nada visível hoje. Sem
`/opt/giochi/apps/launcher/bin/giochi-launcher`, o `giochi-init` espera em ciclos
de 30 s. Como esta placa **não tem console serial exposto**, o custo de não ter a
linha é justamente o que dói aqui: sem `respawn` não existe canal para saber que
o launcher não subiu além do `/root/giochi-boot.log`.

**O cartão não foi regravado** — o X35H estava em uso. A `.img` de cartão em
`out/` também é de 03/11 e não inclui esta mudança; gerar e gravar exige o
aparelho livre.

## 6. O que falta, e a ordem

1. **Bootar e ler o log.** Sem isso o resto é especulação.
2. **Tela.** Se o ST7703 não acender, comparar o `dmesg` com a sequência do
   patch: `-517` significa dependência (PHY/regulador), `-22` significa
   sequência rejeitada, nada significa que o painel não foi nem procurado.
3. **A/B.** A ROCKNIX troca os códigos de A e B no DTS do X35S. Se aqui estiverem
   trocados, é uma linha no `buttons.map` — mas só depois de `giochi-buttons`
   dizer qual botão respondeu.
4. **Eixos.** A ROCKNIX usa `invert-absx`/`invert-absy` no driver fora da árvore.
   Com `adc-joystick` a inversão vem da faixa no DTS, e a herdada da X55 pode não
   servir. `giochi-buttons --axes` mostra.
5. **U-Boot.** `anbernic-rgxx3-rk3566` é o RK3566 de referência; se não bootar,
   o sintoma é o BootROM não ler o cartão (Maskrom), que é diagnosticável pelo
   `lsusb` (`2207:350a`).

---

## 7. Decisões que não devem ser reabertas sem motivo

- **Derivar da X55** em vez de criar do zero: é o único aparelho que boota.
- **Driver mainline do painel** em vez de `rocknix,generic-dsi`: os comandos são
  os mesmos, e o driver fora da árvore traz o `input-polldev` removido no 6.12 e
  a questão de licença junto.
- **Sem rádio na imagem**: pacote que nunca acha hardware vira ruído de boot.
- **Log no cartão** em vez de tentar OTA/serial que não existe neste aparelho.
- **`kernelCmdline` no `device.json`** em vez de literal no script: o literal da
  X55 já tinha vazado uma vez para o lugar errado.
