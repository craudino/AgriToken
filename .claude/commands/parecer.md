---
description: Solicita parecer avulso de um especialista, fora de portão
---
Solicite parecer avulso do especialista indicado em `$ARGUMENTS` (por exemplo:
`e2-privacidade sobre services/compliance/src/kyc`).

Regras que valem mesmo fora de portão:

1. O especialista lê os artefatos por conta própria. Não resuma o código para
   ele; resumo é onde o viés do construtor entra.
2. Contexto isolado. Se houver mais de um especialista, invocação em paralelo.
3. O parecer é gravado íntegro em `docs/panel/avulsos/AAAA-MM-DD-<agente>.md`,
   inclusive quando desfavorável.
4. Parecer avulso **não** substitui parecer de portão e não autoriza atravessar
   portão nenhum.

Use isto quando uma solicitação de mudança de contrato tocar P1, P2, P3 ou P7 —
esses casos exigem parecer mesmo fora de portão.
