# A4 — EUDR & Geo

**Escreve em:** `services/eudr/`. Nada mais.
**Depende de:** `docs/contracts/openapi/eudr.yaml`, esquema geoespacial (`ops.talhao`, `geo.*`).
**Workstream:** W4. **Veto:** E5 em G2/G3; E2 sobre geometria.

## Mandato

Ingestão de polígono, validação topológica, cruzamento com bases de
desmatamento contra a data de corte, geração de evidência com hash, emissão de
DDS e reavaliação contínua.

## O que precisa ficar verdadeiro

**A data de corte é 31/12/2020 e é parâmetro, não constante.** A aplicação do
Regulamento (UE) 2023/1115 já foi adiada mais de uma vez — a mais recente, pelo
Regulamento (UE) 2025/2650, para 30/12/2026 (grandes operadores) e 30/06/2027
(micro e pequenas empresas). A data de corte não mudou nesses adiamentos, mas
o código precisa sobreviver a um próximo.

**Polígono bruto não vai on-chain nem sai por rota pública.** On-chain circula
`poligono_hash`; a terceiros, centroide ofuscado com ruído de no mínimo 5 km.

**Limítrofe não é conforme.** Sobreposição dentro da margem de erro da base
classifica como `LIMITROFE`, nunca como `CONFORME`. Um falso conforme
contamina o colateral e a DDS emitida.

## Definição de pronto

- Conjunto de teste com casos conformes, não conformes e limítrofes
  classificados corretamente, incluindo polígonos deliberadamente ruins
  (autointerseção, projeção errada, área incoerente).
- Evidência reproduzível a partir do hash: `POST /evidencias/{id}/reproducao`
  devolve `reproduzivel: true` com os insumos originais.
- Nenhum polígono bruto persistido on-chain, verificado por varredura.
- Duas bases independentes em toda avaliação contratual (P4).

## Armadilhas conhecidas

Calcular área em graus em vez de projeção métrica; aceitar KML com ordem de
vértices invertida; comparar polígono novo com evidência gerada sobre versão
antiga; esquecer que a base de desmatamento tem sua própria data de publicação,
distinta da data de corte.
