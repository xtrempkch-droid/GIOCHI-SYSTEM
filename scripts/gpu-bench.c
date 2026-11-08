/*
 * gpu-bench — throughput de GPU em números comparáveis entre aparelhos.
 * ============================================================
 *
 * Por que isto existe, e por que não é `glmark2`.
 *
 * A pergunta que este arquivo responde é de COMPARAÇÃO: "o Mali-G52 da X55 é
 * mais rápido que o Mali-G31 do R35S, no NOSSO stack (Mesa/panfrost)?". O
 * `glmark2` daria uma nota única e bonita — e esconderia justamente o que
 * interessa, porque ele mistura CPU, GPU, resolução e driver num número só.
 *
 * Então medimos as partes separadas, na mesma unidade nos dois aparelhos:
 *
 *   fill      taxa de preenchimento (pixels/s)        — teto de fragmentos
 *   alu       ALU de fragmento (GFLOP/s)              — teto de shader
 *   tex       amostragem de textura (texels/s)        — filtro bilinear + cache
 *   blend     overdraw com mistura (frags/s)          — ROP + banda de memória
 *   draw      muitas chamadas pequenas (kdraws/s)     — CPU + driver, não GPU
 *   verts     muitos vértices (verts/s)               — geometria
 *   compute   shader de computação (GFLOP/s)          — GLES 3.1
 *
 * E duas de CPU, no MESMO processo, porque sem elas não há como atribuir a
 * diferença: A35 @ 1,3 GHz contra A55 @ 1,8 GHz muda o resultado de um jogo
 * mesmo com a GPU idêntica.
 *
 *   cpu_fma   ALU escalar de um núcleo (GFLOP/s)
 *   cpu_memcpy banda de cópia (GB/s)
 *
 * ---------------------------------------------------------------------------
 * As quatro maneiras de medir errado, todas encontradas na primeira execução
 * deste arquivo (08/11/2026, X55) — e todas com a mesma cara: número plausível.
 * ---------------------------------------------------------------------------
 *
 * 1. **Quad de cor constante vira `clear`.** O panfrost reconhece "tile inteiro
 *    com a mesma cor" e troca por limpeza de tile. A primeira versão media
 *    3793 Mpix/s em 640x480 e 12208 Mpix/s em 1280x720 — o número MENOR em mais
 *    pixels denuncia o absurdo. Correção: o shader lê `gl_FragCoord`, e o
 *    resultado passa a depender da posição; nenhuma otimização de tile se
 *    aplica.
 *
 * 2. **Cálculo que só depende de uniform é feito UMA vez.** O teste de ALU
 *    antigo lia só `u_seed`, então o compilador do driver podia calcular o
 *    resultado por quad e transmitir. Marcava 8660 GFLOP/s num G52 de ~50
 *    GFLOP/s. Correção: a semente sai de `gl_FragCoord`, invocação por
 *    invocação.
 *
 * 3. **`memcpy` de buffer que ninguém lê é apagado.** O compilador do host
 *    eliminou a cópia e o resultado saiu `inf GB/s`. Correção: os buffers são
 *    lidos (checksum) depois da medida, com acumulador volátil.
 *
 * 4. **`glGetUniformLocation` dentro do laço de desenho.** Cada chamada faz
 *    busca por string na Mesa; 4000 por quadro dominavam o teste de submissão.
 *    Correção: todas as localizações são resolvidas uma vez, no setup.
 *
 * E a trava que impede tudo isso de voltar: **cada teste confere que desenhou.**
 * O FBO é limpo com cor sentinela, um pixel é lido de volta com `glReadPixels`,
 * e o teste que não escreveu nada sai como `INVALIDO` em vez de imprimir um
 * número bonito. É o §12.30 aplicado a benchmark: perguntar pela consequência
 * ("o pixel mudou?"), não pela intenção ("o comando foi enviado?").
 *
 * ---------------------------------------------------------------------------
 * Três decisões de desenho
 * ---------------------------------------------------------------------------
 *
 * 1. **Tudo offscreen, em FBO.** O launcher pode estar rodando e segurando o
 *    DRM master no `card0` — e um benchmark que tenta abrir o display falha ou
 *    (pior) troca o modo de vídeo de um aparelho em uso. Usamos a plataforma
 *    *surfaceless* do EGL e renderizamos num FBO, então o panfrost é aberto pelo
 *    render node e ninguém disputa nada.
 *
 * 2. **`glFinish()` antes de parar o cronômetro.** Sem isso mede-se "quanto o
 *    processo entregou comandos", não "quanto a GPU terminou". Dentro do laço
 *    não há `glFinish`: a fila é deixada encher de propósito, porque throughput
 *    é o que se quer (latência seria outro teste, com outro desenho).
 *
 * 3. **Cada teste roda até `--tempo` segundos, não um número fixo de quadros.**
 *    Um G52 a 800 MHz e um G31 a 400 MHz cabem em contagens de quadro muito
 *    diferentes; cronômetro fixo deixa os dois na mesma régua.
 *
 * Armadilha da frequência: o RK3566 sobe a GPU de 200 a 800 MHz por
 * `simple_ondemand`. Medir nos primeiros 50 ms pega a GPU ainda a 200 MHz e
 * entrega um quinto do número real. O programa lê
 * `/sys/class/devfreq/<no>/cur_freq` depois de cada teste e imprime o máximo
 * observado; o script `gpu-bench.sh` fixa o governor em `performance` durante a
 * bateria e restaura no fim (com `trap`).
 *
 * Compilar com o cross-toolchain do próprio build (`scripts/gpu-bench.sh`), e
 * rodar no aparelho. Não entra na imagem.
 */

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl31.h>

#ifndef EGL_PLATFORM_SURFACELESS_MESA
#define EGL_PLATFORM_SURFACELESS_MESA 0x31DD
#endif

/* Tamanho do FBO: o maior viewport usado. O teste escolhe quanto dele pinta. */
#define FB_W 1280
#define FB_H 720

/* Segundos por medida. 0,35 s é o suficiente para o `simple_ondemand` subir o
 * clock e para o ruído de agendamento desaparecer, sem deixar a bateria de um
 * handheld de 1 GB quente o bastante para acelerar o teste seguinte. */
static double min_time = 0.35;

static long gpu_mhz_max = -1;
static int falhas = 0;

static double now(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

/* ---------------------------------------------------------------- devfreq -- */

/* Devolve a frequência corrente da GPU em Hz, ou -1. Procura pelo `name` do nó,
 * porque o caminho muda com o SoC: `fde60000.gpu` no RK3566, `ff400000.gpu` no
 * RK3326. Fixar o caminho funcionaria num aparelho e devolveria -1 no outro — o
 * mesmo erro do §12.24 (literal de aparelho em script de propósito geral). */
static long gpu_freq(void)
{
    DIR *d = opendir("/sys/class/devfreq");
    long best = -1;
    struct dirent *e;

    if (!d)
        return -1;

    while ((e = readdir(d)) != NULL) {
        char path[512], name[64] = {0};
        FILE *f;

        if (e->d_name[0] == '.')
            continue;

        snprintf(path, sizeof path, "/sys/class/devfreq/%s/name", e->d_name);
        f = fopen(path, "r");
        if (!f)
            continue;
        if (fgets(name, sizeof name, f) == NULL)
            name[0] = '\0';
        fclose(f);
        name[strcspn(name, "\n")] = '\0';

        if (strstr(name, "gpu") == NULL)
            continue;

        snprintf(path, sizeof path, "/sys/class/devfreq/%s/cur_freq", e->d_name);
        f = fopen(path, "r");
        if (!f)
            continue;
        {
            long v = -1;
            if (fscanf(f, "%ld", &v) == 1 && v > best)
                best = v;
        }
        fclose(f);
    }
    closedir(d);
    return best;
}

static void note_clock(void)
{
    long hz = gpu_freq();
    if (hz > 0 && hz / 1000000 > gpu_mhz_max)
        gpu_mhz_max = hz / 1000000;
}

/* ---------------------------------------------------------------- shaders -- */

static const char *VS_QUAD =
    "#version 300 es\n"
    "in vec2 a_pos;\n"
    "out vec2 v_uv;\n"
    "void main() {\n"
    "  v_uv = a_pos * 0.5 + 0.5;\n"
    "  gl_Position = vec4(a_pos, 0.0, 1.0);\n"
    "}\n";

static const char *VS_MESH =
    "#version 300 es\n"
    "in vec2 a_pos;\n"
    "uniform vec2 u_off;\n"
    "void main() {\n"
    "  gl_Position = vec4(a_pos + u_off, 0.0, 1.0);\n"
    "}\n";

#define FS_HEAD                                                                \
    "#version 300 es\n"                                                        \
    "precision highp float;\n"

/* Preenchimento: a cor SAI DA POSIÇÃO. Sem isso o panfrost transforma o tile
 * inteiro num `clear` e a medida deixa de ser taxa de fragmento (item 1 do
 * comentário de cima). A divisão por 4096 é potência de dois, então o valor
 * esperado é exato e dá para conferir no readback. */
static const char *FS_FILL = FS_HEAD
    "uniform float u_cycle;\n"
    "out vec4 o;\n"
    "void main() {\n"
    "  o = vec4(gl_FragCoord.x / 4096.0, gl_FragCoord.y / 4096.0, 0.5, 1.0);\n"
    "  o.rgb *= u_cycle;\n"
    "}\n";

/* ALU de fragmento. QUATRO cadeias independentes de propósito: uma só seria
 * latência (dependente), não throughput. Cada iteração é um vec4 FMA por
 * cadeia, e um vec4 FMA custa 4 multiply + 4 add em escalares.
 *
 * A semente vem de `gl_FragCoord`, e não de um uniform: cálculo que só depende
 * de uniform é feito uma vez por quad (item 2 do comentário de cima). */
static const char *FS_ALU = FS_HEAD
    "uniform float u_cycle;\n"
    "out vec4 o;\n"
    "void main() {\n"
    "  vec4 s = vec4(gl_FragCoord.x * 1e-4, gl_FragCoord.y * 1e-4, 0.5, 0.25);\n"
    "  vec4 a = s, b = s.yzwx, c = s.zwxy, d = s.wxyz;\n"
    "  for (int i = 0; i < 64; i++) {\n"
    "    a = a * (1.0 + a * 0.0001) + 0.250;\n"
    "    b = b * (1.0 - b * 0.0001) + 0.500;\n"
    "    c = c * (1.0 + c * 0.0002) + 0.750;\n"
    "    d = d * (1.0 - d * 0.0002) + 1.000;\n"
    "  }\n"
    "  o = a + b + c + d;\n"
    "  o.rgb *= u_cycle;\n"
    "  o.a = 1.0;\n"
    "}\n";

/* Oito amostragens bilineares por pixel, em coordenadas espalhadas pela textura
 * inteira (`fract` de múltiplos diferentes). Amostrar sempre o mesmo texel
 * mediria o cache, não o amostrador. */
static const char *FS_TEX = FS_HEAD
    "uniform sampler2D u_tex;\n"
    "uniform float u_cycle;\n"
    "in vec2 v_uv;\n"
    "out vec4 o;\n"
    "void main() {\n"
    "  vec4 s = vec4(0.0);\n"
    "  for (int k = 0; k < 8; k++) {\n"
    "    float m = 1.0 + float(k) * 0.37;\n"
    "    s += texture(u_tex, fract(v_uv * m + vec2(0.013 * float(k), 0.029 * float(k))));\n"
    "  }\n"
    "  o = s * 0.125;\n"
    "  o.rgb *= u_cycle;\n"
    "  o.a = 1.0;\n"
    "}\n";

/* Shader de computação: precisa de `310 es`, não de `300 es` — SSBO entrou no
 * ES 3.1. Com o cabeçalho errado ele não compila, e a primeira versão deste
 * arquivo anunciava "SKIP (sem ES 3.1)" num aparelho que tem 3.1. */
static const char *CS_MUL =
    "#version 310 es\n"
    "precision highp float;\n"
    "layout(local_size_x = 64) in;\n"
    "layout(std430, binding = 0) buffer B { vec4 data[]; };\n"
    "uniform uint u_iters;\n"
    "void main() {\n"
    "  uint i = gl_GlobalInvocationID.x;\n"
    "  vec4 v = data[i];\n"
    "  for (uint k = 0u; k < u_iters; k++)\n"
    "    v = v * 1.0001 + vec4(0.5);\n"
    "  data[i] = v;\n"
    "}\n";

/* ------------------------------------------------------------ utilitários -- */

static GLuint compile(GLenum type, const char *src, int soft)
{
    GLuint s = glCreateShader(type);
    GLint ok = 0;
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[4096];
        GLsizei n = 0;
        glGetShaderInfoLog(s, sizeof log, &n, log);
        if (soft) {
            glDeleteShader(s);
            return 0;
        }
        fprintf(stderr, "ERRO: shader nao compilou: %.*s\n", (int)n, log);
        exit(2);
    }
    return s;
}

static GLuint program(const char *vs, const char *fs, int soft)
{
    GLuint v = compile(GL_VERTEX_SHADER, vs, soft);
    GLuint f, p;
    GLint ok = 0;

    if (v == 0)
        return 0;
    f = compile(GL_FRAGMENT_SHADER, fs, soft);
    if (f == 0) {
        glDeleteShader(v);
        return 0;
    }

    p = glCreateProgram();
    glAttachShader(p, v);
    glAttachShader(p, f);
    glBindAttribLocation(p, 0, "a_pos");
    glLinkProgram(p);
    glGetProgramiv(p, GL_LINK_STATUS, &ok);
    glDeleteShader(v);
    glDeleteShader(f);

    if (!ok) {
        char log[4096];
        GLsizei n = 0;
        glGetProgramInfoLog(p, sizeof log, &n, log);
        glDeleteProgram(p);
        if (soft)
            return 0;
        fprintf(stderr, "ERRO: programa nao linkou: %.*s\n", (int)n, log);
        exit(2);
    }
    return p;
}

static void report(const char *metric, double value, const char *unit)
{
    printf("  %-28s %12.2f %s\n", metric, value, unit);
    fflush(stdout);
}

static void invalid(const char *metric, const char *why)
{
    printf("  %-28s %12s  <- %s\n", metric, "INVALIDO", why);
    fflush(stdout);
    falhas++;
}

/* Mede com `glFinish` POR QUADRO, um desenho por quadro.
 *
 * Três medições erraram antes desta, e as três estão registradas porque cada
 * uma parecia certa:
 *
 * 1. **Enfileirar e sincronizar no fim.** 200 quadros custavam 49 ms, um quadro
 *    sincronizado custava 44 ms. A conclusão apressada foi "o lote não executa o
 *    trabalho", e a correção foi medir com `glFinish` por quadro — que é o que
 *    ficou, e está certo. Mas a CAUSA era outra (item 2).
 *
 * 2. **Eliminação de desenho.** A curva t(K) medida no R35S em 08/11/2026, com
 *    o shader de ALU (que custa 141,7 ms por desenho):
 *
 *        K=1  141,673 ms    K=8   141,992 ms
 *        K=2  142,137 ms    K=16  141,960 ms
 *
 *    141 ms × 16 seria 2,3 s; mediu-se 142 ms. Ou seja: **o driver descarta os
 *    15 desenhos anteriores**, porque cada um sobrescreve o quadro inteiro e só
 *    o último determina a imagem. Isso é otimização legítima, e é a explicação
 *    correta do item 1 — não é falha de sincronização.
 *
 *    Consequência para quem mede: **não se pode somar desenhos de tela cheia
 *    numa mesma passada**. O K=1 é o único número com significado, e é o
 *    "custo de desenhar e apresentar um quadro".
 *
 * 3. **Diferenciar K=1 contra K=4 para "tirar o custo fixo".** Como os desenhos
 *    extras são descartados, a diferença media o custo de um desenho que o
 *    driver eliminou: `fill` saiu a 8,9 Gpix/s num G31 cujo pico é ~1 Gpix/s
 *    (nove vezes o teto físico) e `alu`/`tex` caíram para INVALIDO. Número que
 *    excede o teto do hardware não é descoberta, é erro de instrumento.
 *
 * O custo fixo existe e é medido à parte (`custo_glFinish`): uma passada com
 * K=0 no R35S custa 0,080 ms, contra 1,63 ms de um desenho de preenchimento.
 * Ou seja, o `glFinish` não é o problema — 95% do tempo é trabalho de GPU.
 *
 * Devolve o tempo total dos `n` quadros; `*frames` recebe `n`, e quem chama
 * calcula `trabalho_por_quadro × n / dt`. */
static double medir_k(void (*draw)(void), int k, int n)
{
    struct timespec a, b;
    int i, j;

    for (i = 0; i < n; i++) {
        for (j = 0; j < k; j++)
            draw();
        glFinish();
    }
    clock_gettime(CLOCK_MONOTONIC, &a);
    for (i = 0; i < n; i++) {
        for (j = 0; j < k; j++)
            draw();
        glFinish();
    }
    clock_gettime(CLOCK_MONOTONIC, &b);
    return (double)(b.tv_sec - a.tv_sec) + (double)(b.tv_nsec - a.tv_nsec) / 1e9;
}

/* Custo de um quadro VAZIO (só `glFinish`), para o relatório. Não é subtraído de
 * nada: existe para que o leitor veja que o tempo medido não é overhead de
 * sincronização. */
static double custo_vazio = -1;

static double medir(void (*draw)(void), int *frames)
{
    double lat, total;
    int n;

    draw();
    glFinish();

    lat = medir_k(draw, 1, 3) / 3.0;

    n = (int)(0.5 / (lat > 1e-6 ? lat : 1e-6));
    if (n < 5)
        n = 5;
    if (n > 200)
        n = 200;

    /* `medir_k(draw, 0, n)` é o quadro vazio: a mesma volta, sem desenho. */
    if (custo_vazio < 0)
        custo_vazio = medir_k(draw, 0, 20) / 20.0;

    total = medir_k(draw, 1, n);

    *frames = n;
    note_clock();
    return total;
}

/* --------------------------------------------------------------- aparelho -- */

static GLuint vbo_tri, vbo_mesh, vbo_verts;
static GLuint prog_fill, prog_alu, prog_tex, prog_mesh;
static GLuint tex, fbo, tex_fbo;
static GLuint ssbo;

/* Localizações resolvidas UMA vez. `glGetUniformLocation` faz busca por string;
 * chamá-la por desenho transforma o teste de submissão num teste de Mesa
 * (item 4 do comentário de cima). */
static GLint loc_tex, loc_off, loc_cyc_fill, loc_cyc_alu, loc_cyc_tex, loc_cyc_mesh;

/* Contador de quadro. Existe para derrotar a "transaction elimination" do
 * Mali: o tile cujo CRC nao mudou nao e escrito de volta. Redesenhar a MESMA
 * imagem mede a taxa de descarte, nao a de rasterizacao — foi o que produziu
 * 13406 Mpix/s em 1280x720 contra 4426 em 640x480 (o menor em mais pixels). */
static int frame_no = 0;

static void set_cycle(GLint loc)
{
    glUniform1f(loc, (frame_no & 1) ? 0.5f : 1.0f);
}

static void clear_sentinel(void)
{
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glViewport(0, 0, FB_W, FB_H);
    glDisable(GL_BLEND);
    glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
    glClear(GL_COLOR_BUFFER_BIT);
}

static void read_pixel(int x, int y, unsigned char out[4])
{
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glReadPixels(x, y, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, out);
}

/* A trava: prova que o desenho chegou ao framebuffer antes de acreditar no
 * número. Compara só "saiu da cor sentinela", que é o que basta para separar
 * "a GPU desenhou" de "o driver engoliu o comando". */
static int drew_something(int x, int y)
{
    unsigned char px[4];
    read_pixel(x, y, px);
    return !(px[0] == 0 && px[1] == 0 && px[2] == 0 && px[3] == 0);
}

/* Para os testes de geometria: os triângulos são de 2 px e ficam espalhados,
 * então o pixel do centro pode cair no vazio mesmo com o desenho correto. Uma
 * região de 64x64 responde "esta cena tem algo desenhado?" sem depender de
 * onde o acaso colocou um triângulo. */
static int drew_region(int x0, int y0, int lado)
{
    unsigned char buf[64 * 64 * 4];
    int i;

    if (lado > 64)
        lado = 64;
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glReadPixels(x0, y0, lado, lado, GL_RGBA, GL_UNSIGNED_BYTE, buf);
    for (i = 0; i < lado * lado; i++)
        if (buf[i * 4] != 0 || buf[i * 4 + 1] != 0 || buf[i * 4 + 2] != 0 || buf[i * 4 + 3] != 0)
            return 1;
    return 0;
}

/* --- preenchimento --- */
static void draw_fill(void)
{
    glUseProgram(prog_fill);
    set_cycle(loc_cyc_fill);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    frame_no++;
}

/* --- ALU --- */
static void draw_alu(void)
{
    glUseProgram(prog_alu);
    set_cycle(loc_cyc_alu);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    frame_no++;
}

/* --- textura --- */
static void draw_tex(void)
{
    glUseProgram(prog_tex);
    set_cycle(loc_cyc_tex);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    frame_no++;
}

/* --- blending: oito passadas de tela cheia, alpha 0,125 --- */
static void draw_blend(void)
{
    int i;
    glUseProgram(prog_fill);
    set_cycle(loc_cyc_fill);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    for (i = 0; i < 8; i++)
        glDrawArrays(GL_TRIANGLES, 0, 3);
    glDisable(GL_BLEND);
    frame_no++;
}

/* --- muitas chamadas pequenas: 4000 draws de 12 triângulos --- */
static void draw_many(void)
{
    int i;
    glUseProgram(prog_mesh);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_mesh);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    for (i = 0; i < 4000; i++) {
        float x = (float)(i % 80) / 40.0f - 1.0f;
        float y = (float)(i / 80) / 25.0f - 1.0f;
        glUniform2f(loc_off, x, y);
        glDrawArrays(GL_TRIANGLES, 0, 36);
    }
    frame_no++;
}

/* --- vértices: 200 mil triângulos minúsculos numa chamada só --- */
static void draw_verts(void)
{
    glUseProgram(prog_mesh);
    glUniform2f(loc_off, 0.0f, 0.0f);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_verts);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 200000 * 3);
    frame_no++;
}

/* ---------------------------------------------------------------- compute -- */

typedef void (*pfn_dispatch)(GLuint, GLuint, GLuint);
typedef void (*pfn_barrier)(GLbitfield);

static pfn_dispatch p_dispatch;
static pfn_barrier p_barrier;

static void draw_compute(void)
{
    /* Sem `glBindImageTexture`: ele liga IMAGEM de textura, não SSBO — chamá-lo
     * aqui devolvia GL_INVALID_OPERATION e derrubava o teste. O SSBO já está
     * ligado por `glBindBufferBase` no setup. */
    p_dispatch(65536 / 64, 1, 1);
    p_barrier(GL_SHADER_STORAGE_BARRIER_BIT);
}

/* ------------------------------------------------------------------- cpu --- */

#define CPU_FLOPS_PER_FMA 2.0
#define CPU_INTERACOES (40 * 1000 * 1000)

static void cpu_fma_test(void)
{
    /* Quatro acumuladores para não virar uma cadeia de dependência só. `sink`
     * volátil impede o compilador de apagar o laço inteiro. */
    volatile float sink;
    float a = 1.0f, b = 1.1f, c = 1.2f, d = 1.3f;
    double t0, t1;
    int i;

    t0 = now();
    for (i = 0; i < CPU_INTERACOES; i++) {
        a = a * 1.0001f + 0.25f;
        b = b * 0.9999f + 0.50f;
        c = c * 1.0003f + 0.75f;
        d = d * 0.9997f + 1.00f;
    }
    sink = a + b + c + d;
    t1 = now();
    (void)sink;

    report("cpu_fma", (double)CPU_INTERACOES * 4 * CPU_FLOPS_PER_FMA / (t1 - t0) / 1e9,
           "GFLOP/s");
}

static void cpu_memcpy_test(void)
{
    /* 32 MiB: muito maior que qualquer cache destes SoCs, e 64 MiB de RSS no
     * total — cabe nos 981 MiB do R35S com o sistema rodando. */
    const size_t sz = 32u << 20;
    unsigned char *a = malloc(sz), *b = malloc(sz);
    volatile unsigned long sink = 0;
    double melhor = 0;
    int r;
    size_t i;

    if (!a || !b) {
        printf("  %-28s %12s\n", "cpu_memcpy", "sem memoria");
        free(a);
        free(b);
        return;
    }
    memset(a, 0xa5, sz);
    memset(b, 0x5a, sz);

    for (r = 0; r < 3; r++) {
        double t0 = now();
        memcpy(b, a, sz);
        {
            double dt = now() - t0;
            if (melhor <= 0 || dt < melhor)
                melhor = dt;
        }
    }

    /* Lê o destino: sem isto o compilador apaga a cópia e a primeira versão
     * imprimiu `inf GB/s` (item 3 do comentário de cima). */
    for (i = 0; i < sz; i += 4096)
        sink += b[i];
    (void)sink;

    report("cpu_memcpy", (double)sz / melhor / 1e9, "GB/s");
    free(a);
    free(b);
}

/* ------------------------------------------------------------------ setup -- */

static EGLDisplay open_display(void)
{
    /* Surfaceless primeiro, e isso não é preferência: o launcher da X55 segura o
     * DRM master do `card0` enquanto roda. A plataforma `gbm` tentaria virar
     * master e falharia; a surfaceless abre o render node e não disputa nada. */
    PFNEGLGETPLATFORMDISPLAYEXTPROC get_platform =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay dpy = EGL_NO_DISPLAY;

    if (get_platform != NULL) {
        dpy = get_platform(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
        if (dpy != EGL_NO_DISPLAY && eglInitialize(dpy, NULL, NULL))
            return dpy;
        dpy = EGL_NO_DISPLAY;
    }

    dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (dpy == EGL_NO_DISPLAY || !eglInitialize(dpy, NULL, NULL)) {
        fprintf(stderr, "ERRO: sem display EGL (nem surfaceless nem default)\n");
        exit(3);
    }
    return dpy;
}

static void setup_gles(EGLDisplay dpy)
{
    EGLConfig cfg;
    EGLint n = 0;
    EGLint cfg_attr[] = {
        EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE,
    };
    EGLint ctx_attr[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    EGLContext ctx;
    EGLint pb_attr[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
    EGLSurface surf;
    GLenum st;

    if (!eglChooseConfig(dpy, cfg_attr, &cfg, 1, &n) || n == 0) {
        fprintf(stderr, "ERRO: nenhum EGLConfig com OpenGL ES 3\n");
        exit(3);
    }
    ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctx_attr);
    if (ctx == EGL_NO_CONTEXT) {
        fprintf(stderr, "ERRO: nao foi possivel criar contexto ES3\n");
        exit(3);
    }
    /* Pbuffer de 16x16: nada é desenhado nele. Existe porque alguns drivers só
     * aceitam `eglMakeCurrent` com alguma superfície; todo o desenho vai para um
     * FBO. */
    surf = eglCreatePbufferSurface(dpy, cfg, pb_attr);
    if (surf == EGL_NO_SURFACE || !eglMakeCurrent(dpy, surf, surf, ctx)) {
        fprintf(stderr, "ERRO: eglMakeCurrent falhou\n");
        exit(3);
    }
    eglSwapInterval(dpy, 0);

    printf("  %-28s %s\n", "GL_RENDERER", (const char *)glGetString(GL_RENDERER));
    printf("  %-28s %s\n", "GL_VENDOR", (const char *)glGetString(GL_VENDOR));
    printf("  %-28s %s\n", "GL_VERSION", (const char *)glGetString(GL_VERSION));
    printf("  %-28s %s\n", "GL_SHADING_LANGUAGE_VERSION",
           (const char *)glGetString(GL_SHADING_LANGUAGE_VERSION));
    printf("  %-28s %s\n", "EGL_VERSION", (const char *)eglQueryString(dpy, EGL_VERSION));

    st = glGetError();
    if (st != GL_NO_ERROR)
        fprintf(stderr, "AVISO: erro GL no setup: 0x%x\n", st);
}

static void setup_objects(void)
{
    static const GLfloat tri[6] = {-1.0f, -1.0f, 3.0f, -1.0f, -1.0f, 3.0f};
    GLfloat *mesh;
    GLfloat *verts;
    unsigned char *pixels;
    unsigned int seed = 12345u;
    int i, t;

    /* FBO de FB_W x FB_H. Todo teste desenha nele, com viewport menor quando é
     * o caso — assim a taxa de preenchimento não depende do painel do aparelho
     * (720x1280 na X55, 640x480 no R35S). */
    glGenTextures(1, &tex_fbo);
    glBindTexture(GL_TEXTURE_2D, tex_fbo);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, FB_W, FB_H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);

    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex_fbo, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        fprintf(stderr, "ERRO: FBO incompleto\n");
        exit(3);
    }

    glGenBuffers(1, &vbo_tri);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glBufferData(GL_ARRAY_BUFFER, sizeof tri, tri, GL_STATIC_DRAW);

    /* Malha de 12 triângulos para o teste de muitas chamadas. */
    mesh = calloc(36 * 2, sizeof(GLfloat));
    for (i = 0; i < 12; i++) {
        for (t = 0; t < 3; t++) {
            mesh[(i * 3 + t) * 2 + 0] = (GLfloat)((t == 1) ? 0.012 : -0.012);
            mesh[(i * 3 + t) * 2 + 1] = (GLfloat)((t == 2) ? 0.012 : -0.012);
        }
    }
    glGenBuffers(1, &vbo_mesh);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_mesh);
    glBufferData(GL_ARRAY_BUFFER, 36 * 2 * sizeof(GLfloat), mesh, GL_STATIC_DRAW);
    free(mesh);

    /* 200 mil triângulos minúsculos: ~2 px de lado, espalhados pela tela. */
    verts = calloc(200000 * 3 * 2, sizeof(GLfloat));
    for (i = 0; i < 200000; i++) {
        GLfloat cx = (GLfloat)((i * 37) % 1279) / 639.5f - 1.0f;
        GLfloat cy = (GLfloat)((i * 53) % 719) / 359.5f - 1.0f;
        for (t = 0; t < 3; t++) {
            verts[(i * 3 + t) * 2 + 0] = cx + (GLfloat)(t == 0 ? -0.0015 : 0.0015);
            verts[(i * 3 + t) * 2 + 1] = cy + (GLfloat)(t == 1 ? -0.0015 : 0.0015);
        }
    }
    glGenBuffers(1, &vbo_verts);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_verts);
    glBufferData(GL_ARRAY_BUFFER, 200000 * 3 * 2 * sizeof(GLfloat), verts, GL_STATIC_DRAW);
    free(verts);

    /* Textura 1024x1024 RGBA8 com conteúdo pseudoaleatório: se fosse lisa, o
     * cache de textura acertaria tudo e o número não valeria. */
    pixels = malloc(1024u * 1024u * 4u);
    for (i = 0; i < 1024 * 1024 * 4; i++) {
        seed = seed * 1103515245u + 12345u;
        pixels[i] = (unsigned char)(seed >> 16);
    }
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1024, 1024, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
    free(pixels);

    prog_fill = program(VS_QUAD, FS_FILL, 0);
    prog_alu = program(VS_QUAD, FS_ALU, 0);
    prog_tex = program(VS_QUAD, FS_TEX, 0);
    prog_mesh = program(VS_MESH, FS_FILL, 0);

    loc_tex = glGetUniformLocation(prog_tex, "u_tex");
    loc_off = glGetUniformLocation(prog_mesh, "u_off");
    loc_cyc_fill = glGetUniformLocation(prog_fill, "u_cycle");
    loc_cyc_alu = glGetUniformLocation(prog_alu, "u_cycle");
    loc_cyc_tex = glGetUniformLocation(prog_tex, "u_cycle");
    loc_cyc_mesh = glGetUniformLocation(prog_mesh, "u_cycle");

    /* O sampler é estado do programa: uma vez, aqui. */
    glUseProgram(prog_mesh);
    glUniform1f(loc_cyc_mesh, 1.0f);

    glUseProgram(prog_tex);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, tex);
    glUniform1i(loc_tex, 0);

    clear_sentinel();
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
}

/* -------------------------------------------------------------- sequência -- */

static void test_fill(int w, int h, const char *label)
{
    int frames = 0;
    double dt;
    unsigned char px[4];

    frame_no = 0;
    clear_sentinel();
    glViewport(0, 0, w, h);
    draw_fill(); /* aquece: compila shader, sobe clock */
    glFinish();

    read_pixel(w / 2, h / 2, px);
    if (px[3] != 255) {
        invalid(label, "nada foi escrito (pixel alfa != 255)");
        return;
    }
    /* O shader codifica a posição: confere contra o valor esperado, não só
     * contra a sentinela. É a única verificação exata do arquivo. */
    {
        int ex = (int)((double)(w / 2 + 0.5) / 4096.0 * 255.0 + 0.5);
        int ey = (int)((double)(h / 2 + 0.5) / 4096.0 * 255.0 + 0.5);
        if (abs((int)px[0] - ex) > 3 || abs((int)px[1] - ey) > 3) {
            invalid(label, "pixel lido nao casa com o esperado do shader");
            return;
        }
    }

    dt = medir(draw_fill, &frames);
    if (dt <= 0) {
        invalid(label, "CPU-bound nesta carga: a GPU nao e o gargalo");
        return;
    }
    report(label, (double)w * h * frames / dt / 1e6, "Mpix/s");
}

static void test_alu(int w, int h)
{
    int frames = 0;
    double dt;
    /* 64 iters x 4 cadeias x 4 componentes x 4 ops (mul, add, mul, add). */
    const double flops = 64.0 * 4.0 * 4.0 * 4.0;

    frame_no = 0;
    clear_sentinel();
    glViewport(0, 0, w, h);
    draw_alu();
    glFinish();
    if (!drew_something(w / 2, h / 2)) {
        invalid("alu_fragment", "nada foi escrito");
        return;
    }

    dt = medir(draw_alu, &frames);
    report("alu_fragment", (double)w * h * frames * flops / dt / 1e9, "GFLOP/s");
}

static void test_tex(int w, int h)
{
    int frames = 0;
    double dt;

    frame_no = 0;
    clear_sentinel();
    glViewport(0, 0, w, h);
    draw_tex();
    glFinish();
    if (!drew_something(w / 2, h / 2)) {
        invalid("texture_bilinear", "nada foi escrito");
        return;
    }

    dt = medir(draw_tex, &frames);
    report("texture_bilinear", (double)w * h * frames * 8.0 / dt / 1e6, "Mtexels/s");
}

static void test_blend(int w, int h)
{
    int frames = 0;
    double dt;

    frame_no = 0;
    clear_sentinel();
    glViewport(0, 0, w, h);
    draw_blend();
    glFinish();
    if (!drew_something(w / 2, h / 2)) {
        invalid("blend_overdraw_x8", "nada foi escrito");
        return;
    }

    dt = medir(draw_blend, &frames);
    if (dt <= 0) {
        invalid("blend_overdraw_x8", "CPU-bound nesta carga: a GPU nao e o gargalo");
        return;
    }
    report("blend_overdraw_x8", (double)w * h * frames * 8.0 / dt / 1e6, "Mpix/s");
}

static void test_many_draws(int w, int h)
{
    int frames = 0;
    double dt;

    frame_no = 0;
    clear_sentinel();
    glViewport(0, 0, w, h);
    draw_many();
    glFinish();
    if (!drew_region(w / 2 - 32, h / 2 - 32, 64)) {
        invalid("many_draws_4000", "nada foi escrito");
        return;
    }

    dt = medir(draw_many, &frames);
    if (dt <= 0) {
        invalid("many_draws_4000", "CPU-bound nesta carga: a GPU nao e o gargalo");
        return;
    }
    report("many_draws_4000", (double)4000 * frames / dt / 1e3, "kdraws/s");
}

static void test_verts(int w, int h)
{
    int frames = 0;
    double dt;

    frame_no = 0;
    clear_sentinel();
    glViewport(0, 0, w, h);
    draw_verts();
    glFinish();
    if (!drew_region(w / 2 - 32, h / 2 - 32, 64)) {
        invalid("vertex_throughput", "nada foi escrito");
        return;
    }

    dt = medir(draw_verts, &frames);
    report("vertex_throughput", (double)200000 * 3 * frames / dt / 1e6, "Mvert/s");
}

static void test_compute(void)
{
    GLuint prog = 0;
    GLuint sh;
    int frames = 0;
    double dt;
    const double flops = 65536.0 * 512.0 * 4.0 * 2.0;
    float amostra[4];

    p_dispatch = (pfn_dispatch)eglGetProcAddress("glDispatchCompute");
    p_barrier = (pfn_barrier)eglGetProcAddress("glMemoryBarrier");

    if (p_dispatch == NULL || p_barrier == NULL) {
        printf("  %-28s %12s\n", "compute_fma", "SKIP (sem ES 3.1)");
        return;
    }

    sh = compile(GL_COMPUTE_SHADER, CS_MUL, 1);
    if (sh == 0) {
        printf("  %-28s %12s\n", "compute_fma", "SKIP (shader 310 es nao compilou)");
        return;
    }

    prog = glCreateProgram();
    glAttachShader(prog, sh);
    glLinkProgram(prog);
    {
        GLint ok = 0;
        glGetProgramiv(prog, GL_LINK_STATUS, &ok);
        if (!ok) {
            char log[2048];
            GLsizei n = 0;
            glGetProgramInfoLog(prog, sizeof log, &n, log);
            glDeleteProgram(prog);
            glDeleteShader(sh);
            printf("  %-28s %12s (link: %.*s)\n", "compute_fma", "SKIP", (int)n, log);
            return;
        }
    }
    glDeleteShader(sh);

    glGenBuffers(1, &ssbo);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssbo);
    {
        /* Preenchido com 1.0 para o resultado ser previsível: depois de N
         * iterações de v = v*k + 0.5, o valor cresce e deixa de ser 1.0. */
        float *inicial = calloc(65536 * 4, sizeof(float));
        int i;
        for (i = 0; i < 65536 * 4; i++)
            inicial[i] = 1.0f;
        glBufferData(GL_SHADER_STORAGE_BUFFER, 65536 * 16, inicial, GL_DYNAMIC_COPY);
        free(inicial);
    }
    glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, ssbo);

    glUseProgram(prog);
    glUniform1ui(glGetUniformLocation(prog, "u_iters"), 512);

    glFinish();
    draw_compute();
    glFinish();
    if (glGetError() != GL_NO_ERROR) {
        invalid("compute_fma", "erro GL no primeiro dispatch");
        return;
    }

    /* Verifica que o buffer MUDOU: compute shader que não roda devolve o mesmo
     * 1.0 que estava lá, e o tempo seria de um dispatch vazio. */
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssbo);
    {
        const float *p = (const float *)glMapBufferRange(GL_SHADER_STORAGE_BUFFER, 0, 16,
                                                         GL_MAP_READ_BIT);
        if (p == NULL) {
            invalid("compute_fma", "glMapBufferRange falhou; sem verificacao");
            return;
        }
        memcpy(amostra, p, sizeof amostra);
        glUnmapBuffer(GL_SHADER_STORAGE_BUFFER);
    }
    if (amostra[0] == 1.0f && amostra[1] == 1.0f) {
        invalid("compute_fma", "buffer nao mudou; o shader nao rodou");
        return;
    }

    dt = medir(draw_compute, &frames);
    report("compute_fma", flops * frames / dt / 1e9, "GFLOP/s");
}

/* Modo de diagnóstico: `glFinish` por quadro. Mede latência, não throughput.
 * Se o shader caro custar o mesmo que o barato, o problema não é a GPU — é o
 * shader que não está sendo executado, e nenhum número agregado revela isso. */
static double cpu_seg(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

/* Separa CPU de GPU: `wall` alto com `cpu` baixo é espera da GPU; os dois
 * parecidos é o driver ocupado (compilação de shader, validação de estado).
 * Sem essa separação, "44 ms por quadro" não diz quem está trabalhando. */
static void latencia(const char *nome, void (*draw)(void), int n)
{
    struct timespec a, b;
    double total = 0, cpu0, cpu1, cpu = 0, c0, c1, cbat = 0;
    int i;

    draw();
    glFinish();
    for (i = 0; i < n; i++) {
        c0 = cpu_seg();
        clock_gettime(CLOCK_MONOTONIC, &a);
        draw();
        glFinish();
        clock_gettime(CLOCK_MONOTONIC, &b);
        c1 = cpu_seg();
        total += (double)(b.tv_sec - a.tv_sec) * 1e3 + (double)(b.tv_nsec - a.tv_nsec) / 1e6;
        cpu += (c1 - c0) * 1e3;
    }

    /* Mesmo número de quadros, sem `glFinish` entre eles: se o lote sair muito
     * mais barato que a soma das latências, o trabalho foi descartado. */
    cpu0 = cpu_seg();
    clock_gettime(CLOCK_MONOTONIC, &a);
    for (i = 0; i < n; i++)
        draw();
    glFinish();
    {
        /* Readback força a conclusão de verdade: se nem o `glFinish` nem a
         * leitura esperarem, o trabalho não foi executado — não é questão de
         * sincronização. */
        unsigned char px[4];
        read_pixel(0, 0, px);
    }
    clock_gettime(CLOCK_MONOTONIC, &b);
    cpu1 = cpu_seg();
    cbat = (double)(b.tv_sec - a.tv_sec) * 1e3 + (double)(b.tv_nsec - a.tv_nsec) / 1e6;

    printf("  %-14s %9.3f ms/quadro  (cpu %6.3f)   lote de %d: %8.1f ms  (cpu %6.1f)\n",
           nome, total / n, cpu / n, n, cbat, (cpu1 - cpu0) * 1e3);
    fflush(stdout);
}

/* ------------------------------------------------------------------- main -- */

int main(int argc, char **argv)
{
    EGLDisplay dpy;
    int i;

    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--tempo") == 0 && i + 1 < argc)
            min_time = atof(argv[++i]);
    }

    printf("== gpu-bench ==\n");
    note_clock();

    dpy = open_display();
    setup_gles(dpy);
    setup_objects();

    if (getenv("GPU_BENCH_CURVA") != NULL) {
        static const int ks[] = {0, 1, 2, 4, 8, 16};
        int k;
        glViewport(0, 0, 640, 480);
        printf("\n== curva t(K): K desenhos por quadro, um glFinish (640x480) ==\n");
        printf(" fill:\n");
        for (k = 0; k < (int)(sizeof ks / sizeof ks[0]); k++) {
            double t = medir_k(draw_fill, ks[k], 60);
            printf("  K=%-3d %8.3f ms/quadro\n", ks[k], t * 1e3);
        }
        printf(" alu:\n");
        for (k = 1; k < (int)(sizeof ks / sizeof ks[0]); k++) {
            double t = medir_k(draw_alu, ks[k], 12);
            printf("  K=%-3d %8.3f ms/quadro\n", ks[k], t * 1e3);
        }
        return 0;
    }

    if (getenv("GPU_BENCH_LATENCIA") != NULL) {
        glViewport(0, 0, 640, 480);
        printf("\n== latencia (glFinish por quadro, 640x480) ==\n");
        latencia("fill", draw_fill, 200);
        latencia("alu_64_iters", draw_alu, 200);
        latencia("tex_8_amostras", draw_tex, 200);
        return 0;
    }

    printf("\n== CPU (mesmo processo, para atribuir a diferenca) ==\n");
    cpu_fma_test();
    cpu_memcpy_test();

    printf("\n== GPU: preenchimento ==\n");
    test_fill(640, 480, "fill_640x480");
    test_fill(1280, 720, "fill_1280x720");

    printf("\n== GPU: shader de fragmento ==\n");
    test_alu(640, 480);

    printf("\n== GPU: textura ==\n");
    test_tex(640, 480);

    printf("\n== GPU: mistura (overdraw) ==\n");
    test_blend(640, 480);

    printf("\n== GPU: submissao (CPU-driver) ==\n");
    test_many_draws(640, 480);

    printf("\n== GPU: geometria ==\n");
    test_verts(640, 480);

    printf("\n== GPU: compute (ES 3.1) ==\n");
    test_compute();

    printf("\n== resumo ==\n");
    if (custo_vazio > 0)
        printf("  %-28s %.3f ms (nao subtraido; mostra que o tempo medido e' de GPU)\n",
               "custo_glFinish_vazio", custo_vazio * 1e3);
    if (gpu_mhz_max > 0)
        printf("  %-28s %ld MHz\n", "gpu_clock_max", gpu_mhz_max);
    else
        printf("  %-28s %s\n", "gpu_clock_max", "(devfreq indisponivel)");
    printf("  %-28s %d\n", "testes_invalidos", falhas);

    eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglTerminate(dpy);
    return falhas == 0 ? 0 : 1;
}
