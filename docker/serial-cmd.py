#!/usr/bin/env python3
"""Entra no shell por serial e roda um comando, devolvendo só a saída dele.

Feito para o caso "o aparelho bootou e eu preciso ler o diagnóstico sem estar
na frente dele". Diferente do serial-listen (que só escuta), aqui:

  * espera o prompt de login aparecer, em vez de dormir um tempo fixo;
  * manda a senha só depois de ver "login:", porque o getty descarta o que chega
    antes (medido: senha digitada cedo vira eco no prompt e login falha);
  * marca o fim da saída com um sentinela único, para não depender de timeout
    adivinhando quando o comando terminou;
  * imprime o que veio DEPOIS do sentinela de início, tirando o eco do pseudotty.

Uso: serial-cmd.py <porta> <baud> <senha> <comando> [segundos]
"""
import sys
import time

import serial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 1500000
senha = sys.argv[3] if len(sys.argv) > 3 else "giochi-dev"
comando = sys.argv[4] if len(sys.argv) > 4 else "uname -a"
limite = float(sys.argv[5]) if len(sys.argv) > 5 else 45.0

MARCA_INI = b"@@GIOCHI-INICIO@@"
MARCA_FIM = b"@@GIOCHI-FIM@@"

s = serial.Serial(port, baud, timeout=0.3)
buf = bytearray()
inicio = time.monotonic()


def ler(segundos):
    """Lê por N segundos acumulando em buf. Devolve os bytes novos."""
    fim = time.monotonic() + segundos
    novos = bytearray()
    while time.monotonic() < fim:
        d = s.read(4096)
        if d:
            buf.extend(d)
            novos.extend(d)
    return bytes(novos)


def esperar(agulha, segundos):
    """Espera a agulha aparecer na saída acumulada."""
    fim = time.monotonic() + segundos
    while time.monotonic() < fim:
        ler(0.3)
        if agulha in bytes(buf):
            return True
    return False


# 1. Acordar o console. Dois casos reais, e o script tem de aceitar os dois:
#    - getty pedindo login;
#    - sessão JÁ aberta, com o prompt `#` na tela (acontece quando o comando
#      anterior deixou o shell vivo). Exigir "login:" aqui fazia o script
#      desistir com a sessão aberta na frente dele.
s.write(b"\r")
if not esperar(b"login:", 5.0):
    if b"#" in bytes(buf)[-200:]:
        ja_logado = True
    else:
        s.write(b"\r")
        if not esperar(b"login:", 10.0):
            print("ERRO: prompt de login nao apareceu", file=sys.stderr)
            print(bytes(buf)[-800:].decode("utf-8", "replace"), file=sys.stderr)
            sys.exit(2)
        ja_logado = False
else:
    ja_logado = False

if not ja_logado:

    # 2. USUÁRIO primeiro. Mandar a senha logo depois de "login:" a coloca no
    # campo de usuário, o getty pede "Password:" e o login falha — medido no
    # R35S em 06/11/2026, e o erro parecia "senha errada".
    time.sleep(0.3)
    s.write(b"root\r")
    if not esperar(b"Password:", 8.0):
        print("ERRO: o getty nao pediu senha", file=sys.stderr)
        print(bytes(buf)[-800:].decode("utf-8", "replace"), file=sys.stderr)
        sys.exit(2)

    time.sleep(0.3)
    s.write(senha.encode() + b"\r")

    # 3. o shell chegou? '#' é o prompt de root no busybox.
    if not esperar(b"#", 20.0):
        print("ERRO: login falhou (a senha esta certa?)", file=sys.stderr)
        print(bytes(buf)[-800:].decode("utf-8", "replace"), file=sys.stderr)
        sys.exit(3)

time.sleep(0.3)
# 4. rodar o comando entre sentinelas
s.write(b"echo " + MARCA_INI + b"; " + comando.encode() + b"; echo " + MARCA_FIM + b"\r")

if not esperar(MARCA_FIM, limite):
    print("AVISO: o comando não terminou no limite; mostrando o que veio",
          file=sys.stderr)

bruto = bytes(buf)
pos_ini = bruto.rfind(MARCA_INI)
pos_fim = bruto.rfind(MARCA_FIM)
if pos_ini < 0:
    print("ERRO: sentinela de início não apareceu", file=sys.stderr)
    print(bruto[-2000:].decode("utf-8", "replace"), file=sys.stderr)
    sys.exit(4)

corpo = bruto[pos_ini + len(MARCA_INI): pos_fim if pos_fim > pos_ini else len(bruto)]

# O pseudotty ecoa o que mandamos: a primeira linha do corpo é o próprio comando.
linhas = corpo.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n").split("\n")
if linhas and ("echo" in linhas[0] or "GIOCHI" in linhas[0]):
    linhas = linhas[1:]
print("\n".join(linhas).strip())
s.close()
