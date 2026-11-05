#!/usr/bin/env python3
"""Escuta a serial por muito tempo, cutucando com Enter, e grava tudo.

Feito para linha ruim: o burst pode vir em qualquer momento, e um burst de 20
bytes a cada minuto não aparece numa janela de 4 segundos. Ele:

  * grava TODOS os bytes CRUS num .bin, e o texto num .log — o .bin é a prova.
    `errors="replace"` num log de texto transforma 0xFF em EF BF BD e a
    evidência do ruído some; foi medido: 47 bytes crus viraram 4 caracteres de
    substituição e 35 zeros, e o padrão que identifica linha flutuante se perdeu;
  * manda \\r a cada intervalo (o getty e o U-Boot acordam com Enter);
  * separa o que é texto legível do que é ruído, sem descartar nada;
  * no fim, imprime o resumo e o hexa de cada bloco.

Uso: serial-listen.py <porta> <baud> <segundos> <arquivo> [intervalo_enter]
"""
import sys
import time

import serial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 1500000
segundos = float(sys.argv[3]) if len(sys.argv) > 3 else 60
path = sys.argv[4] if len(sys.argv) > 4 else "/work/log/serial.log"
enter_a_cada = float(sys.argv[5]) if len(sys.argv) > 5 else 3.0

IMPRIMIVEL = set(range(0x20, 0x7F)) | {0x0A, 0x0D, 0x09}
blocos = []

print(f"Escutando {port} a {baud} baud por {segundos:.0f}s (Enter a cada {enter_a_cada:.0f}s)")
print(f"Log: {path}")
print("Ligue/reinicie o aparelho agora se ele estiver desligado.")
print()

bin_path = path[:-4] + ".bin" if path.endswith(".log") else path + ".bin"
print(f"Bytes crus: {bin_path}")
print()

inicio = time.monotonic()
with serial.Serial(port, baud, timeout=0.2) as link, open(
    path, "a", encoding="utf-8", errors="replace"
) as log, open(bin_path, "ab") as cru:
    log.write(
        f"\n=== {time.strftime('%Y-%m-%dT%H:%M:%S%z')} escuta a {baud} baud "
        f"por {segundos:.0f}s ===\n"
    )
    log.flush()
    link.reset_input_buffer()
    proximo_enter = inicio
    ultimo_bloco = None

    while time.monotonic() - inicio < segundos:
        agora = time.monotonic()
        if agora >= proximo_enter:
            link.write(b"\r")
            link.flush()
            proximo_enter = agora + enter_a_cada

        pedaco = link.read(4096)
        if not pedaco:
            continue

        t = time.monotonic() - inicio
        blocos.append((t, pedaco))
        cru.write(pedaco)   # evidência, sem decodificar
        cru.flush()
        texto = pedaco.decode("utf-8", "replace")
        log.write(texto)
        log.flush()
        print(f"  [{t:6.2f}s] {len(pedaco)} bytes")
        ultimo_bloco = t

print()
if not blocos:
    print("RESULTADO: nenhum byte em toda a janela.")
    print("  A linha esta muda. Possibilidades, em ordem:")
    print("   1. aparelho desligado, ou sem console habilitado no U-Boot")
    print("   2. baud muito diferente — rode baud-scan.py para varrer")
    print("   3. TX/RX trocados, ou GND solto (o sintoma e exatamente este:")
    print("      burst curto de vez em quando, nada entre eles)")
    sys.exit(1)

total = sum(len(d) for _, d in blocos)
print(f"RESULTADO: {total} bytes em {len(blocos)} bloco(s)")

for t, dados in blocos:
    legivel = sum(1 for b in dados if b in IMPRIMIVEL) / len(dados)
    tipo = "TEXTO" if legivel > 0.90 else ("MISTO" if legivel > 0.5 else "RUIDO")
    print(f"\n  --- bloco em {t:.2f}s: {len(dados)} bytes, {tipo} ---")
    # Hexa dos bytes CRUS: é o padrão que identifica a causa.
    for off in range(0, min(len(dados), 256), 16):
        bloco_hex = dados[off : off + 16]
        hexa = " ".join(f"{b:02x}" for b in bloco_hex)
        ascii_ = "".join(
            chr(b) if b in IMPRIMIVEL and b >= 0x20 else "." for b in bloco_hex
        )
        print(f"    {off:04x}  {hexa:<47}  {ascii_}")
    if len(dados) > 256:
        print(f"    ... (+{len(dados) - 256} bytes, ver {path})")
