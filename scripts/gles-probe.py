#!/usr/bin/env python3
"""Probe de GLES/EGL por ctypes — mede o que a GPU entrega, sem compilar nada.

Por que existe: `scripts/gles-probe.c` é a versão de referência, mas compilar
exige cross-toolchain no host e um `work/<device>` populado. Num aparelho que não
é nosso (ROCKNIX de fábrica, por exemplo) não há toolchain nem garantia de que o
binário estático abra. Este aqui usa o `python3` e o Mesa que JÁ estão na imagem.

O que importa medir, e por quê:

  - `GL_VERSION` / `GLSL` — o teto de shader. Decide se Godot 3/4 e arcade rodam.
  - `GL_OES_geometry_shader` — a pergunta que travou o arcade. `SpriteList`
    monta cinco programas que exigem geometry shader; se a extensão não existir,
    sem patch o `arcade.Window()` aborta na criação do contexto.
  - `GL_MAX_SAMPLES` — MSAA real, não o que o SDL pede e o driver ignora.
  - `EGL_PLATFORM` — se é surfaceless/gbm. Sem isso o launcher não abre sem X.

Uso no aparelho:
    python3 gles-probe.py            # render node / gbm, sem tela
    python3 gles-probe.py --device   # EGL_PLATFORM=device
"""
import ctypes
import ctypes.util
import os
import sys

EGL_PLATFORM_SURFACELESS_MESA = 0x31DD
EGL_PLATFORM_DEVICE_EXT = 0x313F

EGL_OPENGL_ES_API = 0x30A0
EGL_SURFACE_TYPE = 0x3033
EGL_PBUFFER_BIT = 0x0001
EGL_RENDERABLE_TYPE = 0x3040
EGL_OPENGL_ES2_BIT = 0x0004
EGL_OPENGL_ES3_BIT = 0x0040
EGL_NONE = 0x3038

EGL_CONTEXT_CLIENT_VERSION = 0x3098
EGL_NO_CONTEXT = ctypes.c_void_p(0)
EGL_NO_DISPLAY = ctypes.c_void_p(0)
EGL_NO_SURFACE = ctypes.c_void_p(0)

GL_VENDOR = 0x1F00
GL_RENDERER = 0x1F01
GL_VERSION = 0x1F02
GL_SHADING_LANGUAGE_VERSION = 0x8B8C
GL_NUM_EXTENSIONS = 0x821D
GL_MAX_TEXTURE_SIZE = 0x0D33
GL_MAX_RENDERBUFFER_SIZE = 0x84E8
GL_MAX_VERTEX_UNIFORM_VECTORS = 0x8DFB
GL_MAX_FRAGMENT_UNIFORM_VECTORS = 0x8DFD
GL_MAX_SAMPLES = 0x8D57
GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS = 0x8B4C


def load(name):
    """Carrega a biblioteca tentando caminhos explícitos primeiro.

    `ctypes.util.find_library` depende de `ldconfig`, de `gcc` ou de varrer o
    PATH — num rootfs de handheld nenhum dos três costuma existir, e o retorno
    é o próprio nome ("EGL"), que o `dlopen` não abre. O sintoma é
    `! nao carregou EGL`, que parece driver ausente e é biblioteca presente.
    Medido no R35S: `find_library("EGL")` devolveu "EGL" com o
    `/usr/lib/libEGL.so.1` no disco.
    """
    candidates = {
        "EGL": [
            "/usr/lib/libEGL.so.1",
            "/usr/lib/libEGL.so",
            "/usr/lib/aarch64-linux-gnu/libEGL.so.1",
            "/usr/lib64/libEGL.so.1",
            "libEGL.so.1",
        ],
        "GLESv2": [
            "/usr/lib/libGLESv2.so.2",
            "/usr/lib/libGLESv2.so",
            "/usr/lib/aarch64-linux-gnu/libGLESv2.so.2",
            "/usr/lib64/libGLESv2.so.2",
            "libGLESv2.so.2",
        ],
    }.get(name, [name])

    found = ctypes.util.find_library(name)
    if found and found != name:
        candidates.insert(0, found)

    tried = []
    for candidate in candidates:
        if candidate not in ("EGL", "GLESv2") and not os.path.exists(candidate):
            tried.append("%s (ausente)" % candidate)
            continue
        try:
            return ctypes.CDLL(candidate)
        except OSError as error:
            tried.append("%s (%s)" % (candidate, error))

    print("! nao carregou %s; tentativas: %s" % (name, "; ".join(tried) or "nenhuma"))
    return None


def cstr(pointer):
    return pointer.decode("utf-8", "replace") if pointer else "(null)"


def main():
    use_device = "--device" in sys.argv

    egl = load("EGL")
    gles = load("GLESv2")
    if not egl or not gles:
        print("VEREDITO: sem EGL ou GLESv2 na imagem")
        return 2

    egl.eglGetProcAddress.restype = ctypes.c_void_p
    egl.eglGetProcAddress.argtypes = [ctypes.c_char_p]

    # eglGetPlatformDisplayEXT permite escolher surfaceless/gbm. Sem ele, o Mesa
    # tenta X11 e falha em KMSDRM — a mensagem e' "no display", que manda
    # procurar permissao em /dev/dri e nao plataforma errada.
    get_platform = egl.eglGetProcAddress(b"eglGetPlatformDisplayEXT")
    display = EGL_NO_DISPLAY
    if get_platform:
        proto = ctypes.CFUNCTYPE(
            ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)
        )
        get_platform_display = proto(get_platform)
        platform = EGL_PLATFORM_DEVICE_EXT if use_device else EGL_PLATFORM_SURFACELESS_MESA
        raw = None
        if use_device:
            # EGL_PLATFORM_DEVICE_EXT quer um EGLDeviceEXT; o caminho pratico no
            # Mesa e' deixar o default, entao so' tentamos o platform explicito
            # quando o aparelho tem /dev/dri/renderD128.
            if not os.path.exists("/dev/dri/renderD128"):
                print("! sem /dev/dri/renderD128")
            display = get_platform_display(platform, raw, None)
        else:
            display = get_platform_display(platform, None, None)
        print("eglGetPlatformDisplayEXT = %s" % ("0x%x" % display if display else "NULL"))
    else:
        print("! eglGetPlatformDisplayEXT ausente (Mesa antigo?)")

    if not display:
        display = egl.eglGetDisplay(ctypes.c_void_p(0))
        print("eglGetDisplay(default)   = %s" % ("0x%x" % display if display else "NULL"))

    if not display:
        print("VEREDITO: sem display EGL")
        return 2

    major, minor = ctypes.c_int(), ctypes.c_int()
    if not egl.eglInitialize(ctypes.c_void_p(display), ctypes.byref(major), ctypes.byref(minor)):
        print("eglInitialize falhou: 0x%x" % egl.eglGetError())
        print("VEREDITO: EGL nao inicializou")
        return 2

    egl.eglQueryString.restype = ctypes.c_char_p
    egl.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]
    print("EGL_VENDOR   = %s" % cstr(egl.eglQueryString(ctypes.c_void_p(display), 0x3053)))
    print("EGL_VERSION  = %s" % cstr(egl.eglQueryString(ctypes.c_void_p(display), 0x3054)))
    print("EGL_CLIENT_APIS = %s" % cstr(egl.eglQueryString(ctypes.c_void_p(display), 0x308D)))

    egl.eglBindAPI(EGL_OPENGL_ES_API)

    # EGL_RENDERABLE_TYPE tem de ser UMA entrada com os bits somados. Repetir a
    # chave na lista de atributos e' invalido — `eglChooseConfig` devolve 0
    # configs e a mensagem ("nenhum config renderable") manda procurar driver,
    # nao lista de atributos malformada.
    attribs = (ctypes.c_int * 5)(
        EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT | EGL_OPENGL_ES2_BIT,
        EGL_NONE,
    )
    config = ctypes.c_void_p()
    count = ctypes.c_int()
    ok = egl.eglChooseConfig(
        ctypes.c_void_p(display), attribs, ctypes.byref(config), 1, ctypes.byref(count)
    )
    if not ok or count.value == 0:
        print("config ES3: nenhuma — tentando ES2")
        attribs2 = (ctypes.c_int * 5)(EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE,
                                      EGL_OPENGL_ES2_BIT, EGL_NONE)
        ok = egl.eglChooseConfig(
            ctypes.c_void_p(display), attribs2, ctypes.byref(config), 1, ctypes.byref(count)
        )
        if not ok or count.value == 0:
            print("VEREDITO: nenhum config GLES renderable")
            return 2

    context_attribs = (ctypes.c_int * 3)(EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE)
    context = egl.eglCreateContext(
        ctypes.c_void_p(display), config, EGL_NO_CONTEXT, context_attribs
    )
    if not context:
        print("contexto ES3 falhou (0x%x) — tentando ES2" % egl.eglGetError())
        context_attribs = (ctypes.c_int * 3)(EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE)
        context = egl.eglCreateContext(
            ctypes.c_void_p(display), config, EGL_NO_CONTEXT, context_attribs
        )
    if not context:
        print("eglCreateContext falhou: 0x%x" % egl.eglGetError())
        print("VEREDITO: sem contexto GLES")
        return 2

    pbuffer = (ctypes.c_int * 5)(0x3057, 16, 0x3056, 16, EGL_NONE)
    surface = egl.eglCreatePbufferSurface(ctypes.c_void_p(display), config, pbuffer)
    if not surface:
        print("eglCreatePbufferSurface falhou: 0x%x" % egl.eglGetError())
        print("VEREDITO: sem surface")
        return 2

    if not egl.eglMakeCurrent(ctypes.c_void_p(display), surface, surface, context):
        print("eglMakeCurrent falhou: 0x%x" % egl.eglGetError())
        print("VEREDITO: contexto criado mas nao ativado")
        return 2

    gles.glGetString.restype = ctypes.c_char_p
    gles.glGetString.argtypes = [ctypes.c_uint]
    print()
    print("--- GLES ---")
    print("GL_VENDOR    = %s" % cstr(gles.glGetString(GL_VENDOR)))
    print("GL_RENDERER  = %s" % cstr(gles.glGetString(GL_RENDERER)))
    print("GL_VERSION   = %s" % cstr(gles.glGetString(GL_VERSION)))
    print("GLSL_VERSION = %s" % cstr(gles.glGetString(GL_SHADING_LANGUAGE_VERSION)))

    gles.glGetIntegerv.argtypes = [ctypes.c_uint, ctypes.POINTER(ctypes.c_int)]
    for name, enum in [
        ("MAX_TEXTURE_SIZE", GL_MAX_TEXTURE_SIZE),
        ("MAX_RENDERBUFFER_SIZE", GL_MAX_RENDERBUFFER_SIZE),
        ("MAX_VERTEX_UNIFORM_VECTORS", GL_MAX_VERTEX_UNIFORM_VECTORS),
        ("MAX_FRAGMENT_UNIFORM_VECTORS", GL_MAX_FRAGMENT_UNIFORM_VECTORS),
        ("MAX_VERTEX_TEXTURE_IMAGE_UNITS", GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        ("MAX_SAMPLES", GL_MAX_SAMPLES),
    ]:
        value = ctypes.c_int(0)
        gles.glGetIntegerv(enum, ctypes.byref(value))
        print("%-30s = %d" % (name, value.value))

    # Lista de extensoes. Na EGL/GLES de verdade glGetStringi devolve o que o
    # DRIVER suporta — ao contrario do GLX, onde `eglQueryString` devolve as
    # extensoes da plataforma e a checagem de capacidade mente.
    gles.glGetStringi.restype = ctypes.c_char_p
    gles.glGetStringi.argtypes = [ctypes.c_uint, ctypes.c_uint]
    total = ctypes.c_int(0)
    gles.glGetIntegerv(GL_NUM_EXTENSIONS, ctypes.byref(total))
    extensions = []
    for index in range(max(total.value, 0)):
        extensions.append(cstr(gles.glGetStringi(0x1F03, index)))
    print()
    print("EXTENSOES = %d" % len(extensions))

    for wanted in (
        "GL_OES_geometry_shader",
        "GL_EXT_geometry_shader",
        "GL_OES_texture_3D",
        "GL_OES_texture_storage_multisample_2d_array",
        "GL_EXT_multisampled_render_to_texture",
        "GL_KHR_debug",
        "GL_OES_EGL_image",
    ):
        mark = "SIM" if wanted in extensions else "nao"
        print("  %-52s %s" % (wanted, mark))

    geometry = "GL_OES_geometry_shader" in extensions or "GL_EXT_geometry_shader" in extensions
    print()
    if geometry:
        print("VEREDITO: geometry shader DISPONIVEL — arcade sem patch")
    else:
        print("VEREDITO: geometry shader AUSENTE — arcade precisa do patch")

    egl.eglMakeCurrent(
        ctypes.c_void_p(display), EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT
    )
    egl.eglTerminate(ctypes.c_void_p(display))
    return 0


if __name__ == "__main__":
    sys.exit(main())
