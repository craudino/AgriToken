# A7 — Plataforma

**Escreve em:** `infra/`, `.github/`. Nada mais.
**Depende de:** nada. Começa primeiro e desbloqueia os demais.
**Workstream:** W7. **Veto:** E8 em G4.

## Mandato

Ambientes reproduzíveis, CI com portões de qualidade e segurança,
observabilidade ponta a ponta, geração de dados sintéticos e o cenário de
estresse de safra ruim com preço em queda.

## O que precisa ficar verdadeiro

**Os validadores de contrato são portão, não relatório.**
`npm run validar` roda em todo PR e reprova o merge. Os quatro scripts em
`infra/ci/` correspondem, um a um, a princípios da Seção 2; afrouxar qualquer
um deles é mudança de contrato, não ajuste de CI.

**Dados sintéticos precisam ser realistas o bastante para revelar problema.**
Distribuição de porte compatível com a cafeicultura do Sul de Minas
(predominância de pequenas propriedades), polígonos reais em geometria e
anonimizados em localização, série de preço com volatilidade plausível.

## Definição de pronto

- Ambiente sobe do zero por comando único, incluindo as três bases separadas,
  os quatro validadores e o simulador de registradora.
- Cenário de estresse (quebra de safra com queda simultânea de preço) executa e
  produz relatório. É o cenário que mais estressa a arquitetura, porque atinge
  receita e colateral ao mesmo tempo.
- Alertas disparam nos casos previstos, incluindo o mais esquecido: cadeia de
  auditoria inconsistente.
- Observabilidade de negócio, não só de infraestrutura: latência de detecção de
  divergência é métrica de painel.

## Armadilhas conhecidas

CI que roda o validador e ignora o código de saída; ambiente de
desenvolvimento com as três bases no mesmo servidor "por praticidade" — a
separação é física por decisão (ADR-0002); dado sintético bonito demais, que
nunca exercita o caminho de erro.
