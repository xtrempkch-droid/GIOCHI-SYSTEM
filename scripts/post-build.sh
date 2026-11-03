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
# ## Quando a linha entra: só quando há launcher
#
# Acrescentar `::respawn:/usr/bin/giochi-init` sem launcher deixa o aparelho com
# um processo esperando por um binário que não existe. Inofensivo (é assim que o
# `giochi-init` foi feito), mas sem propósito.
#
# Ligar a linha no momento em que o launcher é EMPACOTADO é melhor do que uma
# flag de config: não há nada para esquecer, e o comportamento acompanha o
# artefato. O caminho é o mesmo que o `giochi-init` procura por padrão.
#
# Para testar o giochi-init sem launcher, crie o marcador no overlay:
#   device/<pasta>/rootfs-overlay/etc/giochi/boot-layer
# ============================================================

set -eu

TARGET_DIR="${TARGET_DIR:-${1:-}}"
if [ -z "$TARGET_DIR" ]; then
    echo "post-build: TARGET_DIR não definido" >&2
    exit 1
fi

INITTAB="$TARGET_DIR/etc/inittab"
INIT_BIN="$TARGET_DIR/usr/bin/giochi-init"
LAUNCHER="$TARGET_DIR/opt/giochi/apps/launcher/bin/giochi-launcher"
FORCE_MARKER="$TARGET_DIR/etc/giochi/boot-layer"

[ -f "$INITTAB" ] || {
    echo "post-build: /etc/inittab não existe — o init não é BusyBox?" >&2
    exit 1
}

# A linha exata. `::` = roda em /dev/console. `respawn` é o que mantém o
# launcher vivo quando um jogo termina (o launcher faz exec, não fork, então
# ninguém sobra para redesenhar).
ENTRADA='::respawn:/usr/bin/giochi-init'

if grep -qxF "$ENTRADA" "$INITTAB" 2>/dev/null; then
    echo "post-build: inittab já chama giochi-init"
    exit 0
fi

[ -x "$INIT_BIN" ] || {
    echo "post-build: giochi-init não está executável — não vou pôr linha que falha" >&2
    exit 1
}

if [ ! -x "$LAUNCHER" ] && [ ! -f "$FORCE_MARKER" ]; then
    echo "post-build: sem launcher e sem marcador /etc/giochi/boot-layer"
    echo "            camada de boot fica desligada (o giochi-init não é chamado)"
    exit 0
fi

# Antes do getty: a tela do aparelho é do launcher, e um getty no console
# roubaria o echo dos primeiros segundos. Vai logo depois do rcS.
if grep -q '^::sysinit:/etc/init.d/rcS$' "$INITTAB"; then
    # `sed` com `a\` é a forma portátil no busybox (o GNU aceita `a` sem barra).
    sed -i "/^::sysinit:\/etc\/init.d\/rcS\$/a $ENTRADA" "$INITTAB"
else
    printf '%s\n' "$ENTRADA" >>"$INITTAB"
fi

echo "post-build: inittab agora respawna giochi-init"
