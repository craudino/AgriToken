# ADR-0007 — Resolver a tensão entre congelamento (P1) e não-controle (P7) por limitação do poder, não por sua negação

- **Estado:** Proposto — decorrente da decisão humana em G1
- **Data:** 2026-09-18
- **Decisores:** orquestrador; veto de E1 em G3 e G4; E4 em G3 e G4
- **Portão:** G1 (retroativo — tensão apontada pelo red team, ataque nº 3)

## Contexto

O red team apontou, como o ataque mais difícil de rebater, uma contradição
entre dois princípios do próprio briefing:

- Para **P1** ser verdadeiro, a plataforma precisa poder impedir
  unilateralmente a disposição de um ativo de terceiro — é o congelamento por
  divergência, e o briefing elege sua demonstração como o teste mais importante
  do MVP.
- Para **P7** ser verdadeiro, a plataforma precisa **não** poder fazer isso —
  administrar instrumentos de controle sobre representação digital de valor
  alheio é a descrição de uma atividade regulada.

O incômodo é que quanto melhor a demonstração de P1, mais forte a acusação
sobre P7. Não é bug: é escolha de desenho que estava sendo feita em silêncio.

## Alternativas consideradas

**Remover o congelamento.** Resolve P7 e destrói P1: sem congelamento, a
divergência é detectada e nada acontece, e o espelho pode ser negociado
enquanto diverge do registro. Rejeitada — elimina a razão de ser do MVP.

**Manter o congelamento sem limites.** Rejeitada: é a hipótese que o red team
ataca, e com razão. Congelamento sem prazo, sem critério e sem recurso é
controle discricionário sobre ativo de terceiro.

**Transferir o poder de congelar para a registradora.** Conceitualmente
superior: quem detém a verdade deveria deter o freio. Rejeitada para o MVP por
não haver integração real; fica registrada como o desenho-alvo.

## Decisão

Manter o congelamento, **limitando-o em quatro dimensões** para que seja
exercício de dever contratual e não de discricionariedade:

1. **Vinculado a fato objetivo.** Só congela por divergência classificada, com
   os dois lados da comparação gravados. Não existe congelamento por decisão
   comercial.
2. **Restrito em efeito.** Congelar suspende **circulação**; não extingue,
   não transfere, não altera termos econômicos e não executa garantia. O
   detentor continua titular do que detém.
3. **Limitado no tempo.** Congelamento sem reconciliação em até **30 dias
   corridos** escala para decisão externa, e o prazo aparece no painel do
   detentor desde o primeiro dia. Congelamento indefinido é o que caracteriza
   controle.
4. **Recorrível.** O detentor abre contestação, que é registrada e respondida.
   A ausência de recurso é o que transforma freio em poder.

E, para que isso não dependa de boa conduta do operador: o descongelamento
exige divergência efetivamente reconciliada por **operador humano
identificado** e ator humano na transição — implementado como restrição de
banco (SMC-001), depois que o red team demonstrou que uma string bastava.

## Consequências

Positivas: o congelamento vira obrigação verificável, com prazo e recurso; o
detentor sabe de antemão o que pode acontecer, por qual motivo e por quanto
tempo.

Negativas, e continuam existindo: nenhuma das quatro limitações elimina o fato
de que **um terceiro pode imobilizar o ativo de outro**. A plataforma reduz a
discricionariedade a quase zero e continua sendo quem aperta o botão. Se um
fiscal entender que o poder importa mais que sua limitação, este ADR é a
defesa, não a absolvição.

Consequência operacional: o prazo de 30 dias cria obrigação de resposta que a
equipe precisa conseguir cumprir. Prazo escrito e não cumprido é pior que
prazo ausente.

## Critérios de revisão

1. Primeiro congelamento que atinja o prazo de 30 dias sem reconciliação.
2. Contestação de detentor sobre congelamento — a primeira testa se o recurso é
   real ou decorativo.
3. Integração com registradora real, quando o poder de freio pode migrar para
   quem detém a verdade.
4. Manifestação de autoridade sobre estrutura análoga.

## Veto e ressalvas

O red team considera este o ponto mais difícil de rebater, e este ADR não o
rebate: limita, declara e datilografa o risco residual. E1 tem veto em G3 e G4
sobre a suficiência dessa limitação.

## Fontes

Nenhuma fonte externa sustenta o prazo de 30 dias; é parâmetro de engenharia
calibrável, escolhido por ser curto o bastante para não configurar imobilização
indefinida e longo o bastante para uma reconciliação envolvendo terceiros. [#REF]
