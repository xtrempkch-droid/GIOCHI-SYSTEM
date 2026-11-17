#!/usr/bin/env bash
# ============================================================
# Giochi System — por que a tela não acendeu neste boot?
# ============================================================
# giochi-system:help:begin
# Uso:
#   bash scripts/panel-diag.sh                  # aparelho em 10.55.0.2
#   bash scripts/panel-diag.sh 10.55.0.3        # outro endereço
#   bash scripts/panel-diag.sh --log <arquivo>  # analisa um giochi-boot.log do cartão
#   bash scripts/panel-diag.sh --local          # rodar dentro do aparelho
#
# Responde "o painel foi inicializado neste boot?" com o que o kernel registrou,
# em vez de deduzir do que a tela mostra.
#
# ## Por que existe
#
# Relato de 17/11/2026 no X35H: em alguns boots frios a tela não acende, e
# apertar o botão de reiniciar faz a tela funcionar. A pergunta era se isso
# poderia ser "detecção de painel" — não pode, e o `--log` mostra por quê:
# painel MIPI-DSI não se anuncia. O kernel casa `compatible` do device tree com
# uma tabela no driver e usa o modo que está escrito em C. Não há o que detectar.
# Então tela apagada é **falha de inicialização**, e as mensagens do kernel
# dizem em qual das três etapas ela parou:
#
#   1. `dw-mipi-dsi`   — o controlador DSI subiu? (PLL, lanes)
#   2. `panel-sitronix` — o painel inicializou? (`enable` devolve `accum_err`)
#   3. `pwm-backlight` — a luz de fundo ligou?
#
# As três são independentes, e o sintoma visual é o mesmo nas três: tela apagada.
# Só o log separa.
#
# ## O log do boot que falhou existe
#
# O X35H liga o `S96bootlog` (marcador `/etc/giochi/boot-log`), então cada boot
# grava `giochi-boot.log` na partição FAT do cartão. O boot que falhou deixa o
# dmesg dele lá — é a única forma de comparar um boot ruim com um bom, porque
# `dmesg` em memória se perde no reset.
# giochi-system:help:end
# ============================================================

set -euo pipefail

ALVO="10.55.0.2"
LOCAL=0
ARQUIVO_LOG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --local) LOCAL=1; shift ;;
    --log) ARQUIVO_LOG="${2:-}"; [ -n "$ARQUIVO_LOG" ] || { echo "ERRO: --log sem arquivo" >&2; exit 2; }; shift 2 ;;
    -h|--help)
      awk '/^# giochi-system:help:begin$/ { d=1; next } /^# giochi-system:help:end$/ { exit } d { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    -*) echo "ERRO: opção desconhecida: $1" >&2; exit 2 ;;
    *) ALVO="$1"; shift ;;
  esac
done

# O diagnóstico roda dos dois lados: dentro do aparelho (`--local`) e sobre um
# log já gravado (`--log`). A análise é a MESMA função, para o veredito de um
# boot gravado não divergir do veredito ao vivo — que é como um diagnóstico
# passa a mentir com o tempo.
analisar() {
  local origem="$1"
  echo "=== fonte: $origem"

  # ── 1. o controlador DSI ───────────────────────────────────
  echo
  echo "--- DSI (controlador)"
  if grep -qiE "dw-mipi-dsi|dw_mipi_dsi" "$origem" 2>/dev/null; then
    grep -iE "dw-mipi-dsi|dw_mipi_dsi" "$origem" | tail -6
  else
    echo "  (nenhuma linha do dw-mipi-dsi: o controlador não chegou a probe)"
  fi
  # ARMADILHA MEDIDA (§12.56/§12.59): `grep -c` imprime "0" E sai com status 1
  # quando não casa, então `$(grep -c ... || echo 0)` produz "0\n0" e o `[ -gt ]`
  # depois falha em silêncio — o gate passaria justamente no caso que existe
  # para pegar. Aqui eu reproduzi o defeito antes de corrigir: o veredito de um
  # boot BOM saía com "esperava número inteiro".
  #
  # O certo é deixar o `0` do próprio `grep` valer, e só tratar o status:
  local erros_dsi
  erros_dsi=$(grep -icE "dsi.*(error|fail|timeout)|(error|fail|timeout).*dsi" "$origem" 2>/dev/null) || erros_dsi=0
  echo "  linhas com erro de DSI: $erros_dsi"

  # ── 2. o painel ────────────────────────────────────────────
  echo
  echo "--- PAINEL (panel-sitronix-st7703)"
  if grep -qi "st7703" "$origem" 2>/dev/null; then
    grep -i "st7703" "$origem" | tail -8
  else
    echo "  (nenhuma linha do st7703 — o painel não foi inicializado neste boot)"
  fi
  # `st7703_enable()` devolve `dsi_ctx.accum_err`: um comando DCS que falhou
  # aparece como erro do DRM, não como silêncio. Procurar é a diferença entre
  # "não inicializou" e "inicializou e nada apareceu".
  local erro_painel
  erro_painel=$(grep -icE "panel.*(fail|error)|(fail|error).*panel" "$origem" 2>/dev/null) || erro_painel=0
  echo "  linhas com erro de painel: $erro_painel"

  # ── 3. a luz de fundo ──────────────────────────────────────
  echo
  echo "--- BACKLIGHT"
  grep -iE "backlight|pwm-backlight" "$origem" 2>/dev/null | tail -5 || echo "  (nenhuma linha de backlight)"

  # ── 4. o VOP / modos DRM ───────────────────────────────────
  echo
  echo "--- DRM/VOP"
  grep -iE "vop2?|rockchip-drm|drm.*mode" "$origem" 2>/dev/null | tail -6 || echo "  (nenhuma linha de DRM)"

  # ── 5. regulador do LCD ────────────────────────────────────
  echo
  echo "--- ALIMENTAÇÃO do LCD"
  grep -iE "vcc_lcd|vcc-lcd" "$origem" 2>/dev/null | tail -5 || echo "  (nada sobre vcc_lcd)"

  # ── veredito ───────────────────────────────────────────────
  echo
  echo "=== veredito"
  if [ "$erro_painel" -gt 0 ]; then
    echo "  O painel REPORTou erro ao inicializar."
    echo "  -> a falha é de inicialização (sequência DCS ou alimentação), não de detecção."
    echo "  -> veja as linhas de PAINEL acima: o primeiro comando que falhou está lá."
  elif [ "$erros_dsi" -gt 0 ]; then
    echo "  O controlador DSI reportou erro; o painel pode nem ter sido alcançado."
    echo "  -> a falha é de link (PLL, lanes, clock), não de painel."
  elif grep -qi "st7703" "$origem" 2>/dev/null; then
    echo "  O painel inicializou sem erro registrado."
    echo "  -> se a tela ficou apagada, o defeito é DEPOIS da inicialização:"
    echo "     backlight, VOP ou o modo DRM. Compare com um boot bom:"
    echo "       diff <(bash scripts/panel-diag.sh --log ruim.log) \\"
    echo "            <(bash scripts/panel-diag.sh --log bom.log)"
  else
    echo "  O painel NÃO aparece no log deste boot."
    echo "  -> ou o probe não chegou (dependência, -EPROBE_DEFER), ou o log é"
    echo "     de um boot que morreu antes do DRM subir."
  fi

  # ── a pergunta da detecção, respondida com o dado ──────────
  echo
  echo "=== detecção de painel: não existe, e não é defeito"
  if grep -qiE "edid|detect.*panel|panel.*detect" "$origem" 2>/dev/null; then
    echo "  (apareceu algo de 'detect' no log — confira acima se é EDID de HDMI)"
  else
    echo "  Nenhuma linha de detecção, porque MIPI-DSI não se anuncia."
    echo "  O kernel casa o \`compatible\` do device tree com a tabela do driver"
    echo "  e usa o modo escrito em C. Painel diferente = DTS diferente."
  fi
}

if [ -n "$ARQUIVO_LOG" ]; then
  [ -r "$ARQUIVO_LOG" ] || { echo "ERRO: não consigo ler $ARQUIVO_LOG" >&2; exit 1; }
  analisar "$ARQUIVO_LOG"
  exit 0
fi

# O diagnóstico ao vivo: junta dmesg + sysfs numa passada e devolve o texto.
if [ "$LOCAL" = "1" ]; then
  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  dmesg >"$TMP" 2>/dev/null || echo "(dmesg vazio: rode como root)" >"$TMP"
  analisar "$TMP"

  echo
  echo "=== estado ao vivo"
  for c in /sys/class/drm/card*-DSI-*/status; do
    [ -f "$c" ] && echo "  ${c#/sys/class/drm/}: $(cat "$c" 2>/dev/null)"
  done
  for b in /sys/class/backlight/*/brightness; do
    [ -f "$b" ] && echo "  ${b#/sys/class/backlight/}: $(cat "$b" 2>/dev/null)"
  done
  if [ -r /sys/kernel/debug/regulator/vcc_lcd/state ]; then
    echo "  regulador vcc_lcd: $(cat /sys/kernel/debug/regulator/vcc_lcd/state)"
  fi
  exit 0
fi

echo "=== lendo em root@$ALVO"
#
# A coleta e a análise são separadas de propósito, mas a análise NÃO pode ser
# esquecida: a primeira versão deste script imprimia o dmesg cru e parava ali,
# então `panel-diag.sh 10.55.0.2` (o caminho mais usado) não dava veredito
# nenhum — três dos quatro modos analisavam e um não, e o que não analisava era
# justamente o do aparelho ao vivo. É o §12.49 na forma de caminho alternativo:
# o mesmo trabalho repetido em N pontos, e um deles esquece um passo.
SAIDA="$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "root@$ALVO" \
  'GIOCHI_DIAG=1 sh -s' <<'REMOTO'
TMP=/tmp/.panel-diag.$$
dmesg >"$TMP" 2>/dev/null || echo "(dmesg vazio)" >"$TMP"
echo "=== aparelho"
grep -E "^(device|commit)=" /etc/giochi/build-info.txt 2>/dev/null || echo "(sem build-info)"
uname -r
echo
# A análise é feita no host; aqui só coletamos.
echo "=== dmesg"
cat "$TMP"
echo "=== fim-dmesg"
rm -f "$TMP"
echo "=== estado"
for c in /sys/class/drm/card*-DSI-*/status; do
  [ -f "$c" ] && echo "drm ${c#/sys/class/drm/}: $(cat "$c" 2>/dev/null)"
done
for b in /sys/class/backlight/*/brightness; do
  [ -f "$b" ] && echo "backlight ${b#/sys/class/backlight/}: $(cat "$b" 2>/dev/null)"
done
[ -r /sys/kernel/debug/regulator/vcc_lcd/state ] && \
  echo "regulador vcc_lcd: $(cat /sys/kernel/debug/regulator/vcc_lcd/state)"
exit 0
REMOTO
)" || { echo "ERRO: não consegui falar com root@$ALVO" >&2; exit 1; }

# O dmesg do aparelho vem entre os marcadores; o resto é estado vivo. A mesma
# `analisar()` roda sobre ele, então o veredito de um aparelho ao vivo não pode
# divergir do veredito de um log gravado.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
printf '%s\n' "$SAIDA" | sed -n '/^=== dmesg$/,/^=== fim-dmesg$/p' >"$TMP"
if [ ! -s "$TMP" ]; then
  echo "ERRO: o aparelho não devolveu dmesg (rode como root?)" >&2
  exit 1
fi
analisar "$TMP"

echo
echo "=== estado ao vivo"
printf '%s\n' "$SAIDA" | sed -n '/^=== estado$/,$p' | tail -n +2 | sed 's/^/  /'
