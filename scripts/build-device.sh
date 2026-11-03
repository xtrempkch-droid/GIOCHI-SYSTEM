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
# ALLOW_DRAFT aceita 1/true/yes/on: a variável chega do `env:` do workflow como
# string, e comparar só com "1" já derrubou um build com "Dispositivo
# desabilitado" quando o valor era "true".
case "$(printf '%s' "${ALLOW_DRAFT:-0}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) ALLOW_DRAFT_OK=1 ;;
  *) ALLOW_DRAFT_OK=0 ;;
esac
if [[ "$ENABLED" != "true" && "$ALLOW_DRAFT_OK" != "1" ]]; then
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

# Buildroot trata BR2_ROOTFS_OVERLAY, BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES e
# BR2_LINUX_KERNEL_PATCH como listas separadas por espaço. Um caminho com
# espaço no repositório (ou no diretório de trabalho) faz o Buildroot procurar
# metade de um caminho e falhar com erro que não cita a causa. Melhor dizer o
# que é, na hora.
case "$ROOT" in
  *" "*)
    echo "ERRO: o caminho do repositório tem espaço:" >&2
    echo "  $ROOT" >&2
    echo "O Buildroot separa essas opções por espaço. Copie o repositório para" >&2
    echo "um caminho sem espaços (ex.: ~/giochi-system) e rode de novo." >&2
    exit 2
    ;;
esac

echo "Giochi System"
echo "  device:    $DEVICE_ID ($DEVICE_NAME)"
echo "  arch:      $DEVICE_ARCH"
echo "  buildroot: $BUILDROOT_VERSION"
echo "  work:      $WORK_DIR"
echo "  cache:     $CACHE_ROOT"
echo "  out:       $OUT_DIR"
echo

rm -rf "$OUT_DIR"
mkdir -p "$DOWNLOAD_DIR" "$BUILDROOT_DL_DIR" "$WORK_DIR" "$BUILD_DIR" "$OUT_DIR"

# Patch novo em um build retomado (KEEP_WORK=1) NÃO é aplicado: o Buildroot vê
# `.stamp_patched` e pula a fase inteira. O sintoma é o pior tipo — build verde,
# imagem sem a correção, e o log dizendo "patch: ..." como se tivesse entrado.
# Aqui a comparação é feita e, se o conjunto de patches mudou, o pacote do
# kernel é limpo para reaplicar.
PATCH_STATE_FILE="$WORK_DIR/kernel-patches.state"
CURRENT_PATCHES="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" kernelPatches 2>/dev/null | xargs -r -d '\n' -I{} sha256sum {} 2>/dev/null | awk '{print $1}' | sort | tr '\n' ' ')"
PREVIOUS_PATCHES="$(cat "$PATCH_STATE_FILE" 2>/dev/null || true)"
FORCE_KERNEL_REBUILD=0
if [[ "$CURRENT_PATCHES" != "$PREVIOUS_PATCHES" ]]; then
  # `[[ -f "$dir/"* ]]` NÃO expande glob no bash — só `[ ]` e comandos externos
  # fazem pathname expansion. Usar compgen, senão a detecção nunca dispara.
  if compgen -G "$BUILD_DIR/build/linux-*/.stamp_patched" >/dev/null; then
    FORCE_KERNEL_REBUILD=1
  fi
  printf '%s' "$CURRENT_PATCHES" >"$PATCH_STATE_FILE" 2>/dev/null || true
fi

# KEEP_WORK=1 mantém o diretório de build e deixa o Buildroot continuar de onde
# parou. Sem isso, cada tentativa depois de uma falha recomeça do zero: um erro
# no busybox na terceira hora custa outras três horas para ser testado. O padrão
# continua sendo apagar, porque build sujo é a origem de resultado irreproduzível
# — retomar é escolha explícita de quem está depurando.
KEEP_WORK="${GIOCHI_SYSTEM_KEEP_WORK:-0}"
case "${KEEP_WORK,,}" in
  1|true|yes|on) KEEP_WORK=1 ;;
  *) KEEP_WORK=0 ;;
esac
if ((KEEP_WORK)); then
  if [[ -f "$BUILD_DIR/.config" ]]; then
    echo "  retomando: build existente em $BUILD_DIR (GIOCHI_SYSTEM_KEEP_WORK=1)"
  else
    echo "  retomando: não há build anterior em $WORK_DIR; começando do zero"
  fi
else
  rm -rf "$WORK_DIR"
  mkdir -p "$WORK_DIR"
fi

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

# Integridade do tarball: o hash fica fixado em buildroot.sha256. Sem isso, um
# download corrompido ou trocado no cache vira erro de compilação horas depois,
# sem citar a causa — e ninguém desconfia do arquivo baixado.
SHA_FILE="$ROOT/buildroot.sha256"
EXPECTED_SHA=""
if [[ -f "$SHA_FILE" ]]; then
  EXPECTED_SHA="$(awk -v want="buildroot-$BUILDROOT_VERSION.tar.gz" '$2 == want { print $1; exit }' "$SHA_FILE")"
fi
if [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]]; then
  ACTUAL_SHA="$(sha256sum "$TARBALL" | awk '{print $1}')"
  if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
    echo "ERRO: SHA256 do tarball do Buildroot não confere." >&2
    echo "  arquivo:  $TARBALL" >&2
    echo "  esperado: $EXPECTED_SHA" >&2
    echo "  obtido:   $ACTUAL_SHA" >&2
    echo "Apague o arquivo e rode de novo. Se o hash continuar diferente, o" >&2
    echo "download está sendo alterado no caminho — não continue o build." >&2
    exit 2
  fi
  echo "  sha256:    OK"
else
  echo "AVISO: buildroot.sha256 não tem hash para buildroot-$BUILDROOT_VERSION" >&2
  echo "O tarball segue sem verificação de integridade." >&2
fi

if ! tar -tzf "$TARBALL" >/dev/null 2>&1; then
  echo "ERRO: tarball do Buildroot inválido: $TARBALL" >&2
  exit 2
fi

BR2_DIR="$WORK_DIR/buildroot-$BUILDROOT_VERSION"
if [[ -f "$BR2_DIR/Makefile" ]]; then
  echo "Buildroot já extraído em $BR2_DIR; reaproveitando."
else
  echo "Extraindo Buildroot..."
  tar -xzf "$TARBALL" -C "$WORK_DIR"
fi
if [[ ! -f "$BR2_DIR/Makefile" ]]; then
  echo "ERRO: diretório do Buildroot não encontrado: $BR2_DIR" >&2
  exit 2
fi

echo "Aplicando defconfig $DEFCONFIG..."
# O Buildroot 2024.02 não tem defconfig para nenhum aparelho Rockchip de
# handheld, e o antecessor resolvia isso com uma árvore BR2_EXTERNAL. Aqui o
# aparelho traz o próprio defconfig em `device/<pasta>/defconfig` e o build o
# instala no lugar onde o `make` procura. Sem árvore externa, sem caminho
# absoluto escrito à mão no fragmento.
DEVICE_DEFCONFIG="$DEVICE_DIR/defconfig"
if [[ -f "$DEVICE_DEFCONFIG" ]]; then
  cp -a "$DEVICE_DEFCONFIG" "$BR2_DIR/configs/$DEFCONFIG"
  echo "  defconfig: fornecido pelo aparelho (device/$DEVICE_FOLDER/defconfig)"
fi
if ! make -C "$BR2_DIR" O="$BUILD_DIR" "$DEFCONFIG" >"$WORK_DIR/defconfig.log" 2>&1; then
  tail -n 120 "$WORK_DIR/defconfig.log" >&2
  exit 1
fi

# Copia overlays para caminhos sem espaços, independentemente do nome
# da pasta do device (ex.: "powkiddy x55").
# O staging é RECRIADO a cada build. `cp -a origem/. destino/` copia e
# sobrescreve, mas nunca APAGA: um arquivo removido do overlay do aparelho
# continuava no staging e era aplicado de novo em target-finalize — inclusive
# sobrescrevendo um arquivo de pacote com a versão antiga.
#
# Medido: `rtl8821cs_config.bin` saiu do overlay, mas a cópia de 25 bytes do
# build anterior continuou no staging e sobrepôs o firmware oficial do
# linux-firmware, idêntico em nome e diferente em conteúdo. O sintoma seria
# "Bluetooth não funciona" com o arquivo presente — o pior tipo.
rm -rf "$OVERLAY_STAGE"
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

# O mapa de botões mora em device/<pasta>/buttons.map, mas o launcher lê
# /etc/giochi/buttons.map. Sem esta cópia o mapa existe no repositório e NÃO
# existe na imagem: o launcher cai no mapa embutido e os botões erram sem
# mensagem nenhuma — a mesma classe de falha silenciosa do assert-config.
DEVICE_BUTTONS_MAP="$DEVICE_DIR/buttons.map"
if [[ -f "$DEVICE_BUTTONS_MAP" ]]; then
  if [[ -s "$DEVICE_BUTTONS_MAP" ]]; then
    mkdir -p "$OVERLAY_STAGE/01-device/etc/giochi"
    cp -a "$DEVICE_BUTTONS_MAP" "$OVERLAY_STAGE/01-device/etc/giochi/buttons.map"
    echo "  botões:    buttons.map → /etc/giochi/buttons.map ($(wc -l <"$DEVICE_BUTTONS_MAP") linhas)"
  else
    echo "AVISO: $DEVICE_BUTTONS_MAP está vazio; o launcher usaria o mapa embutido." >&2
  fi
else
  echo "  botões:    sem buttons.map neste aparelho (launcher usa o mapa embutido)"
fi

echo "Mesclando configuração comum + device..."
# O fragmento de kernel também passa pelo staging: Buildroot trata
# BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES como lista separada por ESPAÇO, e
# `device/powkiddy x55/linux.fragment` é lido como dois caminhos. O erro que
# aparece é:
#
#   Kconfig file or fragment '/work/device/powkiddy' for 'linux' does not exist
#
# que não cita espaço nem aparelho. Mesma armadilha dos overlays.
KERNEL_FRAGMENT="$DEVICE_DIR/linux.fragment"
KERNEL_FRAGMENT_ARGS=()
if [[ -f "$KERNEL_FRAGMENT" ]]; then
  cp -a "$KERNEL_FRAGMENT" "$WORK_DIR/linux.fragment"
  KERNEL_FRAGMENT_ARGS=(--kernel-fragment "$WORK_DIR/linux.fragment")
fi

# Patches de kernel (device.json → kernelPatches). Vão para o staging pelo
# mesmo motivo dos fragmentos: BR2_LINUX_KERNEL_PATCH separa por espaço.
KERNEL_PATCH_ARGS=()
mapfile -t KERNEL_PATCHES < <(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" kernelPatches)
if [[ ${#KERNEL_PATCHES[@]} -gt 0 ]]; then
  mkdir -p "$WORK_DIR/patches"
  patch_index=0
  for kernel_patch in "${KERNEL_PATCHES[@]}"; do
    if [[ ! -e "$kernel_patch" ]]; then
      echo "ERRO: patch de kernel não encontrado: $kernel_patch" >&2
      exit 2
    fi
    if [[ -d "$kernel_patch" ]]; then
      cp -a "$kernel_patch/." "$WORK_DIR/patches/"
      KERNEL_PATCH_ARGS+=(--kernel-patch "$WORK_DIR/patches")
      echo "  patches:   $(find "$kernel_patch" -name '*.patch' | wc -l) arquivo(s) de $kernel_patch"
    else
      patch_index=$((patch_index + 1))
      cp -a "$kernel_patch" "$WORK_DIR/patches/"
      KERNEL_PATCH_ARGS+=(--kernel-patch "$WORK_DIR/patches/$(basename "$kernel_patch")")
      echo "  patch:     $(basename "$kernel_patch")"
    fi
  done
fi

# Fragmento do busybox: fica no staging (caminho sem espaços) e entra por
# BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES. Serve para desligar applet que não
# compila contra os headers do kernel do aparelho — o `tc` do busybox usa
# TCA_CBQ_*, removido no 6.12, e a falha aparece como erro de compilação numa
# linha do busybox, sem relação óbvia com a versão do kernel.
BUSYBOX_FRAGMENT="$DEVICE_DIR/busybox.fragment"
BUSYBOX_FRAGMENT_ARGS=()
if [[ -f "$BUSYBOX_FRAGMENT" ]]; then
  cp -a "$BUSYBOX_FRAGMENT" "$WORK_DIR/busybox.fragment"
  BUSYBOX_FRAGMENT_ARGS=(--busybox-fragment "$WORK_DIR/busybox.fragment")
  echo "  busybox:   fragmento do aparelho aplicado"
fi

OVERRIDE_ARGS=()
if [[ -f "$ROOT/config/package-overrides.mk" ]]; then
  OVERRIDE_ARGS=(--package-override "$ROOT/config/package-overrides.mk")
  echo "  overrides: config/package-overrides.mk"
fi

node "$ROOT/scripts/prepare-config.mjs" \
  --config "$BUILD_DIR/.config" \
  --hostname "$HOSTNAME_VALUE" \
  --issue "Giochi System - $DEVICE_NAME" \
  --root-password "$ROOT_PASSWORD" \
  --dl-dir "$BUILDROOT_DL_DIR" \
  --fragment "$ROOT/config/common.fragment" \
  --fragment "$FRAGMENT" \
  --ccache-dir "$CCACHE_ARG" \
  "${KERNEL_FRAGMENT_ARGS[@]+"${KERNEL_FRAGMENT_ARGS[@]}"}" \
  "${BUSYBOX_FRAGMENT_ARGS[@]+"${BUSYBOX_FRAGMENT_ARGS[@]}"}" \
  "${KERNEL_PATCH_ARGS[@]+"${KERNEL_PATCH_ARGS[@]}"}" \
  "${OVERRIDE_ARGS[@]+"${OVERRIDE_ARGS[@]}"}" \
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

# `assert-config` acima cobre os fragmentos BR2_*. O fragmento de KERNEL é outra
# história: se o símbolo `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` cair (porque o
# defconfig do aparelho não liga BR2_LINUX_KERNEL, por exemplo), o kernel compila
# com o defconfig da arquitetura e o hardware existe no DTS SEM funcionar —
# sem uma linha de erro ligando o sintoma à causa.
if [[ ${#KERNEL_FRAGMENT_ARGS[@]} -gt 0 ]]; then
  if ! grep -q '^BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES=.*linux\.fragment' "$BUILD_DIR/.config"; then
    echo "ERRO: linux.fragment não entrou em BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES." >&2
    echo "Sem isso o kernel sai sem painel, áudio e controles — e nada falha." >&2
    echo "Símbolos BR2_LINUX_KERNEL* no .config final:" >&2
    grep -n '^BR2_LINUX_KERNEL' "$BUILD_DIR/.config" >&2 || echo "  (nenhum)" >&2
    exit 1
  fi
fi

case "$DEVICE_ARCH" in  arm64) ARCH_SYMBOL="BR2_aarch64" ;;
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

if ((FORCE_KERNEL_REBUILD)); then
  echo "  patches:   conjunto mudou — limpando o pacote linux para reaplicar"
  make -C "$BR2_DIR" O="$BUILD_DIR" linux-dirclean >/dev/null 2>&1 || true
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
#
# `--wait` NÃO é opcional: sem ele o `setsid` faz fork e sai na hora, então
# `$!` aponta para um processo que já morreu. Resultado medido no CI: o laço de
# vigia não espera nada, o `wait` devolve status de outro processo, o build é
# declarado falho e o `build.log` fica VAZIO (o make continuava rodando solto).
SETSID_WAIT=""
if command -v setsid >/dev/null 2>&1; then
  if setsid --wait true >/dev/null 2>&1; then
    SETSID_WAIT="--wait"
  else
    echo "AVISO: setsid sem --wait; o vigia de disco pode não acompanhar." >&2
  fi
fi

if [[ -n "$SETSID_WAIT" ]]; then
  setsid "$SETSID_WAIT" make -C "$BR2_DIR" O="$BUILD_DIR" -j"$JOBS" >"$LOG_FILE" 2>&1 &
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
  echo "ERRO: build falhou (status $BUILD_STATUS)." >&2
  if [[ -s "$LOG_FILE" ]]; then
    echo "Últimas linhas do log:" >&2
    tail -n 160 "$LOG_FILE" >&2
  else
    # Log vazio = o `make` não escreveu nada. Isso separa "make falhou" de
    # "make nunca executou", que pedem correções diferentes — e sem esta
    # mensagem o CI mostra apenas um exit 1 sem contexto.
    echo "O log está VAZIO — o make não chegou a rodar." >&2
    echo "diretório de build: $BUILD_DIR" >&2
    if [[ -d "$BUILD_DIR" ]]; then
      echo "conteúdo (topo):" >&2
      ls -la "$BUILD_DIR" 2>&1 | head -15 >&2
      if [[ -f "$BUILD_DIR/.config" ]]; then
        echo ".config: presente ($(wc -l <"$BUILD_DIR/.config") linhas)" >&2
      else
        echo ".config: AUSENTE" >&2
      fi
    else
      echo "o diretório de build NÃO EXISTE" >&2
    fi
    [[ -d "$BR2_DIR" ]] && echo "buildroot: $BR2_DIR (existe)" >&2 \
                        || echo "buildroot: $BR2_DIR (AUSENTE)" >&2
    echo "make: $(command -v make || echo 'NAO ENCONTRADO NO PATH')" >&2
    echo "setsid: $(command -v setsid || echo 'ausente') ${SETSID_WAIT:-(sem --wait)}" >&2
  fi
  exit 1
fi

# Firmware obrigatório do aparelho (device/<pasta>/firmware-required.txt).
#
# O mesmo raciocínio do kernel-required.txt, aplicado a /lib/firmware: um
# arquivo ausente não impede o boot, então ninguém nota até o Wi-Fi ou o
# Bluetooth simplesmente não existirem. Medido neste repositório: o Buildroot
# 2024.02 não instala `rtl_bt/rtl8821cs_*` mesmo com o pacote de firmware
# ligado, e o sintoma foi "Bluetooth não funciona".
FIRMWARE_REQUIRED="$DEVICE_DIR/firmware-required.txt"
if [[ -f "$FIRMWARE_REQUIRED" ]]; then
  missing_firmware=()
  while IFS= read -r firmware_line; do
    firmware_line="${firmware_line%%#*}"
    firmware_line="$(printf '%s' "$firmware_line" | tr -d '[:space:]')"
    [[ -z "$firmware_line" ]] && continue
    case "$firmware_line" in
      /*|*..*)
        echo "ERRO: firmware-required.txt tem caminho inválido: $firmware_line" >&2
        exit 2
        ;;
    esac
    if [[ ! -e "$BUILD_DIR/target/lib/firmware/$firmware_line" ]]; then
      missing_firmware+=("$firmware_line")
    fi
  done <"$FIRMWARE_REQUIRED"

  if ((${#missing_firmware[@]})); then
    echo "ERRO: firmware obrigatório ausente do rootfs ($DEVICE_ID):" >&2
    printf '  - /lib/firmware/%s\n' "${missing_firmware[@]}" >&2
    echo "" >&2
    echo "A imagem bootaria e o rádio simplesmente não existiria. Se o arquivo" >&2
    echo "está no tarball do linux-firmware mas não é instalado, acrecente-o a" >&2
    echo "LINUX_FIRMWARE_FILES em config/package-overrides.mk." >&2
    exit 1
  fi
fi

# Credenciais no rootfs: o artefato do CI é público. Um `wpa_supplicant.conf`
# com `ssid=`/`psk=` dentro da imagem entrega a senha da rede de quem buildou, e
# ninguém percebe porque o arquivo "só existe no aparelho". O template que o
# Buildroot instala tem apenas `key_mgmt=NONE`, sem rede — é o que se espera.
TARGET_ETC="$BUILD_DIR/target/etc"
if [[ -f "$TARGET_ETC/wpa_supplicant.conf" ]]; then
  if grep -qE '^[[:space:]]*(ssid|psk)=' "$TARGET_ETC/wpa_supplicant.conf" 2>/dev/null; then
    echo "ERRO: $TARGET_ETC/wpa_supplicant.conf tem credencial de rede." >&2
    echo "A imagem publicada levaria a senha do Wi-Fi. Remova o arquivo do" >&2
    echo "overlay do aparelho; ele deve ser criado no aparelho, em tempo de uso" >&2
    echo "(ver docs/x55-bringup.md, seção de Wi-Fi)." >&2
    exit 1
  fi
fi
# Chave privada SSH na imagem é o mesmo problema, com dano maior.
if compgen -G "$TARGET_ETC/ssh/ssh_host_*_key" >/dev/null; then
  echo "ERRO: chave de host SSH dentro da imagem ($TARGET_ETC/ssh)." >&2
  echo "Toda imagem sairia com a mesma identidade. O sshd gera no primeiro boot." >&2
  exit 1
fi

# `assert-config` cobriu os símbolos BR2_*. Os CONFIG_* do kernel são outro
# Kconfig, resolvido por outro `olddefconfig`, e ninguém verificava o resultado:
# símbolo de painel, MMC ou console ausente gera imagem que não boota com o
# build verde. Aqui a verificação acontece com o .config que o kernel REALMENTE
# usou, não com o pedido.
KERNEL_REQUIRED="$DEVICE_DIR/kernel-required.txt"
KERNEL_REQUIRED_ARGS=()
if [[ -f "$KERNEL_REQUIRED" ]]; then
  KERNEL_REQUIRED_ARGS=(--required "$KERNEL_REQUIRED")
fi

if [[ -f "$KERNEL_FRAGMENT" || -f "$KERNEL_REQUIRED" ]]; then
  KERNEL_CONFIG="$(echo "$BUILD_DIR"/build/linux-*/.config | awk '{print $1}')"
  if [[ -f "$KERNEL_CONFIG" ]]; then
    KERNEL_FRAGMENT_ARGS_CHECK=()
    [[ -f "$KERNEL_FRAGMENT" ]] && KERNEL_FRAGMENT_ARGS_CHECK=(--fragment "$KERNEL_FRAGMENT")
    if ! node "$ROOT/scripts/assert-kernel-config.mjs" \
      --config "$KERNEL_CONFIG" \
      "${KERNEL_FRAGMENT_ARGS_CHECK[@]+"${KERNEL_FRAGMENT_ARGS_CHECK[@]}"}" \
      "${KERNEL_REQUIRED_ARGS[@]+"${KERNEL_REQUIRED_ARGS[@]}"}"; then
      echo "ERRO: o kernel não usou símbolos pedidos pelo linux.fragment." >&2
      echo "Configuração do kernel: $KERNEL_CONFIG" >&2
      exit 1
    fi
  else
    echo "AVISO: .config do kernel não encontrado em $BUILD_DIR/build/linux-*." >&2
    echo "O fragmento do kernel não pôde ser verificado." >&2
  fi
fi

echo "Coletando artefatos..."
shopt -s nullglob
copied=0
# `-L` é obrigatório: o Buildroot entrega `rootfs.ext4` como SYMLINK para
# `rootfs.ext2`. Com `cp -a` o link é copiado como link, aponta para um arquivo
# que não existe em out/ e o build "passa" com um rootfs quebrado — o erro só
# aparece no dd, na hora de gravar o cartão.
for pattern in "${ARTIFACTS[@]}"; do
  for file in "$BUILD_DIR/images/"$pattern; do
    if [[ -f "$file" ]]; then
      cp -aL "$file" "$OUT_DIR/"
      echo "  + $(basename "$file")"
      copied=$((copied + 1))
    fi
  done
done
shopt -u nullglob

# U-Boot: o Buildroot 2024.02 publica em `images/` apenas `u-boot.bin` e
# `u-boot-rockchip.bin`. `idbloader.img` e `u-boot.itb` ficam no diretório de
# build do pacote — são justamente os dois pedaços que o BootROM do RK3566 lê em
# setores fixos. Sem eles a imagem de cartão não tem firmware, e um cartão sem
# firmware não é lido pelo aparelho.
UBOOT_BUILD_DIR="$(echo "$BUILD_DIR"/build/uboot-*/ | awk '{print $1}')"
if [[ -d "$UBOOT_BUILD_DIR" ]]; then
  for uboot_artifact in idbloader.img u-boot.itb; do
    if [[ -f "$OUT_DIR/$uboot_artifact" ]]; then
      continue
    fi
    if [[ -f "$UBOOT_BUILD_DIR/$uboot_artifact" ]]; then
      cp -aL "$UBOOT_BUILD_DIR/$uboot_artifact" "$OUT_DIR/"
      echo "  + $uboot_artifact (do pacote u-boot)"
      copied=$((copied + 1))
    else
      echo "AVISO: $uboot_artifact não encontrado em $UBOOT_BUILD_DIR." >&2
      echo "Sem ele a imagem de cartão não boota (o RK3566 lê por setor fixo)." >&2
    fi
  done
fi

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

# `sha256sum *` quebra em diretório (`dtbs/`) e se inclui no próprio arquivo.
# A lista precisa ser só de arquivos regulares, sem o SHA256SUMS.
(
  cd "$OUT_DIR"
  rm -f SHA256SUMS
  find . -maxdepth 1 -type f -printf '%P\n' | sort | xargs -r sha256sum >SHA256SUMS
)

echo
echo "OK: imagem(ns) em $OUT_DIR"
ls -lh "$OUT_DIR"
