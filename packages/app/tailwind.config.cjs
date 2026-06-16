module.exports = {
  content: ["./src/renderer/index.html", "./src/renderer/**/*.{js,ts,jsx,tsx,html}", "!./src/renderer/dist/**"],
  theme: {
    borderRadius: {
      none: "0px",
      sm: "2px",
      DEFAULT: "3px",
      md: "3px",
      lg: "4px",
      xl: "4px",
      "2xl": "6px",
      "3xl": "8px",
      full: "9999px",
    },
    extend: {
      colors: {
        "ui-bg": "var(--bg)",
        "ui-surface": "var(--surface-1)",
        "ui-surface-2": "var(--surface-2)",
        "ui-muted": "var(--text-muted)",
        "ui-border": "var(--border)",
        "ui-accent": "var(--accent)",
        "ui-success": "var(--success)",
        "ui-warning": "var(--warning)",
        "ui-danger": "var(--danger)",
      },
      animation: {
        "enter-fade": "enter-fade 250ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "enter-slide-up": "enter-slide-up 350ms cubic-bezier(0.25, 1, 0.5, 1) forwards",
        "enter-pop": "enter-pop 200ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
      },
      keyframes: {
        "enter-fade": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "enter-slide-up": {
          "0%": { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "enter-pop": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
