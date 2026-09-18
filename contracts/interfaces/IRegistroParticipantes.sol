// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

/// @title Registro de participantes habilitados
/// @notice Rede permissionada: só endereços habilitados detêm ou recebem
///         espelho. A habilitação é atestação de que existe KYC válido
///         off-chain — a cadeia guarda o fato, nunca o dossiê (P2).
/// @dev    Não há aqui nome, documento ou qualquer campo identificante: um
///         endereço, um hash de atestação e uma validade.
interface IRegistroParticipantes {
    event ParticipanteHabilitado(address indexed conta, bytes32 indexed atestacaoHash, uint64 validoAte);
    event ParticipanteDesabilitado(address indexed conta, bytes32 motivoHash);

    error ParticipanteNaoHabilitado(address conta);
    error AtestacaoExpirada(address conta, uint64 validoAte);

    /// @param conta         Endereço do participante.
    /// @param atestacaoHash Hash da credencial verificável emitida off-chain.
    /// @param validoAte     Instante de expiração da habilitação.
    function habilitar(address conta, bytes32 atestacaoHash, uint64 validoAte) external;

    function desabilitar(address conta, bytes32 motivoHash) external;

    function estaHabilitado(address conta) external view returns (bool);

    function habilitacaoValidaAte(address conta) external view returns (uint64);

    function atestacaoDe(address conta) external view returns (bytes32);
}
