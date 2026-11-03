#!/bin/sh
# ============================================================
# gles-probe.sh — compila o probe de GLES e, opcionalmente, roda no aparelho.
# ============================================================
#
# Responde "que GLES esta GPU entrega de verdade" sem trazer pacote nenhum para
# a imagem. O .c está em `scripts/gles-probe.c` e explica a decisão.
#
# Uso:
#   bash scripts/gles-probe.sh powkiddy-x35h              # só compila
#   bash scripts/gles-probe.sh powkiddy-x35h --run        # compila e roda por SSH
#   bash scripts/gles-probe.sh powkiddy-x35h --run 10.55.0.2
#
# O binário sai ESTÁTICO de propósito: o aparelho pode não ter a mesma libc do
# staging depois de uma regravação, e um probe que não abre não mede nada.
#
# Requer um build em `work/<device>` (o cross-toolchain mora lá). Se `work/` foi
# limpo, rode o build primeiro — este script não baixa toolchain.

set -eu

DEVICE="${1:-}"
MODE="${2:-}"
HOST="${3:-10.55.0.2}"

if [ -z "$DEVICE" ]; then
    echo "uso: $0 <device-id> [--run [ip]]" >&2
    echo "ex.: $0 powkiddy-x35h --run 10.55.0.2" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK_ROOT="${GIOCHI_SYSTEM_WORK_DIR:-/tmp/giochi-system-work}"
WORK="$WORK_ROOT/$DEVICE"
SRC="$REPO_ROOT/scripts/gles-probe.c"
OUT="$REPO_ROOT/out/$DEVICE/gles-probe"

[ -f "$SRC" ] || { echo "ERRO: $SRC não existe" >&2; exit 1; }
[ -d "$WORK/build/host/bin" ] || {
    echo "ERRO: $WORK/build/host/bin não existe." >&2
    echo "      O cross-toolchain vem do build. Rode:" >&2
    echo "      ALLOW_DRAFT=1 bash scripts/build-device.sh $DEVICE" >&2
    exit 1
}

# O nome do trio vem do próprio Buildroot — não fixe `aarch64-linux-gnu` aqui.
# Em arm64 o trio é `aarch64-buildroot-linux-gnu`; em arm, `arm-buildroot-...`.
CC=""
for c in "$WORK"/build/host/bin/*-buildroot-linux-gnu-gcc; do
    [ -x "$c" ] && CC="$c" && break
done
[ -n "$CC" ] || {
    echo "ERRO: nenhum *-buildroot-linux-gnu-gcc em $WORK/build/host/bin" >&2
    ls "$WORK/build/host/bin" >&2 || true
    exit 1
}

mkdir -p "$REPO_ROOT/out/$DEVICE"

echo "CC = $CC"
# `-Wno-unused-parameter` porque o stub do SDL/EGL às vezes gera aviso em header
# de sistema; não queremos que ruído esconda erro de verdade.
"$CC" -O2 -static -o "$OUT" "$SRC" \
    -lEGL -lGLESv2 \
    || { echo "ERRO: compilação falhou" >&2; exit 1; }

echo "binário: $OUT"
file "$OUT" 2>/dev/null || true
ls -l "$OUT"

if [ "$MODE" != "--run" ]; then
    echo
    echo "Para rodar no aparelho:"
    echo "  scp '$OUT' root@$HOST:/tmp/gles-probe && ssh root@$HOST /tmp/gles-probe"
    exit 0
fi

echo
echo "=== rodando em root@$HOST ==="
# O probe abre /dev/dri: precisa de root, e precisa que nada esteja com o DRM
# master exclusivo. Se o launcher estiver rodando, o resultado pode ser
# EGL_NOT_INITIALIZED — pare o launcher antes de concluir qualquer coisa.
scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    "$OUT" "root@$HOST:/tmp/gles-probe" || {
    echo "ERRO: scp falhou — o aparelho está em $HOST com sshd de pé?" >&2
    exit 1
}
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "root@$HOST" \
    'chmod +x /tmp/gles-probe && /tmp/gles-probe'
