# MVP CPR Digital

Espelho on-chain de Cédula de Produto Rural registrada, com conciliação
contínua entre registro e token, motor de conformidade EUDR, oráculos com
quórum e simulação de waterfall de garantias.

O propósito deste repositório não é demonstrar que dá para tokenizar — isso já
está demonstrado no mercado. É **comprar informação sob incerteza**: cada
módulo existe para fechar uma lacuna informacional específica, listada na
Seção 1.1 de `docs/BRIEFING.md`. O critério de sucesso não é "o sistema
funciona", e sim "o sistema produz evidência que altera uma decisão de
investimento".

## Estado

**Fase 0 concluída — aguardando o portão G1.** Os contratos estão congelados;
nenhuma implementação foi escrita, por determinação do briefing: se G1
reprovar, nenhuma linha é escrita.

## Por onde começar

| Quero | Leia |
|---|---|
| Entender o projeto | `docs/BRIEFING.md` |
| Trabalhar no código | `CLAUDE.md` e o `AGENT.md` do seu diretório |
| Entender uma decisão | `docs/adr/` |
| Consumir uma API | `docs/contracts/openapi/README.md` |
| Entender o modelo de dados | `docs/contracts/db/README.md` |
| Ver o que o painel disse | `docs/panel/` |

## Verificação

```bash
npm install
npm run validar
```

Quatro validadores, todos correspondendo a princípios arquiteturais: recusam
PII em esquema, evento ou ABI; recusam leitura contratual de fonte única;
recusam função de custódia ou novação nos contratos; recusam divergência entre
a especificação congelada e o que foi implementado.

## Licença

BUSL-1.1 nos contratos. Demais arquivos, restritos — documento de classificação
restrita, conforme cabeçalho do briefing.
