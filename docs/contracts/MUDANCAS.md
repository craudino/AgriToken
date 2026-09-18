# Solicitações de mudança de contrato

`docs/contracts/` e `contracts/interfaces/` são congelados desde o fim da Fase
0. Congelado não quer dizer errado para sempre: quer dizer que muda por
processo, com quem depende sabendo antes.

## Como abrir

Acrescente uma seção ao fim deste arquivo, no PR que propõe a mudança:

```
## SMC-NNN — título curto
- Solicitante: A?
- Artefato: caminho do arquivo e do elemento (rota, tabela, campo, evento)
- Motivo: o que quebrou ou o que faltou. Não "seria melhor se".
- Impacto: quais agentes precisam mudar código, e o que exatamente.
- Compatibilidade: aditiva | quebrante. Se quebrante, plano de transição.
- Princípios tocados: P1..P7, e como seguem respeitados.
- Decisão: (preenchida pelo orquestrador) aceita | recusada | adiada para G?
```

## Regras

1. Mudança **aditiva** (campo opcional novo, rota nova, valor novo em enum de
   saída) pode ser aprovada pelo orquestrador dentro da fase.
2. Mudança **quebrante** só entra em ponto de sincronização de contratos, ao
   fim da fase, e exige ADR.
3. Mudança que afeta P1, P2, P3 ou P7 exige parecer do especialista com veto
   sobre aquele princípio, mesmo fora de portão.
4. Enquanto a SMC não for decidida, quem solicitou **não** implementa contra a
   mudança pretendida. Implementar na expectativa de aprovação é como o
   paralelismo sem contrato congelado falha.

## Registro

Nenhuma solicitação até o momento. A Fase 0 congelou os artefatos em
2026-09-18.
