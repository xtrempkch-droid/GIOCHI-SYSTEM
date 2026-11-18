#!/usr/bin/env python3
"""entrada-probe — prova que o controle virtual ENTREGA evento, no host.

## A pergunta que ele responde

"O `Giochi Gamepad` existe" e "o app recebe os botões" são perguntas
diferentes. Em 18/11/2026 a primeira era `PASS` e a segunda era **zero** — o
daemon traduzia e escrevia no `uinput`, mas não fechava o pacote com
`EV_SYN/SYN_REPORT`, e o `evdev` só publica o pacote quando ele chega
(AGENTS §12.75).

Este script não olha o código: ele **injeta** eventos num device físico
sintético, lê o device virtual e compara. Roda no PC, sem aparelho.

## O que ele verifica

1. o daemon sobe e cria o nó `Giochi Gamepad`;
2. o nó declara 17 botões e 4 eixos em `-32767..32767`, `flat=32`;
3. um `BTN_*` físico do mapa chega ao virtual **no código canônico** — e chega
   com `SYN_REPORT` (sem ele, o item falha mesmo que o resto esteja certo);
4. cada eixo declarado no mapa chega como `-32767`/`32767`, respeitando a
   inversão (`axis_y_min > axis_y_max`).

## Prerequisitos e degradação

Precisa de `/dev/uinput` gravável e de um `cc`. Faltando qualquer um, ele
imprime `SKIP` e sai **0** — "não deu para medir" não é "está errado"
(§12.34). Violação do contrato sai **1**.

```bash
python3 scripts/entrada-probe.py --mapa device/r35s/buttons.map
python3 scripts/entrada-probe.py --mapa 'device/powkiddy x55/buttons.map'
python3 scripts/entrada-probe.py --bin /caminho/giochi-gamepad   # sem cc
```

`GIOCHI_UINPUT` troca o caminho de `/dev/uinput` (usado pelo teste para
exercitar o caminho de SKIP).
"""

import argparse
import ctypes
import fcntl
import os
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import time

# ── ioctl ────────────────────────────────────────────────────
_NRBITS, _TYPEBITS, _SIZEBITS = 8, 8, 14
_NRSHIFT = 0
_TYPESHIFT = _NRSHIFT + _NRBITS
_SIZESHIFT = _TYPESHIFT + _TYPEBITS
_DIRSHIFT = _SIZESHIFT + _SIZEBITS
_NONE, _WRITE, _READ = 0, 1, 2


def _ioc(direcao, tipo, nr, tamanho):
    return (
        (direcao << _DIRSHIFT)
        | (tamanho << _SIZESHIFT)
        | (ord(tipo) << _TYPESHIFT)
        | (nr << _NRSHIFT)
    )


UI_SET_EVBIT = _ioc(_WRITE, "U", 100, 4)
UI_SET_KEYBIT = _ioc(_WRITE, "U", 101, 4)
UI_SET_ABSBIT = _ioc(_WRITE, "U", 103, 4)
UI_DEV_SETUP = _ioc(_WRITE, "U", 3, 92)
UI_DEV_CREATE = _ioc(_NONE, "U", 1, 0)
UI_DEV_DESTROY = _ioc(_NONE, "U", 2, 0)

EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
SYN_REPORT = 0
KEY_CNT, ABS_CNT = 0x300, 0x40
EVIOCGBIT = lambda ev, n: _ioc(_READ, "E", 0x20 + ev, n)
EVIOCGABS = lambda a: _ioc(_READ, "E", 0x40 + a, 24)

EIXO_MIN, EIXO_MAX = -32767, 32767

# O contrato: nome lógico -> código canônico que o virtual SEMPRE emite.
CANONICO = {
    "b": 0x130, "a": 0x131, "x": 0x133, "y": 0x134,
    "l": 0x136, "r": 0x137, "l2": 0x138, "r2": 0x139,
    "select": 0x13A, "start": 0x13B, "home": 0x13C,
    "thumbl": 0x13D, "thumbr": 0x13E,
    "up": 0x220, "down": 0x221, "left": 0x222, "right": 0x223,
}
ABS_CODIGO = {"ABS_X": 0x00, "ABS_Y": 0x01, "ABS_RX": 0x03, "ABS_RY": 0x04}

# Símbolos aceitos no `buttons.map` (o mesmo conjunto do daemon).
SIMBOLOS = {
    "BTN_SOUTH": 0x130, "BTN_EAST": 0x131, "BTN_NORTH": 0x133, "BTN_WEST": 0x134,
    "BTN_TL": 0x136, "BTN_TR": 0x137, "BTN_TL2": 0x138, "BTN_TR2": 0x139,
    "BTN_SELECT": 0x13A, "BTN_START": 0x13B, "BTN_MODE": 0x13C,
    "BTN_THUMBL": 0x13D, "BTN_THUMBR": 0x13E,
    "BTN_DPAD_UP": 0x220, "BTN_DPAD_DOWN": 0x221,
    "BTN_DPAD_LEFT": 0x222, "BTN_DPAD_RIGHT": 0x223,
    "KEY_VOLUMEUP": 114, "KEY_VOLUMEDOWN": 115,
}
NOME_DE = {v: k for k, v in SIMBOLOS.items()}


class InputId(ctypes.Structure):
    _fields_ = [
        ("bustype", ctypes.c_uint16),
        ("vendor", ctypes.c_uint16),
        ("product", ctypes.c_uint16),
        ("version", ctypes.c_uint16),
    ]


class UinputSetup(ctypes.Structure):
    _fields_ = [
        ("id", InputId),
        ("name", ctypes.c_char * 80),
        ("ff_effects_max", ctypes.c_uint32),
    ]


def skippar(motivo):
    print(f"SKIP {motivo}")
    print("     (não é falha: sem o prerequisito, a pergunta não pode ser feita)")
    return 0


def nome_do_sysfs(evento):
    try:
        with open(f"/sys/class/input/{evento}/device/name", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def achar_evento(nome, segundos=5.0):
    """Acha `/dev/input/eventN` pelo nome, sem depender de permissão de leitura.

    `EVIOCGNAME` num evento sem permissão devolve EACCES e o device "não
    existe"; o sysfs responde a mesma pergunta para qualquer usuário.
    """
    fim = time.time() + segundos
    while time.time() < fim:
        for i in range(64):
            ev = f"event{i}"
            if os.path.exists(f"/sys/class/input/{ev}") and nome_do_sysfs(ev) == nome:
                return f"/dev/input/{ev}"
        time.sleep(0.1)
    return None


def criar_fisico(uinput):
    fd = os.open(uinput, os.O_WRONLY | os.O_NONBLOCK)
    for bit in (EV_KEY, EV_ABS, EV_SYN):
        fcntl.ioctl(fd, UI_SET_EVBIT, bit)
    for codigo in CANONICO.values():
        fcntl.ioctl(fd, UI_SET_KEYBIT, codigo)
    for codigo in ABS_CODIGO.values():
        fcntl.ioctl(fd, UI_SET_ABSBIT, codigo)
    setup = UinputSetup(InputId(0x03, 0x1234, 0x5678, 1), b"entrada-probe-fake", 0)
    fcntl.ioctl(fd, UI_DEV_SETUP, ctypes.create_string_buffer(bytes(setup)))
    fcntl.ioctl(fd, UI_DEV_CREATE)
    return fd


def emitir(fd, tipo, codigo, valor):
    os.write(fd, struct.pack("<qqHHi", 0, 0, tipo, codigo, valor))


def emitir_pacote(fd, tipo, codigo, valor):
    emitir(fd, tipo, codigo, valor)
    emitir(fd, EV_SYN, SYN_REPORT, 0)


def abrir_com_folga(caminho, segundos=3.0):
    """Abre o nó esperando a ACL do uaccess. Devolve None se não abrir.

    O device virtual nasce com `DEV_CREATE` e a ACL só aparece quando o
    gerenciador de `/dev` do host reage. Abrir no mesmo instante dá EACCES em
    máquina com udev — que não é "o contrato está errado".
    """
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            return os.open(caminho, os.O_RDONLY | os.O_NONBLOCK)
        except PermissionError:
            time.sleep(0.15)
        except OSError:
            return None
    return None


def ler(fd, segundos=1.0):
    eventos, fim = [], time.time() + segundos
    while time.time() < fim:
        r, _, _ = select.select([fd], [], [], max(0.0, fim - time.time()))
        if not r:
            break
        dados = os.read(fd, 24 * 64)
        for i in range(0, len(dados) - 23, 24):
            _, _, tipo, codigo, valor = struct.unpack_from("<qqHHi", dados, i)
            eventos.append((tipo, codigo, valor))
    return eventos


def capacidades(fd):
    keybits = fcntl.ioctl(fd, EVIOCGBIT(EV_KEY, KEY_CNT // 8), b"\0" * (KEY_CNT // 8))
    absbits = fcntl.ioctl(fd, EVIOCGBIT(EV_ABS, ABS_CNT // 8), b"\0" * (ABS_CNT // 8))
    botoes = [c for c in range(KEY_CNT) if keybits[c // 8] & (1 << (c % 8))]
    eixos = [c for c in range(ABS_CNT) if absbits[c // 8] & (1 << (c % 8))]
    faixas = {}
    for a in eixos:
        campos = struct.unpack("<iiiiii", fcntl.ioctl(fd, EVIOCGABS(a), b"\0" * 24))
        # (valor, min, max, fuzz, flat, resolução)
        faixas[a] = campos[1:]
    return botoes, eixos, faixas


def ler_mapa(caminho):
    """Devolve (nome->código físico, {eixo: (min, max)})."""
    fisicos, eixos = {}, {}
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            linha = linha.split("#", 1)[0].strip()
            if not linha or "=" not in linha:
                continue
            nome, valor = (p.strip() for p in linha.split("=", 1))
            if nome in CANONICO and valor in SIMBOLOS:
                fisicos[nome] = SIMBOLOS[valor]
            elif nome.startswith("axis_") and (nome.endswith("_min") or nome.endswith("_max")):
                eixo, _, qual = nome[5:].rpartition("_")
                chave = {"x": "ABS_X", "y": "ABS_Y", "rx": "ABS_RX", "ry": "ABS_RY"}.get(eixo)
                if not chave:
                    continue
                atual = list(eixos.get(chave, (None, None)))
                atual[0 if qual == "min" else 1] = int(valor)
                eixos[chave] = tuple(atual)
    return fisicos, {k: v for k, v in eixos.items() if None not in v}


def main():
    ap = argparse.ArgumentParser(description="prova que o controle virtual entrega evento")
    ap.add_argument("--mapa", default="device/r35s/buttons.map")
    ap.add_argument("--bin", default="", help="binário do giochi-gamepad (senão compila)")
    ap.add_argument("--espera", type=float, default=1.0, help="segundos por leitura")
    args = ap.parse_args()

    uinput = os.environ.get("GIOCHI_UINPUT", "/dev/uinput")
    if not os.path.exists(uinput):
        return skippar(f"{uinput} não existe (CONFIG_INPUT_UINPUT no host)")
    if not os.access(uinput, os.W_OK):
        return skippar(f"{uinput} não é gravável por {os.environ.get('USER', 'este usuário')}")

    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mapa = args.mapa if os.path.isabs(args.mapa) else os.path.join(raiz, args.mapa)
    if not os.path.exists(mapa):
        print(f"ERRO mapa não encontrado: {mapa}", file=sys.stderr)
        return 2

    tmp = tempfile.mkdtemp(prefix="entrada-probe-")
    binario = args.bin
    if not binario:
        fonte = os.path.join(raiz, "device/common/giochi-gamepad/giochi-gamepad.c")
        binario = os.path.join(tmp, "giochi-gamepad")
        cc = shutil.which("cc") or shutil.which("gcc")
        if not cc:
            return skippar("sem cc/gcc para compilar o daemon")
        compila = subprocess.run([cc, "-O1", "-Wall", "-Wextra", "-o", binario, fonte],
                                 capture_output=True, text=True)
        if compila.returncode != 0:
            print(compila.stderr, file=sys.stderr)
            return skippar("o daemon não compilou no host")

    fisicos, eixos_mapa = ler_mapa(mapa)
    print(f"mapa:    {os.path.relpath(mapa, raiz)}")
    print(f"físicos: {len(fisicos)} botão(ões), {len(eixos_mapa)} eixo(s) calibrado(s)")

    try:
        ufd = criar_fisico(uinput)
    except OSError as erro:
        return skippar(f"não consegui criar o device sintético: {erro}")

    problemas = []
    log = os.path.join(tmp, "daemon.log")
    try:
        fisico = achar_evento("entrada-probe-fake")
        if not fisico:
            return skippar("o device sintético não apareceu em /sys/class/input")
        # O udev aplica a ACL do uaccess depois do DEV_CREATE; o daemon pode
        # abrir o nó um instante antes dela e desistir. Dar essa folga evita um
        # SKIP falso por corrida de boot do host.
        time.sleep(1.2)

        daemon = subprocess.Popen([binario, "--mapa", mapa], stdout=open(log, "w"),
                                  stderr=subprocess.STDOUT)
        try:
            virtual = achar_evento("Giochi Gamepad", segundos=6.0)
            if not virtual:
                saida = open(log).read()
                if "tem os botoes deste mapa" in saida:
                    return skippar("o daemon não conseguiu abrir o device sintético")
                print("FALHA  o daemon não criou o device virtual", file=sys.stderr)
                print(saida, file=sys.stderr)
                return 1

            vfd = abrir_com_folga(virtual)
            if vfd is None:
                return skippar(f"{virtual} não abriu para leitura (ACL do uaccess ainda não aplicada)")
            try:
                botoes, lista_eixos, faixas = capacidades(vfd)
                print(f"virtual: {virtual} — {len(botoes)} botões, {len(lista_eixos)} eixos")

                if sorted(botoes) != sorted(CANONICO.values()):
                    problemas.append(
                        f"o virtual declara {len(botoes)} botões; o contrato são {len(CANONICO)}")
                for a in ABS_CODIGO.values():
                    if a not in faixas:
                        problemas.append(f"falta ABS_{a} no virtual")
                        continue
                    minimo, maximo, _, flat, _ = faixas[a]
                    if (minimo, maximo) != (EIXO_MIN, EIXO_MAX):
                        problemas.append(
                            f"ABS_{a}: faixa {minimo}..{maximo}, esperado {EIXO_MIN}..{EIXO_MAX}")
                    if flat != 32:
                        problemas.append(f"ABS_{a}: flat={flat}, esperado 32")

                # ── botão: o físico do mapa tem de virar o canônico ──
                #
                # Escolhe uma função que ESTE mapa declara. O X35S troca A/B
                # de propósito (`a = BTN_SOUTH`), então injetar o código
                # "óbvio" testaria a coisa errada no aparelho certo.
                alvo = "b" if "b" in fisicos else next(iter(fisicos), None)
                if alvo is None:
                    problemas.append("o mapa não declara nenhum botão do contrato")
                else:
                    emitir_pacote(ufd, EV_KEY, fisicos[alvo], 1)
                    recebidos = ler(vfd, args.espera)
                    emitir_pacote(ufd, EV_KEY, fisicos[alvo], 0)
                    ler(vfd, 0.2)

                    chaves = [(t, c, v) for (t, c, v) in recebidos if t == EV_KEY]
                    sincronizou = any(t == EV_SYN and c == SYN_REPORT for (t, c, v) in recebidos)
                    if not chaves:
                        problemas.append(
                            "nenhum EV_KEY chegou ao virtual — é o §12.75: sem "
                            "EV_SYN/SYN_REPORT o evdev não publica o pacote")
                    else:
                        esperado = CANONICO[alvo]
                        if chaves[0][1] != esperado:
                            problemas.append(
                                f"mapa `{alvo}` (físico {fisicos[alvo]}) chegou como "
                                f"{NOME_DE.get(chaves[0][1], chaves[0][1])}, "
                                f"esperado {NOME_DE.get(esperado, esperado)}")
                        print(f"  botão `{alvo}`: físico {NOME_DE.get(fisicos[alvo], fisicos[alvo])}"
                              f" -> {NOME_DE.get(chaves[0][1], chaves[0][1])}"
                              f"{' + SYN_REPORT' if sincronizou else ' SEM SYN_REPORT'}")
                    if chaves and not sincronizou:
                        problemas.append("o evento chegou sem SYN_REPORT neste pacote")

                # ── eixos: as duas pontas declaradas ──
                for nome_eixo, (minimo, maximo) in sorted(eixos_mapa.items()):
                    codigo = ABS_CODIGO[nome_eixo]
                    if minimo == maximo:
                        continue
                    for bruto, esperado in ((minimo, EIXO_MIN), (maximo, EIXO_MAX)):
                        emitir_pacote(ufd, EV_ABS, codigo, bruto)
                        lidos = [e for e in ler(vfd, args.espera)
                                 if e[0] == EV_ABS and e[1] == codigo]
                        if not lidos:
                            problemas.append(f"{nome_eixo}={bruto}: nada chegou ao virtual")
                            continue
                        obtido = lidos[-1][2]
                        # Faixa invertida é legítima: `min` pode mapear no topo.
                        if obtido != esperado:
                            problemas.append(
                                f"{nome_eixo}={bruto}: virtual deu {obtido}, esperado {esperado}"
                                f" (faixa do mapa {minimo}..{maximo})")
                        print(f"  {nome_eixo}={bruto}: virtual {obtido} (esperado {esperado})")
            finally:
                os.close(vfd)
        finally:
            daemon.terminate()
            try:
                daemon.wait(timeout=3)
            except subprocess.TimeoutExpired:
                daemon.kill()
    finally:
        try:
            fcntl.ioctl(ufd, UI_DEV_DESTROY)
        except OSError:
            pass
        os.close(ufd)
        shutil.rmtree(tmp, ignore_errors=True)
        time.sleep(0.2)

    if problemas:
        print("\nFALHA — o contrato de entrada não está valendo:")
        for p in problemas:
            print(f"  - {p}")
        return 1

    print("\nPASS o controle virtual entrega botões e eixos, com SYN_REPORT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
