#!/usr/bin/env bash
# ============================================================
# Giochi System — build dentro de um container (sem root no host)
# ============================================================
# giochi-system:help:begin
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
# giochi-system:help:end
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_ID=""
MODE="build"
REBUILD_IMAGE=0
IMAGE_TAG="${GIOCHI_BUILDER_IMAGE:-giochi-builder:2}"

usage() {
  awk '/^# giochi-system:help:begin$/ { dentro = 1; next }
       /^# giochi-system:help:end$/   { exit }
       dentro                         { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
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

# ## Onde montar o cache de build
#
# Por padrão em `/cache`, um caminho curto e estável — funciona e é o que os
# builds desta árvore usaram até aqui.
#
# Mas o Buildroot grava o CAMINHO ABSOLUTO do `host/` no `RPATH` de cada binário
# que produz, e o `support/scripts/check-host-rpath` falha o build quando o RPATH
# não bate com o `host/lib` do momento. Consequência: um `work/` construído com
# um layout não pode ser retomado com outro. Medido em 06/11/2026, ao tentar
# retomar o `work/r35s` (construído com o caminho do host no RPATH):
#
#   *** ERROR: package host-cmake installs executables without proper RPATH:
#   ***   /cache/work/r35s/build/host/sbin/sfdisk
#   (... 238 binários, todos com RUNPATH /home/charles/...)
#
# Note que a mensagem acusa o pacote que acabou de instalar (`host-cmake`) e
# lista binários de OUTROS pacotes — o culpado não é o pacote citado, é a
# mistura de layouts.
#
# `GIOCHI_CONTAINER_SAME_PATHS=1` monta o cache no MESMO caminho absoluto do
# host, o que torna container e build nativo intercambiáveis. Use quando o
# `work/<device>` já existir e não se quiser pagar um build do zero (~1 h só de
# toolchain).
#
# ## Por que isso virou automático
#
# Era uma flag para esquecer, e foi esquecida. Medido em 06/11/2026: o retomado
# do `work/r35s` sem a flag morreu no FIM do build, em `fs/ext2`:
#
#   fakeroot: preload library `libfakeroot.so' not found, aborting.
#   make: *** [fs/ext2/ext2.mk:66: .../images/rootfs.ext2] Error 1
#
# O `bin/fakeroot` é um script de shell com o prefixo CRAVADO na geração:
#
#   FAKEROOT_PREFIX=/home/charles/.cache/giochi-system/work/r35s/build/host
#   PATHS=/home/charles/.cache/giochi-system/work/r35s/build/host/lib:...
#
# Dentro do container com `/cache` esse diretório não existe, então o fakeroot
# não acha a própria biblioteca. O erro cita a biblioteca, não o caminho — e o
# build já tinha compilado tudo antes de morrer.
#
# A defesa certa é não ter flag: o layout do `work/<device>` existente MANDA.
# Lemos o prefixo cravado nele e montamos o cache no caminho que ele espera.
# Sem `work/` (build do zero) o padrão `/cache` continua valendo.
CACHE_IN_CONTAINER=/cache
CACHE_MOUNT_ORIGEM="padrão"

if [[ -n "$DEVICE_ID" ]]; then
  WORK_DEV_HOST="$CACHE_HOST/work/$(echo "$DEVICE_ID" | tr 'A-Z' 'a-z')"
  FAKEROOT_WRAPPER="$WORK_DEV_HOST/build/host/bin/fakeroot"
  if [[ -f "$FAKEROOT_WRAPPER" ]]; then
    # O prefixo da instalação é a primeira atribuição FAKEROOT_PREFIX= do wrapper.
    PREFIXO_CRAVADO="$(sed -n 's/^FAKEROOT_PREFIX=//p' "$FAKEROOT_WRAPPER" | head -1)"
    case "$PREFIXO_CRAVADO" in
      "$WORK_DEV_HOST/build/host")
        CACHE_IN_CONTAINER="$CACHE_HOST"
        CACHE_MOUNT_ORIGEM="work/ existente foi construído com o caminho do host"
        ;;
      "/cache/work/"*/build/host)
        CACHE_IN_CONTAINER=/cache
        CACHE_MOUNT_ORIGEM="work/ existente foi construído dentro do container em /cache"
        ;;
      "")
        : # wrapper sem prefixo reconhecível: fica no padrão
        ;;
      *)
        echo "ERRO: o work/$DEVICE_ID existente espera $PREFIXO_CRAVADO," >&2
        echo "      que não existe nem no host nem em /cache dentro do container." >&2
        echo "      Esse work/ veio de outra máquina: rode sem" >&2
        echo "      GIOCHI_SYSTEM_KEEP_WORK=1 para reconstruir do zero." >&2
        exit 2
        ;;
    esac
  fi
fi

if [[ "${GIOCHI_CONTAINER_SAME_PATHS:-0}" =~ ^(1|true|yes|on)$ ]]; then
  CACHE_IN_CONTAINER="$CACHE_HOST"
  CACHE_MOUNT_ORIGEM="GIOCHI_CONTAINER_SAME_PATHS=1 (forçado)"
fi

echo "cache:     $CACHE_IN_CONTAINER no container ← $CACHE_HOST no host"
echo "           ($CACHE_MOUNT_ORIGEM)"

# As variáveis chegam do ambiente do host e são repassadas explicitamente:
# `docker run` não herda o ambiente da chamada.
PASS_ENV=(
  -e "GIOCHI_SYSTEM_WORK_DIR=$CACHE_IN_CONTAINER/work"
  -e "GIOCHI_SYSTEM_CACHE_DIR=$CACHE_IN_CONTAINER"
  -e "GIOCHI_SYSTEM_CCACHE_DIR=$CACHE_IN_CONTAINER/ccache"
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
    -v "$CACHE_HOST:$CACHE_IN_CONTAINER" \
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
