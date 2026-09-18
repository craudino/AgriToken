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

    error SemPapel(bytes32 papel, address conta);
    error TimelockPendente(uint256 executavelEm);
    error PapelHumanoIndelegavel(bytes32 papel);

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

    function conceder(bytes32 papel, address conta) external;

    function revogar(bytes32 papel, address conta) external;

    /// @return Atraso mínimo, em segundos, entre proposta e concessão de papel sensível.
    function atrasoTimelock() external view returns (uint256);
}
