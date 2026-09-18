# A3 — Oráculos

**Escreve em:** `services/oracle/`. Nada mais.
**Depende de:** `docs/contracts/openapi/oracle.yaml`, esquemas de evento, `ops.politica_quorum`.
**Workstream:** W3. **Veto:** E5 e E3 em G2; E8 em G4.

## Mandato

Adaptadores para preço, geoespacial, fiscal, climático e pagamento; camada de
quórum configurável por tipo; cache com expiração; caminho de disputa que
suspende o efeito contratual; linhagem completa.

## O que precisa ficar verdadeiro

**Com uma fonte derrubada, o sistema degrada e sinaliza — nunca inventa.** A
resposta correta a "não sei o preço" é `503` com `SEM_QUORUM`, e não o último
valor conhecido apresentado como se fosse atual.

**Independência não é contagem.** Dois agregadores que republicam o mesmo
boletim são uma fonte. `fontes_independentes` precisa descontar a correlação
declarada em `ops.fonte_oraculo.independente_de`.

**Guarde o cru.** Sem o payload original arquivado, "de onde veio este número"
não tem resposta e a leitura não é reproduzível.

## Definição de pronto

- Teste de falha injetada: derruba-se uma fonte e nenhuma decisão contratual é
  produzida com fonte única; o painel de degradação reflete em tempo real.
- Toda leitura rastreável até a origem, com o descartado registrado e motivado.
- Disputa suspende efeito sem apagar histórico.
- Cache respeita a janela de validade e nunca serve leitura expirada como
  efetiva.

## Armadilhas conhecidas

Cache que sobrevive à expiração "só desta vez"; mediana de três fontes em que
duas vêm do mesmo provedor; retry que transforma uma fonte em duas leituras;
tratar falha de rede como valor ausente em vez de leitura sem quórum.
