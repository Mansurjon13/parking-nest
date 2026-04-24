// components/Navbar.tsx
'use client';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';

export default function Navbar() {
  const { user, logout } = useAuthStore();

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '1rem 2rem', background: '#1A1A18', position: 'sticky', top: 0, zIndex: 100,
    }}>
      <Link href="/" style={{ fontFamily: "'Playfair Display', serif", color: '#F7F4EE', fontSize: '1.4rem', textDecoration: 'none' }}>
        Park<span style={{ color: '#D97B3A', fontStyle: 'italic' }}>nest</span>
      </Link>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
        <Link href="/browse" style={navLink}>Browse</Link>
        {user?.role === 'host' && (
          <>
            <Link href="/host/spots" style={navLink}>My spots</Link>
            <Link href="/host/bookings" style={navLink}>Requests</Link>
            <Link href="/host/earnings" style={navLink}>Earnings</Link>
          </>
        )}
        {user?.role === 'client' && (
          <Link href="/bookings" style={navLink}>My bookings</Link>
        )}
        {user?.role === 'admin' && (
          <Link href="/admin" style={navLink}>Admin</Link>
        )}
        {user ? (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ color: '#8C8880', fontSize: '0.85rem' }}>{user.full_name}</span>
            <button onClick={logout} style={btnOutline}>Sign out</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Link href="/auth/login" style={btnOutline}>Sign in</Link>
            <Link href="/auth/register" style={btnFilled}>Get started</Link>
          </div>
        )}
      </div>
    </nav>
  );
}

const navLink: React.CSSProperties = {
  color: '#B8B4AA', fontSize: '0.88rem', textDecoration: 'none',
};
const btnOutline: React.CSSProperties = {
  background: 'none', border: '1px solid #4A4840', color: '#F7F4EE',
  padding: '0.4rem 1rem', borderRadius: '6px', fontSize: '0.85rem',
  cursor: 'pointer', textDecoration: 'none', fontFamily: "'DM Sans', sans-serif",
};
const btnFilled: React.CSSProperties = {
  background: '#D97B3A', border: 'none', color: 'white',
  padding: '0.45rem 1.1rem', borderRadius: '6px', fontSize: '0.85rem',
  cursor: 'pointer', textDecoration: 'none', fontFamily: "'DM Sans', sans-serif",
};
