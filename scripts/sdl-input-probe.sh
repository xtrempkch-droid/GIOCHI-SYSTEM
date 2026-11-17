#!/bin/sh
# ============================================================
# sdl-input-probe.sh — pergunta ao SDL2 o que ele vê como controle.
# ============================================================
#
# O `evtest` responde "o kernel entrega BTN_*". Ele **não** responde a pergunta
# que decide se um jogo SDL tem controle: entre o `evdev` e o
# `SDL_GameController` há três portões (classe do device, mapeamento automático
# e `SDL_IsGameController`), e um aparelho pode passar no `evtest` falhando nos
# três. O .c em `scripts/sdl-input-probe.c` explica cada portão.
#
# Uso:
#   bash scripts/sdl-input-probe.sh r35s              # só compila
#   bash scripts/sdl-input-probe.sh r35s --run        # compila e roda por SSH
#   bash scripts/sdl-input-probe.sh r35s --run 10.55.0.2
#   bash scripts/sdl-input-probe.sh powkiddy-x55 --run 10.55.0.2 --video
#
# `--video` faz o SDL abrir o vídeo (KMSDRM) e **disputa o DRM master** com o
# launcher; sem ele o probe só pergunta ao subsistema de joystick, então pode
# rodar com a interface no ar.
#
# Link DINÂMICO, como o `gles-probe.sh`: o objetivo é medir o SDL2 que está no
# aparelho, não congelar o do sysroot dentro do binário.
#
# Requer um build em `work/<device>` — o cross-toolchain e o sysroot vêm dele.

set -eu

DEVICE="${1:-}"
MODE="${2:-}"
HOST="${3:-10.55.0.2}"
EXTRA=""
[ "${4:-}" = "--video" ] && EXTRA="--video"

if [ -z "$DEVICE" ]; then
    echo "uso: $0 <device-id> [--run [ip]] [--video]" >&2
    echo "ex.: $0 r35s --run 10.55.0.2" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK_ROOT="${GIOCHI_SYSTEM_WORK_DIR:-$HOME/.cache/giochi-system/work}"
WORK="$WORK_ROOT/$DEVICE"
SRC="$REPO_ROOT/scripts/sdl-input-probe.c"
OUT="$REPO_ROOT/out/$DEVICE/sdl-input-probe"

[ -f "$SRC" ] || { echo "ERRO: $SRC não existe" >&2; exit 1; }
[ -d "$WORK/build/host/bin" ] || {
    echo "ERRO: $WORK/build/host/bin não existe." >&2
    echo "      O cross-toolchain vem do build. Rode:" >&2
    echo "      ALLOW_DRAFT=1 bash scripts/build-device.sh $DEVICE" >&2
    exit 1
}

CC=""
for c in "$WORK"/build/host/bin/*-buildroot-linux-gnu-gcc; do
    [ -x "$c" ] && CC="$c" && break
done
[ -n "$CC" ] || {
    echo "ERRO: nenhum *-buildroot-linux-gnu-gcc em $WORK/build/host/bin" >&2
    exit 1
}

# O sysroot **do host**, não o symlink `staging`: dentro do container o symlink
# aponta para `/cache/...`, que não existe aqui (§12.47).
SYSROOT=""
for d in "$WORK"/build/host/*-buildroot-linux-gnu/sysroot; do
    [ -d "$d/usr/include/SDL2" ] && SYSROOT="$d" && break
done
[ -n "$SYSROOT" ] || {
    echo "ERRO: sysroot com SDL2 não encontrado em $WORK/build/host/*/sysroot" >&2
    echo "      O SDL2 é compilado no build; sem ele não há o que linkar." >&2
    exit 1
}

mkdir -p "$REPO_ROOT/out/$DEVICE"

echo "CC      = $CC"
echo "sysroot = $SYSROOT"
"$CC" -O2 -Wall -Wextra -o "$OUT" "$SRC" \
    -I"$SYSROOT/usr/include/SDL2" -D_REENTRANT \
    -L"$SYSROOT/usr/lib" -lSDL2 \
    || { echo "ERRO: compilação falhou" >&2; exit 1; }

echo "binário: $OUT"
file "$OUT" 2>/dev/null || true

echo
echo "Como ler o resultado (os três portões, na ordem):"
echo "  joysticks vistos pelo SDL = 0   -> nenhum nó passou na classe do device"
echo "  SDL_IsGameController = NAO      -> é joystick, mas o SDL não sabe mapear"
echo "                                     (sem libudev exige BTN_SOUTH, §12.74)"
echo "  mapeamento: a:b0,b:b1,...       -> confira contra device/<x>/buttons.map"

if [ "$MODE" != "--run" ]; then
    echo
    echo "Para rodar no aparelho:"
    echo "  bash $0 $DEVICE --run $HOST"
    exit 0
fi

echo
echo "=== rodando em root@$HOST ==="
scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    "$OUT" "root@$HOST:/tmp/sdl-input-probe" || {
    echo "ERRO: scp falhou — o aparelho está em $HOST com sshd de pé?" >&2
    exit 1
}
# Sem `--video` isto não toca no DRM: pode rodar com o launcher no ar.
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "root@$HOST" \
    "chmod +x /tmp/sdl-input-probe && /tmp/sdl-input-probe $EXTRA"
