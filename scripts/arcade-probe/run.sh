#!/usr/bin/env bash
# ============================================================
# Giochi System — medir o arcade com e sem geometry shader
# ============================================================
# Uso:
#   bash scripts/arcade-probe/run.sh
#   bash scripts/arcade-probe/run.sh --rebuild
#
# Roda em ambiente fechado (container), sobre Xvfb + llvmpipe. Nada toca o host
# alem deste diretorio, e nada depende do aparelho.
#
# O que ele mede, e por que:
#
#   A) caminho normal     — o ambiente funciona e o arcade usa o caminho com
#                           geometry shader (SpriteListBufferData);
#   B) sem geometry       — o link de qualquer programa com geometry shader
#      shader              falha, que e o que o panfrost faz. Sem o remendo o
#                           arcade levanta antes de aparecer qualquer coisa;
#                           com o remendo tem de abrir, desenhar e colidir em
#                           CPU, e a colisao por GPU tem de dar erro claro.
#
# Saida: PASS/FAIL por modo, e o veredito no fim. Ver README.md para os
# resultados medidos em 04/11/2026 e para o que eles NAO provam.
# ============================================================

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAG="${GIOCHI_ARCADE_PROBE_IMAGE:-giochi-arcade-probe:3.3.3}"
REBUILD=0

while (($#)); do
  case "$1" in
    --rebuild) REBUILD=1 ;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERRO: opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: docker não encontrado." >&2
  exit 2
fi

if ((REBUILD)) || ! docker image inspect "$TAG" >/dev/null 2>&1; then
  echo "Construindo $TAG (só na primeira vez ou com --rebuild)..."
  # O contexto vai por stdin: o Docker instalado por snap não lê o Dockerfile
  # por caminho quando o diretório está sob um dot-dir (a interface `home` do
  # snap exclui diretórios ocultos), e `docker build . ` falha com
  # "open Dockerfile: no such file or directory".
  (cd "$DIR" && tar -cf - Dockerfile) | docker build -t "$TAG" -
fi

run() {
  docker run --rm -v "$DIR:/probe:ro" -w /probe "$TAG" "$@"
}

echo
echo "########## A: caminho normal (com geometry shader) ##########"
run sh -c 'xvfb-run -a -s "-screen 0 640x480x24" python /probe/arcade_probe.py A' 2>&1 \
  | grep -vE 'Skipping antialiasing' || true

echo
echo "########## B sem remendo: a falha tem de aparecer ##########"
run sh -c 'xvfb-run -a -s "-screen 0 640x480x24" python /probe/arcade_probe.py B' 2>&1 \
  | grep -vE 'Skipping antialiasing' || true

echo
echo "########## B com remendo: tem de abrir e desenhar ##########"
# O patch escreve no site-packages: a copia gravavel e feita numa camada do
# container, nao no repo montado read-only.
run sh -c '
  cp -a /venv/lib/python3.12/site-packages /tmp/site
  PYTHONPATH=/tmp/site python /probe/patch-sem-geometry-shader.py /tmp/site
  PYTHONPATH=/tmp/site xvfb-run -a -s "-screen 0 640x480x24" python /probe/arcade_probe.py B --remendo
' 2>&1 | grep -vE 'Skipping antialiasing' || true

echo
echo "Veredito: leia as três seções acima. O que se exige está em README.md."
