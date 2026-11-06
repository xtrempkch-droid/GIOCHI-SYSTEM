#!/usr/bin/env bash
# ============================================================
# Giochi System — as DUAS chaves públicas da loja + verificador de assinatura
# ============================================================
# Uso:
#   bash scripts/chave-da-loja.sh --gerar              # cria os pares que faltam
#   bash scripts/chave-da-loja.sh --gerar licenca      # só um deles
#   bash scripts/chave-da-loja.sh --verificar          # confere o que está versionado
#
# ## Por que DUAS chaves, e não uma
#
# Pedido da equipe do `Giochi app` em 06/11/2026 10:20. São duas perguntas
# diferentes, e juntá-las num arquivo só anularia a segunda:
#
#   /etc/giochi/loja-publica.pem      "este pacote veio da Giochi?"
#   /etc/giochi/licenca-publica.pem   "este aparelho pagou?"
#
# Se a assinatura do pacote fosse também a prova de compra, **um** arquivo
# copiado de um aparelho para outro serviria para todo mundo. Com a licença
# separada o pacote não basta: a licença carrega a chave pública do aparelho que
# comprou, e outro aparelho recusa. Por isso `--verificar` falha se as duas
# públicas forem iguais — seria o mesmo que ter uma.
#
# ## O que entra no repositório, e o que NUNCA entra
#
#   device/common/rootfs-overlay/etc/giochi/<nome>-publica.pem  <- PUBLICA, vai na imagem
#   ~/.cache/giochi-system/chaves-loja/<nome>-privada.pem       <- PRIVADA, fora do repo
#
# Chave pública é dado público: não há risco em distribuí-la, e é ela que permite
# RECUSAR pacote adulterado. Chave privada é o que assina — quem a tem controla o
# que entra na loja. Ela não é versionada, nunca é impressa, e
# `tests/chave-da-loja.test.mjs` falha se alguém tentar.
#
# ## A terceira chave não está aqui
#
# `/user/.config/giochi/device.key` é a chave privada **do aparelho**, gerada no
# primeiro boot dele. Ela nasce no aparelho e nunca viaja daqui — não é par de
# nada nesta máquina, e não há nada para gerar.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAVES="${GIOCHI_CHAVES_DIR:-$HOME/.cache/giochi-system/chaves-loja}"
OVERLAY="$ROOT/device/common/rootfs-overlay/etc/giochi"

# Ordem fixa: a saída fica previsível e os testes podem depender dela.
CHAVES_NOMES=(loja licenca)

privada_de() { printf '%s/%s-privada.pem' "$CHAVES" "$1"; }
publica_de() { printf '%s/%s-publica.pem' "$OVERLAY" "$1"; }

# A impressão digital da chave é o SHA256 do PEM. É o que permite dizer "as duas
# são diferentes" sem depender de comparação do texto, que muda com quebra de
# linha.
digital() { sha256sum "$1" | awk '{print $1}'; }

# `openssl pkey -pubin -text` imprime o tipo na primeira linha. Comparar o
# prefixo é o que pega troca de algoritmo: o verificador em C só implementa
# Ed25519, e uma chave RSA na imagem seria recusada em silêncio no aparelho.
tipo_da_publica() {
  openssl pkey -pubin -in "$1" -noout -text 2>/dev/null | head -1 | tr -d ' '
}

gerar_uma() {
  local nome="$1" priv pub
  priv="$(privada_de "$nome")"
  pub="$(publica_de "$nome")"

  if [[ -f "$priv" ]]; then
    echo "já existe: $nome (privada em $priv)"
    return 0
  fi

  mkdir -p "$CHAVES" "$OVERLAY"
  chmod 700 "$CHAVES"
  openssl genpkey -algorithm ED25519 -out "$priv"
  chmod 600 "$priv"
  openssl pkey -in "$priv" -pubout -out "$pub"
  echo "gerado:    $nome"
  echo "  privada: $priv  (0600, FORA do repositório)"
  echo "  publica: $pub  (versionada, vai na imagem)"
}

cmd_gerar() {
  local alvo="${1:-}"
  local nomes=("${CHAVES_NOMES[@]}")

  if [[ -n "$alvo" ]]; then
    local achou=0 n
    for n in "${CHAVES_NOMES[@]}"; do [[ "$n" == "$alvo" ]] && achou=1; done
    if ((!achou)); then
      echo "ERRO: chave desconhecida: $alvo" >&2
      echo "Conhecidas: ${CHAVES_NOMES[*]}" >&2
      exit 2
    fi
    nomes=("$alvo")
  fi

  local n
  for n in "${nomes[@]}"; do gerar_uma "$n"; done

  echo
  echo "GUARDE as privadas. Sem elas não há como assinar pacote nem emitir"
  echo "licença; com elas, quem as tiver assina qualquer coisa. Backup fora"
  echo "desta máquina, e NUNCA no repositório."
}

cmd_verificar() {
  local falhou=0 digitais=() nome pub priv tipo

  for nome in "${CHAVES_NOMES[@]}"; do
    pub="$(publica_de "$nome")"
    priv="$(privada_de "$nome")"

    if [[ ! -f "$pub" ]]; then
      echo "FALTA: $pub" >&2
      falhou=1
      continue
    fi

    tipo="$(tipo_da_publica "$pub")"
    if [[ "$tipo" != "ED25519Public-Key:" ]]; then
      echo "ERRO: $nome não é Ed25519 ($tipo) — o verificador recusa outro tipo." >&2
      falhou=1
      continue
    fi
    echo "$nome: Ed25519, $(wc -c <"$pub") B, $(digital "$pub" | cut -c1-16)..."
    digitais+=("$(digital "$pub")")

    if [[ -f "$priv" ]]; then
      local derivada
      derivada="$(openssl pkey -in "$priv" -pubout 2>/dev/null | sha256sum | awk '{print $1}')"
      if [[ "$derivada" != "$(digital "$pub")" ]]; then
        echo "  ERRO: a publica versionada NAO corresponde a privada local." >&2
        echo "        Pacotes assinados com a privada seriam RECUSADOS na imagem." >&2
        falhou=1
      else
        echo "  confere com a privada local: OK"
      fi
    else
      echo "  (sem privada nesta maquina; nao ha como conferir o par)"
    fi
  done

  # A razão de existirem duas chaves é serem independentes. Iguais = uma.
  if ((${#digitais[@]} >= 2)); then
    local unicas
    unicas="$(printf '%s\n' "${digitais[@]}" | sort -u | wc -l)"
    if ((unicas < ${#digitais[@]})); then
      echo "ERRO: ha chaves publicas IGUAIS na imagem." >&2
      echo "      Loja e licenca tem de ser pares distintos: iguais significam" >&2
      echo "      que copiar o pacote de um aparelho o libera em todos." >&2
      falhou=1
    fi
  fi

  return "$falhou"
}

case "${1:-}" in
  --gerar)
    shift
    cmd_gerar "${1:-}"
    ;;
  --verificar)
    cmd_verificar
    ;;
  *)
    sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
