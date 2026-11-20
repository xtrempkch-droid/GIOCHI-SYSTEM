O `Giochi System` passou a suportar ports de terceiros pelo PortMaster. O
runtime já está na imagem (`GIOCHI_WITH_PORTMASTER=1`: python3 3.12.9 +
bubblewrap, 22,9 MiB medidos), o `giochi-ports` está em `/usr/bin`, e **um port de
verdade roda a 60 fps no R35S**:

```text
FORM video: opengles2 renderer, vsync on
FORM input: controller r36s_Gamepad
FORM 25 s: chip 69.2 C, clock 1200 MHz, frames 16.7 ms, held buttons 00000
```

O que falta é do lado do app: **o launcher listar os ports e a loja oferecer o
PortMaster**. Três pedidos, e o primeiro não exige código nenhum.

---

## Contexto que muda o pedido: o launcher já libera o DRM

Li o `app/launcher/crates/ui-sdl/src/main.rs`, e ele **já faz a coisa certa**:

```rust
// Consome o `App`: o `Painter` morre aqui e o DRM master é liberado.
// Sem isso o filho recebe `kmsdrm not available` — medido no X35H.
let estado = app.encerrar();
...
match system::lancar_com_saida(&alvo, Some(&map)) {
```

Então o que eu ia pedir (o `exec` de que o `docs/integracao.md` fala como
decisão futura) **não é necessário para isto**. O `kmsdrm not available` que eu
media ao tentar abrir a GUI com o launcher no ar acontecia porque eu estava
rodando o `giochi-ports` **fora** do ciclo do launcher. Dentro dele, o DRM já
está livre quando o filho sobe.

Isso reduz o pedido ao formato do alvo.

---

## Pedido 1 — ports na aba Apps, sem mudar o launcher

O `Alvo` que o launcher usa é:

```rust
pub struct Alvo {
    pub slug: String,
    pub dir: String,
    pub entrypoint: String,
    pub tipo: Tipo,
}
impl Alvo {
    pub fn executavel(&self) -> String {
        format!("{}/{}", self.dir.trim_end_matches('/'), self.entrypoint)
    }
}
```

e o lançamento é `Command::new(executavel).current_dir(dir).env("GIOCHI_APP_ID", slug).spawn()`
— **sem argumentos**, como o `docs/integracao.md` §4 define.

Um port do PortMaster não tem essa forma: ele é
`/user/ports/<nome>/<nome>.sh` e precisa do sandbox. Então o caminho que **não
exige mudar o launcher** é o PortMaster publicar, por port, um item de app
comum:

```text
/user/apps/<slug>/
├── metadata.json          {"kind": "app", "name": "<título>"}
└── <slug>                 #!/bin/sh
                           exec giochi-ports --rodar <nome>
```

O launcher já detecta `/user/apps` (`deteccao.rs`, `RAIZ_APP_USUARIO`), o
`kind: "app"` já o põe na aba certa, e o `entrypoint` executa sem argumentos.
`giochi-ports` resolve o resto: acha o `.sh` do port (os dois layouts), confere
se o DRM está livre (estará), roda dentro do `bwrap` com o rootfs somente-leitura
e devolve o controle ao sair.

Se essa forma servir, **não há nada a fazer no launcher** — e é o que eu
recomendo como primeiro passo.

## Pedido 2 — a aba "Ports" de verdade (opcional, e é UX)

O que a forma acima não dá: os ports aparecem misturados com os apps, e a lista
só muda quando o PortMaster sincroniza.

Se quiserem a aba própria, o que o launcher precisa é de **passar argumento**:

```rust
// `Alvo` ganharia `args: Vec<String>` (vazio por padrão, e é o caso de todo
// jogo/app de hoje). O spawn passa a ser:
Command::new(&alvo.executavel())
    .args(&alvo.args)
    .current_dir(&alvo.dir)
    .env("GIOCHI_APP_ID", &alvo.slug)
    .spawn()
```

e a detecção ganharia uma raiz:

| tipo | imagem | usuário / loja |
| --- | --- | --- |
| jogo | `/opt/giochi/games` | `/user/games` |
| app | `/opt/giochi/apps` | `/user/apps` |
| **port** | — | **`/user/ports`** |

com alvo `dir=/user/ports/<nome>`, `args=["--rodar", "<nome>"]`,
`entrypoint=/usr/bin/giochi-ports`.

O `argv` extra é **aditivo**: sem `args`, o comportamento de hoje não muda — e
nenhum jogo ou app instalado precisa ser reempacotado.

## Pedido 3 — o PortMaster como item da loja

O pacote (`PortMaster.zip`, 24,6 MB) **não pode** entrar na imagem assinada: ele
traz `gptokeyb2` (GPL-2.0) e 7-Zip (`7zzs`, LGPL-2.1), e a regra do sistema
recusa GPL/AGPL/LGPL no artefato publicado. Ele é um app de loja, e a loja é de
vocês.

O que já está pronto do lado do sistema:

| Peça | Estado |
| --- | --- |
| `python3` + `bubblewrap` na imagem | só com `GIOCHI_WITH_PORTMASTER=1` (opt-in, 22,9 MiB) |
| `giochi-ports` | `/usr/bin`, com `--status` / `--rodar` / `--liberar-drm` |
| `/roms` → `/user` | criado pelo `post-build` |
| `/etc/giochi/gamecontrollerdb.txt` | montado por cima do DB do PortMaster (ver abaixo) |
| `/etc/os-release` com `OS_NAME=Giochi` | o PortMaster se identifica como `giochi` |

### Duas armadilhas que custaram tempo, e que a loja vai encontrar

1. **O `gamecontrollerdb.txt` do PortMaster tem 472 KB.** O `control.txt` dele
   exporta o arquivo inteiro em `SDL_GAMECONTROLLERCONFIG`, e **uma variável de
   ambiente não pode passar de `MAX_ARG_STRLEN` (128 KB)** — então **todo
   `exec`** do port falha com `Argument list too long`, e o sintoma parece
   binário quebrado. O `giochi-ports` monta o nosso DB (2 KB) por cima; se a loja
   instalar o pacote por outro caminho, precisa fazer o mesmo.

2. **O `entrypoint` do launcher roda com `cwd = dir` e sem shell.** Um
   `entrypoint` que seja `.sh` só funciona com `+x` e shebang. O zip do
   PortMaster vem com modo `600` quando extraído por `unzip` de um usuário com
   `umask 077` — medido aqui. Quem instalar tem de normalizar os modos.

### Sobre assinatura: os ports **não** são assinados

O PortMaster baixa `.zip` de um repositório público, sem assinatura, e executa o
`.sh` de dentro. É o oposto do contrato das duas chaves
(`/etc/giochi/loja-publica.pem` e `/etc/giochi/licenca-publica.pem`).

**Pedido concreto:** o que vier por esse caminho tem de aparecer na interface
como **sideload**, não como conteúdo da loja. O que o sistema garante é o
sandbox: rootfs somente-leitura, só `/user` gravável, namespaces de pid/net/uts
próprios. O que ele **não** garante é o conteúdo — e isso tem de estar visível
para quem instala.

---

## O que eu medi, e o que não medi

Medido no R35S em 20/11/2026 (imagem `e0d74e6`):

| Verificação | Resultado |
| --- | --- |
| GUI do PortMaster no KMSDRM | DRM master + 2 framebuffers (`debugfs` do DRM) |
| um port do registry (`FORM`) | 60 fps, `opengles2`, botões respondendo |
| sandbox: escrever em `/usr/bin` | `Read-only file system` |
| sandbox: `/user` gravável | OK |
| sandbox: processos visíveis de dentro | 5, de ~40 fora |
| `giochi-selftest` | `PASS 43 · WARN 0 · FAIL 0 · SKIP 3` |

**Não medido:** baixar um port pela GUI — o aparelho de teste não tem DNS (o
`udhcpd` não anuncia gateway, por desenho), então rodou tudo offline. Isso é
rede, não app.

---

## O que eu peço, em uma linha

1. Digam se a forma do **Pedido 1** (wrapper em `/user/apps`) serve — se servir,
   não há mudança no launcher e eu levo o resto sozinho.
2. Se a aba própria for desejada, `args` no `Alvo` (aditivo, sem quebrar nada).
3. Na loja, o PortMaster como app **sideload** e declarado como tal.

Do lado do `Giochi System` não há nada bloqueado: o runtime está na imagem, o
`giochi-ports` está pronto e o teste que prende o contrato é
`tests/portmaster-runtime.test.mjs`. Detalhe completo em
`docs/evaluacao-portmaster.md` do repositório do sistema.
