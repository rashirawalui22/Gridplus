/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0b1220',
        panel: '#101b2d',
        accent: '#2dd4bf',
        blue: '#38bdf8',
        warning: '#fbbf24',
        critical: '#f87171',
      },
      boxShadow: {
        glow: '0 0 20px rgba(45, 212, 191, 0.25)',
      },
    },
  },
  plugins: [],
};
