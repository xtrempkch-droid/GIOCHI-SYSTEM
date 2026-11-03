/*
 * gles-probe — o que a GPU realmente entrega.
 * ============================================================
 *
 * Por que isto existe, e por que não é `es2_info`.
 *
 * O documento do projeto diz "GLES 3.1 no panfrost". Isso é EXPECTATIVA, não
 * medida — e a diferença decide coisas concretas: Godot 4 em Compatibility
 * assume GLES 3.0+, melonDS pede GL 3.2, e o teto de shader muda o que a UI
 * pode desenhar.
 *
 * A alternativa natural seria `BR2_PACKAGE_MESA3D_DEMOS`, que traz `es2_info` e
 * `eglinfo`. Foi recusada por dois motivos:
 *
 *   1. traz um pacote inteiro (mais demos, mais dependências) para responder uma
 *      pergunta de três linhas;
 *   2. se o pacote sair da imagem depois, a medição sai com ele — e aí o número
 *      que justificou uma decisão deixa de ser reproduzível.
 *
 * Este arquivo é compilado pelo cross-toolchain que já existe em
 * `work/<device>/build/host/bin/`, ligado ESTATICAMENTE, e copiado para o
 * aparelho por SSH. Não entra na imagem, não muda o rootfs, e pode ser repetido
 * em qualquer aparelho a qualquer momento:
 *
 *   bash scripts/gles-probe.sh powkiddy-x35h          # compila
 *   scp ... e roda no aparelho                        # ou --run, se houver SSH
 *
 * Quando o número estabilizar, aí sim vale embutir a saída no `giochi-selftest`
 * como uma linha de texto — mas o binário continua sendo a fonte.
 *
 * Compilar fora do build também evita o problema de ordem: um probe embutido no
 * `giochi-selftest` roda no boot, quando o módulo do DRM pode ainda não ter
 * subido, e o resultado vira falso negativo.
 */

#include <stdio.h>
#include <string.h>

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>

/* Devolve o que o EGL declarar, sem inventar: se não houver string, diz isso. */
static const char *str(const char *v)
{
    return (v && *v) ? v : "(nao informado)";
}

int main(void)
{
    EGLDisplay dpy;
    EGLConfig cfg;
    EGLContext ctx;
    EGLSurface surf;
    EGLint major = 0, minor = 0;
    EGLint n = 0;

    /*
     * EGL_DEFAULT_DISPLAY depende de o processo ter acesso ao device node do
     * DRM. Sem isso o EGL abre e o eglInitialize falha com
     * EGL_NOT_INITIALIZED — que é um resultado útil, não um erro do probe:
     * significa "esta execução não fala com a GPU".
     */
    dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (dpy == EGL_NO_DISPLAY) {
        printf("eglGetDisplay: EGL_NO_DISPLAY\n");
        printf("VEREDITO: sem display EGL (permissao em /dev/dri?)\n");
        return 2;
    }

    if (!eglInitialize(dpy, &major, &minor)) {
        printf("eglInitialize falhou: 0x%x\n", eglGetError());
        printf("VEREDITO: EGL nao inicializou\n");
        return 2;
    }

    printf("EGL_VENDOR   = %s\n", str(eglQueryString(dpy, EGL_VENDOR)));
    printf("EGL_VERSION  = %s\n", str(eglQueryString(dpy, EGL_VERSION)));
    printf("EGL_CLIENT_APIS = %s\n", str(eglQueryString(dpy, EGL_CLIENT_APIS)));

    /* Extensões contadas, não despejadas: a lista inteira são milhares de
     * caracteres e ninguém lê. O que interessa é se as três que decidem
     * suporte existem. */
    {
        const char *ext = eglQueryString(dpy, EGL_EXTENSIONS);
        int total = 0;
        const char *p;
        if (ext) {
            for (p = ext; *p; p++)
                if (*p == ' ')
                    total++;
            total++;
        }
        printf("EGL_EXTENSOES = %d\n", total);
        printf("  KHR_create_context        = %s\n",
               (ext && strstr(ext, "EGL_KHR_create_context")) ? "sim" : "nao");
        printf("  EXT_platform_device       = %s\n",
               (ext && strstr(ext, "EGL_EXT_platform_device")) ? "sim" : "nao");
        printf("  MESA_query_driver         = %s\n",
               (ext && strstr(ext, "EGL_MESA_query_driver")) ? "sim" : "nao");
    }

    /*
     * GLES3 primeiro e GLES2 como queda. A ordem importa: pedir ES3 num driver
     * que só tem ES2 falha o eglChooseConfig, e concluir "sem GL" a partir
     * disso seria medir a pergunta errada.
     */
    {
        EGLint cfgs[] = {
            EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
            EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
            EGL_NONE
        };
        if (!eglChooseConfig(dpy, cfgs, &cfg, 1, &n) || n == 0) {
            EGLint cfgs2[] = {
                EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
                EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
                EGL_NONE
            };
            printf("config ES3: nenhuma — caindo para ES2\n");
            if (!eglChooseConfig(dpy, cfgs2, &cfg, 1, &n) || n == 0) {
                printf("VEREDITO: nenhum config GLES renderable\n");
                return 3;
            }
        }
    }

    {
        EGLint attrs[] = { EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE };
        ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, attrs);
        if (ctx == EGL_NO_CONTEXT) {
            EGLint attrs2[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE };
            printf("contexto ES3: falhou — tentando ES2\n");
            ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, attrs2);
        }
    }
    if (ctx == EGL_NO_CONTEXT) {
        printf("eglCreateContext falhou: 0x%x\n", eglGetError());
        printf("VEREDITO: sem contexto GLES\n");
        return 3;
    }

    {
        EGLint pattrs[] = { EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE };
        surf = eglCreatePbufferSurface(dpy, cfg, pattrs);
    }
    if (surf == EGL_NO_SURFACE) {
        printf("eglCreatePbufferSurface falhou: 0x%x\n", eglGetError());
        printf("VEREDITO: sem surface (o probe nao precisa de tela, mas o "
               "driver pode exigir)\n");
        return 3;
    }

    if (!eglMakeCurrent(dpy, surf, surf, ctx)) {
        printf("eglMakeCurrent falhou: 0x%x\n", eglGetError());
        printf("VEREDITO: contexto criado mas nao ativado\n");
        return 3;
    }

    /* As quatro linhas que respondem a pergunta. */
    printf("\n--- GLES ---\n");
    printf("GL_VENDOR    = %s\n", str((const char *)glGetString(GL_VENDOR)));
    printf("GL_RENDERER  = %s\n", str((const char *)glGetString(GL_RENDERER)));
    printf("GL_VERSION   = %s\n", str((const char *)glGetString(GL_VERSION)));
    printf("GLSL_VERSION = %s\n",
           str((const char *)glGetString(GL_SHADING_LANGUAGE_VERSION)));

    {
        GLint v = 0;
        /* GL_MAX_TEXTURE_SIZE é o limite que a interface sente primeiro:
         * atlas maior que isso não cabe. */
        glGetIntegerv(GL_MAX_TEXTURE_SIZE, &v);
        printf("GL_MAX_TEXTURE_SIZE = %d\n", v);
    }

    printf("\nVEREDITO: GLES respondeu (versao em GL_VERSION, acima)\n");

    eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglTerminate(dpy);
    return 0;
}
