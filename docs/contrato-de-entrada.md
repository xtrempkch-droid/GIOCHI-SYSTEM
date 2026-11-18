# Contrato de entrada — o que é igual em todo aparelho, e o que não é

Resposta curta à pergunta que decide a arquitetura de qualquer jogo: **vou
precisar adaptar código por console?**

**Não — se o jogo abrir o controle virtual `Giochi Gamepad`.** Ele existe em
todo aparelho com o mesmo layout: 17 botões, 4 eixos em -32767..32767, num nó
só. Um caminho de leitura serve para todos, e aparelho novo não muda o jogo
(seção 0).

**Também não — se o jogo usar `SDL_GameController`,** desde que a imagem
carregue o virtual: ele é o nó único que o SDL2 exige, e o
`gamecontrollerdb.txt` faz `Button::A` coincidir com o `a` do mapa. Em imagem
anterior ao contrato (ou com o daemon parado), isso volta a variar por
aparelho.

**Sim, sempre — se o jogo abrir os nós físicos** (`gpio-keys`, `adc-joystick`,
`rocknix-joypad`) e assumir um formato único: aí o layout é o da placa, e o
resultado varia. Ver `AGENTS.md` §12.74 para o caso real que quebrou.

Este documento existe para que ninguém descubra isso do jeito caro: com o jogo
pronto e o aparelho na mão.

> **Para implementar**, o guia por stack (evdev, SDL_GameController,
> SDL_Joystick, engine e launcher) está em
> [`entrada-para-equipes.md`](entrada-para-equipes.md). Este documento é a
> referência do **contrato**; aquele é o **como fazer**.

---

## 0. A garantia: o controle virtual `Giochi Gamepad`

Desde 17/11/2026 o sistema publica **um** device de controle com layout fixo, e
traduz o hardware de cada placa para ele. É o que faz um jogo responder igual em
todo console sem uma linha de `if` por aparelho.

```text
        hardware de cada placa                    o que o jogo vê
  ┌──────────────────────────────┐
  │ R35S  um nó: 17 BTN + 4 eixos │──┐
  │ X55   dois nós: BTN | eixos   │──┼──▶  giochi-gamepad  ──▶  "Giochi Gamepad"
  │ X35H  dois nós: BTN | eixos   │──┘       (S52gamepad)        17 botões, códigos fixos
  │ <novo aparelho>: buttons.map  │                             4 eixos, -32767..32767
  └──────────────────────────────┘                             UM nó só
```

| O que o virtual garante | Por que importa |
| --- | --- |
| **um nó** com botões e eixos | é o que o `SDL_GameController` exige; sem isso o SDL não reconhece controle em aparelho de nós separados |
| **17 códigos fixos** | o mesmo `bN` significa a mesma coisa em todo console, mesmo quando o aparelho não tem o botão (X35H não tem `home`) |
| **4 eixos em -32767..32767** | uma fórmula de normalização serve para todos; o Y já sai desinvertido quando o hardware inverte |
| **`flat=32` nos quatro eixos** | folga de ruído de centro; a zona morta de **jogabilidade** continua sendo escolha do jogo |
| **GUID estável** | o SDL casa o mapeamento de `gamecontrollerdb.txt`, então `Button::A` é o `a` do mapa em todo aparelho |

**Aparelho novo não muda nada nos jogos.** Ele entra editando
`device/<pasta>/buttons.map`; o daemon lê esse mapa e o contrato continua.

Se o daemon não subir (sem `/dev/uinput`, mapa ausente), o aparelho volta ao
layout dele — e **o `giochi-selftest` reporta**, para não parecer que está tudo
bem. É a mesma regra do §12.15: falha explícita, nunca device pela metade.

---

## 1. O garantido: códigos evdev e o mapa

Todo aparelho com gamepad entrega **os mesmos códigos evdev** para os mesmos
botões do plástico:

| Função | `buttons.map` | Código evdev | Valor |
| --- | --- | --- | --- |
| direcional ↑ ↓ ← → | `up down left right` | `BTN_DPAD_UP/DOWN/LEFT/RIGHT` | 544-547 |
| A (à direita) | `a` | `BTN_EAST` | 305 |
| B (embaixo) | `b` | `BTN_SOUTH` | 304 |
| X (em cima) | `x` | `BTN_NORTH` | 307 |
| Y (à esquerda) | `y` | `BTN_WEST` | 308 |
| L1 / R1 | `l` `r` | `BTN_TL` / `BTN_TR` | 310 / 311 |
| L2 / R2 | `l2` `r2` | `BTN_TL2` / `BTN_TR2` | 312 / 313 |
| select / start | `select` `start` | `BTN_SELECT` / `BTN_START` | 314 / 315 |
| home | `home` | `BTN_MODE` | 316 |
| clique dos analógicos | `thumbl` `thumbr` | `BTN_THUMBL` / `BTN_THUMBR` | 317 / 318 |
| volume | `volup` `voldown` | `KEY_VOLUMEUP` / `KEY_VOLUMEDOWN` | 114 / 115 |

Medido no R35S em 17/11/2026 e conferido contra o DTS da X55 e do X35H. Os três
`buttons.map` do repositório usam exatamente esta tabela — a única exceção é o
**X35S**, que troca A/B de propósito (`a = BTN_SOUTH`), e o próprio arquivo diz
por quê.

O mapa vai para `/etc/giochi/buttons.map` em **toda** imagem
(`build-device.sh` copia; sem isso o mapa existiria no repositório e não no
aparelho).

Consequência prática: **um jogo que lê `/dev/input/event*`, traduz pelo mapa e
ignora código que não conhece funciona nos três sem uma linha de diferença.** É
o que o `cobrinha`, o `giochi-defender` e o `giochi-tower` fazem.

---

## 2. O que **varia no hardware cru** — e por isso o virtual existe

> Esta seção descreve o **hardware**, não o que o app vê. Um app que abre o
> `Giochi Gamepad` não encontra nenhuma destas diferenças; elas são a razão de
> o daemon existir e o que um app legado (que lê o físico) ainda precisa
> tratar.

### 2.1 Quantos nós de input existem, e o que tem em cada um

| Aparelho | Botões | Eixos | Nós |
| --- | --- | --- | --- |
| **R35S** | `rocknix-singleadc-joypad` | **o mesmo driver** | **1**: 17 botões + 4 eixos juntos |
| **X55** | `gpio-keys` | `adc-joystick` | **2**: 17 botões (0 eixos) + 4 eixos (0 botões) |
| **X35H** | `gpio-keys` | `adc-joystick` | **2**: idem |

Isso não é escolha nossa: é o que o DTS de cada placa declara, e o driver que a
mainline oferece. Unificar exigiria levar o `rocknix-joypad` (fora da árvore)
para a X55 — possível, mas é mudança de driver de hardware num aparelho que
hoje boota, e não se faz por conveniência de app.

### 2.2 No hardware cru, `SDL_GameController` funciona em um e não no outro

O SDL2 reconhece o nó como game controller quando **o mesmo nó** tem
`BTN_SOUTH` **e** eixos com `ABS_X`/`ABS_Y`
(`SDL_EVDEV_GuessDeviceClass` + `LINUX_JoystickGetGamepadMapping`).

| Aparelho | `gpio-keys` | `adc-joystick` | Algum vira gamecontroller? |
| --- | --- | --- | --- |
| R35S | — | — | **sim** (o nó único) |
| X55 | classe **0** — nem entra na lista | é joystick, **reprova** no `BTN_GAMEPAD` | **não** |
| X35H | idem | idem | **não** |

E registrar o GUID no `SDL_GameControllerDB` **não resolve** o X55: faria o
`adc-joystick` responder "sim" e o controle sairia com eixos e **nenhum botão**.
Um gamepad SDL não se monta colando dois nós.

**A solução é o device virtual da seção 0**, e não um ajuste de DB: em vez de
tentar ensinar o SDL a juntar dois nós, o sistema publica um nó só — que é o que
ele já sabe usar. Medido no host em 17/11/2026 com um layout igual ao da X55
(botões num nó, eixos noutro):

```text
SEM o daemon:  botões  -> SDL_IsGameController = SIM
               eixos   -> SDL_IsGameController = NAO    <- controle PELA METADE
COM o daemon:  "Giochi Gamepad" -> botões=17 eixos=4, gamecontroller SIM
```

O "pela metade" é o pior estado: um jogo que abre o gamecontroller recebe os
botões e **nenhum analógico**, sem erro nenhum.

Foi exatamente este o defeito do `neon-drift`: ele somava a máscara do SDL à do
evdev, o SDL achava um gamecontroller no R35S (`a` = `BTN_SOUTH` = o **B** do
plástico), e o mesmo botão acendia acelerar e frear. Na X55 o caminho SDL não
existia, então tudo funcionava — e ninguém viu o bug.

### 2.3 A faixa do analógico é diferente — e a inversão também

| Aparelho | Driver | Faixa | Invertido | Centro |
| --- | --- | --- | --- | --- |
| **R35S** | `rocknix-singleadc-joypad` | **-1800..1800** | não | 0 (mede -15) |
| **X55 / X35H** | `adc-joystick` (mainline) | **15..1023** | **Y e RY sim** (1023..15) | ≈519 |

Normalizar com a fórmula do outro aparelho não dá erro: dá **curso errado**, e o
sintoma (o carro não vira / puxa para um lado) parece física, não configuração.

Por isso o mapa do R35S passou a declarar a faixa medida em 17/11/2026 — antes
ele tinha **zero** linhas `axis_*`, e um app que calibrasse pelo mapa ficaria sem
calibração justamente no aparelho onde o driver já normaliza.

**O mapa é a fonte da verdade da calibração.** Quem quiser número novo mede com:

```bash
bash scripts/sdl-input-probe.sh r35s --run 10.55.0.2
```

Ele imprime `min`/`max`/`flat`/`fuzz`/valor de cada eixo, e marca `(INVERTIDO)`
quando `min > max`.

---

## 3. A regra que evita adaptação

> **Um mapa por aparelho, uma tradução, nenhum caminho alternativo.**

Com o device virtual, a regra fica concreta: **o jogo abre `Giochi Gamepad` e
para aí.** Ele não enumera `event*` procurando controle, não soma fontes e não
tem tabela de código por aparelho.

| Se o jogo usa | Ganha |
| --- | --- |
| `SDL_GameController` | `Button::A` = o `a` do mapa; eixos em -32767..32767 |
| `SDL_Joystick` | os mesmos 17 botões e 4 eixos, sem precisar de mapeamento |
| `evdev` em `/dev/input` | o virtual **e** o físico; ambos com a mesma transição |

A terceira linha é de propósito: o daemon não faz `EVIOCGRAB`, então `evtest`,
`giochi-buttons` e o selftest continuam funcionando com o serviço no ar — a
armadilha do §12.45 é ferramenta de diagnóstico que só funciona com o produto
desligado. E como as duas fontes emitem a **mesma** transição, aplicar as duas em
máscara de bits dá o mesmo estado.

1. **Abra o `Giochi Gamepad` pelo nome.** Os códigos dele são os do contrato, e
   não mudam por aparelho. Se o seu caso é ler o **físico**, aí sim leia
   `/etc/giochi/buttons.map` e nunca fixe código evdev — o X35S troca A/B, e
   amanhã outro aparelho pode trocar outra coisa.
2. **Ignore o que não conhece.** No virtual, o único código fora do contrato é
   ruído; no físico, há tecla de volume e power key. Um `if` que loga e segue
   custa uma linha; um `match` exaustivo quebra o jogo no aparelho novo.
3. **Não some duas fontes.** Se você tem caminho evdev e caminho SDL, escolha um
   por execução — nunca `bits_evdev | bits_sdl`. Foi a soma que criou o sintoma
   do §12.74: cada fonte estava "certa" sozinha.
4. **Se usar SDL, prefira `SDL_GameController` numa imagem com o virtual** — é o
   caminho que dá `Button::A` = o `a` do mapa, e funciona nos três aparelhos.
   `SDL_Joystick` cru também serve, mas aí a numeração `bN` é a ordem crescente
   dos códigos: `b0` é o `b`, não o `a`.
5. **Escala de analógico vem do mapa** — e só se você lê o físico. Pelo virtual
   a faixa é sempre -32767..32767.

O item 3 é o que mais importa e o mais fácil de violar sem perceber: somar parece
defensivo ("uso o que tiver"), e é justamente o que produz o botão com duas
funções.

---

## 4. Pendências deste contrato

| Item | Estado |
| --- | --- |
| `giochi-gamepad` na imagem | código, serviço, kernel, mapeamento **e o fix do `SYN_REPORT`** (§12.75) prontos; as imagens do run `44184129584` têm o virtual mas são anteriores ao fix — **rebuild obrigatório** antes de gravar |
| `js0` em todo aparelho | `CONFIG_INPUT_JOYDEV=y` nos três desde `4018875`; **não está em nenhuma imagem gravada ainda** — as duas imagens são anteriores |
| prova de entrega | `scripts/entrada-probe.py` roda no PC (device sintético via `uinput`) e reprova quando o evento não chega; `giochi-selftest` **não** substitui isso, porque confere o nó e as capabilities |
| multi-controle | não suportado: o daemon funde todos os físicos num único virtual (jogador 2 entra como jogador 1) |
| faixa do analógico do X35H | não medida no aparelho (o mapa herda o da X55, mesma arquitetura) |
| `rocknix-joypad` na X55 | não empacotado para ela; unificaria os nós, mas é mudança de driver |
| jogo de referência sem mapa fixo | nenhum dos jogos do `GIOCHI-GAMES` serve de exemplo hoje — o `neon-drift` é o caso de estudo do que não fazer (§12.74) |

---

## A quem este contrato foi comunicado

| Equipe | Issue | O pedido, em uma linha |
| --- | --- | --- |
| **jogos** | `GIOCHI-GAMES#1` e `#2` | não somar fontes de input; mirar `Giochi Gamepad` |
| **app** | `GIOCHI-APP#1` | preferir o virtual na enumeração; o analógico tem faixa única |
| **OS** | `GIOCHI-OS#1` | documentar na junção **e** verificar que a imagem carrega |

Os corpos por equipe estão versionados em
[`issues-para-outros-repos/`](issues-para-outros-repos/README.md), com o estado de
cada um. As duas primeiras (`GAMES#1`, `#2`) estão completas e corretas; as do
APP e do OS foram criadas com o texto trocado e precisam de substituição manual.

## Como verificar em um aparelho novo

```bash
# 1. o que o KERNEL classificou
bash scripts/input-diag.sh

# 2. o que o SDL2 vê, e com qual mapeamento
bash scripts/sdl-input-probe.sh <device> --run 10.55.0.2

# 3. o mapa que foi para a imagem
cat /etc/giochi/buttons.map
```

Se o item 3 não tiver `axis_*` e o aparelho tiver analógico, o mapa está
incompleto — meça com o item 2 e preencha, porque app nenhum consegue calibrar
sem esse dado.
