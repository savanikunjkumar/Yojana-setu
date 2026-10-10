import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Martel, Mukta } from 'next/font/google';
import './globals.css';

/**
 * Both text faces carry full Devanagari coverage, which is a functional
 * requirement rather than a stylistic one: the interface has to render Hindi and
 * Marathi at the same optical weight as English, in the same typeface, or
 * switching language would visibly downgrade the page.
 */
const display = Martel({
  subsets: ['latin', 'devanagari'],
  weight: ['400', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

const body = Mukta({
  subsets: ['latin', 'devanagari'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Yojana Setu — find the schemes you are entitled to',
  description:
    'Answer a few questions, by voice or by typing, and see every central and state government scheme you qualify for — with the reason for each result.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F7F3EA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable} font-sans`}>
        {/*
          Keyboard users otherwise tab through the masthead and both nav links on every page
          before reaching anything they can act on. Visually hidden until focused, which is the
          one case where hiding a control is the accessible behaviour.
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50
            focus:border-2 focus:border-ink focus:bg-paper focus:px-4 focus:py-3 focus:font-sans
            focus:text-sm focus:font-semibold focus:text-ink"
        >
          Skip to the main content
        </a>
        {children}
      </body>
    </html>
  );
}
