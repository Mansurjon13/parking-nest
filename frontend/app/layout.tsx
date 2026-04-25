// app/layout.tsx
'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { Analytics } from '@/lib/analytics';
import Navbar from '@/components/Navbar';
// import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hydrate = useAuthStore(s => s.hydrate);

  // Restore auth from localStorage on mount
  useEffect(() => { hydrate(); }, []);

  // Track every page navigation automatically
  useEffect(() => {
    Analytics.pageView(pathname);
  }, [pathname]);

  return (
    <html lang="en">
      <head>
        <title>ParkNest — Park somewhere beautiful</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
