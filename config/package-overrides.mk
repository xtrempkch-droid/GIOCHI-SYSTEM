# Overrides de pacote do Buildroot (BR2_PACKAGE_OVERRIDE_FILE)
# ============================================================
# Este arquivo é incluído depois das receitas de pacote, então dá para
# acrescentar opções sem editar a árvore do Buildroot nem carregar patch.
#
# Ele existe porque um pacote do Buildroot 2024.02 não compila contra os
# headers do kernel 6.12 — e a falha aparece longe da causa.

# ── GCC 15 / C23: host tools do Buildroot 2024.02 ────────────
# O GCC 15 passou a compilar em `-std=gnu23` por padrão. O Buildroot 2024.02 é
# de fevereiro de 2024 e assume o padrão anterior (`gnu17`), então alguns
# pacotes de HOST quebram — o primeiro a aparecer num build do zero é o
# `host-m4` 1.4.19.
#
# O erro não fala de versão de C nem de GCC. Ele aponta para um header do
# gnulib, numa linha que compila em qualquer outra máquina:
#
#   gl_oset.h:275:40: error: expected identifier or '(' before 'int'
#   gl_oset.h:275:1: warning: 'nodiscard' attribute ignored [-Wattributes]
#         GL_OSET_INLINE _GL_ATTRIBUTE_NODISCARD int
#
# Causa: `config.h` do m4 escolhe a forma do atributo em TEMPO DE COMPILAÇÃO,
# não no configure:
#
#   #if 201710L < __STDC_VERSION__
#   # define _GL_ATTRIBUTE_NODISCARD [[__nodiscard__]]
#   #elif _GL_HAS_ATTRIBUTE (warn_unused_result)
#   # define _GL_ATTRIBUTE_NODISCARD __attribute__ ((__warn_unused_result__))
#
# Com `gnu23`, `__STDC_VERSION__` é 202311L e ele pega a forma C23
# `[[__nodiscard__]]`. Escrita DEPOIS de `inline` e ANTES de `int`, essa forma é
# inválida — atributos `[[...]]` vão no começo da declaração. Com `gnu17` o
# valor é 201710L, a comparação falha e ele usa `__attribute__`, que é aceito em
# qualquer posição da declaração. Era por isso que funcionava antes.
#
# Correção: compilar os tools de HOST em `gnu17`, que é o que a árvore espera.
#
# ── EFEITO COLATERAL QUE EU NEGUEI, E QUE QUEBROU O CI ──────
#
# A primeira versão desta linha dizia "restrito a HOST, o C++ não herda". Errado.
# `HOST_CXXFLAGS += $(HOST_CFLAGS)` (`package/Makefile.in:252`) é expansão
# RECURSIVA: avalia `$(HOST_CFLAGS)` no momento do uso, depois deste arquivo.
# O `-std=gnu17` chegava no g++ e o g++ avisava:
#
#   cc1plus: warning: command-line option '-std=gnu17' is valid for C/ObjC
#   but not for C++ [-Werror]
#
# Com `-Werror` — e o `host-ccache` compila assim — o aviso vira erro e o build
# morre em `Args.cpp.o`, `AtomicFile.cpp.o`, `Config.cpp.o`, `Context.cpp.o`,
# `Depfile.cpp.o`. Medido no CI. Não é cosmético.
#
# A correção não é filtrar depois: é nunca deixar vazar. Como `HOST_CXXFLAGS` já
# é recursiva, redefini-la recursivamente (com `=`, NÃO `:=`) mantém a avaliação
# tardia e só remove as flags que são de C:
#
#   override HOST_CXXFLAGS = $(filter-out <flags de C>,$(HOST_CFLAGS))
#
# `=` e não `:=` de propósito: com atribuição imediata a variável CONGELA no
# valor de agora e pacotes que a estendam depois perdem a extensão — trocaria um
# erro visível por um comportamento errado silencioso, que é pior.
#
# ── SEGUNDA ARMADILHA: GCC 14+ trata declaração implícita como ERRO ─────────
#
# `host-libffi` 3.4.4 usa `open_temp_exec_file()` em `src/tramp.c` sem
# declaração — a função é `static` em `src/closures.c` e nunca chegou a um
# header. Até o GCC 13 isso era um aviso; do GCC 14 em diante é erro:
#
#   src/tramp.c:262:22: error: implicit declaration of function
#   'open_temp_exec_file' [-Wimplicit-function-declaration]
#
# Note que `-std=gnu17` NÃO resolve isto: a mudança de severidade é do GCC, não
# do padrão de C. Downgrade explícito, só nos tools de host:
#
#   -Wno-error=implicit-function-declaration
#
# Escolha consciente: o código é de terceiro, o erro é latente desde sempre
# (a função só falharia se a assinatura divergisse), e o aparelho não roda nada
# disto. Se um dia o libffi for atualizado para uma versão que declare a função,
# esta flag sai.
HOST_CFLAGS += -std=gnu17 -Wno-error=implicit-function-declaration

# As duas flags acima são de C. Removidas do C++ para não virarem erro sob
# `-Werror`. `=` (recursiva) mantém a avaliação tardia — ver comentário acima.
override HOST_CXXFLAGS = $(filter-out \
	-std=gnu17 -Wno-error=implicit-function-declaration,$(HOST_CFLAGS))

# ── strace 6.7 ───────────────────────────────────────────────
# Com `BR2_KERNEL_HEADERS_AS_KERNEL=y` e kernel 6.12, o strace 6.7 morre numa
# static assertion do próprio código:
#
#   macros.h:141: error: static assertion failed:
#   "Unexpected size of sysoff.rsv (sizeof(unsigned int) * 3 expected)."
#
# A struct `ptp_sys_offset` mudou no 6.11, e a cópia que o strace 6.7 tem dos
# uapi headers não sabe disso. O próprio upstream aponta a saída:
# `--enable-bundled=yes` faz o strace usar os headers que ele traz, em vez dos
# do toolchain.
#
# Escolha consciente: manter o kernel e os headers em 6.12 (o aparelho precisa
# dos headers certos para o próprio kernel) e deixar o strace isolado. A
# alternativa — rebaixar o toolchain para headers 6.6 — arrasta a toolchain
# inteira e não resolve a causa, só a esconde.
#
# ORDEM DE INCLUSÃO — leia antes de trocar `override` por `+=`:
# o Buildroot inclui este arquivo ANTES de `package/*/*.mk` (Makefile, ~linha
# 530). A receita faz `STRACE_CONF_OPTS = --enable-mpers=no` e uma atribuição
# normal apaga qualquer `+=` feito aqui — sem aviso, e o build volta a falhar
# igual. `override` protege a variável, ao custo de precisar repetir as opções
# padrão da receita. Features opcionais (libunwind/libiberty) estão desligadas
# em todos os devices deste repositório; se um dia ligarem, ajuste aqui.
override STRACE_CONF_OPTS = --enable-mpers=no --enable-bundled=yes \
	--without-libunwind --without-libiberty

# ── linux-firmware: RTL8821CS (Bluetooth por UART) ───────────
# O Buildroot 2024.02 lista, em BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT, os
# arquivos rtl8821a_* e rtl8821c_* — mas OMITE rtl8821cs_*, que estão no MESMO
# tarball (linux-firmware-20240115):
#
#   linux-firmware-20240115/rtl_bt/rtl8821cs_fw.bin      56 KB
#   linux-firmware-20240115/rtl_bt/rtl8821cs_config.bin  25 B
#
# Sem eles o driver btrtl para em
#   "RTL: firmware file rtl_bt/rtl8821cs_fw not found"
# e o hci0 não nasce. O sintoma aparece como "Bluetooth não funciona", e o
# pacote de firmware parece completo — nada diz que faltou arquivo.
#
# `LINUX_FIRMWARE_FILES` é montada com `+=` em linux-firmware.mk, e este arquivo
# é incluído ANTES das receitas (Makefile, ~linha 530), então o acréscimo soma à
# lista em vez de ser apagado. Conferir com:
#   make -p -n | grep '^LINUX_FIRMWARE_FILES'
#
# CONDICIONAL, e tem de continuar assim: este arquivo vale para TODOS os
# aparelhos. A X35H não tem o RTL8821CS populado e o defconfig dela desliga
# `BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT` de propósito. Um `+=` incondicional
# colocava os dois blobs no rootfs dela mesmo assim — 56 KB de firmware para um
# chip que não existe, contradizendo o que o defconfig declara. Buildroot expõe
# os símbolos `BR2_*` como variáveis de make, então a condição é a mesma do menu.
ifeq ($(BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT),y)
LINUX_FIRMWARE_FILES += rtl_bt/rtl8821cs_fw.bin rtl_bt/rtl8821cs_config.bin
endif

# ── linux-firmware: firmware do dongle MT7601U ──────────────
# O Buildroot 2024.02 não expõe opção para `mediatek/mt7601u.bin`, mas o
# arquivo ESTÁ no mesmo tarball (linux-firmware-20240115). Sem ele o driver
# `mt7601u` carrega, falha ao pedir o firmware e o dongle fica morto:
#
#   mt7601u 1-1.1:1.0: Direct firmware load for mediatek/mt7601u.bin failed
#
# É o dongle MediaTek mais barato e comum. ~40 KB — cabe em qualquer imagem.
#
# CONDICIONAL a existir linux-firmware, não ao aparelho: diferente do RTL8821CS
# (onboard, só na X55), o dongle é hardware FORNECIDO PELO USUÁRIO. A imagem é
# gravada uma vez; o dongle chega depois. Se o firmware não estiver lá, o
# usuário não tem como resolver sem recompilar.
ifeq ($(BR2_PACKAGE_LINUX_FIRMWARE),y)
LINUX_FIRMWARE_FILES += mediatek/mt7601u.bin
endif

# ── psplash: a imagem é do PROJETO, no tamanho da tela ──────
# O Buildroot 2024.02 não expõe mais `BR2_PACKAGE_PSPLASH_IMAGE` no Kconfig —
# sobrou só no `.mk`, lendo um símbolo que não existe. Resultado: o pacote usa a
# imagem padrão do Yocto (o logo do poky) em QUALQUER aparelho, e não há como
# trocar pelo menu.
#
# `package/psplash/psplash.mk` faz:
#
#   PSPLASH_IMAGE = $(call qstrip,$(BR2_PACKAGE_PSPLASH_IMAGE))
#   ifneq ($(PSPLASH_IMAGE),)
#     define PSPLASH_COPY_IMAGE
#       cp $(PSPLASH_IMAGE) $(@D)/base-images/psplash-poky.png
#     endef
#     PSPLASH_POST_EXTRACT_HOOKS += PSPLASH_COPY_IMAGE
#   endif
#
# A atribuição é simples (`=`), então definir antes NÃO adianta: a receita
# apagaria em silêncio (§12.7). `override` é o que sobrevive — e como ele é
# recursivo, lê a variável de ambiente na hora do uso.
#
# O caminho vem do `build-device.sh`, que gera a imagem no tamanho do painel
# declarado em `device.json`. Sem a variável (build à mão, sem o script), o
# `ifneq` fica falso e o psplash usa a imagem dele — degradação graciosa, sem
# quebrar build.
override PSPLASH_IMAGE = $(GIOCHI_SPLASH_PNG)

# Conferir com:
#   make -p -n | grep '^PSPLASH_IMAGE'
