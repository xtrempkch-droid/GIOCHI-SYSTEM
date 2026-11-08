#!/usr/bin/env bash
# ============================================================
# Giochi System — gravar a imagem de cartão num cartão SD
# ============================================================
# Uso:
#   sudo bash scripts/flash-sd.sh out/<device>/giochi-system-<device>-sd.img /dev/sdX
#   sudo bash scripts/flash-sd.sh <imagem> /dev/sdX --yes     # sem confirmação
#   sudo bash scripts/flash-sd.sh <imagem> /dev/sdX --expect-gib 116  # cartão certo
#   sudo bash scripts/flash-sd.sh <imagem> /dev/sdX --grow    # usa o cartão todo
#   sudo bash scripts/flash-sd.sh <imagem> --list             # só lista candidatos
#
# Existe para impedir o acidente clássico: `dd` no disco errado. Antes de
# escrever, confere que o destino é um disco REMOVÍVEL, que não está montado e
# que não é o disco do sistema. Depois de escrever, relê o cartão e compara o
# SHA256 com o da imagem — um cartão falso/defeituoso falha aqui, não no boot.
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE=""
TARGET=""
ASSUME_YES=0
LIST_ONLY=0
EXPECT_GIB=""
GROW=0

usage() {
  # `sed` com dois delimitadores IGUAIS não funciona: ele fecha o intervalo no
  # primeiro casamento e reabre no segundo, imprimindo o script inteiro. Medido
  # aqui. O `awk` para na segunda linha de `# ====` e imprime só o meio.
  awk '/^# ={10,}$/ { vistos++; if (vistos >= 3) exit; next } \
       vistos >= 2 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

while (($#)); do
  argument="$1"
  case "$argument" in
    --yes|-y) ASSUME_YES=1 ;;
    --list) LIST_ONLY=1 ;;
    --grow) GROW=1 ;;
    --expect-gib)
      shift
      EXPECT_GIB="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "ERRO: opção desconhecida: $argument" >&2
      exit 2
      ;;
    *)
      if [[ -z "$IMAGE" ]]; then
        IMAGE="$argument"
      elif [[ -z "$TARGET" ]]; then
        TARGET="$argument"
      else
        echo "ERRO: argumento extra: $argument" >&2
        exit 2
      fi
      ;;
  esac
  shift
done

# Lista candidatos: discos removíveis, com tamanho e se estão montados.
list_candidates() {
  local name size removable model
  for path in /sys/block/*; do
    name="$(basename "$path")"
    case "$name" in
      loop*|zram*|sr*|ram*) continue ;;
    esac
    removable="$(cat "$path/removable" 2>/dev/null || echo 0)"
    [[ "$removable" == "1" ]] || continue
    size="$(cat "$path/size" 2>/dev/null || echo 0)"
    model="$(cat "$path/device/model" 2>/dev/null || echo '?')"
    printf '  /dev/%-8s %8.1f GiB  removível  %s\n' \
      "$name" "$(awk -v s="$size" 'BEGIN { printf "%.1f", s * 512 / 1073741824 }')" "$model"
  done
}

if ((LIST_ONLY)); then
  echo "Discos removíveis detectados:"
  list_candidates
  echo
  echo "Use: sudo bash scripts/flash-sd.sh <imagem> /dev/sdX"
  exit 0
fi

if [[ -z "$IMAGE" || -z "$TARGET" ]]; then
  usage >&2
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERRO: gravar em bloco precisa de root." >&2
  exit 2
fi

if [[ ! -f "$IMAGE" ]]; then
  echo "ERRO: imagem não encontrada: $IMAGE" >&2
  exit 2
fi

if [[ ! -b "$TARGET" ]]; then
  echo "ERRO: $TARGET não é um dispositivo de bloco." >&2
  echo "Candidatos:" >&2
  list_candidates >&2
  exit 2
fi

NAME="$(basename "$(readlink -f "$TARGET")")"
SYSFS="/sys/block/$NAME"
if [[ ! -d "$SYSFS" ]]; then
  echo "ERRO: $TARGET não é um disco inteiro (partição?)." >&2
  echo "Informe o disco, ex.: /dev/sdd — não /dev/sdd1." >&2
  exit 2
fi

# Só cartão removível. Um SSD/HD externo também é removível, então a
# mensagem pede leitura explícita do modelo antes de confirmar.
# Em container, /sys/block existe e é o do host; o teste continua válido.
if [[ "$(cat "$SYSFS/removable" 2>/dev/null || echo 0)" != "1" ]]; then
  echo "ERRO: $TARGET NÃO é um disco removível." >&2
  echo "Recusando gravar num disco fixo — é assim que se apaga o sistema." >&2
  exit 2
fi

if [[ "$(cat "$SYSFS/size")" == "0" ]]; then
  echo "ERRO: $TARGET reporta 0 setores (nenhum cartão inserido?)." >&2
  exit 2
fi

# O disco do sistema pode ser removível — é o caso de quem roda o host num SSD
# USB ou num cartão. "Removível" sozinho não protege nada, e esta checagem
# existia no `flash-dd.sh` e NÃO aqui: o script com mais recursos (SHA256,
# --grow) era o menos protegido no caso que apaga o computador de quem está
# trabalhando. Compara o disco de `/` e de `/boot`, pelo nome do disco pai —
# `lsblk -nlo PKNAME` devolve `sdb` para `/dev/sdb2`.
RAIZ="$(findmnt -no SOURCE / 2>/dev/null || true)"
BOOT="$(findmnt -no SOURCE /boot 2>/dev/null || true)"
for fonte in "$RAIZ" "$BOOT"; do
  [[ -n "$fonte" ]] || continue
  pai="$(basename "$(readlink -f "$(lsblk -nlo PKNAME "$fonte" 2>/dev/null | head -1)" 2>/dev/null || true)")"
  if [[ -n "$pai" && "$pai" == "$NAME" ]]; then
    echo "ERRO: $TARGET é o disco de $fonte. Recusando gravar no sistema em uso." >&2
    exit 2
  fi
done

MOUNTED="$(lsblk -nlo MOUNTPOINT "$TARGET" 2>/dev/null | grep -v '^$' || true)"
if [[ -n "$MOUNTED" ]]; then
  echo "ERRO: $TARGET tem partições montadas:" >&2
  echo "$MOUNTED" | sed 's/^/  /' >&2
  echo "Desmonte antes (umount) e rode de novo." >&2
  exit 2
fi

TARGET_BYTES="$(blockdev --getsize64 "$TARGET")"

# Tamanho é a ÚNICA forma de distinguir dois cartões SD removíveis. Já custou
# uma gravação inteira: o aparelho tinha um SE32G de 29,7 GiB e o cartão no
# leitor era de 116 GiB — outro cartão, sem nenhum aviso.
if [[ -n "$EXPECT_GIB" ]]; then
  if ! [[ "$EXPECT_GIB" =~ ^[0-9]+$ ]]; then
    echo "ERRO: --expect-gib espera um inteiro (ex.: 29), recebeu: $EXPECT_GIB" >&2
    exit 2
  fi
  # GiB (binário), que é como o U-Boot reporta ("Capacity: 29.7 GiB") e como o
  # lsblk mostra. Compara com 1 GiB de tolerância: fabricante e kernel
  # arredondam diferente, e o objetivo é distinguir 30 de 116, não acertar
  # centésimos.
  TARGET_GIB=$(( (TARGET_BYTES + 536870912) / 1073741824 ))
  DELTA=$(( TARGET_GIB - EXPECT_GIB ))
  (( DELTA < 0 )) && DELTA=$(( -DELTA ))
  if (( DELTA > 1 )); then
    echo "ERRO: o cartão tem ${TARGET_GIB} GiB, mas o esperado era ${EXPECT_GIB} GiB." >&2
    echo "Provavelmente NÃO é o cartão do aparelho. Confira com 'lsblk'." >&2
    echo "O tamanho que o aparelho reporta aparece em 'mmc info' no U-Boot." >&2
    exit 2
  fi
  echo "  tamanho: ${TARGET_GIB} GiB (confere com --expect-gib ${EXPECT_GIB})"
fi
IMAGE_BYTES="$(stat -c %s "$IMAGE")"
if (( TARGET_BYTES < IMAGE_BYTES )); then
  echo "ERRO: o cartão ($((TARGET_BYTES / 1024 / 1024)) MiB) é menor que a imagem ($((IMAGE_BYTES / 1024 / 1024)) MiB)." >&2
  exit 2
fi

echo "Gravação de cartão SD"
echo "  imagem:  $IMAGE"
echo "  tamanho: $((IMAGE_BYTES / 1024 / 1024)) MiB"
echo "  destino: $TARGET ($(basename "$(cat "$SYSFS/device/model" 2>/dev/null || echo '?')"), $((TARGET_BYTES / 1000000000)) GB)"
echo
echo "TODO O CONTEÚDO DO CARTÃO SERÁ APAGADO."
echo

if ((!ASSUME_YES)); then
  read -r -p "Digite o caminho do destino para confirmar ($TARGET): " confirmation
  if [[ "$confirmation" != "$TARGET" ]]; then
    echo "Cancelado." >&2
    exit 1
  fi
fi

echo "Gravando..."
dd if="$IMAGE" of="$TARGET" bs=4M conv=fsync status=progress
sync

EXPECTED_SHA="$(sha256sum "$IMAGE" | awk '{print $1}')"

# Confere lendo o cartão. Duas passadas, porque a primeira pode falhar por um
# motivo que NÃO é cartão defeituoso.
#
# Medido em 06/11/2026: a gravação de 2 GiB passou, e a releitura devolveu um
# SHA diferente. Investigando por MB, só o MB 64 divergia — e reescrever aquele
# MB com o mesmo conteúdo da imagem fez ele passar a conferir. Ou seja: o FTL do
# cartão servia um bloco obsoleto até receber uma escrita nova. Não era cartão
# ruim, não era gravação interrompida.
#
# Dizer "cartão defeituoso" nesse caso é falso negativo, e o custo é alto: manda
# trocar hardware que está bom. Então: segunda passada e só então falha.
verify_card() {
  dd if="$TARGET" bs=4M count=$(( (IMAGE_BYTES + 4194304 - 1) / 4194304 )) status=none \
    | head -c "$IMAGE_BYTES" | sha256sum | awk '{print $1}'
}

ACTUAL_SHA="$(verify_card)"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "  divergiu na primeira passada; regravando antes de acusar o cartão..."
  dd if="$IMAGE" of="$TARGET" bs=4M conv=fsync status=none
  sync
  ACTUAL_SHA="$(verify_card)"
fi

if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERRO: o que está no cartão não confere, mesmo depois de regravar." >&2
  echo "  esperado: $EXPECTED_SHA" >&2
  echo "  lido:     $ACTUAL_SHA" >&2
  echo "Aí sim: cartão defeituoso, falso, ou a gravação não está concluindo." >&2
  exit 1
fi
echo "  SHA256 confere: $ACTUAL_SHA"

# O kernel do host precisa reler a tabela de partições; sem isso o cartão
# aparece sem partições e a próxima etapa falha por um motivo que já foi
# resolvido no cartão.
partprobe "$TARGET" 2>/dev/null || true
udevadm settle 2>/dev/null || true

# ── crescer a última partição até o fim do cartão ────────────────────
#
# POR QUE ISTO EXISTE. A `.img` tem tamanho fixo (2 GiB), e o `docs/flashing.md`
# registra a consequência: "o resto do cartão" não cabe num arquivo de tamanho
# fixo. Num cartão de 128 GB isso deixava 114 GB sem tabela de partição — espaço
# que nenhum `mkfs` nem app enxerga, porque não pertence a partição nenhuma.
#
# A alternativa seria `make-sd-image.sh --size-mib 118000`, e ela é pior por um
# motivo medido: `dd` escreve TODOS os bytes, inclusive os zeros. 115 GiB a
# ~30 MB/s são mais de uma hora de gravação, contra ~2 min da imagem de 2 GiB
# mais alguns segundos de `resize2fs`. O trabalho de gravar zeros não produz
# nada.
#
# ORDEM IMPORTA: isto roda DEPOIS da verificação de SHA256. Crescer muda a
# tabela de partições e o superbloco, então o cartão deixa de ser byte a byte
# igual à imagem — e é correto que deixe. Verificar depois seria comparar com o
# que não existe mais.
#
# Só a ÚLTIMA partição (a que termina mais longe no disco), e só se for ext4:
# crescer uma partição do meio exigiria mover as seguintes, que é a operação que
# apaga dados.

# Duas armadilhas medidas em 06/11/2026, as duas com o `sfdisk` deste host:
#
#   1. `sfdisk -J` devolve em `node` o NOME COMPLETO (`/dev/sdb2`), não o
#      número. Passar isso para `-N` falha com "cannot open /dev/sdb2" e a
#      mensagem não diz que o problema é o tipo do argumento. O número tem de
#      sair do ÍNDICE na lista, com o `start` escolhendo a última.
#   2. `blockdev --getstart` NÃO EXISTE (`blockdev: Comando desconhecido`);
#      o início em setores vem do próprio `sfdisk -J`.
numero_da_ultima_particao() {
  local disco="$1"
  sfdisk -J "$disco" 2>/dev/null | python3 -c '
import json, sys
partes = json.load(sys.stdin)["partitiontable"]["partitions"]
if not partes:
    sys.exit(1)
# maior `start` = a que termina mais longe; o índice dá o número (1-based)
i = max(range(len(partes)), key=lambda k: partes[k]["start"])
print(i + 1)
' 2>/dev/null
}

# /dev/sdb + 2 -> /dev/sdb2 ; /dev/mmcblk0 + 2 -> /dev/mmcblk0p2
caminho_da_particao() {
  local disco="$1" numero="$2"
  case "$disco" in
    *[0-9]) printf '%sp%s\n' "$disco" "$numero" ;;
    *)      printf '%s%s\n' "$disco" "$numero" ;;
  esac
}

cresce_ultima_particao() {
  local disco="$1"

  if ! command -v sfdisk >/dev/null 2>&1; then
    echo "  AVISO: sem 'sfdisk' — o resto do cartão fica sem partição" >&2
    echo "         use 'make-sd-image.sh --size-mib <N>' e grave a imagem maior" >&2
    return 0
  fi

  local numero part
  numero="$(numero_da_ultima_particao "$disco" || true)"
  if [[ -z "$numero" ]]; then
    echo "  AVISO: não consegui ler a tabela de partições; não vou crescer" >&2
    return 0
  fi
  part="$(caminho_da_particao "$disco" "$numero")"

  # O sistema de arquivos tem de ser ext4, e tem de passar no fsck ANTES de
  # crescer: `resize2fs` num fs inconsistente espalha a inconsistência em vez
  # de corrigi-la.
  local tipo
  tipo="$(blkid -o value -s TYPE "$part" 2>/dev/null || true)"
  if [[ "$tipo" != "ext4" ]]; then
    echo "  AVISO: $part é '${tipo:-sem fs}', não ext4 — não vou crescer" >&2
    return 0
  fi

  local antes_gib
  antes_gib="$(blockdev --getsize64 "$part" 2>/dev/null | awk '{printf "%.1f", $1/1024/1024/1024}')"
  echo "  crescendo $part (${antes_gib} GiB → o resto do cartão)..."

  # `,+` = do início atual até o fim do disco, com o alinhamento do próprio
  # sfdisk. `--no-reread` porque a releitura é feita logo abaixo, com o
  # `partprobe`, e o sfdisk sozinho falha quando o kernel não pode reler.
  if ! echo ',+' | sfdisk --no-reread --force -N "$numero" "$disco" >/dev/null 2>&1; then
    echo "  AVISO: sfdisk não cresceu $part; ficou com ${antes_gib} GiB" >&2
    echo "         o sistema BOOTA assim — só não tem o espaço extra" >&2
    return 0
  fi
  partprobe "$disco" 2>/dev/null || true
  udevadm settle 2>/dev/null || true

  # `-f` é obrigatório: o ext4 de um cartão recém-gravado está marcado como
  # não-limpo, e o `resize2fs` se recusa a tocar nele sem isso.
  e2fsck -f -p "$part" >/dev/null 2>&1 || true
  if ! resize2fs "$part" >/dev/null 2>&1; then
    echo "  AVISO: resize2fs falhou; a partição ficou com ${antes_gib} GiB" >&2
    echo "         o sistema BOOTA assim — só não tem o espaço extra" >&2
    return 0
  fi

  local depois_gib
  depois_gib="$(blockdev --getsize64 "$part" 2>/dev/null | awk '{printf "%.1f", $1/1024/1024/1024}')"
  echo "  $part agora tem ${depois_gib} GiB"
  return 0
}

if ((GROW)); then
  echo
  cresce_ultima_particao "$TARGET"
  echo "  (o cartão não é mais idêntico à imagem — o SHA acima foi"
  echo "   verificado ANTES de crescer, sobre os bytes da imagem)"
fi

partprobe "$TARGET" 2>/dev/null || true
udevadm settle 2>/dev/null || true

echo
echo "Cartão gravado. Partições:"
# `lsblk` pode falhar em container com /dev bind-montado (erro de libc, não do
# cartão). É informação cosmética: não deve transformar uma gravação já
# verificada por SHA256 em exit != 0.
lsblk -o NAME,SIZE,FSTYPE,LABEL "$TARGET" 2>/dev/null | sed 's/^/  /' \
  || echo "  (lsblk indisponível neste ambiente; rode 'lsblk' no host)"
echo
echo "Próximo passo: ejetar com segurança, colocar no aparelho e ligar com a"
echo "serial conectada a 1500000 baud."
