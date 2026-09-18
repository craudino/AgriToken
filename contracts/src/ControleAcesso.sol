// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IControleAcesso} from "../interfaces/IControleAcesso.sol";

/// @title Controle de acesso por papéis, com timelock nos papéis sensíveis
/// @notice Separa quem espelha de quem concilia e de quem reconcilia. A
///         separação impede que o mesmo processo que detecta a divergência
///         também a dispense (P1).
/// @dev    SMC-005: antes, `conceder` era chamada única e imediata e o timelock
///         existia só no NatSpec. O red team apontou em G1 que a garantia
///         estava no comentário, não no código.
contract ControleAcesso is IControleAcesso {
    bytes32 private constant _ORIGINADOR = keccak256("PAPEL_ORIGINADOR");
    bytes32 private constant _ESPELHADOR = keccak256("PAPEL_ESPELHADOR");
    bytes32 private constant _CONCILIADOR = keccak256("PAPEL_CONCILIADOR");
    bytes32 private constant _RECONCILIADOR = keccak256("PAPEL_RECONCILIADOR_HUMANO");
    bytes32 private constant _ORACULO = keccak256("PAPEL_ORACULO");
    bytes32 private constant _PAUSA = keccak256("PAPEL_PAUSA");
    bytes32 private constant _ADMIN = keccak256("PAPEL_ADMIN");

    uint256 private immutable _atraso;

    mapping(bytes32 => mapping(address => bool)) private _papeis;
    mapping(bytes32 => mapping(address => uint256)) private _propostas;

    constructor(address admin, uint256 atrasoSegundos) {
        _atraso = atrasoSegundos;
        _papeis[_ADMIN][admin] = true;
        emit PapelConcedido(_ADMIN, admin, msg.sender);
    }

    modifier somenteAdmin() {
        if (!_papeis[_ADMIN][msg.sender]) revert SemPapel(_ADMIN, msg.sender);
        _;
    }

    function PAPEL_ORIGINADOR() external pure returns (bytes32) { return _ORIGINADOR; }
    function PAPEL_ESPELHADOR() external pure returns (bytes32) { return _ESPELHADOR; }
    function PAPEL_CONCILIADOR() external pure returns (bytes32) { return _CONCILIADOR; }
    function PAPEL_RECONCILIADOR_HUMANO() external pure returns (bytes32) { return _RECONCILIADOR; }
    function PAPEL_ORACULO() external pure returns (bytes32) { return _ORACULO; }
    function PAPEL_PAUSA() external pure returns (bytes32) { return _PAUSA; }
    function PAPEL_ADMIN() external pure returns (bytes32) { return _ADMIN; }

    function atrasoTimelock() external view returns (uint256) { return _atraso; }

    function temPapel(bytes32 papel, address conta) public view returns (bool) {
        return _papeis[papel][conta];
    }

    /// @notice Papéis que mudam as regras do ativo alheio, ou que o
    ///         imobilizam, passam por proposta e prazo. O credor precisa ter
    ///         tempo de observar a mudança — ver ADR-0004 e ADR-0007.
    function papelSensivel(bytes32 papel) public pure returns (bool) {
        return papel == _ADMIN || papel == _ESPELHADOR || papel == _RECONCILIADOR || papel == _PAUSA;
    }

    function propostaExecutavelEm(bytes32 papel, address conta) external view returns (uint256) {
        return _propostas[papel][conta];
    }

    function propor(bytes32 papel, address conta) external somenteAdmin returns (uint256 executavelEm) {
        executavelEm = block.timestamp + _atraso;
        _propostas[papel][conta] = executavelEm;
        emit PapelPropostoComTimelock(papel, conta, executavelEm);
    }

    function executarProposta(bytes32 papel, address conta) external somenteAdmin {
        uint256 quando = _propostas[papel][conta];
        if (quando == 0) revert PropostaInexistente(papel, conta);
        if (block.timestamp < quando) revert TimelockPendente(quando);
        delete _propostas[papel][conta];
        _papeis[papel][conta] = true;
        emit PapelConcedido(papel, conta, msg.sender);
    }

    function cancelarProposta(bytes32 papel, address conta, bytes32 motivoHash) external somenteAdmin {
        if (_propostas[papel][conta] == 0) revert PropostaInexistente(papel, conta);
        delete _propostas[papel][conta];
        emit PropostaCancelada(papel, conta, motivoHash);
    }

    /// @dev Reverte para papel sensível: esses passam por propor/executar.
    function conceder(bytes32 papel, address conta) external somenteAdmin {
        if (papelSensivel(papel)) revert PapelExigeTimelock(papel);
        _papeis[papel][conta] = true;
        emit PapelConcedido(papel, conta, msg.sender);
    }

    /// @dev Revogação é imediata por desenho. Atrasar a retirada de um papel
    ///      comprometido protegeria o atacante, não o titular.
    function revogar(bytes32 papel, address conta) external somenteAdmin {
        _papeis[papel][conta] = false;
        delete _propostas[papel][conta];
        emit PapelRevogado(papel, conta, msg.sender);
    }

    function exigirPapel(bytes32 papel, address conta) external view {
        if (!_papeis[papel][conta]) revert SemPapel(papel, conta);
    }
}
