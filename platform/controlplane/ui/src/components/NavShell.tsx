import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

const links = [
  { to: '/intake', label: 'Intake' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/benchmarks', label: 'Benchmarks' },
  { to: '/proposals', label: 'Proposals' },
  { to: '/compose', label: 'Compose' },
];

/**
 * HeroUI v3 removed Navbar; this is the plain-markup equivalent of the v2
 * `<Navbar maxWidth="full" isBordered>` this shell used.
 */
export default function NavShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="flex flex-col min-h-screen">
      <nav className="sticky top-0 z-40 w-full border-b border-separator bg-background/70 backdrop-blur-lg">
        <header className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center">
            <span className="font-semibold tracking-wide">agentx</span>
            <span className="ml-2 text-muted">control plane</span>
          </div>
          <ul className="flex items-center gap-4">
            {links.map((l) => {
              const active = pathname.startsWith(l.to);
              return (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className={`text-sm ${active ? 'font-medium text-accent' : 'text-foreground'}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </header>
      </nav>
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full">{children}</div>
    </div>
  );
}
