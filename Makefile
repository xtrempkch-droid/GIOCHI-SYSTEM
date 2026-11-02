DEVICE ?= qemu-aarch64

.PHONY: validate devices matrix test build clean

validate:
	node scripts/validate-devices.mjs

devices:
	node scripts/list-devices.mjs

matrix:
	node scripts/list-devices.mjs --github-matrix

test:
	node tests/devices.test.mjs

build:
	bash scripts/build-device.sh $(DEVICE)

clean:
	rm -rf out work .cache
