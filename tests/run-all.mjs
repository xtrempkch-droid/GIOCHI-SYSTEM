#!/usr/bin/env node
// Roda todos os testes em um único processo.
//
// Por que não `node --test tests/`: o runner do node:test spawna um processo
// por arquivo, e sob o sandbox de arquivos isso falha com `spawn EPERM`.
// Importar os arquivos aqui registra todos os testes no mesmo processo, o que
// também funciona no CI e dá a saída completa de uma vez.
import "./devices.test.mjs";
import "./device-fields.test.mjs";
import "./assert-config.test.mjs";
import "./fdt.test.mjs";
import "./buildroot-hash.test.mjs";
import "./prepare-config.test.mjs";
import "./assert-kernel-config.test.mjs";
import "./firmware-required.test.mjs";
import "./buttons-map.test.mjs";
import "./cmdline.test.mjs";
import "./device-x35h.test.mjs";
import "./device-generic-x64.test.mjs";
import "./base-system.test.mjs";
import "./boot-layer.test.mjs";
import "./giochi-init.test.mjs";
import "./launcher-deps.test.mjs";
import "./graphics-stack.test.mjs";
import "./bootlog.test.mjs";
import "./serial-tools.test.mjs";
import "./selftest-contract.test.mjs";
import "./python-libs-study.test.mjs";
import "./arcade-probe.test.mjs";
import "./dongle.test.mjs";
import "./host-compat.test.mjs";
import "./device-r35s-console.test.mjs";
import "./dsi-panel.test.mjs";
import "./gles-probe-py.test.mjs";
import "./gpu-drivers.test.mjs";
import "./device-r35s-port.test.mjs";
import "./build-device-vars.test.mjs";
import "./rk3326-legacy-boot.test.mjs";
import "./joypad-driver.test.mjs";
import "./bootsplash.test.mjs";
import "./chave-da-loja.test.mjs";
import "./godot.test.mjs";
import "./rtc-clock.test.mjs";
import "./flash-grow.test.mjs";
import "./flash-dd.test.mjs";
import "./onboard-drivers.test.mjs";
import "./runner-coverage.test.mjs";
import "./engine-deps.test.mjs";
import "./sdl2-alsa.test.mjs";
