#!/usr/bin/env bash
# ============================================================
# Gravação tradicional de cartão SD — dd e mais nada
# ============================================================
# Uso:
#   sudo bash scripts/flash-dd.sh <imagem> /dev/sdX
#   sudo bash scripts/flash-dd.sh <imagem> /dev/sdX --yes
#   pkexec bash scripts/flash-dd.sh <imagem> /dev/sdX --yes   # senha em diálogo
#
# ## Por que existe, se já existe o flash-sd.sh
#
# O `flash-sd.sh` faz mais: recusa por tamanho (`--expect-gib`), relê o cartão e
# compara SHA256, e pode crescer a partição (`--grow`). São defesas boas e cada
# uma nasceu de um defeito medido — mas quando uma delas falha, o diagnóstico
# fica mais difícil que o problema: o `dd` grava, a releitura diverge, e o
# operador fica sem saber se o cartão está ruim ou se a conferência está errada.
#
# Este script é o mínimo que grava um cartão: `dd` com `conv=fsync` e `sync`.
# Sem verificação, sem crescimento, sem leitura de volta. Se o cartão não bootar
# com isto, o problema NÃO é a gravação — e isso por si só responde metade das
# perguntas.
#
# ## As guardas que ficaram
#
# Gravar no disco errado apaga o computador de quem está trabalhando, e não tem
# desfazer. Então três checagens continuam, e nenhuma delas é sobre o conteúdo:
#
#   1. o destino é um dispositivo de bloco;
#   2. é removível;
#   3. não é o disco onde está o `/` nem o `/boot`.
#
# Uma confirmação por digitação do caminho também fica, salvo com `--yes`.
# ============================================================

set -euo pipefail

usage() {
  # Imprime do PRIMEIRO separador até o terceiro: o título fica entre o 1º e o
  # 2º, e cortar em `vistos >= 2` o deixaria de fora (medido — o `--help` saía
  # sem dizer o que o script faz).
  awk '/^# ={10,}$/ { vistos++; if (vistos >= 3) exit; next }
       vistos >= 1 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

IMAGEM=""
DESTINO=""
ASSUME_YES=0

while (($#)); do
  case "$1" in
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "ERRO: opção desconhecida: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$IMAGEM" ]]; then IMAGEM="$1"
      elif [[ -z "$DESTINO" ]]; then DESTINO="$1"
      else echo "ERRO: argumento extra: $1" >&2; exit 2
      fi
      ;;
  esac
  shift
done

if [[ -z "$IMAGEM" || -z "$DESTINO" ]]; then
  usage >&2
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERRO: precisa de root para escrever em dispositivo de bloco." >&2
  echo "Use: sudo bash $0 $IMAGEM $DESTINO" >&2
  echo "  ou: pkexec bash $0 $IMAGEM $DESTINO --yes" >&2
  exit 2
fi

[[ -f "$IMAGEM" ]] || { echo "ERRO: imagem não existe: $IMAGEM" >&2; exit 2; }
[[ -b "$DESTINO" ]] || { echo "ERRO: $DESTINO não é dispositivo de bloco." >&2; exit 2; }

# `readlink -f` porque /dev/disk/by-id/... e /dev/disk/by-label/... são symlinks
# e o basename do symlink não existe em /sys/block.
DISCO="$(basename "$(readlink -f "$DESTINO")")"
SYSFS="/sys/block/$DISCO"
[[ -d "$SYSFS" ]] || { echo "ERRO: $DESTINO não é um disco inteiro (é partição?)." >&2; exit 2; }

if [[ "$(cat "$SYSFS/removable" 2>/dev/null)" != "1" ]]; then
  echo "ERRO: $DESTINO NÃO é removível. Recusando gravar num disco interno." >&2
  echo "Discos removíveis:" >&2
  for d in /sys/block/*/removable; do
    [[ "$(cat "$d")" == "1" ]] || continue
    b="$(basename "$(dirname "$d")")"
    printf '  /dev/%-8s %s GiB\n' "$b" "$(( $(cat "/sys/block/$b/size") / 2 / 1024 / 1024 ))" >&2
  done
  exit 2
fi

# O disco do sistema pode estar em um NVMe, mas também pode ser USB. Comparar o
# dispositivo de `/` e `/boot` com o destino é a única checagem que cobre os dois.
RAIZ="$(findmnt -no SOURCE / 2>/dev/null || true)"
BOOT="$(findmnt -no SOURCE /boot 2>/dev/null || true)"
for fonte in "$RAIZ" "$BOOT"; do
  [[ -n "$fonte" ]] || continue
  pai="$(basename "$(readlink -f "$(lsblk -nlo PKNAME "$fonte" 2>/dev/null | head -1)" 2>/dev/null || true)")"
  if [[ -n "$pai" && "$pai" == "$DISCO" ]]; then
    echo "ERRO: $DESTINO é o disco de $fonte. Recusando." >&2
    exit 2
  fi
done

# Cartão montado: o `dd` escreve mesmo assim, mas o kernel mantém cache do
# sistema de arquivos antigo e a próxima leitura devolve lixo. Desmontar é
# obrigatório, e aqui não se desmonta por conta própria — só se avisa.
MONTADO="$(lsblk -nlo MOUNTPOINT "$DESTINO" 2>/dev/null | grep -v '^$' || true)"
if [[ -n "$MONTADO" ]]; then
  echo "ERRO: $DESTINO tem partição montada:" >&2
  printf '  %s\n' $MONTADO >&2
  echo "Desmonte antes: udisksctl unmount -b ${DESTINO}1" >&2
  exit 2
fi

IMAGEM_BYTES="$(stat -c %s "$IMAGEM")"
DESTINO_BYTES="$(blockdev --getsize64 "$DESTINO")"
if (( DESTINO_BYTES < IMAGEM_BYTES )); then
  echo "ERRO: cartão ($((DESTINO_BYTES/1024/1024)) MiB) menor que a imagem ($((IMAGEM_BYTES/1024/1024)) MiB)." >&2
  exit 2
fi

echo "Gravação tradicional (dd)"
echo "  imagem:  $IMAGEM"
echo "  tamanho: $((IMAGEM_BYTES / 1024 / 1024)) MiB"
echo "  destino: $DESTINO ($(cat "$SYSFS/device/model" 2>/dev/null || echo '?'), $((DESTINO_BYTES / 1000000000)) GB)"
echo
echo "TODO O CONTEÚDO DO CARTÃO SERÁ APAGADO."
echo

if ((!ASSUME_YES)); then
  read -r -p "Digite o caminho do destino para confirmar ($DESTINO): " confirma
  [[ "$confirma" == "$DESTINO" ]] || { echo "Cancelado." >&2; exit 1; }
fi

echo "Gravando..."
# `conv=fsync` faz o dd sincronizar no fim. O `sync` depois é redundante e
# barato — e num cartão SD é onde o buffer do controlador termina de escoar.
dd if="$IMAGEM" of="$DESTINO" bs=4M conv=fsync status=progress
sync

# O kernel precisa reler a tabela de partições; sem isto o cartão aparece sem
# partições até o próximo replug.
partprobe "$DESTINO" 2>/dev/null || true
udevadm settle 2>/dev/null || true

echo
echo "Pronto. Sem verificação de SHA256 e sem crescer partição (é o método"
echo "tradicional). Partições que o kernel vê agora:"
lsblk -o NAME,SIZE,FSTYPE,LABEL,PARTUUID "$DESTINO" 2>/dev/null | sed 's/^/  /' \
  || echo "  (lsblk indisponível)"
echo
echo "Próximo passo: ejetar, colocar no aparelho, ligar com a serial em 1500000."
