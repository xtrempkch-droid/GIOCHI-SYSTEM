#!/usr/bin/env bash
# ============================================================
# Giochi System — build de uma imagem Buildroot para um device
# ============================================================
# Uso:
#   bash scripts/build-device.sh <device-id>
#
# Variáveis úteis:
#   BUILDROOT_VERSION     sobrescreve buildroot.version
#   ROOT_PASSWORD          senha de root (padrão: giochi-dev)
#   GIOCHI_SYSTEM_WORK_DIR    diretório de trabalho (padrão: /tmp/giochi-system-work)
#   GIOCHI_SYSTEM_CACHE_DIR   cache de downloads (padrão: /tmp/giochi-system-cache)
#   GIOCHI_SYSTEM_OUT_DIR     saída (padrão: <repo>/out/<device>)
#   JOBS                   paralelismo do make (padrão: nproc)
#   ALLOW_DRAFT=1          permite tentar um device draft
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_ID="${1:-}"

if [[ -z "$DEVICE_ID" ]]; then
  echo "Uso: bash scripts/build-device.sh <device-id>" >&2
  exit 2
fi

if [[ ! "$DEVICE_ID" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
  echo "ERRO: device-id inválido: $DEVICE_ID" >&2
  exit 2
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERRO: o Buildroot precisa de Linux. Use Ubuntu/WSL2 ou o GitHub Actions." >&2
  exit 2
fi

for command in curl tar make node sha256sum cp grep sed; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERRO: comando ausente: $command" >&2
    exit 2
  fi
done

BUILDROOT_VERSION="${BUILDROOT_VERSION:-$(tr -d '[:space:]' < "$ROOT/buildroot.version")}"
if [[ ! "$BUILDROOT_VERSION" =~ ^[0-9]{4}\.[0-9]{2}(\.[0-9]+)?$ ]]; then
  echo "ERRO: BUILDROOT_VERSION inválido: $BUILDROOT_VERSION" >&2
  exit 2
fi

ENABLED="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" enabled)"
if [[ "$ENABLED" != "true" && "${ALLOW_DRAFT:-0}" != "1" ]]; then
  echo "ERRO: $DEVICE_ID está desabilitado em device/devices.json." >&2
  echo "Habilite o device ou use ALLOW_DRAFT=1 para uma tentativa de desenvolvimento." >&2
  exit 2
fi

DEFCONFIG="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" defconfig)"
if [[ -z "$DEFCONFIG" ]]; then
  echo "ERRO: $DEVICE_ID não tem buildrootDefconfig definido." >&2
  echo "Preencha device.json antes de construir." >&2
  exit 2
fi

HOSTNAME_VALUE="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" hostname)"
DEVICE_NAME="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" name)"
DEVICE_ARCH="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" arch)"
DEVICE_FOLDER="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" folder)"
DEVICE_DIR="$ROOT/device/$DEVICE_FOLDER"
FRAGMENT="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" fragment)"
DEVICE_DOCS="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" docs)"

mapfile -t OVERLAYS < <(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" overlays)
mapfile -t ARTIFACTS < <(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" artifacts)

if [[ ${#OVERLAYS[@]} -eq 0 || ${#ARTIFACTS[@]} -eq 0 ]]; then
  echo "ERRO: overlays ou artefatos vazios para $DEVICE_ID." >&2
  exit 2
fi

ROOT_PASSWORD="${ROOT_PASSWORD:-giochi-dev}"
JOBS="${JOBS:-$(nproc)}"
if [[ ! "$JOBS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERRO: JOBS inválido: $JOBS" >&2
  exit 2
fi

CACHE_ROOT="${GIOCHI_SYSTEM_CACHE_DIR:-/tmp/giochi-system-cache}"
WORK_ROOT="${GIOCHI_SYSTEM_WORK_DIR:-/tmp/giochi-system-work}"
WORK_DIR="$WORK_ROOT/$DEVICE_ID"
BUILD_DIR="$WORK_DIR/build"
OVERLAY_STAGE="$BUILD_DIR/giochi-system-overlays"
DOWNLOAD_DIR="$CACHE_ROOT/downloads"
BUILDROOT_DL_DIR="$CACHE_ROOT/dl"
OUT_DIR="${GIOCHI_SYSTEM_OUT_DIR:-$ROOT/out/$DEVICE_ID}"
LOG_FILE="$WORK_DIR/build.log"
TARBALL="$DOWNLOAD_DIR/buildroot-$BUILDROOT_VERSION.tar.gz"
BUILDROOT_URL="${BUILDROOT_URL:-https://buildroot.org/downloads/buildroot-$BUILDROOT_VERSION.tar.gz}"
CCACHE_DIR="${GIOCHI_SYSTEM_CCACHE_DIR:-$CACHE_ROOT/ccache}"
MIN_FREE_GB="${GIOCHI_SYSTEM_MIN_FREE_GB:-15}"

if ! [[ "$MIN_FREE_GB" =~ ^[0-9]+$ ]]; then
  echo "ERRO: GIOCHI_SYSTEM_MIN_FREE_GB inválido: $MIN_FREE_GB" >&2
  exit 2
fi

echo "Giochi System"
echo "  device:    $DEVICE_ID ($DEVICE_NAME)"
echo "  arch:      $DEVICE_ARCH"
echo "  buildroot: $BUILDROOT_VERSION"
echo "  work:      $WORK_DIR"
echo "  cache:     $CACHE_ROOT"
echo "  out:       $OUT_DIR"
echo

rm -rf "$WORK_DIR" "$OUT_DIR"
mkdir -p "$DOWNLOAD_DIR" "$BUILDROOT_DL_DIR" "$WORK_DIR" "$BUILD_DIR" "$OUT_DIR"

# Um build Buildroot completo consome ~15 GiB. Sem esta checagem o build roda
# 1-3 h e morre no meio com erro obscuro quando o disco enche — a causa real
# (falta de espaço) não aparece em lugar nenhum do log.
FREE_KB="$(df -Pk "$WORK_ROOT" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [[ -n "$FREE_KB" && "$FREE_KB" =~ ^[0-9]+$ ]]; then
  FREE_GB=$((FREE_KB / 1024 / 1024))
  if (( FREE_GB < MIN_FREE_GB )); then
    echo "ERRO: apenas ${FREE_GB} GiB livres em $WORK_ROOT (mínimo: ${MIN_FREE_GB} GiB)." >&2
    echo "Um build completo precisa de ~15 GiB. Libere espaço ou ajuste GIOCHI_SYSTEM_MIN_FREE_GB." >&2
    exit 1
  fi
  echo "  espaço:    ${FREE_GB} GiB livres (mínimo ${MIN_FREE_GB})"
else
  echo "AVISO: não foi possível medir o espaço livre em $WORK_ROOT." >&2
fi

# Guarda contra o padrão que gera cópia recursiva: diretório de build ou de
# saída dentro do repositório. Por si só isso é normal (`out/` mora no repo),
# mas vira armadilha no dia em que um pacote usar SITE_METHOD = local
# apontando para a raiz do repositório.
for dir_to_check in "$BUILD_DIR" "$OUT_DIR"; do
  case "$dir_to_check/" in
    "$ROOT"/*)
      echo "AVISO: $dir_to_check está dentro do repositório." >&2
      echo "Se algum pacote usar SITE_METHOD = local com SITE na raiz do repo," >&2
      echo "o rsync copia a própria saída e o disco enche em loop." >&2
      echo "Use um snapshot das fontes. Ver docs/troubleshooting.md." >&2
      ;;
  esac
done

# ccache corta o rebuild de 1-3 h para minutos. Ausente, o build continua,
# mas cada execução paga o custo inteiro de novo.
CCACHE_ARG=""
if command -v ccache >/dev/null 2>&1; then
  mkdir -p "$CCACHE_DIR"
  CCACHE_ARG="$CCACHE_DIR"
  echo "  ccache:    $CCACHE_DIR"
else
  echo "AVISO: ccache não encontrado no PATH; build sem cache de compilação." >&2
fi

if [[ ! -s "$TARBALL" ]]; then
  echo "Baixando Buildroot $BUILDROOT_VERSION..."
  curl -fL --retry 3 --retry-delay 2 -o "$TARBALL.part" "$BUILDROOT_URL"
  mv "$TARBALL.part" "$TARBALL"
fi

if ! tar -tzf "$TARBALL" >/dev/null 2>&1; then
  echo "ERRO: tarball do Buildroot inválido: $TARBALL" >&2
  exit 2
fi

echo "Extraindo Buildroot..."
tar -xzf "$TARBALL" -C "$WORK_DIR"
BR2_DIR="$WORK_DIR/buildroot-$BUILDROOT_VERSION"
if [[ ! -f "$BR2_DIR/Makefile" ]]; then
  echo "ERRO: diretório do Buildroot não encontrado: $BR2_DIR" >&2
  exit 2
fi

echo "Aplicando defconfig $DEFCONFIG..."
if ! make -C "$BR2_DIR" O="$BUILD_DIR" "$DEFCONFIG" >"$WORK_DIR/defconfig.log" 2>&1; then
  tail -n 120 "$WORK_DIR/defconfig.log" >&2
  exit 1
fi

# Copia overlays para caminhos sem espaços, independentemente do nome
# da pasta do device (ex.: "powkiddy x55").
mkdir -p "$OVERLAY_STAGE"
stage_overlay() {
  local source="$1"
  local destination="$2"
  mkdir -p "$destination"
  cp -a "$source/." "$destination/"
}

COMMON_OVERLAY="$ROOT/device/common/rootfs-overlay"
stage_overlay "$COMMON_OVERLAY" "$OVERLAY_STAGE/00-common"
OVERLAY_ARGS=(--overlay "$OVERLAY_STAGE/00-common")

index=1
for overlay in "${OVERLAYS[@]}"; do
  destination="$OVERLAY_STAGE/$(printf '%02d-device' "$index")"
  stage_overlay "$overlay" "$destination"
  OVERLAY_ARGS+=(--overlay "$destination")
  index=$((index + 1))
done

echo "Mesclando configuração comum + device..."
node "$ROOT/scripts/prepare-config.mjs" \
  --config "$BUILD_DIR/.config" \
  --hostname "$HOSTNAME_VALUE" \
  --issue "Giochi System - $DEVICE_NAME" \
  --root-password "$ROOT_PASSWORD" \
  --dl-dir "$BUILDROOT_DL_DIR" \
  --fragment "$ROOT/config/common.fragment" \
  --fragment "$FRAGMENT" \
  --ccache-dir "$CCACHE_ARG" \
  "${OVERLAY_ARGS[@]}"

make -C "$BR2_DIR" O="$BUILD_DIR" olddefconfig >"$WORK_DIR/olddefconfig.log" 2>&1

# O olddefconfig descarta símbolo em silêncio (nome inexistente, símbolo legacy ou
# pai unset). Sem esta checagem o build fica verde e a imagem sai incompleta.
if ! node "$ROOT/scripts/assert-config.mjs" \
  --config "$BUILD_DIR/.config" \
  --fragment "$ROOT/config/common.fragment" \
  --fragment "$FRAGMENT"; then
  echo "ERRO: símbolos pedidos não sobreviveram ao olddefconfig (ver acima)." >&2
  echo "O log do olddefconfig está em $WORK_DIR/olddefconfig.log." >&2
  exit 1
fi

case "$DEVICE_ARCH" in
  arm64) ARCH_SYMBOL="BR2_aarch64" ;;
  x86_64) ARCH_SYMBOL="BR2_x86_64" ;;
  arm) ARCH_SYMBOL="BR2_arm" ;;
  *)
    echo "ERRO: arch não suportada: $DEVICE_ARCH" >&2
    exit 2
    ;;
esac

if ! grep -q "^$ARCH_SYMBOL=y" "$BUILD_DIR/.config"; then
  echo "ERRO: a configuração final não contém $ARCH_SYMBOL=y." >&2
  echo "Veja $BUILD_DIR/.config e o defconfig $DEFCONFIG." >&2
  exit 1
fi

if ! grep -q "^BR2_ROOTFS_OVERLAY=.*giochi-system-overlays" "$BUILD_DIR/.config"; then
  echo "ERRO: os overlays do Giochi System não entraram em BR2_ROOTFS_OVERLAY." >&2
  exit 1
fi

echo "Compilando com $JOBS job(s). O log fica em $LOG_FILE..."

# ---------------------------------------------------------------
# Monitor de disco durante o build.
#
# A falha que originou isto: uma pasta copiava o repositório inteiro para
# dentro de si mesma, em loop. O disco enchia progressivamente e o build
# morria horas depois, sem mensagem que ligasse o sintoma à causa.
#
# Duas defesas, porque as duas falhas parecem iguais no fim:
#   1. piso de espaço livre — aborta antes de zerar o disco;
#   2. taxa de crescimento — pega a espiral mesmo com disco grande.
# ---------------------------------------------------------------
DISK_ABORT_GIB="${GIOCHI_SYSTEM_ABORT_FREE_GIB:-2}"
DISK_POLL_SECONDS="${GIOCHI_SYSTEM_DISK_POLL_SECONDS:-20}"
DISK_GROWTH_LIMIT_MIB="${GIOCHI_SYSTEM_GROWTH_LIMIT_MIB:-4096}"

if ! [[ "$DISK_ABORT_GIB" =~ ^[0-9]+$ ]]; then
  echo "ERRO: GIOCHI_SYSTEM_ABORT_FREE_GIB inválido: $DISK_ABORT_GIB" >&2
  exit 2
fi
if ! [[ "$DISK_POLL_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERRO: GIOCHI_SYSTEM_DISK_POLL_SECONDS inválido: $DISK_POLL_SECONDS" >&2
  exit 2
fi

free_kb() {
  df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}' || true
}

ABORT_FREE_KB=$((DISK_ABORT_GIB * 1024 * 1024))
GROWTH_LIMIT_KB=$((DISK_GROWTH_LIMIT_MIB * 1024))

# setsid coloca o make como líder de grupo, para que o kill derrube também
# os compiladores filhos. Sem isso sobra processo escrevendo em disco.
if command -v setsid >/dev/null 2>&1; then
  setsid make -C "$BR2_DIR" O="$BUILD_DIR" -j"$JOBS" >"$LOG_FILE" 2>&1 &
else
  make -C "$BR2_DIR" O="$BUILD_DIR" -j"$JOBS" >"$LOG_FILE" 2>&1 &
fi
BUILD_PID=$!

WATCHDOG_REASON=""
PREV_FREE_KB="$(free_kb "$WORK_ROOT")"

while kill -0 "$BUILD_PID" 2>/dev/null; do
  sleep "$DISK_POLL_SECONDS"
  kill -0 "$BUILD_PID" 2>/dev/null || break

  CUR_FREE_KB="$(free_kb "$WORK_ROOT")"
  [[ -n "$CUR_FREE_KB" ]] || continue

  if [[ "$CUR_FREE_KB" =~ ^[0-9]+$ ]] && (( CUR_FREE_KB < ABORT_FREE_KB )); then
    WATCHDOG_REASON="espaço livre caiu para $((CUR_FREE_KB / 1024 / 1024)) GiB (piso: ${DISK_ABORT_GIB} GiB)"
  elif [[ "$PREV_FREE_KB" =~ ^[0-9]+$ && "$CUR_FREE_KB" =~ ^[0-9]+$ ]] \
    && (( PREV_FREE_KB - CUR_FREE_KB > GROWTH_LIMIT_KB )); then
    WATCHDOG_REASON="consumiu $(( (PREV_FREE_KB - CUR_FREE_KB) / 1024 / 1024 )) GiB em ${DISK_POLL_SECONDS}s — padrão de cópia recursiva"
  fi

  if [[ -n "$WATCHDOG_REASON" ]]; then
    kill -TERM -- -"$BUILD_PID" 2>/dev/null || kill -TERM "$BUILD_PID" 2>/dev/null || true
    break
  fi

  PREV_FREE_KB="$CUR_FREE_KB"
done

BUILD_STATUS=0
wait "$BUILD_PID" || BUILD_STATUS=$?

if [[ -n "$WATCHDOG_REASON" ]]; then
  echo "" >&2
  echo "ERRO: build interrompido pelo monitor de disco." >&2
  echo "Motivo: $WATCHDOG_REASON" >&2
  echo "" >&2
  echo "A causa mais comum é uma pasta copiando o repositório para dentro de" >&2
  echo "si mesma, em loop. No Buildroot isso acontece com SITE_METHOD = local" >&2
  echo "apontando para a raiz do repositório quando o diretório de saída fica" >&2
  echo "dentro dele: o rsync passa a copiar a própria saída, que cresce a cada" >&2
  echo "volta até encher o disco." >&2
  echo "" >&2
  echo "Como corrigir: aponte SITE para uma cópia congelada das fontes" >&2
  echo "(snapshot), nunca para a raiz do repositório. Detalhes em" >&2
  echo "docs/troubleshooting.md, seção 'Cópia recursiva'." >&2
  echo "" >&2
  echo "Últimas linhas do log:" >&2
  tail -n 40 "$LOG_FILE" >&2
  exit 1
fi

if [[ "$BUILD_STATUS" -ne 0 ]]; then
  echo "ERRO: build falhou. Últimas linhas do log:" >&2
  tail -n 160 "$LOG_FILE" >&2
  exit 1
fi

echo "Coletando artefatos..."
shopt -s nullglob
copied=0
for pattern in "${ARTIFACTS[@]}"; do
  for file in "$BUILD_DIR/images/"$pattern; do
    if [[ -f "$file" ]]; then
      cp -a "$file" "$OUT_DIR/"
      echo "  + $(basename "$file")"
      copied=$((copied + 1))
    fi
  done
done
shopt -u nullglob

if [[ "$copied" -eq 0 ]]; then
  echo "ERRO: nenhum artefato encontrado em $BUILD_DIR/images." >&2
  echo "Padrões procurados: ${ARTIFACTS[*]}" >&2
  exit 1
fi

cp -a "$BUILD_DIR/.config" "$OUT_DIR/buildroot.config"
sed -i 's#^BR2_TARGET_GENERIC_ROOT_PASSWD=.*#BR2_TARGET_GENERIC_ROOT_PASSWD="__REDACTED__"#' "$OUT_DIR/buildroot.config"
cp -a "$DEVICE_DIR/device.json" "$OUT_DIR/device.json"
cp -a "$FRAGMENT" "$OUT_DIR/buildroot.fragment"
cp -a "$DEVICE_DOCS" "$OUT_DIR/DEVICE.md"

{
  echo "name=Giochi System"
  echo "device=$DEVICE_ID"
  echo "device_name=$DEVICE_NAME"
  echo "arch=$DEVICE_ARCH"
  echo "buildroot=$BUILDROOT_VERSION"
  echo "version=${GIOCHI_SYSTEM_VERSION:-local}"
  echo "commit=${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "local")}"
  echo "built_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "runner=$(uname -a)"
  echo "hostname=$HOSTNAME_VALUE"
  echo "root_password=definida no build (não registrada)"
} >"$OUT_DIR/build-info.txt"

(
  cd "$OUT_DIR"
  sha256sum * >SHA256SUMS
)

echo
echo "OK: imagem(ns) em $OUT_DIR"
ls -lh "$OUT_DIR"
