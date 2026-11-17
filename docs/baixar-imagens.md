# Baixar (ou compilar) a imagem sem depender de ninguém

Duas perguntas, duas respostas curtas:

| Você quer… | Vá para |
| --- | --- |
| **a imagem pronta**, para gravar no cartão | [§1 — Release](#1-a-imagem-pronta-release) |
| **compilar você mesmo**, do código | [§2 — build na nuvem](#2-compilar-na-nuvem-sem-instalar-nada) ou [§3 — build no seu PC](#3-compilar-no-seu-pc) |

Nenhuma das três exige pedir para o agente compilar. O build é o mesmo: o
GitHub Actions roda o Buildroot num runner x86_64 com o repositório já
configurado.

---

## 1. A imagem pronta (Release)

Se existir a página de releases do repositório, a imagem está lá:

```text
https://github.com/xtrempkch-droid/GIOCHI-SYSTEM/releases/tag/imagens
```

É uma **tag móvel**: a cada publicação o conteúdo é substituído, então o link
não muda e sempre aponta para o build mais recente. O download **não exige
login** (repositório público) e **não expira** — diferente do artefato de
Actions, que some em 14 dias e pede conta.

### O que baixar

| Arquivo | Serve para |
| --- | --- |
| `giochi-system-<aparelho>-sd.img.gz` | **é este** — a imagem completa do cartão |
| `SHA256SUMS` | conferir que o download não corrompeu |

### Como gravar

```bash
# 1. confira o hash (o script também confere, mas ver antes é hábito)
sha256sum giochi-system-r35s-sd.img.gz

# 2. descubra o cartão — e confira o TAMANHO
bash scripts/flash-sd.sh --list

# 3. grave (não precisa descomprimir: o script aceita .gz direto)
sudo bash scripts/flash-sd.sh \
  giochi-system-r35s-sd.img.gz /dev/sdX --expect-gib 29
```

O `--expect-gib` **não é opcional na prática**: com dois cartões no PC, os dois
aparecem como removíveis e nada no nome distingue um do outro. Já custou uma
gravação no cartão errado (AGENTS §12.8). O número que vale é o que o aparelho
reporta em `mmc info`, no U-Boot.

Se o `flash-sd.sh` reclamar de algo no seu sistema, o caminho de reserva é o
`flash-dd.sh` — que aceita o mesmo `.img.gz`:

```bash
sudo bash scripts/flash-dd.sh giochi-system-r35s-sd.img.gz /dev/sdX
```

### Por que `.gz` e não a `.img` direto

A `.img` tem **2 GiB exatos**, e o GitHub recusa asset de 2 GiB ou mais. Sem
comprimir, o arquivo que interessa ficaria de fora da release — e o upload de um
asset entre vários falha sem estardalhaço. Comprimido fica em ~200 MB, e a
gravação sai igual.

---

## 2. Compilar na nuvem, sem instalar nada

É o mesmo build da Release; você só pede por ele mesmo.

1. Abra **Actions** → **Build Giochi System ARM64** → **Run workflow**.
2. Preencha:
   - `device`: o id do aparelho (`r35s`, `powkiddy-x55`) ou `all`
   - `publicar_release`: **`true`** ← é o que faz o resultado virar página de download
   - `allow_draft`: `false` (só use `true` para rascunho, junto com `device=<id>`)
3. **Run workflow**. Leva de 1 a 2 horas com cache quente.
4. Quando terminar, a imagem estará na [Release](#1-a-imagem-pronta-release) —
   não no zip de artefato, que expira.

Custo: o build usa os minutos de Actions do repositório; os caches (`BR2_DL_DIR`
e ccache) ficam entre execuções, então o segundo build é bem mais rápido que o
primeiro.

> **Um aparelho por vez quando for testar.** O workflow tem
> `cancel-in-progress: true`: um push novo **mata** o build em andamento. Se você
> disparar um build e depois empurrar um commit em `device/`, `config/` ou
> `scripts/`, o primeiro morre. `docs/**` e `tests/**` não disparam build.

---

## 3. Compilar no seu PC

Só vale a pena se você for mexer no código e quiser o ciclo curto. Exige Linux
(nativo ou WSL2) com Docker — **não** compila no Windows nativo, e o caminho do
repositório não pode ter espaço.

```bash
git clone git@github.com:xtrempkch-droid/GIOCHI-SYSTEM.git
cd GIOCHI-SYSTEM

# pré-voo: confere ferramentas, disco e hash do Buildroot (não instala nada)
bash scripts/check-host.sh

# o build inteiro, dentro do container
bash scripts/build-in-container.sh r35s

# a imagem de cartão
bash scripts/build-in-container.sh --sd-image r35s
```

Saída em `out/<aparelho>/`. Detalhe de ambiente e armadilhas conhecidas em
[`building-locally.md`](building-locally.md).

Duas coisas que economizam horas:

- **não edite `scripts/*.sh` enquanto um build roda** — o bash lê o script em
  blocos e o erro aparece numa linha que está correta (AGENTS §12.25);
- **`GIOCHI_SYSTEM_KEEP_WORK=1` só é seguro quando a configuração não remove
  nada** — pacote removido continua no `target/` e entra na imagem
  (AGENTS §12.27). Quando a mudança mexe em dependência de pacote, build do zero.

---

## 4. Qual das três eu uso?

| Situação | Caminho |
| --- | --- |
| quero só gravar e jogar | **Release** (§1) |
| quero a imagem de um commit específico, sem mexer no PC | **Actions com `publicar_release`** (§2) |
| estou mudando código e quero iterar rápido | **build local** (§3) |

O que **não** é caminho: pedir para o agente compilar na máquina dele. O build
de um aparelho leva ~1 h e ocupa ~17 GB; a Release existe justamente para isso
não ser necessário.

---

## Para quem mexe no repositório

- a publicação é o job `release` de
  [`.github/workflows/build-linux-arm64.yml`](../.github/workflows/build-linux-arm64.yml);
- `tests/release-e-gz.test.mjs` prende o contrato: o input é `choice` e não
  `boolean` (§12.5), a permissão de escrita fica no job e não no topo, o
  `SHA256SUMS` sobe antes da imagem, e os **dois** scripts de gravação leem
  `.gz` — verificado executando a função real sobre um arquivo comprimido;
- a release **não publica se um aparelho falhar** (`needs: [build]`). É de
  propósito: uma página com imagem de um aparelho quebrado é pior que página
  nenhuma, porque parece pronta para gravar.
