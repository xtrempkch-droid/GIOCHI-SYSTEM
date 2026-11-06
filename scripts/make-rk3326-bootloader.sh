#!/usr/bin/env bash
# ============================================================
# Giochi System — bootloader LEGACY da Rockchip (RK3326 / PX30)
# ============================================================
# Uso:
#   bash scripts/make-rk3326-bootloader.sh <work-dir-do-build> [saida.bin]
#
# ## Por que este script existe
#
# O caminho padrão do Buildroot para Rockchip é `idbloader.img` (TPL+SPL) +
# `u-boot.itb` (FIT com BL31). Ele **funciona no RK3566** (é o que a X55 usa) e
# **não funciona no RK3326**: medido no R35S em 06/11/2026, o aparelho executa o
# TPL, o DDR, o BL31 — e trava ao saltar para o U-Boot em 0x200000, sem uma linha
# no console:
#
#   NOTICE:  BL31: v2.3():v2.3-530-g0152b20d0
#   INFO:    BL31: Preparing for EL3 exit to normal world
#   INFO:    Entry point address = 0x200000
#   INFO:    SPSR = 0x3c9
#   (silêncio; nem a 1500000 nem a 115200)
#
# Três sequências iguais em 200 s de captura eram **um boot e dois reinícios
# manuais** — não era loop de reset, era o U-Boot morrendo calado.
#
# O que a ROCKNIX faz nesta placa, e que está provado em hardware há anos, é o
# caminho **legacy**: os três blobs separados da Rockchip, montados pelo
# `rkhelper` deles:
#
#   idbloader.img   mkimage -T rksd -d <DDR> + cat <miniloader> >>
#   uboot.img       loaderimage --pack --uboot u-boot-dtb.bin 0x00200000
#   trust.img       trust_merger com BL31 em 0x00010000
#   uboot.bin       os três concatenados nos setores 0 / 16320 / 24512
#
# Os offsets 16320 e 24512 **não são redondos de propósito**: 16320 + 64 = 16384
# e 24512 + 64 = 24576, que é onde o BootROM do RK3326 procura. Gravar este
# arquivo no setor 64 do cartão reproduz o layout do fabricante.
#
# ## De onde vêm os blobs
#
# Do `rkbin` que o Buildroot já baixa (`rockchip-rkbin`). Detalhe medido: os
# arquivos `px30_*` e `rk3326_*` do rkbin são **byte-idênticos** (`md5` igual) —
# a Rockchip publica o mesmo binário com dois nomes. Usar um ou outro não muda
# nada; o que muda é o CAMINHO (legacy vs. TPL/SPL), não o nome do arquivo.
set -euo pipefail

WORK="${1:-}"
OUT="${2:-}"

if [[ -z "$WORK" ]]; then
  echo "uso: $0 <work-dir-do-build> [saida.bin]" >&2
  echo "ex.: $0 \$HOME/.cache/giochi-system/work/r35s out/r35s/u-boot-legacy.bin" >&2
  exit 2
fi

BUILD="$WORK/build"
[[ -d "$BUILD" ]] || { echo "ERRO: $BUILD não existe." >&2; exit 2; }

RKBIN="$(find "$BUILD/build" -maxdepth 1 -type d -name 'rockchip-rkbin-*' 2>/dev/null | head -1)"
UBOOT="$(find "$BUILD/build" -maxdepth 1 -type d -name 'uboot-*' 2>/dev/null | head -1)"

[[ -n "$RKBIN" ]] || { echo "ERRO: pacote rockchip-rkbin não encontrado em $BUILD/build." >&2; exit 2; }
[[ -n "$UBOOT" ]] || { echo "ERRO: pacote uboot não encontrado em $BUILD/build." >&2; exit 2; }

# Nomes dos blobs: prefere rk3326_*, cai para px30_* (são o mesmo binário).
pick() {
  for candidate in "$@"; do
    [[ -f "$RKBIN/$candidate" ]] && { echo "$RKBIN/$candidate"; return 0; }
  done
  return 1
}

DDR="$(pick bin/rk33/rk3326_ddr_333MHz_v2.08.bin bin/rk33/px30_ddr_333MHz_v2.08.bin)" || {
  echo "ERRO: blob de DDR do PX30/RK3326 não encontrado no rkbin." >&2; exit 2; }
MINILOADER="$(pick bin/rk33/rk3326_miniloader_v1.35.bin bin/rk33/px30_miniloader_v1.35.bin)" || {
  echo "ERRO: miniloader não encontrado no rkbin." >&2; exit 2; }
BL31="$(pick bin/rk33/rk3326_bl31_v1.33.elf bin/rk33/px30_bl31_v1.33.elf)" || {
  echo "ERRO: BL31 não encontrado no rkbin." >&2; exit 2; }

UBOOT_BIN="$UBOOT/u-boot-dtb.bin"
[[ -f "$UBOOT_BIN" ]] || {
  echo "ERRO: $UBOOT_BIN não existe." >&2
  echo "      O caminho legacy precisa de u-boot-dtb.bin (U-Boot + DTB concatenado)." >&2
  exit 2; }

MKIMAGE="$RKBIN/tools/mkimage"
LOADERIMAGE="$RKBIN/tools/loaderimage"
TRUST_MERGER="$RKBIN/tools/trust_merger"
for tool in "$MKIMAGE" "$LOADERIMAGE" "$TRUST_MERGER"; do
  if [[ ! -x "$tool" ]]; then
    echo "ERRO: ferramenta ausente ou sem +x: $tool" >&2
    echo "      O pacote rockchip-rkbin do Buildroot 2024.02 instala tools/." >&2
    exit 2
  fi
done

OUT="${OUT:-$WORK/u-boot-legacy.bin}"
# Resolver para ABSOLUTO antes de qualquer `cd`. O script entra em `$TMP` para
# trabalhar, e um caminho relativo passaria a apontar para dentro dele — onde o
# `trap` apaga no fim. O sintoma era o pior tipo: o `cp` reportava sucesso, o
# "-> arquivo (16777216 bytes)" aparecia, e o arquivo não existia.
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Bootloader legacy RK3326"
echo "  DDR:        $(basename "$DDR")"
echo "  miniloader: $(basename "$MINILOADER")"
echo "  BL31:       $(basename "$BL31")"
echo "  U-Boot:     $(basename "$UBOOT_BIN") ($(stat -c%s "$UBOOT_BIN") bytes)"
echo

cp "$DDR" "$MINILOADER" "$BL31" "$UBOOT_BIN" "$TMP/"
cd "$TMP"

# 1. idbloader: o mkimage empacota o init de DDR; o miniloader é concatenado
#    porque "mkimage does not support packing second level bootloader on rk3326"
#    (comentário do próprio rkhelper da ROCKNIX).
"$MKIMAGE" -n px30 -T rksd -d "$(basename "$DDR")" -C bzip2 idbloader.img
cat "$(basename "$MINILOADER")" >> idbloader.img
echo "  idbloader.img  $(stat -c%s idbloader.img) bytes"

# 2. uboot.img: U-Boot empacotado com o endereço de carga.
"$LOADERIMAGE" --pack --uboot "$(basename "$UBOOT_BIN")" uboot.img 0x00200000 >/dev/null
echo "  uboot.img      $(stat -c%s uboot.img) bytes"

# 3. trust.img: só o BL31 tem SEC=1. O endereço 0x00010000 é o do rkhelper.
cat > trust.ini <<EOF
[BL30_OPTION]
SEC=0
[BL31_OPTION]
SEC=1
PATH=$TMP/$(basename "$BL31")
ADDR=0x00010000
[BL32_OPTION]
SEC=0
[BL33_OPTION]
SEC=0
[OUTPUT]
PATH=trust.img
EOF
"$TRUST_MERGER" trust.ini >/dev/null 2>&1 || {
  echo "ERRO: trust_merger falhou." >&2; exit 1; }
echo "  trust.img      $(stat -c%s trust.img) bytes"

# 4. Concatenção nos offsets do BootROM. 16 MiB cobre os três com folga.
truncate -s 16M uboot.bin
dd if=idbloader.img of=uboot.bin bs=512 seek=0 conv=fsync,notrunc status=none
dd if=uboot.img of=uboot.bin bs=512 seek=16320 conv=fsync,notrunc status=none
dd if=trust.img of=uboot.bin bs=512 seek=24512 conv=fsync,notrunc status=none

mkdir -p "$(dirname "$OUT")"
cp uboot.bin "$OUT"
echo
echo "  -> $OUT ($(stat -c%s "$OUT") bytes)"
echo

# Conferência das três assinaturas. Se alguma não estiver onde devia, o BootROM
# simplesmente não carrega e o sintoma no aparelho é tela preta — sem mensagem.
python3 - "$OUT" <<'PY'
import pathlib, sys
data = pathlib.Path(sys.argv[1]).read_bytes()

def at(sector, size=8):
    return data[sector * 512 : sector * 512 + size]

checks = [
    ("idbloader (setor 0)", at(0, 4), None),
    ("uboot.img (setor 16320)", at(16320, 8), b"LOADER  "),
    ("trust.img (setor 24512)", at(24512, 4), b"BL3X"),
]
ok = True
for label, found, expected in checks:
    if expected is None:
        status = "presente" if any(found) else "VAZIO"
        ok = ok and any(found)
    else:
        status = "OK" if found == expected else f"DIVERGE ({found!r})"
        ok = ok and found == expected
    print(f"  {label:26} {status}")
sys.exit(0 if ok else 1)
PY
