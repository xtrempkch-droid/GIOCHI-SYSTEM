#!/bin/bash
# ============================================================
# audio-alerta.sh — emite um tom no aparelho pela via SDL2 → ALSA
# ============================================================
#
# Uso:
#   bash scripts/audio-alerta.sh                    # 1,5 s a 1 kHz
#   bash scripts/audio-alerta.sh 3000 2             # 3 s, aparelho em 3 s
#   bash scripts/audio-alerta.sh --alar             # 3 bipes curtos (mais audível)
#
# ## Por que não `speaker-test`
#
# `speaker-test` fala ALSA **direto**. Num aparelho onde o SDL2 foi compilado
# com `--disable-alsa`, ele toca normalmente e **todo app SDL fica mudo** — foi
# exatamente o defeito do §12.56, medido no R35S: `speaker-test` funcionava e a
# engine avisava `dsp: No such audio device`.
#
# Este script usa o mesmo caminho que o jogo usa: SDL2 → ALSA. O
# `sdl-audio-probe` imprime o driver escolhido, então "tocou" e "o SDL2 não
# conseguiu abrir" não se confundem.
#
# ## O que ele confere antes de tocar
#
# Se o `Playback Mux` estiver errado (HP num aparelho com alto-falante em SPK),
# o som sai para o fone e ninguém ouve nada — sintoma que já custou uma rodada
# (§12.52). O script lê o valor e avisa, sem mudar: qual mux é o certo é decisão
# do aparelho, registrada no `asound.state`.

set -uo pipefail

DURACAO_S="${1:-1.5}"
REPETICOES="${2:-1}"
IP="${GIOCHI_DEVICE_IP:-10.55.0.2}"

if [ "${1:-}" = "--alar" ]; then
    DURACAO_S=0.35; REPETICOES=3
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/scripts/sdl-audio-probe.c"

ssh_dev() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
        -o PreferredAuthentications=publickey,password -o NumberOfPasswordPrompts=1 \
        "root@$IP" "$@"
}

# Qual aparelho? Perguntado AO APARELHO, não fixado no script.
#
# A versão anterior cravava `r35s` em três lugares (o binário em `out/r35s/`, a
# busca do toolchain em `work/r35s/` e a mensagem de erro). Apontado para a X55,
# o script cross-compilava com o sysroot do R35S e ninguém percebia: os dois são
# aarch64 e o `libSDL2` liga dinamicamente, então o binário "funcionava" com as
# bibliotecas de outro aparelho. É o §12.24 na forma silenciosa — literal de
# aparelho em script de propósito geral.
DEVICE="${GIOCHI_DEVICE:-$(ssh_dev 'sed -n "s/^device=//p" /etc/giochi/build-info.txt 2>/dev/null' 2>/dev/null | tr -d '\r' | head -n 1)}"
if [ -z "${DEVICE:-}" ]; then
    echo "ERRO: não consegui descobrir o aparelho em $IP." >&2
    echo "      A imagem não tem device= em /etc/giochi/build-info.txt." >&2
    echo "      Defina GIOCHI_DEVICE=<id> para escolher o toolchain." >&2
    exit 1
fi
echo "aparelho: $DEVICE" >&2
BIN="$REPO_ROOT/out/$DEVICE/sdl-audio-probe"
mkdir -p "$REPO_ROOT/out/$DEVICE"

# Cross-compila se o binário não existe ou está velho. O gcc do Buildroot é
# necessário porque o probe é aarch64 e precisa ligar no SDL2 do sysroot.
if [ ! -x "$BIN" ] || [ "$SRC" -nt "$BIN" ]; then
    TOOLCHAIN=""
    WORK="${GIOCHI_SYSTEM_WORK_DIR:-$HOME/.cache/giochi-system/work}"
    for c in "$WORK/$DEVICE"/build/host/bin/*-buildroot-linux-gnu-gcc; do
        [ -x "$c" ] && TOOLCHAIN="$c" && break
    done
    [ -n "$TOOLCHAIN" ] || {
        echo "ERRO: cross-toolchain de '$DEVICE' não encontrado em $WORK/$DEVICE/build/host/bin." >&2
        echo "      O binário precisa do sysroot do build (SDL2 daquele aparelho)." >&2
        exit 1
    }
    echo "compilando o probe..." >&2
    "$TOOLCHAIN" -O2 -o "$BIN" "$SRC" -lSDL2 -lm || exit 1
fi

echo "=== estado de audio em $IP ==="
ssh_dev 'cat /proc/asound/cards 2>/dev/null | head -2
mux=$(amixer -c 0 sget "Playback Mux" 2>/dev/null | sed -n "s/.*Item0: .\(.*\)./\1/p")
vol=$(amixer -c 0 sget Master 2>/dev/null | grep -o "Front Left: Playback [0-9]*" | grep -o "[0-9]*$")
echo "  Playback Mux: ${mux:-?}"
echo "  Master:       ${vol:-?}/255"' || exit 1

# O mux é a armadilha: som saindo para o fone num aparelho de alto-falante.
# Não corrigimos — só avisamos, porque o valor certo é do aparelho (§12.52).
ssh_dev 'mux=$(amixer -c 0 sget "Playback Mux" 2>/dev/null | sed -n "s/.*Item0: .\(.*\)./\1/p");
if [ "$mux" = "HP" ]; then
  echo "  AVISO: mux em HP — se o som sair no fone, o alto-falante fica mudo." >&2
fi'

echo
echo "=== enviando o probe ==="
scp -q -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$BIN" "root@$IP:/tmp/sdl-audio-probe" || exit 1
ssh_dev 'chmod +x /tmp/sdl-audio-probe'

# A duração tem de CHEGAR ao probe. Na versão anterior o script anunciava
# "${DURACAO_S}s" e chamava o binário sem argumento nenhum: o probe tocava o
# próprio padrão de 1500 ms e a saída dizia outra coisa. `--alar` (3 bipes de
# 0,35 s) na prática tocava 1,5 s — o defeito que o §12.30 descreve, em que a
# ferramenta relata a intenção em vez do que fez.
DURACAO_MS=$(awk -v s="$DURACAO_S" 'BEGIN { printf "%d", s * 1000 }')

for i in $(seq 1 "$REPETICOES"); do
    echo
    echo "--- tom $i de $REPETICOES (${DURACAO_MS} ms) ---"
    # `SDL_AUDIODRIVER` não é fixado de propósito: queremos ver qual o SDL2
    # ESCOLHE. Fixar em `alsa` esconderia justamente o defeito do §12.56, em que
    # o SDL2 cai no `dsp`/OSS quando não tem ALSA compilado.
    ssh_dev "cd /tmp && ./sdl-audio-probe $DURACAO_MS" 2>&1 | sed 's/^/  /'
done

echo
echo "Se o tom não foi ouvido e o veredito acima diz 'alsa', verifique:"
echo "  - volume do Master (o script mostrou acima)"
echo "  - o Playback Mux tem de casar com o alto-falante do aparelho"
echo "  - fone plugado desvia o som em muitos aparelhos"
