#!/bin/bash
# ============================================================
# audio-validar.sh — prova que o áudio do aparelho toca, medindo
# ============================================================
#
# Uso:
#   bash scripts/audio-validar.sh                    # aparelho em 10.55.0.2
#   bash scripts/audio-validar.sh --ip 10.55.0.3     # outro endereço
#   bash scripts/audio-validar.sh --duracao 2        # tom mais longo
#
# ## Por que existe, e por que não é o `speaker-test` na mão
#
# "Toca ou não toca" é a pergunta errada: ela depende do ouvido de quem está
# com o aparelho e some do registro. O que dá para MEDIR é se o PCM de
# reprodução recebeu dados durante o teste — `/proc/asound/card*/pcm0p/sub0/
# status` responde `state: RUNNING` com o `owner_pid` de quem está tocando
# enquanto o som corre. É a técnica que já separou "abriu o dispositivo" de
# "havia dados indo para o DAC" no §12.56.
#
# O script NÃO conclui que o falante está bom só porque o PCM rodou — ele diz
# o que mediu. A cadeia que ele cobre:
#
#   card registrado -> roteamento (Playback Mux) casa com o DTS
#   -> volume != 0 -> PCM em RUNNING durante a reprodução
#
# O que fica fora, de propósito: se o som SAI do falante. Isso é físico, e a
# única prova é ouvir. O script imprime a frase exata para a pessoa confirmar.
#
# ## Por que `speaker-test` e não o launcher
#
# `speaker-test` gera a senoide sem arquivo de mídia (a imagem não tem mídia) e
# fala ALSA direto. Ele NÃO prova o caminho SDL2 -> ALSA — isso é o
# `scripts/audio-alerta.sh`, que precisa do sysroot do build para compilar o
# probe. São perguntas diferentes: aqui é "a placa toca?", lá é "o app toca?".
# ============================================================

set -uo pipefail

IP="${GIOCHI_DEVICE_IP:-10.55.0.2}"
DURACAO=1

while (($#)); do
    case "$1" in
        --ip) shift; IP="${1:-}" ;;
        --duracao) shift; DURACAO="${1:-1}" ;;
        -h|--help)
            # Uso explícito, e NÃO recorte do cabeçalho: o cabeçalho cresce e o
            # recorte passa a imprimir prosa ou código sem avisar (§12.60).
            cat <<'AJUDA'
Uso: bash scripts/audio-validar.sh [opções]

Mede o áudio do aparelho pela rede USB (SSH em root@10.55.0.2):
card registrado, Playback Mux casando com o DTS, volume, e PCM de
reprodução em RUNNING durante um tom de 440 Hz.

  --ip <endereço>    IP do aparelho (padrão 10.55.0.2 ou $GIOCHI_DEVICE_IP)
  --duracao <s>      duração do tom (padrão 1)
  -h, --help         esta ajuda

Sai com 0 só quando nenhuma verificação falha. "Saiu som do falante" é
físico e continua sendo confirmado por quem está com o aparelho.
AJUDA
            exit 0
            ;;
        *) echo "ERRO: argumento desconhecido: $1" >&2; exit 2 ;;
    esac
    shift
done

if ! ssh -o BatchMode=no -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
        -o NumberOfPasswordPrompts=1 "root@$IP" true 2>/dev/null; then
    echo "ERRO: não consegui falar com root@$IP." >&2
    echo "      O aparelho está ligado e com o cabo USB plugado? O PC recebeu 10.55.0.1?" >&2
    exit 1
fi

# O script roda NO APARELHO, por stdin: assim não há camada de aspas entre o
# host e o busybox ash, que é onde comandos remotos costumam quebrar.
ssh -o StrictHostKeyChecking=no "root@$IP" sh -s -- "$DURACAO" <<'REMOTO'
set -u
DURACAO="${1:-1}"
FALHAS=0
AVISOS=0

pass() { printf '[PASS] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; AVISOS=$((AVISOS + 1)); }
fail() { printf '[FAIL] %s\n' "$*"; FALHAS=$((FALHAS + 1)); }

echo "=== aparelho ==="
echo "host:     $(hostname 2>/dev/null || echo '?')"
COMPAT=$(cat /proc/device-tree/compatible 2>/dev/null | tr '\0' ' ' | sed 's/ *$//' || true)
echo "compat:   ${COMPAT:-(sem device tree)}"
echo "kernel:   $(uname -r)"

echo
echo "=== card de som ==="
if [ ! -r /proc/asound/cards ]; then
    fail "sem /proc/asound — ALSA não carregou"
    echo "RESUMO: $FALHAS falha(s), $AVISOS aviso(s)"
    exit 1
fi

CARDS=$(grep -c '^[[:space:]]*[0-9]' /proc/asound/cards 2>/dev/null)
if [ "${CARDS:-0}" -gt 0 ]; then
    pass "placas de som: $(grep '^[[:space:]]*[0-9]' /proc/asound/cards | sed 's/^[[:space:]]*//' | tr '\n' ' ')"
else
    fail "nenhuma placa de som — ASoC provavelmente em deferred probe"
    echo "RESUMO: $FALHAS falha(s), $AVISOS aviso(s)"
    exit 1
fi

# `hw:` aceita o NÚMERO do card; o id entre colchetes nem sempre é aceito como
# nome de dispositivo, e a falha aparece só no `speaker-test`. Pega os dois.
CARD_LINHA=$(grep '^[[:space:]]*[0-9]' /proc/asound/cards 2>/dev/null | head -n 1)
CARD_NUM=$(printf '%s\n' "$CARD_LINHA" | awk '{print $1}')
CARD_ID=$(printf '%s\n' "$CARD_LINHA" | sed -n 's/.*\[\([^]]*\)\].*/\1/p' | sed 's/[[:space:]]*$//')
echo "card:     hw:${CARD_NUM:-0} (${CARD_ID:-?})"

echo
echo "=== roteamento (Playback Mux) ==="
# O valor certo NÃO é universal: depende de como o DTS liga o falante.
#   R35S  — "Speaker -> SPKO"    => SPK   (com HP o falante fica mudo)
#   X55   — "Speaker Amp INL <- HPOL" => HP
#
# Mesma heurística do `giochi-selftest`, de propósito: duas ferramentas com
# opiniões diferentes sobre o mux esperado seriam confusão nova, e o parser de
# lá cobre "Speaker Amp INL" e "Speaker" na mesma regra.
#
# Globs, e NÃO `find`: o `find` do busybox não desce em `/proc/device-tree`
# (§12.52). Dois níveis cobrem o nó na raiz e sob um pai.
EXPECT_MUX=""
EXPECT_WHY=""
for rota in /proc/device-tree/*/simple-audio-card,routing \
            /proc/device-tree/*/*/simple-audio-card,routing; do
    [ -r "$rota" ] || continue
    PARSED=$(tr '\0' '\n' < "$rota" 2>/dev/null | awk '
        NR % 2 == 1 { src = $0; next }
        {
            if (src ~ /[Ss]peaker/) {
                if ($0 ~ /^SPK/) { print "SPK|" src " -> " $0; exit }
                if ($0 ~ /HPO/)  { print "HP|"  src " -> " $0; exit }
            }
        }
    ' 2>/dev/null)
    if [ -n "$PARSED" ]; then
        EXPECT_MUX=${PARSED%%|*}
        EXPECT_WHY=${PARSED#*|}
        break
    fi
done

MUX=""
if command -v amixer >/dev/null 2>&1; then
    MUX=$(amixer sget "Playback Mux" 2>/dev/null | sed -n "s/.*Item0: '\([A-Z]*\)'.*/\1/p" | head -n 1)
fi
if [ -z "$MUX" ] && [ -r /etc/giochi/asound.state ]; then
    MUX=$(awk '/name .Playback Mux./ {achou = 1; next}
               achou && /value/ {gsub(/[[:space:]]/, "", $0); sub(/^value/, "", $0); print; exit}' \
          /etc/giochi/asound.state 2>/dev/null)
fi

if [ -z "$MUX" ]; then
    if command -v amixer >/dev/null 2>&1; then
        warn "controle 'Playback Mux' não encontrado no mixer"
    else
        warn "sem 'amixer' e sem /etc/giochi/asound.state — o mux não pôde ser lido"
    fi
elif [ -z "$EXPECT_MUX" ]; then
    warn "Playback Mux = $MUX — o 'Speaker' do DT não permitiu decidir o esperado"
elif [ "$MUX" = "$EXPECT_MUX" ]; then
    pass "Playback Mux = $MUX (casa com o DTS: $EXPECT_WHY)"
else
    fail "Playback Mux = $MUX — o DTS roteia '$EXPECT_WHY', então precisa ser $EXPECT_MUX (em $MUX o falante fica MUDO)"
fi

echo
echo "=== volume ==="
# DOIS nomes para o mesmo controle, e isso custa uma rodada se não for previsto:
# `alsactl`/o `asound.state` usam o nome do kcontrol (`Master Playback Volume`),
# e o `amixer` usa o nome SIMPLES (`Master`). Medido no R35S em 15/11/2026 —
# `amixer sget "Master Playback Volume"` responde "Unable to find simple
# control", e o script reportava "não consegui ler o volume" num mixer a 100%.
VOL=""
VOL_NOME=""
if command -v amixer >/dev/null 2>&1; then
    for nome in "Master Playback Volume" "Master" "Digital Playback Volume" "PCM"; do
        VOL=$(amixer sget "$nome" 2>/dev/null | sed -n "s/.*\[\([0-9]*\)%\].*/\1/p" | head -n 1)
        if [ -n "$VOL" ]; then
            VOL_NOME="$nome"
            break
        fi
    done
fi

if [ -z "$VOL" ]; then
    if command -v amixer >/dev/null 2>&1; then
        warn "nenhum controle de volume de reprodução reconhecido em: $(amixer scontrols 2>/dev/null | sed -n "s/.*'\([^']*\)'.*/\1/p" | tr '\n' ' ')"
    else
        warn "sem 'amixer' na imagem — volume não medido"
    fi
elif [ "$VOL" -eq 0 ]; then
    fail "$VOL_NOME = 0% — a cadeia está muda por volume"
else
    pass "$VOL_NOME = $VOL%"
fi

# O RK817 é invertido (`xinvert=1`): registrador 0x00 é 0 dB, NÃO mudo. Ler o
# registrador sem ler o `xinvert` leva à conclusão oposta à verdade (§12.56).
if command -v amixer >/dev/null 2>&1; then
    MUTE=$(amixer sget "DAC Mute" 2>/dev/null | sed -n "s/.*\[\(on\|off\)\].*/\1/p" | head -n 1)
    [ "$MUTE" = "on" ] && pass "DAC desmutado" || true
fi

echo
echo "=== reprodução real (speaker-test ${DURACAO}s) ==="
if ! command -v speaker-test >/dev/null 2>&1; then
    warn "sem 'speaker-test' na imagem — a reprodução não pôde ser provada"
else
    STATUS_PCM=$(ls /proc/asound/card*/pcm0p/sub0/status 2>/dev/null | head -n 1)
    if [ -z "$STATUS_PCM" ]; then
        warn "sem pcm0p de reprodução — o card existe, mas nenhum PCM de saída"
    else
        # Em segundo plano: o status só mostra RUNNING ENQUANTO há dados.
        #
        # DOIS canais, e a primeira tentativa foi com UM. Medido no R35S em
        # 15/11/2026: `-c 1` devolve "Channels count (1) not available for
        # playbacks: Invalid argument" e o PCM fica `closed` — o veredito era
        # "os dados não chegaram ao DAC" num card que toca normalmente. O card
        # do RK817 é estéreo, e não há como saber isso sem abrir o dispositivo.
        LOG_TESTE=/tmp/giochi-audio-teste.log
        speaker-test -D "hw:${CARD_NUM:-0},0" -t sine -f 440 -l 1 -c 2 -p 1 \
            >"$LOG_TESTE" 2>&1 &
        TESTE=$!
        VISTO=""
        i=0
        while [ "$i" -lt 40 ]; do
            estado=$(sed -n 's/^state:[[:space:]]*//p' "$STATUS_PCM" 2>/dev/null | head -n 1)
            dono=$(sed -n 's/^owner_pid[^:]*:[[:space:]]*//p' "$STATUS_PCM" 2>/dev/null | head -n 1)
            if [ "${estado:-}" = "RUNNING" ]; then
                VISTO="RUNNING (owner_pid ${dono:-?})"
                break
            fi
            i=$((i + 1))
            sleep 0.1
        done

        # Espera o processo terminar para não deixar tom tocando ao encerrar.
        espera=0
        while kill -0 "$TESTE" 2>/dev/null && [ "$espera" -lt 80 ]; do
            espera=$((espera + 1))
            sleep 0.1
        done
        kill "$TESTE" 2>/dev/null || true

        if [ -n "$VISTO" ]; then
            pass "PCM de reprodução em $VISTO durante o tom"
            echo "       -> se o PCM rodou e NÃO saiu som do falante, o problema"
            echo "          está DEPOIS do DAC (amp, conector, falante) — o kernel"
            echo "          já entregou os dados."
            echo "       -> se saiu som, o áudio do sistema está validado."
        else
            # O motivo tem de aparecer: `speaker-test` falhando por parâmetro
            # recusado e falhando por driver ausente dão o MESMO veredito, e só
            # a mensagem dele distingue as duas.
            MOTIVO=$(grep -i -E "invalid|not available|failed|error" "$LOG_TESTE" 2>/dev/null | head -n 2 | tr '\n' ' ')
            fail "o PCM nunca entrou em RUNNING — os dados não chegaram ao DAC"
            if [ -n "$MOTIVO" ]; then
                echo "       speaker-test: $MOTIVO"
            else
                echo "       (o speaker-test não registrou erro — suspeitar de mux/volume)"
            fi
        fi
    fi
fi

echo
echo "=== erros no dmesg ==="
if command -v dmesg >/dev/null 2>&1; then
    ERROS=$(dmesg 2>/dev/null | grep -i -E 'rk817.*(error|fail)|i2s.*(error|fail)|asoc.*(error|fail)' | tail -n 5)
    if [ -z "$ERROS" ]; then
        pass "nenhuma mensagem de erro de rk817/i2s/asoc no dmesg"
    else
        warn "mensagens de erro no dmesg:"
        printf '       %s\n' "$ERROS"
    fi
fi

echo
echo "RESUMO: $FALHAS falha(s), $AVISOS aviso(s)"
[ "$FALHAS" -eq 0 ] || exit 1
REMOTO
