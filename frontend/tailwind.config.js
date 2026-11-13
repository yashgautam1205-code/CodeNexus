/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#050b18",
        canvas: "#050b18",
        brand: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
          purple: "#7857ff",
          cyan: "#22d3ee",
        },
        navy: {
          950: "#050b18",
          900: "#08152b",
          850: "#101d33",
          800: "#14243d",
          750: "#1a2b45",
          700: "#233a59",
          600: "#31527a",
          500: "#5073a2",
        },
      },
    },
  },
  plugins: [],
};
