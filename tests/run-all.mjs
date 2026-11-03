#!/usr/bin/env node
// Roda todos os testes em um único processo.
//
// Por que não `node --test tests/`: o runner do node:test spawna um processo
// por arquivo, e sob o sandbox de arquivos isso falha com `spawn EPERM`.
// Importar os arquivos aqui registra todos os testes no mesmo processo, o que
// também funciona no CI e dá a saída completa de uma vez.
import "./devices.test.mjs";
import "./assert-config.test.mjs";
import "./fdt.test.mjs";
import "./buildroot-hash.test.mjs";
import "./prepare-config.test.mjs";
import "./assert-kernel-config.test.mjs";
import "./firmware-required.test.mjs";
import "./buttons-map.test.mjs";
import "./cmdline.test.mjs";
import "./device-x35h.test.mjs";
import "./base-system.test.mjs";
import "./boot-layer.test.mjs";
import "./launcher-deps.test.mjs";
import "./bootlog.test.mjs";
import "./dongle.test.mjs";
import "./host-compat.test.mjs";
