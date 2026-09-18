// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

/// @title Âncora de registro — unicidade estrutural do colateral (P3)
/// @notice Mantém a correspondência um-para-um entre o título registrado na
///         entidade autorizada e o token que o espelha. Tornar a dupla
///         mobilização estruturalmente impossível é função desta camada, não
///         de validação em serviço: um bug no backend não pode abrir caminho
///         para dois espelhos do mesmo título.
/// @dev    A âncora é keccak256(abi.encodePacked(entidade, "|", registroId)).
///         Identificador de título não é dado pessoal; ainda assim, o valor
///         cru nunca é publicado — apenas o hash (P2, ADR-0002).
interface IAncoraRegistro {
    event AncoraVinculada(bytes32 indexed ancora, uint256 indexed tokenId, address indexed registrante);
    event AncoraBaixada(bytes32 indexed ancora, uint256 indexed tokenId, bytes32 comprovanteHash);

    /// @notice Tentativa de vincular âncora já em uso. É o erro que prova P3.
    error AncoraJaUtilizada(bytes32 ancora, uint256 tokenIdExistente);
    error AncoraDesconhecida(bytes32 ancora);
    error AncoraNula();

    /// @param ancora Hash do identificador de registro.
    /// @return tokenId Token vinculado, ou zero se a âncora estiver livre.
    function tokenDaAncora(bytes32 ancora) external view returns (uint256 tokenId);

    /// @param tokenId Token do espelho.
    /// @return ancora Âncora vinculada ao token.
    function ancoraDoToken(uint256 tokenId) external view returns (bytes32 ancora);

    /// @return Verdadeiro se nenhum token ativo ocupa a âncora.
    function ancoraDisponivel(bytes32 ancora) external view returns (bool);

    /// @return Quantidade de âncoras já vinculadas, incluindo as baixadas.
    function totalAncoras() external view returns (uint256);
}
