/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b101d",
        canvas: "#0c1322",
        brand: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
          purple: "#6366f1",
          cyan: "#06b6d4",
        },
        navy: {
          950: "#080d1a",
          900: "#0c1322",
          850: "#10182b",
          800: "#131e36",
          750: "#182643",
          700: "#1d2e50",
          600: "#273d69",
          500: "#3b5894",
        },
      },
    },
  },
  plugins: [],
};
