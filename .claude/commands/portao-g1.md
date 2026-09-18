---
description: Executa o portão G1 — fronteira regulatória e coerência econômica
---
Execute o portão **G1 — Fronteira regulatória e coerência econômica**.

Critério do portão: a arquitetura proposta, se implementada como especificada,
não desloca a empresa para o perímetro de valor mobiliário, PSAV ou contraparte
central; e cada módulo mapeia para uma redução identificável de custo de
transação. **Se G1 reprovar, nenhuma linha de implementação é escrita.**

## Passo 1 — Pareceres independentes e simultâneos

Invoque **em uma única mensagem, em paralelo e com contexto isolado**:

- `e1-jurista-regulatorio`
- `e6-economista-institucional`
- `red-team-regulatorio`

Isto é o ponto crítico do protocolo: pareceres sequenciais contaminam-se
mutuamente e destroem a independência que justifica o painel. Nenhum
especialista vê o parecer do outro. Nenhum recebe resumo seu do repositório —
cada um lê os artefatos por conta própria.

## Passo 2 — Coleta

Grave cada parecer, na íntegra, em `docs/panel/G1/`:
`e1-parecer.md`, `e6-parecer.md`, `red-team-memorando.md`. Não edite o texto
dos pareceres. Se um parecer estiver mal fundamentado, isso também é
informação, e apagá-la é pior que registrá-la.

## Passo 3 — Consolidação com conflito explícito

Escreva `docs/panel/G1/dossie.md` contendo:

1. Veredicto de cada especialista, lado a lado.
2. Achados consolidados por severidade, com arquivo e linha.
3. **Seção de conflitos**, onde dois pareceres divergem. Destaque a
   divergência; não a suavize, não escolha um lado, não produza síntese
   conciliatória. Apresente os dois argumentos íntegros e deixe a decisão para
   o humano.
4. Mapeamento das oito capacidades da Seção 1.1 do briefing: cada uma está
   endereçada pelos artefatos da Fase 0? Quais lacunas informacionais a Fase 0
   já reduziu e quais permanecem abertas?
5. Recomendação do orquestrador, claramente identificada como tal e separada
   dos pareceres.

## Passo 4 — Regra antiviés

Se qualquer especialista invocar precedente ("no projeto X isso funcionou"),
registre no dossiê a pergunta de controle de contexto: *isso era verdade em que
contexto, e esse contexto vale aqui?* — com a resposta, ou com a anotação de
que não foi respondida.

## Passo 5 — Parada obrigatória

**Aguarde decisão humana.** Não inicie a Fase 1, não crie worktrees, não
escreva implementação. Apresente o dossiê e pare.
