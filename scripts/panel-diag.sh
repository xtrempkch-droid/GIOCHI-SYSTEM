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
#   bash scripts/panel-diag.sh --iface usb0     # dois aparelhos plugados (§12.64)
#
# Responde "o painel foi inicializado neste boot?" com o que o kernel registrou,
# em vez de deduzir do que a tela mostra.
#
# ## Por que existe
#
# Relato de 17/11/2026 no **X35H** (RK3566, painel st7703): em alguns boots
# frios a tela não acende, e apertar o botão de reiniciar faz a tela funcionar.
# A pergunta era se isso poderia ser "detecção de painel" — não pode, e o
# `--log` mostra por quê:
#
# ATENÇÃO: R35S e X35H são aparelhos DIFERENTES (RK3326 × RK3566, drivers de
# painel diferentes, trilho do LCD de tipos diferentes). Este script foi
# validado no R35S porque era o único ligado, e isso prova a FERRAMENTA — não
# mede o X35H. O bug do X35H continua sem log lido. Ver AGENTS §31.3-A.
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
IFACE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --local) LOCAL=1; shift ;;
    --iface) IFACE="${2:-}"; [ -n "$IFACE" ] || { echo "ERRO: --iface sem interface" >&2; exit 2; }; shift 2 ;;
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
  #
  # O NOME DO DRIVER NÃO SERVE DE PERGUNTA. Cada aparelho tem o seu:
  #
  #   hx8394            X55  (himax, mainline)
  #   st7703            X35H (sitronix, mainline + nosso patch)
  #   panel-generic-dsi R35S (rocknix, fora da árvore)
  #
  # Medido em 17/11/2026 no R35S: a primeira versão procurava "st7703",
  # não achava nada, e o veredito era "o painel NÃO foi inicializado neste
  # boot" — num aparelho com `card0-DSI-1: connected` e backlight em 63/255.
  # Falso negativo na direção mais cara: manda caçar um probe que não existe
  # num aparelho que está com a tela acesa. É o §12.30/§12.34 de novo.
  #
  # E não dá para listar nomes e ficar por isso: o que cada driver IMPRIME
  # também varia, medido nos fontes do 6.12:
  #
  #   hx8394   dev_dbg("%ux%u@%u %ubpp dsi %udl - ready")  -> NÃO aparece
  #   st7703   dev_info(...)  (linha 895)                   -> aparece
  #   generic  dev_info("lanes %d, format %d, mode %x")     -> aparece, outro texto
  #
  # O X55 acende a tela e não imprime linha nenhuma sobre o painel. Então a
  # pergunta que funciona nos três é a CONSEQUÊNCIA, e ela vem no veredito.
  echo
  echo "--- PAINEL (driver detectado no log)"
  PAINEL_LINHAS=$(grep -iE "st7703|hx8394|generic-dsi|panel-(sitronix|himax|generic)|ilitek|jadard|nt35510|drm_panel" "$origem" 2>/dev/null || true)
  DRIVER_PAINEL=""
  for d in st7703 hx8394 panel-generic-dsi ilitek ili9881c jadard nt35510; do
    if printf '%s' "$PAINEL_LINHAS" | grep -qi -- "$d"; then DRIVER_PAINEL="$d"; break; fi
  done
  if [ -n "$PAINEL_LINHAS" ]; then
    printf '%s\n' "$PAINEL_LINHAS" | tail -8
    echo "  driver: ${DRIVER_PAINEL:-(não identificado, mas há linha de painel)}"
  else
    echo "  (nenhuma linha de driver de painel)"
    echo "  ATENÇÃO: o hx8394 (X55) usa dev_dbg e NÃO imprime nada com o painel bom."
    echo "  Ausência de linha aqui NÃO significa painel quebrado — veja o veredito."
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

  # ── a consequência: o DRM chegou a ter framebuffer? ────────
  #
  # É a única pergunta comum aos três drivers. `fb0: ...frame buffer device`
  # só é impresso depois que o `drm_panel_enable()` rodou e o modo foi aceito,
  # e `DSI-*/status: connected` só fica assim se o painel respondeu.
  #
  # Medido no R35S em 17/11/2026 (o caso que denunciou o furo):
  #   [drm] fb0: rockchipdrmfb frame buffer device
  #   drm card0-DSI-1/status: connected
  #   backlight backlight/brightness: 63
  # — com o script dizendo "o painel NÃO foi inicializado".
  local fb0=0 conectado=0 estado_conhecido=0
  grep -qE "fb0: .*frame buffer device|drm.*fb0" "$origem" 2>/dev/null && fb0=1
  if grep -qE "DSI-[0-9]+/status:" "$origem" 2>/dev/null; then
    estado_conhecido=1
    grep -qE "DSI-[0-9]+/status: *connected" "$origem" && conectado=1
  fi

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
  elif [ "$fb0" -eq 1 ] || [ "$conectado" -eq 1 ]; then
    echo "  O painel inicializou NESTE boot."
    [ -n "$DRIVER_PAINEL" ] && echo "  driver: $DRIVER_PAINEL"
    [ "$fb0" -eq 1 ] && echo "  prova: o DRM registrou framebuffer (fb0) — o enable do painel concluiu"
    [ "$conectado" -eq 1 ] && echo "  prova: o conector DSI está 'connected'"
    echo "  -> se a tela ficou apagada MESMO ASSIM, o defeito é DEPOIS da inicialização:"
    echo "     backlight, VOP ou o modo DRM. Compare com um boot bom:"
    echo "       diff <(bash scripts/panel-diag.sh --log ruim.log) \\"
    echo "            <(bash scripts/panel-diag.sh --log bom.log)"
  elif [ "$estado_conhecido" -eq 0 ] && [ -z "$PAINEL_LINHAS" ]; then
    echo "  Nada sobre o painel e nada do estado do conector neste log."
    echo "  -> o log está truncado, é de um boot que morreu antes do DRM, ou foi"
    echo "     coletado sem a seção de estado. Sem um dos dois, não há o que afirmar."
  else
    echo "  O DRM subiu e o painel NÃO concluiu a inicialização."
    echo "  -> ou o probe não chegou (dependência, -EPROBE_DEFER), ou o enable"
    echo "     falhou antes de registrar erro. O conector DSI não está 'connected'."
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

  # O estado do conector vai NO MESMO arquivo que a análise lê. O veredito
  # pergunta pela consequência (`DSI-*/status: connected`), e ela mora no
  # sysfs, não no dmesg — separar os dois faria o `--local` dar veredito
  # diferente do caminho por SSH, que é como um diagnóstico passa a mentir
  # devagar (§12.30).
  echo "=== estado" >>"$TMP"
  for c in /sys/class/drm/card*-DSI-*/status; do
    [ -f "$c" ] && echo "  ${c#/sys/class/drm/}: $(cat "$c" 2>/dev/null)" >>"$TMP"
  done
  for b in /sys/class/backlight/*/brightness; do
    [ -f "$b" ] && echo "  ${b#/sys/class/backlight/}: $(cat "$b" 2>/dev/null)" >>"$TMP"
  done
  [ -r /sys/kernel/debug/regulator/vcc_lcd/state ] && \
    echo "  regulador vcc_lcd: $(cat /sys/kernel/debug/regulator/vcc_lcd/state)" >>"$TMP"

  analisar "$TMP"
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
#
# `--iface` existe por causa do §12.64: todo aparelho atende em 10.55.0.2 com o
# mesmo MAC do gadget, então com dois plugados o diagnóstico leria o dmesg do
# OUTRO aparelho e daria um veredito confiante sobre ele — o pior tipo de erro
# para uma ferramenta de diagnóstico. Quem distingue é a interface USB, e o
# vínculo é por `SO_BINDTODEVICE` (scripts/ssh-por-iface.py).
#
# `UserKnownHostsFile=/dev/null` sempre: o endereço é compartilhado entre
# aparelhos, então cada troca de placa acusa "HOST IDENTIFICATION HAS CHANGED" —
# verdadeiro e inútil aqui, porque o link é um cabo USB direto.
# As opções vão ESCRITAS AQUI DENTRO, e nunca numa variável. `$SSH_OPTS` sem
# aspas se parte em palavras, e `-o ProxyCommand=python3 ... --iface usb0 %h %p`
# chega ao ssh como seis argumentos — o `--iface` vira opção do ssh e ele morre
# com "unknown option -- -". Repeti exatamente o defeito que o `gpu-bench.sh`
# documenta ter corrigido, e o teste não pegou porque só olhava o texto do
# script; agora há um teste que executa com um `ssh` falso.
SAIDA="$(
if [ -n "$IFACE" ]; then
  echo "=== interface: $IFACE (dois aparelhos no mesmo PC respondem ao mesmo IP)" >&2
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
      -o ConnectTimeout=10 \
      -o "ProxyCommand=python3 $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ssh-por-iface.py --iface $IFACE %h %p" \
      "root@$ALVO" 'GIOCHI_DIAG=1 sh -s' <<'REMOTO'
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
else
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
      -o ConnectTimeout=10 \
      "root@$ALVO" 'GIOCHI_DIAG=1 sh -s' <<'REMOTO'
TMP=/tmp/.panel-diag.$$
dmesg >"$TMP" 2>/dev/null || echo "(dmesg vazio)" >"$TMP"
echo "=== aparelho"
grep -E "^(device|commit)=" /etc/giochi/build-info.txt 2>/dev/null || echo "(sem build-info)"
uname -r
echo
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
fi
)" || { echo "ERRO: não consegui falar com root@$ALVO" >&2; exit 1; }

# O dmesg do aparelho vem entre os marcadores; o resto é estado vivo. A mesma
# `analisar()` roda sobre ele, então o veredito de um aparelho ao vivo não pode
# divergir do veredito de um log gravado.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
# dmesg e estado juntos: o veredito pergunta pela consequência, e a metade
# que responde (`DSI-*/status: connected`) está na seção de estado.
{
  printf '%s\n' "$SAIDA" | sed -n '/^=== dmesg$/,/^=== fim-dmesg$/p'
  printf '%s\n' "$SAIDA" | sed -n '/^=== estado$/,$p'
} >"$TMP"
if [ ! -s "$TMP" ]; then
  echo "ERRO: o aparelho não devolveu dmesg (rode como root?)" >&2
  exit 1
fi
analisar "$TMP"

echo
echo "=== estado ao vivo"
printf '%s\n' "$SAIDA" | sed -n '/^=== estado$/,$p' | tail -n +2 | sed 's/^/  /'
