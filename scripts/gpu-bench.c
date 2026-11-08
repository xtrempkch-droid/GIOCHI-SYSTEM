/*
 * gpu-bench — throughput de GPU em números comparáveis entre aparelhos.
 * ============================================================
 *
 * Por que isto existe, e por que não é `glmark2`.
 *
 * A pergunta que este arquivo responde é de COMPARAÇÃO: "o Mali-G52 da X55 é
 * mais rápido que o Mali-G31 do R35S, no NOSSO stack (Mesa/panfrost)?". O
 * `glmark2` daria uma nota única e bonita — e esconderia justamente o que
 * interessa, porque ele mistura CPU, GPU, resolução e driver num número só. Se
 * a X55 perder, com uma nota única ninguém sabe se foi a GPU ou o driver.
 *
 * Então medimos as partes separadas, na mesma unidade nos dois aparelhos:
 *
 *   fill      taxa de preenchimento (pixels/s)        — teto de fragmentos
 *   alu       ALU de fragmento (GFLOP/s)              — teto de shader
 *   tex       amostragem de textura (texels/s)        — filtro bilinear + cache
 *   blend     overdraw com mistura (frags/s)          — ROP + banda de memória
 *   draw      muitas chamadas pequenas (draws/s)      — CPU + driver, não GPU
 *   verts     muitos vértices (verts/s)               — geometria
 *   compute   shader de computação (GFLOP/s)          — GLES 3.1
 *
 * E duas de CPU, medidas no MESMO processo, porque sem elas não há como atribuir
 * a diferença: A35 @ 1,3 GHz contra A55 @ 1,8 GHz muda o resultado de um jogo
 * mesmo com a GPU idêntica.
 *
 *   cpu_fma   ALU escalar de um núcleo (MFLOP/s)
 *   cpu_memcpy banda de cópia (GB/s)
 *
 * Três decisões de desenho, cada uma contra um jeito de medir errado:
 *
 * 1. **Tudo offscreen, em FBO.** O launcher pode estar rodando e segurando o
 *    DRM master no `card0` — e um benchmark que tenta abrir o display falha ou
 *    (pior) troca o modo de vídeo de um aparelho em uso. Usamos a plataforma
 *    *surfaceless* do EGL e renderizamos num FBO, então o panfrost é aberto pelo
 *    render node e ninguém disputa nada.
 *
 * 2. **`glFinish()` antes de parar o cronômetro.** Sem isso mede-se "quanto o
 *    processo entregou comandos", não "quanto a GPU terminou" — e o número fica
 *    bonito e falso. Dentro do laço não há `glFinish`: a fila é deixada encher
 *    de propósito, porque throughput é o que se quer (latência seria outro
 *    teste, com outro desenho).
 *
 * 3. **Cada teste roda até `--tempo` segundos, não um número fixo de quadros.**
 *    Um G52 a 800 MHz e um G31 a 400 MHz cabem em contagens de quadro muito
 *    diferentes; cronômetro fixo deixa os dois na mesma régua.
 *
 * Armadilha medida que este arquivo evita: a **frequência**. O RK3566 sobe a GPU
 * de 200 a 800 MHz por `simple_ondemand`. Medir nos primeiros 50 ms pega a GPU
 * ainda a 200 MHz e entrega um quinto do número real. O programa lê
 * `/sys/class/devfreq*/cur_freq` depois de cada teste e imprime o máximo
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

#define FS_HEAD                                                                 \
    "#version 300 es\n"                                                         \
    "precision highp float;\n"

/* Preenchimento puro: sem textura, sem blending, sem varying lido. O teto de
 * rasterização + ROP de escrita. */
static const char *FS_FILL = FS_HEAD "out vec4 o;\n"
                                     "void main() { o = vec4(0.25, 0.5, 0.75, 1.0); }\n";

/* ALU de fragmento. QUATRO cadeias independentes de propósito: uma só seria
 * latência (dependente), não throughput. Cada iteração é um vec4 FMA por
 * cadeia, e um vec4 FMA custa 4 multiply + 4 add em escalares. */
static const char *FS_ALU = FS_HEAD
    "uniform vec4 u_seed;\n"
    "out vec4 o;\n"
    "void main() {\n"
    "  vec4 a = u_seed.xyzw, b = u_seed.yzwx, c = u_seed.zwxy, d = u_seed.wxyz;\n"
    "  for (int i = 0; i < 64; i++) {\n"
    "    a = a * 1.0001 + 0.250;\n"
    "    b = b * 0.9999 + 0.500;\n"
    "    c = c * 1.0003 + 0.750;\n"
    "    d = d * 0.9997 + 1.000;\n"
    "  }\n"
    "  o = a + b + c + d;\n"
    "}\n";

/* Oito amostragens bilineares por pixel, em coordenadas espalhadas pela textura
 * inteira (`fract` de múltiplos diferentes). Amostrar sempre o mesmo texel
 * mediria o cache, não o amostrador. */
static const char *FS_TEX = FS_HEAD
    "uniform sampler2D u_tex;\n"
    "in vec2 v_uv;\n"
    "out vec4 o;\n"
    "void main() {\n"
    "  vec4 s = vec4(0.0);\n"
    "  for (int k = 0; k < 8; k++) {\n"
    "    float m = 1.0 + float(k) * 0.37;\n"
    "    s += texture(u_tex, fract(v_uv * m + vec2(0.013 * float(k), 0.029 * float(k))));\n"
    "  }\n"
    "  o = s * 0.125;\n"
    "}\n";

/* Shader de computação (GLES 3.1). Cadeia dependente de propósito aqui: em
 * compute o que se mede é vazão de ALU por invocação, e a cadeia dependente é a
 * forma que o compilador não consegue reordenar para "esconder" o custo. */
static const char *CS_MUL = FS_HEAD "layout(local_size_x = 64) in;\n"
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

/* Roda `draw` em laço até fechar `min_time`, e devolve segundos decorridos.
 * `glFinish` só no fim: dentro do laço, a fila de comandos cheia é o que se
 * quer medir. */
static double run(void (*draw)(void), int *frames)
{
    double t0 = now();
    int n = 0;

    do {
        draw();
        n++;
    } while (now() - t0 < min_time);

    glFinish();
    *frames = n;
    note_clock();
    return now() - t0;
}

static void report(const char *metric, double value, const char *unit)
{
    printf("  %-28s %12.2f %s\n", metric, value, unit);
    fflush(stdout);
}

/* --------------------------------------------------------------- aparelho -- */

static GLuint vbo_tri, vbo_mesh, vbo_verts;
static GLuint prog_fill, prog_alu, prog_tex, prog_vert, prog_mesh;
static GLuint tex, fbo, tex_fbo;
static GLuint ssbo;

/* Estado corrente de cada desenho. */
/* --- preenchimento --- */
static void draw_fill(void)
{
    glUseProgram(prog_fill);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3);
}

/* --- ALU --- */
static void draw_alu(void)
{
    glUseProgram(prog_alu);
    glUniform4f(glGetUniformLocation(prog_alu, "u_seed"), 0.1f, 0.2f, 0.3f, 0.4f);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3);
}

/* --- textura --- */
static void draw_tex(void)
{
    glUseProgram(prog_tex);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, tex);
    glUniform1i(glGetUniformLocation(prog_tex, "u_tex"), 0);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3);
}

/* --- blending: oito passadas de tela cheia, alpha 0,125 --- */
static void draw_blend(void)
{
    int i;
    glUseProgram(prog_fill);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_tri);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    for (i = 0; i < 8; i++)
        glDrawArrays(GL_TRIANGLES, 0, 3);
    glDisable(GL_BLEND);
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
        glUniform2f(glGetUniformLocation(prog_mesh, "u_off"), x, y);
        glDrawArrays(GL_TRIANGLES, 0, 36);
    }
}

/* --- vértices: 200 mil triângulos minúsculos numa chamada só --- */
static void draw_verts(void)
{
    glUseProgram(prog_vert);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_verts);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 200000 * 3);
}

/* ---------------------------------------------------------------- compute -- */

typedef void (*pfn_dispatch)(GLuint, GLuint, GLuint);
typedef void (*pfn_bind_image)(GLuint, GLuint, GLuint, GLint, GLboolean, GLint, GLenum, GLenum);
typedef void (*pfn_barrier)(GLbitfield);

static pfn_dispatch p_dispatch;
static pfn_bind_image p_bind_image;
static pfn_barrier p_barrier;

static void draw_compute(void)
{
    p_bind_image(0, ssbo, GL_RGBA32F, 0, GL_FALSE, 0, GL_READ_WRITE, GL_RGBA32F);
    p_dispatch(65536 / 64, 1, 1);
    p_barrier(GL_SHADER_STORAGE_BARRIER_BIT);
}

/* ------------------------------------------------------------------- cpu --- */

#define CPU_FLOPS_PER_FMA 2.0

static void cpu_fma_test(void)
{
    /* Quatro acumuladores para não virar uma cadeia de dependência só. `sink`
     * volátil impede o compilador de apagar o laço inteiro. */
    volatile float sink;
    float a = 1.0f, b = 1.1f, c = 1.2f, d = 1.3f;
    const int iters = 40 * 1000 * 1000;
    double t0, t1;
    int i;

    t0 = now();
    for (i = 0; i < iters; i++) {
        a = a * 1.0001f + 0.25f;
        b = b * 0.9999f + 0.50f;
        c = c * 1.0003f + 0.75f;
        d = d * 0.9997f + 1.00f;
    }
    sink = a + b + c + d;
    t1 = now();

    printf("  %-28s %12.2f %s\n", "cpu_fma", (double)iters * 4 * CPU_FLOPS_PER_FMA / (t1 - t0) / 1e9,
           "GFLOP/s");
    (void)sink;
    fflush(stdout);
}

static void cpu_memcpy_test(void)
{
    const size_t sz = 64u << 20; /* 64 MiB */
    unsigned char *a = malloc(sz), *b = malloc(sz);
    double t0, t1;
    double reps;

    if (!a || !b) {
        printf("  %-28s %12s\n", "cpu_memcpy", "sem memoria");
        free(a);
        free(b);
        return;
    }
    memset(a, 0xa5, sz);
    memset(b, 0x5a, sz);

    /* Aquece e mede numa passada só: 64 MiB cabe no cache de ninguém aqui. */
    t0 = now();
    memcpy(b, a, sz);
    t1 = now();
    reps = 1.0;

    printf("  %-28s %12.2f %s\n", "cpu_memcpy", (double)sz * reps / (t1 - t0) / 1e9, "GB/s");
    free(a);
    free(b);
    fflush(stdout);
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
    prog_vert = program(VS_MESH, FS_FILL, 0);

    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glViewport(0, 0, FB_W, FB_H);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
}

/* -------------------------------------------------------------- sequência -- */

static void test_fill(int w, int h, const char *label)
{
    int frames = 0;
    double dt;

    glViewport(0, 0, w, h);
    draw_fill(); /* aquece: compila shader, sobe clock */
    glFinish();
    dt = run(draw_fill, &frames);
    report(label, (double)w * h * frames / dt / 1e6, "Mpix/s");
}

static void test_alu(int w, int h)
{
    int frames = 0;
    double dt;
    const double flops = 64.0 * 4.0 * 4.0 * 2.0; /* 64 iters, 4 cadeias, vec4, mul+add */

    glViewport(0, 0, w, h);
    draw_alu();
    glFinish();
    dt = run(draw_alu, &frames);
    report("alu_fragment", (double)w * h * frames * flops / dt / 1e9, "GFLOP/s");
}

static void test_tex(int w, int h)
{
    int frames = 0;
    double dt;

    glViewport(0, 0, w, h);
    draw_tex();
    glFinish();
    dt = run(draw_tex, &frames);
    report("texture_bilinear", (double)w * h * frames * 8.0 / dt / 1e6, "Mtexels/s");
}

static void test_blend(int w, int h)
{
    int frames = 0;
    double dt;

    glViewport(0, 0, w, h);
    draw_blend();
    glFinish();
    dt = run(draw_blend, &frames);
    report("blend_overdraw_x8", (double)w * h * frames * 8.0 / dt / 1e6, "Mpix/s");
}

static void test_many_draws(int w, int h)
{
    int frames = 0;
    double dt;

    glViewport(0, 0, w, h);
    draw_many();
    glFinish();
    dt = run(draw_many, &frames);
    report("many_draws_4000", (double)4000 * frames / dt / 1e3, "kdraws/s");
}

static void test_verts(int w, int h)
{
    int frames = 0;
    double dt;

    glViewport(0, 0, w, h);
    draw_verts();
    glFinish();
    dt = run(draw_verts, &frames);
    report("vertex_throughput", (double)200000 * 3 * frames / dt / 1e6, "Mvert/s");
}

static void test_compute(void)
{
    GLint prog = 0;
    GLuint sh = compile(GL_COMPUTE_SHADER, CS_MUL, 1);
    int frames = 0;
    double dt;
    const double flops = 65536.0 * 512.0 * 4.0 * 2.0;

    p_dispatch = (pfn_dispatch)eglGetProcAddress("glDispatchCompute");
    p_bind_image = (pfn_bind_image)eglGetProcAddress("glBindImageTexture");
    p_barrier = (pfn_barrier)eglGetProcAddress("glMemoryBarrier");

    if (p_dispatch == NULL || p_bind_image == NULL || p_barrier == NULL) {
        printf("  %-28s %12s\n", "compute_fma", "SKIP (sem ES 3.1)");
        return;
    }
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
            printf("  %-28s %12s\n", "compute_fma", "SKIP (link falhou)");
            glDeleteProgram(prog);
            glDeleteShader(sh);
            return;
        }
    }
    glDeleteShader(sh);

    glGenBuffers(1, &ssbo);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssbo);
    glBufferData(GL_SHADER_STORAGE_BUFFER, 65536 * 16, NULL, GL_DYNAMIC_COPY);
    glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, ssbo);

    glUseProgram(prog);
    glUniform1ui(glGetUniformLocation(prog, "u_iters"), 512);

    draw_compute();
    glFinish();
    dt = run(draw_compute, &frames);
    if (glGetError() != GL_NO_ERROR) {
        printf("  %-28s %12s\n", "compute_fma", "SKIP (erro GL)");
        return;
    }
    report("compute_fma", flops * frames / dt / 1e9, "GFLOP/s");
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
    printf("  %-28s %s\n", "gpu_clock_max", gpu_mhz_max > 0 ? "" : "(devfreq indisponivel)");
    if (gpu_mhz_max > 0)
        printf("  %-28s %ld MHz\n", "gpu_clock_max", gpu_mhz_max);

    eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglTerminate(dpy);
    return 0;
}
