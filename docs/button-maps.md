# Mapas de botões

Cada aparelho tem `device/<pasta>/buttons.map`: a tradução de **nome lógico → código
evdev**. O launcher lê `/etc/giochi/buttons.map` já resolvido, e não precisa saber
qual aparelho é.

## A fonte da verdade é o DTS

Não existe banco de dados público com códigos evdev destes aparelhos. O DTS é o
banco de dados.

O mapa sai dos nós `gpio-keys` do device tree:

```dts
button-a {
    gpios = <&gpio3 RK_PD3 GPIO_ACTIVE_LOW>;
    label = "EAST";
    linux,code = <BTN_EAST>;      ← isto é o que vai para o mapa
};
```

Conferir com:

```bash
dtc -I dtb -O dts /boot/rk3566-powkiddy-x55.dtb | grep -A3 'linux,code'
```

No aparelho, `evtest /dev/input/eventN` mostra os códigos reais ao apertar cada
botão. **É a única prova definitiva** — o DTS diz o que o kernel registra; o
`evtest` diz o que chega.

## Bancos públicos que existem — e por que não servem

| Base | Formato | Serve? |
| --- | --- | --- |
| [retroarch-joypad-autoconfig](https://github.com/libretro/retroarch-joypad-autoconfig) | `input_a_btn = "0"` — **índice** de botão | **não** |
| SDL_GameControllerDB | GUID + nome/índice | **não** |
| ROCKNIX / JELOS | DTS do kernel + driver `rocknix-joypad` | **sim** — é DTS |
| HandheldWiki / rocknix.org | lista de aparelhos suportados | só para descobrir nomes |

As duas primeiras mapeiam para **índice de joystick**, não para código evdev. Não há
conversão: o índice depende da ordem em que o driver registra os botões. Servem para
descobrir a **semântica** (qual é o A), não o código.

ROCKNIX é a fonte útil: mantém DTS por aparelho para os mesmos SoCs. É de lá que
saem os mapas dos aparelhos sem suporte upstream.

## O que o DTS da X55 revelou

### 1. Não existe botão HOME

O nó `gpio-keys-control` da X55 registra 16 botões e **nenhum é `BTN_MODE`**.

O mapa do antecessor declarava `home = BTN_MODE` como **obrigatório**. Nenhum botão
emite esse código na X55.

**Consequência:** `home` não pode ser obrigatório. Quem depender dele precisa de
alternativa (combo START+SELECT, ou o menu de energia pelo START).

### 2. O `[default]` do antecessor não bate com a X55

| Botão | DTS da X55 | Antecessor `[default]` | Antecessor `[x35s]` |
| --- | --- | --- | --- |
| x | `BTN_NORTH` | `BTN_WEST` ✗ | `BTN_NORTH` ✓ |
| y | `BTN_WEST` | `BTN_NORTH` ✗ | `BTN_WEST` ✓ |

A seção `[default]` do antecessor **não corresponde à X55**; quem corresponde é a
`[x35s]`. Ou as seções estão trocadas, ou `[default]` mirava outro aparelho.

**Consequência:** não confiar no `[default]` do antecessor. Cada mapa tem de vir do
DTS do próprio aparelho.

### 3. Os analógicos são ADC, e a faixa é conhecida

`adc-joystick` no `saradc`, quatro canais:

| Canal | Eixo | Faixa |
| --- | --- | --- |
| 0 | `ABS_X` | 15 → 1023 |
| 1 | `ABS_Y` | 1023 → 15 (invertido) |
| 2 | `ABS_RX` | 15 → 1023 |
| 3 | `ABS_RY` | 1023 → 15 (invertido) |

`abs-flat = 30`, `abs-fuzz = 20`, `poll-interval = 60 ms`. Centro ≈ 519.

**Isso dispensa ioctl `EVIOCGABS`**: a faixa está no DTS, então pode morar no
arquivo do aparelho. Normalizar é `(valor - centro) / meia_faixa`.

### 4. Volume é tecla, não mixer

`gpio-keys-vol` registra `KEY_VOLUMEUP` (gpio4 PA5) e `KEY_VOLUMEDOWN` (gpio4 PA3),
com `autorepeat`.

São **eventos de teclado**: o kernel emite, e nada muda o volume sozinho. Alguém
precisa traduzir `KEY_VOLUMEUP` → mixer ALSA. Sem servidor de som, isso é do launcher
ou do `giochi-init`.

Consequência boa: o botão existe e o código é conhecido. Consequência ruim: alguém
tem de tratá-lo, senão o botão não faz nada.

## Formato do arquivo

```ini
# comentário
up      = BTN_DPAD_UP
a       = BTN_EAST
volup   = KEY_VOLUMEUP

axis_x_min = 15
axis_x_max = 1023
axis_deadzone = 30
```

- Mapa **plano**: uma linha por nome. O sistema resolve o aparelho; o launcher lê
  sem seções.
- Nomes de botão: os 13 do contrato, mais `l2`, `r2`, `thumbl`, `thumbr`, `volup`,
  `voldown`.
- Linhas `axis_*` carregam a faixa do analógico daquele aparelho.

## Situação dos mapas

| Aparelho | SoC | Fonte do mapa | Confiança |
| --- | --- | --- | --- |
| `powkiddy-x55` | RK3566 | DTS real (`gpio-keys`) | **alta** |
| `powkiddy-x35s` | RK3566 | herdado do antecessor | média — não conferido |
| `powkiddy-x35h` | RK3566 | igual ao X35S | média — variantes não diferenciadas |
| `r35s` | RK3326 | códigos do DTB oficial (doc do repo Ouvila §9.5) | média-alta — 17 botões, sem `evtest` |
| `qemu-aarch64` | virtual | — | não tem botão |
| `steamdeck` | x86_64 | — | fora do escopo ARM64 |

## Nem todo aparelho usa `gpio-keys`

Isso muda a ferramenta necessária:

| Aparelho | Como os botões chegam |
| --- | --- |
| X55 | `gpio-keys` — um nó por botão, `linux,code` em cada |
| **R35S/R36S** | **`rocknix-singleadc-joypad`** — 17 botões por **multiplexador de ADC** |

`scripts/dtb-buttons.mjs` entende `gpio-keys` e `adc-joystick`. Ele **não** entende
`rocknix-singleadc-joypad`, e para esse caso não acharia botão nenhum.

Para o R35S os códigos vieram da documentação que já os tinha lido do DTB
(`docs/r35s-rk3326.md` §9.5 do repositório Ouvila), não do parser. Conferir com
`evtest` é obrigatório antes de confiar.

**E o mais importante:** `rocknix-singleadc-joypad` é driver **fora da árvore**.
Sem ele compilado, os códigos não existem — nenhum botão funciona. O mesmo vale
para o painel: esta placa não tem DTS no mainline.

## Por que o R35S não pode herdar mapa de RK3566

É outro SoC, outro driver e outra placa. Preencher por analogia daria botão
trocado, que é pior que botão sem mapa: o usuário vê a ação errada e não descobre
que a causa é o mapa.

## Como adicionar um aparelho

1. Obter o DTS do aparelho (upstream, ROCKNIX, ou dump do DTB).
2. Localizar os nós `gpio-keys` e `adc-joystick`.
3. Extrair `linux,code` de cada botão e a faixa de cada eixo.
4. Escrever `device/<pasta>/buttons.map`.
5. Conferir no aparelho com `evtest` — **o DTS diz o que o kernel registra; só o
   `evtest` diz o que chega.**
6. Se algo não bater, corrigir o mapa, não o DTS.

## Pendências

- **DTB/DTS dos aparelhos reais**: o usuário vai enviar. Quando chegar, o caminho é
  §"Como adicionar um aparelho" — extrair `linux,code`, preencher `buttons.map`,
  confirmar com `evtest`. Vale para X35S, X35H e R35S.
- **X35S/X35H**: `buttons.map` herdado do antecessor como provisório. Substituir
  pelo que o DTS mandar.
- **R35S**: `buttons.map` vazio até o DTS chegar. É RK3326 — não reaproveitar os
  códigos dos RK3566.
- **rk3326-generic** e **rk3566-generic**: não existem como pasta ainda.
- **qemu-aarch64** e **steamdeck**: sem `buttons.map` — o primeiro não tem botão, o
  segundo não está no escopo ARM64.
- Nenhum mapa foi confirmado com `evtest`, e só o da X55 vem de DTS de verdade.
