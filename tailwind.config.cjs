/** @type {import('tailwindcss').Config} */
module.exports = {
  // "class" keeps the dark: variants off unless a .dark class is set. The page background has no
  // dark variant, so the default ("media") turned text light-grey on a white page in OS dark mode.
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};