#!/bin/sh
# ============================================================
# Giochi System — post-build do rootfs
# ============================================================
# Roda DEPOIS de o rootfs ser montado e ANTES da imagem ser gerada.
#
# ## Por que um post-build, e não um /etc/inittab no overlay
#
# O `giochi-init` está na imagem e precisa ser chamado por alguém. O caminho
# óbvio seria pôr um `/etc/inittab` no overlay comum — mas isso SUBSTITUI o que
# o Buildroot gerou, e defconfigs de placa real podem depender das linhas
# geradas (getty, shutdown, ctrlaltdel). O §7 do AGENTS existe justamente por
# isso.
#
# Aqui só se ACRESCENTA uma linha, se ela ainda não estiver lá. Idempotente: se
# já estiver, não faz nada. Nada do que o Buildroot escreveu é removido.
#
# ## Quando a linha entra: SEMPRE
#
# A primeira versão só punha a linha quando o launcher já estava na imagem. A
# intenção era não deixar um processo esperando por um binário que não existe.
#
# Isso estava errado por um motivo que só apareceu ao inspecionar a imagem da
# equipe do app: **o launcher não vem desta árvore**. Ele é empacotado por eles e
# entra no rootfs por overlay, sobre uma imagem nossa. Se a linha só existe
# quando o launcher já está presente, ela nunca existe na imagem que eles
# recebem — e o sintoma é o pior tipo: o binário está lá, ninguém o chama, e a
# interface não sobe sem SSH.
#
# Do lado do `giochi-init` não há custo: sem launcher ele ESPERA em intervalos de
# `GIOCHI_LAUNCHER_WAIT` (30 s), sem CPU e sem inundar o console — comportamento
# medido e testado (§11). E o getty da serial continua vivo: `::sysinit` e as
# demais linhas geradas pelo Buildroot não são tocadas.
#
# Detalhe que engana: com o campo `id` vazio, o busybox init dá ao processo
# `/dev/console` como stdio — que aqui é a serial (`console=ttyS2`), não a tela.
# Nada do `giochi-init` depende de stdio: ele fala com o DRM pelo launcher e
# escreve o diagnóstico em arquivo (§12.19).
#
# Regra que fica: o artefato entregue tem de estar pronto para receber o
# launcher. Não se condiciona a linha à presença de algo que o cliente da imagem
# é quem instala.
# ============================================================

set -eu

TARGET_DIR="${TARGET_DIR:-${1:-}}"
# O .c do verificador mora ao lado deste script: device/common/verificador/.
POST_BUILD_DIR="$(cd "$(dirname "$0")/.." && pwd)/device/common"
if [ -z "$TARGET_DIR" ]; then
    echo "post-build: TARGET_DIR não definido" >&2
    exit 1
fi

# ── verificador de assinatura da loja ───────────────────────
#
# O instalador do `Giochi app` procura este binário em
# /opt/giochi/apps/bin/verificador-ed25519. Sem ele, o instalador AVISA que não
# verificou a assinatura e segue — o pacote entra sem prova de origem.
#
# Compilado aqui, com a toolchain do próprio build, e não versionado como
# binário: assim o `libcrypto` que ele pede é o que está nesta imagem, e não o de
# uma máquina que compilou meses antes. Fonte em device/common/verificador/,
# cedido pela equipe do app (única peça em C do repo deles).
VERIFICADOR_SRC="$POST_BUILD_DIR/verificador/verificador-ed25519.c"
if [ -f "$VERIFICADOR_SRC" ]; then
    # ARMADILHA MEDIDA: o Buildroot NÃO exporta HOST_DIR, STAGING_DIR nem
    # TARGET_CROSS para post-build. O `EXTRA_ENV` dele (package/Makefile.in:342)
    # tem só PATH, BR2_DL_DIR, BUILD_DIR, CONFIG_DIR e O. Eu tinha escrito a
    # busca por TARGET_CROSS e o script avisou "toolchain ausente
    # (…/host/bin/gcc)" a cada build — o aviso funcionou, a variável é que nunca
    # existiu.
    #
    # O que existe é `BUILD_DIR` (e `$O`, o mesmo valor). A árvore é
    #   <build>/target   <build>/host   <build>/host/<triple>/sysroot
    # então dá para derivar tudo daí. O triple é descoberto pelo nome do gcc, em
    # vez de adivinhar a arquitetura.
    # `O` é o diretório de saída do Buildroot (…/build), e é a variável certa:
    # HOST_DIR = $O/host. `BUILD_DIR` é $O/build, um nível fundo demais — usar
    # ele dava "…/build/build/host" e o gcc não existia lá.
    # `${TARGET_DIR}/../..` cobre o caso de rodar o script à mão.
    if [ -n "${O:-}" ]; then
        HOST_DIR="$O/host"
    elif [ -n "${BUILD_DIR:-}" ]; then
        HOST_DIR="$BUILD_DIR/../host"
    else
        HOST_DIR="$(cd "$TARGET_DIR/../.." && pwd)/host"
    fi
    STAGING_DIR="$(echo "$HOST_DIR"/*-buildroot-linux-gnu/sysroot 2>/dev/null | awk '{print $1}')"
    GCC_BIN="$(echo "$HOST_DIR"/bin/*-buildroot-linux-gnu-gcc 2>/dev/null | awk '{print $1}')"
    DESTINO="$TARGET_DIR/opt/giochi/apps/bin"
    if [ ! -x "$GCC_BIN" ]; then
        echo "post-build: toolchain ausente ($GCC_BIN) — verificador não compilado" >&2
        echo "post-build: a loja vai instalar sem verificar assinatura" >&2
    else
        mkdir -p "$DESTINO"
        if "$GCC_BIN" -O2 -Wall -Wextra \
                -o "$DESTINO/verificador-ed25519" "$VERIFICADOR_SRC" \
                -I"$STAGING_DIR/usr/include" \
                -L"$STAGING_DIR/usr/lib" -lcrypto 2>"$TARGET_DIR/.verif.log"; then
            chmod 0755 "$DESTINO/verificador-ed25519"
            echo "post-build: verificador-ed25519 compilado"
        else
            echo "post-build: FALHOU compilar o verificador:" >&2
            sed 's/^/  /' "$TARGET_DIR/.verif.log" >&2
            rm -f "$DESTINO/verificador-ed25519" "$TARGET_DIR/.verif.log"
            exit 1
        fi
        rm -f "$TARGET_DIR/.verif.log"
    fi
fi

# ── gate: a biblioteca presente PROVA que alguém a usa? ─────
#
# DEFEITO REAL, medido no R35S em 06/11/2026: `BR2_PACKAGE_HARFBUZZ=y` estava no
# `.config`, `libharfbuzz.so.0` estava em `/usr/lib`, e o `libSDL2_ttf` tinha
# sido configurado com `--disable-harfbuzz`:
#
#   $ grep TTF_USE_HARFBUZZ build/sdl2_ttf-2.22.0/config.log
#   #define TTF_USE_HARFBUZZ 0
#   $ grep -a libharfbuzz.so.0 libSDL2_ttf-2.0.so.0     -> nada
#
# Causa: o build incremental (§12.29). O `sdl2_ttf` já estava configurado quando
# a dependência foi acrescentada — e o Buildroot NÃO reconfigura pacote já
# construído. O `sdl2_ttf.mk` está certo (`ifeq ($(BR2_PACKAGE_HARFBUZZ),y)`),
# mas ele foi avaliado antes.
#
# O `giochi-selftest` pegava isso no APARELHO (com WARN, não FAIL). Aqui o build
# FALHA, que é o lugar certo: a imagem não deve sair com um recurso que a config
# diz que tem.
#
# A pergunta é a CONSEQUÊNCIA (o `.so` cita o soname?), não a intenção (o
# símbolo está no `.config`?). É a regra do §12.29 aplicada ao build.
verifica_harfbuzz() {
    # Só interessa quando alguém pediu harfbuzz.
    [ "${BR2_PACKAGE_HARFBUZZ:-n}" = "y" ] || return 0

    local ttf=""
    for d in "$TARGET_DIR/usr/lib" "$TARGET_DIR/lib"; do
        for f in "$d"/libSDL2_ttf-2.0.so.0.*; do
            [ -f "$f" ] && { ttf="$f"; break; }
        done
        [ -n "$ttf" ] && break
    done
    [ -n "$ttf" ] || return 0   # aparelho sem SDL2_ttf: nada a verificar

    if grep -aq 'libharfbuzz\.so' "$ttf"; then
        echo "post-build: SDL2_ttf pede libharfbuzz (ok)"
        return 0
    fi

    echo "post-build: ERRO — BR2_PACKAGE_HARFBUZZ=y mas $(basename "$ttf") NÃO pede harfbuzz." >&2
    echo "  O texto com escrita complexa (árabe, hindi, tailandês) sai errado," >&2
    echo "  sem erro em tempo de execução — o shaping simplesmente não acontece." >&2
    echo "  Causa: o build incremental não reconfigura pacote já construído (§12.29)." >&2
    echo "  Correção: remova o pacote e reconstrua:" >&2
    echo "    rm -rf \$(echo ~)/.cache/giochi-system/work/<device>/build/build/sdl2_ttf-*" >&2
    return 1
}

if ! verifica_harfbuzz; then
    exit 1
fi

# ## Por que este bloco vem ANTES do inittab
#
# A primeira versão ficou no fim do arquivo, e não rodava em build RETOMADO: o
# bloco do inittab termina em `exit 0` quando a linha já está lá ("inittab já
# chama giochi-init"), então tudo depois dele é código morto na segunda
# execução. Medido em 06/11/2026 — o `/etc/giochi/build-info.txt` não apareceu
# na imagem e o log não dizia nada, porque o `echo` também nunca rodou.
#
# É a mesma classe do §12.11 e §12.27 do AGENTS: trabalho que depende de "isto
# ainda não está feito" não pode ficar depois de um `exit 0` de outro item.

# ── /etc/giochi/build-info.txt (para o piso do relógio no aparelho) ──
#
# O `S50hwclock` grava a hora do sistema no RTC no desligamento, e se recusa a
# gravar quando o ano é anterior ao da construção da imagem — gravar um relógio
# de 1970 no RTC faria o aparelho NAScer em 1970 para sempre, e nenhum piso de
# tempo de licença conseguiria corrigir para trás.
#
# O piso tem de ser uma data que o BUILD garante, e o `build-info.txt` existe
# em `out/<device>/`, que NÃO está na imagem. Sem esta cópia, o script cairia
# no piso reserva (2024) — funciona, mas é um número escrito à mão que
# envelhece. Aqui ele vem do build.
#
# As variáveis chegam do `build-device.sh` por export, não por argumento: o
# post-build é chamado pelo próprio Buildroot, com só TARGET_DIR e
# BINARIES_DIR (a mesma armadilha do HOST_DIR documentada acima).
if [ -n "${GIOCHI_BUILD_INFO_LINHAS:-}" ]; then
    mkdir -p "$TARGET_DIR/etc/giochi"
    printf '%s\n' "$GIOCHI_BUILD_INFO_LINHAS" >"$TARGET_DIR/etc/giochi/build-info.txt"
    # Sem a senha: este arquivo vai para o cartão, e o `out/build-info.txt`
    # registra que ela existe sem registrá-la.
    echo "post-build: /etc/giochi/build-info.txt gravado"
fi

# ── script de init sem +x é serviço que não sobe, em silêncio ──
#
# `rcS` e `rcK` chamam cada `/etc/init.d/S??*` como `$i start` / `$i stop`.
# Sem o bit de execução isso é `Permission denied` — que num boot aparece no
# console entre outras 200 linhas e ninguém vê. O serviço simplesmente não
# existe, e o sintoma é "não tem hora", "não tem rede", sempre longe da causa.
#
# Medido em 06/11/2026: `S50hwclock` foi criado por ferramenta que não preserva
# modo, chegou ao `target/` como 0644, e o build ficou verde. O `giochi-init`
# já tinha guarda (abaixo); ela valia para UM arquivo, que é o mesmo erro de
# escopo do §12.34 — o teste perguntando por um caso quando o defeito é da
# classe inteira.
#
# Aqui a guarda é da classe: todo script em `/etc/init.d` que o overlay do
# Giochi System entregou tem de estar executável.
INIT_DIR="$TARGET_DIR/etc/init.d"
if [ -d "$INIT_DIR" ]; then
    INIT_NAO_EXEC=""
    for script in "$INIT_DIR"/S[0-9][0-9]*; do
        [ -f "$script" ] || continue
        [ -x "$script" ] || INIT_NAO_EXEC="$INIT_NAO_EXEC $(basename "$script")"
    done
    if [ -n "$INIT_NAO_EXEC" ]; then
        echo "post-build: script(s) de init sem bit de execução:$INIT_NAO_EXEC" >&2
        echo "post-build: o rcS/rcK chama \"\$script start\" — sem +x o serviço não sobe" >&2
        echo "post-build: corrija com: chmod +x no overlay de origem (e confira o modo no git)" >&2
        exit 1
    fi
    echo "post-build: todos os scripts de init estão executáveis"
fi

INITTAB="$TARGET_DIR/etc/inittab"
INIT_BIN="$TARGET_DIR/usr/bin/giochi-init"

[ -f "$INITTAB" ] || {
    echo "post-build: /etc/inittab não existe — o init não é BusyBox?" >&2
    exit 1
}

# A linha exata. `::` = roda em /dev/console. `respawn` tem dois motivos, e
# nenhum dos dois depende do launcher fazer exec (ele NÃO faz hoje — quem faz
# `fork`+`wait` é o `Command::status()` em poweroff/reboot):
#   1. recupera o launcher se ele morrer;
#   2. é pré-requisito de o launcher fazer exec no jogo no futuro, para não
#      haver dois processos disputando o DRM master.
ENTRADA='::respawn:/usr/bin/giochi-init'

if grep -qxF "$ENTRADA" "$INITTAB" 2>/dev/null; then
    # NÃO use `exit 0` aqui (§12.49): este arquivo tem outros blocos DEPOIS, e
    # sair cedo os transforma em código morto — que só não aparece no primeiro
    # build. Foi assim que o gate do SDL2/ALSA ficou inerte na primeira versão.
    echo "post-build: inittab já chama giochi-init"
else

[ -x "$INIT_BIN" ] || {
    echo "post-build: giochi-init não está executável — não vou pôr linha que falha" >&2
    exit 1
}

# Antes do getty: a tela do aparelho é do launcher, e um getty no console
# roubaria o echo dos primeiros segundos. Vai logo depois do rcS.
if grep -q '^::sysinit:/etc/init.d/rcS$' "$INITTAB"; then
    # `sed` com `a\` é a forma portátil no busybox (o GNU aceita `a` sem barra).
    sed -i "/^::sysinit:\/etc\/init.d\/rcS\$/a $ENTRADA" "$INITTAB"
else
    printf '%s\n' "$ENTRADA" >>"$INITTAB"
fi

echo "post-build: inittab agora respawna giochi-init"

fi  # fim do bloco do inittab — não use `exit 0` lá dentro (§12.49)

# ============================================================
# Gate: SDL2 tem de ter suporte a ALSA quando alsa-lib está na imagem
# ============================================================
# Medido em 07/11/2026 no R35S, rodando a GIOCHI-ENGINE no aparelho:
#
#   [WARN] áudio indisponível, seguindo sem som: não foi possível abrir o
#          dispositivo de áudio: dsp: No such audio device
#
# O SDL2 tinha caído no backend OSS (`dsp`), que não existe em kernel moderno
# sem emulação. Investigando: `strings libSDL2 | grep -c alsa` dava **0** no
# aparelho e **71** no build do X35H. Causa:
#
#   sdl2.mk:160   ifeq ($(BR2_PACKAGE_ALSA_LIB),y)
#                 SDL2_CONF_OPTS += --enable-alsa
#
# O `--enable-alsa` é decidido **no configure do sdl2**. No build do R35S o sdl2
# foi configurado às 06:20 e o `.config` com `BR2_PACKAGE_ALSA_LIB=y` é das
# 19:33 — treze horas depois. Buildroot não reconfigura pacote já construído
# quando uma dependência aparece (§12.29), então o `config.log` diz
# `--disable-alsa` e o `.config` diz que ALSA está ligado. Os dois estão
# "certos" e a imagem sai muda.
#
# Sintoma que isso produz: nenhum. Build verde, imagem boota, a UI funciona, e
# só o áudio falta — e "sem áudio" parece problema de driver de placa, não de
# flag de configure de uma biblioteca de terceiro.
#
# A checagem é sobre a CONSEQUÊNCIA: se alsa-lib está na imagem e o SDL2 não a
# menciona, o SDL2 foi configurado sem ela. Não importa o que o `.config` diz.
alerta_sdl2_alsa() {
    libasound=$(find "$TARGET_DIR/usr/lib" "$TARGET_DIR/lib" -maxdepth 1 -name 'libasound.so*' 2>/dev/null | head -1)
    sdl2=$(find "$TARGET_DIR/usr/lib" -maxdepth 1 -name 'libSDL2-2.0.so.0.*' 2>/dev/null | head -1)
    [ -n "$libasound" ] && [ -n "$sdl2" ] || return 0

    # `grep -a` porque é binário; `-c` porque só o número importa.
    #
    # ARMADILHA: `grep -c` imprime `0` **e** sai com status 1 quando não casa.
    # Com `|| echo 0` o valor vira "0\n0", o `[ -eq ]` falha em silêncio e o
    # gate passa exatamente no caso que ele existe para pegar. Medido: o caso
    # "SDL2 sem ALSA" passou como OK na primeira versão desta checagem.
    n=$(grep -ac "alsa" "$sdl2" 2>/dev/null) || n=0
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    if [ "$n" -eq 0 ]; then
        echo "post-build: ERRO — o SDL2 desta imagem foi compilado SEM ALSA" >&2
        echo "            alsa-lib está em $libasound, mas $sdl2" >&2
        echo "            não referencia ALSA nenhuma vez (esperado > 0)." >&2
        echo >&2
        echo "            Efeito: o SDL2 cai no backend OSS ('dsp: No such audio" >&2
        echo "            device') e TODO app SDL fica mudo — inclusive a engine." >&2
        echo >&2
        echo "            Causa: o sdl2 foi configurado ANTES de BR2_PACKAGE_ALSA_LIB" >&2
        echo "            existir no .config, e o Buildroot não reconfigura pacote" >&2
        echo "            já construído quando uma dependência aparece (§12.29)." >&2
        echo >&2
        echo "            Correção: limpe o pacote e rebuild." >&2
        # `${BUILD_DIR:-}`: o Buildroot chama o post-build com TARGET_DIR e
        # BINARIES_DIR apenas. `BUILD_DIR` NÃO vem no ambiente, e com `set -u`
        # a linha `rm -rf $BUILD_DIR/...` aborta o script com "unbound
        # variable" — antes de imprimir a própria instrução. O operador lê uma
        # mensagem cortada e o build falha pelo motivo errado (§12.53).
        echo "              rm -rf ${BUILD_DIR:-<build>}/build/sdl2-*" >&2
        return 1
    fi
    echo "post-build: SDL2 com suporte a ALSA ($n referências)"
    return 0
}

alerta_sdl2_alsa || exit 1

# ============================================================
# Gate: SDL2_image com os decodificadores que a imagem declara ter
# ============================================================
# Mesma familia do gate acima, e mesmo mecanismo do Buildroot:
#
#   package/sdl2_image/sdl2_image.mk
#   ifeq ($(BR2_PACKAGE_LIBPNG),y)  -> --enable-png
#   ifeq ($(BR2_PACKAGE_JPEG),y)   -> --enable-jpg
#   ifeq ($(BR2_PACKAGE_WEBP),y)   -> --enable-webp
#
# Duas formas de a imagem sair sem decodificador, e a segunda e a traicoeira:
#
#   1. o pacote da biblioteca nao esta no defconfig (facil de ver);
#   2. o pacote ESTA, mas o `sdl2_image` foi construido antes dele entrar no
#      `.config` — Buildroot nao reconfigura pacote existente quando uma
#      dependencia aparece (§12.29). Foi o que aconteceu no R35S: `libpng`
#      declarado no defconfig, `--disable-png` no `config.log`.
#
# O sintoma e do pior tipo: `IMG_isPNG` EXISTE e responde "PNG images are not
# supported". O erro aparece no app, nao no build, e parece bug de quem chamou.
# Medido em 07/11/2026: `giochi-demo` carregava `assets/player.png` no X55 e
# falhava no R35S; o `c_smoke` da engine ia de 2 para 7 falhas, todas do mesmo
# motivo.
#
# A checagem e sobre a CONSEQUENCIA, e a primeira versao dela estava ERRADA.
#
# Escrevi "se libpng esta na imagem e o libSDL2_image nao a referencia, foi
# configurado sem PNG" e o build falhou no R35S com PNG(libpng) JPEG(libjpeg)
# WebP(libwebp) — os tres "faltando" — enquanto o `config.log` dizia
# `--enable-png --enable-jpg --enable-webp`.
#
# Motivo: a partir do SDL2_image 2.8, PNG e JPEG sao decodificados pelo
# **stb_image EMBUTIDO** na biblioteca (`-DUSE_STBIMAGE=1`), nao por libpng ou
# libjpeg. A biblioteca NUNCA lista essas libs como NEEDED mesmo com o suporte
# ligado. Medido:
#
#   .so com --enable-png:  stbi_ = 1   libpng = 0   IMG_isPNG = 2
#   .so sem (--disable-png): stbi_ = 0   libpng = 0   IMG_isPNG = 1
#
# Entao o marcador correto e `stbi_`, nao `libpng`. E ha uma terceira
# armadilha: `stbi_` aparece so em SIMBOLOS, que o `strip` do `target-finalize`
# remove. Por isso a medicao e feita no sysroot do host, que nao e stripado. E o libpng continua sendo
# necessario no defconfig, mas como CHAVE: o `.mk` do Buildroot so passa
# `--enable-png` quando `BR2_PACKAGE_LIBPNG=y`. Sem libpng no defconfig o
# `--disable-png` desliga o LOAD_PNG de verdade.
#
# Licao de metodo, a mesma do `debugfs` ausente: o gate perguntou pela
# implementacao de um formato, e a implementacao mudou de biblioteca. Perguntar
# pela CONSEQUENCIA e o que funciona — aqui, "o decodificador foi compilado
# dentro?" — e nao "esta ligado na lib que eu esperava?".
alerta_sdl2_image() {
    # O `.so` do TARGET passou por `strip`, e `stbi_` e um SIMBOLO — o strip
    # remove. Medido: sysroot (nao stripado) tem 44 ocorrencias de `stbi_`;
    # o mesmo arquivo em target/ tem ZERO, e a primeira versao deste gate
    # reprovava um build correto por causa disso. O sysroot do host e o
    # artefato nao stripado do mesmo pacote, entao e nele que se mede.
    sdlimg=""
    sysroot_lib=$(find "$TARGET_DIR/.." -maxdepth 6 -type d \
                        -path '*/host/*/sysroot/usr/lib' 2>/dev/null | head -1)
    if [ -n "$sysroot_lib" ]; then
        sdlimg=$(find "$sysroot_lib" -maxdepth 1 -name 'libSDL2_image-2.0.so.0.*' 2>/dev/null | head -1)
    fi

    if [ -z "$sdlimg" ]; then
        # Sem o sysroot nao da para medir: o target esta stripado e o marcador
        # sumiu. "Nao deu para medir" NAO e falha (§12.30) — avisa e segue.
        tem_target=$(find "$TARGET_DIR/usr/lib" -maxdepth 1 \
                          -name 'libSDL2_image-2.0.so.0.*' 2>/dev/null | head -1)
        [ -n "$tem_target" ] && warn_img="sim"
        if [ -n "${warn_img:-}" ]; then
            echo "post-build: AVISO — SDL2_image presente, mas sem sysroot para"
            echo "            conferir os decodificadores (o alvo e stripado e o"
            echo "            marcador some). Nao reprovo sem poder medir."
        fi
        return 0
    fi

    # PNG e JPEG vem do stb_image embutido (2.8+). O marcador e `stbi_`.
    stb=$(grep -ac "stbi_" "$sdlimg" 2>/dev/null) || stb=0
    case "$stb" in ''|*[!0-9]*) stb=0 ;; esac

    # WebP e o unico que ainda precisa de lib externa, e via libwebpDEMUX.
    webp_ref=$(grep -aci "webp" "$sdlimg" 2>/dev/null) || webp_ref=0
    case "$webp_ref" in ''|*[!0-9]*) webp_ref=0 ;; esac
    tem_webp=$(find "$TARGET_DIR/usr/lib" "$TARGET_DIR/lib" -maxdepth 1 \
                    -name 'libwebp*.so*' 2>/dev/null | head -1)

    faltando=""
    if [ "$stb" -eq 0 ]; then
        # sem stb, PNG e JPEG dependem de lib externa — e a Buildroot nao liga
        for par in "libpng:PNG" "libjpeg:JPEG"; do
            lib="${par%%:*}"
            nome="${par##*:}"
            tem=$(find "$TARGET_DIR/usr/lib" "$TARGET_DIR/lib" -maxdepth 1 \
                       -name "${lib}*.so*" 2>/dev/null | head -1)
            [ -n "$tem" ] || continue
            grep -aqi "$lib" "$sdlimg" 2>/dev/null || faltando="$faltando $nome($lib)"
        done
    fi
    # WebP tem de estar referenciado quando a lib esta na imagem
    if [ -n "$tem_webp" ] && [ "$webp_ref" -eq 0 ]; then
        faltando="$faltando WebP(libwebp)"
    fi

    if [ -n "$faltando" ]; then
        echo "post-build: ERRO — SDL2_image SEM decodificador(es) que a imagem tem:" >&2
        echo "           $faltando" >&2
        echo >&2
        echo "            Efeito: 'IMG_isPNG' existe e responde 'PNG images are not" >&2
        echo "            supported'. O erro aparece no app, nao no build, e parece" >&2
        echo "            bug de quem chamou." >&2
        echo >&2
        echo "            Causa: o sdl2_image foi configurado ANTES de o pacote da" >&2
        echo "            biblioteca entrar no .config (§12.29). Confira:" >&2
        echo "              grep -oE '\\-\\-(enable|disable)-(png|jpg|webp)' \\" >&2
        echo "                ${BUILD_DIR:-<build>}/build/sdl2_image-*/config.log" >&2
        echo >&2
        echo "            Correção: limpe o pacote e rebuild." >&2
        echo "              rm -rf ${BUILD_DIR:-<build>}/build/sdl2_image-*" >&2
        return 1
    fi
    echo "post-build: SDL2_image com os decodificadores presentes na imagem"
    return 0
}

alerta_sdl2_image || exit 1
