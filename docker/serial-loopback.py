#!/usr/bin/env python3
"""Teste de loopback: o que eu escrevo volta?

Separa duas coisas que parecem iguais quando o console está ruim:

  * "o adaptador está bom"   -> escrevo e VOLTA o que escrevi
  * "o caminho até o aparelho está bom" -> volta o que O APARELHO diz

Medido no R35S em 04/11/2026: voltaram **0 bytes** de um envio de 25. Isso
descartou a hipótese "o ruído que aparece é eco do meu Enter" — o ruído vinha de
outro lugar (nível elétrico), não de retorno do que eu transmitia.

Para usar como teste do ADAPTADOR, ligue TX em RX no próprio adaptador (sem o
aparelho). Com o aparelho conectado, o esperado é NÃO haver eco exato: o
aparelho pode responder outra coisa, mas raramente repete os 25 bytes.

Uso: serial-loopback.py <porta> [baud...]
"""
import sys
import time

import serial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
bauds = [int(b) for b in sys.argv[2:]] or [1500000, 115200]
teste = b"GIOCHI-TESTE-0123456789\r\n"

print(f"Loopback em {port}, {len(teste)} bytes por baud")
print("Para testar o ADAPTADOR, ligue TX em RX nele e desconecte o aparelho.")
print()

falhas = 0
for baud in bauds:
    try:
        with serial.Serial(port, baud, timeout=1.0) as link:
            link.reset_input_buffer()
            link.reset_output_buffer()
            time.sleep(0.2)
            link.reset_input_buffer()
            link.write(teste)
            link.flush()
            eco = link.read(len(teste) + 64)
    except Exception as exc:  # noqa: BLE001
        print(f"  {baud:>8}: ERRO {type(exc).__name__}: {str(exc)[:70]}")
        falhas += 1
        continue

    if eco == teste:
        print(f"  {baud:>8}: ECO EXATO — adaptador/driver escutando a si mesmo")
    elif eco:
        print(f"  {baud:>8}: voltou {len(eco)}B, diferente do enviado")
        print(f"             hex: {eco[:48].hex()}")
        # Algo voltou: a linha TEM caminho. Vale olhar o conteúdo.
    else:
        print(f"  {baud:>8}: nada voltou — sem caminho de volta (ou sem loopback)")
        falhas += 1

print()
if falhas == len(bauds):
    print("Nenhum baud devolveu eco. Sem loopback físico no adaptador, isto é o")
    print("esperado — não é defeito. Para testar o adaptador, ligue TX em RX.")
else:
    print("Houve retorno em ao menos um baud: a linha tem caminho de volta.")
