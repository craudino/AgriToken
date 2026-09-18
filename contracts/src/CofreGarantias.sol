// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {ICofreGarantias} from "../interfaces/ICofreGarantias.sol";
import {ControleAcesso} from "./ControleAcesso.sol";
import {EspelhoCPR} from "./EspelhoCPR.sol";

/// @title Cofre de garantias e waterfall de cinco níveis
/// @notice FRONTEIRA REGULATÓRIA (P7): este contrato NÃO recebe, NÃO guarda e
///         NÃO transfere valor. Não há função payable, não há receive nem
///         fallback. "Cofre" é nome de registro de vínculos, não de custódia —
///         e a ausência é verificada em CI sobre a ABI.
contract CofreGarantias is ICofreGarantias {
    struct Garantia {
        uint256 tokenId;
        uint8 nivel;
        uint256 valor;
        EstadoExcussao estado;
        uint256 recuperado;
        bool ativa;
    }

    ControleAcesso private immutable _acesso;
    EspelhoCPR private immutable _espelho;

    mapping(bytes32 => Nivel[]) private _politicas;
    mapping(bytes32 => bool) private _politicaExiste;
    mapping(uint256 => bytes32) private _politicaDoToken;
    mapping(bytes32 => Garantia) private _garantias;
    mapping(uint256 => bytes32[]) private _garantiasDoToken;

    constructor(ControleAcesso acesso, EspelhoCPR espelho) {
        _acesso = acesso;
        _espelho = espelho;
    }

    modifier somenteOriginador() {
        _acesso.exigirPapel(_acesso.PAPEL_ORIGINADOR(), msg.sender);
        _;
    }

    /// @dev A política é imutável depois de registrada: recalibrar cria nova
    ///      versão, para que uma simulação antiga continue reproduzível (P6).
    function configurarPolitica(bytes32 politicaHash, Nivel[] calldata niveis) external somenteOriginador {
        require(!_politicaExiste[politicaHash], "politica imutavel: crie nova versao");
        require(niveis.length == 5, "waterfall tem cinco niveis");
        for (uint256 i = 0; i < niveis.length; i++) {
            if (niveis[i].nivel != i + 1) revert NivelInvalido(niveis[i].nivel);
            _politicas[politicaHash].push(niveis[i]);
        }
        _politicaExiste[politicaHash] = true;
        emit PoliticaConfigurada(politicaHash, uint8(niveis.length), msg.sender);
    }

    function vincularPolitica(uint256 tokenId, bytes32 politicaHash) external somenteOriginador {
        if (!_politicaExiste[politicaHash]) revert PoliticaInexistente(politicaHash);
        _politicaDoToken[tokenId] = politicaHash;
    }

    function vincularGarantia(uint256 tokenId, bytes32 garantiaRef, uint8 nivel, uint256 valor)
        external somenteOriginador
    {
        if (nivel == 0 || nivel > 5) revert NivelInvalido(nivel);
        if (_garantias[garantiaRef].ativa) revert GarantiaJaVinculada(garantiaRef, _garantias[garantiaRef].tokenId);
        // Congelado por divergência não recebe garantia nova: enquanto o
        // espelho diverge do registro, nada se constrói sobre ele (P1).
        if (_espelho.estaCongelado(tokenId)) revert EspelhoCongelado(tokenId);

        _garantias[garantiaRef] = Garantia(tokenId, nivel, valor, EstadoExcussao.NAO_ACIONADA, 0, true);
        _garantiasDoToken[tokenId].push(garantiaRef);
        emit GarantiaVinculada(tokenId, garantiaRef, nivel, valor);
    }

    function liberarGarantia(bytes32 garantiaRef, bytes32 motivoHash) external somenteOriginador {
        require(_garantias[garantiaRef].ativa, "garantia inexistente");
        _garantias[garantiaRef].ativa = false;
        emit GarantiaLiberada(garantiaRef, motivoHash);
    }

    function registrarExcussao(
        bytes32 garantiaRef,
        EstadoExcussao estado,
        uint256 recuperado,
        bytes32 evidenciaHash
    ) external somenteOriginador {
        Garantia storage g = _garantias[garantiaRef];
        require(g.ativa, "garantia inexistente");
        g.estado = estado;
        g.recuperado = recuperado;
        emit ExcussaoRegistrada(garantiaRef, estado, recuperado, evidenciaHash);
    }

    /// @notice Percorre os cinco níveis para uma perda hipotética.
    /// @dev    Função de visão, determinística e sem efeito (P6). É o mecanismo
    ///         que permite ao comprador de risco verificar por conta própria o
    ///         que a plataforma afirma na simulação, em vez de acreditar.
    function percorrerWaterfall(uint256 tokenId, uint256 perda)
        external view returns (Absorcao[] memory absorcoes, uint256 perdaResidual)
    {
        bytes32 politicaHash = _politicaDoToken[tokenId];
        if (!_politicaExiste[politicaHash]) revert PoliticaInexistente(politicaHash);
        Nivel[] memory niveis = _politicas[politicaHash];

        absorcoes = new Absorcao[](niveis.length);
        perdaResidual = perda;
        uint256 exposicao = _espelho.balanceOf(tokenId);

        for (uint256 i = 0; i < niveis.length; i++) {
            uint256 disponivel = _disponivelNoNivel(tokenId, niveis[i], exposicao);
            uint256 absorvido = disponivel >= perdaResidual ? perdaResidual : disponivel;
            perdaResidual -= absorvido;
            absorcoes[i] = Absorcao({
                nivel: niveis[i].nivel,
                absorvido: absorvido,
                esgotado: absorvido == disponivel && disponivel > 0
            });
        }
    }

    /// @dev O deságio entra aqui: a garantia vale o que se recupera na
    ///      excussão, não o que está declarado no papel. E o teto por nível
    ///      impede que um único nível absorva o que ele não suportaria.
    function _disponivelNoNivel(uint256 tokenId, Nivel memory n, uint256 exposicao)
        private view returns (uint256)
    {
        uint256 soma;
        bytes32[] memory refs = _garantiasDoToken[tokenId];
        for (uint256 i = 0; i < refs.length; i++) {
            Garantia memory g = _garantias[refs[i]];
            if (!g.ativa || g.nivel != n.nivel) continue;
            soma += (g.valor * (10_000 - n.haircutBps)) / 10_000;
        }
        uint256 teto = (exposicao * n.capBps) / 10_000;
        return soma > teto ? teto : soma;
    }

    function garantiasDo(uint256 tokenId) external view returns (bytes32[] memory) {
        return _garantiasDoToken[tokenId];
    }
    function nivelDaGarantia(bytes32 garantiaRef) external view returns (uint8) {
        return _garantias[garantiaRef].nivel;
    }
    function estadoDaExcussao(bytes32 garantiaRef) external view returns (EstadoExcussao) {
        return _garantias[garantiaRef].estado;
    }
    function politicaDo(uint256 tokenId) external view returns (bytes32) {
        return _politicaDoToken[tokenId];
    }
    function niveisDaPolitica(bytes32 politicaHash) external view returns (Nivel[] memory) {
        return _politicas[politicaHash];
    }
}
