// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IRegistroParticipantes} from "../interfaces/IRegistroParticipantes.sol";
import {ControleAcesso} from "./ControleAcesso.sol";

/// @title Registro de participantes habilitados
/// @notice Circulação fechada é uma das quatro restrições estruturais do
///         ADR-0005: o espelho não circula para quem a plataforma não habilitou,
///         e a habilitação expira. Guarda o fato, nunca o dossiê (P2).
contract RegistroParticipantes is IRegistroParticipantes {
    struct Habilitacao {
        bytes32 atestacaoHash;
        uint64 validoAte;
        bool ativo;
    }

    ControleAcesso private immutable _acesso;
    mapping(address => Habilitacao) private _habilitacoes;

    constructor(ControleAcesso acesso) {
        _acesso = acesso;
    }

    modifier somenteCompliance() {
        _acesso.exigirPapel(_acesso.PAPEL_ORIGINADOR(), msg.sender);
        _;
    }

    function habilitar(address conta, bytes32 atestacaoHash, uint64 validoAte) external somenteCompliance {
        require(validoAte > block.timestamp, "validade no passado");
        _habilitacoes[conta] = Habilitacao(atestacaoHash, validoAte, true);
        emit ParticipanteHabilitado(conta, atestacaoHash, validoAte);
    }

    function desabilitar(address conta, bytes32 motivoHash) external somenteCompliance {
        _habilitacoes[conta].ativo = false;
        emit ParticipanteDesabilitado(conta, motivoHash);
    }

    /// @dev Habilitação vencida não habilita. A verificação é por tempo, e não
    ///      por alguém lembrar de revogar — o esquecimento é o caso comum.
    function estaHabilitado(address conta) public view returns (bool) {
        Habilitacao memory h = _habilitacoes[conta];
        return h.ativo && h.validoAte > block.timestamp;
    }

    function habilitacaoValidaAte(address conta) external view returns (uint64) {
        return _habilitacoes[conta].validoAte;
    }

    function atestacaoDe(address conta) external view returns (bytes32) {
        return _habilitacoes[conta].atestacaoHash;
    }

    function exigirHabilitado(address conta) external view {
        if (!estaHabilitado(conta)) revert ParticipanteNaoHabilitado(conta);
    }
}
