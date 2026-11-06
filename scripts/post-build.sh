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
