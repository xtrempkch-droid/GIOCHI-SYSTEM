/*
 * sdl-input-probe — o que o SDL2 **vê** como controle, e com qual mapeamento.
 * ============================================================
 *
 * Responde à pergunta que o `evtest` NÃO responde: o kernel entrega os botões
 * como `BTN_*`, e mesmo assim um app SDL pode não ter controle nenhum. Entre o
 * `evdev` e o `SDL_GameController` há **três** portões, e cada um pode fechar
 * em silêncio:
 *
 *   1. `SDL_EVDEV_GuessDeviceClass` — o nó é joystick, teclado, rato ou nada?
 *      (`src/core/linux/SDL_evdev_capabilities.c`)
 *   2. `LINUX_JoystickGetGamepadMapping` — o nó é **gamepad** para o SDL?
 *      Exige `BTN_SOUTH` (0x130), e sem libudev é o único mapeamento
 *      automático que existe (`src/joystick/linux/SDL_sysjoystick.c`).
 *   3. `SDL_IsGameController` — há mapeamento para o GUID?
 *
 * Um aparelho pode passar no `evtest` e falhar nos três. Quem diz qual portão
 * fechou é este probe, e não a dedução a partir do DTS.
 *
 * ## Por que o vídeo é opcional
 *
 * `SDL_Init(SDL_INIT_VIDEO)` no R35S/KMSDRM **disputa o DRM master** com o
 * launcher — o mesmo motivo do kmscube (§12.72). O subsistema de joystick não
 * precisa de vídeo (a detecção é por inotify), então o padrão é sem vídeo.
 * `--video` liga, para contar ratos (`SDL_GetNumMice`) e ver o driver de vídeo.
 *
 * Compila com o gcc do Buildroot e roda por SSH. Não entra na imagem.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/input.h>

#include <SDL2/SDL.h>

/* Nome do código evdev, para o relatório não sair em número. Só a faixa que
   um gamepad usa; o resto sai em hexadecimal. */
static const char *nome_codigo(unsigned c)
{
    switch (c) {
    case BTN_SOUTH: return "BTN_SOUTH";
    case BTN_EAST: return "BTN_EAST";
    case BTN_NORTH: return "BTN_NORTH";
    case BTN_WEST: return "BTN_WEST";
    case BTN_TL: return "BTN_TL";
    case BTN_TR: return "BTN_TR";
    case BTN_TL2: return "BTN_TL2";
    case BTN_TR2: return "BTN_TR2";
    case BTN_SELECT: return "BTN_SELECT";
    case BTN_START: return "BTN_START";
    case BTN_MODE: return "BTN_MODE";
    case BTN_THUMBL: return "BTN_THUMBL";
    case BTN_THUMBR: return "BTN_THUMBR";
    case BTN_DPAD_UP: return "BTN_DPAD_UP";
    case BTN_DPAD_DOWN: return "BTN_DPAD_DOWN";
    case BTN_DPAD_LEFT: return "BTN_DPAD_LEFT";
    case BTN_DPAD_RIGHT: return "BTN_DPAD_RIGHT";
    case BTN_TRIGGER_HAPPY1: return "BTN_TRIGGER_HAPPY1";
    case BTN_TRIGGER_HAPPY2: return "BTN_TRIGGER_HAPPY2";
    case KEY_VOLUMEUP: return "KEY_VOLUMEUP";
    case KEY_VOLUMEDOWN: return "KEY_VOLUMEDOWN";
    default: return NULL;
    }
}

static const char *nome_botao_sdl(int b)
{
    switch (b) {
    case SDL_CONTROLLER_BUTTON_A: return "A";
    case SDL_CONTROLLER_BUTTON_B: return "B";
    case SDL_CONTROLLER_BUTTON_X: return "X";
    case SDL_CONTROLLER_BUTTON_Y: return "Y";
    case SDL_CONTROLLER_BUTTON_BACK: return "BACK";
    case SDL_CONTROLLER_BUTTON_GUIDE: return "GUIDE";
    case SDL_CONTROLLER_BUTTON_START: return "START";
    case SDL_CONTROLLER_BUTTON_LEFTSTICK: return "LEFTSTICK";
    case SDL_CONTROLLER_BUTTON_RIGHTSTICK: return "RIGHTSTICK";
    case SDL_CONTROLLER_BUTTON_LEFTSHOULDER: return "LEFTSHOULDER";
    case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER: return "RIGHTSHOULDER";
    case SDL_CONTROLLER_BUTTON_DPAD_UP: return "DPAD_UP";
    case SDL_CONTROLLER_BUTTON_DPAD_DOWN: return "DPAD_DOWN";
    case SDL_CONTROLLER_BUTTON_DPAD_LEFT: return "DPAD_LEFT";
    case SDL_CONTROLLER_BUTTON_DPAD_RIGHT: return "DPAD_RIGHT";
    default: return NULL;
    }
}

/*
 * Os códigos evdev que o device declara em `EV_KEY`, em ordem **crescente**.
 *
 * É essa ordem que o driver linux do SDL2 usa para numerar `b0`, `b1`, … ao
 * montar o mapeamento automático (`key_map[]` em `SDL_sysjoystick.c`). Sem esta
 * lista, `a:b0` não diz qual botão do plástico é — e é justamente essa tradução
 * que faltava para o defeito do §12.74 aparecer.
 *
 * Devolve a quantidade, ou -1.
 */
static int codigos_do_device(const char *caminho, unsigned *saida, int maximo)
{
    int fd = open(caminho, O_RDONLY | O_NONBLOCK);
    if (fd < 0) {
        return -1;
    }
    unsigned char bits[KEY_CNT / 8];
    memset(bits, 0, sizeof(bits));
    if (ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(bits)), bits) < 0) {
        close(fd);
        return -1;
    }
    close(fd);

    int n = 0;
    for (unsigned c = 0; c < KEY_CNT && n < maximo; c++) {
        if (bits[c / 8] & (1u << (c % 8))) {
            saida[n++] = c;
        }
    }
    return n;
}

static const char *tipo(SDL_JoystickType t)
{
    switch (t) {
    case SDL_JOYSTICK_TYPE_UNKNOWN: return "desconhecido";
    case SDL_JOYSTICK_TYPE_GAMECONTROLLER: return "gamecontroller";
    case SDL_JOYSTICK_TYPE_WHEEL: return "volante";
    case SDL_JOYSTICK_TYPE_ARCADE_STICK: return "arcade";
    case SDL_JOYSTICK_TYPE_FLIGHT_STICK: return "flight stick";
    case SDL_JOYSTICK_TYPE_DANCE_PAD: return "dance pad";
    case SDL_JOYSTICK_TYPE_GUITAR: return "guitarra";
    case SDL_JOYSTICK_TYPE_DRUM_KIT: return "bateria";
    case SDL_JOYSTICK_TYPE_ARCADE_PAD: return "arcade pad";
    case SDL_JOYSTICK_TYPE_THROTTLE: return "manete";
    default: return "?";
    }
}

int main(int argc, char **argv)
{
    int com_video = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--video") == 0) {
            com_video = 1;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("uso: sdl-input-probe [--video]\n"
                   "  sem argumento  pergunta so ao joystick (nao toca no DRM)\n"
                   "  --video        tambem conta ratos (disputa o DRM master)\n");
            return 0;
        }
    }

    Uint32 bandeiras = SDL_INIT_JOYSTICK | SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS;
    if (com_video) {
        bandeiras |= SDL_INIT_VIDEO;
    }
    if (SDL_Init(bandeiras) != 0) {
        fprintf(stderr, "SDL_Init falhou: %s\n", SDL_GetError());
        return 1;
    }

    if (com_video) {
        printf("driver de video: %s\n", SDL_GetCurrentVideoDriver());
    }

    int n = SDL_NumJoysticks();
    printf("joysticks vistos pelo SDL: %d\n", n);

    int gamepads = 0;
    for (int i = 0; i < n; i++) {
        SDL_JoystickGUID guid = SDL_JoystickGetDeviceGUID(i);
        char texto[33];
        SDL_JoystickGetGUIDString(guid, texto, sizeof(texto));

        printf("  [%d] %s\n", i, SDL_JoystickNameForIndex(i));
        printf("      guid=%s  tipo=%s\n", texto, tipo(SDL_JoystickGetDeviceType(i)));

        SDL_Joystick *js = SDL_JoystickOpen(i);
        if (js) {
            printf("      botoes=%d  eixos=%d  hats=%d\n",
                   SDL_JoystickNumButtons(js), SDL_JoystickNumAxes(js),
                   SDL_JoystickNumHats(js));
            SDL_JoystickClose(js);
        }

        if (!SDL_IsGameController(i)) {
            printf("      SDL_IsGameController = NAO\n");
            continue;
        }
        gamepads++;
        printf("      SDL_IsGameController = SIM\n");

        char *mapa = SDL_GameControllerMappingForDeviceIndex(i);
        if (mapa) {
            printf("      mapeamento: %s\n", mapa);
            SDL_free(mapa);
        }

        SDL_GameController *gc = SDL_GameControllerOpen(i);
        if (!gc) {
            printf("      abrir FALHOU: %s\n", SDL_GetError());
            continue;
        }
        printf("      aberto: \"%s\"\n", SDL_GameControllerName(gc));

        /* ---- o elo que faltava: `bN` -> código evdev ----
         *
         * O SDL numera `b0`, `b1`, … na ordem crescente dos códigos que o
         * device declara em `EV_KEY`. Cruzar as duas pontas é o que diz qual
         * botão do PLÁSTICO cada `Button` do SDL aciona — e é onde um mapa
         * automático divergente do `buttons.map` aparece.
         */
        const char *caminho = SDL_JoystickPath(SDL_GameControllerGetJoystick(gc));
        unsigned codigos[64];
        int n_codigos = caminho ? codigos_do_device(caminho, codigos, 64) : -1;
        if (n_codigos > 0) {
            printf("      device=%s  (%d codigos EV_KEY em ordem)\n", caminho, n_codigos);
            printf("      Button do SDL  -> bN -> codigo evdev\n");
            for (int b = 0; b <= SDL_CONTROLLER_BUTTON_DPAD_RIGHT; b++) {
                SDL_GameControllerButtonBind lig = SDL_GameControllerGetBindForButton(gc, (SDL_GameControllerButton)b);
                if (lig.bindType == SDL_CONTROLLER_BINDTYPE_NONE) {
                    continue;
                }
                const char *nomeb = nome_botao_sdl(b);
                if (lig.bindType != SDL_CONTROLLER_BINDTYPE_BUTTON) {
                    printf("        %-13s -> eixo/hat\n", nomeb ? nomeb : "?");
                    continue;
                }
                int alvo = lig.value.button;
                const char *cod = "fora da lista";
                if (alvo >= 0 && alvo < n_codigos) {
                    const char *nomecod = nome_codigo(codigos[alvo]);
                    static char buf[32];
                    if (nomecod) {
                        cod = nomecod;
                    } else {
                        snprintf(buf, sizeof(buf), "0x%x", codigos[alvo]);
                        cod = buf;
                    }
                }
                printf("        %-13s -> b%-2d -> %-20s (%u)\n",
                       nomeb ? nomeb : "?",
                       alvo,
                       cod,
                       (alvo >= 0 && alvo < n_codigos) ? codigos[alvo] : 0u);
            }
        } else {
            printf("      nao consegui ler os codigos evdev de %s\n",
                   caminho ? caminho : "(sem caminho)");
        }

        SDL_GameControllerClose(gc);
    }

    printf("gamecontrollers: %d\n", gamepads);
    /* A frase que o jogo precisa: sem gamecontroller, um app que usa só
       `SDL_GameController` fica sem entrada nenhuma, e o sintoma é "o controle
       não funciona" com o `evtest` mostrando tudo certo. */
    printf("veredito: %s\n",
           gamepads > 0
               ? "ha gamecontroller - o caminho SDL do jogo funciona"
               : "NENHUM gamecontroller - app que so usa SDL_GameController fica sem entrada");

    SDL_Quit();
    return gamepads > 0 ? 0 : 2;
}
