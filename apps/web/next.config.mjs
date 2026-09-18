/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // As chamadas aos serviços acontecem no servidor: o navegador nunca fala
  // direto com o núcleo nem com o compliance, e nenhum token de serviço
  // atravessa para o cliente.
  env: {
    URL_CORE: process.env.URL_CORE ?? 'http://127.0.0.1:3003',
    URL_COMPLIANCE: process.env.URL_COMPLIANCE ?? 'http://127.0.0.1:3001',
    URL_ORACLE: process.env.URL_ORACLE ?? 'http://127.0.0.1:3002',
    URL_EUDR: process.env.URL_EUDR ?? 'http://127.0.0.1:3004',
  },
};
