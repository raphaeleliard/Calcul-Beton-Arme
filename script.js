/*
=========================================================
Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
Auteur : Raphaël ELIARD
Description : Script central. J'y ai regroupé la bibliothèque de 
matériaux (aciers), la gestion globale du mode visuel (clair/sombre) 
ainsi que les utilitaires d'export graphique et d'interface.
=========================================================
*/
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
// Persistance du thème vis-à-vis des préférences système ou des choix manuels.
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
// Fonctions pour convertir et télécharger dynamiquement les rendus DOM SVG vers des fichiers locaux exploitables.
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

// ==========================================
// UTILITAIRES SVG (Couleurs)
// Gestion des palettes d'interface du canvas selon le mode sombre/clair courant.
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
// Composant réutilisable pour afficher des notes pédagogiques sans quitter le contexte de la page.
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

// ==========================================
// UTILITAIRES DE RENDU : TEXTE ET MATHÉMATIQUES
// ==========================================

/**
 * Parse une chaîne pseudo-LaTeX en HTML propre pour injection DOM (garanti sans casse).
 * Utile pour afficher les formules dans l'UI avant capture html2canvas.
 * @param {string} eq La chaîne brute (ex: "M_{Ed} \le V_{Rd,c} * \lambda")
 * @returns {string} HTML formaté
 */
function formatEquation(eq) {
    if (!eq) return '';
    let formatted = eq.toString();
    
    // 1. Dictionnaire des symboles Unicode compatibles
    const symbols = {
        '\\lambda': 'λ', '\\beta': 'β', '\\alpha': 'α', '\\theta': 'θ',
        '\\mu': 'μ', '\\sigma': 'σ', '\\rho': 'ρ', '\\phi': 'Ø',
        '<=': '≤', '>=': '≥', '!=': '≠', '~=': '≈', '*': '×'
    };
    
    for (const [key, value] of Object.entries(symbols)) {
        formatted = formatted.split(key).join(value);
    }

    // 2. Gestion des indices (ex: M_Ed ou M_{Ed,max})
    formatted = formatted.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
    formatted = formatted.replace(/_([a-zA-Z0-9]+)/g, '<sub>$1</sub>');
    
    // 3. Gestion des exposants (ex: L^2 ou L^{2.5})
    formatted = formatted.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
    formatted = formatted.replace(/\^([a-zA-Z0-9]+)/g, '<sup>$1</sup>');

    return formatted;
}

// ==========================================
// UTILITAIRES DE RENDU : SVG & DESSIN
// ==========================================

/**
 * Génère une ligne de cote (dimension) SVG optimisée.
 * Calcule automatiquement les normales pour décaler la ligne et pivoter le texte sans superposition.
 */
function drawDimensionLine(x1, y1, x2, y2, value, unit = "cm", offset = 30, textColor = "#000", strokeColor = "#7f8c8d") {
    // Vecteur directeur
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return '';
    
    // Vecteur unitaire et normale (perpendiculaire)
    const nx = dx / length;
    const ny = dy / length;
    const px = -ny; 
    const py = nx;
    
    // Points décalés
    const ox1 = x1 + px * offset;
    const oy1 = y1 + py * offset;
    const ox2 = x2 + px * offset;
    const oy2 = y2 + py * offset;
    
    const midX = (ox1 + ox2) / 2;
    const midY = (oy1 + oy2) / 2;
    
    // Orientation du texte (pour qu'il soit toujours lisible à l'endroit)
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const textAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;
    const textShift = offset > 0 ? -6 : 16; 

    return `
        <line x1="${x1}" y1="${y1}" x2="${ox1}" y2="${oy1}" stroke="${strokeColor}" stroke-dasharray="3,3" stroke-width="1"/>
        <line x1="${x2}" y1="${y2}" x2="${ox2}" y2="${oy2}" stroke="${strokeColor}" stroke-dasharray="3,3" stroke-width="1"/>
        <line x1="${ox1}" y1="${oy1}" x2="${ox2}" y2="${oy2}" stroke="${strokeColor}" stroke-width="1.5"/>
        <line x1="${ox1-px*4-nx*4}" y1="${oy1-py*4-ny*4}" x2="${ox1+px*4+nx*4}" y2="${oy1+py*4+ny*4}" stroke="${strokeColor}" stroke-width="2"/>
        <line x1="${ox2-px*4-nx*4}" y1="${oy2-py*4-ny*4}" x2="${ox2+px*4+nx*4}" y2="${oy2+py*4+ny*4}" stroke="${strokeColor}" stroke-width="2"/>
        <rect x="${midX-20}" y="${midY+textShift-10}" width="40" height="14" fill="var(--surface-color)" opacity="0.8" rx="2"/>
        <text x="${midX}" y="${midY}" text-anchor="middle" font-size="14" fill="${textColor}" transform="rotate(${textAngle} ${midX} ${midY}) translate(0, ${textShift})">${value} ${unit}</text>
    `;
}