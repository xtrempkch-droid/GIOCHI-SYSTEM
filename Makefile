DEVICE ?= qemu-aarch64

.PHONY: check validate devices matrix test build build-container build-draft clean

# Audita o host antes do primeiro build (não instala nada, não precisa de root).
check:
	bash scripts/check-host.sh

validate:
	node scripts/validate-devices.mjs

devices:
	node scripts/list-devices.mjs

matrix:
	node scripts/list-devices.mjs --github-matrix

test:
	node tests/run-all.mjs

build:
	bash scripts/build-device.sh $(DEVICE)

# Mesmo build, sem exigir as dependências do Buildroot no host.
build-container:
	bash scripts/build-in-container.sh $(DEVICE)

# Device draft: o defconfig existe, mas a imagem nunca bootou.
build-draft:
	ALLOW_DRAFT=1 bash scripts/build-device.sh $(DEVICE)

clean:
	rm -rf out work .cache
