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

#include <SDL2/SDL.h>

#define TAXA 48000
#define FREQ 1000.0
#define DURACAO_MS 1500

/* Fase acumulada, para o buffer poder ser gerado em blocos sem estalo. */
static double fase = 0.0;
static int restante = 0;

static void audio_cb(void *ud, Uint8 *stream, int len)
{
    (void)ud;
    Sint16 *out = (Sint16 *)stream;
    int amostras = len / (int)sizeof(Sint16);
    double passo = 2.0 * M_PI * FREQ / TAXA;

    for (int i = 0; i < amostras; i += 2) {
        Sint16 v = 0;
        if (restante > 0) {
            /* metade da amplitude: audível e sem saturar */
            v = (Sint16)(sin(fase) * 12000.0);
            fase += passo;
            if (fase > 2.0 * M_PI) fase -= 2.0 * M_PI;
            restante -= 2;
        }
        out[i] = v;
        if (i + 1 < amostras) out[i + 1] = v;
    }
}

int main(void)
{
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

    restante = TAXA * DURACAO_MS / 1000;
    SDL_PauseAudioDevice(dev, 0);
    SDL_Delay(DURACAO_MS + 200);
    SDL_PauseAudioDevice(dev, 1);
    SDL_CloseAudioDevice(dev);
    SDL_Quit();

    printf("VEREDITO: som reproduzido pela via SDL2 -> %s\n", drv ? drv : "?");
    return 0;
}
