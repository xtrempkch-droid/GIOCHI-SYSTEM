# Entrada para as equipes — como ler os botões agora

> **Para:** `Giochi app` (launcher), `Giochi games`, `Giochi engine` (2D/3D) e
> `Giochi os`.
> **Data:** 18/11/2026.
> Este é o **guia de implementação**. A referência completa — com as medições,
> o porquê de cada decisão e o que **não** funciona — é
> [`contrato-de-entrada.md`](contrato-de-entrada.md). O histórico do defeito
> que motivou tudo está no `AGENTS.md` §12.74 e §29.

## 0. O que mudou, em uma frase

O sistema passou a publicar **um controle virtual** chamado **`Giochi Gamepad`**,
com layout fixo: **17 botões** nos mesmos códigos e **4 eixos** na mesma faixa,
num **único nó** de `/dev/input`. Ele traduz o hardware de cada placa para esse
layout.

```text
        hardware de cada placa                      o que o app vê
  ┌──────────────────────────────┐
  │ R35S  um nó: 17 BTN + 4 eixos │──┐
  │ X55   dois nós: BTN | eixos   │──┼──▶  "Giochi Gamepad"  (S52gamepad)
  │ X35H  dois nós: BTN | eixos   │──┘     17 botões · 4 eixos
  │ <novo aparelho>: buttons.map  │        -32767..32767 · um nó só
  └──────────────────────────────┘
```

**Consequência:** um jogo ou app que abra esse nó **não precisa de `if` por
console**. Aparelho novo entra editando `device/<pasta>/buttons.map`; nenhum
app muda.

| Antes (até 17/11/2026) | Agora (no código; ver seção 5 para o que já está em imagem) |
| --- | --- |
| cada placa expunha os botões do seu jeito | um nó virtual com o layout do contrato |
| `SDL_GameController` só existia no R35S | existe nos três aparelhos |
| `Button::A` do SDL era o botão de **baixo** | é o `a` do mapa, o botão da **direita** |
| cada jogo precisava de tabela por aparelho | uma tabela só, a do contrato |

O físico **continua legível**: o daemon não faz `EVIOCGRAB`. `evtest`,
`giochi-buttons` e o selftest funcionam com o serviço no ar. Por isso existem
**duas fontes** — e a regra de ouro é: **use uma só**.

---

## 1. O contrato — o que você pode assumir

### 1.1 O device

| Propriedade | Valor |
| --- | --- |
| nome | **`Giochi Gamepad`** |
| nó | um `/dev/input/eventN` (o número varia por boot) |
| botões | **17** códigos fixos, todos declarados mesmo quando o plástico não tem o botão |
| eixos | **4**: `ABS_X`, `ABS_Y`, `ABS_RX`, `ABS_RY` |
| faixa dos eixos | **-32767..32767**, centro **0** |
| zona morta declarada | `flat=32` e `fuzz=32` (ruído de centro; não é zona morta de jogo) |
| GUID do SDL | `06005931091200000100000001000000` |
| serviço | `/etc/init.d/S52gamepad` (sobe no `rcS`, antes do launcher) |

### 1.2 Os 17 botões

| Função | nome no `buttons.map` | código canônico |
| --- | --- | --- |
| A (à direita) | `a` | `BTN_EAST` (305) |
| B (embaixo) | `b` | `BTN_SOUTH` (304) |
| X (em cima) | `x` | `BTN_NORTH` (307) |
| Y (à esquerda) | `y` | `BTN_WEST` (308) |
| L1 / R1 | `l` `r` | `BTN_TL` / `BTN_TR` (310 / 311) |
| L2 / R2 | `l2` `r2` | `BTN_TL2` / `BTN_TR2` (312 / 313) |
| select / start | `select` `start` | `BTN_SELECT` / `BTN_START` (314 / 315) |
| home | `home` | `BTN_MODE` (316) |
| clique dos analógicos | `thumbl` `thumbr` | `BTN_THUMBL` / `BTN_THUMBR` (317 / 318) |
| direcional | `up` `down` `left` `right` | `BTN_DPAD_*` (544-547) |

**Volume não está no virtual.** `KEY_VOLUMEUP` / `KEY_VOLUMEDOWN` continuam no
nó físico `gpio-keys-vol` (um teclado, por definição). Não trate volume como
botão de gamepad.

### 1.3 Os 4 eixos

| eixo | código | no virtual |
| --- | --- | --- |
| esquerdo horizontal | `ABS_X` | -32767..32767, centro 0 |
| esquerdo vertical | `ABS_Y` | idem, já **desinvertido** quando o hardware inverte |
| direito horizontal | `ABS_RX` | idem |
| direito vertical | `ABS_RY` | idem |

**Quem lê o virtual não calibra e não inverte nada.** A normalização e a
inversão são do sistema.

---

## 2. Como implementar

### 2.1 Se o seu app lê `evdev` (C, Rust, Go, Python…)

Abra **pelo nome**, nunca pelo índice. O número do `eventN` muda entre boots e
entre aparelhos.

```c
/* Precisa de <fcntl.h>, <unistd.h>, <string.h>, <sys/ioctl.h> e <linux/input.h> */
static int abrir_gamepad(void) {
    for (int i = 0; i < 32; i++) {
        char caminho[64];
        snprintf(caminho, sizeof caminho, "/dev/input/event%d", i);
        int fd = open(caminho, O_RDONLY | O_NONBLOCK);
        if (fd < 0) continue;
        char nome[256] = {0};
        if (ioctl(fd, EVIOCGNAME(sizeof nome - 1), nome) > 0 &&
            strcmp(nome, "Giochi Gamepad") == 0) {
            return fd;
        }
        close(fd);
    }
    return -1;
}
```

No laço de eventos:

```c
struct input_event ev[64];
ssize_t n = read(fd, ev, sizeof ev);
for (int i = 0; i < n / (int)sizeof ev[0]; i++) {
    if (ev[i].type == EV_KEY) {
        /* ev[i].code é um BTN_* do contrato; value 0/1 */
    } else if (ev[i].type == EV_ABS) {
        /* ev[i].value já está em -32767..32767 */
    }
    /* EV_SYN/SYN_REPORT fecha o pacote — o virtual emite. */
}
```

Regras:

1. **Ignore código que não conhece.** Volume, power e ruído não estão no
   contrato. Um `default: continue` custa uma linha; um `match` exaustivo
   quebra no aparelho novo.
2. **Não abra o físico junto com o virtual** se você só quer o contrato. Os
   dois emitem a mesma transição, mas o virtual já é a tradução — ler os dois
   conta dobrado qualquer coisa que não seja máscara de bits.
3. **Não fixe os códigos do físico no jogo.** O X35S troca A/B de propósito
   (`a = BTN_SOUTH`); o mapa dele diz isso. Quem lê o virtual não vê a
   diferença; quem lê o físico tem de ler o mapa.

### 2.2 Se o seu app usa `SDL_GameController`

**Numa imagem construída depois de 18/11/2026, funciona nos três aparelhos.**
O virtual tem `BTN_SOUTH` **e** `ABS_X`/`ABS_Y` no mesmo nó — os dois portões
que o SDL2 exige. (Imagens anteriores a essa data têm o nó, mas não entregam
evento; ver a seção 4.)

O `giochi-init` exporta `SDL_GAMECONTROLLERCONFIG` antes de subir o launcher,
então **os filhos herdam o mapeamento**:

```text
Button::A  = o `a` do buttons.map = o botão da DIREITA
Button::B  = o `b` do buttons.map = o botão de BAIXO
```

Duas coisas que **não** se deve fazer:

- **abrir por índice** (`SDL_GameControllerOpen(0)`): no R35S o nó físico
  também é um gamecontroller, então o SDL pode ver **dois** (o físico e o
  virtual). Abra pelo nome;
- **somar** o estado do SDL com o estado do seu caminho evdev. Use um só.

```c
/* Abre o device do contrato, e não "o primeiro que aparecer" */
static int achar_contrato(void) {
    for (int i = 0; i < SDL_NumJoysticks(); i++) {
        if (!SDL_IsGameController(i)) continue;
        const char *nome = SDL_GameControllerNameForIndex(i);
        if (nome && strcmp(nome, "Giochi Gamepad") == 0)
            return i;
    }
    return -1;
}
```

Medido no host em 18/11/2026, com o físico e o virtual presentes: o SDL vê
**dois** gamecontrollers. O virtual mapeia `a:b1` (`Button::A` = `BTN_EAST`);
o físico, sem o DB, mapeia `a:b0` (`Button::A` = `BTN_SOUTH`). Abrir por
índice escolhe um dos dois — e o resultado muda.

Se o app puder ser iniciado **fora** da árvore do `giochi-init` (shell, SSH,
teste), carregue o mapeamento você mesmo antes de abrir:

```c
/* Fallback: o init não exportou a variável */
if (!getenv("SDL_GAMECONTROLLERCONFIG")) {
    FILE *f = fopen("/etc/giochi/gamecontrollerdb.txt", "r");
    char linha[512];
    while (f && fgets(linha, sizeof linha, f)) {
        if (linha[0] == '#' || linha[0] == '\n') continue;
        linha[strcspn(linha, "\r\n")] = '\0';
        SDL_GameControllerAddMapping(linha);
    }
    if (f) fclose(f);
}
```

Detalhes de semântica:

| Você pede | Recebe |
| --- | --- |
| `SDL_CONTROLLER_BUTTON_A` | o `a` do mapa (direita) |
| `SDL_CONTROLLER_BUTTON_B` | o `b` do mapa (baixo) |
| `SDL_CONTROLLER_BUTTON_BACK` | `select` |
| `SDL_CONTROLLER_BUTTON_START` | `start` |
| `SDL_CONTROLLER_BUTTON_GUIDE` | `home` (pode nunca disparar: o X35H não tem o botão) |
| `SDL_CONTROLLER_AXIS_LEFTX/LEFTY` | -32767..32767 (é a faixa declarada pelo kernel) |
| `SDL_CONTROLLER_AXIS_TRIGGERLEFT/RIGHT` | **digital**: L2/R2 são botões no contrato |

Trate `SDL_CONTROLLERDEVICEADDED` e reabra pelo nome se o controle aparecer
depois do boot. O virtual nasce no `rcS`; um app que suba antes dele (raro,
mas possível em teste) precisa esperar.

### 2.3 Se o seu app usa `SDL_Joystick` cru

O `SDL_Joystick` não precisa de mapeamento — os índices `bN` seguem a **ordem
crescente dos códigos evdev** que o device declara. No virtual:

| SDL | função | código |
| --- | --- | --- |
| `b0` | `b` (embaixo) | `BTN_SOUTH` |
| `b1` | `a` (direita) | `BTN_EAST` |
| `b2` | `x` (cima) | `BTN_NORTH` |
| `b3` | `y` (esquerda) | `BTN_WEST` |
| `b4` / `b5` | L1 / R1 | `BTN_TL` / `BTN_TR` |
| `b6` / `b7` | L2 / R2 | `BTN_TL2` / `BTN_TR2` |
| `b8` / `b9` | select / start | `BTN_SELECT` / `BTN_START` |
| `b10` | home | `BTN_MODE` |
| `b11` / `b12` | clique dos analógicos | `BTN_THUMBL` / `BTN_THUMBR` |
| `b13`..`b16` | direcional | `BTN_DPAD_*` |

**A pegadinha (no virtual):** `b0` é o botão de **baixo**, não o `a` do mapa.
Quem usa `SDL_GameController` recebe a tradução certa; quem usa
`SDL_Joystick` cru tem de usar esta tabela ou aplicar o
`gamecontrollerdb.txt` por conta própria.

### 2.4 Se você lê o **físico** (diagnóstico, ferramenta, app legado)

O virtual não removeu o acesso ao hardware. Se o seu caso é ler o físico:

1. use `/etc/giochi/buttons.map` para traduzir **nome lógico → código**;
2. use as chaves `axis_*_min`/`axis_*_max` do mapa para calibrar. As duas
   faixas medidas são diferentes, e copiar uma na outra dá curso errado:

| Aparelho | Faixa física | Invertido |
| --- | --- | --- |
| R35S | **-1800..1800** (o driver normaliza) | não |
| X55 / X35H | **15..1023** | **Y e RY** (1023..15) |

3. **não recalibre o virtual com a fórmula do físico.** Se você abriu
   `Giochi Gamepad`, a faixa já é -32767..32767.

### 2.5 Por stack

| Stack | Caminho recomendado |
| --- | --- |
| launcher (`Giochi app`) | filtrar `event*` por nome `Giochi Gamepad`; se não existir (imagem antiga), manter o comportamento atual e **logar os nomes** |
| jogos em evdev | abrir o virtual por nome; códigos canônicos; ignorar o resto |
| jogos em SDL2 | `SDL_GameController`, abrindo por nome; usar `SDL_GAMECONTROLLERCONFIG` do init (ou o fallback) |
| engine 2D/3D | idem SDL2; **trocar `open_first` por “abrir pelo nome”**; `Button::A` (o `South` da engine) é o `a` do mapa, o botão da **direita**; remover qualquer desativação de gamepad por aparelho |
| Godot (quando opt-in) | se o backend for evdev, o virtual é um evdev como outro; se for SDL/cage, idem |

---

## 3. O que **não** fazer

1. **Não abra por índice.** `event*` e o índice do SDL mudam. O nome
   `Giochi Gamepad` é o identificador estável.
2. **Não some duas fontes.** `bits_evdev | bits_sdl` foi o defeito do
   `neon-drift`: o mesmo botão acendia acelerar e frear. Cada fonte estava
   “certa” sozinha; a soma criou o sintoma.
3. **Não assuma que `Button::A` é o botão de baixo.** A convenção do projeto é
   **A = `BTN_EAST` = direita**. O mapeamento automático do SDL faria o
   contrário; o `gamecontrollerdb.txt` corrige.
4. **Não use um segundo mapa de botões.** O `buttons.map` é a fonte da
   verdade. Se o seu caminho alternativo (SDL, engine, API) divergir dele, o
   defeito aparece só no aparelho onde aquele caminho está ativo.
5. **Não recalibre o virtual.** Se você abriu `Giochi Gamepad`, a faixa e a
   inversão já estão resolvidas. Se abriu o físico, calibre pelo mapa.

---

## 4. Como verificar no aparelho

```bash
# o serviço e o nó virtual
/etc/init.d/S52gamepad status
# esperado: "giochi-gamepad: 1 processo(s)" e "device virtual: presente"

# o que o kernel classificou em cada nó
bash scripts/input-diag.sh                 # do host, com o aparelho em 10.55.0.2
bash scripts/input-diag.sh --local         # dentro do aparelho

# o que o SDL vê, o GUID e a tradução Button -> bN -> código
bash scripts/sdl-input-probe.sh r35s --run 10.55.0.2

# o mapa que foi para a imagem (códigos + calibração dos eixos)
cat /etc/giochi/buttons.map

# o bloco do controle virtual no diagnóstico geral
giochi-selftest

# a ENTREGA de evento — o selftest confere o nó, este confere o pacote
python3 scripts/entrada-probe.py --mapa device/r35s/buttons.map   # no PC
```

O `giochi-selftest` distingue os três estados:

| Saída | Significado |
| --- | --- |
| `PASS controle virtual: Giochi Gamepad — N botões, M eixos` | o nó do contrato está instalado (a **entrega** de eventos depende de o build ter o fix do `SYN_REPORT`, §12.75) |
| `FAIL` com o serviço instalado e daemon morto | a imagem prometeu e não cumpre |
| `SKIP sem controle virtual — imagem anterior ao contrato` | a imagem é anterior a 17/11/2026; **não** é defeito do seu app |

Se der `SKIP`, a imagem do cartão é anterior a 17/11/2026 e precisa ser
regravada.

**Atenção ao `PASS`:** ele confere que o nó existe e tem os 17 botões — **não**
prova que os eventos chegam. O build do run `44184129584` (commit `87c8422`)
tem o controle virtual, mas é **anterior à correção do `SYN_REPORT`** de
18/11/2026 (`AGENTS.md` §12.75): nessa imagem o daemon traduz e o app não
recebe nada. A imagem que vale é a de um build **posterior** a essa correção.
O R35S de bancada estava com a de 15/11 (sem virtual nenhum), por isso o
`SKIP`.

---

## 5. Estado e pendências do sistema

| Item | Estado |
| --- | --- |
| código do daemon, serviço, DB e `CONFIG_INPUT_UINPUT` | **no código deste repositório**, incluindo a correção do `SYN_REPORT` (§12.75) |
| imagens com o contrato | o build do run `44184129584` tem o virtual, mas é **anterior ao fix do `SYN_REPORT`**; precisa de rebuild + gravação. A imagem de 15/11 não tem o virtual (`SKIP`) |
| multi-controle | **não suportado**: o daemon funde todos os físicos num único virtual; jogador 2 com controle USB entra como jogador 1 |
| prova funcional no selftest | o bloco confere o **nó** e os botões; ele não injeta evento. A prova de que o evento chega é `scripts/entrada-probe.py` (roda no PC, com um device sintético) ou apertar um botão no app |
| faixa do X35H | herdada da X55 (mesma arquitetura); não medida no aparelho |
| volume | fora do virtual, de propósito |

---

## 6. Onde está a verdade

| Documento | Para quê |
| --- | --- |
| [`contrato-de-entrada.md`](contrato-de-entrada.md) | a referência completa, com as medições e o que varia por aparelho |
| [`button-maps.md`](button-maps.md) | de onde vêm os códigos e as faixas |
| [`entrada-sdl2.md`](entrada-sdl2.md) | o histórico do SDL2, do DB e do touch |
| `AGENTS.md` §12.73, §12.74, §12.75 e §29 | o que foi medido, o defeito e a correção |
| [`issues-para-outros-repos/`](issues-para-outros-repos/README.md) | o recorte por equipe, pronto para colar em issue |

**Regra final:** se o seu app abrir o `Giochi Gamepad` e usar uma fonte só,
ele responde igual em todo aparelho — inclusive nos que ainda não existem.
