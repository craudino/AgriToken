// GERADO POR infra/ci/gerar-tipos.mjs — NÃO EDITE À MÃO.
// Derivado dos artefatos congelados em docs/contracts/. Para mudar um valor,
// altere o contrato e abra solicitação em docs/contracts/MUDANCAS.md.

export interface EntradaCatalogo {
  tipo: string;
  produtor: string;
  consumidores: string[];
  sujeito: string;
  auditavel: boolean;
  exige_evidencia: boolean;
}

export const CATALOGO_EVENTOS: ReadonlyArray<EntradaCatalogo> = [
  {"tipo":"contrato.rascunho-criado","produtor":"A2","consumidores":["A6"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":false},
  {"tipo":"contrato.registrado","produtor":"A2","consumidores":["A1","A6"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"contrato.espelhado","produtor":"A2","consumidores":["A6","A7"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"contrato.transicionado","produtor":"A2","consumidores":["A6","A7"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"conciliacao.divergencia-detectada","produtor":"A2","consumidores":["A1","A6","A7"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"conciliacao.contrato-congelado","produtor":"A2","consumidores":["A1","A6","A7"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"conciliacao.divergencia-reconciliada","produtor":"A2","consumidores":["A1","A6"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"oraculo.leitura-efetivada","produtor":"A3","consumidores":["A2","A4","A6"],"sujeito":"LEITURA","auditavel":true,"exige_evidencia":true},
  {"tipo":"oraculo.quorum-perdido","produtor":"A3","consumidores":["A2","A4","A6","A7"],"sujeito":"LEITURA","auditavel":true,"exige_evidencia":false},
  {"tipo":"oraculo.disputa-aberta","produtor":"A3","consumidores":["A2","A6"],"sujeito":"LEITURA","auditavel":true,"exige_evidencia":true},
  {"tipo":"mercado.marcacao-atualizada","produtor":"A2","consumidores":["A6"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"eudr.evidencia-gerada","produtor":"A4","consumidores":["A2","A6"],"sujeito":"TALHAO","auditavel":true,"exige_evidencia":true},
  {"tipo":"eudr.dds-emitida","produtor":"A4","consumidores":["A2","A6"],"sujeito":"DDS","auditavel":true,"exige_evidencia":true},
  {"tipo":"garantia.vinculada","produtor":"A2","consumidores":["A1","A6"],"sujeito":"GARANTIA","auditavel":true,"exige_evidencia":false},
  {"tipo":"garantia.excussao-registrada","produtor":"A2","consumidores":["A6"],"sujeito":"GARANTIA","auditavel":true,"exige_evidencia":true},
  {"tipo":"contrato.liquidado","produtor":"A2","consumidores":["A1","A6"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"privacidade.titular-eliminado","produtor":"A5","consumidores":["A2","A6"],"sujeito":"TITULAR","auditavel":true,"exige_evidencia":true},
  {"tipo":"plataforma.incidente-aberto","produtor":"A7","consumidores":["A6"],"sujeito":"PLATAFORMA","auditavel":true,"exige_evidencia":false},
  {"tipo":"contrato.titularidade-alterada","produtor":"A2","consumidores":["A6","A7"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":true},
  {"tipo":"eudr.selo-revogado","produtor":"A4","consumidores":["A2","A6"],"sujeito":"TALHAO","auditavel":true,"exige_evidencia":true},
  {"tipo":"eudr.dds-revogada","produtor":"A4","consumidores":["A2","A6"],"sujeito":"DDS","auditavel":true,"exige_evidencia":true},
  {"tipo":"compliance.participante-desabilitado","produtor":"A5","consumidores":["A1","A2","A6"],"sujeito":"PRODUTOR","auditavel":true,"exige_evidencia":true},
  {"tipo":"credor.reacao-registrada","produtor":"A6","consumidores":["A2"],"sujeito":"CONTRATO","auditavel":true,"exige_evidencia":false},
];
