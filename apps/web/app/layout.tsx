import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CPR Digital',
  description: 'Espelho on-chain de CPR registrada, com conciliação contínua e evidência auditável.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="topo">
          <div className="envelope">
            <strong>CPR Digital</strong>
            <nav>
              <a href="/produtor">Produtor</a>
              <a href="/credor">Comprador de risco</a>
              <a href="/auditoria">Auditoria</a>
            </nav>
          </div>
        </header>
        <main className="envelope">{children}</main>
      </body>
    </html>
  );
}
