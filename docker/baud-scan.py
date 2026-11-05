#!/usr/bin/env python3
"""Varre bauds numa porta serial e diz o que chegou em cada um.

Existe porque o console do R35S (RK3326/PX30) não tem baud documentado nesta
árvore, e chutar um só desperdiça a janela em que o aparelho está falando. Se o
baud estiver errado os bytes chegam como ruído — e ruído AINDA é informação: a
proporção de bytes altos, o comprimento das sequências e a presença de padrões
repetidos distinguem "linha muda" de "linha falando noutra velocidade".

Para cada baud ele:
  1. abre a porta, descarta o que estava no buffer;
  2. manda um \r (o getty e o U-Boot acordam com Enter);
  3. escuta N segundos;
  4. imprime contagem, proporção de ASCII imprimível e um recorte em hexa.

Uso: baud-scan.py <porta> <segundos_por_baud> [baud...]
"""
import sys
import time

import serial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
segundos = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
bauds = [int(b) for b in sys.argv[3:]] or [1500000, 115200, 921600, 57600]

IMPRIMIVEL = set(range(0x20, 0x7F)) | {0x0A, 0x0D, 0x09}


def classifica(dados: bytes) -> str:
    if not dados:
        return "MUDO"
    imprimiveis = sum(1 for b in dados if b in IMPRIMIVEL)
    fracao = imprimiveis / len(dados)
    # Baud errado não gera ruído aleatório puro: gera bytes de valor alto e
    # repetições, porque a amostragem cai no meio dos bits.
    if fracao > 0.90:
        return "TEXTO"
    if fracao > 0.50:
        return "MISTO (texto + lixo)"
    return "RUIDO (baud provavelmente errado)"


def hexdump(dados: bytes, limite: int = 160) -> str:
    recorte = dados[:limite]
    linhas = []
    for inicio in range(0, len(recorte), 16):
        bloco = recorte[inicio : inicio + 16]
        hexa = " ".join(f"{b:02x}" for b in bloco)
        ascii_ = "".join(chr(b) if b in IMPRIMIVEL and b >= 0x20 else "." for b in bloco)
        linhas.append(f"    {inicio:04x}  {hexa:<47}  {ascii_}")
    if len(dados) > limite:
        linhas.append(f"    ... (+{len(dados) - limite} bytes)")
    return "\n".join(linhas)


print(f"Porta: {port} | {segundos}s por baud | bauds: {bauds}")
print()

resultado = {}
for baud in bauds:
    print(f"=== {baud} baud ===")
    try:
        with serial.Serial(port, baud, timeout=0.3) as link:
            link.reset_input_buffer()
            link.write(b"\r")
            link.flush()
            inicio = time.monotonic()
            dados = bytearray()
            while time.monotonic() - inicio < segundos:
                pedaco = link.read(4096)
                if pedaco:
                    dados += pedaco
            dados = bytes(dados)
    except Exception as exc:  # noqa: BLE001
        print(f"  ERRO ao abrir: {type(exc).__name__}: {exc}")
        print()
        continue

    veredito = classifica(dados)
    resultado[baud] = (len(dados), veredito)
    print(f"  bytes: {len(dados)} | {veredito}")
    if dados:
        print(hexdump(dados))
    print()

print("=== resumo ===")
for baud, (n, veredito) in resultado.items():
    print(f"  {baud:>8}  {n:>6} bytes  {veredito}")

uteis = [b for b, (n, v) in resultado.items() if n > 0 and v.startswith(("TEXTO", "MISTO"))]
if uteis:
    print(f"\nBaud com texto legivel: {uteis}")
elif any(n > 0 for n, _ in resultado.values()):
    print("\nHouve bytes, mas nenhum baud produziu texto — a linha esta falando;")
    print("o candidato mais provavel e o baud que deu MAIS bytes.")
else:
    print("\nNada em nenhum baud. A linha esta muda (aparelho desligado, sem")
    print("console habilitado, ou TX/RX trocados).")
