# Overrides de pacote do Buildroot (BR2_PACKAGE_OVERRIDE_FILE)
# ============================================================
# Este arquivo é incluído depois das receitas de pacote, então dá para
# acrescentar opções sem editar a árvore do Buildroot nem carregar patch.
#
# Ele existe porque um pacote do Buildroot 2024.02 não compila contra os
# headers do kernel 6.12 — e a falha aparece longe da causa.

# ── strace 6.7 ───────────────────────────────────────────────
# Com `BR2_KERNEL_HEADERS_AS_KERNEL=y` e kernel 6.12, o strace 6.7 morre numa
# static assertion do próprio código:
#
#   macros.h:141: error: static assertion failed:
#   "Unexpected size of sysoff.rsv (sizeof(unsigned int) * 3 expected)."
#
# A struct `ptp_sys_offset` mudou no 6.11, e a cópia que o strace 6.7 tem dos
# uapi headers não sabe disso. O próprio upstream aponta a saída:
# `--enable-bundled=yes` faz o strace usar os headers que ele traz, em vez dos
# do toolchain.
#
# Escolha consciente: manter o kernel e os headers em 6.12 (o aparelho precisa
# dos headers certos para o próprio kernel) e deixar o strace isolado. A
# alternativa — rebaixar o toolchain para headers 6.6 — arrasta a toolchain
# inteira e não resolve a causa, só a esconde.
#
# ORDEM DE INCLUSÃO — leia antes de trocar `override` por `+=`:
# o Buildroot inclui este arquivo ANTES de `package/*/*.mk` (Makefile, ~linha
# 530). A receita faz `STRACE_CONF_OPTS = --enable-mpers=no` e uma atribuição
# normal apaga qualquer `+=` feito aqui — sem aviso, e o build volta a falhar
# igual. `override` protege a variável, ao custo de precisar repetir as opções
# padrão da receita. Features opcionais (libunwind/libiberty) estão desligadas
# em todos os devices deste repositório; se um dia ligarem, ajuste aqui.
override STRACE_CONF_OPTS = --enable-mpers=no --enable-bundled=yes \
	--without-libunwind --without-libiberty

# ── linux-firmware: RTL8821CS (Bluetooth por UART) ───────────
# O Buildroot 2024.02 lista, em BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT, os
# arquivos rtl8821a_* e rtl8821c_* — mas OMITE rtl8821cs_*, que estão no MESMO
# tarball (linux-firmware-20240115):
#
#   linux-firmware-20240115/rtl_bt/rtl8821cs_fw.bin      56 KB
#   linux-firmware-20240115/rtl_bt/rtl8821cs_config.bin  25 B
#
# Sem eles o driver btrtl para em
#   "RTL: firmware file rtl_bt/rtl8821cs_fw not found"
# e o hci0 não nasce. O sintoma aparece como "Bluetooth não funciona", e o
# pacote de firmware parece completo — nada diz que faltou arquivo.
#
# `LINUX_FIRMWARE_FILES` é montada com `+=` em linux-firmware.mk, e este arquivo
# é incluído ANTES das receitas (Makefile, ~linha 530), então o acréscimo soma à
# lista em vez de ser apagado. Conferir com:
#   make -p -n | grep '^LINUX_FIRMWARE_FILES'
#
# CONDICIONAL, e tem de continuar assim: este arquivo vale para TODOS os
# aparelhos. A X35H não tem o RTL8821CS populado e o defconfig dela desliga
# `BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT` de propósito. Um `+=` incondicional
# colocava os dois blobs no rootfs dela mesmo assim — 56 KB de firmware para um
# chip que não existe, contradizendo o que o defconfig declara. Buildroot expõe
# os símbolos `BR2_*` como variáveis de make, então a condição é a mesma do menu.
ifeq ($(BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT),y)
LINUX_FIRMWARE_FILES += rtl_bt/rtl8821cs_fw.bin rtl_bt/rtl8821cs_config.bin
endif

# ── linux-firmware: firmware do dongle MT7601U ──────────────
# O Buildroot 2024.02 não expõe opção para `mediatek/mt7601u.bin`, mas o
# arquivo ESTÁ no mesmo tarball (linux-firmware-20240115). Sem ele o driver
# `mt7601u` carrega, falha ao pedir o firmware e o dongle fica morto:
#
#   mt7601u 1-1.1:1.0: Direct firmware load for mediatek/mt7601u.bin failed
#
# É o dongle MediaTek mais barato e comum. ~40 KB — cabe em qualquer imagem.
#
# CONDICIONAL a existir linux-firmware, não ao aparelho: diferente do RTL8821CS
# (onboard, só na X55), o dongle é hardware FORNECIDO PELO USUÁRIO. A imagem é
# gravada uma vez; o dongle chega depois. Se o firmware não estiver lá, o
# usuário não tem como resolver sem recompilar.
ifeq ($(BR2_PACKAGE_LINUX_FIRMWARE),y)
LINUX_FIRMWARE_FILES += mediatek/mt7601u.bin
endif
