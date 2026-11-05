#!/usr/bin/env bash
# ============================================================
# Giochi System — medir a qualidade da serial antes de confiar nela
# ============================================================
# Uso:
#   bash scripts/serial-check.sh [/dev/ttyUSB0] [baud]
#
# Roda três testes, na ordem que separa uma causa da outra:
#
#   1. LOOPBACK  — o que eu escrevo volta? Prova que o adaptador e o driver
#                  estão bons. Se isto falhar, nada abaixo tem significado.
#   2. ESCUTA    — o que o aparelho manda sozinho, 8 s por baud, sem escrever
#                  nada. Evita confundir eco do meu Enter com saída do console.
#   3. ESTABILI- — fica 5 min abrindo a porta e reporta cada queda. É o medidor
#      DADE      de contato: fio solto cai, solda não.
#
# Por que existe: medido no R35S em 04/11/2026 — ruído `0xED` repetido, 0 bytes
# em loopback e 0 em escuta, com o adaptador caindo a cada 30-45 s. Cada teste
# eliminou uma hipótese (baud errado, eco, aparelho falando) até sobrar o
# caminho elétrico. Sem eles a conclusão seria "não funciona", que não ajuda.
# ============================================================

set -uo pipefail

BUILD=0
if [[ "${1:-}" == "--build" ]]; then
  BUILD=1
  shift
fi
PORT="${1:-/dev/ttyUSB0}"
BAUD="${2:-1500000}"
IMG="${GIOCHI_SERIAL_IMAGE:-giochi-serial-scan:3}"
CACHE="${GIOCHI_CONTAINER_CACHE:-$HOME/.cache/giochi-system}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: docker não encontrado." >&2
  exit 2
fi

if ((BUILD)) || ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "Construindo $IMG..."
  # O contexto vai por stdin e o Dockerfile é renomeado dentro do tar: o Docker
  # exige o nome `Dockerfile` no contexto, e o deste repositório chama
  # `serial.Dockerfile` para não conflitar com o builder.
  TMP="$(mktemp -d)"
  cp "$(dirname "${BASH_SOURCE[0]}")/../docker"/{serial-log.py,uboot-serial.py,serial-boot.py,serial-interrupt.py,ymodem-send.py,baud-scan.py,serial-listen.py,serial-watch.py,serial-loopback.py} "$TMP/"
  cp "$(dirname "${BASH_SOURCE[0]}")/../docker/serial.Dockerfile" "$TMP/Dockerfile"
  sed -i 's#serial-loopback.py##' "$TMP/Dockerfile"
  sed -i 's#serial-watch.py #serial-watch.py serial-loopback.py #' "$TMP/Dockerfile"
  (cd "$TMP" && tar -cf - .) | docker build -t "$IMG" - >/dev/null
  rm -rf "$TMP"
  echo "Imagem pronta."
  echo
fi

if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "ERRO: imagem $IMG não existe." >&2
  echo "Construa com:" >&2
  echo "  bash scripts/serial-check.sh --build" >&2
  exit 2
fi

mkdir -p "$CACHE/serial"

# `-v /dev:/dev` em vez de `--device=`: o adaptador CAI do barramento, e um
# `--device=/dev/ttyUSB0` fixado no start aborta o container quando o nó não
# existe. Com /dev montado, o container sobrevive ao ir e voltar.
# `--privileged` é necessário: montar /dev não basta, o cgroup de devices
# bloqueia a abertura ("Operation not permitted").
run() {
  docker run --rm --privileged -v /dev:/dev -v "$CACHE/serial:/work/log" \
    -e PYTHONUNBUFFERED=1 --entrypoint python3 "$IMG" -u "$@"
}

echo "Porta: $PORT | baud: $BAUD"
echo

echo "=== 1/3 loopback: o adaptador escuta a si mesmo? ==="
echo "    (ligue TX em RX no adaptador — com o aparelho conectado isto falha"
echo "     de propósito, porque o aparelho responde outra coisa)"
run /work/serial-loopback.py "$PORT" "$BAUD" 2>&1 | tail -6 || true
echo

echo "=== 2/3 escuta passiva: o que o aparelho manda sozinho ==="
echo "    (8 s sem escrever nada; ligue/reinicie o aparelho agora)"
run /work/serial-listen.py "$PORT" "$BAUD" 8 /work/log/check.log 3600 2>&1 | tail -12 || true
echo

echo "=== 3/3 estabilidade: 5 min, contando quedas ==="
echo "    (este é o medidor de contato: fio solto cai, solda não)"
run /work/serial-watch.py "$PORT" "$BAUD" /work/log/stability.log 60 2>&1 | \
  grep -E "aberta|CAIU|AUSENTE|janela fechada" | tail -25 || true

echo
echo "Logs em $CACHE/serial/ (o .bin é a prova crua — não decodifique)"
