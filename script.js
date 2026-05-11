// ==========================================
// DONNÉES D'ACIERS CONSTRUCTEURS
// ==========================================
const STEEL_SPECS = {
    8:  { diametre: 8, section: 0.503 },
    10: { diametre: 10, section: 0.785 },
    12: { diametre: 12, section: 1.131 },
    14: { diametre: 14, section: 1.539 },
    16: { diametre: 16, section: 2.011 },
    20: { diametre: 20, section: 3.142 },
    25: { diametre: 25, section: 4.909 },
    32: { diametre: 32, section: 8.042 }
};

const TS_SPECS = {
    'ST15C': { section: 1.42, diam: 5.2, esp: 150 },
    'ST25C': { section: 2.57, diam: 7.0, esp: 150 },
    'ST35C': { section: 3.85, diam: 7.0, esp: 100 },
    'ST50C': { section: 5.03, diam: 8.0, esp: 100 },
    'ST65C': { section: 6.36, diam: 9.0, esp: 100 }
};

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

            // Notifier le module de la page courante pour qu'il redessine son graphique
            if (typeof window.onThemeChange === 'function') {
                window.onThemeChange();
            }
        });
    }
});

// ==========================================
// UTILITAIRES D'EXPORT (PNG / SVG)
// ==========================================
function exportPlanAsPNG(svgContainerId, filename, drawCallback) {
    const container = document.getElementById(svgContainerId);
    let svg = container.tagName.toLowerCase() === 'svg' ? container : container.querySelector('svg');
    if (!svg) return alert('Générez d\'abord le ferraillage !');

    const currentTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    if (drawCallback) drawCallback(); // Force dessin en mode clair

    svg = document.getElementById(svgContainerId).tagName.toLowerCase() === 'svg' ? document.getElementById(svgContainerId) : document.querySelector(`#${svgContainerId} svg`);
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    canvas.width = 1200; canvas.height = 1200;

    img.onload = () => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const link = document.createElement('a'); link.href = canvas.toDataURL('image/png');
        link.download = filename; link.click();
        
        document.documentElement.setAttribute('data-theme', currentTheme);
        if (drawCallback) drawCallback(); // Restauration
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
}

function exportPlanAsSVG(svgContainerId, filename, drawCallback) {
    const container = document.getElementById(svgContainerId);
    let svg = container.tagName.toLowerCase() === 'svg' ? container : container.querySelector('svg');
    if (!svg) return alert('Générez d\'abord le ferraillage !');

    const currentTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light'); if (drawCallback) drawCallback();
    
    svg = document.getElementById(svgContainerId).tagName.toLowerCase() === 'svg' ? document.getElementById(svgContainerId) : document.querySelector(`#${svgContainerId} svg`);
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
    link.download = filename; link.click(); URL.revokeObjectURL(url);
    
    document.documentElement.setAttribute('data-theme', currentTheme); if (drawCallback) drawCallback();
}

// ==========================================
// UTILITAIRES SVG (Couleurs)
// ==========================================
function getThemeColors() {
    const theme = document.documentElement.getAttribute('data-theme');
    return {
        textColor: theme === 'dark' ? '#e0e0e0' : '#000000',
        concreteFill: theme === 'dark' ? '#2d3436' : '#f0f3f4',
        concreteStroke: theme === 'dark' ? '#636e72' : '#7f8c8d',
        legendBg: theme === 'dark' ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)'
    };
}

// ==========================================
// GESTION GLOBALE DES MODALES (POP-UPS)
// ==========================================
function showModal(title, content) {
    let overlay = document.getElementById('globalModalOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'globalModalOverlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-content"><div class="modal-title" id="globalModalTitle"></div><div class="modal-body" id="globalModalBody"></div><button class="modal-close" onclick="closeModal()">Fermer</button></div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if(e.target === overlay) closeModal(); });
    }
    document.getElementById('globalModalTitle').innerText = title;
    document.getElementById('globalModalBody').innerText = content;
    overlay.classList.add('active');
}

function closeModal() {
    const overlay = document.getElementById('globalModalOverlay');
    if (overlay) overlay.classList.remove('active');
}