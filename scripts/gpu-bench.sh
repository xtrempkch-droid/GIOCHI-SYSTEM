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
#   bash scripts/gpu-bench.sh powkiddy-x55                  # só compila
#   bash scripts/gpu-bench.sh powkiddy-x55 --run            # compila e roda
#   bash scripts/gpu-bench.sh r35s --run 10.55.0.2 --iface usb0 --repetir 3
#
# `--iface` existe por um defeito do próprio sistema, medido em 08/11/2026: o
# gadget USB usa **MAC e IP fixos** em todo aparelho (`giochi-usbnet`), então
# com dois handhelds plugados no mesmo PC os dois respondem a `10.55.0.2` com o
# mesmo MAC. `ssh -o BindInterface=` não resolveu (o tráfego saiu pela interface
# do outro aparelho — conferido nos contadores de `/sys/class/net/*/statistics`).
# O que funciona é `SO_BINDTODEVICE`, e é o que `scripts/ssh-por-iface.py` faz.
#
# Três coisas que o script faz e que mudam o número, então estão explícitas:
#
# 1. **Fixa os governors em `performance` durante a bateria.** O RK3566 sobe a
#    GPU de 200 a 800 MHz por `simple_ondemand`; sem fixar, a primeira medida
#    pega a GPU ainda fria e o resultado depende da ordem dos testes. A CPU
#    também conta: `many_draws` é CPU-bound e mudou +31% ao fixá-la. O governor
#    original de cada nó é restaurado no `trap` — inclusive se o script morrer.
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
IFACE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --run)      MODE="run"; shift ;;
        --repetir)  REPEAT="${2:-1}"; shift 2 ;;
        --iface)    IFACE="${2:-}"; shift 2 ;;
        -*)         echo "opção desconhecida: $1" >&2; exit 1 ;;
        *)          HOST="$1"; shift ;;
    esac
done

if [ -z "$DEVICE" ]; then
    echo "uso: $0 <device-id> [--run [ip]] [--iface <interface>] [--repetir N]" >&2
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

# As opções vão escritas AQUI dentro, e não numa variável: `$REMOTO` sem aspas
# se parte em palavras, e `-o ProxyCommand=python3 ...` chega ao ssh como seis
# argumentos (a primeira versão morreu com "unknown option -- -").
#
# Com `--iface`, a host key conhecida não serve: os dois aparelhos respondem ao
# mesmo IP com chaves diferentes, e o SSH se recusa a conectar — com razão.
# `UserKnownHostsFile=/dev/null` sempre: o IP `10.55.0.2` é compartilhado por
# projeto, então o mesmo endereço tem uma chave por aparelho e o known_hosts
# acusa "HOST IDENTIFICATION HAS CHANGED" a cada troca — o que é verdadeiro e
# inútil aqui, porque o link é um cabo USB direto. Quem confere a identidade é a
# trava abaixo, pelo `device=` da imagem.
run_ssh() {
    if [ -n "$IFACE" ]; then
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
            -o "ProxyCommand=python3 $REPO_ROOT/scripts/ssh-por-iface.py --iface $IFACE %h %p" "$@"
    else
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$@"
    fi
}

run_scp() {
    if [ -n "$IFACE" ]; then
        scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
            -o "ProxyCommand=python3 $REPO_ROOT/scripts/ssh-por-iface.py --iface $IFACE %h %p" "$@"
    else
        scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$@"
    fi
}

echo
echo "== aparelho: $HOST${IFACE:+ (interface $IFACE)} =="
INFO="$(run_ssh "root@$HOST" 'set +e
cat /etc/giochi/build-info.txt 2>/dev/null | grep -E "^(device|commit|built_at_utc)="
uname -r
echo "gpu_devfreq=$(ls /sys/class/devfreq 2>/dev/null | tr "\n" " ")"')"
echo "$INFO"

# Trava de identidade, e ela não é paranoia: todos os aparelhos respondem em
# 10.55.0.2 com o mesmo MAC. Sem esta conferência, medir o R35S na X55 produz um
# resultado perfeitamente plausível com o nome do aparelho errado — e ninguém
# descobre. `device=` do build-info é gravado no build, não é configurável pelo
# ambiente.
REMOTO_DEV="$(printf '%s\n' "$INFO" | sed -n 's/^device=//p' | tr -d '\r')"
if [ -z "$REMOTO_DEV" ]; then
    echo "AVISO: a imagem não tem device= no /etc/giochi/build-info.txt;"
    echo "       não há como conferir se é o '$DEVICE'. Seguindo."
elif [ "$REMOTO_DEV" != "$DEVICE" ]; then
    echo >&2
    echo "ERRO: conectei em '$REMOTO_DEV', não em '$DEVICE'." >&2
    echo "      Com dois aparelhos plugados, 10.55.0.2 é ambíguo e o MAC é o" >&2
    echo "      mesmo nos dois. Escolha a interface do aparelho:" >&2
    echo "        for p in /sys/bus/usb/devices/*/serial; do echo \"\$p: \$(cat \$p)\"; done" >&2
    echo "        bash scripts/gpu-bench.sh $DEVICE --run --iface usb0" >&2
    exit 1
fi

run_scp "$BIN" "root@$HOST:/tmp/gpu-bench" || { echo "ERRO: scp falhou" >&2; exit 1; }

# Guarda o estado original; restaura mesmo se o script for interrompido.
run_ssh "root@$HOST" 'set -e
: > /tmp/gpu-bench-gov.bak
# O nome do arquivo depende do subsistema e isso já custou uma rodada: devfreq
# expõe `governor` (fde60000.gpu) e cpufreq expõe `scaling_governor`
# (policy0). Procurar só por `governor` fixava a GPU e deixava a CPU no
# `schedutil` sem avisar — e o teste de submissão é justamente CPU-bound.
for f in /sys/class/devfreq/*/governor /sys/devices/system/cpu/cpufreq/policy*/scaling_governor; do
    [ -r "$f" ] || continue
    printf "%s %s\n" "$f" "$(cat "$f")" >> /tmp/gpu-bench-gov.bak
    echo performance > "$f" 2>/dev/null || true
done
echo "governors fixados em performance:"
sed "s|/sys/||" /tmp/gpu-bench-gov.bak
echo "gpu_max=$(cat /sys/class/devfreq/*/max_freq 2>/dev/null | sort -n | tail -1)"'

restore() {
    run_ssh "root@$HOST" 'set +e
while read -r d g; do [ -w "$d" ] && echo "$g" > "$d" 2>/dev/null; done < /tmp/gpu-bench-gov.bak
echo "governors restaurados:"; sed "s|/sys/||" /tmp/gpu-bench-gov.bak
rm -f /tmp/gpu-bench-gov.bak /tmp/gpu-bench' || true
}
trap restore EXIT INT TERM

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$OUTDIR/gpu-bench-$STAMP.txt"

{
    echo "# gpu-bench — $DEVICE"
    echo "# host: $HOST${IFACE:+   interface: $IFACE}   coletado: $STAMP"
    run_ssh "root@$HOST" 'set +e
grep -E "^(commit|built_at_utc)=" /etc/giochi/build-info.txt 2>/dev/null
uname -r'
    echo
} > "$LOG"

i=1
while [ "$i" -le "$REPEAT" ]; do
    echo
    echo "== rodada $i de $REPEAT =="
    run_ssh "root@$HOST" '/tmp/gpu-bench' | tee -a "$LOG"
    i=$((i + 1))
done

echo
echo "resultado salvo em: $LOG"
