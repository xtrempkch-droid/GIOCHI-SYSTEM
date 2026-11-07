/*
 * sdl-audio-probe — prova que a via SDL2 → ALSA funciona, e com qual driver.
 * ============================================================
 *
 * Responde três perguntas que o `speaker-test` NÃO responde:
 *
 *   1. qual driver de áudio o SDL2 escolheu            (SDL_GetCurrentAudioDriver)
 *   2. o SDL2 conseguiu abrir o dispositivo            (SDL_OpenAudioDevice)
 *   3. o som sai pela via que o jogo vai usar          (o mesmo caminho)
 *
 * Por que não basta `speaker-test`: ele fala ALSA **direto**, sem passar pelo
 * SDL2. Num aparelho onde o SDL2 foi compilado com `--disable-alsa`, o
 * `speaker-test` toca normalmente e todo app SDL fica mudo — foi exatamente o
 * defeito do §12.56 no R35S. O que precisa de prova é a camada do meio.
 *
 * Compila com o gcc do Buildroot, estático, e roda por SSH. Não entra na imagem.
 */

#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#include <SDL2/SDL.h>

#define TAXA 48000
#define FREQ 1000.0
#define DURACAO_MS 1500

/* Fase acumulada, para o buffer poder ser gerado em blocos sem estalo. */
static double fase = 0.0;
static int restante = 0;

/* Modo sirene: varre 400 -> 1600 Hz em 2 s e volta, repetindo. Escala cheia. */
static int sirene = 0;

static void audio_cb(void *ud, Uint8 *stream, int len)
{
    (void)ud;
    Sint16 *out = (Sint16 *)stream;
    int amostras = len / (int)sizeof(Sint16);

    for (int i = 0; i < amostras; i += 2) {
        Sint16 v = 0;
        if (restante > 0) {
            double amp;
            double f;
            if (sirene) {
                /*
                 * Amplitude quase cheia de propósito: 32000 de 32767 (−0,2 dB).
                 * O tom de teste anterior usava 12000 (≈37%), que num alto-
                 * falante pequeno e num ambiente com ruído pode ser inaudível —
                 * e "inaudível" seria confundido com "a via SDL2 não funciona".
                 * A varredura de frequência também ajuda: o ouvido é mais
                 * sensível a 1–2 kHz e a mudança contínua chama atenção.
                 */
                double t = (double)((TAXA * DURACAO_MS / 1000) - restante) / TAXA;
                f = 400.0 + 1200.0 * (0.5 - 0.5 * cos(2.0 * M_PI * 0.5 * t));
                amp = 32000.0;
                fase += 2.0 * M_PI * f / TAXA;
                if (fase > 2.0 * M_PI) fase -= 2.0 * M_PI;
            } else {
                fase += 2.0 * M_PI * FREQ / TAXA;
                if (fase > 2.0 * M_PI) fase -= 2.0 * M_PI;
                amp = 12000.0;
            }
            v = (Sint16)(sin(fase) * amp);
            restante -= 2;
        }
        out[i] = v;
        if (i + 1 < amostras) out[i + 1] = v;
    }
}

int main(int argc, char **argv)
{
    int duracao_ms = DURACAO_MS;
    if (argc > 1 && strcmp(argv[1], "--sirene") == 0) {
        sirene = 1;
        duracao_ms = 5000;
    } else if (argc > 1) {
        duracao_ms = atoi(argv[1]);
        if (duracao_ms <= 0) duracao_ms = DURACAO_MS;
    }
    if (argc > 2) sirene = atoi(argv[2]) ? 1 : 0;
    if (SDL_Init(SDL_INIT_AUDIO) != 0) {
        printf("SDL_Init(AUDIO) falhou: %s\n", SDL_GetError());
        return 2;
    }

    /* A linha que responde "SDL2 está usando ALSA?" */
    const char *drv = SDL_GetCurrentAudioDriver();
    printf("driver de audio SDL2: %s\n", drv ? drv : "(nenhum)");

    SDL_AudioSpec quer, obtido;
    SDL_memset(&quer, 0, sizeof(quer));
    quer.freq = TAXA;
    quer.format = AUDIO_S16SYS;
    quer.channels = 2;
    quer.samples = 1024;
    quer.callback = audio_cb;

    SDL_AudioDeviceID dev = SDL_OpenAudioDevice(NULL, 0, &quer, &obtido, 0);
    if (dev == 0) {
        printf("SDL_OpenAudioDevice falhou: %s\n", SDL_GetError());
        SDL_Quit();
        return 3;
    }

    printf("dispositivo aberto: %d Hz, %d canal(is), %d amostras/buffer\n",
           obtido.freq, obtido.channels, obtido.samples);

    restante = TAXA * duracao_ms / 1000;
    printf("tocando %d ms%s\n", duracao_ms, sirene ? " (sirene, varredura 400-1600 Hz)" : "");
    SDL_PauseAudioDevice(dev, 0);
    SDL_Delay(duracao_ms + 200);
    SDL_PauseAudioDevice(dev, 1);
    SDL_CloseAudioDevice(dev);
    SDL_Quit();

    printf("VEREDITO: som reproduzido pela via SDL2 -> %s\n", drv ? drv : "?");
    return 0;
}
