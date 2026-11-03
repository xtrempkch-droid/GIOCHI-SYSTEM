#!/usr/bin/env node
// Gera o `rtl8821cs_config.bin` que o driver `btrtl` procura.
//
// Por que existe, em vez de commitar só o binário: o arquivo é binário de 25
// bytes sem documentação, e um blob que ninguém sabe explicar vira lenda. Aqui
// o formato está escrito em código, o conteúdo é verificável e o teste compara
// o arquivo versionado com o que este script produz.
//
// Formato, lido do kernel (drivers/bluetooth/btrtl.c e btrtl.h):
//
//   struct rtl_vendor_config {        // cabeçalho, 6 bytes
//           __le32 signature;         // 0x8723ab55 (RTL_CONFIG_MAGIC)
//           __le16 total_len;         // tamanho de todos os entries
//           __u8   entry[];
//   };
//   struct rtl_vendor_config_entry {  // 3 bytes + data
//           __le16 offset;            // 0x0c = configuração de UART
//           __u8   len;
//           __u8   data[];
//   };
//
// Para `offset = 0x0c` o driver interpreta:
//   data[0..3]  baudrate do dispositivo em LE32, traduzido por
//               btrtl_convert_baudrate() (0x0252c014 → 115200, sem mudança)
//   data[12]    BIT(2) liga controle de fluxo (4 fios); desligado = 3 fios
//
// Sem este arquivo o driver para em "no UART config entry found" e o `hci0`
// não é criado.
//
// Uso:
//   node scripts/gen-rtl8821cs-config.mjs                 # escreve no device
//   node scripts/gen-rtl8821cs-config.mjs --stdout        # imprime o hex
//   node scripts/gen-rtl8821cs-config.mjs --flow-control  # 4 fios
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(
  ROOT,
  "device/powkiddy x55/rootfs-overlay/lib/firmware/rtl_bt/rtl8821cs_config.bin",
);

const RTL_CONFIG_MAGIC = 0x8723ab55;
const UART_CONFIG_OFFSET = 0x0c;
// 0x0252c014 → btrtl_convert_baudrate() devolve 115200, ou seja: não reprograma
// a UART. Reprogramar aqui exigiria que o controlador UART do SoC e o chip
// concordassem, e o sintoma de erro é uma UART morta no meio do download.
const DEVICE_BAUDRATE = 0x0252c014;

export function buildConfig({ flowControl = false } = {}) {
  const data = Buffer.alloc(16, 0);
  data.writeUInt32LE(DEVICE_BAUDRATE, 0);
  if (flowControl) {
    data[12] |= 0x04;
  }

  const entry = Buffer.alloc(3 + data.length);
  entry.writeUInt16LE(UART_CONFIG_OFFSET, 0);
  entry.writeUInt8(data.length, 2);
  data.copy(entry, 3);

  const header = Buffer.alloc(6);
  header.writeUInt32LE(RTL_CONFIG_MAGIC, 0);
  header.writeUInt16LE(entry.length, 4);

  return Buffer.concat([header, entry]);
}

// Só age quando executado direto: o teste importa `buildConfig` e, sem esta
// guarda, importar o módulo reescreveria o arquivo do usuário.
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const args = isMain ? process.argv.slice(2) : ["--noop"];

if (!isMain) {
  // Importado como módulo: exporta buildConfig e não toca em disco.
} else if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Uso: node scripts/gen-rtl8821cs-config.mjs [--stdout] [--flow-control] [--out <caminho>]",
  );
  process.exit(0);
} else {
const flowControl = args.includes("--flow-control");
const blob = buildConfig({ flowControl });

if (args.includes("--stdout")) {
  console.log(blob.toString("hex"));
  process.exit(0);
}

const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_OUT;
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, blob);
console.log(
  `${outPath}: ${blob.length} bytes (${flowControl ? "4 fios" : "3 fios"}, baud 115200)`,
);
}
