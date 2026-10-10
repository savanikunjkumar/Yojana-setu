import type { Config } from 'tailwindcss';

/**
 * The palette is built for the actual usage context: an inexpensive Android
 * screen, often outdoors in bright sunlight. That rules out a dark theme and
 * low-contrast greys, so everything sits on warm paper with near-black ink.
 * Accents are earthy rather than saturated so that status colours (a rejection,
 * a missing answer) stay the loudest thing on the page.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#F7F3EA',
          deep: '#EFE7D7',
          edge: '#E2D7C1',
        },
        ink: {
          DEFAULT: '#171B26',
          soft: '#4C5265',
          faint: '#7C8296',
        },
        rule: '#D8CDB6',
        saffron: '#B85C18',
        teal: '#0E5A50',
        maroon: '#8B2B2B',
        amber: '#946213',
        /**
         * Chart fills, kept separate from the text palette on purpose.
         *
         * `teal` above is tuned for text on paper, which makes it too dark and too
         * desaturated to work as an area of colour — as a bar fill it reads as grey rather
         * than as a hue. `chart.teal` is a lighter step of the same hue that clears the
         * lightness and chroma floors, and paired with `saffron` it keeps a colour-blind
         * separation of ΔE 12.1 (deuteranopia) against this surface. Verified with the
         * palette validator rather than by eye.
         */
        chart: {
          teal: '#0F8C79',
          'teal-track': '#DCEAE6',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 #E2D7C1, 0 2px 12px -6px rgba(23, 27, 38, 0.18)',
        lift: '0 12px 32px -12px rgba(23, 27, 38, 0.35)',
        stamp: 'inset 0 0 0 2px currentColor',
      },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'stamp-in': {
          from: { opacity: '0', transform: 'rotate(-14deg) scale(1.35)' },
          to: { opacity: '1', transform: 'rotate(-6deg) scale(1)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(184, 92, 24, 0.45)' },
          '100%': { boxShadow: '0 0 0 18px rgba(184, 92, 24, 0)' },
        },
      },
      animation: {
        'rise-in': 'rise-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both',
        'stamp-in': 'stamp-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
