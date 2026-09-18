# Esquemas de evento e registro de auditoria

Artefato congelado da Fase 0.

| Arquivo | O que é |
|---|---|
| `envelope.schema.json` | Formato único de todo evento de domínio |
| `payloads.schema.json` | Um `$def` por tipo, com exemplo válido embutido |
| `catalogo.json` | Quem produz, quem consome, o que é auditável e o que exige evidência |
| `registro-auditoria.schema.json` | Forma canônica do que é gravado em `cpr_audit.registro` |

## Por que envelope e registro de auditoria são formatos distintos

Seria mais simples ter um só. Não são, por duas razões.

A primeira é de confiança: o registro de auditoria é encadeado por hash e vive
em base física separada, de modo que comprometer a base operacional não
permita reescrever a história. Um evento é uma mensagem; um registro de
auditoria é uma afirmação que resiste a quem tem credencial de administrador.

A segunda é de tempo: o envelope distingue `ocorrido_em` de `registrado_em`. A
diferença entre os dois é a latência de detecção — a métrica que responde à
lacuna informacional nº 1. Colapsar os dois campos destruiria justamente o
número que o MVP existe para produzir.

## Regras que valem para todo evento

1. `payload_hash` é o sha256 da forma canônica do payload — chaves ordenadas,
   sem espaços. A mesma canonicalização está implementada em `jsonb_canonical`
   na base de auditoria, e as duas são comparadas em CI (P6).
2. `origem` traz serviço **e versão**. Sem versão, um comportamento observado
   no log não é reproduzível.
3. `causa_id` reconstrói a cadeia causal, não apenas a cronológica. Em uma
   investigação, "o que causou isto" vale mais do que "o que veio antes".
4. Nenhum payload admite campo identificante. A verificação é automática em
   `infra/ci/validar-eventos.mjs` e reprova o build (P2).
5. Evento marcado `exige_evidencia` sem item em `evidencia` é evento inválido:
   afirmação sem lastro não entra na trilha (P5).
