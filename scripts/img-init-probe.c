/*
 * img-init-probe — prova que IMG_Init entrega os decodificadores, um por um.
 * ============================================================
 *
 * Por que isto existe, e o defeito do relatório da equipe da engine.
 *
 * A imagem antiga tinha `SDL2_image` construída com `--disable-png` e
 * `--disable-jpg`, então `IMG_isPNG` EXISTIA e respondia "PNG images are not
 * supported". E aqui está a armadilha que eles documentaram:
 *
 *   IMG_Init(IMG_INIT_PNG | IMG_INIT_JPG)
 *
 * **falha inteira** se qualquer flag pedida faltar. O retorno é 0, e um app que
 * confia nele conclui que o subsistema de imagem está morto — mesmo com BMP,
 * TGA, PNM e QOI funcionando perfeitamente. Um formato ausente derruba todos.
 *
 * A correção deles foi defensiva e correta: abrir com `InitFlag::empty()` e
 * sondar cada formato separadamente. Mas isso é CONTORNO de imagem quebrada.
 * Se ficar depois de a imagem ser corrigida, vira dívida permanente — o código
 * carrega complexidade para um defeito que não existe mais, e ninguém sabe
 * quando remover.
 *
 * Este probe existe para dizer, com número, quando o contorno pode sair:
 *
 *   1. `IMG_Init` combinado — o que ele devolve de fato;
 *   2. `IMG_Init` individual por formato — o que cada um entrega;
 *   3. `IMG_isPNG`/`IMG_isJPG` sobre um buffer sintético — se o decodificador
 *      responde de verdade, ou só existe.
 *
 * O item 3 é o que separa "flag aceita" de "decodifica". Uma biblioteca pode
 * aceitar `IMG_INIT_PNG` e falhar em abrir o arquivo.
 *
 * Compila com o gcc do Buildroot, estático, e roda por SSH. Não entra na imagem.
 */

#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>
#include <SDL2/SDL_image.h>

/* PNG 1x1 válido, gerado com zlib — cabe no arquivo e não depende de I/O. */
static const unsigned char PNG_1X1[] = {
    0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 'I', 'H', 'D', 'R',
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 'I', 'D', 'A', 'T',
    0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
    0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00,
    0x00, 0x00, 'I', 'E', 'N', 'D', 0xAE, 0x42, 0x60, 0x82
};

static const char *nome(int flag)
{
    switch (flag) {
    case IMG_INIT_PNG: return "PNG";
    case IMG_INIT_JPG: return "JPG";
    case IMG_INIT_WEBP: return "WEBP";
    case IMG_INIT_TIF: return "TIF";
    default: return "?";
    }
}

int main(void)
{
    if (SDL_Init(0) != 0) {
        printf("SDL_Init falhou: %s\n", SDL_GetError());
        return 2;
    }

    /* A versão compilada do SDL2_image: o comportamento mudou em 2.8 (stb). */
    const SDL_version *v = IMG_Linked_Version();
    printf("SDL2_image %d.%d.%d\n", v->major, v->minor, v->patch);

    /* --- 1. o combinado, que é como a maioria dos apps chama ------------- */
    int pedido = IMG_INIT_PNG | IMG_INIT_JPG | IMG_INIT_WEBP;
    int obtido = IMG_Init(pedido);
    printf("\nIMG_Init(PNG|JPG|WEBP): pedido=0x%x obtido=0x%x", pedido, obtido);
    if (obtido == pedido) {
        printf("  -> TODOS\n");
    } else {
        printf("  -> FALTAM:");
        for (int f = 1; f <= 0x40; f <<= 1)
            if ((pedido & f) && !(obtido & f)) printf(" %s", nome(f));
        printf("\n");
        /* O ponto do relatório deles: quando isto é 0, o app conclui que
         * NENHUM formato funciona, e está errado. */
        if (obtido == 0)
            printf("   ATENCAO: retorno 0. Um app que confia nele descarta o\n"
                   "            subsistema inteiro, inclusive BMP/TGA/PNM/QOI.\n");
    }
    IMG_Quit();

    /* --- 2. um por um: o que cada decodificador realmente entrega -------- */
    printf("\npor formato:\n");
    int falhas = 0;
    for (int f = 1; f <= 0x40; f <<= 1) {
        IMG_Quit();
        int r = IMG_Init(f);
        printf("  IMG_Init(%s) = %s\n", nome(f), (r & f) ? "ok" : "AUSENTE");
        if (!(r & f)) falhas++;
    }
    IMG_Quit();

    /* --- 3. decodifica de verdade? -------------------------------------- */
    printf("\ndecodificacao real:\n");
    int r = IMG_Init(IMG_INIT_PNG);
    if (r & IMG_INIT_PNG) {
        SDL_RWops *rw = SDL_RWFromConstMem(PNG_1X1, sizeof(PNG_1X1));
        SDL_Surface *s = IMG_Load_RW(rw, 1);
        if (s) {
            printf("  PNG 1x1 decodificado: %dx%d\n", s->w, s->h);
            SDL_FreeSurface(s);
        } else {
            printf("  PNG declarado mas NAO decodifica: %s\n", IMG_GetError());
            falhas++;
        }
    } else {
        printf("  PNG indisponivel — nada a decodificar\n");
    }
    IMG_Quit();

    SDL_Quit();
    printf("\nVEREDITO: %s\n", falhas == 0
           ? "todos os decodificadores respondem — o contorno do InitFlag::empty() pode sair"
           : "ha decodificador ausente ou quebrado — mantenha o contorno");
    return falhas == 0 ? 0 : 1;
}
