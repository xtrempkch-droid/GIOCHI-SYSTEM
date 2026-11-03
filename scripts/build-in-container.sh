#!/usr/bin/env bash
# ============================================================
# Giochi System — build dentro de um container (sem root no host)
# ============================================================
# Uso:
#   bash scripts/build-in-container.sh <device-id>
#   bash scripts/build-in-container.sh --check
#   bash scripts/build-in-container.sh --sd-image <device-id>
#   bash scripts/build-in-container.sh --shell
#   bash scripts/build-in-container.sh --rebuild-image --check
#
# Existe para o caso em que o host não tem as dependências do Buildroot e não
# há como instalar (sem `sudo`, ou com senha). O container `giochi-builder`
# traz a lista completa que `scripts/check-host.sh` audita.
#
# Os artefatos continuam aparecendo em `out/` no host, porque o repositório é
# montado em /work. Downloads e ccache ficam em ~/.cache/giochi-system no host,
# então um rebuild não baixa tudo de novo.
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_ID=""
MODE="build"
REBUILD_IMAGE=0
IMAGE_TAG="${GIOCHI_BUILDER_IMAGE:-giochi-builder:2}"

usage() {
  sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while (($#)); do
  case "$1" in
    --check) MODE="check" ;;
    --sd-image) MODE="sd-image" ;;
    --shell) MODE="shell" ;;
    --rebuild-image) REBUILD_IMAGE=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "ERRO: opção desconhecida: $1" >&2
      exit 2
      ;;
    *)
      if [[ -n "$DEVICE_ID" ]]; then
        echo "ERRO: mais de um device informado: $DEVICE_ID e $1" >&2
        exit 2
      fi
      DEVICE_ID="$1"
      ;;
  esac
  shift
done

if [[ "$MODE" != "check" && "$MODE" != "shell" && -z "$DEVICE_ID" ]]; then
  usage >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: docker não encontrado." >&2
  echo "Instale as dependências no host e use scripts/build-device.sh, ou" >&2
  echo "instale o Docker para usar o builder em container." >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERRO: o daemon do Docker não está acessível para este usuário." >&2
  echo "Verifique se o serviço está rodando e se você está no grupo docker." >&2
  exit 2
fi

if ((REBUILD_IMAGE)) || ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  echo "Construindo a imagem $IMAGE_TAG (só na primeira vez ou com --rebuild-image)..."
  docker build \
    --build-arg "USER_ID=$(id -u)" \
    --build-arg "GROUP_ID=$(id -g)" \
    -t "$IMAGE_TAG" \
    -f "$ROOT/docker/builder.Dockerfile" \
    "$ROOT/docker"
fi

RUN_EXTRA=()
CACHE_HOST="${GIOCHI_CONTAINER_CACHE:-$HOME/.cache/giochi-system}"

# Docker instalado via snap roda num namespace com /tmp privado: um bind-mount
# de /tmp no host aponta para o /tmp do daemon, e os arquivos "desaparecem".
# Isso já custou um log de serial que existia dentro do container e não no host.
case "$CACHE_HOST" in
  /tmp/*|/var/tmp/*)
    if [[ -d /snap/docker ]]; then
      echo "ERRO: $CACHE_HOST fica em /tmp e este Docker é snap (namespace privado)." >&2
      echo "Use um caminho fora de /tmp, ex.: \$HOME/.cache/giochi-system." >&2
      exit 2
    fi
    ;;
esac

mkdir -p "$CACHE_HOST/work" "$CACHE_HOST/downloads" "$CACHE_HOST/ccache"

# As variáveis chegam do ambiente do host e são repassadas explicitamente:
# `docker run` não herda o ambiente da chamada.
PASS_ENV=(
  -e "GIOCHI_SYSTEM_WORK_DIR=/cache/work"
  -e "GIOCHI_SYSTEM_CACHE_DIR=/cache"
  -e "GIOCHI_SYSTEM_CCACHE_DIR=/cache/ccache"
)
for name in BUILDROOT_VERSION ROOT_PASSWORD JOBS ALLOW_DRAFT \
  GIOCHI_SYSTEM_MIN_FREE_GB GIOCHI_SYSTEM_ABORT_FREE_GIB \
  GIOCHI_SYSTEM_DISK_POLL_SECONDS GIOCHI_SYSTEM_GROWTH_LIMIT_MIB \
  GIOCHI_SYSTEM_OUT_DIR GIOCHI_SYSTEM_KEEP_WORK BUILDROOT_URL; do
  if [[ -n "${!name:-}" ]]; then
    PASS_ENV+=(-e "$name=${!name}")
  fi
done

run_container() {
  # `-it` só quando há terminal: em CI (ou chamado por outro script) o stdin
  # não é TTY e o `docker run -t` aborta antes de rodar o comando.
  local tty_flags=()
  if [[ -t 0 && -t 1 ]]; then
    tty_flags=(-it)
  fi
  docker run --rm ${tty_flags[@]+"${tty_flags[@]}"} \
    ${RUN_EXTRA[@]+"${RUN_EXTRA[@]}"} \
    --user "${RUN_USER:-$(id -u):$(id -g)}" \
    -v "$ROOT:/work" \
    -v "$CACHE_HOST:/cache" \
    -w /work \
    "${PASS_ENV[@]}" \
    "$IMAGE_TAG" \
    "$@"
}

case "$MODE" in
  check)
    echo "Pré-voo do host dentro do container $IMAGE_TAG:"
    run_container bash scripts/check-host.sh
    ;;
  shell)
    run_container bash
    ;;
  build)
    echo "Build de $DEVICE_ID em container. Artefatos em: $ROOT/out/$DEVICE_ID"
    run_container bash scripts/build-device.sh "$DEVICE_ID"
    ;;
  sd-image)
    # Precisa de --privileged: loop device, mkfs e mount. É a única etapa que
    # pede privilégio, e ela só mexe em arquivos dentro de out/.
    echo "Gerando a imagem de cartão de $DEVICE_ID..."
    # loop device precisa de root; os arquivos gerados são devolvidos ao
    # usuário do host no fim, por HOST_UID/HOST_GID.
    RUN_EXTRA=(--privileged -e "HOST_UID=$(id -u)" -e "HOST_GID=$(id -g)")
    RUN_USER=0:0
    run_container bash scripts/make-sd-image.sh "$DEVICE_ID"
    ;;
esac
