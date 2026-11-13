# ============================================================
# Giochi System — br2-external
# ============================================================
# Este arquivo é incluído DEPOIS das receitas de pacote
# (`include $(BR2_EXTERNAL_MKS)`, Makefile:545), ao contrário do
# `config/package-overrides.mk`, que é incluído ANTES (Makefile:528).
#
# É a diferença que decide onde cada ajuste mora:
#
#   | mecanismo               | quando entra      | `+=` na receita      |
#   | package-overrides.mk    | antes das receitas| SOBRESCREVE (=)      |
#   | br2-external/external.mk| depois das receitas| SOMA                 |
#
# Regra: ajuste que ACRESCENTA opção à receita (usando o que o `.config` do
# aparelho já decidiu) mora aqui. Ajuste que SUBSTITUI variável inteira mora no
# `package-overrides.mk`, com `override`.
#
# ## ATENÇÃO: o Buildroot lembra do `BR2_EXTERNAL` no diretório de saída
#
# O `Makefile:188` regenera `$(O)/.br2-external.mk` a cada invocação a partir da
# variável `BR2_EXTERNAL`. Invocar `make` à mão dentro de `work/<device>/build`
# SEM a variável **zera** o arquivo em silêncio, e o pacote passa a ser
# construído sem os ajustes daqui — sem erro, sem aviso. O `build-device.sh`
# exporta a variável, então o caminho normal está coberto; quem depurar à mão
# precisa repetir:
#
#   BR2_EXTERNAL=/caminho/do/repo/buildroot-external make -O ... 
#
# (o caminho precisa ser ABSOLUTO: o `support/scripts/br2-external` recusa
# relativo).

# ── SDL2: driver de vídeo `dummy` ────────────────────────────────────────────
#
# A receita do Buildroot DESLIGA o dummy e o offscreen em opções fixas:
#
#   package/sdl2/sdl2.mk:26-27
#     --disable-video-dummy \
#     --disable-video-offscreen \
#
# e não existe símbolo de Kconfig para religar. Conferido em 2024.02, 2025.02,
# 2026.02 e 2026.08 — a opção continua cravada em todas. Medido no R35S: o
# `config.log` do build registra os dois `--disable-video-*`, e o aparelho
# reporta `video drivers: 1 -> KMSDRM`.
#
# Pedido da equipe da engine (13/11/2026, item 5): sem o dummy, todo teste que
# abre janela precisa tomar o console — parar o launcher, esperar o DRM master
# ser liberado, rodar, devolver. Com ele, o teste roda com
# `SDL_VIDEODRIVER=dummy` sem tocar em `/dev/dri`.
#
# O dummy NÃO substitui o teste em `kmsdrm`: ele não desenha nada de verdade.
# Os dois se complementam, e a engine já sabe disso.
#
# O QUE ISSO CUSTA, e é o motivo de o `giochi-init` fixar o driver: no
# `SDL_video.c` o `DUMMY_bootstrap` é o ÚLTIMO da lista de bootstrap. Se o
# KMSDRM falhar ao iniciar, o SDL cai no dummy EM SILÊNCIO — processo vivo,
# nenhum pixel na tela. Com `SDL_VIDEODRIVER=kmsdrm` exportado pelo init, a
# falha vira erro explícito em vez de tela preta (§12.62-D).
#
# ## Por que `filter-out`, e não `+= --enable-video-dummy`
#
# A primeira versão deste arquivo usou `+=`. Medido com `make --eval`, o
# resultado foi a linha de comando com **as duas flags**:
#
#   ... --disable-video-dummy ... --enable-video-kmsdrm --enable-video-dummy
#
# O autoconf do SDL2 aceita: ele percorre `$ac_configure_args` em ordem e a
# ÚLTIMA ocorrência vence, então `--enable` ganha. Funciona hoje e é o tipo de
# coisa que não se deve deixar no repositório:
#
#   - o `config.log` passa a registrar as duas flags, e quem lê conclui que a
#     opção está desligada;
#   - a ordem é a única coisa que sustenta o comportamento, e ela depende de
#     onde o `+=` cai na expansão — invisível e não intencional;
#   - se uma versão futura do Buildroot mover o `--disable-video-dummy` para
#     depois, o dummy desaparece **sem erro**.
#
# `filter-out` remove a flag da receita e acrescenta a nossa: uma flag só, e o
# `config.log` diz a verdade. O `:=` é seguro aqui porque este arquivo é o
# ÚLTIMO include do Makefile antes da checagem de dependências (linha 545) —
# nada mais atribui `SDL2_CONF_OPTS` depois, e as condicionais da receita
# (kmsdrm/alsa/opengles, que dependem do `.config` de cada aparelho) já foram
# resolvidas na expansão que este `:=` captura.
SDL2_CONF_OPTS := $(filter-out --disable-video-dummy,$(SDL2_CONF_OPTS)) --enable-video-dummy

