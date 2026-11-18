// O `scripts/entrada-probe.py`: a única prova de que o controle virtual
// **entrega** evento.
//
// O defeito de 18/11/2026 (§12.75) foi exatamente a diferença entre "o device
// existe" e "o app recebe": o daemon traduzia, logava, criava o nó com as
// capabilities certas — e não escrevia `EV_SYN/SYN_REPORT`, então o `evdev`
// nunca publicava o pacote. O `giochi-selftest` não pegava (ele confere nó e
// capabilities) e o teste de texto também não pegaria se a escrita do SYN
// sumisse mantendo o comentário.
//
// Por isso o probe roda o binário de verdade, com um device físico sintético
// via `uinput`: é o único nível que separa intenção de entrega. Sem
// `/dev/uinput` gravável (o caso do CI), ele vira `skip` explícito — "não deu
// para medir" não é "está errado" (§12.34).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const PROBE = join(ROOT, "scripts/entrada-probe.py");
const FONTE = readFileSync(PROBE, "utf8");

function rodar(args, env = {}) {
    try {
        const saida = execFileSync("python3", [PROBE, ...args], {
            encoding: "utf8",
            env: { ...process.env, ...env },
            stdio: "pipe",
        });
        return { codigo: 0, saida };
    } catch (erro) {
        return {
            codigo: erro.status ?? -1,
            saida: `${erro.stdout ?? ""}${erro.stderr ?? ""}`,
        };
    }
}

test("o probe compila e o arquivo é Python válido", () => {
    // `py_compile` cria `__pycache__/` ao lado do script; o `.gitignore` cobre.
    execFileSync("python3", ["-m", "py_compile", PROBE], { stdio: "pipe" });
});

test("sem /dev/uinput o probe diz SKIP e sai 0 — não reprova o que não mediu", () => {
    const r = rodar([], { GIOCHI_UINPUT: "/dev/uinput-que-nao-existe" });
    assert.equal(r.codigo, 0, `esperava 0 (SKIP), veio ${r.codigo}:\n${r.saida}`);
    assert.match(r.saida, /^SKIP /m, "o caminho de degradação tem de ser explícito");
});

test("o probe pergunta pela ENTREGA, não pela existência do nó", () => {
    // Se alguém trocar a asserção por "o device existe", o probe volta a dar
    // PASS no defeito que ele existe para pegar.
    assert.match(FONTE, /SYN_REPORT/, "tem de exigir o SYN_REPORT no que chegou");
    assert.match(FONTE, /nenhum EV_KEY chegou ao virtual/,
        "sem evento, tem de falhar mencionando a consequência");
    assert.match(FONTE, /return 1/, "violação do contrato tem de sair != 0");
    assert.match(FONTE, /CANONICO\[alvo\]/,
        "o código esperado vem do contrato, não do que o daemon mandou");

    // A comparação é com o MAPA, não com um código fixo: o X35S troca A/B e um
    // probe com código cravado passaria no aparelho errado.
    assert.match(FONTE, /fisicos\[alvo\]/, "o código fisico injetado vem do mapa");
});

test("o probe roda de verdade quando /dev/uinput está disponível", () => {
    // Não é `skip` incondicional: numa máquina de desenvolvimento (que é onde
    // se depura o daemon) ele exercita o caminho completo.
    const podeRodar = (() => {
        try {
            execFileSync("test", ["-w", "/dev/uinput"], { stdio: "pipe" });
            execFileSync("sh", ["-c", "command -v cc >/dev/null || command -v gcc >/dev/null"],
                { stdio: "pipe" });
            return true;
        } catch {
            return false;
        }
    })();

    const r = rodar(["--mapa", "device/powkiddy x55/buttons.map", "--espera", "0.4"]);
    if (!podeRodar) {
        assert.match(r.saida, /^(SKIP|PASS)/m,
            `sem prerequisito o probe tem de dizer SKIP ou PASS:\n${r.saida}`);
        return;
    }
    assert.equal(r.codigo, 0, `o contrato falhou:\n${r.saida}`);
    assert.match(r.saida, /^PASS /m, "com uinput, tem de provar a entrega");
    assert.match(r.saida, /\+ SYN_REPORT/, "e tem de mostrar que o pacote fechou");
});
