// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IAncoraRegistro} from "../interfaces/IAncoraRegistro.sol";

/// @title Âncora de registro — unicidade estrutural do colateral (P3)
/// @notice Contrato IMUTÁVEL, sem proxy e sem função de atualização, por
///         decisão do ADR-0004: a correspondência título↔token não pode ser
///         reescrita por upgrade, nem por erro nem por má-fé. Garantia que
///         depende de upgrade não é garantia estrutural.
contract AncoraRegistro is IAncoraRegistro {
    address public immutable espelho;

    mapping(bytes32 => uint256) private _tokenDaAncora;
    mapping(uint256 => bytes32) private _ancoraDoToken;
    mapping(bytes32 => bool) private _baixada;
    uint256 private _total;

    constructor(address espelho_) {
        espelho = espelho_;
    }

    modifier somenteEspelho() {
        require(msg.sender == espelho, "somente o espelho vincula ancora");
        _;
    }

    /// @dev Reverte na segunda tentativa para a mesma âncora. É este revert
    ///      que torna a dupla mobilização impossível por construção, e não a
    ///      validação no backend — que pode ter bug.
    function vincular(bytes32 ancora, uint256 tokenId) external somenteEspelho {
        if (ancora == bytes32(0)) revert AncoraNula();
        uint256 existente = _tokenDaAncora[ancora];
        if (existente != 0) revert AncoraJaUtilizada(ancora, existente);
        _tokenDaAncora[ancora] = tokenId;
        _ancoraDoToken[tokenId] = ancora;
        unchecked { _total++; }
        emit AncoraVinculada(ancora, tokenId, tx.origin);
    }

    /// @dev Baixar não libera a âncora para novo espelho: um título baixado não
    ///      volta a ser espelhável. Liberar reabriria a porta de P3.
    function baixar(bytes32 ancora, bytes32 comprovanteHash) external somenteEspelho {
        uint256 tokenId = _tokenDaAncora[ancora];
        if (tokenId == 0) revert AncoraDesconhecida(ancora);
        _baixada[ancora] = true;
        emit AncoraBaixada(ancora, tokenId, comprovanteHash);
    }

    function tokenDaAncora(bytes32 ancora) external view returns (uint256) { return _tokenDaAncora[ancora]; }
    function ancoraDoToken(uint256 tokenId) external view returns (bytes32) { return _ancoraDoToken[tokenId]; }
    function ancoraDisponivel(bytes32 ancora) external view returns (bool) { return _tokenDaAncora[ancora] == 0; }
    function ancoraBaixada(bytes32 ancora) external view returns (bool) { return _baixada[ancora]; }
    function totalAncoras() external view returns (uint256) { return _total; }
}
