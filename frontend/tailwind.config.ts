import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#9D7BFF',
        secondary: '#E7B7A5',
        accent: '#C6A0FF',
        surface: 'rgba(255, 255, 255, 0.08)',
        'surface-hover': 'rgba(255, 255, 255, 0.12)',
        glass: 'rgba(20, 20, 40, 0.85)',
        'glass-light': 'rgba(255, 255, 255, 0.85)',
      },
      borderRadius: {
        xl: '16px',
        '2xl': '24px',
      },
      backdropBlur: {
        glass: '20px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(157, 123, 255, 0.15)',
        'glass-lg': '0 16px 48px rgba(157, 123, 255, 0.25)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'waveform': 'waveform 1.5s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(157, 123, 255, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(157, 123, 255, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        waveform: {
          '0%, 100%': { height: '4px' },
          '50%': { height: '20px' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
