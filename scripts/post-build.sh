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
    echo "post-build: inittab já chama giochi-init"
    exit 0
fi

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
