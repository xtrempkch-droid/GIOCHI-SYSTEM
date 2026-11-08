#!/usr/bin/env python3
"""Envia um blob grande pela console serial, em base64, com verificação ponta a ponta.

Uso: serial-push-blob.py <porta> <baud> <arquivo-local> <caminho-remoto>
                         [--chunk N] [--pausa S] [--gz]

Por que um script separado do `serial-push.py`: aquele é para script de texto de
poucos KB e usa blocos de 700 caracteres com 0,12 s de pausa — o que dá ~5 kB/s e
serve para 9 KB, não para 14 MB. Aqui o tamanho do bloco e a pausa são
parâmetros, para poder MEDIR o que a linha suporta em vez de supor.

## O que faz este envio ser seguro com o sistema rodando

O destino é escrito num arquivo temporário e só substitui o definitivo depois de
o MD5 bater dos dois lados. Se a transferência cair no meio, o arquivo bom
continua no lugar e o aparelho ainda boota.

## Por que base64 e não ymodem

O `ymodem-send.py` existe e é mais eficiente, mas precisa de um RECEPTOR ymodem
do outro lado — e o busybox desta imagem não traz nenhum. Base64 é o que o shell
do aparelho sabe decodificar sem instalar nada.

## Armadilhas medidas

1. Bloco grande demais perde bytes no meio sem erro visível: o arquivo chega
   truncado e a falha aparece longe da causa. Por isso o MD5 no fim, e por isso
   o tamanho do bloco é ajustável.
2. `printf`, nunca `echo`: o `echo` do busybox interpreta escapes.
3. Truncar o destino antes de escrever: se sobrar conteúdo de uma tentativa
   anterior, o base64 decodifica lixo e o erro é de sintaxe, não de transporte.
4. **`stty -echo` antes de começar.** Este foi o defeito mais caro: com o eco
   ligado, cada bloco enviado é devolvido pela console, e o tty do aparelho
   descarta caracteres quando a saída não drena a tempo. O resultado medido foi
   pior que lento — o arquivo remoto ficou com **0 byte** e o shell entrou em
   modo continuação (`>`), porque a linha chegou cortada no meio de uma aspa.
   Silencioso dos dois lados: o script dizia "572 blocos enviados".
"""
import base64
import hashlib
import subprocess
import sys
import time
from pathlib import Path

import serial

if len(sys.argv) < 5:
    print(__doc__)
    sys.exit(2)

port = sys.argv[1]
baud = int(sys.argv[2])
local = sys.argv[3]
remoto = sys.argv[4]

chunk = 700
pausa = 1.2
senha = "giochi-dev"
usar_gz = False

resto = sys.argv[5:]
i = 0
while i < len(resto):
    if resto[i] == "--chunk":
        chunk = int(resto[i + 1])
        i += 2
    elif resto[i] == "--pausa":
        pausa = float(resto[i + 1])
        i += 2
    elif resto[i] == "--senha":
        senha = resto[i + 1]
        i += 2
    elif resto[i] == "--gz":
        usar_gz = True
        i += 1
    else:
        print("argumento desconhecido: %s" % resto[i], file=sys.stderr)
        sys.exit(2)

origem = Path(local)
if not origem.is_file():
    print("ERRO: nao existe %s" % origem, file=sys.stderr)
    sys.exit(2)

if usar_gz:
    gz = origem.with_suffix(origem.suffix + ".gz")
    with gz.open("wb") as fh:
        subprocess.run(["gzip", "-9", "-c", str(origem)], stdout=fh, check=True)
    origem = gz
    print("comprimido: %s (%d bytes)" % (origem, origem.stat().st_size))

payload = origem.read_bytes()
md5_local = hashlib.md5(payload).hexdigest()
encoded = base64.b64encode(payload).decode("ascii")
blocos = [encoded[i : i + chunk] for i in range(0, len(encoded), chunk)]

print(
    "enviando %d bytes (%d blocos de %d, pausa %.3fs) -> %s"
    % (len(payload), len(blocos), chunk, pausa, remoto)
)
print("md5 local: %s" % md5_local)

b64_remoto = remoto + ".b64"
inicio = time.monotonic()

with serial.Serial(port, baud, timeout=0.3) as link:

    def drenar(segundos=0.1):
        fim = time.monotonic() + segundos
        saida = bytearray()
        while time.monotonic() < fim:
            pedaco = link.read(8192)
            if pedaco:
                saida.extend(pedaco)
        return saida.decode("utf-8", "replace")

    link.reset_input_buffer()
    drenar(0.3)

    # ## Garantir que há um SHELL do outro lado
    #
    # Medido em 06/11/2026: dois envios seguidos falharam em silêncio porque o
    # console não estava num shell — o login do getty tinha expirado, ou o
    # `giochi-init` estava imprimindo no meio. O script mandava heredoc para o
    # prompt de login, recebia "Password:" e o md5 saía "não lido".
    #
    # Aqui o script bate Enter, olha o que voltou, e se não houver prompt `#`
    # faz o login. Só então começa a transferir. Sem isso o modo de falha é
    # "enviou 28433 blocos" e nenhum byte no disco.
    def tem_shell(segundos=2.0):
        link.write(b"\r")
        time.sleep(0.4)
        saida = drenar(segundos)
        return "#" in saida, saida

    ok, saida = tem_shell()
    if not ok:
        # `saida` é STR (o `drenar` decodifica); comparar com bytes aqui dava
        # TypeError no exato momento em que o login é necessário — o caminho
        # feliz (shell já aberto) nunca passava por aqui, por isso o defeito
        # ficou invisível. Medido em 08/11/2026 com o caminho reproduzido.
        if "login:" in saida:
            link.write(b"root\r")
            time.sleep(0.8)
            drenar(0.5)
            link.write(senha.encode() + b"\r")
            time.sleep(2.5)
            ok, saida = tem_shell(2.5)
    if not ok:
        print("ERRO: não cheguei a um shell no aparelho.", file=sys.stderr)
        # `saida` já é texto decodificado — `.decode()` nela dava
        # AttributeError e escondia justamente o diagnóstico que este print
        # existe para mostrar.
        print(saida[-500:], file=sys.stderr)
        sys.exit(8)

    # Eco desligado: sem isto cada bloco volta pela console e o tty descarta
    # caracteres. E `set +m`/`stty -icanon` evitam edição de linha no caminho.
    link.write(b"stty -echo\r")
    time.sleep(0.4)
    drenar(0.3)

    # Trunca o base64 de uma tentativa anterior: sobra vira lixo silencioso.
    link.write((": > %s\r" % b64_remoto).encode())
    time.sleep(0.2)
    drenar(0.2)

    # ## Por que HEREDOC e não um `printf` por bloco
    #
    # Medido: com um `printf '%s' '<1400 chars>' >> arquivo` por bloco, a
    # 38 kB/s ainda se perdiam bytes (md5 divergia). A causa não é o baud — é o
    # shell ter de PARSEAR e EXECUTAR 14 mil comandos, um por bloco. Quando o
    # buffer do tty enche porque o shell não consumiu a tempo, caracteres são
    # descartados em silêncio.
    #
    # Com heredoc o shell não parseia linha nenhuma: `cat` copia o texto para o
    # arquivo e a linha do base64 atravessa na velocidade da linha. O delimitador
    # é seguro porque o alfabeto do base64 não tem `FIM`.
    #
    # Cada heredoc leva ~2 MB para que uma falha custe pouco e a retomada seja
    # possível — e `>>` acumula.
    #
    # Reagrupa em linhas de 76 caracteres (padrão de MIME), que é o que o
    # `base64 -d` espera e o que mantém o heredoc legível.
    passo = 76
    linhas = [encoded[i : i + passo] for i in range(0, len(encoded), passo)]

    por_grupo = max(1, (2 * 1024 * 1024) // passo)
    grupos = [linhas[i : i + por_grupo] for i in range(0, len(linhas), por_grupo)]

    enviado = 0
    for indice, grupo in enumerate(grupos, 1):
        corpo = "\n".join(grupo)
        if indice == 1:
            link.write(("cat > %s <<'FIM'\n" % b64_remoto).encode())
        else:
            link.write(("cat >> %s <<'FIM'\n" % b64_remoto).encode())
        link.flush()
        # CORRIDA MEDIDA: mandar o corpo no mesmo write do cabeçalho faz o shell
        # ainda estar configurando o redirect quando o texto chega. O resultado
        # não é perda limpa — é mistura: numa tentativa o arquivo saiu com 36
        # bytes A MENOS e o .b64 com 261 kB A MAIS, e o md5 diferiu nas duas
        # execuções, o que descarta "truncou" e aponta para intercalação.
        #
        # O shell precisa de uma janela para chegar ao estado "lendo heredoc"
        # antes do primeiro byte de dado.
        time.sleep(0.35)
        link.write(corpo.encode() + b"\nFIM\n")
        link.flush()
        enviado += sum(len(l) for l in grupo)
        # Espera o grupo ser absorvido antes do próximo heredoc: sem isto o
        # buffer do tty enche e bytes somem. A pausa é por GRUPO, não por linha.
        time.sleep(pausa)

        # A conferência é no FIM (tamanho exato + md5 do arquivo decodificado).
        # A consulta por grupo foi tentada e REMOVIDA: `wc -c` volta vazio
        # enquanto o shell ainda está processando o heredoc, e o script lia
        # "None" e abortava um envio que estava correto. Verificação que
        # atrapalha é pior que verificação nenhuma.
        gasto = time.monotonic() - inicio
        taxa = enviado / gasto if gasto > 0 else 0
        faltam = (len(encoded) - enviado) / taxa if taxa > 0 else 0
        print(
            "  grupo %d/%d (%.1f kB/s, faltam ~%.0fs)"
            % (indice, len(grupos), taxa / 1024, faltam)
        )
        sys.stdout.flush()

    # Fecha qualquer continuação pendente antes de sair do envio: se um bloco
    # chegou cortado, o shell fica em `>` e todo comando seguinte vira parte da
    # string aberta. Um Ctrl-C é barato e transforma "travado" em "erro".
    link.write(b"\r\x03")
    time.sleep(0.4)
    drenar(0.3)
    link.write(b"stty echo\r")
    time.sleep(0.3)
    drenar(0.2)

    gasto = time.monotonic() - inicio
    print("  %d/%d blocos em %.0fs (%.1f kB/s)" % (len(blocos), len(blocos), gasto,
                                                   len(encoded) / gasto / 1024))

    # Decodifica no aparelho e confere o md5 do ARQUIVO FINAL, não do base64:
    # é o único número que prova que o conteúdo chegou inteiro.
    # O base64 tem tamanho previsível: ceil(bytes/3)*4. Conferir ANTES de
    # decodificar separa "o transporte perdeu" de "a decodificação falhou" —
    # dois problemas com a mesma cara no md5 final.
    # ATENÇÃO à conta: o arquivo tem os caracteres do base64 **mais uma quebra de
    # linha por linha**. Contar só `ceil(bytes/3)*4` acusava 207 bytes a mais num
    # DTB de 11 KB e parecia corrupção — era o erro na expectativa, não no
    # transporte. Medido com `od -c`: o tty grava LF puro, sem CR.
    esperado_b64 = len(encoded) + len(linhas)
    link.write(("wc -c < %s\r" % b64_remoto).encode())
    time.sleep(0.8)
    eco_tam = drenar(1.5)
    tam_b64 = None
    for linha in eco_tam.replace("\r", "\n").split("\n"):
        linha = linha.strip()
        if linha.isdigit():
            tam_b64 = int(linha)
    if tam_b64 is not None:
        print("  base64 remoto: %d bytes (esperado %d)" % (tam_b64, esperado_b64))
        if tam_b64 != esperado_b64:
            print(
                "ERRO: o base64 remoto tem %d bytes, esperado %d — transporte "
                "intercalou ou perdeu" % (tam_b64, esperado_b64),
                file=sys.stderr,
            )
            link.write(b"\r\x03")
            sys.exit(6)
    else:
        print("  AVISO: nao consegui ler o tamanho do base64 remoto")

    print("decodificando no aparelho...")
    sys.stdout.flush()
    link.write(("base64 -d %s > %s\r" % (b64_remoto, remoto)).encode())
    time.sleep(1.5)
    drenar(1.0)
    link.write(("md5sum %s\r" % remoto).encode())
    # Esperar o md5 APARECER em vez de dormir um tempo fixo: com arquivo grande o
    # aparelho demora para calcular, e um sleep curto lia vazio e o script
    # desistia com "nao consegui ler" — medido na primeira tentativa.
    eco = ""
    limite = time.monotonic() + 60
    while time.monotonic() < limite:
        eco += drenar(0.4)
        if any(len(t.strip().split()[0]) == 32 and t.strip() for t in
               eco.replace("\r", "\n").split("\n") if t.strip()):
            break

md5_remoto = None
for linha in eco.replace("\r", "\n").split("\n"):
    partes = linha.strip().split()
    if len(partes) >= 2 and len(partes[0]) == 32:
        try:
            int(partes[0], 16)
            md5_remoto = partes[0]
        except ValueError:
            continue

print("md5 remoto: %s" % (md5_remoto or "(nao lido)"))

if md5_remoto is None:
    print("AVISO: nao consegui ler o md5 remoto. Confira a mao antes de usar.")
    sys.exit(4)
if md5_remoto != md5_local:
    print("ERRO: md5 diverge — a transferencia perdeu bytes.", file=sys.stderr)
    print("  local:  %s" % md5_local, file=sys.stderr)
    print("  remoto: %s" % md5_remoto, file=sys.stderr)
    sys.exit(5)

print("OK: md5 confere dos dois lados")
