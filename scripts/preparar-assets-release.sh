#!/usr/bin/env bash
# ============================================================
# Giochi System — preparar os assets de uma release
# ============================================================
# giochi-system:help:begin
# Uso:
#   bash scripts/preparar-assets-release.sh <pasta-baixada> [<pasta-saida>]
#
# Lê artefatos de build (uma pasta por aparelho, do jeito que o
# `actions/download-artifact` os deixa), comprime as imagens de cartão e
# normaliza os nomes para não colidirem entre aparelhos.
#
# Saída: `<pasta-saida>` (padrão `publicar/`) com um arquivo plano por asset.
#
# ## Por que existe, em vez de ficar no YAML
#
# Porque a mesma preparação é usada por DOIS caminhos:
#
#   1. `build-linux-arm64.yml`, logo depois de compilar (publica o que acabou
#      de sair);
#   2. `publicar-release.yml`, que publica os artefatos de um build ANTERIOR
#      (sem recompilar).
#
# Duplicar trinta linhas de shell em dois workflows é como as duas cópias
# divergem: alguém corrige a compressão numa e a outra continua publicando
# arquivo com nome que colide. É o §12.49 — trabalho repetido em N pontos, e um
# deles esquece um passo.
#
# ## Por que renomear
#
# Nome de asset é único numa release, e o upload com `--clobber` NÃO falha
# quando o nome se repete: ele sobrescreve. `build-info.txt`, `SHA256SUMS`,
# `Image`, `device.json` e `rootfs.ext4` existem nos três aparelhos, então o
# último upload venceria e a release mostraria o build-info de um aparelho como
# se fosse de todos. O upload sairia com sucesso e ninguém veria.
# giochi-system:help:end
# ============================================================

set -euo pipefail

ORIGEM="${1:-}"
DESTINO="${2:-publicar}"

if [ -z "$ORIGEM" ]; then
  echo "ERRO: informe a pasta com os artefatos baixados" >&2
  echo "Uso: bash scripts/preparar-assets-release.sh <pasta-baixada> [<pasta-saida>]" >&2
  exit 2
fi
case "$ORIGEM" in
  -h|--help) sed -n '/^# giochi-system:help:begin$/,/^# giochi-system:help:end$/p' "$0" | sed '1d;$d;s/^# \{0,1\}//'; exit 0 ;;
esac
[ -d "$ORIGEM" ] || { echo "ERRO: $ORIGEM não é uma pasta" >&2; exit 2; }

shopt -s nullglob
rm -rf "$DESTINO"
mkdir -p "$DESTINO"

# A checagem de colisão tem de acontecer ANTES da escrita, no nome de destino.
#
# Parece redundante (dois arquivos com o mesmo nome na mesma pasta?), mas é
# exatamente o que acontece: cada aparelho vem numa subpasta, e o destino é
# plano. E `cp -f` sobrescreve calado. Uma checagem de duplicata feita DEPOIS do
# laço (`uniq -d`) é decorativa: numa pasta plana ela nunca dispara, porque o
# filesystem não permite dois arquivos com o mesmo nome. Verificado.
#
# E o `exit` não pode estar dentro de `$(...)`: ali ele mata só o subshell, o
# script segue com destino vazio e o operador vê um erro de `cp` que não diz
# nada sobre o problema real. Por isso `checa` só checa, e quem chama está no
# shell principal.
checa() {
  if [ -e "$DESTINO/$1" ]; then
    echo "ERRO: dois aparelhos produziriam o asset '$1'." >&2
    echo "       A release mostraria o arquivo de um como se fosse de todos," >&2
    echo "       e o upload sairia com sucesso." >&2
    exit 1
  fi
}

n=0
for dir in "$ORIGEM"/*/; do
  aparelho="$(basename "$dir")"
  aparelho="${aparelho#giochi-system-}"
  for f in "$dir"*; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in
      *.img)
        # A `.img` tem 2 GiB EXATOS (SIZE_MIB=2048 no make-sd-image.sh) e o
        # GitHub recusa asset de 2 GiB ou mais. Sem comprimir, o arquivo que o
        # usuário precisa gravar ficaria de fora — e o upload de um asset entre
        # vários falha sem estardalhaço.
        echo "comprimindo $base ($(stat -c %s "$f") bytes)" >&2
        checa "${base}.gz"
        gzip -9 -c "$f" >"$DESTINO/${base}.gz"
        n=$((n + 1))
        ;;
      *-sd.img.gz)
        # Já veio comprimida e já tem o aparelho no nome.
        checa "$base"
        cp -f "$f" "$DESTINO/$base"
        n=$((n + 1))
        ;;
      *)
        checa "giochi-system-${aparelho}-${base}"
        cp -f "$f" "$DESTINO/giochi-system-${aparelho}-${base}"
        n=$((n + 1))
        ;;
    esac
  done
done

if [ "$n" -eq 0 ]; then
  echo "ERRO: nenhum arquivo em $ORIGEM — os artefatos vieram vazios?" >&2
  exit 1
fi

echo "--- conteúdo a publicar:" >&2
find "$DESTINO" -type f -printf '%12s  %f\n' | sort -k2 | sed 's/^/  /' >&2
echo "--- total: $n arquivo(s), $(du -sh "$DESTINO" | cut -f1)" >&2
