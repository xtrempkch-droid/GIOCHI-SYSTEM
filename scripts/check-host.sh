#!/usr/bin/env bash
# ============================================================
# Giochi System — pré-voo do host antes do primeiro build
# ============================================================
# giochi-system:help:begin
# Uso:
#   bash scripts/check-host.sh [--offline] [--min-free-gb N]
#
# Audita o host sem instalar nada e sem root. Imprime cada item, o pacote
# Debian/Ubuntu que resolve o que falta e o `apt-get install` pronto.
# Exit 1 se algum item obrigatório falhar; avisos não derrubam.
#
# Por que existe: as dependências do Buildroot só aparecem como erro no meio
# de um build de horas (bison/flex/gperf no host tools, dtc no kernel). Um
# host incompleto custa a compilação inteira; aqui custa dois segundos.
# giochi-system:help:end
# ============================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OFFLINE=0
MIN_FREE_GB=30
BUILDROOT_URL_BASE="${BUILDROOT_URL_BASE:-https://buildroot.org/downloads}"

usage() {
  awk '/^# giochi-system:help:begin$/ { dentro = 1; next }
       /^# giochi-system:help:end$/   { exit }
       dentro                         { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

while (($#)); do
  case "$1" in
    --offline) OFFLINE=1 ;;
    --min-free-gb)
      shift
      MIN_FREE_GB="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERRO: argumento desconhecido: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if ! [[ "$MIN_FREE_GB" =~ ^[0-9]+$ ]]; then
  echo "ERRO: --min-free-gb espera um inteiro, recebeu: $MIN_FREE_GB" >&2
  exit 2
fi

FAILS=()
WARNS=()
MISSING_PKGS=()

pass() { printf '  ok     %s\n' "$1"; }
fail() { printf '  FALHA  %s\n' "$1"; FAILS+=("$1"); }
warn() { printf '  aviso  %s\n' "$1"; WARNS+=("$1"); }

add_pkg() {
  local pkg="$1" existing
  for existing in ${MISSING_PKGS[@]+"${MISSING_PKGS[@]}"}; do
    [[ "$existing" == "$pkg" ]] && return 0
  done
  MISSING_PKGS+=("$pkg")
}

echo "Giochi System — pré-voo do host"
echo "  repo:  $ROOT"
echo "  data:  $(date -u '+%Y-%m-%d %H:%M UTC')"
echo

# ------------------------------------------------------------
# Sistema
# ------------------------------------------------------------
echo "Sistema"
if [[ "$(uname -s)" == "Linux" ]]; then
  pass "kernel Linux ($(uname -m))"
else
  fail "sistema $(uname -s): o Buildroot exige Linux (use WSL2 ou container)"
fi

case "$(uname -m)" in
  x86_64|aarch64) pass "arquitetura de host $(uname -m)" ;;
  *) warn "arquitetura de host $(uname -m): suportada, mas não testada neste repositório" ;;
esac

if ((BASH_VERSINFO[0] >= 4)); then
  pass "bash ${BASH_VERSION%%(*}"
else
  fail "bash ${BASH_VERSION%%(*}: os scripts usam recursos do bash 4+"
fi

case "$ROOT" in
  *" "*)
    fail "o caminho do repositório tem espaço — o Buildroot separa listas por espaço"
    echo "         copie para um caminho sem espaços, ex.: ~/giochi-system"
    ;;
  *) pass "caminho do repositório sem espaços" ;;
esac
echo

# ------------------------------------------------------------
# Node.js (scripts de metadados e testes)
# ------------------------------------------------------------
echo "Node.js"
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || echo 0.0.0)"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && ((NODE_MAJOR >= 20)); then
    pass "node $NODE_VERSION (>= 20)"
  else
    fail "node $NODE_VERSION: o projeto exige Node.js 20+"
  fi
else
  fail "node ausente: instale Node.js 20+ (https://nodejs.org) — não vem do apt padrão"
fi
echo

# ------------------------------------------------------------
# Comandos exigidos pelo Buildroot
# ------------------------------------------------------------
# comando:pacote-debian. Pacote vazio = verificação sem instalação possível.
REQUIRED_COMMANDS=(
  "make:build-essential"
  "gcc:build-essential"
  "g++:build-essential"
  "patch:patch"
  "perl:perl"
  "tar:tar"
  "bzip2:bzip2"
  "gzip:gzip"
  "cpio:cpio"
  "unzip:unzip"
  "rsync:rsync"
  "file:file"
  "bc:bc"
  "find:findutils"
  "which:debianutils"
  "sed:sed"
  "grep:grep"
  "awk:gawk"
  "curl:curl"
  "wget:wget"
  "xz:xz-utils"
  "sha256sum:coreutils"
  "git:git"
  "python3:python3"
  "autoconf:autoconf"
  "automake:automake"
  "bison:bison"
  "flex:flex"
  "gperf:gperf"
  "help2man:help2man"
  "makeinfo:texinfo"
  "swig:swig"
  "dtc:device-tree-compiler"
  "mkfs.vfat:dosfstools"
  "mcopy:mtools"
  "parted:parted"
)

echo "Comandos do Buildroot"
MISSING_COMMANDS=0
for entry in "${REQUIRED_COMMANDS[@]}"; do
  cmd="${entry%%:*}"
  pkg="${entry##*:}"
  if command -v "$cmd" >/dev/null 2>&1; then
    continue
  fi
  MISSING_COMMANDS=$((MISSING_COMMANDS + 1))
  add_pkg "$pkg"
  fail "comando ausente: $cmd (pacote $pkg)"
done
if ((MISSING_COMMANDS == 0)); then
  pass "todos os ${#REQUIRED_COMMANDS[@]} comandos presentes"
fi
echo

# ------------------------------------------------------------
# Versões de host que JÁ quebraram o Buildroot 2024.02
# ------------------------------------------------------------
# A lição do §12.33 foi "o check-host tem de olhar versão, não só presença de
# comando": GCC 14+ e CMake 4+ mudaram comportamento e derrubaram pacotes de
# host (declaração implícita virou erro; mínimo de CMake < 3.5 foi removido).
# As duas correções são automáticas — `config/package-overrides.mk` força
# `-std=gnu17` e `-Wno-error=implicit-function-declaration` nos tools de host, e
# o `build-device.sh` exporta `CMAKE_POLICY_VERSION_MINIMUM=3.5` —, então isto
# aqui é AVISO, não falha. O objetivo é que ninguém descubra a versão do host no
# meio de um build de três horas.
echo "Versões de host que já quebraram o Buildroot 2024.02"
if command -v gcc >/dev/null 2>&1; then
  GCC_VERSION="$(gcc -dumpversion 2>/dev/null | cut -d. -f1)"
  if [[ "$GCC_VERSION" =~ ^[0-9]+$ ]] && ((GCC_VERSION >= 14)); then
    warn "gcc $GCC_VERSION (>= 14): declaração implícita é erro; o override já aplica -Wno-error"
  else
    pass "gcc ${GCC_VERSION:-?} (sem as quebras do 14+)"
  fi
fi
if command -v cmake >/dev/null 2>&1; then
  CMAKE_MAJOR="$(cmake --version 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1)"
  if [[ "$CMAKE_MAJOR" =~ ^[0-9]+$ ]] && ((CMAKE_MAJOR >= 4)); then
    pass "cmake $CMAKE_MAJOR (>= 4): o build exporta CMAKE_POLICY_VERSION_MINIMUM=3.5"
  else
    pass "cmake ${CMAKE_MAJOR:-?}"
  fi
fi
echo

# ------------------------------------------------------------
# Bibliotecas de desenvolvimento (headers) exigidas por pacotes host
# ------------------------------------------------------------
# Um comando presente não garante header: libssl-dev não instala binário.
HEADERS=(
  "openssl/ssl.h:libssl-dev:OpenSSL"
  "ncurses.h:libncurses-dev:ncurses (menuconfig)"
  "libelf.h:libelf-dev:libelf (kernel/objtool)"
  "libudev.h:libudev-dev:libudev (eudev/udev host)"
  "zlib.h:zlib1g-dev:zlib"
)

echo "Headers de desenvolvimento"
if ! command -v gcc >/dev/null 2>&1; then
  warn "gcc ausente: headers não puderam ser testados"
else
  MISSING_HEADERS=0
  for entry in "${HEADERS[@]}"; do
    header="${entry%%:*}"
    rest="${entry#*:}"
    pkg="${rest%%:*}"
    label="${rest##*:}"
    if printf '#include <%s>\nint main(void) { return 0; }\n' "$header" |
      gcc -x c -fsyntax-only -std=gnu17 - >/dev/null 2>&1; then
      continue
    fi
    MISSING_HEADERS=$((MISSING_HEADERS + 1))
    add_pkg "$pkg"
    fail "header ausente: $header ($label, pacote $pkg)"
  done
  if ((MISSING_HEADERS == 0)); then
    pass "todos os ${#HEADERS[@]} headers presentes"
  fi
fi
echo

# ------------------------------------------------------------
# ccache (opcional, mas muda horas para minutos)
# ------------------------------------------------------------
echo "Cache de compilação"
if command -v ccache >/dev/null 2>&1; then
  pass "ccache $(ccache --version 2>/dev/null | awk 'NR==1 {print $3}')"
else
  warn "ccache ausente: o build funciona, mas cada rebuild paga o custo inteiro (apt: ccache)"
fi
echo

# ------------------------------------------------------------
# Espaço em disco
# ------------------------------------------------------------
echo "Espaço em disco"
WORK_ROOT="${GIOCHI_SYSTEM_WORK_DIR:-/tmp}"
mkdir -p "$WORK_ROOT" 2>/dev/null || true
FREE_KB="$(df -Pk "$WORK_ROOT" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [[ "$FREE_KB" =~ ^[0-9]+$ ]]; then
  FREE_GB=$((FREE_KB / 1024 / 1024))
  if ((FREE_GB >= MIN_FREE_GB)); then
    pass "${FREE_GB} GiB livres em $WORK_ROOT (mínimo ${MIN_FREE_GB})"
  else
    fail "${FREE_GB} GiB livres em $WORK_ROOT: mínimo ${MIN_FREE_GB} (um build consome ~15 GiB)"
  fi
else
  warn "não foi possível medir o espaço livre em $WORK_ROOT"
fi

# /tmp é tmpfs em muitas distribuições: o "espaço livre" ali é RAM. Um build de
# ~15 GiB em tmpfs troca o disco pelo swap e trava a máquina.
WORK_FS="$(df -PT "$WORK_ROOT" 2>/dev/null | awk 'NR==2 {print $2}' || true)"
case "$WORK_FS" in
  tmpfs|ramfs)
    warn "$WORK_ROOT está em $WORK_FS (memória, não disco) — use GIOCHI_SYSTEM_WORK_DIR num disco real"
    ;;
esac
echo

# ------------------------------------------------------------
# Buildroot: versão, hash fixado e download
# ------------------------------------------------------------
echo "Buildroot"
BUILDROOT_VERSION="$(tr -d '[:space:]' < "$ROOT/buildroot.version" 2>/dev/null || true)"
if [[ "$BUILDROOT_VERSION" =~ ^[0-9]{4}\.[0-9]{2}(\.[0-9]+)?$ ]]; then
  pass "versão fixada em $BUILDROOT_VERSION (buildroot.version)"
else
  fail "buildroot.version inválido: '${BUILDROOT_VERSION}'"
fi

TARBALL_NAME="buildroot-$BUILDROOT_VERSION.tar.gz"
SHA_FILE="$ROOT/buildroot.sha256"
EXPECTED_SHA=""
if [[ -f "$SHA_FILE" ]]; then
  EXPECTED_SHA="$(awk -v want="$TARBALL_NAME" '$2 == want { print $1; exit }' "$SHA_FILE")"
fi
if [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]]; then
  pass "hash SHA256 fixado para $TARBALL_NAME"
else
  warn "sem hash SHA256 em buildroot.sha256 para $TARBALL_NAME: tarball não será verificado"
fi

CACHE_ROOT="${GIOCHI_SYSTEM_CACHE_DIR:-/tmp/giochi-system-cache}"
CACHED_TARBALL="$CACHE_ROOT/downloads/$TARBALL_NAME"
if [[ -f "$CACHED_TARBALL" ]]; then
  if [[ -n "$EXPECTED_SHA" ]]; then
    ACTUAL_SHA="$(sha256sum "$CACHED_TARBALL" | awk '{print $1}')"
    if [[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]]; then
      pass "tarball em cache confere com o hash"
    else
      fail "tarball em cache com SHA256 divergente: $CACHED_TARBALL"
      echo "         esperado $EXPECTED_SHA"
      echo "         obtido   $ACTUAL_SHA"
      echo "         apague o arquivo e rode de novo"
    fi
  else
    warn "tarball em cache não verificado (sem hash fixado)"
  fi
else
  pass "sem tarball em cache (será baixado no primeiro build)"
fi

if ((OFFLINE)); then
  warn "checagem de rede pulada (--offline)"
else
  URL="$BUILDROOT_URL_BASE/$TARBALL_NAME"
  if HEADERS_OUT="$(curl -fsSI --retry 2 --max-time 30 "$URL" 2>&1)"; then
    BYTES="$(printf '%s\n' "$HEADERS_OUT" | awk 'tolower($1) == "content-length:" { gsub(/\r/, "", $2); print $2; exit }')"
    if [[ "$BYTES" =~ ^[0-9]+$ ]]; then
      pass "download alcançável: $URL ($((BYTES / 1024 / 1024)) MiB)"
    else
      pass "download alcançável: $URL"
    fi
  else
    fail "não foi possível alcançar $URL (rede/proxy?)"
  fi
fi
echo

# ------------------------------------------------------------
# Resumo
# ------------------------------------------------------------
echo "Resumo"
printf '  %d falha(s), %d aviso(s)\n' "${#FAILS[@]}" "${#WARNS[@]}"

if ((${#MISSING_PKGS[@]})); then
  echo
  echo "Pacotes ausentes — copie e cole:"
  echo "  sudo apt-get update"
  printf '  sudo apt-get install -y --no-install-recommends'
  printf ' %s' "${MISSING_PKGS[@]}"
  printf '\n'
fi

echo
if ((${#FAILS[@]})); then
  echo "Host NÃO está pronto. Resolva as falhas acima e rode de novo."
  exit 1
fi

echo "Host pronto para o build."
if ((${#WARNS[@]})); then
  echo "Há avisos que não impedem o build — leia antes de compilar."
fi
exit 0
