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
| SHA256 | `9f1a7d370b9be3777f812c08f93aca6b3ac3e082809f8efc8ec0b33d43949ded` |
| Cartão | `Multi-Reader -3`, 29.7 GiB (slot 4 do leitor; os outros três vazios) |
| Conferência | SHA256 relido **do cartão** depois da gravação — confere |
| Estrutura no cartão | idbloader `RKNS` no setor 64, FIT `d00dfeed` no setor 16384, p1 em LBA 131072 |

O `--expect-gib 30` do `flash-sd.sh` não é enfeite: um leitor Multi-Reader
expõe **quatro** discos e três deles medem `0.0 GiB`. Sem a guarda, o cartão
errado é uma escolha de uma letra. É o mesmo cenário do `AGENTS.md` §12.8, que
já custou uma gravação no lugar errado neste projeto.

O cartão já tinha rótulos de uma gravação anterior (`GIOCHI_BOOT` + `rootfs`),
então é mídia de teste descartável — nada de valor foi perdido ao sobrescrever.

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
