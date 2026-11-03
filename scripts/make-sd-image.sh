#!/usr/bin/env bash
# ============================================================
# Giochi System — imagem de cartão SD a partir dos artefatos do build
# ============================================================
# Uso (precisa de root: usa loop device, mkfs e mount):
#   sudo bash scripts/make-sd-image.sh powkiddy-x55 [--size-mib N]
#   bash scripts/build-in-container.sh --sd-image powkiddy-x55
#
# Entrada: out/<device>/ com Image, dtbs, rootfs.ext4, idbloader.img, u-boot.itb
# Saída:   out/<device>/giochi-system-<device>-sd.img (+ SHA256SUMS)
#
# Layout (o mesmo do antecessor, medido no aparelho):
#
#   setor 64    (32 KiB)  idbloader.img    ← TPL + SPL (DDR init + BL31 load)
#   setor 16384 (8 MiB)   u-boot.itb       ← U-Boot próprio + ATF
#   64 MiB                p1 FAT32 256 MiB  GIOCHI_BOOT: Image, dtb, extlinux.conf, boot.scr
#   320 MiB               p2 ext4  resto    GIOCHI: rootfs
#
# Por que os offsets: o BootROM do RK3566 lê o idbloader do setor 64 e o U-Boot
# do setor 16384. Gravar só as partições — o que o build entrega hoje — gera um
# cartão que o aparelho nem tenta ler.
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_ID=""
SIZE_MIB=2048
BOOT_PART_MIB=256
BOOT_PART_START_MIB=64

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while (($#)); do
  case "$1" in
    --size-mib)
      shift
      SIZE_MIB="${1:-}"
      ;;
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
        echo "ERRO: mais de um device informado" >&2
        exit 2
      fi
      DEVICE_ID="$1"
      ;;
  esac
  shift
done

if [[ -z "$DEVICE_ID" ]]; then
  usage >&2
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERRO: esta etapa precisa de root (loop device + mount)." >&2
  echo "Use: bash scripts/build-in-container.sh --sd-image $DEVICE_ID" >&2
  exit 2
fi

for command in losetup mkfs.vfat mkfs.ext4 sfdisk mount umount mkimage dd truncate; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERRO: comando ausente: $command" >&2
    case "$command" in
      mkimage) echo "  instale u-boot-tools (é o que gera o boot.scr)" >&2 ;;
      mkfs.vfat) echo "  instale dosfstools" >&2 ;;
    esac
    exit 2
  fi
done

OUT_DIR="${GIOCHI_SYSTEM_OUT_DIR:-$ROOT/out/$DEVICE_ID}"
IMAGE="$OUT_DIR/giochi-system-$DEVICE_ID-sd.img"
FIRMWARE_DIR="$OUT_DIR/boot-firmware"

for required in Image rootfs.ext4; do
  if [[ ! -f "$OUT_DIR/$required" ]]; then
    echo "ERRO: $OUT_DIR/$required não existe." >&2
    echo "Rode o build do aparelho antes de montar a imagem de cartão." >&2
    exit 2
  fi
done

# Firmware em dois formatos aceitos, porque o Buildroot nem sempre publica os
# dois: `u-boot-rockchip.bin` é o combinado (idbloader no offset 0 e u-boot.itb
# em 8355840 bytes = 16320 setores), feito para ser escrito no setor 64 — os
# 64 setores de deslocamento põem o FIT exatamente no setor 16384. Medido nos
# artefatos reais deste build.
if [[ -f "$OUT_DIR/u-boot-rockchip.bin" ]]; then
  FIRMWARE_MODE="combined"
  FIRMWARE_FILE="$OUT_DIR/u-boot-rockchip.bin"
elif [[ -f "$OUT_DIR/idbloader.img" && -f "$OUT_DIR/u-boot.itb" ]]; then
  FIRMWARE_MODE="split"
else
  echo "ERRO: firmware do U-Boot ausente em $OUT_DIR." >&2
  echo "Esperado u-boot-rockchip.bin, ou idbloader.img + u-boot.itb." >&2
  echo "Sem firmware o RK3566 não lê o cartão: ele busca em setores fixos." >&2
  exit 2
fi

# O DTB tem de ser exatamente o do aparelho: a X35S e a X55 têm painéis
# diferentes, e um DTB trocado dá tela preta com backlight aceso.
DTB_NAME="$(node "$ROOT/scripts/device-info.mjs" "$DEVICE_ID" dts 2>/dev/null || true)"
if [[ -z "$DTB_NAME" ]]; then
  DTB_NAME="rk3566-powkiddy-x55"
fi
DTB_FILE="$OUT_DIR/dtbs/$DTB_NAME.dtb"
if [[ ! -f "$DTB_FILE" ]]; then
  # Buildroot pode deixar o DTB solto em images/ quando o nome não tem barra.
  DTB_FILE="$OUT_DIR/$DTB_NAME.dtb"
fi
if [[ ! -f "$DTB_FILE" ]]; then
  echo "ERRO: DTB não encontrado para $DEVICE_ID ($DTB_NAME.dtb)." >&2
  echo "Procurei em $OUT_DIR/dtbs e $OUT_DIR." >&2
  echo "Confira BR2_LINUX_KERNEL_INTREE_DTS_NAME no defconfig e os padrões em device.json." >&2
  exit 2
fi

# rootfs maior que o previsto não cabe no layout: melhor falhar aqui do que
# gravar e descobrir no aparelho.
ROOTFS_BYTES="$(stat -c %s "$OUT_DIR/rootfs.ext4")"
ROOTFS_MIB=$(( (ROOTFS_BYTES + 1024 * 1024 - 1) / 1024 / 1024 ))
NEEDED_MIB=$(( BOOT_PART_START_MIB + BOOT_PART_MIB + ROOTFS_MIB + 32 ))
if (( SIZE_MIB < NEEDED_MIB )); then
  echo "  imagem:  $SIZE_MIB MiB é pouco; usando $NEEDED_MIB MiB"
  SIZE_MIB="$NEEDED_MIB"
fi

echo "Giochi System — imagem de cartão"
echo "  device:  $DEVICE_ID ($DTB_NAME)"
echo "  entrada: $OUT_DIR"
echo "  imagem:  $IMAGE ($SIZE_MIB MiB)"
echo

WORK="$(mktemp -d)"
LOOP=""
BOOT_LOOP=""
ROOT_LOOP=""
MNT_BOOT="$WORK/boot"
mkdir -p "$MNT_BOOT"

cleanup() {
  set +e
  mountpoint -q "$MNT_BOOT" && umount "$MNT_BOOT"
  [[ -n "${BOOT_LOOP:-}" ]] && losetup -d "$BOOT_LOOP" 2>/dev/null
  [[ -n "${ROOT_LOOP:-}" ]] && losetup -d "$ROOT_LOOP" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

rm -f "$IMAGE"
truncate -s "${SIZE_MIB}M" "$IMAGE"

echo "Criando tabela de partições..."
# p1 começa em 64 MiB: deixa livres os setores do idbloader (64) e do u-boot.itb
# (16384), e a área onde o U-Boot grava o environment (32 MiB).
# 0x47494f43 é "GIOCHI" em ASCII: o id do disco fica reconhecível no lsblk e
# define o PARTUUID das partições de forma determinística.
DISK_ID=0x47494f43
sfdisk --quiet "$IMAGE" <<EOF
label: dos
label-id: $DISK_ID
unit: sectors

start=$(( BOOT_PART_START_MIB * 2048 )), size=$(( BOOT_PART_MIB * 2048 )), type=c, bootable
start=$(( (BOOT_PART_START_MIB + BOOT_PART_MIB) * 2048 )), type=83
EOF

# Loop devices COM OFFSET, um por partição, em vez de `losetup -P`.
#
# `losetup -P` depende do udev para criar /dev/loopNpM. Em container sem udev
# (é o caso do builder) os nós nunca aparecem e o mkfs falha com
# "unable to open /dev/loop38p1: No such file or directory" — erro que não cita
# udev. Com --offset/--sizelimit cada partição vira um device comum.
BOOT_OFFSET=$(( BOOT_PART_START_MIB * 1024 * 1024 ))
BOOT_SIZE=$(( BOOT_PART_MIB * 1024 * 1024 ))
ROOT_OFFSET=$(( BOOT_OFFSET + BOOT_SIZE ))

BOOT_LOOP="$(losetup -f --show --offset "$BOOT_OFFSET" --sizelimit "$BOOT_SIZE" "$IMAGE")"
ROOT_LOOP="$(losetup -f --show --offset "$ROOT_OFFSET" "$IMAGE")"
LOOP="$BOOT_LOOP"
echo "  loop:    $BOOT_LOOP (p1) / $ROOT_LOOP (p2)"

mkfs.vfat -n GIOCHI_BOOT "$BOOT_LOOP" >/dev/null
mkfs.ext4 -q -L GIOCHI -F "$ROOT_LOOP"

# PARTUUID do MBR segue o formato <id-do-disco>-<numero>. O id é fixado no
# sfdisk, então o valor é conhecido ANTES de formatar — não depende de blkid
# nem de udev, e não muda entre builds.
PARTUUID_P2="$(printf '%08x-02' "$DISK_ID")"
echo "  p2:      PARTUUID=$PARTUUID_P2"

# Linha de comando derivada do cartão que BOOTOU neste aparelho (log do
# antecessor preservado em ~/.cache/giochi-system/old-card). Cada parâmetro tem
# motivo medido:
#   console=ttyS2,1500000n8      UART do console é ttyS2 a 1500000, não 115200
#   earlycon=uart8250,mmio32,..  saída desde o início do kernel; sem ela, uma
#                                falha antes do console subir é silêncio total
#   fbcon=rotate:3               o painel é montado a 270°; sem isso o console
#                                aparece de cabeça para baixo
#   rootwait rw                  cartão SD enumera depois do rootfs
KERNEL_CMDLINE="root=PARTUUID=$PARTUUID_P2 rootwait rw rootfstype=ext4 console=ttyS2,1500000n8 earlycon=uart8250,mmio32,0xfe660000 fbcon=rotate:3"

echo "Gravando firmware nos offsets do RK3566..."
case "$FIRMWARE_MODE" in
  combined)
    # Contém os dois pedaços já posicionados a partir do setor 64.
    dd if="$FIRMWARE_FILE" of="$IMAGE" bs=512 seek=64 conv=notrunc status=none
    echo "  firmware: u-boot-rockchip.bin no setor 64 (idbloader + u-boot.itb)"
    ;;
  split)
    dd if="$OUT_DIR/idbloader.img" of="$IMAGE" bs=512 seek=64 conv=notrunc status=none
    dd if="$OUT_DIR/u-boot.itb" of="$IMAGE" bs=512 seek=16384 conv=notrunc status=none
    echo "  firmware: idbloader.img no setor 64, u-boot.itb no setor 16384"
    ;;
esac

echo "Populando a partição de boot..."
mount "$BOOT_LOOP" "$MNT_BOOT"
# `cp -a` NÃO funciona em FAT: o filesystem não tem dono nem permissão, e
# "failed to preserve ownership" aborta antes de copiar o kernel. `cp -L`
# dereferencia symlink e respeita só o que o FAT suporta.
cp -L "$OUT_DIR/Image" "$MNT_BOOT/Image"
mkdir -p "$MNT_BOOT/dtbs"
cp -L "$DTB_FILE" "$MNT_BOOT/dtbs/$DTB_NAME.dtb"

mkdir -p "$MNT_BOOT/extlinux"
cat >"$MNT_BOOT/extlinux/extlinux.conf" <<EOF
default giochi
menu title Giochi System

label giochi
    kernel /Image
    fdt /dtbs/$DTB_NAME.dtb
    append $KERNEL_CMDLINE
EOF

# boot.scr é para o U-Boot cujo bootcmd procura script: é o caso do U-Boot que
# está no aparelho hoje, que reclama "nenhum boot.scr legivel" e para no prompt.
# O extlinux.conf atende o U-Boot mainline com distro boot. Os dois convivem.
cat >"$WORK/boot.cmd" <<EOF
setenv bootargs $KERNEL_CMDLINE
load mmc 1:1 \${kernel_addr_r} /Image
load mmc 1:1 \${fdt_addr_r} /dtbs/$DTB_NAME.dtb
booti \${kernel_addr_r} - \${fdt_addr_r}
EOF
mkimage -C none -A arm64 -T script -d "$WORK/boot.cmd" "$MNT_BOOT/boot.scr" >/dev/null
echo "  boot:    Image, dtbs/$DTB_NAME.dtb, extlinux.conf, boot.scr"
sync
umount "$MNT_BOOT"

echo "Gravando o rootfs..."
dd if="$OUT_DIR/rootfs.ext4" of="$ROOT_LOOP" bs=4M conv=notrunc status=none
sync

sync
losetup -d "$BOOT_LOOP"
losetup -d "$ROOT_LOOP"
BOOT_LOOP=""
ROOT_LOOP=""
LOOP=""

echo
echo "Imagem pronta: $IMAGE"
ls -lh "$IMAGE"
(
  cd "$OUT_DIR"
  sha256sum "$(basename "$IMAGE")" >"$(basename "$IMAGE").sha256"
)
echo "SHA256: $(cat "$IMAGE.sha256")"

# Firmware solto também fica no out/: é o que se grava à mão quando o cartão já
# tem layout e só o U-Boot precisa ser atualizado.
mkdir -p "$FIRMWARE_DIR"
cp -aL "$OUT_DIR"/idbloader.img "$OUT_DIR"/u-boot.itb "$OUT_DIR"/u-boot-rockchip.bin \
  "$FIRMWARE_DIR/" 2>/dev/null || true

# Devolve a posse ao usuário do host quando rodou em container como root.
if [[ -n "${HOST_UID:-}" && -n "${HOST_GID:-}" ]]; then
  chown "$HOST_UID:$HOST_GID" "$IMAGE" "$IMAGE.sha256" 2>/dev/null || true
  chown -R "$HOST_UID:$HOST_GID" "$FIRMWARE_DIR" 2>/dev/null || true
fi

cat <<EOF

Para gravar no cartão (o cartão é apagado por inteiro):

  sudo dd if=$IMAGE of=/dev/sdX bs=4M conv=fsync status=progress
  sudo sync

Confira o destino com \`lsblk\` antes. Um /dev/sdX errado apaga o disco do host.
EOF
