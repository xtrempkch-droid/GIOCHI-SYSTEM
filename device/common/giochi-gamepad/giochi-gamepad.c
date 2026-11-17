/*
 * giochi-gamepad — o controle que tem a MESMA resposta em todo aparelho.
 * ============================================================
 *
 * ## O problema que isto resolve
 *
 * Cada aparelho expoe os botoes de um jeito, e nao e escolha nossa — e o que o
 * DTS declara e o que o driver mainline oferece:
 *
 *   R35S   `rocknix-singleadc-joypad`  17 botoes + 4 eixos no MESMO no
 *   X55    `gpio-keys` + `adc-joystick` botoes num no, e eixos em OUTRO
 *   X35H   idem X55
 *
 * Consequencia medida (AGENTS §12.74): o SDL2 reconhece gamecontroller no R35S
 * e **nao reconhece** na X55, porque ele exige `BTN_SOUTH` e `ABS_X`/`ABS_Y` no
 * mesmo no de input. Um jogo SDL tem comportamento diferente em cada console, e
 * a correcao ficava por conta de cada jogo.
 *
 * Este daemon cria **um** device virtual com o layout canonico e traduz o
 * hardware para ele. A partir daqui todo aparelho entrega:
 *
 *   - os MESMOS 17 codigos de botao, do mesmo conjunto
 *   - os MESMOS 4 eixos, na MESMA faixa (-32767..32767)
 *   - no MESMO no (botoes e eixos juntos), que e o que o SDL2 exige
 *
 * Aparelho novo entra no ecossistema editando `buttons.map`, sem tocar em jogo
 * nenhum. O mapa passa a ser o **contrato**, nao um detalhe de cada port.
 *
 * ## Por que sem `EVIOCGRAB`
 *
 * O daemon NAO toma os devices fisicos para si. Os dois conjuntos de eventos
 * coexistem: o fisico continua visivel para `evtest`, `giochi-buttons` e
 * `giochi-selftest` — ferramenta de diagnostico que para de funcionar quando o
 * produto esta no ar e a armadilha do §12.45.
 *
 * E nao ha conflito: os dois emitem a MESMA transicao (apertar -> bit ligado,
 * soltar -> bit desligado), entao aplicar os dois em qualquer ordem da o mesmo
 * estado. Quem quiser ler so o virtual filtra por nome.
 *
 * ## O que ele NAO faz
 *
 * Nao remapeia para "o botao que o jogador acha que e": ele traduz o NOME da
 * funcao do `buttons.map` para o codigo canonico do contrato. Um aparelho que
 * troca A e B no DTS (o X35S) continua com A a direita **no virtual**, porque e
 * isso que o mapa dele declara.
 */

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#define MAX_DEV 16
#define MAX_FD 32

/* Faixa canonica dos eixos. -32767..32767 e a que um controle USB generico
 * entrega e a que o SDL2 espera; usar outra criaria uma terceira escala para os
 * jogos normalizarem. */
#define EIXO_MIN (-32767)
#define EIXO_MAX 32767

/* Uma funcao do `buttons.map`: nome logico, codigo CANONICO que o virtual
 * sempre emite, e o codigo FISICO que este aparelho usa (-1 = nao tem). */
struct funcao {
    const char *nome;
    unsigned canonico;
    int fisico;
};

static struct funcao FUNCOES[] = {
    {"b", BTN_SOUTH, -1},
    {"a", BTN_EAST, -1},
    {"x", BTN_NORTH, -1},
    {"y", BTN_WEST, -1},
    {"l", BTN_TL, -1},
    {"r", BTN_TR, -1},
    {"l2", BTN_TL2, -1},
    {"r2", BTN_TR2, -1},
    {"select", BTN_SELECT, -1},
    {"start", BTN_START, -1},
    {"home", BTN_MODE, -1},
    {"thumbl", BTN_THUMBL, -1},
    {"thumbr", BTN_THUMBR, -1},
    {"up", BTN_DPAD_UP, -1},
    {"down", BTN_DPAD_DOWN, -1},
    {"left", BTN_DPAD_LEFT, -1},
    {"right", BTN_DPAD_RIGHT, -1},
};
#define N_FUNCOES (sizeof(FUNCOES) / sizeof(FUNCOES[0]))

struct eixo {
    const char *chave;
    unsigned canonico;
    int fisico;
    int min, max;   /* faixa declarada no mapa */
    int calibrado;  /* min/max vieram do mapa */
};

static struct eixo EIXOS[] = {
    {"axis_x", ABS_X, -1, 0, 0, 0},
    {"axis_y", ABS_Y, -1, 0, 0, 0},
    {"axis_rx", ABS_RX, -1, 0, 0, 0},
    {"axis_ry", ABS_RY, -1, 0, 0, 0},
};
#define N_EIXOS (sizeof(EIXOS) / sizeof(EIXOS[0]))

/* Simbolos evdev que o contrato aceita no mapa. Volume fica de fora de
 * proposito: `KEY_VOLUMEUP` nao e botao de jogo e nao deve virar `bN`. */
static const struct {
    const char *nome;
    unsigned codigo;
} SIMBOLOS[] = {
    {"BTN_SOUTH", BTN_SOUTH}, {"BTN_EAST", BTN_EAST},
    {"BTN_NORTH", BTN_NORTH}, {"BTN_WEST", BTN_WEST},
    {"BTN_TL", BTN_TL}, {"BTN_TR", BTN_TR},
    {"BTN_TL2", BTN_TL2}, {"BTN_TR2", BTN_TR2},
    {"BTN_SELECT", BTN_SELECT}, {"BTN_START", BTN_START},
    {"BTN_MODE", BTN_MODE},
    {"BTN_THUMBL", BTN_THUMBL}, {"BTN_THUMBR", BTN_THUMBR},
    {"BTN_DPAD_UP", BTN_DPAD_UP}, {"BTN_DPAD_DOWN", BTN_DPAD_DOWN},
    {"BTN_DPAD_LEFT", BTN_DPAD_LEFT}, {"BTN_DPAD_RIGHT", BTN_DPAD_RIGHT},
};

static volatile sig_atomic_t parar = 0;
static void ao_sinal(int s) { (void)s; parar = 1; }

static const char *nome_de(unsigned canonico)
{
    for (size_t i = 0; i < N_FUNCOES; i++) {
        if (FUNCOES[i].canonico == canonico) {
            return FUNCOES[i].nome;
        }
    }
    return "?";
}

static void podar(char *s)
{
    while (*s == ' ' || *s == '\t') {
        memmove(s, s + 1, strlen(s));
    }
    char *fim = s + strlen(s);
    while (fim > s && (fim[-1] == ' ' || fim[-1] == '\t' ||
                       fim[-1] == '\n' || fim[-1] == '\r')) {
        *--fim = '\0';
    }
}

/*
 * Le o `buttons.map`.
 *
 * Simbolo desconhecido nao e erro: e o caso do `OPCIONAL` que nao existe nesta
 * revisao do gabarito, e recusar o mapa inteiro por causa dele seria pior.
 */
static int ler_mapa(const char *caminho)
{
    FILE *f = fopen(caminho, "r");
    if (!f) {
        fprintf(stderr, "giochi-gamepad: nao consegui abrir %s: %s\n",
                caminho, strerror(errno));
        return -1;
    }

    char linha[512];
    while (fgets(linha, sizeof(linha), f)) {
        char *c = strchr(linha, '#');
        if (c) {
            *c = '\0';
        }
        char *igual = strchr(linha, '=');
        if (!igual) {
            continue;
        }
        *igual = '\0';
        char *nome = linha;
        char *valor = igual + 1;
        podar(nome);
        podar(valor);
        if (!*nome || !*valor) {
            continue;
        }

        if (strncmp(nome, "axis_", 5) == 0) {
            for (size_t e = 0; e < N_EIXOS; e++) {
                char alvo[48];
                snprintf(alvo, sizeof(alvo), "%s_min", EIXOS[e].chave);
                if (strcmp(nome, alvo) == 0) {
                    EIXOS[e].min = atoi(valor);
                    EIXOS[e].calibrado |= 1;
                }
                snprintf(alvo, sizeof(alvo), "%s_max", EIXOS[e].chave);
                if (strcmp(nome, alvo) == 0) {
                    EIXOS[e].max = atoi(valor);
                    EIXOS[e].calibrado |= 2;
                }
            }
            continue;
        }

        for (size_t i = 0; i < N_FUNCOES; i++) {
            if (strcmp(FUNCOES[i].nome, nome) != 0) {
                continue;
            }
            for (size_t s = 0; s < sizeof(SIMBOLOS) / sizeof(SIMBOLOS[0]); s++) {
                if (strcmp(SIMBOLOS[s].nome, valor) == 0) {
                    FUNCOES[i].fisico = (int)SIMBOLOS[s].codigo;
                    break;
                }
            }
            break;
        }
    }
    fclose(f);

    for (size_t e = 0; e < N_EIXOS; e++) {
        EIXOS[e].calibrado = (EIXOS[e].calibrado == 3);
    }
    return 0;
}

static int funcao_do_fisico(int fisico)
{
    for (size_t i = 0; i < N_FUNCOES; i++) {
        if (FUNCOES[i].fisico == fisico) {
            return (int)i;
        }
    }
    return -1;
}

static int eixo_do_fisico(int fisico)
{
    for (size_t e = 0; e < N_EIXOS; e++) {
        if (EIXOS[e].fisico == fisico) {
            return (int)e;
        }
    }
    return -1;
}

/* Normaliza o valor cru do hardware para a faixa canonica. */
static int normalizar(const struct eixo *e, int valor)
{
    if (!e->calibrado || e->min == e->max) {
        /* Sem calibracao declarada, repassa o valor cru limitado a faixa
         * canonica. Melhor um curso estranho que um valor fora da faixa do
         * device virtual — esse o kernel recusa e o eixo nao mexe, sem erro. */
        if (valor < EIXO_MIN) {
            return EIXO_MIN;
        }
        if (valor > EIXO_MAX) {
            return EIXO_MAX;
        }
        return valor;
    }
    long min = e->min, max = e->max;
    long v = valor;
    /* Faixa invertida e legitima: o `adc-joystick` da X55 declara o Y como
     * 1023..15, e ignorar isso faz o eixo virar ao contrario — sem erro. */
    long lo = min < max ? min : max;
    long hi = min < max ? max : min;
    if (v < lo) v = lo;
    if (v > hi) v = hi;
    long t = (v - lo) * (EIXO_MAX - EIXO_MIN) / (hi - lo) + EIXO_MIN;
    if (min > max) {
        t = EIXO_MAX - (t - EIXO_MIN);
    }
    return (int)t;
}

/* Descobre em qual device fisico cada codigo do contrato vive.
 *
 * Um aparelho pode ter os botoes num no e os eixos em outro (X55/X35H), entao a
 * busca e por CODIGO em todos os nos — nunca "o primeiro joystick que aparecer".
 * Devolve a quantidade de fds abertos. */
static int descobrir(int *fds, int maximo)
{
    int n = 0;
    for (int i = 0; i < 32 && n < maximo; i++) {
        char caminho[64];
        snprintf(caminho, sizeof(caminho), "/dev/input/event%d", i);
        int fd = open(caminho, O_RDONLY | O_NONBLOCK);
        if (fd < 0) {
            continue;
        }
        /* Nao ler a si proprio: seria realimentacao. */
        char nome[256] = {0};
        if (ioctl(fd, EVIOCGNAME(sizeof(nome) - 1), nome) > 0 &&
            strcmp(nome, "Giochi Gamepad") == 0) {
            close(fd);
            continue;
        }

        int util = 0;
        unsigned char keybits[KEY_CNT / 8];
        if (ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(keybits)), keybits) >= 0) {
            for (size_t f = 0; f < N_FUNCOES; f++) {
                if (FUNCOES[f].fisico < 0) {
                    continue;
                }
                unsigned c = (unsigned)FUNCOES[f].fisico;
                if (keybits[c / 8] & (1u << (c % 8))) {
                    util = 1;
                }
            }
        }
        unsigned char absbits[ABS_CNT / 8];
        if (ioctl(fd, EVIOCGBIT(EV_ABS, sizeof(absbits)), absbits) >= 0) {
            for (size_t e = 0; e < N_EIXOS; e++) {
                unsigned a = EIXOS[e].canonico; /* homonimo: ABS_X no fisico */
                if (absbits[a / 8] & (1u << (a % 8))) {
                    EIXOS[e].fisico = (int)a;
                    util = 1;
                }
            }
        }

        if (util) {
            fds[n++] = fd;
            fprintf(stderr, "giochi-gamepad: lendo %s (%s)\n", caminho, nome);
        } else {
            close(fd);
        }
    }
    return n;
}

static int criar_uinput(void)
{
    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0) {
        fprintf(stderr, "giochi-gamepad: /dev/uinput nao abriu: %s\n", strerror(errno));
        fprintf(stderr,
                "giochi-gamepad: falta CONFIG_INPUT_UINPUT. Sem ele o controle\n"
                "                virtual nao existe e cada aparelho responde do\n"
                "                seu jeito (AGENTS §12.74).\n");
        return -1;
    }

    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_EVBIT, EV_ABS);
    ioctl(fd, UI_SET_EVBIT, EV_SYN);

    /* TODOS os 17, inclusive os que este aparelho nao tem fisicamente.
     *
     * Medido: o X35H declara 16 botoes (sem `home`), e o X55 tambem nao tem o
     * `F` no gabarito (§12.22). Se o virtual declarasse so o que existe, um jogo
     * veria 17 botoes num console e 16 em outro — que e exatamente a divergencia
     * que este servico existe para eliminar. Botao que nunca dispara e inofensivo;
     * layout diferente nao e. */
    for (size_t i = 0; i < N_FUNCOES; i++) {
        ioctl(fd, UI_SET_KEYBIT, FUNCOES[i].canonico);
    }
    for (size_t e = 0; e < N_EIXOS; e++) {
        ioctl(fd, UI_SET_ABSBIT, EIXOS[e].canonico);
    }

    struct uinput_abs_setup abs_setup;
    for (size_t e = 0; e < N_EIXOS; e++) {
        memset(&abs_setup, 0, sizeof(abs_setup));
        abs_setup.code = EIXOS[e].canonico;
        abs_setup.absinfo.minimum = EIXO_MIN;
        abs_setup.absinfo.maximum = EIXO_MAX;
        /* 32 e a folga medida nos dois aparelhos (`flat=32`), repetida aqui
         * para o jogo nao precisar de zona morta diferente por console. */
        abs_setup.absinfo.flat = 32;
        abs_setup.absinfo.fuzz = 32;
        if (ioctl(fd, UI_ABS_SETUP, &abs_setup) < 0) {
            fprintf(stderr, "giochi-gamepad: UI_ABS_SETUP em %u falhou: %s\n",
                    EIXOS[e].canonico, strerror(errno));
        }
    }

    struct uinput_setup setup;
    memset(&setup, 0, sizeof(setup));
    setup.id.bustype = BUS_VIRTUAL;
    setup.id.vendor = 0x1209; /* pid.codes — faixa para prototipo */
    setup.id.product = 0x0001;
    setup.id.version = 1;
    snprintf(setup.name, UINPUT_MAX_NAME_SIZE, "Giochi Gamepad");
    if (ioctl(fd, UI_DEV_SETUP, &setup) < 0) {
        fprintf(stderr, "giochi-gamepad: UI_DEV_SETUP falhou: %s\n", strerror(errno));
        close(fd);
        return -1;
    }
    if (ioctl(fd, UI_DEV_CREATE) < 0) {
        fprintf(stderr, "giochi-gamepad: UI_DEV_CREATE falhou: %s\n", strerror(errno));
        close(fd);
        return -1;
    }
    return fd;
}

static void listar(void)
{
    int fisicos = 0;
    printf("layout canonico: %zu botoes, %zu eixos\n", N_FUNCOES, N_EIXOS);
    for (size_t i = 0; i < N_FUNCOES; i++) {
        if (FUNCOES[i].fisico < 0) {
            /* O virtual DECLARA mesmo assim: layout igual em todo console. */
            printf("  %-8s canonico=%-4u (ausente no hardware, declarado no virtual)\n",
                   FUNCOES[i].nome, FUNCOES[i].canonico);
            continue;
        }
        fisicos++;
        printf("  %-8s fisico=%-4d -> canonico=%-4u %s%s\n",
               FUNCOES[i].nome, FUNCOES[i].fisico, FUNCOES[i].canonico,
               nome_de(FUNCOES[i].canonico),
               FUNCOES[i].fisico == (int)FUNCOES[i].canonico
                   ? "  (identico, passthrough)"
                   : "  (TRADUZIDO)");
    }
    for (size_t e = 0; e < N_EIXOS; e++) {
        if (!EIXOS[e].calibrado) {
            printf("  %-8s SEM calibracao no mapa — o valor cru vai para a faixa\n",
                   EIXOS[e].chave);
            continue;
        }
        printf("  %-8s %d..%d -> %d..%d%s\n", EIXOS[e].chave, EIXOS[e].min,
               EIXOS[e].max, EIXO_MIN, EIXO_MAX,
               EIXOS[e].min > EIXOS[e].max ? "  (INVERTIDO)" : "");
    }
    printf("total: %d de %zu botoes do contrato presentes\n", fisicos, N_FUNCOES);
}

int main(int argc, char **argv)
{
    const char *mapa = "/etc/giochi/buttons.map";
    int verboso = 0;
    int so_listar = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--mapa") == 0 && i + 1 < argc) {
            mapa = argv[++i];
        } else if (strcmp(argv[i], "--verboso") == 0) {
            verboso = 1;
        } else if (strcmp(argv[i], "--listar") == 0) {
            so_listar = 1;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("uso: giochi-gamepad [--mapa CAMINHO] [--verboso] [--listar]\n"
                   "\n"
                   "  --mapa     padrao /etc/giochi/buttons.map\n"
                   "  --listar   imprime o layout canonico e o que o mapa resolveu,\n"
                   "             sem criar device nenhum (serve para conferir um\n"
                   "             aparelho novo)\n"
                   "  --verboso  loga cada botao traduzido\n");
            return 0;
        }
    }

    if (ler_mapa(mapa) != 0) {
        return 1;
    }

    if (so_listar) {
        listar();
        return 0;
    }

    int fds[MAX_FD];
    int n_fds = descobrir(fds, MAX_FD);
    if (!n_fds) {
        fprintf(stderr, "giochi-gamepad: nenhum /dev/input/event* tem os botoes deste mapa\n");
        return 1;
    }

    int ufd = criar_uinput();
    if (ufd < 0) {
        for (int i = 0; i < n_fds; i++) {
            close(fds[i]);
        }
        return 1;
    }
    fprintf(stderr, "giochi-gamepad: 'Giochi Gamepad' criado (eixos %d..%d, %d device(s) fisico(s))\n",
            EIXO_MIN, EIXO_MAX, n_fds);

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = ao_sinal;
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);

    struct pollfd pfd[MAX_DEV];
    for (int i = 0; i < n_fds; i++) {
        pfd[i].fd = fds[i];
        pfd[i].events = POLLIN;
    }

    while (!parar) {
        int r = poll(pfd, (nfds_t)n_fds, 2000);
        if (r < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        if (r == 0) {
            /* Janela para um controle USB que apareceu depois do boot: e o
             * caso que `SDL_NumJoysticks` sozinho nao detecta (§12.66, item 8),
             * e o mesmo descuido faria o virtual ignora-lo. */
            int antes = n_fds;
            int novos[MAX_FD];
            int achados = descobrir(novos, MAX_FD);
            for (int i = 0; i < achados && n_fds < MAX_DEV; i++) {
                int repetido = 0;
                for (int k = 0; k < n_fds; k++) {
                    if (fds[k] == novos[i]) {
                        repetido = 1;
                    }
                }
                if (repetido) {
                    continue;
                }
                fds[n_fds] = novos[i];
                pfd[n_fds].fd = novos[i];
                pfd[n_fds].events = POLLIN;
                n_fds++;
            }
            for (int i = 0; i < achados; i++) {
                int usado = 0;
                for (int k = 0; k < n_fds; k++) {
                    if (fds[k] == novos[i]) {
                        usado = 1;
                    }
                }
                if (!usado) {
                    close(novos[i]);
                }
            }
            (void)antes;
            continue;
        }

        for (int i = 0; i < n_fds; i++) {
            if (!(pfd[i].revents & POLLIN)) {
                continue;
            }
            struct input_event ev[64];
            ssize_t lido = read(fds[i], ev, sizeof(ev));
            if (lido <= 0) {
                continue;
            }
            int qtd = (int)(lido / (ssize_t)sizeof(struct input_event));
            for (int k = 0; k < qtd; k++) {
                if (ev[k].type == EV_KEY) {
                    if (ev[k].value == 2) {
                        continue; /* repeticao nao muda estado */
                    }
                    int f = funcao_do_fisico((int)ev[k].code);
                    if (f < 0) {
                        continue;
                    }
                    struct input_event out;
                    memset(&out, 0, sizeof(out));
                    out.type = EV_KEY;
                    out.code = FUNCOES[f].canonico;
                    out.value = ev[k].value;
                    if (write(ufd, &out, sizeof(out)) < 0) {
                        if (verboso) {
                            perror("giochi-gamepad: write EV_KEY");
                        }
                    } else if (verboso) {
                        fprintf(stderr, "  %-8s phys=%u -> canon=%u v=%d\n",
                                FUNCOES[f].nome, ev[k].code,
                                FUNCOES[f].canonico, ev[k].value);
                    }
                } else if (ev[k].type == EV_ABS) {
                    int e = eixo_do_fisico((int)ev[k].code);
                    if (e < 0) {
                        continue;
                    }
                    struct input_event out;
                    memset(&out, 0, sizeof(out));
                    out.type = EV_ABS;
                    out.code = EIXOS[e].canonico;
                    out.value = normalizar(&EIXOS[e], (int)ev[k].value);
                    if (write(ufd, &out, sizeof(out)) < 0 && verboso) {
                        perror("giochi-gamepad: write EV_ABS");
                    }
                }
            }
        }
    }

    fprintf(stderr, "giochi-gamepad: encerrando\n");
    ioctl(ufd, UI_DEV_DESTROY);
    close(ufd);
    for (int i = 0; i < n_fds; i++) {
        close(fds[i]);
    }
    return 0;
}
