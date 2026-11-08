#!/bin/sh
# ============================================================
# gpu-bench.sh — compila o benchmark de GPU e roda no aparelho por SSH.
# ============================================================
#
# Responde "qual GPU é mais rápida, no NOSSO stack": o mesmo fonte, o mesmo
# toolchain, a mesma Mesa, a mesma bateria de testes em aparelhos diferentes.
# O `.c` está em `scripts/gpu-bench.c` e explica cada medida.
#
# Uso:
#   bash scripts/gpu-bench.sh powkiddy-x55                 # só compila
#   bash scripts/gpu-bench.sh powkiddy-x55 --run           # compila e roda
#   bash scripts/gpu-bench.sh powkiddy-x55 --run 10.55.0.2 --repetir 3
#
# Três coisas que o script faz e que mudam o número, então estão explícitas:
#
# 1. **Fixa os governors em `performance` durante a bateria.** O RK3566 sobe a
#    GPU de 200 a 800 MHz por `simple_ondemand`; sem fixar, a primeira medida
#    pega a GPU ainda fria e o resultado depende da ordem dos testes. O
#    governor original de cada nó é restaurado no `trap` — inclusive se o
#    script morrer no meio.
#
# 2. **Não reinicia, não instala nada, não toca no launcher.** O binário vai
#    para `/tmp` e é apagado no fim. Renderização é offscreen (surfaceless +
#    FBO), então o DRM master de quem estiver rodando não é disputado.
#
# 3. **Guarda a saída em `out/<device>/`**, com o cabeçalho de identidade da
#    imagem. Sem isso, dois números de semanas diferentes acabam comparados como
#    se fossem do mesmo commit — que é o erro que o `build-info.txt` existe para
#    evitar.

set -eu

DEVICE="${1:-}"
shift 2>/dev/null || true

MODE=""
HOST="10.55.0.2"
REPEAT=1

while [ $# -gt 0 ]; do
    case "$1" in
        --run)      MODE="run"; shift ;;
        --repetir)  REPEAT="${2:-1}"; shift 2 ;;
        -*)         echo "opção desconhecida: $1" >&2; exit 1 ;;
        *)          HOST="$1"; shift ;;
    esac
done

if [ -z "$DEVICE" ]; then
    echo "uso: $0 <device-id> [--run [ip]] [--repetir N]" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK_ROOT="${GIOCHI_SYSTEM_WORK_DIR:-$HOME/.cache/giochi-system/work}"
WORK="$WORK_ROOT/$DEVICE"
SRC="$REPO_ROOT/scripts/gpu-bench.c"
OUTDIR="$REPO_ROOT/out/$DEVICE"
BIN="$OUTDIR/gpu-bench"

[ -f "$SRC" ] || { echo "ERRO: $SRC não existe" >&2; exit 1; }
[ -d "$WORK/build/host/bin" ] || {
    echo "ERRO: $WORK/build/host/bin não existe." >&2
    echo "      O cross-toolchain vem do build. Rode o build do aparelho antes." >&2
    exit 1
}

CC=""
for c in "$WORK"/build/host/bin/*-buildroot-linux-gnu-gcc; do
    [ -x "$c" ] && CC="$c" && break
done
[ -n "$CC" ] || { echo "ERRO: nenhum *-buildroot-linux-gnu-gcc em $WORK/build/host/bin" >&2; exit 1; }

mkdir -p "$OUTDIR"

echo "CC = $CC"
# -O2 e link DINÂMICO: o objetivo é medir a Mesa do APARELHO, não uma cópia do
# sysroot embutida no binário (§12.51: o probe estático mediria a Mesa errada).
# -lm não é preciso: o benchmark não usa função de biblioteca matemática.
"$CC" -O2 -Wall -Wextra -o "$BIN" "$SRC" -lEGL -lGLESv2 \
    || { echo "ERRO: compilação falhou" >&2; exit 1; }

echo "binário: $BIN"
ls -l "$BIN"

[ "$MODE" = "run" ] || exit 0

# ---------------------------------------------------------------- remoto ---
#
# Os governors são lidos, trocados e restaurados no APARELHO. O `trap` do shell
# local não sobrevive a uma queda de SSH, então a restauração é feita por um
# comando remoto que também é protegido — e o script confere no fim que voltou.

echo
echo "== aparelho: $HOST =="
ssh -o StrictHostKeyChecking=no "root@$HOST" 'set +e
cat /etc/giochi/build-info.txt 2>/dev/null | grep -E "^(device|commit|built_at_utc)=" 
uname -r
echo "gpu_devfreq=$(ls /sys/class/devfreq 2>/dev/null | tr "\n" " ")"'

scp -o StrictHostKeyChecking=no -q "$BIN" "root@$HOST:/tmp/gpu-bench" || {
    echo "ERRO: scp falhou" >&2; exit 1
}

# Guarda o estado original; restaura mesmo se o script for interrompido.
ssh -o StrictHostKeyChecking=no "root@$HOST" 'set -e
: > /tmp/gpu-bench-gov.bak
for d in /sys/class/devfreq/* /sys/devices/system/cpu/cpufreq/policy*; do
    [ -r "$d/governor" ] || continue
    printf "%s %s\n" "$d" "$(cat "$d/governor")" >> /tmp/gpu-bench-gov.bak
    echo performance > "$d/governor" 2>/dev/null || true
done
echo "governors fixados em performance:"
cat /tmp/gpu-bench-gov.bak | sed "s|/sys/||"'

restore() {
    ssh -o StrictHostKeyChecking=no "root@$HOST" 'set +e
while read -r d g; do [ -w "$d/governor" ] && echo "$g" > "$d/governor" 2>/dev/null; done < /tmp/gpu-bench-gov.bak
echo "governors restaurados:"; cat /tmp/gpu-bench-gov.bak | sed "s|/sys/||"
rm -f /tmp/gpu-bench-gov.bak /tmp/gpu-bench' || true
}
trap restore EXIT INT TERM

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$OUTDIR/gpu-bench-$STAMP.txt"

{
    echo "# gpu-bench — $DEVICE"
    echo "# host: $HOST   coletado: $STAMP"
    ssh -o StrictHostKeyChecking=no "root@$HOST" 'set +e
grep -E "^(commit|built_at_utc)=" /etc/giochi/build-info.txt 2>/dev/null
uname -r; echo "mesa=$(strings /usr/lib/libGLESv2.so 2>/dev/null | grep -m1 -o "Mesa [0-9.]*")"'
    echo
} > "$LOG"

i=1
while [ "$i" -le "$REPEAT" ]; do
    echo
    echo "== rodada $i de $REPEAT =="
    ssh -o StrictHostKeyChecking=no "root@$HOST" '/tmp/gpu-bench' | tee -a "$LOG"
    i=$((i + 1))
done

echo
echo "resultado salvo em: $LOG"
