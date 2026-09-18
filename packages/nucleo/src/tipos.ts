// GERADO POR infra/ci/gerar-tipos.mjs — NÃO EDITE À MÃO.
// Derivado dos artefatos congelados em docs/contracts/. Para mudar um valor,
// altere o contrato e abra solicitação em docs/contracts/MUDANCAS.md.

export type EstadoContrato =
  | 'RASCUNHO'
  | 'EM_VERIFICACAO'
  | 'REGISTRADO'
  | 'ESPELHADO'
  | 'ATIVO'
  | 'EM_DISPUTA'
  | 'INADIMPLENTE'
  | 'LIQUIDADO'
  | 'EXECUTADO';

export type SituacaoConciliacao =
  | 'NAO_APLICAVEL'
  | 'PENDENTE'
  | 'CONCILIADO'
  | 'DIVERGENTE'
  | 'CONGELADO';

export type TipoDivergencia =
  | 'TITULO_BAIXADO_NO_REGISTRO'
  | 'CESSAO_NAO_REFLETIDA'
  | 'VALOR_FACE_ALTERADO'
  | 'QUANTIDADE_ALTERADA'
  | 'VENCIMENTO_ALTERADO'
  | 'GARANTIA_ALTERADA'
  | 'ONUS_OU_GRAVAME_NAO_REFLETIDO'
  | 'TITULO_INEXISTENTE_NO_REGISTRO'
  | 'TOKEN_AUSENTE_PARA_REGISTRO'
  | 'DUPLICIDADE_DE_ANCORA'
  | 'ESTADO_DIVERGENTE'
  | 'HASH_DOCUMENTAL_DIVERGENTE'
  | 'TRANSFERENCIA_SEM_CESSAO'
  | 'FRACIONAMENTO_NAO_REFLETIDO';

export type Severidade =
  | 'INFORMATIVA'
  | 'BAIXA'
  | 'MEDIA'
  | 'ALTA'
  | 'CRITICA';

export type EstadoDivergencia =
  | 'ABERTA'
  | 'EM_RECONCILIACAO'
  | 'RECONCILIADA'
  | 'FALSO_POSITIVO';

export type TipoGarantia =
  | 'PENHOR_SAFRA'
  | 'ALIENACAO_FIDUCIARIA_IMOVEL'
  | 'ALIENACAO_FIDUCIARIA_MAQUINA'
  | 'HIPOTECA'
  | 'AVAL'
  | 'FIANCA'
  | 'SEGURO_AGRICOLA'
  | 'CESSAO_RECEBIVEL'
  | 'FUNDO_MUTUALIZADO'
  | 'CAUCAO_TOKEN';

export type EstadoExcussao =
  | 'NAO_ACIONADA'
  | 'NOTIFICADA'
  | 'EM_EXCUSSAO'
  | 'EXCUTIDA'
  | 'FRUSTRADA';

export type TipoLeitura =
  | 'PRECO'
  | 'GEOESPACIAL'
  | 'FISCAL'
  | 'CLIMATICO'
  | 'PAGAMENTO'
  | 'REGISTRO';

export type EstadoLeitura =
  | 'COLETANDO'
  | 'EFETIVA'
  | 'DEGRADADA'
  | 'SEM_QUORUM'
  | 'EM_DISPUTA'
  | 'INVALIDADA';

export type CriticidadeLeitura =
  | 'INFORMATIVA'
  | 'CONTRATUAL';

export type ResultadoEudr =
  | 'CONFORME'
  | 'NAO_CONFORME'
  | 'LIMITROFE'
  | 'INCONCLUSIVO';

export type EstadoDds =
  | 'RASCUNHO'
  | 'EMITIDA'
  | 'SUBSTITUIDA'
  | 'REVOGADA';

export type PorteProdutor =
  | 'PEQUENO'
  | 'MEDIO'
  | 'GRANDE';

export type SituacaoKyc =
  | 'NAO_INICIADO'
  | 'EM_ANALISE'
  | 'APROVADO'
  | 'REPROVADO'
  | 'EXPIRADO'
  | 'ELIMINADO';

export type Commodity =
  | 'CAFE_ARABICA'
  | 'CAFE_CONILON';

export type EtapaVerificacao =
  | 'KYC_DOCUMENTO'
  | 'KYC_LISTAS'
  | 'CAR_SICAR'
  | 'POLIGONO_INGESTAO'
  | 'POLIGONO_VALIDACAO'
  | 'EUDR_CRUZAMENTO'
  | 'EUDR_EVIDENCIA'
  | 'DDS_EMISSAO'
  | 'REGISTRO_CONSULTA'
  | 'CONCILIACAO_CICLO'
  | 'PRECO_COLETA'
  | 'PAGAMENTO_CONFIRMACAO'
  | 'AVERBACAO_GARANTIA'
  | 'ANALISE_HUMANA';

/** Transições permitidas, na mesma ordem em que o DDL as insere. */
export const TRANSICOES_PERMITIDAS: ReadonlyArray<
  readonly [EstadoContrato, EstadoContrato, string]
> = [
  ['RASCUNHO', 'EM_VERIFICACAO', 'dados_minimos_preenchidos'],
  ['EM_VERIFICACAO', 'RASCUNHO', 'verificacao_reprovada'],
  ['EM_VERIFICACAO', 'REGISTRADO', 'registro_confirmado_pela_entidade'],
  ['REGISTRADO', 'ESPELHADO', 'ancora_unica_e_emissao_confirmada'],
  ['ESPELHADO', 'ATIVO', 'conciliacao_inicial_conforme'],
  ['ATIVO', 'EM_DISPUTA', 'divergencia_critica_ou_contestacao'],
  ['ATIVO', 'INADIMPLENTE', 'vencido_sem_liquidacao'],
  ['ATIVO', 'LIQUIDADO', 'pagamento_conciliado_e_baixa_no_registro'],
  ['EM_DISPUTA', 'ATIVO', 'divergencia_reconciliada'],
  ['EM_DISPUTA', 'INADIMPLENTE', 'disputa_resolvida_contra_devedor'],
  ['EM_DISPUTA', 'EXECUTADO', 'decisao_de_excussao'],
  ['INADIMPLENTE', 'LIQUIDADO', 'pagamento_conciliado_e_baixa_no_registro'],
  ['INADIMPLENTE', 'EXECUTADO', 'waterfall_percorrido'],
  ['INADIMPLENTE', 'EM_DISPUTA', 'contestacao_do_devedor'],
] as const;

/** Política de severidade por tipo de divergência, conforme o DDL. */
export const POLITICA_DIVERGENCIA: ReadonlyArray<{
  tipo: TipoDivergencia; severidade: Severidade; congela: boolean; slaDeteccao: string; acao: string;
}> = [
  { tipo: 'TITULO_BAIXADO_NO_REGISTRO', severidade: 'CRITICA', congela: true, slaDeteccao: '15 minutes', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'CESSAO_NAO_REFLETIDA', severidade: 'CRITICA', congela: true, slaDeteccao: '15 minutes', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'VALOR_FACE_ALTERADO', severidade: 'CRITICA', congela: true, slaDeteccao: '15 minutes', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'QUANTIDADE_ALTERADA', severidade: 'CRITICA', congela: true, slaDeteccao: '15 minutes', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'VENCIMENTO_ALTERADO', severidade: 'ALTA', congela: true, slaDeteccao: '1 hour', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'GARANTIA_ALTERADA', severidade: 'ALTA', congela: true, slaDeteccao: '1 hour', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'ONUS_OU_GRAVAME_NAO_REFLETIDO', severidade: 'CRITICA', congela: true, slaDeteccao: '15 minutes', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'TITULO_INEXISTENTE_NO_REGISTRO', severidade: 'CRITICA', congela: true, slaDeteccao: '15 minutes', acao: 'CONGELAR_E_ESCALAR' },
  { tipo: 'TOKEN_AUSENTE_PARA_REGISTRO', severidade: 'MEDIA', congela: false, slaDeteccao: '6 hours', acao: 'ABRIR_INCIDENTE' },
  { tipo: 'DUPLICIDADE_DE_ANCORA', severidade: 'CRITICA', congela: true, slaDeteccao: '1 minute', acao: 'CONGELAR_AMBOS_E_ESCALAR' },
  { tipo: 'TRANSFERENCIA_SEM_CESSAO', severidade: 'CRITICA', congela: true, slaDeteccao: '5 minutes', acao: 'CONGELAR_E_ESCALAR' },
  { tipo: 'FRACIONAMENTO_NAO_REFLETIDO', severidade: 'CRITICA', congela: true, slaDeteccao: '5 minutes', acao: 'CONGELAR_E_ESCALAR' },
  { tipo: 'ESTADO_DIVERGENTE', severidade: 'ALTA', congela: true, slaDeteccao: '1 hour', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
  { tipo: 'HASH_DOCUMENTAL_DIVERGENTE', severidade: 'ALTA', congela: true, slaDeteccao: '1 hour', acao: 'CONGELAR_E_ABRIR_INCIDENTE' },
];
