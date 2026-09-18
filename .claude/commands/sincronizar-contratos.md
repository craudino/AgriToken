---
description: Ponto de sincronização de contratos ao fim de uma fase
---
Execute o ponto de sincronização de contratos.

Objetivo: encontrar **divergência silenciosa** entre implementação e
especificação antes que ela se espalhe. É o risco de maior probabilidade da
tabela da Seção 11 do briefing, e o que o torna caro é a demora em detectá-lo.

Verifique, nesta ordem:

1. `npm run validar` — verde, com a saída anexada. Código de saída, não a
   impressão de que passou.
2. **ABIs**: `docs/contracts/abi/*.json` conferindo com `contracts/interfaces/`.
3. **Enums**: os da API coincidindo com os do banco (já coberto pelo validador;
   confirme que o teste não foi afrouxado).
4. **Rotas**: toda rota declarada nas OpenAPI existe no serviço, e todo
   endpoint do serviço está declarado. Rota implementada e não declarada é tão
   grave quanto o inverso — é contrato que os outros agentes não conhecem.
5. **Eventos**: todo tipo publicado está no catálogo, com produtor correto.
6. **Esquema**: as migrações aplicadas correspondem ao DDL congelado, mais as
   migrações aprovadas por solicitação de mudança.
7. **`docs/contracts/MUDANCAS.md`**: toda SMC decidida; nenhuma implementação
   antecipando SMC pendente.

Produza `docs/panel/sincronizacao-<fase>.md` com o que divergiu, desde quando
(use o log do git) e o custo de reconciliar. Divergência encontrada não é
falha do agente: é o mecanismo funcionando.
