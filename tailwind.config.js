/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./*.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a8a",
        },
      },
    },
  },
  safelist: [
    "bg-brand-500",
    "bg-brand-600",
    "bg-brand-700",
    "bg-purple-500",
    "bg-purple-600",
    "bg-purple-700",
    "text-brand-500",
    "text-brand-600",
    "text-brand-700",
    "text-purple-500",
    "text-purple-600",
    "text-purple-700",
  ],
};
