## Resumo

O GIOCHI-SYSTEM passou a publicar **um controle virtual com layout fixo** (`Giochi Gamepad`), e isso afeta duas coisas do launcher: **de quais devices ele lê** e **o que ele pode fazer com o analógico**.

Nada quebra hoje — o launcher continua rodando. São dois ajustes e uma oportunidade.

## Estado atual medido (R35S, imagem `58510df`)

`EvdevInput::open` abre **todos** os `event*`, por desenho:

```rust
/// Abre todos os dispositivos de `/dev/input/event*`.
///
/// Não filtra por capacidade: um teclado também é aberto, e os códigos que não
/// interessam simplesmente nunca aparecem no mapa.
```

Medido no launcher em execução (pid 505): **3 fds** em `/dev/input` —

| fd | device | o que é |
| --- | --- | --- |
| `event0` | `rk817_int Headphones` | jack de fone |
| `event1` | `gpio-keys-vol` | **teclado** (volume) |
| `event2` | `r36s_Gamepad` | o controle |

Não é defeito: os códigos de volume não estão no mapa e caem no "ignora". Mas é a origem do relato "os botões viram teclado e aparece um mouse" — o launcher tem fd aberto no teclado, e nada no log dizia quais devices eram.

## O que mudou no sistema

```text
  hardware de cada placa                     o que qualquer app vê
  R35S   um nó: 17 BTN + 4 eixos  ──┐
  X55    dois nós: BTN | eixos    ──┼──▶  "Giochi Gamepad"  (S52gamepad)
  X35H   dois nós: BTN | eixos    ──┘     17 botões · 4 eixos em -32767..32767
```

| Garantia | Detalhe |
| --- | --- |
| um nó só | é o que o `SDL_GameController` exige |
| 17 códigos fixos | inclusive os ausentes no hardware (X35H não tem `home`) |
| 4 eixos em **-32767..32767** | Y/RY já desinvertidos quando o hardware inverte (X55) |
| `flat=32` | zona morta é do sistema |
| GUID `06005931091200000100000001000000` | `gamecontrollerdb.txt` mapeia `a:b1` → `Button::A` do SDL é o `a` do mapa |

O `giochi-init` exporta `SDL_GAMECONTROLLERCONFIG` antes de subir o launcher, então **os apps filhos herdam o mapeamento** sem código.

## O que pedimos

### 1. Preferir o `Giochi Gamepad` na enumeração

`abrir_novos()` hoje aceita qualquer `event*`. Duas razões para filtrar:

- **evento duplicado**: o virtual e o físico emitem a mesma transição. Ler os dois dá o mesmo estado, mas conta dobrada em qualquer diagnóstico de "quantos botões".
- **o diagnóstico fica legível**: `names` passa a dizer `["Giochi Gamepad"]` em vez de três nomes, um deles um teclado.

Sugestão de mínimo: manter a leitura de todos (o comportamento atual funciona) mas **preferir** o virtual quando ele existir, e **logar o nome** de cada device aberto — o log de inicialização do launcher é o que faltou para o relato "virou teclado" ser diagnosticado em campo.

### 2. O analógico agora é possível, e com uma fórmula só

`input_evdev.rs` já parseia as chaves `axis_*` do mapa e documenta:

```rust
/// Calibração dos analógicos, declarada pelo sistema com chaves `axis_*`.
/// O laço ainda não lê o analógico, mas **guardar a declaração** evita o
/// descarte silencioso e deixa o dado pronto para quando a leitura entrar.
```

O dado está pronto, e agora a leitura ficou barata: **pelo virtual a faixa é sempre -32767..32767**. Quem lê o virtual não precisa de calibração nenhuma; quem lê o físico usa a faixa do mapa.

Medido em 17/11/2026 (as duas faixas são diferentes, e copiar uma na outra dá curso de 2%):

| Aparelho | Faixa física | Invertido | Centro |
| --- | --- | --- | --- |
| R35S | -1800..1800 | não | 0 (mede -15) |
| X55 / X35H | 15..1023 | **Y e RY** | ≈519 |

O mapa do R35S **não tinha** `axis_*` até hoje — quem calibrasse por ele ficava sem calibração justamente no aparelho onde o driver já normaliza. Corrigido: agora declara `-1800..1800` e `deadzone 32`.

### 3. O `Vigia` (saída de emergência START+B) também se beneficia

`Vigia::novo(mapa, &diretorio_de_entrada())` lê o mapa e os `event*`. Com o virtual, o gesto funciona igual em todo aparelho — hoje depende de o físico ter os códigos que o mapa espera, e o mapa é por aparelho.

## O que **não** pedimos

- Não mexer no `buttons.map`: o formato é o mesmo.
- Não mudar o tradutor: `verificar-mapa.mjs` continua válido.
- Não é urgente: o launcher funciona. É para não descobrir em campo.

## Como conferir num aparelho

```bash
# o que o kernel classificou
bash scripts/input-diag.sh

# o que o SDL vê (não abre vídeo, não rouba o DRM master do launcher)
bash scripts/sdl-input-probe.sh r35s --run 10.55.0.2

# o mapa que foi para a imagem
cat /etc/giochi/buttons.map
```

Do repositório do GIOCHI-SYSTEM.

## Contexto

- `AGENTS.md` §12.74 e §29 do GIOCHI-SYSTEM
- `docs/contrato-de-entrada.md` — referência completa com todas as medições
- Os três scripts acima estão no GIOCHI-SYSTEM, não neste repo
