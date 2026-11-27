#!/bin/sh
# giochi-system:help:begin
# discos.sh — achar a partição de BOOT. Função compartilhada.
#
# Existe para que a técnica fique em UM lugar. Ela já existia dentro do
# `giochi-bootlog`, e o `S09bootpart` precisava da mesma coisa — duas cópias
# divergem na primeira correção (§12.49).
#
# ## Por que achar POR CONTEÚDO e não por rótulo
#
# O `mount` do busybox não resolve `LABEL=`/`PARTUUID=`/`UUID=` sem
# `CONFIG_FEATURE_MOUNT_LABEL` (§12.28, medido: a string vai crua para o kernel
# e ele responde ENODEV). O conteúdo é um marcador que não depende de applet, de
# util-linux nem do nome que o driver deu ao device — que muda entre
# mmcblk0/mmcblk1/sda:
#
#     extlinux/extlinux.conf   ou   boot.scr
#
# Se o arquivo está lá, é a partição de boot. Não há ambiguidade.
# giochi-system:help:end

# Imprime o caminho da partição de boot do cartão que bootou, ou nada.
#
# A ORDEM importa, e o `giochi-bootlog` aprendeu isso no X35H: o kernel expõe
# DOIS cartões, e a eMMC interna pode ter um `extlinux/` de OUTRA instalação.
# A preferência é a partição 1 do disco que contém o rootfs em uso.
giochi_boot_preferida() {
    root_dev=$(awk '$2 == "/" {print $1; exit}' /proc/mounts 2>/dev/null)
    if [ -n "$root_dev" ] && [ -e "$root_dev" ]; then
        root_real=$(readlink -f "$root_dev" 2>/dev/null)
        [ -n "$root_real" ] && root_dev="$root_real"
    fi
    # `/proc/mounts` diz `/dev/root`, que é ALIAS criado a partir do `root=` da
    # cmdline, não o nome real. O major:minor de /proc/self/mountinfo casa com
    # /sys/dev/block/<maj:min>, que dá o nome de verdade.
    if [ "$root_dev" = "/dev/root" ] || [ ! -e "$root_dev" ]; then
        mm=$(awk '$5 == "/" {print $3; exit}' /proc/self/mountinfo 2>/dev/null)
        if [ -n "$mm" ]; then
            nome=$(basename "$(readlink -f "/sys/dev/block/$mm" 2>/dev/null)")
            [ -n "$nome" ] && root_dev="/dev/$nome"
        fi
    fi
    case "$root_dev" in
        /dev/mmcblk*p*) printf '%sp1\n' "${root_dev%p*}" ;;
        /dev/mmcblk*)   printf '%sp1\n' "$root_dev" ;;
        /dev/sd*[0-9])  printf '%s\n' "${root_dev%[0-9]}1" ;;
        /dev/vd*[0-9])  printf '%s\n' "${root_dev%[0-9]}1" ;;
        *)              printf '\n' ;;
    esac
}

# Verdadeiro se $1 é uma partição de boot (tem o marcador).
giochi_e_particao_de_boot() {
    [ -f "$1/extlinux/extlinux.conf" ] || [ -f "$1/boot.scr" ]
}

# Monta a partição de boot em $1 (padrão /boot).
#
# Dois caminhos:
#   1. já existe um vfat montado com o marcador? usa esse ponto — tentar montar
#      por cima falha com "already mounted or mount point busy", que não diz o
#      motivo (§12.28);
#   2. senão, tenta os candidatos e VALIDA PELO CONTEÚDO.
#
# Devolve 0 e imprime o ponto de montagem. Nunca desmonta o que não montou.
giochi_montar_boot() {
    destino="${1:-/boot}"

    for ponto in $(awk '$3 == "vfat" {print $2}' /proc/mounts 2>/dev/null); do
        if giochi_e_particao_de_boot "$ponto"; then
            printf '%s\n' "$ponto"
            return 0
        fi
    done

    mkdir -p "$destino" 2>/dev/null || return 1

    preferida="$(giochi_boot_preferida)"
    candidatos=""
    [ -n "$preferida" ] && candidatos="$preferida"
    for d in /dev/mmcblk*p1 /dev/sd*1 /dev/vd*1; do
        [ -e "$d" ] || continue
        case " $candidatos " in *" $d "*) continue ;; esac
        candidatos="$candidatos $d"
    done

    for dev in $candidatos; do
        if ! mount -t vfat "$dev" "$destino" 2>/dev/null; then
            continue
        fi
        if giochi_e_particao_de_boot "$destino"; then
            printf '%s\n' "$destino"
            return 0
        fi
        # Montou mas não é a de boot: desmonta e tenta o próximo. Aqui pode,
        # porque fomos nós que montamos.
        umount "$destino" 2>/dev/null
    done
    return 1
}
