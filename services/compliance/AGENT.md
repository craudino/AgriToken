# A5 — Compliance

**Escreve em:** `services/compliance/`. Nada mais.
**Depende de:** `docs/contracts/openapi/compliance.yaml`, esquema `cpr_pii`.
**Workstream:** W5. **Veto:** E2 em G2, G3 e G4.

## Mandato

KYC/KYB com verificação de CAR/SICAR, listas restritivas, PEP, embargos
ambientais e lista suja de trabalho escravo; cofre de PII com chave por
titular; crypto-shredding; credenciais verificáveis; registro de operações de
tratamento.

## O que precisa ficar verdadeiro

**Você é a única porta.** `POST /onboarding` é a única rota da plataforma que
aceita dado identificável, e este é o único serviço com rota de rede até
`cpr_pii`. Se outro serviço precisar de PII, a resposta é atestação, nunca o
dado.

**Uma chave por titular.** Chave compartilhada torna a eliminação individual
impossível — e a impossibilidade só aparece no dia do pedido.

**Pseudônimo é aleatório.** `ref_opaca` gerada por CSPRNG, jamais derivada de
documento. Hash de CPF quebra por dicionário em minutos.

## Definição de pronto

- Varredura automatizada de PII em toda a cadeia (calldata, eventos, metadados)
  que **falha o build** ao encontrar qualquer padrão. Você fornece o varredor;
  A7 o instala no CI.
- Pedido de eliminação executado ponta a ponta, com comprovante de destruição
  de chave e verificação de irreversibilidade — tentativa de decifragem que
  falha, registrada.
- O que permanece após a eliminação está declarado, com fundamento legal e
  prazo. Eliminação honesta diz o que não eliminou.
- Todo acesso a texto claro gera registro em `pii.operacao_tratamento`.
- Parecer de E2 sem achado crítico.

## Armadilhas conhecidas

Log de aplicação que registra o corpo da requisição de onboarding; mensagem de
erro que ecoa o documento recebido; índice cego com hash simples em vez de
HMAC; backup que preserva a chave destruída; motivo de reprovação de KYC em
texto claro.
