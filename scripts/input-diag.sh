#!/usr/bin/env bash
# ============================================================
# Giochi System — o aparelho trata os controles como joystick?
# ============================================================
# giochi-system:help:begin
# Uso:
#   bash scripts/input-diag.sh                  # aparelho em 10.55.0.2
#   bash scripts/input-diag.sh 10.55.0.3        # outro endereço
#   bash scripts/input-diag.sh --local          # rodar dentro do aparelho
#
# Responde a pergunta "o sistema está tratando os botões como teclado ou como
# joystick?" com a única fonte que não deduz: a linha `H: Handlers=` de
# /proc/bus/input/devices, onde o PRÓPRIO KERNEL declara a classe de cada
# dispositivo.
#
#     H: Handlers=js0 event2      -> joystick   (o que um handheld quer)
#     H: Handlers=kbd event1      -> teclado    (o sintoma que se investiga)
#     H: Handlers=mouse0 event0   -> ponteiro
#
# Um dispositivo com `kbd` ou `mouse0` nessa linha foi classificado assim pelo
# kernel, e nenhum ajuste de userspace muda isso. Se a linha diz `js` e a tela
# mostra um cursor, o cursor é desenhado por quem está na tela — não pelo kernel.
#
# Existe porque em 17/11/2026 a suspeita foi "o sistema trata os botões como
# teclado e aparece um mouse na tela". O DTS já mapeava tudo para BTN_*, o
# kernel não tinha CONFIG_INPUT_MOUSEDEV nem UINPUT, e a resposta precisava ser
# medida em vez de deduzida de nenhum dos dois lados.
# giochi-system:help:end
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALVO="10.55.0.2"
LOCAL=0

for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=1 ;;
    -h|--help)
      awk '/^# giochi-system:help:begin$/ { d=1; next } /^# giochi-system:help:end$/ { exit } d { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    -*) echo "ERRO: opção desconhecida: $arg" >&2; exit 2 ;;
    *)  ALVO="$arg" ;;
  esac
done

# O diagnóstico inteiro em uma passada. Nada aqui deduz: cada linha ou lê o
# sysfs/procfs, ou pergunta ao `evtest`/`giochi-buttons`.
ler() {
cat <<'REMOTO'
DEVICES="${GIOCHI_DEVICES_FILE:-/proc/bus/input/devices}"
echo "=== aparelho"
cat /etc/giochi/build-info.txt 2>/dev/null | grep -E "^(device|commit)=" || echo "(sem build-info)"
uname -r

echo
echo "=== dispositivos de entrada, com a classe que o KERNEL declara"
if [ -r "$DEVICES" ]; then
    awk '
      /^N: Name=/   { nome = $0; sub(/^N: Name=/, "", nome); gsub(/"/, "", nome) }
      /^H: Handlers=/ { print nome " -> " substr($0, 13) }
    ' "$DEVICES"
else
    echo "(sem $DEVICES)"
fi

echo
echo "=== veredito por dispositivo"
# A pergunta é objetiva: o kernel pôs `kbd` ou `mouse` na lista de handlers?
if [ -r "$DEVICES" ]; then
    awk '
      /^N: Name=/     { nome = $0; sub(/^N: Name=/, "", nome); gsub(/"/, "", nome) }
      /^H: Handlers=/ {
          h = substr($0, 13)
          classe = "?"
          if (h ~ /(^| )js[0-9]/)    classe = "joystick"
          if (h ~ /(^| )mouse[0-9]/) classe = "PONTEIRO (mouse)"
          if (h ~ /(^| )kbd/)        classe = "TECLADO"
          printf "  %-28s %-16s %s\n", nome, classe, h
      }
    ' "$DEVICES"
fi

echo
echo "=== existe node de mouse?"
ls /dev/input/mouse* 2>/dev/null || echo "  nenhum /dev/input/mouse* — o kernel nao criou ponteiro"

echo
echo "=== algum device declara eixos REL (movimento de mouse)?"
achou=0
for e in /sys/class/input/event*; do
    [ -e "$e" ] || continue
    cap="$e/device/capabilities/rel"
    if [ -r "$cap" ]; then
        v=$(cat "$cap" 2>/dev/null)
        case "$v" in ""|0) ;; *) echo "  $(basename "$e"): rel=$v"; achou=1 ;; esac
    fi
done
[ "$achou" = 0 ] && echo "  nenhum — nenhum device reporta REL_X/REL_Y"

echo
echo "=== o que o giochi-buttons encontra"
command -v giochi-buttons >/dev/null 2>&1 && giochi-buttons --list 2>&1 | head -12 || echo "  (giochi-buttons ausente)"

echo
echo "=== quem esta com o input aberto"
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' 2>/dev/null <"/proc/$pid/cmdline")
    case "$cmd" in
        *launcher*|*giochi*) ;;
        *) continue ;;
    esac
    n=0
    for fd in /proc/$pid/fd/*; do
        alvo=$(readlink "$fd" 2>/dev/null) || continue
        case "$alvo" in /dev/input/*) n=$((n+1));; esac
    done
    echo "  pid $pid fds em /dev/input: $n   [$cmd]"
done

echo
echo "=== o launcher (se roda): driver de video"
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    case "$(tr '\0' ' ' 2>/dev/null <"/proc/$pid/cmdline")" in
        *giochi-launcher*) echo "  pid $pid: $(tr '\0' '\n' 2>/dev/null <"/proc/$pid/environ" | grep -E '^SDL_' | tr '\n' ' ')" ;;
    esac
done
REMOTO
}

if [ "$LOCAL" = 1 ]; then
  ler | sh
  exit $?
fi

echo "=== executando no aparelho $ALVO (via ssh)"
ler | ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@$ALVO" 'sh -s' 2>&1
