## Resumo

O GIOCHI-SYSTEM passou a publicar **um controle virtual com layout fixo** (`Giochi Gamepad`), e isso é um **contrato de entrada** que a junção precisa documentar e garantir.

Duas coisas concretas para este repo:

1. **documentar** o contrato em `docs/juncao.md` (hoje ele descreve as duas fases de composição e não fala de entrada);
2. **garantir que a imagem carrega** as peças, porque sem elas o contrato **não existe** e ninguém percebe — o aparelho volta ao layout dele e o sintoma é "um jogo funciona e outro não".

## O problema que o contrato resolve

Medido em 17/11/2026, e é o que motivou tudo:

| Aparelho | Como os botões chegam | O `SDL_GameController` reconhece? |
| --- | --- | --- |
| R35S | um nó: 17 botões + 4 eixos (`rocknix-singleadc-joypad`) | **sim** |
| X55 | dois nós: `gpio-keys` (17 botões, 0 eixos) + `adc-joystick` (4 eixos, 0 botões) | **não** |
| X35H | idem X55 | **não** |

O SDL2 exige `BTN_SOUTH` **e** `ABS_X`/`ABS_Y` no **mesmo** nó. O DTS mainline da X55 separa os dois, e registrar o GUID no DB não resolve — o controle sairia com eixos e **nenhum botão**.

Consequência que chegou ao usuário: o mesmo jogo respondia com os botões trocados no R35S e certo na X55. Cada jogo precisaria de um `if` por console — não escala para o próximo aparelho.

## O que o sistema passou a fazer

```text
  hardware de cada placa                     o que qualquer app vê
  R35S   um nó: 17 BTN + 4 eixos  ──┐
  X55    dois nós: BTN | eixos    ──┼──▶  "Giochi Gamepad"  (S52gamepad)
  X35H   dois nós: BTN | eixos    ──┘     17 botões · 4 eixos em -32767..32767
```

| Peça | Onde | Papel |
| --- | --- | --- |
| `giochi-gamepad` | `/usr/bin/` | traduz o hardware de cada placa para o layout do contrato |
| `S52gamepad` | `/etc/init.d/` | sobe com supervisão (daemon morto devolve o aparelho ao layout dele, em silêncio) |
| `gamecontrollerdb.txt` | `/etc/giochi/` | faz o `Button::A` do SDL ser o `a` do mapa (`a:b1`) |
| `SDL_GAMECONTROLLERCONFIG` | exportado pelo `giochi-init` | para todo app SDL herdar o mapeamento |
| `CONFIG_INPUT_UINPUT=y` | fragmento **e** `kernel-required.txt` dos três | sem ele não há device virtual |

## O que pedimos ao GIOCHI-OS

### 1. Documentar o contrato na junção

`docs/juncao.md` descreve as duas fases (apps → overlay, system → imagem). Falta a parte que responde *"o que um app pode esperar do aparelho?"*. Sugestão de seção:

- o device `Giochi Gamepad` existe em **todo** aparelho, com 17 botões e 4 eixos em -32767..32767;
- `/etc/giochi/buttons.map` é a fonte da verdade da calibração e dos códigos;
- aparelho novo entra editando o mapa, **sem tocar em app**;
- a referência completa está em `docs/contrato-de-entrada.md` do GIOCHI-SYSTEM.

O valor de ter isso na junção: quem integra um app novo lê **um** documento, e não descobre o comportamento lendo três repos.

### 2. Garantir que a imagem carrega as peças

Isto é o item que falha em silêncio. Se a imagem sair sem `S52gamepad` ou sem `CONFIG_INPUT_UINPUT`:

- o aparelho continua bootando;
- os jogos continuam abrindo;
- e cada um responde no formato daquele aparelho — **sem erro em lugar nenhum**.

É a mesma classe de defeito que o GIOCHI-SYSTEM já documenta como "verde e errado".

Verificação barata depois de compor a imagem:

```bash
# dentro do rootfs da imagem
test -x /usr/bin/giochi-gamepad          || echo "FALTA o daemon"
test -x /etc/init.d/S52gamepad           || echo "FALTA o serviço"
test -f /etc/giochi/gamecontrollerdb.txt || echo "FALTA o mapeamento"
```

E, no aparelho:

```bash
/etc/init.d/S52gamepad status     # processo + device virtual
```

### 3. `verificar-mapa.mjs` pode conferir a faixa

O `GIOCHI-APP` já tem `scripts/verificar-mapa.mjs`, que valida um `buttons.map` contra o tradutor do launcher. Se ele roda na junção, vale acrescentar: **aparelho com `axis_*` declarado é melhor que sem**, e o R35S ficou sem até 17/11/2026 (mapa sem calibração = calibração implícita errada).

## O que **não** muda

- O formato do `buttons.map` é o mesmo.
- As duas fases de composição são as mesmas.
- Nenhum app precisa mudar para a junção funcionar — é documentação + verificação.

## Contexto

- `AGENTS.md` §12.74 (o defeito medido) e §29 (o virtual) do GIOCHI-SYSTEM
- `docs/contrato-de-entrada.md` do GIOCHI-SYSTEM — a referência completa
- O mesmo contrato, nos outros dois repos: `GIOCHI-GAMES#2` (aberta) e
  `GIOCHI-APP#2` (aberta). A issue equivalente deste repo foi **deletada** em
  algum momento entre 20 e 26/11/2026 — esta é a única cópia do pedido.
