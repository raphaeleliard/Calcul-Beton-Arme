<<<<<<< HEAD
// ==========================================
// GESTION GLOBALE DU THÈME (Clair / Sombre)
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('themeToggle');
    const rootElement = document.documentElement;

    if (themeToggleBtn) {
        // Vérifier les préférences système et le localStorage
        const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
        const currentTheme = localStorage.getItem("theme");

        // Initialisation au chargement
        if (currentTheme === "dark" || (currentTheme === null && prefersDarkScheme.matches)) {
            rootElement.setAttribute("data-theme", "dark");
        } else {
            rootElement.setAttribute("data-theme", "light");
        }

        // Bascule manuelle au clic
        themeToggleBtn.addEventListener("click", () => {
            let theme = rootElement.getAttribute("data-theme");
            let newTheme = theme === "dark" ? "light" : "dark";
            
            rootElement.setAttribute("data-theme", newTheme);
            localStorage.setItem("theme", newTheme);
        });
    }
=======
// ==========================================
// GESTION GLOBALE DU THÈME (Clair / Sombre)
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('themeToggle');
    const rootElement = document.documentElement;

    if (themeToggleBtn) {
        // Vérifier les préférences système et le localStorage
        const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
        const currentTheme = localStorage.getItem("theme");

        // Initialisation au chargement
        if (currentTheme === "dark" || (currentTheme === null && prefersDarkScheme.matches)) {
            rootElement.setAttribute("data-theme", "dark");
        } else {
            rootElement.setAttribute("data-theme", "light");
        }

        // Bascule manuelle au clic
        themeToggleBtn.addEventListener("click", () => {
            let theme = rootElement.getAttribute("data-theme");
            let newTheme = theme === "dark" ? "light" : "dark";
            
            rootElement.setAttribute("data-theme", newTheme);
            localStorage.setItem("theme", newTheme);
        });
    }
>>>>>>> 744bccd7109a40014f1a401ea7dfbd3807fe6c2b
});