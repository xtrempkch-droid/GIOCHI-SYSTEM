# Giochi System v0.2.0

Primeira versão com **dois handhelds habilitados** e o primeiro build completo
dos três aparelhos em **Buildroot 2025.02**.

```text
tag     v0.2.0
base    main @ e3b72b8
data    15/11/2026
```

## O que mudou desde a v0.1.1

### Aparelhos

| Aparelho | Estado nesta versão |
| --- | --- |
| `qemu-aarch64` | habilitado — é o smoke test do pipeline |
| `powkiddy-x55` | habilitado — **áudio, Wi-Fi, BT, 16 botões + 4 eixos** medidos em hardware |
| `r35s` | **habilitado nesta versão** — tela, 16 botões + 4 eixos, **áudio**, GPU, bateria e térmica |
| `powkiddy-x35h` | draft — boota com tela 640×480, `usb0` e SSH |
| `powkiddy-x35s`, `steamdeck`, `generic-x64` | draft |

### Áudio do RK817: o `Playback Mux` é `HP`, e isso é medido, não deduzido

Esta é a correção que fecha o áudio do R35S, e ela derrubou uma afirmação que
estava no repositório desde a §12.52.

O `SPKO` e o `HPOL` do RK817 são **o mesmo pino** — o próprio driver diz, em
`sound/soc/codecs/rk817_codec.c`:

```c
/* Since the speaker output and L headphone pin are internally the same, make
 * audio path mutually exclusive with a mux. */
```

O mux não escolhe o destino, escolhe o **estágio**: `HP` = analógico de fone,
`SPK` = class-D. Rota de DTS não decide isso, e a versão anterior deduzia `SPK`
do `"Speaker -> SPKO"` — resultado: PCM em `RUNNING`, DAPM todo `On`,
registradores corretos, e **silêncio**.

Medido no aparelho:

```text
amixer -c 0 sset 'Playback Mux' SPK   → silêncio
amixer -c 0 sset 'Playback Mux' HP    → SOM
```

O valor passou a ser **declarado por aparelho** em `/etc/giochi/asound.state`,
aplicado pelo `S51mixer` no boot, e o `giochi-selftest` compara com o declarado —
nunca com o DTS.

### GPU: o 3D deixou de ser `SKIP`

`BR2_PACKAGE_KMSCUBE=y` nos três aparelhos com GPU. O `giochi-selftest` passou a
provar o desenho em vez de inferir do driver:

```text
[PASS] driver de GPU reconhecido: panfrost
[PASS] kmscube rodou: Mali-G31 (Panfrost) (EGL/GLES + scanout OK)
```

A decisão é pelo **`GL_RENDERER`**, não pelo código de saída: sem panfrost o Mesa
responde a mesma `GL_VERSION` com `renderer: softpipe`, então exit code não
distingue GPU de CPU.

### Dez idiomas: as fontes que faltavam

O launcher tem os dez idiomas do site e desenha **por string**. Faltavam três
escritas:

| Escrita | Como | Custo |
| --- | --- | --- |
| CJK (zh, ja, ko) | `BR2_PACKAGE_WQY_ZENHEI=y` nos três defconfigs | alguns MB, já na árvore do Buildroot |
| devanágari (hi) | `NotoSansDevanagari-Regular.ttf` versionada no overlay | 244 KB |
| bengali (bn) | `NotoSansBengali-Regular.ttf` versionada no overlay | 143 KB |

Ambas com a licença OFL ao lado. O `tests/fontes-idiomas.test.mjs` lê a tabela
`cmap` de verdade e responde "este código tem glifo?", que é a mesma pergunta do
`--fontes` do launcher — presença de arquivo e cobertura de escrita não são a
mesma coisa.

### Sistema base

- **`kmod` (`modinfo`, `depmod`, `modprobe` com `modules.dep.bin`)** nos três
  aparelhos. O `modprobe` do busybox não resolve dependência nem softdep.
- **`CONFIG_UHID=y` na X55** — sem `/dev/uhid` o BlueZ não cria dispositivo HID
  para controle **BLE**: pareia, conecta e nunca vira `/dev/input/event*`.
- `CONFIG_BT_HIDP=m` explícito no fragmento da X55, em vez de herança silenciosa
  do defconfig arm64.

### Diagnóstico

O `giochi-selftest` parou de mentir em quatro pontos, todos medidos no aparelho:

| Antes | Agora |
| --- | --- |
| `[FAIL] kmscube falhou` com a GPU funcionando | `[PASS] kmscube rodou: Mali-G31` |
| linha de erro no `stderr` a cada execução | `stderr` com **0 linha** |
| `[PASS] bateria: 0%` num aparelho sem célula | `[WARN] bateria AUSENTE (present=0)` |
| `[FAIL] Playback Mux = SPK` no aparelho que tocava em `HP` | compara com o declarado |

## Artefatos

| Aparelho | Pacote | Imagem de cartão |
| --- | --- | --- |
| `qemu-aarch64` | ~54 MB | — |
| `powkiddy-x55` | ~153 MB | 2,0 GiB |
| `r35s` | ~135 MB | 2,0 GiB |

Cada `sd.img` é **2,0 GiB** e cresce no cartão com `flash-sd.sh --grow`. O
`u-boot-rockchip.bin` está no setor 64 e o `extlinux.conf` tem `timeout 30` e
**não** tem `menu title` — sem o timeout o aparelho para em `Enter choice:` para
sempre, que num handheld é indistinguível de "não ligou".

## O que foi provado, e onde

| Afirmação | Onde foi medida |
| --- | --- |
| Boot até o login | R35S, X55, X35H — hardware real |
| Áudio pela cadeia inteira | R35S: `PCM RUNNING` durante o tom, mux `HP`, volume 100% |
| GPU desenha | R35S: `kmscube` → `Mali-G31 (Panfrost)` |
| 16 botões + 4 eixos | R35S (`r36s_Gamepad`), X55 (`gpio-keys-control`) |
| Wi-Fi e Bluetooth | X55 (`wlan0` com MAC real, `hci0` com firmware) |
| Rede por cabo USB | R35S e X55: `10.55.0.2` com SSH |
| Bateria e térmica | R35S: `power_supply` e `thermal_zone0/1` |
| Pipeline completo | CI verde nos **três** aparelhos (run de `ad35151e`) |

## O que **não** foi provado nesta versão

Isto é a parte que importa tanto quanto a de cima:

- **O `--fontes` do launcher não rodou com a imagem nova.** As fontes estão
  verificadas glifo por glifo **nas extraídas do `rootfs.ext4`** (cmap lido das
  próprias fontes da imagem: zh/ja/ko 100%, hi 6/6, bn 5/5, e 0/9 em latim, que
  é o controle negativo correto), e moram nos diretórios que o `DIRETORIOS_FONTE`
  do app lista. Mas a execução do app no aparelho é a prova final.
- **O áudio da X55 com a imagem 2025.02 não foi medido.** O áudio do R35S foi. A
  X55 tocou numa imagem de Buildroot 2024.02; os símbolos do codec são os mesmos,
  mas "os mesmos símbolos" não é medição.
- **O `CONFIG_UHID` não foi exercitado com controle BLE de verdade.** O que está
  provado é que o símbolo entrou no kernel e que `/dev/uhid` existe.
- **A `.img` do X55 não foi gravada em cartão** nesta versão.
- **`lsblk` continua ausente** por escolha: `BR2_PACKAGE_UTIL_LINUX_BINARIES`
  custaria ~40 utilitários para servir a um diagnóstico, e o `giochi-selftest`
  tem reserva que funciona.

## Instalação

```bash
# gravar (o cartão é apagado por inteiro)
bash scripts/flash-sd.sh out/<device>/giochi-system-<device>-sd.img /dev/sdX \
     --expect-gib <tamanho-do-cartão> --grow

# conferir no aparelho
ssh root@10.55.0.2 giochi-selftest
```

O aparelho atende em **`10.55.0.2`** pelo cabo USB, com o PC em `10.55.0.1` por
DHCP. Com mais de um handheld plugado o endereço é ambíguo: o discriminante é o
serial USB (`/sys/bus/usb/devices/*/serial`), não o IP.
