#!/usr/bin/env bash
# ============================================================
# Giochi System — chave pública da loja + verificador de assinatura
# ============================================================
# Uso:
#   bash scripts/chave-da-loja.sh --gerar          # cria o par (privada FORA do repo)
#   bash scripts/chave-da-loja.sh --verificar      # confere os arquivos versionados
#
# ## Por que este script existe
#
# O instalador de pacotes do `Giochi app` verifica a assinatura Ed25519 de cada
# `.giochi` antes de extrair. Sem a chave pública em `/etc/giochi/loja-publica.pem`,
# ele **avisa** que não verificou e segue — honesto, mas não é segurança.
#
# ## O que entra no repositório, e o que NUNCA entra
#
#   device/common/rootfs-overlay/etc/giochi/loja-publica.pem   ← PÚBLICA, vai na imagem
#   ~/.cache/giochi-system/chaves-loja/loja-privada.pem        ← PRIVADA, fora do repo
#
# Chave pública é dado público: não há risco em distribuí-la, e é ela que permite
# RECUSAR pacote adulterado. Chave privada é o que assina — quem a tem controla o
# que entra na loja. Ela não é versionada, nunca é impressa, e
# `tests/chave-da-loja.test.mjs` falha se alguém tentar.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAVES="${GIOCHI_CHAVES_DIR:-$HOME/.cache/giochi-system/chaves-loja}"
PUBLICA_REPO="$ROOT/device/common/rootfs-overlay/etc/giochi/loja-publica.pem"

case "${1:-}" in
  --gerar)
    # Nunca sobrescrever: regerar a chave invalidaria todos os pacotes já
    # assinados, e ninguém perceberia até o instalador recusar tudo na loja.
    if [[ -f "$CHAVES/loja-privada.pem" ]]; then
      echo "ERRO: já existe chave privada em $CHAVES" >&2
      echo "Regerar invalidaria todo pacote já assinado. Se é mesmo isso que" >&2
      echo "você quer, apague o arquivo ANTES e assuma a consequência." >&2
      exit 2
    fi
    mkdir -p "$CHAVES"
    chmod 700 "$CHAVES"
    openssl genpkey -algorithm ed25519 -out "$CHAVES/loja-privada.pem"
    chmod 600 "$CHAVES/loja-privada.pem"
    openssl pkey -in "$CHAVES/loja-privada.pem" -pubout -out "$CHAVES/loja-publica.pem"
    mkdir -p "$(dirname "$PUBLICA_REPO")"
    cp "$CHAVES/loja-publica.pem" "$PUBLICA_REPO"
    echo "Par gerado."
    echo "  privada: $CHAVES/loja-privada.pem   (0600, FORA do repositório)"
    echo "  publica: $PUBLICA_REPO   (versionada, vai na imagem)"
    echo
    echo "GUARDE a privada. Sem ela não há como assinar pacote novo; com ela,"
    echo "quem a tiver assina qualquer coisa. Faça backup fora desta máquina."
    ;;

  --verificar)
    falhou=0
    if [[ ! -f "$PUBLICA_REPO" ]]; then
      echo "FALTA: $PUBLICA_REPO" >&2
      exit 1
    fi
    tipo="$(openssl pkey -pubin -in "$PUBLICA_REPO" -noout -text 2>/dev/null \
            | head -1 | tr -d ' ')"
    echo "chave publica: $tipo"
    if [[ "$tipo" != "ED25519Public-Key:" ]] && [[ "$tipo" != *Ed25519* ]]; then
      echo "ERRO: a chave não é Ed25519 — o verificador recusa outro tipo." >&2
      falhou=1
    fi
    if [[ -f "$CHAVES/loja-privada.pem" ]]; then
      derivada="$(openssl pkey -in "$CHAVES/loja-privada.pem" -pubout 2>/dev/null | sha256sum | awk '{print $1}')"
      versionada="$(sha256sum "$PUBLICA_REPO" | awk '{print $1}')"
      if [[ "$derivada" != "$versionada" ]]; then
        echo "ERRO: a pública versionada não corresponde à privada local." >&2
        echo "      Pacotes assinados com a privada seriam RECUSADOS na imagem." >&2
        falhou=1
      else
        echo "publica versionada confere com a privada local: OK"
      fi
    else
      echo "(sem chave privada nesta máquina; não há como conferir o par)"
    fi
    exit "$falhou"
    ;;

  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
