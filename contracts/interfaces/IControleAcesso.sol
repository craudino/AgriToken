// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

/// @title Controle de acesso por papéis
/// @notice Separa quem espelha de quem concilia e de quem reconcilia. A
///         separação não é burocracia: é o que impede que o mesmo processo
///         que detecta a divergência também a dispense (P1).
/// @dev    O papel de reconciliação é de titularidade humana e sujeito a
///         multiassinatura; nenhuma chave de serviço o detém. Alterações de
///         papel passam por timelock — ver ADR-0004.
interface IControleAcesso {
    event PapelConcedido(bytes32 indexed papel, address indexed conta, address indexed autor);
    event PapelRevogado(bytes32 indexed papel, address indexed conta, address indexed autor);
    event PapelPropostoComTimelock(bytes32 indexed papel, address indexed conta, uint256 executavelEm);
    event PropostaCancelada(bytes32 indexed papel, address indexed conta, bytes32 motivoHash);

    error SemPapel(bytes32 papel, address conta);
    error TimelockPendente(uint256 executavelEm);
    error PapelHumanoIndelegavel(bytes32 papel);
    error PropostaInexistente(bytes32 papel, address conta);
    error PapelExigeTimelock(bytes32 papel);

    /// @notice Origina contratos e submete rascunhos.
    function PAPEL_ORIGINADOR() external view returns (bytes32);

    /// @notice Emite o espelho de títulos já registrados.
    function PAPEL_ESPELHADOR() external view returns (bytes32);

    /// @notice Executa a conciliação e congela por divergência.
    function PAPEL_CONCILIADOR() external view returns (bytes32);

    /// @notice Descongela após reconciliação. Humano, multiassinado,
    ///         indelegável a chave de serviço.
    function PAPEL_RECONCILIADOR_HUMANO() external view returns (bytes32);

    /// @notice Publica leituras de oráculo com quórum já apurado off-chain.
    function PAPEL_ORACULO() external view returns (bytes32);

    /// @notice Pausa emergencial. Pausa não descongela nem altera estado.
    function PAPEL_PAUSA() external view returns (bytes32);

    /// @notice Administração de papéis, sujeita a timelock.
    function PAPEL_ADMIN() external view returns (bytes32);

    function temPapel(bytes32 papel, address conta) external view returns (bool);

    /// @notice Propõe a concessão de um papel sensível.
    /// @dev    SMC-005. O timelock existia como evento e getter, e `conceder`
    ///         era chamada única e imediata — o red team apontou em G1 que a
    ///         garantia estava no NatSpec, não no código. A proposta é agora
    ///         etapa obrigatória para os papéis sensíveis, e o intervalo entre
    ///         proposta e execução é o que dá ao credor tempo de observar uma
    ///         mudança nas regras do ativo que ele detém.
    /// @return executavelEm Instante a partir do qual a proposta pode ser executada.
    function propor(bytes32 papel, address conta) external returns (uint256 executavelEm);

    /// @notice Executa proposta cujo timelock venceu.
    function executarProposta(bytes32 papel, address conta) external;

    /// @notice Cancela proposta pendente.
    function cancelarProposta(bytes32 papel, address conta, bytes32 motivoHash) external;

    /// @return Instante de execução da proposta pendente, ou zero se não houver.
    function propostaExecutavelEm(bytes32 papel, address conta) external view returns (uint256);

    /// @return Verdadeiro se o papel exige proposta e timelock.
    function papelSensivel(bytes32 papel) external view returns (bool);

    /// @notice Concede papel não sensível, de efeito imediato.
    /// @dev    Reverte para papel sensível: esses passam por propor/executar.
    function conceder(bytes32 papel, address conta) external;

    /// @notice Revoga papel. Revogação é imediata por desenho — atrasar a
    ///         retirada de um papel comprometido seria proteger o atacante.
    function revogar(bytes32 papel, address conta) external;

    /// @return Atraso mínimo, em segundos, entre proposta e concessão de papel sensível.
    function atrasoTimelock() external view returns (uint256);
}
