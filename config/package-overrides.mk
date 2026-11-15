# Overrides de pacote do Buildroot (BR2_PACKAGE_OVERRIDE_FILE)
# ============================================================
# Este arquivo é incluído ANTES das receitas de pacote, não depois.
#
#   Makefile:507  include package/Makefile.in
#   Makefile:528  -include $(PACKAGE_OVERRIDE_FILE)     <- aqui
#   Makefile:~530 include package/*/*.mk                <- as receitas vêm DEPOIS
#
# A frase estava invertida até 08/11/2026 ("incluído depois das receitas"), e a
# diferença não é cosmética: com a ordem errada, `VAR = ...` na receita apaga o
# `VAR += ...` escrito aqui, em silêncio. É o que o bloco do strace explica mais
# abaixo. Regra que decorre:
#
#   - `VAR += x` só sobrevive se a receita TAMBÉM usar `+=` e a variável já
#     existir (é o caso de `LINUX_FIRMWARE_FILES`, e o de `HOST_CFLAGS` em
#     package/Makefile.in);
#   - quando a receita usa `=`, é preciso `override VAR += x` — ou `override
#     VAR = ...` repetindo as opções padrão.
#
# Verificação barata: `make -p -n -C <buildroot> O=<build> | grep '^VAR'`.
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
# `BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT` instala só `rtl_bt/rtl88*.bin`, e a
# X55 precisa dos dois arquivos do RTL8821CS. Sem eles o driver btrtl para em
#
#   "RTL: firmware file rtl_bt/rtl8821cs_fw not found"
#
# e o hci0 não nasce. O sintoma aparece como "Bluetooth não funciona", e o
# pacote de firmware parece completo — nada diz que faltou arquivo.
#
# NOME DO CHIP ≠ NOME DO ARQUIVO. O driver pede sempre `rtl8821cs_config.bin`,
# mas o linux-firmware de-duplicou esse config (commit 5a017996, "rtl_bt:
# de-dupe identical config.bin files", 2024-08-22): os 25 bytes do 8821CS são
# idênticos aos do `rtl8761b_config.bin`, e o 8821CS virou LINK. O tarball de
# release **não carrega os links** — medido no CI de 14/11/2026, build
# `powkiddy-x55` com linux-firmware-20250211, uma hora depois de começar:
#
#   tar: rtl_bt/rtl8821cs_config.bin: Cannot stat: No such file or directory
#   make: *** [.../linux-firmware-20250211/.stamp_built] Error 2
#
# (no tarball de 20240115 os dois existiam como arquivos — é por isso que a
# linha antiga funcionava e parou de funcionar no upgrade para 2025.02.)
#
# Então a lista pede o ARQUIVO que existe (`rtl8761b_config.bin`, conteúdo
# idêntico e oficial) e o nome que o driver pede é criado pelo hook abaixo, como
# link. Um link pendurado seria o pior dos mundos: `ls` mostra o arquivo e o
# request_firmware falha — por isso o hook FALHA o build se o alvo não estiver lá.
#
# `LINUX_FIRMWARE_FILES` e os hooks do pacote são lidos em `linux-firmware.mk`
# quando ele é incluído, e este arquivo é incluído ANTES das receitas
# (Makefile:531 vs :534 no 2025.02), então os dois acréscimos valem. Conferir com:
#   make -p -n | grep '^LINUX_FIRMWARE_FILES'
#
# CONDICIONAL, e tem de continuar assim: este arquivo vale para TODOS os
# aparelhos. A X35H não tem o RTL8821CS populado e o defconfig dela desliga
# `BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT` de propósito. Um `+=` incondicional
# colocava os blobs no rootfs dela mesmo assim — firmware para um chip que não
# existe, contradizendo o que o defconfig declara. Buildroot expõe os símbolos
# `BR2_*` como variáveis de make, então a condição é a mesma do menu.
ifeq ($(BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT),y)
LINUX_FIRMWARE_FILES += rtl_bt/rtl8821cs_fw.bin rtl_bt/rtl8761b_config.bin

# Cada linha do hook roda num shell próprio: sem `\` no fim, um `if` de várias
# linhas nunca fecha. Por isso o teste de existência é uma linha só, e a
# mensagem diz a consequência (é o §12.15: link pendurado "existe" e o rádio
# não sobe).
define GIOCHI_RTL8821CS_CONFIG_ALIAS
	[ -f "$(TARGET_DIR)/lib/firmware/rtl_bt/rtl8761b_config.bin" ] || { echo "ERRO: rtl_bt/rtl8761b_config.bin não chegou ao target — sem ele o RTL8821CS fica sem baudrate/flow control e o hci0 não sobe." >&2; exit 1; }
	ln -sf rtl8761b_config.bin "$(TARGET_DIR)/lib/firmware/rtl_bt/rtl8821cs_config.bin"
endef
LINUX_FIRMWARE_POST_INSTALL_TARGET_HOOKS += GIOCHI_RTL8821CS_CONFIG_ALIAS
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

# ── psplash: a imagem é do PROJETO, no tamanho lógico da tela ──
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
# O caminho vem do `build-device.sh`, que gera a imagem no tamanho lógico do
# painel e em paisagem quando a rotação do aparelho pede. Sem a variável (build
# à mão, sem o script), o `ifneq` fica falso e o psplash usa a imagem dele —
# degradação graciosa, sem quebrar build.
override PSPLASH_IMAGE = $(GIOCHI_SPLASH_PNG)

# A barra, a geometria e as cores viajam junto com essa imagem — e sem elas o
# psplash desenha a NOSSA imagem e a barra DELE, em lugares diferentes.
#
# Três coisas saem do repositório e entram no fonte extraído:
#
#   base-images/psplash-bar.png  a barra, virada `psplash-bar-img.h` no build
#                                (regra do `Makefile.am`, via host-gdk-pixbuf)
#   psplash-config.h             `IMG_FULLSCREEN 1` e split em 9/16, que é onde
#                                `gerar-splash.mjs` põe o logo logo acima
#   psplash-colors.h             fundo/texto/preenchimento do projeto; é o que
#                                o `psplash_draw_progress` usa para pintar o
#                                miolo da barra e para LIMPAR a tela no começo
#
# Com os valores de fábrica o resultado medido no X55 (14/11/2026) era: logo no
# meio, barra solta em 5/6 da tela, faixa creme do Yocto no rodapé e um flash
# claro antes do primeiro quadro. Nada disso gera erro — só uma tela feia.
#
# `ifneq` porque um build à mão (sem `build-device.sh`) não define as variáveis,
# e nesse caso o pacote segue com o visual de fábrica em vez de quebrar.
ifneq ($(GIOCHI_SPLASH_BAR),)
define GIOCHI_PSPLASH_VISUAL
	cp $(GIOCHI_SPLASH_BAR) $(@D)/base-images/psplash-bar.png
	cp $(GIOCHI_SPLASH_DIR)/psplash-config.h $(@D)/psplash-config.h
	cp $(GIOCHI_SPLASH_DIR)/psplash-colors.h $(@D)/psplash-colors.h
endef
PSPLASH_POST_EXTRACT_HOOKS += GIOCHI_PSPLASH_VISUAL
endif

# Conferir com:
#   make -p -n | grep '^PSPLASH_IMAGE'
#   ls work/<device>/build/build/psplash-*/base-images/

# ── sdl2_mixer: o sdl2-config do SISTEMA vaza para o cross-compile ──────────
# Só aparece em máquina que tem `libsdl2-dev` instalado — e esta tem, porque o
# launcher x86_64 precisa dele (§12.54). Medido ao ligar `SDL2_MIXER`:
#
#   aarch64-buildroot-linux-gnu-gcc: ERROR: unsafe header/library path used in
#   cross-compilation: '-I/usr/include/SDL2'
#
# A causa, em três camadas:
#
#   1. `BR_PATH = "$(HOST_DIR)/bin:$(HOST_DIR)/sbin:$(PATH)"` (Makefile:468) —
#      o PATH do sistema entra na conta.
#   2. O `sdl2-config` do Buildroot é instalado em
#      `$(STAGING_DIR)/usr/bin/sdl2-config`, que NÃO está no PATH acima.
#   3. O `configure` do SDL2_mixer 2.6.3 procura com
#      `AC_PATH_TOOL(SDL2_CONFIG, sdl2-config)`, acha `/usr/bin/sdl2-config` do
#      Ubuntu e recebe `-I/usr/include/SDL2`.
#
# Quem salvou o build foi a trava do próprio gcc do Buildroot
# (`unsafe header/library path`): sem ela, o mixer linkaria contra o SDL2 de
# x86_64 e o binário sairia "válido" e inútil no aparelho.
#
# `AC_PATH_TOOL` respeita a variável de ambiente já definida, então apontar para
# o do staging resolve. `override ... +=` e não `=` porque, se uma versão futura
# do Buildroot passar a definir `SDL2_MIXER_CONF_ENV`, o acréscimo soma em vez de
# ser apagado (a armadilha do strace, §12.7).
#
# Conferir com:
#   make -p -n | grep '^SDL2_MIXER_CONF_ENV'
override SDL2_MIXER_CONF_ENV += SDL2_CONFIG=$(STAGING_DIR)/usr/bin/sdl2-config
