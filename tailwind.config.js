/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        orion: {
          bg: '#0a0f1a',
          bgSecondary: '#111827',
          bgTeritary: '#1a2332',
          border: '#1e293b',
          borderLight: '#334155',
          accent: '#06b6d4',
          accentDim: '#0891b2',
          accentGlow: '#22d3ee',
          text: '#f1f5f9',
          textDim: '#94a3b8',
          textMuted: '#64748b',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        display: ['"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 8s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'shimmer': 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.1), transparent)',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(6, 182, 212, 0.15), 0 0 40px rgba(6, 182, 212, 0.1)',
        'glow-lg': '0 0 30px rgba(6, 182, 212, 0.2), 0 0 60px rgba(6, 182, 212, 0.15)',
        'inner-glow': 'inset 0 0 20px rgba(6, 182, 212, 0.1)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}