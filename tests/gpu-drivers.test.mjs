#!/usr/bin/env node
// A decisão sobre driver de GPU, presa em teste.
//
// Contexto: o panfrost (Mesa, software livre) não tem geometry shader; o blob da
// ARM (`libmali`) tem. A tentação é empacotar o blob "para garantir". Este teste
// existe para que essa troca não aconteça por uma linha de configuração sem que
// alguém perceba o que ela custa (licença em todo artefato público).
//
// Documento de referência: `docs/gpu-drivers.md`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const DOC = readFileSync(new URL("../docs/gpu-drivers.md", import.meta.url), "utf8");

function listFiles(dir) {
  const out = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

test("nenhum fragmento de buildroot pede o blob da ARM", () => {
  // `libmali` não é pacote do Buildroot: entrar na imagem exigiria um pacote
  // customizado. Se alguém criar um, tem de ser na loja (item 4.2 do doc), e
  // este teste obriga a decisão a ser explícita.
  const root = new URL("../device/", import.meta.url).pathname;
  const offenders = listFiles(root).filter((file) => {
    if (!/\.(fragment|json|mk)$/.test(file)) return false;
    const text = readFileSync(file, "utf8");
    return /libmali|mali-bifrost|MALI_BIFROST/i.test(text);
  });
  assert.deepEqual(offenders, [], `libmali referenciado em: ${offenders.join(", ")}`);
});

test("o fragmento comum não liga driver proprietário de GPU", () => {
  const common = readFileSync(new URL("../config/common.fragment", import.meta.url), "utf8");
  // A palavra "Mali" aparece num comentário legítimo ("Mali via panfrost").
  // O que não pode existir é PEDIDO de pacote/driver proprietário.
  assert.ok(
    !/^\s*BR2_[A-Z0-9_]*MALI[A-Z0-9_]*\s*=\s*y/m.test(common),
    "common.fragment não deve ligar pacote Mali proprietário",
  );
  assert.ok(!/MALI_BIFROST/i.test(common), "blob da ARM não entra na config comum");
  // E não deve desligar o panfrost por acidente: é o nosso driver.
  assert.ok(
    !/CONFIG_DRM_PANFROST\s+is\s+not\s+set/.test(common),
    "desligar CONFIG_DRM_PANFROST tira a GPU inteira",
  );
});

test("o documento cobre as três saídas, e nenhuma é 'empacotar o blob na imagem'", () => {
  // O que o doc precisa conter para continuar sendo um doc de DECISÃO:
  assert.match(DOC, /patch do arcade/i, "saída 4.1");
  assert.match(DOC, /libmali/i, "saída 4.2");
  assert.match(DOC, /recusar/i, "saída 4.3");
  assert.match(DOC, /fora\*\* da imagem base|fora da imagem base/i, "o blob fica fora da base");
  assert.match(DOC, /redistribui/i, "a pergunta de licença tem de estar escrita");
});

test("o documento diz que portar o driver nao e' trabalho deste repositorio", () => {
  // Sem esta frase, a pergunta "e se não for possível portar?" volta a cada
  // sessão, e alguém tenta implementar geometry shader no Mesa localmente.
  assert.match(DOC, /projeto do\s+\*\*Mesa\*\*|driver do\s+\*\*Mesa\*\*/i);
  assert.match(DOC, /(não\s+)?cabe\s+a\s+este\s+repositório/i);
});

test("a matriz diz que o launcher e o Godot Compatibility NAO precisam de geometry shader", () => {
  // Se isto deixar de ser verdade, o peso da decisão muda e o doc precisa ser
  // reescrito — não basta editar a tabela.
  const launcherRow = DOC.split("\n").find((line) => /Launcher SDL2/.test(line));
  assert.ok(launcherRow, "linha do launcher ausente na matriz");
  assert.match(launcherRow, /\|\s*não\s*\|/, "launcher não precisa de geometry shader");

  const godotRow = DOC.split("\n").find((line) => /Godot 4 \*\*Compatibility\*\*/.test(line));
  assert.ok(godotRow, "linha do Godot Compatibility ausente");
  assert.match(godotRow, /\|\s*\*\*não\*\*[^|]*\|/, "Godot Compatibility não precisa");
});

test("a medicao do panfrost esta registrada, com o renderer que a distingue", () => {
  // Este teste antes exigia `/nunca foi medido/` — o doc tinha de declarar que
  // comparava HARDWARE (blob da ARM) contra o features.txt do Mesa, sem medir o
  // panfrost rodando. Em 06/11/2026 isso foi medido no R35S com a nossa imagem.
  //
  // O que o teste protege agora é o FATO que torna a medição válida: o número
  // que separa GPU de CPU é `GL_RENDERER`. `GL_VERSION` é IDÊNTICA nos dois
  // casos (OpenGL ES 3.1 Mesa 24.0.0), medido com e sem panfrost. Um doc que
  // registre só a versão não prova nada.
  assert.match(DOC, /Mali-G31 \(Panfrost\)/, "o renderer medido precisa estar no doc");
  assert.match(DOC, /softpipe/, "o caso de fallback (CPU) precisa estar no doc");
  assert.match(
    DOC,
    /GL_VERSION[^\n]*id[eê]ntica|id[eê]ntica[^\n]*GL_VERSION/i,
    "o doc precisa avisar que GL_VERSION não distingue GPU de CPU",
  );
  assert.match(DOC, /GL_OES_geometry_shader\s*=\s*N[ÃA]O/i, "geometry shader ausente, confirmado");
});

test("o gles-probe.py continua sendo o instrumento da medicao pendente", () => {
  const probe = statSync(new URL("../scripts/gles-probe.py", import.meta.url));
  assert.ok(probe.size > 4000, "scripts/gles-probe.py encolheu?");
  assert.match(DOC, /gles-probe\.py/);
});

// ── a GPU é onboard: o driver não pode ser módulo ───────────────────────────
//
// Medido no R35S em 06/11/2026. O fragmento do aparelho declarava
// `CONFIG_DRM_PANFROST=m` com a justificativa "como no vendor, para o mali_kbase
// poder carregar depois". O rootfs do Buildroot não tem `/etc/modules` nem
// `modules-load`, então o `.ko` ficava no disco e ninguém o carregava.
//
// Consequência medida, e é o motivo deste teste existir: sem panfrost a Mesa cai
// no `swrast`, e o probe responde IGUAL nos dois casos —
//
//   GL_RENDERER = Mali-G31 (Panfrost)  |  GL_RENDERER = softpipe
//   GL_VERSION  = OpenGL ES 3.1 Mesa   |  GL_VERSION  = OpenGL ES 3.1 Mesa
//
// A única diferença é o nome do renderer. `kmscube` também roda. Ou seja: todo
// teste que pergunta "tem GLES 3.1?" aprova um aparelho renderizando na CPU.
//
// A regra que fecha isso é a mesma do áudio (§12.43): hardware onboard está
// presente em TODO boot, então `=y`. Módulo é para hardware que pode não estar
// lá (dongle Wi-Fi), não para o que sustenta a tela.
test("nenhum aparelho pede o panfrost como módulo", () => {
  const root = new URL("../device/", import.meta.url).pathname;
  const offenders = [];

  for (const file of listFiles(root)) {
    if (!/linux\.fragment$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    // Linha efetiva (fora de comentário) que peça o panfrost como módulo.
    const asModule = text
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .filter((line) => /^\s*CONFIG_DRM_PANFROST\s*=\s*m\s*$/.test(line));
    if (asModule.length > 0) offenders.push(file.replace(root, "device/"));
  }

  assert.deepEqual(
    offenders,
    [],
    `panfrost como módulo em: ${offenders.join(", ")} — sem autoload a GPU fica ` +
      `inerte e a Mesa cai no softpipe com GL_VERSION idêntica`,
  );
});

test("os aparelhos com GPU no device tree exigem o panfrost no kernel", () => {
  // O fragmento é delta: um `allow-drop` acidental, ou o patch do DTS parando de
  // aplicar, tiraria o símbolo e a imagem sairia igual (verde) e sem GPU. A
  // `kernel-required.txt` é o gate — mas só vale para quem a declara.
  const root = new URL("../device/", import.meta.url).pathname;
  const withGpu = ["r35s", "powkiddy x55", "powkiddy x35h"];

  for (const device of withGpu) {
    const fragment = `${root}${device}/linux.fragment`;
    const required = `${root}${device}/kernel-required.txt`;
    assert.match(
      readFileSync(fragment, "utf8"),
      /^\s*CONFIG_DRM_PANFROST\s*=\s*y\s*$/m,
      `${device}: fragmento deve ligar CONFIG_DRM_PANFROST=y`,
    );
    assert.match(
      readFileSync(required, "utf8"),
      /^\s*CONFIG_DRM_PANFROST\s*=\s*y\s*$/m,
      `${device}: kernel-required.txt deve exigir CONFIG_DRM_PANFROST=y`,
    );
  }
});
