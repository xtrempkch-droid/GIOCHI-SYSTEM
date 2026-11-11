# SDL2 e entrada — o que o relatório do consultor externo pediu

Registro das três ações do
[Relatório consultor externo](../Relatório%20consultor%20externo.md) e o que foi
feito em cada uma. Atualizado em 11/11/2026.

---

## 1. SDL2 com subsistema de gamepad — verificado, não suposto

**O relatório pede:** "validar explicitamente que o SDL2 do Buildroot tem
`SDL_GAMECONTROLLER` habilitado, em vez de confiar no padrão".

**O `SDL_GAMECONTROLLER` não é opção de build.** Os quatro subsistemas
(`SDL_JOYSTICK`, `SDL_HAPTIC`, `SDL_GAMECONTROLLER`, `SDL_SENSOR`) são
**compilados sempre** no `SDL2` 2.x — o `CMakeLists.txt` upstream não tem flag
para desligá-los, e o `package/sdl2/sdl2.mk` do Buildroot 2024.02 não passa
nenhuma. Então:

| O que verificar | Onde |
| --- | --- |
| SDL2 na imagem | `BR2_PACKAGE_SDL2=y` (X55 e X35H) |
| driver de vídeo | `SDL2_KMSDRM` + `SDL2_OPENGLES` |
| **evdev com joystick** | **`CONFIG_INPUT_EVDEV=y`** e **`CONFIG_INPUT_JOYSTICK=y`** — kernel, não SDL2 |

**A confusão que o relatório faz:** o SDL2 lê controle por dois caminhos
independentes.

| Caminho | Depende de | Serve para |
| --- | --- | --- |
| `SDL_JOYSTICK_LINUX` (evdev) | `CONFIG_INPUT_EVDEV` | o aparelho real |
| `SDL_GAMECONTROLLER` (mapeamento) | `SDL_GameControllerDB` | traduzir evdev → ABXY |

O segundo é o problema deste projeto e está registrado em
[docs/button-maps.md](button-maps.md): os botões dos handhelds vêm de driver
próprio, e o SDL só reconhece um controle se houver entrada no
`SDL_GameControllerDB` — que não existe para aparelho custom.

**Consequência para a GIOCHI-ENGINE-3D:** ela usa `SDL_GameController`
([citação do relatório](../Relatório%20consultor%20externo.md)). No X55 isso
**não vai funcionar por padrão**, porque o controle não está no DB. O
`giochi_gamepad_connected()` vai devolver 0 e os jogos da engine ficarão sem
controle — sem erro, só sem resposta.

Duas saídas, e a escolha é da equipe da engine:

1. **Registrar o mapeamento em runtime** com
   `SDL_GameControllerAddMapping()` antes da primeira consulta, lendo o
   `/etc/giochi/buttons.map` que este repositório instala. É o caminho que usa o
   que já existe no aparelho.
2. **Usar `SDL_Joystick` cru e traduzir pelo `buttons.map`**, como o launcher faz
   por evdev. É o que garante funcionar em qualquer aparelho, sem DB.

**O gate que ficou no repositório:** `device/<aparelho>/kernel-required.txt`
declara `CONFIG_INPUT_EVDEV` e `CONFIG_INPUT_JOYSTICK`, então um build que perca
o evdev falha em vez de produzir imagem sem controle.

---

## 2. Permissões de `/dev/input/event*` — implementado

**O relatório pede:** "garantir que o launcher/app rode com permissão de leitura
em `/dev/input/event*`".

Hoje o launcher e os jogos rodam como **root**, e por isso não sentem o problema —
mas isso é um fato do momento, não uma garantia de arquitetura.

Feito: [`device/common/rootfs-overlay/etc/init.d/S05input`](../device/common/rootfs-overlay/etc/init.d/S05input),
que roda cedo no boot:

- cria o grupo `input` (GID 1001) se o rootfs não o tiver;
- põe `/dev/input/event*` em `input:input 0640`;
- só toca no inode quando o modo/grupo está diferente (idempotente);
- **diz o que encontrou** (`era root:root 644`), porque a falha silenciosa aqui é
  um app que abre o dispositivo no PC e recebe `EACCES` no aparelho.

### Por que script de init e não só regra de udev

Ordem de boot: `S30usbnet` e o launcher podem abrir o dispositivo antes de o udev
terminar de aplicar regras. O script roda cedo e não depende de o pacote de regras
estar na imagem — regra de udev mora em `/lib/udev/rules.d/`, **empacotamento**,
não `/etc`, e uma imagem que não instale o pacote fica com `root:root 0644`.

### O grupo `input` é do sistema, não do usuário

Nenhum humano precisa estar nele. Quem precisa são os processos de interface. A
saída do script diz isso em vez de sugerir "adicione o usuário ao grupo" — num
aparelho não existe outro usuário.

---

## 3. Touch como terceira opção de entrada — registrado, bloqueado no hardware

**O relatório pede:** "validar que o SDL2 no Buildroot expõe eventos de toque como
mouse em handhelds com touchscreen".

**Não há como validar hoje: nenhum aparelho do catálogo tem touchscreen.**

| Aparelho | Touch | Evidência |
| --- | --- | --- |
| Powkiddy X55 | **não** | `giochi-selftest` do X55: `/dev/input` só com `rk805 pwrkey`, `gpio-keys-control`, `gpio-keys-vol` |
| Powkiddy X35H | **não** | mesma lista, 19 códigos, nenhum `ABS_MT_*` |
| R35S | **não** | DTB do ROCKNIX não declara controlador de toque |
| Steam Deck / ROG Ally | **sim** | fora do escopo ARM64 hoje |

Então o item é **registrado, não implementado**, e não por escolha.

### O que já se sabe, para quando houver aparelho com tela

**`SDL_TOUCH_MOUSE_EVENTS` é variável de ambiente, não opção de build.** Vale
`SDL_TOUCH_MOUSE_EVENTS=0` para desligar a emulação (o padrão é ligado). Não há
símbolo de Buildroot nem de kernel — então "validar no Buildroot" não se aplica;
valida-se **no aparelho**, com o device node e um evento.

**Pré-requisitos concretos, para não redescobrir:**

| Item | O que precisa |
| --- | --- |
| kernel | `CONFIG_INPUT_TOUCHSCREEN=y` + driver do controlador |
| DTB | nó do touch com `compatible` do controlador e `reset-gpios` |
| `/dev/input` | `ABS_MT_POSITION_X/Y` e `ABS_MT_SLOT` em `caps/abs` |
| SDL2 | nada; o evdev é o mesmo |
| engine | `SDL_Finger` não está na ABI C — o relatório propõe emular por `SDL_MOUSE_*`, que já está na ABI |

**A promessa do relatório que precisa de ressalva:** "touch emulado via eventos de
mouse da SDL é suficiente para joystick virtual e botões na tela". Para **botão na
tela**, sim. Para **joystick virtual** (arrastar analógico), não: o mouse entrega
**um** ponteiro, e um joystick virtual precisa saber que o dedo saiu do centro e
voltou — dois toques simultâneos no mesmo eixo, ou um dedo indo de um controle
para outro. Isso exige `SDL_Finger` de verdade, que o relatório lista como
extensão futura. Concordo com a prioridade; divirjo do alcance.

---

## O que este repositório passou a fazer por causa do relatório

| Item | Onde |
| --- | --- |
| permissão de `/dev/input` no boot | `S05input` (novo) |
| gate de `INPUT_EVDEV`/`INPUT_JOYSTICK` por aparelho | `kernel-required.txt` |
| este documento | `docs/entrada-sdl2.md` (novo) |

**O que NÃO entra:** `SDL_TOUCH_MOUSE_EVENTS` em script de boot. Ligar emulação de
mouse em aparelho **sem** touch não muda nada, e num aparelho com touch ela já vem
ligada por padrão. Uma variável a mais no boot seria ruído — fica para quando
existir o primeiro aparelho com tela sensível, junto do teste que a valida.
