#!/usr/bin/env bash
# ============================================================
# engine-build.sh — compila a GIOCHI-ENGINE contra o sysroot do Buildroot
# ============================================================
#
# Uso:
#   bash scripts/engine-build.sh powkiddy-x35h                 # compila
#   bash scripts/engine-build.sh powkiddy-x35h --instalar      # compila e instala
#   bash scripts/engine-build.sh powkiddy-x35h --instalar 10.55.0.2
#
# ## Por que não `cross`
#
# A GIOCHI-ENGINE tem `Cross.toml` e ele funciona — gera um AArch64 válido. O
# problema é o SDL2 que ele vincula: vem do `libsdl2-dev` AMD64 do container
# `ghcr.io/cross-rs/...`, e o artefato sai com
#
#   NEEDED  libasound.so.2  libsndio.so.7  libwayland-egl.so.1  libjack.so.0
#           libpipewire-0.3.so.0  libpulse.so.0  ...
#
# Nenhuma dessas existe numa imagem Buildroot, e o binário morre no aparelho com
# `error while loading shared libraries: libsndio.so.7`. A própria documentação
# da engine registra isso em `docs/CROSS_COMPILE.md`.
#
# ## Por que este caminho funciona, e por que ele dispensa quatro gambiarras
#
# O sysroot do Buildroot é a MESMA fonte que gerou a imagem: mesmas versões de
# glibc, SDL2 e ALSA. Compilando contra ele, o binário depende só do que o
# aparelho tem — medido:
#
#   NEEDED  libSDL2_image-2.0.so.0  libSDL2_mixer-2.0.so.0  libSDL2-2.0.so.0
#           libgcc_s.so.1  libc.so.6
#
# E resolve, de graça, as quatro coisas que `docs/CROSS_COMPILE.md` manda copiar
# à mão quando se usa o `aarch64-linux-gnu-gcc` do Ubuntu:
#
#   | eles copiam                       | por que aqui não é preciso          |
#   | libgcc_s.so.1                     | o sysroot do Buildroot já tem       |
#   | Scrt1.o / crti.o / crtn.o         | o gcc do Buildroot é driver cc      |
#   | --dynamic-linker explícito        | o gcc do toolchain já passa o certo |
#   | libc/libm do aparelho (glibc 2.38)| o sysroot é glibc 2.38, a mesma     |
#
# A raiz do problema deles é o gcc do Ubuntu trazer sysroot glibc 2.35 contra um
# aparelho com 2.38. Trocando o linker para o do Buildroot, os quatro somem.
#
# ## Pré-requisitos que este script NÃO instala
#
#   - `work/<device>` construído (o sysroot vem dele). Sem isso, rode o build.
#   - o repositório da engine clonado ao lado, ou em GIOCHI_ENGINE_DIR.
#
# Se faltar `SDL2_mixer.pc` no sysroot, o erro cita pkg-config e o crate
# `sdl2-sys` — nunca a imagem. A causa é `BR2_PACKAGE_SDL2_MIXER` ausente no
# defconfig (§12.16 e `tests/engine-deps.test.mjs`).

set -euo pipefail

DEVICE="${1:-}"
shift || true
INSTALAR=0
HOST_IP="10.55.0.2"

while [ $# -gt 0 ]; do
    case "$1" in
        --instalar) INSTALAR=1; shift
                    if [ $# -gt 0 ] && [[ "${1:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                        HOST_IP="$1"; shift
                    fi ;;
        *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
    esac
done

if [ -z "$DEVICE" ]; then
    sed -n '2,12p' "$0"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${GIOCHI_SYSTEM_WORK_DIR:-$HOME/.cache/giochi-system/work}/$DEVICE"
ENGINE="${GIOCHI_ENGINE_DIR:-$REPO_ROOT/../giochi-engine}"

[ -d "$WORK/build/host/aarch64-buildroot-linux-gnu/sysroot" ] || {
    echo "ERRO: sysroot do $DEVICE não existe em $WORK" >&2
    echo "      O sysroot vem do build. Rode primeiro:" >&2
    echo "      ALLOW_DRAFT=1 bash scripts/build-device.sh $DEVICE" >&2
    exit 1
}

[ -f "$ENGINE/Cargo.toml" ] || {
    echo "ERRO: engine não encontrada em $ENGINE" >&2
    echo "      Clone ao lado do repositório, ou aponte GIOCHI_ENGINE_DIR:" >&2
    echo "      git clone https://github.com/xtrempkch-droid/GIOCHI-ENGINE \"$REPO_ROOT/../giochi-engine\"" >&2
    exit 1
}

SYSROOT="$WORK/build/host/aarch64-buildroot-linux-gnu/sysroot"

# O linker do Buildroot é o ponto inteiro deste script: ele carrega o próprio
# sysroot por padrão, então não há `--sysroot` nem `--dynamic-linker` para passar
# à mão, e o `-lgcc_s`/`crt*.o` aparecem sozinhos.
LINKER=""
for c in "$WORK"/build/host/bin/*-buildroot-linux-gnu-gcc; do
    [ -x "$c" ] && LINKER="$c" && break
done
[ -n "$LINKER" ] || { echo "ERRO: nenhum *-buildroot-linux-gnu-gcc em $WORK/build/host/bin" >&2; exit 1; }

# Falha cedo e com a mensagem certa se faltar .pc — o erro do cargo aponta para
# pkg-config e para o crate, e a causa está no defconfig.
FALTANDO=""
for m in sdl2 SDL2_image SDL2_mixer SDL2_ttf alsa; do
    [ -f "$SYSROOT/usr/lib/pkgconfig/$m.pc" ] || FALTANDO="$FALTANDO $m"
done
if [ -n "$FALTANDO" ]; then
    echo "ERRO: .pc ausente(s) no sysroot:$FALTANDO" >&2
    echo "      Isto é defconfig, não pkg-config. Verifique no defconfig do" >&2
    echo "      aparelho: BR2_PACKAGE_SDL2_MIXER, BR2_PACKAGE_SDL2_TTF," >&2
    echo "      BR2_PACKAGE_SDL2_IMAGE e BR2_PACKAGE_ALSA_LIB." >&2
    echo "      Depois disto o sysroot precisa ser reconstruído para o pacote" >&2
    echo "      novo aparecer (Buildroot não reconfigura árvore existente)." >&2
    exit 1
fi

echo "engine:  $ENGINE"
echo "sysroot: $SYSROOT"
echo "linker:  $LINKER"

# `PKG_CONFIG_SYSROOT_DIR` prefixa os caminhos dos .pc com o sysroot;
# `PKG_CONFIG_LIBDIR` (não `PKG_CONFIG_PATH`) SUBSTITUI a busca padrão, que é o
# que impede o `.pc` do Ubuntu de responder. Com `PATH`, o do sistema ainda
# ganharia — é a armadilha do §12.54.
export PKG_CONFIG_ALLOW_CROSS=1
export PKG_CONFIG_SYSROOT_DIR="$SYSROOT"
export PKG_CONFIG_LIBDIR="$SYSROOT/usr/lib/pkgconfig:$SYSROOT/usr/share/pkgconfig"
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="$LINKER"

cd "$ENGINE"
# `--no-default-features --features sdl2-system` desliga o SDL2 `bundled` (que
# compila um SDL2 próprio, com backends de desktop) e usa o do sysroot.
cargo build --release --target aarch64-unknown-linux-gnu \
      --no-default-features --features sdl2-system

BIN="target/aarch64-unknown-linux-gnu/release/giochi-demo"
[ -x "$BIN" ] || { echo "ERRO: binário não gerado em $BIN" >&2; exit 1; }

# Confere a ABI antes de instalar. Um binário ligado na .so errada passa por
# `file` ("ELF aarch64 válido") e morre no aparelho sem mensagem útil.
echo
echo "=== ABI do binário ==="
file -b "$BIN" | cut -d, -f1-3
readelf -l "$BIN" | grep -q "ld-linux-aarch64.so.1" \
    || { echo "ERRO: sem PT_INTERP para ld-linux-aarch64.so.1 — não vai executar" >&2; exit 1; }
echo "NEEDED:"
readelf -d "$BIN" | grep NEEDED | sed 's/.*\[/  /;s/\]//'

# A lista de NEEDED tem de ser subconjunto do que a imagem tem. Backends de
# desktop (sndio, wayland, jack, pulse, pipewire) indicam que o SDL2 errado foi
# vinculado — sinal de que PKG_CONFIG_LIBDIR não pegou.
SUSPEITAS=$(readelf -d "$BIN" | grep NEEDED | grep -oE "lib(sndio|wayland|jack|pulse|pipewire)[^]]*" || true)
if [ -n "$SUSPEITAS" ]; then
    echo >&2
    echo "ERRO: o binário pede backend de desktop, que não existe na imagem:" >&2
    echo "$SUSPEITAS" | sed 's/^/  /' >&2
    echo "      O SDL2 errado foi vinculado (provavelmente o do cross ou do host)." >&2
    exit 1
fi

echo
echo "OK: $ENGINE/$BIN"

if [ "$INSTALAR" -eq 0 ]; then
    echo "Para instalar no aparelho: $0 $DEVICE --instalar $HOST_IP"
    exit 0
fi

echo
echo "=== instalando em root@$HOST_IP ==="
scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$BIN" "root@$HOST_IP:/tmp/giochi-demo" || {
    echo "ERRO: scp falhou — o aparelho está em $HOST_IP com sshd de pé?" >&2
    echo "      O sistema base sobe usb0 em 10.55.0.2 (docs/sistema-base.md)." >&2
    exit 1
}
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "root@$HOST_IP" \
    'chmod +x /tmp/giochi-demo && echo "instalado em /tmp/giochi-demo"'
