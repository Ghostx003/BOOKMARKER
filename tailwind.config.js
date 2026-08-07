/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./bookmark-manager-extension/**/*.{html,js}"],
  theme: {
    extend: {
        colors: {
            bgBody: '#09090b',
            bgPanel: '#18181b',
            bgCard: '#27272a',
            bgCardHover: '#3f3f46',
            accent: '#8b5cf6',
            accentGlow: 'rgba(139, 92, 246, 0.4)',
            textMain: '#f4f4f5',
            textMuted: '#a1a1aa',
            border: '#3f3f46',
            danger: '#f43f5e',
            success: '#10b981',
            warning: '#f59e0b',
            newBadge: '#fde047',
        }
    }
  },
  plugins: [],
}
