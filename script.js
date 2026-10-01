/*
=========================================================
Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
Auteur : Raphaël ELIARD
Description : Bibliothèque de matériaux (aciers), gestion globale du thème, utilitaires d'export graphique et génération de notes de calcul PDF.
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

// Treillis soudés standard (panneaux ADETS).
//   section   : section des fils PORTEURS (sens longitudinal), en cm²/ml
//   section_t : section des fils de RÉPARTITION (sens transversal), en cm²/ml
// Les deux sens ne sont pas identiques sur les panneaux ST25C à ST65C : le
// distinguer est indispensable pour vérifier séparément les armatures
// verticales (EC2 §9.6.2) et horizontales (EC2 §9.6.3) d'un voile.
const TS_SPECS = {
    'ST15C': { section: 1.42, section_t: 1.42, diam: 5.2, esp: 150 },
    'ST25C': { section: 2.57, section_t: 1.28, diam: 7.0, esp: 150 },
    'ST35C': { section: 3.85, section_t: 1.28, diam: 7.0, esp: 100 },
    'ST50C': { section: 5.03, section_t: 2.57, diam: 8.0, esp: 100 },
    'ST65C': { section: 6.36, section_t: 2.57, diam: 9.0, esp: 100 }
};

// ==========================================
// GESTION DU THÈME VISUEL (Clair / Sombre)
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
// EXPORT DES RENDUS EN PNG
// ==========================================
function exportPlanAsPNG(svgContainerId, filename, drawCallback) {
    const container = document.getElementById(svgContainerId);
    let svg = container.tagName.toLowerCase() === 'svg' ? container : container.querySelector('svg');
    if (!svg) return alert('Générez d\'abord le ferraillage !');

    const currentTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    if (drawCallback) drawCallback(); // Force dessin en mode clair

    svg = document.getElementById(svgContainerId).tagName.toLowerCase() === 'svg' ? document.getElementById(svgContainerId) : document.querySelector(`#${svgContainerId} svg`);

    // Le canevas suit le format du viewBox : depuis que celui-ci est recadré sur
    // le dessin, un canevas carré imposé étirerait le plan.
    const vb = (svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(Number);
    const format = (vb[2] > 0 && vb[3] > 0) ? vb[2] / vb[3] : 1;
    const COTE_MAX = 1600;

    // On fige les dimensions dans le SVG sérialisé : sans largeur ni hauteur
    // intrinsèques, certains navigateurs refusent de le décoder en image.
    const clone = svg.cloneNode(true);
    const largeur = format >= 1 ? COTE_MAX : Math.round(COTE_MAX * format);
    const hauteur = format >= 1 ? Math.round(COTE_MAX / format) : COTE_MAX;
    clone.setAttribute('width', largeur);
    clone.setAttribute('height', hauteur);
    clone.removeAttribute('style');

    const svgData = new XMLSerializer().serializeToString(clone);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    canvas.width = largeur; canvas.height = hauteur;

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
// COULEURS DU CANEVAS SVG
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

/**
 * Couleurs des armatures, adaptées au thème.
 * Les teintes sombres d'origine tombaient à 2.3:1 de contraste sur le béton
 * du thème sombre ; chaque variante retenue dépasse ici le seuil de 3:1 exigé
 * par le WCAG 1.4.11 pour un objet graphique porteur d'information.
 */
function getRebarColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        main:    dark ? '#ff6b5b' : '#c0392b',  // aciers longitudinaux tendus
        stirrup: dark ? '#4fb3f0' : '#2980b9',  // cadres, épingles, répartition
        montage: dark ? '#b0bec5' : '#7f8c8d'   // aciers de montage
    };
}

// ==========================================
// DIAGNOSTICS RÉGLEMENTAIRES
// ==========================================

/**
 * Affiche la liste des vérifications Eurocode 2 non satisfaites ou informatives.
 * @param {string} containerId Identifiant du conteneur d'affichage
 * @param {Array<{level:string, text:string}>} warnings Diagnostics renvoyés par ec2-core.js
 */
function renderWarnings(containerId, warnings) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!warnings || warnings.length === 0) {
        container.innerHTML = '';
        return;
    }

    const ordre = { error: 0, warn: 1, info: 2 };
    const icones = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
    const tries = warnings.slice().sort((a, b) => (ordre[a.level] ?? 3) - (ordre[b.level] ?? 3));

    container.innerHTML = tries.map(warning => {
        const niveau = ordre[warning.level] !== undefined ? warning.level : 'info';
        return `<div class="ec2-warning ec2-warning-${niveau}">
                    <span class="ec2-warning-icon">${icones[niveau]}</span>
                    <span>${warning.text}</span>
                </div>`;
    }).join('');
}

// ==========================================
// VÉRIFICATIONS, VERDICT ET SAISIES
// ==========================================

/** Échappe un texte pour insertion dans du HTML. */
function echapperHTML(texte) {
    return String(texte === undefined || texte === null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Met en indice la partie suivant un « _ » (A_s,min -> A<sub>s,min</sub>). */
function indicesHTML(texte) {
    return echapperHTML(texte).replace(/([A-Za-zØσνμλρθψφεδ])_([A-Za-z0-9,]+)/g, '$1<sub>$2</sub>');
}

/**
 * Tableau de toutes les vérifications menées par le noyau EC2.
 * @param {string} containerId
 * @param {Array} checks liste renvoyée par ec2-core.js (label, ref, requis, obtenu, ok, grave)
 */
function renderChecks(containerId, checks) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const lignes = (checks || []).map(c => {
        const etat = c.ok ? 'ok' : (c.grave ? 'ko' : 'warn');
        const icone = c.ok ? '✓' : (c.grave ? '✗' : '⚠');
        const texte = c.ok ? 'Vérifié' : (c.grave ? 'Non vérifié' : 'À surveiller');
        return `<tr class="check-${etat}">
                    <td><span class="check-label">${indicesHTML(c.label)}</span>
                        <span class="check-ref">${echapperHTML(c.ref)}</span></td>
                    <td>${indicesHTML(c.requis)}</td>
                    <td>${indicesHTML(c.obtenu)}</td>
                    <td class="check-etat"><span aria-hidden="true">${icone}</span>
                        <span class="sr-only">${texte}</span></td>
                </tr>`;
    }).join('');
    container.innerHTML = `
        <table class="checks-table">
            <caption class="sr-only">Vérifications Eurocode 2 de l'élément</caption>
            <thead><tr><th scope="col">Vérification</th><th scope="col">Exigence</th>
                <th scope="col">Obtenu</th><th scope="col"><span class="sr-only">État</span></th></tr></thead>
            <tbody>${lignes}</tbody>
        </table>`;
}

/**
 * Applique au badge de statut le verdict global tiré de la liste des
 * vérifications : l'écran et la note PDF partagent ainsi la même conclusion.
 * @returns {object} verdict EC2.verdict(checks)
 */
function appliquerVerdict(badgeId, checks, libelleConforme) {
    const v = EC2.verdict(checks);
    const badge = document.getElementById(badgeId);
    if (!badge) return v;
    const classes = { error: 'status-red', warn: 'status-orange', ok: 'status-green' };
    badge.className = 'status-badge ' + classes[v.niveau];
    if (v.niveau === 'ok') {
        badge.textContent = '✓ ' + libelleConforme;
    } else {
        const autres = (v.niveau === 'error' ? v.nbErreurs : v.nbAlertes) - 1;
        badge.textContent = (v.niveau === 'error' ? '✗ ' : '⚠ ') + v.echec.label +
            (autres > 0 ? ` (+${autres} autre${autres > 1 ? 's' : ''})` : '');
    }
    return v;
}

/**
 * Liste de couples libellé / valeur (dispositions constructives, ELS...).
 * @param {Array<[string,string]>} lignes
 */
function renderInfos(containerId, lignes) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = (lignes || []).map(([libelle, valeur]) =>
        `<div><span class="info-label">${indicesHTML(libelle)} :</span> ${indicesHTML(valeur)}</div>`
    ).join('');
}

/**
 * Lie des champs de saisie à l'état d'un module : restauration depuis
 * localStorage, synchronisation du champ, puis recalcul à chaque saisie.
 * Le type de chaque valeur suit celui de la valeur par défaut de l'état :
 * nombre, chaîne (listes de choix textuelles) ou booléen (cases à cocher).
 */
function lierChamps(prefixe, etat, ids, surChangement) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const estCase = el.type === 'checkbox';
        const estTexte = typeof etat[id] === 'string';
        let sauve = null;
        try { sauve = localStorage.getItem(prefixe + id); } catch (e) { sauve = null; }
        if (sauve !== null) {
            if (estCase) {
                etat[id] = sauve === 'true';
            } else if (estTexte) {
                if (!el.options || Array.from(el.options).some(o => o.value === sauve)) etat[id] = sauve;
            } else if (isFinite(parseFloat(sauve))) {
                // Une valeur illisible est ignorée : sinon un NaN se propagerait
                // dans l'état applicatif et jusque dans la note de calcul PDF.
                etat[id] = parseFloat(sauve);
            }
        }
        if (estCase) el.checked = !!etat[id];
        else el.value = etat[id];

        el.addEventListener(estCase ? 'change' : 'input', () => {
            if (estCase) etat[id] = el.checked;
            else if (estTexte) etat[id] = el.value;
            else {
                const v = parseFloat(el.value);
                etat[id] = isFinite(v) ? v : NaN;
            }
            try {
                localStorage.setItem(prefixe + id, estCase ? String(el.checked) : el.value);
            } catch (e) { /* stockage indisponible : la saisie reste valable pour la session */ }
            surChangement();
        });
    });
}

/**
 * Signale sous chaque champ une saisie ramenée dans le domaine de validité
 * par le noyau de calcul : l'utilisateur voit avec quelle valeur le calcul
 * a réellement été mené, au lieu d'un résultat silencieusement différent.
 * @param {Array<[string, number, number, string]>} champs [id, saisi, retenu, unité]
 */
function signalerBornes(champs) {
    champs.forEach(([id, saisi, retenu, unite]) => {
        const el = document.getElementById(id);
        if (!el || typeof retenu !== 'number') return;
        let hint = document.getElementById('hint-' + id);
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'hint-' + id;
            hint.className = 'input-hint';
            hint.setAttribute('role', 'status');
            el.insertAdjacentElement('afterend', hint);
            el.setAttribute('aria-describedby', hint.id);
        }
        const vide = !(typeof saisi === 'number' && isFinite(saisi));
        const ecart = !vide && Math.abs(saisi - retenu) > 1e-9 * Math.max(1, Math.abs(retenu));
        if (vide || ecart) {
            const valeur = (Math.round(retenu * 1000) / 1000).toString().replace('.', ',');
            hint.textContent = (vide ? 'Champ vide' : 'Hors du domaine de calcul') +
                ' : calcul mené avec ' + valeur + (unite ? ' ' + unite : '') + '.';
            el.classList.add('input-clamped');
            el.setAttribute('aria-invalid', 'true');
        } else {
            hint.textContent = '';
            el.classList.remove('input-clamped');
            el.removeAttribute('aria-invalid');
        }
    });
}

// ==========================================
// FENÊTRES MODALES
// ==========================================
let modalDeclencheur = null;

function showModal(title, content) {
    let overlay = document.getElementById('globalModalOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'globalModalOverlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="globalModalTitle">
            <div class="modal-title" id="globalModalTitle"></div>
            <div class="modal-body" id="globalModalBody"></div>
            <button class="modal-close" type="button" onclick="closeModal()">Fermer</button></div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
            // La fenêtre ne contient qu'un bouton : le focus y reste piégé
            if (e.key === 'Tab') { e.preventDefault(); overlay.querySelector('.modal-close').focus(); }
        });
    }
    modalDeclencheur = document.activeElement;
    document.getElementById('globalModalTitle').innerText = title;
    document.getElementById('globalModalBody').innerText = content;
    overlay.classList.add('active');
    overlay.querySelector('.modal-close').focus();
}

function closeModal() {
    const overlay = document.getElementById('globalModalOverlay');
    if (overlay) overlay.classList.remove('active');
    if (modalDeclencheur && typeof modalDeclencheur.focus === 'function') modalDeclencheur.focus();
    modalDeclencheur = null;
}

// ==========================================
// UTILITAIRES DE RENDU : TEXTE ET MATHÉMATIQUES
// ==========================================

/**
 * Formate les équations de type pseudo-LaTeX en HTML lisible pour l'interface utilisateur.
 * @param {string} eq L'équation brute (ex: "M_{Ed} \le V_{Rd,c} * \lambda")
 * @returns {string} HTML formaté (indices, exposants, symboles mathématiques)
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
// COTATIONS SVG
// ==========================================

/**
 * Trace une ligne de cote (dimension) SVG.
 * Calcule les décalages de ligne et les rotations de texte pour assurer la lisibilité.
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

    // Le fond de l'étiquette est posé ici en taille nulle : il est mesuré et
    // redimensionné sur le texte réellement rendu par finalizePlan(), la largeur
    // d'un libellé n'étant pas connaissable avant son insertion dans le document.
    const bgFill = (textColor === '#000000' || textColor === '#000') ? '#ffffff' : '#1e1e1e';
    const libelle = unit ? `${value} ${unit}` : `${value}`;

    return `
        <line x1="${x1}" y1="${y1}" x2="${ox1}" y2="${oy1}" stroke="${strokeColor}" stroke-dasharray="3,3" data-base-stroke="0.9"/>
        <line x1="${x2}" y1="${y2}" x2="${ox2}" y2="${oy2}" stroke="${strokeColor}" stroke-dasharray="3,3" data-base-stroke="0.9"/>
        <line x1="${ox1}" y1="${oy1}" x2="${ox2}" y2="${oy2}" stroke="${strokeColor}" data-base-stroke="1.3"/>
        <line x1="${ox1-px*4-nx*4}" y1="${oy1-py*4-ny*4}" x2="${ox1+px*4+nx*4}" y2="${oy1+py*4+ny*4}" stroke="${strokeColor}" data-base-stroke="1.8"/>
        <line x1="${ox2-px*4-nx*4}" y1="${oy2-py*4-ny*4}" x2="${ox2+px*4+nx*4}" y2="${oy2+py*4+ny*4}" stroke="${strokeColor}" data-base-stroke="1.8"/>
        <g transform="rotate(${textAngle} ${midX} ${midY}) translate(0, ${textShift})">
            <rect class="dim-label-bg" x="${midX}" y="${midY}" width="0" height="0" fill="${bgFill}" opacity="0.85" rx="2"/>
            <text class="dim-label" x="${midX}" y="${midY}" text-anchor="middle" data-base-size="12.5" fill="${textColor}">${libelle}</text>
        </g>
    `;
}

// ==========================================
// MISE EN PAGE DES PLANS DE FERRAILLAGE
// ==========================================

/**
 * Ajuste un plan de ferraillage après son insertion dans le document.
 *
 * Le canevas était auparavant un carré fixe de 800x800 unités affiché dans un
 * cadre d'environ 400 px : le dessin n'occupait que 7 à 17 % de la surface selon
 * le module, et le texte des cotations tombait à 6-7 px à l'écran. On recadre
 * donc le viewBox sur l'emprise réelle du contenu, puis on dimensionne textes et
 * traits pour qu'ils gardent une taille constante à l'écran quel que soit le zoom.
 *
 * @param {string} containerId  Conteneur du SVG
 * @param {object} options      {titre, pxParMetre, minRatio, maxRatio, padding}
 */
function finalizePlan(containerId, options = {}) {
    try {
        finaliserPlanInterne(containerId, options);
    } catch (e) {
        // Le plan est déjà tracé à ce stade : une défaillance de la mise en page
        // ne doit jamais laisser un cadre vide à l'utilisateur.
        console.error('Mise en page du plan impossible, tracé conservé tel quel :', e);
        initPlanViewer(containerId);
    }
}

function finaliserPlanInterne(containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const padding = options.padding !== undefined ? options.padding : 26;
    const minRatio = options.minRatio || 0.70;
    const maxRatio = options.maxRatio || 2.60;
    const LARGEUR_REF = 430; // largeur d'affichage de référence, en pixels

    let vue = null;

    // Les fonds décoratifs (trame, cartouche) sont retirés du calcul d'emprise :
    // couvrant tout le canevas, ils rendraient le recadrage sans effet. Ils sont
    // ensuite étendus au viewBox retenu.
    const fonds = svg.querySelectorAll('[data-plan-bg]');
    fonds.forEach(el => el.setAttribute('display', 'none'));

    // Le recadrage et la mise à l'échelle du texte sont interdépendants (le texte
    // fait partie de l'emprise) : deux passes suffisent à converger.
    for (let passe = 0; passe < 2; passe++) {
        let box;
        try { box = svg.getBBox(); } catch (e) { return; }
        if (!box || !isFinite(box.width) || box.width <= 0 || box.height <= 0) return;

        let x = box.x - padding, y = box.y - padding;
        let w = box.width + 2 * padding, h = box.height + 2 * padding;

        // On étire le viewBox jusqu'au format retenu pour que le dessin remplisse
        // son cadre : sans cela une bande de dalle (5:1) laisserait 90 % de vide.
        const ratio = Math.min(maxRatio, Math.max(minRatio, w / h));
        if (w / h > ratio) { const nh = w / ratio; y -= (nh - h) / 2; h = nh; }
        else { const nw = h * ratio; x -= (nw - w) / 2; w = nw; }

        svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
        vue = { x, y, w, h, ratio };

        // k unités du dessin valent 1 pixel à l'écran : on y ramène les tailles
        const k = w / LARGEUR_REF;
        svg.querySelectorAll('[data-base-size]').forEach(el => {
            el.setAttribute('font-size', (parseFloat(el.dataset.baseSize) * k).toFixed(2));
        });
        svg.querySelectorAll('[data-base-stroke]').forEach(el => {
            el.setAttribute('stroke-width', (parseFloat(el.dataset.baseStroke) * k).toFixed(2));
        });
    }

    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    container.style.setProperty('--plan-ratio', vue.ratio.toFixed(3));

    // Les fonds décoratifs sont rétablis à la dimension du cadre définitif
    fonds.forEach(el => {
        el.removeAttribute('display');
        el.setAttribute('x', vue.x); el.setAttribute('y', vue.y);
        el.setAttribute('width', vue.w); el.setAttribute('height', vue.h);
    });

    const k = vue.w / LARGEUR_REF;

    // Fond des étiquettes de cote, ajusté au texte effectivement rendu
    svg.querySelectorAll('.dim-label').forEach(texte => {
        const fond = texte.previousElementSibling;
        if (!fond || !fond.classList.contains('dim-label-bg')) return;
        let tb;
        try { tb = texte.getBBox(); } catch (e) { return; }
        const marge = 3 * k;
        fond.setAttribute('x', (tb.x - marge).toFixed(2));
        fond.setAttribute('y', (tb.y - marge * 0.5).toFixed(2));
        fond.setAttribute('width', (tb.width + 2 * marge).toFixed(2));
        fond.setAttribute('height', (tb.height + marge).toFixed(2));
        fond.setAttribute('rx', (2 * k).toFixed(2));
    });

    // Cartouche bas : légende et échelle graphique. Une bande leur est réservée
    // sous le dessin — dessinées par-dessus, elles recouvriraient les cotations.
    // La légende appartient au SVG lui-même pour figurer dans les exports PNG
    // et PDF, où un simple bloc HTML placé à côté n'aurait pas été repris.
    const aLegende = options.legende && options.legende.entrees && options.legende.entrees.length;
    const aEchelle = options.pxParMetre > 0;

    if (aLegende || aEchelle) {
        const groupe = aLegende ? buildLegendGroup(svg, vue, k, options.legende) : null;
        const hLegende = groupe ? groupe.hauteur : 0;
        const hEchelle = aEchelle ? 24 * k : 0;
        const bande = hLegende + hEchelle + 6 * k;

        vue.h += bande;
        vue.ratio = vue.w / vue.h;
        svg.setAttribute('viewBox', `${vue.x} ${vue.y} ${vue.w} ${vue.h}`);
        container.style.setProperty('--plan-ratio', vue.ratio.toFixed(3));
        fonds.forEach(el => el.setAttribute('height', vue.h));

        if (groupe) {
            // La légende se cale en haut de la bande, l'échelle en dessous
            groupe.el.setAttribute('transform',
                `translate(0, ${vue.y + vue.h - bande + 4 * k})`);
        }
        if (aEchelle) {
            svg.insertAdjacentHTML('beforeend', buildScaleBar(vue, options.pxParMetre, k));
        }
    }

    // Restitution pour les lecteurs d'écran
    svg.setAttribute('role', 'img');
    if (options.titre) {
        const ancien = svg.querySelector('title');
        if (ancien) ancien.remove();
        svg.insertAdjacentHTML('afterbegin', `<title>${options.titre}</title>`);
        svg.setAttribute('aria-label', options.titre);
    }

    // Le bouton d'agrandissement vit dans le conteneur, que chaque tracé remplace :
    // on le rétablit ici plutôt qu'une seule fois au chargement.
    initPlanViewer(containerId);
}

/**
 * Construit la légende à l'intérieur du SVG, sur une ou deux lignes selon la
 * place disponible. Les largeurs de texte n'étant connues qu'une fois le
 * contenu inséré, le groupe est ajouté puis mesuré et repositionné.
 * @returns {{el:SVGGElement, hauteur:number}}
 */
function buildLegendGroup(svg, vue, k, legende) {
    const { textColor } = getThemeColors();
    const H_LIGNE = 14 * k;
    const ECART = 14 * k;
    const marge = 14 * k;
    const largeurUtile = vue.w - 2 * marge;

    const groupe = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    groupe.setAttribute('class', 'plan-legend-svg');
    svg.appendChild(groupe);

    // Chaque entrée est un groupe « puce + libellé », mesuré après insertion
    const entrees = legende.entrees.map(e => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        let puce;
        if (e.forme === 'dot') {
            puce = `<circle cx="${4 * k}" cy="${-3.5 * k}" r="${4 * k}" fill="${e.couleur}"/>`;
        } else if (e.forme === 'box') {
            puce = `<rect x="0" y="${-8 * k}" width="${9 * k}" height="${9 * k}" fill="${e.couleur}" stroke="${textColor}" stroke-width="${0.6 * k}"/>`;
        } else {
            puce = `<rect x="0" y="${-5 * k}" width="${13 * k}" height="${3.2 * k}" rx="${1.6 * k}" fill="${e.couleur}"/>`;
        }
        g.innerHTML = puce +
            `<text x="${16 * k}" y="0" font-size="${11.5 * k}" fill="${textColor}">${e.texte}</text>`;
        groupe.appendChild(g);
        return g;
    });

    // Disposition en lignes, repli dès que la largeur utile est dépassée.
    // L'origine est celle du viewBox recadré, et non du canevas d'origine.
    const x0 = vue.x + marge;
    let x = x0, y = H_LIGNE, lignes = 1;
    entrees.forEach(g => {
        const l = g.querySelector('text').getComputedTextLength() + 16 * k;
        if (x > x0 && x + l > x0 + largeurUtile) { x = x0; y += H_LIGNE; lignes++; }
        g.setAttribute('transform', `translate(${x}, ${y})`);
        x += l + ECART;
    });

    // Synthèse (sections, diamètres) : mêmes règles de repli, les libellés
    // pouvant être longs. Les balises HTML éventuelles sont retirées, le SVG
    // ne sachant pas rendre <sub>.
    if (legende.infos && legende.infos.length) {
        y += H_LIGNE;
        lignes++;
        x = x0;
        const infos = legende.infos.map(i => {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('font-size', 11.5 * k);
            t.setAttribute('font-weight', '600');
            t.setAttribute('fill', textColor);
            t.textContent = String(i).replace(/<[^>]*>/g, '');
            groupe.appendChild(t);
            return t;
        });
        infos.forEach(t => {
            const l = t.getComputedTextLength();
            if (x > x0 && x + l > x0 + largeurUtile) { x = x0; y += H_LIGNE; lignes++; }
            t.setAttribute('x', x);
            t.setAttribute('y', y);
            x += l + ECART;
        });
    }

    return { el: groupe, hauteur: lignes * H_LIGNE + 4 * k };
}

/** Construit une échelle graphique de longueur « ronde » en bas du plan. */
function buildScaleBar(vue, pxParMetre, k) {
    const { textColor } = getThemeColors();
    const cible = vue.w * 0.22; // ~22 % de la largeur du cadre
    const PALIERS = [0.05, 0.10, 0.20, 0.25, 0.50, 1, 2, 5, 10];
    let metres = PALIERS[0];
    for (const p of PALIERS) { if (p * pxParMetre <= cible) metres = p; }

    const longueur = metres * pxParMetre;
    const x = vue.x + 14 * k;
    const y = vue.y + vue.h - 9 * k; // dans la bande réservée sous le dessin
    const t = 4 * k;
    const libelle = metres >= 1 ? `${metres} m` : `${(metres * 100).toFixed(0)} cm`;

    return `
        <g class="plan-scale-bar" opacity="0.85">
            <line x1="${x}" y1="${y}" x2="${x + longueur}" y2="${y}" stroke="${textColor}" stroke-width="${1.6 * k}"/>
            <line x1="${x}" y1="${y - t}" x2="${x}" y2="${y + t}" stroke="${textColor}" stroke-width="${1.6 * k}"/>
            <line x1="${x + longueur}" y1="${y - t}" x2="${x + longueur}" y2="${y + t}" stroke="${textColor}" stroke-width="${1.6 * k}"/>
            <text x="${x + longueur / 2}" y="${y - 6 * k}" text-anchor="middle" font-size="${11 * k}" fill="${textColor}">${libelle}</text>
        </g>`;
}

/**
 * Installe le bouton d'agrandissement du plan et sa surimpression plein écran.
 * Appelé une seule fois au chargement ; sans effet si la page n'a pas de plan.
 */
function initPlanViewer(containerId = 'svgContainer') {
    const container = document.getElementById(containerId);
    if (!container || document.getElementById('planZoomBtn')) return;

    const bouton = document.createElement('button');
    bouton.id = 'planZoomBtn';
    bouton.className = 'plan-zoom-btn';
    bouton.type = 'button';
    bouton.title = 'Agrandir le plan';
    bouton.setAttribute('aria-label', 'Agrandir le plan de ferraillage');
    bouton.innerHTML = '⛶';
    bouton.addEventListener('click', () => openPlanOverlay(containerId));
    container.appendChild(bouton);
}

function openPlanOverlay(containerId) {
    const svg = document.querySelector(`#${containerId} svg`);
    if (!svg) return;

    const overlay = document.createElement('div');
    overlay.className = 'plan-overlay';
    overlay.innerHTML = `
        <div class="plan-overlay-inner">
            <button class="plan-overlay-close" type="button" aria-label="Fermer">&times;</button>
            <div class="plan-overlay-svg"></div>
        </div>`;

    const clone = svg.cloneNode(true);
    clone.style.width = '100%';
    clone.style.height = '100%';
    overlay.querySelector('.plan-overlay-svg').appendChild(clone);

    const fermer = () => {
        overlay.remove();
        document.removeEventListener('keydown', surEchap);
    };
    const surEchap = (e) => { if (e.key === 'Escape') fermer(); };

    overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer(); });
    overlay.querySelector('.plan-overlay-close').addEventListener('click', fermer);
    document.addEventListener('keydown', surEchap);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));
}

// ==========================================
// GÉNÉRATION DE RAPPORTS PDF (FORMAT A4)
// ==========================================

function getPDFHeader(moduleTitle, pageNum) {
    return `
        <div class="pdf-header">
            <div class="pdf-header-top">
                <div class="pdf-header-title">${moduleTitle}</div>
                <div class="pdf-header-badge">EUROCODE 2</div>
            </div>
            <div class="pdf-header-subtitle">Note de calcul réglementaire complète • EC2 Assistant</div>
        </div>
    `;
}

const PDF_NB_PAGES = 4;

function getPDFFooter(pageNum) {
    return `
        <div class="pdf-footer">
            <span>EC2 Assistant - Outil Pédagogique par Raphaël ELIARD</span>
            <span>Date: ${new Date().toLocaleDateString('fr-FR')}</span>
            <span>Page ${pageNum} sur ${PDF_NB_PAGES}</span>
        </div>
    `;
}

function renderFormulaCard(title, ec2Ref, literal, values, result, explanationHTML) {
    return `
        <div class="pdf-formula-card">
            <div class="pdf-formula-title">
                <span>${title}</span>
                <span class="pdf-formula-ref">${ec2Ref}</span>
            </div>
            <div class="pdf-formula-math">${literal}</div>
            <div class="pdf-formula-values">${values}</div>
            <div class="pdf-formula-result">${result}</div>
            ${explanationHTML ? `<ul class="pdf-variables-list">${explanationHTML}</ul>` : ''}
        </div>
    `;
}

/**
 * Désignation normalisée d'une classe de béton (EC2 Tableau 3.1).
 * f_ck,cube n'est pas égal à f_ck + 5 au-delà de C25/30 : la correspondance
 * doit être lue dans le tableau, pas calculée.
 */
function getClasseBeton(fck) {
    const CLASSES = {
        12: 'C12/15', 16: 'C16/20', 20: 'C20/25', 25: 'C25/30', 30: 'C30/37',
        35: 'C35/45', 40: 'C40/50', 45: 'C45/55', 50: 'C50/60'
    };
    return CLASSES[Math.round(fck)] || `f_ck = ${fck} MPa`;
}

/** Entrées réellement utilisées par le calcul (bornées par ec2-core.js). */
function entreesPDF(state) {
    return Object.assign({}, state.inputs, (state.results && state.results.inputs) || {});
}

/** Lignes communes de durabilité (classe d'exposition et enrobage requis). */
function lignesDurabilite(p, res) {
    const expo = (typeof EC2 !== 'undefined' && EC2.EXPOSITIONS[p.exposition]) || null;
    if (!expo || !res.enrobage) return '';
    const det = res.enrobage.detail || res.enrobage.barre || {};
    return `<tr><td>Classe d'exposition</td><td>—</td><td>${p.exposition}</td><td>${expo.texte} — classe structurale S${det.classe || '?'} (EC2 §4.4.1)</td></tr>
            <tr><td>Enrobage nominal requis</td><td>c<sub>nom</sub></td><td>&ge; ${(res.enrobage.requis / 10).toFixed(1)} cm</td><td>c<sub>min</sub> + &Delta;c<sub>dev</sub> (&Delta;c<sub>dev</sub> = 10 mm)</td></tr>`;
}

function buildPage1(moduleType, moduleTitle, state) {
    const p = entreesPDF(state);
    const res = state.results;
    let geomRows = '';
    let loadRows = '';
    
    if (moduleType === 'poutre') {
        geomRows = `
            <tr><td>Portée de calcul (L)</td><td>L</td><td>${p.L.toFixed(2)} m</td><td>Longueur libre entre appuis</td></tr>
            <tr><td>Largeur de la section (b)</td><td>b</td><td>${p.b.toFixed(2)} m</td><td>Dimension transversale de la poutre</td></tr>
            <tr><td>Hauteur totale (h)</td><td>h</td><td>${p.h.toFixed(2)} m</td><td>Hauteur de la section droite</td></tr>
            <tr><td>Enrobage nominal (c<sub>nom</sub>)</td><td>c<sub>nom</sub></td><td>${p.enrobage.toFixed(1)} cm</td><td>Distance entre cadre et parement (EC2 §4.4.1)</td></tr>
            ${lignesDurabilite(p, res)}
        `;
        loadRows = `
            <tr><td>Charge permanente saisie (G)</td><td>G</td><td>${p.G.toFixed(2)} kN/ml</td><td>Charges permanentes ${p.poidsPropre ? 'hors poids propre' : '(poids propre inclus par l\'utilisateur)'}</td></tr>
            <tr><td>Charge permanente totale</td><td>G<sub>tot</sub></td><td>${res.G_tot.toFixed(2)} kN/ml</td><td>${p.poidsPropre ? `G + b &times; h &times; 25 = G + ${res.poidsPropre.toFixed(2)} kN/ml` : 'Poids propre non ajouté automatiquement'}</td></tr>
            <tr><td>Charge d'exploitation (Q)</td><td>Q</td><td>${p.Q.toFixed(2)} kN/ml</td><td>Charges variables d'usage (&psi;<sub>2</sub> = ${res.psi2})</td></tr>
            <tr><td>Charge ultime ELU (p<sub>Ed</sub>)</td><td>p<sub>Ed</sub></td><td>${res.p_elu.toFixed(2)} kN/ml</td><td>Combinaison ultime : 1.35 &times; G<sub>tot</sub> + 1.5 &times; Q (EC0 6.10)</td></tr>
            <tr><td>Moments de service</td><td>M<sub>car</sub> / M<sub>qp</sub></td><td>${res.M_car.toFixed(1)} / ${res.M_qp.toFixed(1)} kN.m</td><td>G<sub>tot</sub> + Q et G<sub>tot</sub> + &psi;<sub>2</sub>Q (ELS)</td></tr>
            <tr><td>Moment fléchissant ultime (M<sub>Ed</sub>)</td><td>M<sub>Ed</sub></td><td>${res.Med.toFixed(2)} kN.m</td><td>Sollicitation maximale en flexion simple à mi-portée</td></tr>
            <tr><td>Effort tranchant ultime (V<sub>Ed</sub>)</td><td>V<sub>Ed</sub></td><td>${res.Ved.toFixed(2)} kN</td><td>Sollicitation maximale en cisaillement aux appuis</td></tr>
        `;
    } else if (moduleType === 'dalle') {
        geomRows = `
            <tr><td>Portée de la dalle (L)</td><td>L</td><td>${p.L.toFixed(2)} m</td><td>Portée libre de calcul</td></tr>
            <tr><td>Épaisseur de la dalle (h)</td><td>h</td><td>${p.h.toFixed(2)} m</td><td>Hauteur totale de la section courante</td></tr>
            <tr><td>Largeur d'étude (b)</td><td>b</td><td>1.00 m</td><td>Bande unitaire d'analyse transversale</td></tr>
            <tr><td>Enrobage nominal (c)</td><td>c</td><td>${p.enrobage.toFixed(1)} cm</td><td>Enrobage des aciers de flexion (EC2 §4.4.1)</td></tr>
            ${lignesDurabilite(p, res)}
        `;
        loadRows = `
            <tr><td>Charge permanente saisie (G)</td><td>G</td><td>${p.G.toFixed(2)} kN/m²</td><td>Finitions, cloisons${p.poidsPropre ? ' (hors poids propre)' : ' (poids propre inclus par l\'utilisateur)'}</td></tr>
            <tr><td>Charge permanente totale</td><td>G<sub>tot</sub></td><td>${res.G_tot.toFixed(2)} kN/m²</td><td>${p.poidsPropre ? `G + h &times; 25 = G + ${res.poidsPropre.toFixed(2)} kN/m²` : 'Poids propre non ajouté automatiquement'}</td></tr>
            <tr><td>Charge d'exploitation (Q)</td><td>Q</td><td>${p.Q.toFixed(2)} kN/m²</td><td>Charges de service (&psi;<sub>2</sub> = ${res.psi2})</td></tr>
            <tr><td>Charge ultime ELU (p<sub>Ed</sub>)</td><td>p<sub>Ed</sub></td><td>${res.p_elu.toFixed(2)} kN/ml</td><td>Combinaison ultime : 1.35 &times; G<sub>tot</sub> + 1.5 &times; Q (pour b = 1 m)</td></tr>
            <tr><td>Moment fléchissant ultime (M<sub>Ed</sub>)</td><td>M<sub>Ed</sub></td><td>${res.Med.toFixed(2)} kN.m/ml</td><td>Moment de flexion maximum à l'ELU</td></tr>
            <tr><td>Effort tranchant ultime (V<sub>Ed</sub>)</td><td>V<sub>Ed</sub></td><td>${res.Ved.toFixed(2)} kN/ml</td><td>Effort tranchant maximum à l'ELU aux appuis</td></tr>
        `;
    } else if (moduleType === 'poteau') {
        geomRows = `
            <tr><td>Hauteur libre (L)</td><td>L</td><td>${p.L.toFixed(2)} m</td><td>Hauteur physique du poteau entre noeuds</td></tr>
            <tr><td>Largeur de section (a)</td><td>a</td><td>${p.a.toFixed(2)} m</td><td>Dimension transversale principale du poteau</td></tr>
            <tr><td>Épaisseur de section (b)</td><td>b</td><td>${p.b.toFixed(2)} m</td><td>Dimension transversale secondaire du poteau</td></tr>
            <tr><td>Coeff. de flambement (&beta;)</td><td>&beta;</td><td>${p.beta}</td><td>Dépend des conditions de liaisons aux extrémités</td></tr>
            <tr><td>Enrobage nominal (c)</td><td>c</td><td>${p.enrobage.toFixed(1)} cm</td><td>Enrobage des cadres (EC2 §4.4.1)</td></tr>
            <tr><td>Coefficient de fluage effectif</td><td>&phi;<sub>ef</sub></td><td>${p.phi_ef.toFixed(2)}</td><td>Intervient dans &lambda;<sub>lim</sub> et K<sub>&phi;</sub> (EC2 §5.8.4)</td></tr>
            ${lignesDurabilite(p, res)}
        `;
        loadRows = `
            <tr><td>Effort Normal ultime (N<sub>Ed</sub>)</td><td>N<sub>Ed</sub></td><td>${p.N_Ed.toFixed(2)} kN</td><td>Charge axiale de compression ultime (ELU)</td></tr>
            <tr><td>Moment du premier ordre (M<sub>Ed</sub>)</td><td>M<sub>Ed</sub></td><td>${p.M_Ed.toFixed(2)} kN.m</td><td>Moment appliqué, supposé agir dans le plan de flambement</td></tr>
        `;
    } else if (moduleType === 'voile') {
        geomRows = `
            <tr><td>Épaisseur du voile (h)</td><td>h</td><td>${p.h.toFixed(2)} m</td><td>Épaisseur brute du béton</td></tr>
            <tr><td>Largeur d'étude (b)</td><td>b</td><td>1.00 m</td><td>Bande unitaire verticale d'analyse</td></tr>
            <tr><td>Enrobage nominal (c)</td><td>c</td><td>${p.enrobage.toFixed(1)} cm</td><td>Enrobage réglementaire (EC2 §4.4.1)</td></tr>
            <tr><td>Hauteur libre du voile</td><td>l<sub>w</sub></td><td>${p.L_w.toFixed(2)} m</td><td>Longueur de flambement l<sub>0</sub> = &beta; &times; l<sub>w</sub> = ${res.l0.toFixed(2)} m</td></tr>
            <tr><td>Coefficient de fluage effectif</td><td>&phi;<sub>ef</sub></td><td>${p.phi_ef.toFixed(2)}</td><td>EC2 §5.8.4</td></tr>
            ${lignesDurabilite(p, res)}
        `;
        loadRows = `
            <tr><td>Effort Normal ultime (N<sub>Ed</sub>)</td><td>N<sub>Ed</sub></td><td>${p.N_Ed.toFixed(2)} kN/ml</td><td>Effort normal vertical de compression ultime</td></tr>
            <tr><td>Effort Tranchant ultime (V<sub>Ed</sub>)</td><td>V<sub>Ed</sub></td><td>${p.V_Ed.toFixed(2)} kN/ml</td><td>Effort tranchant horizontal ultime hors-plan</td></tr>
        `;
    } else if (moduleType === 'semelle_filante') {
        geomRows = `
            <tr><td>Épaisseur du voile (a)</td><td>a</td><td>${p.a.toFixed(2)} m</td><td>Largeur du mur/voile s'appuyant sur la semelle</td></tr>
            <tr><td>Largeur de la semelle (B)</td><td>B</td><td>${p.B.toFixed(2)} m</td><td>Largeur totale de la base de la fondation</td></tr>
            <tr><td>Hauteur de la semelle (h)</td><td>h</td><td>${p.h.toFixed(2)} m</td><td>Hauteur totale de la fondation filante</td></tr>
            <tr><td>Enrobage nominal (c)</td><td>c</td><td>${p.enrobage.toFixed(1)} cm</td><td>Enrobage des aciers de semelle (EC2 §4.4.1)</td></tr>
            ${lignesDurabilite(p, res)}
        `;
        loadRows = `
            <tr><td>Charge de service ELS (N<sub>Eq</sub>)</td><td>N<sub>Eq</sub></td><td>${p.N_Eq.toFixed(2)} kN/ml</td><td>Charge axiale verticale de service (ELS)</td></tr>
            <tr><td>Charge ultime ELU (N<sub>Ed</sub>)</td><td>N<sub>Ed</sub></td><td>${p.N_Ed.toFixed(2)} kN/ml</td><td>Charge axiale verticale ultime (ELU)</td></tr>
            <tr><td>Contrainte sol adm. (q<sub>adm</sub>)</td><td>q<sub>adm</sub></td><td>${p.q_adm.toFixed(3)} MPa</td><td>Capacité portante admissible du sol (pression brute)</td></tr>
        `;
    } else if (moduleType === 'semelle_isolee') {
        geomRows = `
            <tr><td>Dimensions du poteau (a &times; b)</td><td>a &times; b</td><td>${p.a.toFixed(2)} &times; ${p.b.toFixed(2)} m</td><td>Section transversale du poteau s'appuyant sur la semelle</td></tr>
            <tr><td>Dimensions semelle (A &times; B)</td><td>A &times; B</td><td>${p.A.toFixed(2)} &times; ${p.B.toFixed(2)} m</td><td>Dimensions de la semelle en plan</td></tr>
            <tr><td>Hauteur de la semelle (h)</td><td>h</td><td>${p.h.toFixed(2)} m</td><td>Hauteur totale de la fondation isolée</td></tr>
            <tr><td>Enrobage nominal (c)</td><td>c</td><td>${p.enrobage.toFixed(1)} cm</td><td>Enrobage minimal réglementaire (EC2 §4.4.1)</td></tr>
            ${lignesDurabilite(p, res)}
        `;
        loadRows = `
            <tr><td>Charge de service ELS (N<sub>Eq</sub>)</td><td>N<sub>Eq</sub></td><td>${p.N_Eq.toFixed(2)} kN</td><td>Charge verticale de service (ELS)</td></tr>
            <tr><td>Charge ultime ELU (N<sub>Ed</sub>)</td><td>N<sub>Ed</sub></td><td>${p.N_Ed.toFixed(2)} kN</td><td>Charge verticale ultime (ELU)</td></tr>
            <tr><td>Contrainte sol adm. (q<sub>adm</sub>)</td><td>q<sub>adm</sub></td><td>${p.q_adm.toFixed(3)} MPa</td><td>Capacité portante admissible du sol (pression brute)</td></tr>
        `;
    }
    
    const fck = parseFloat(p.fck);
    const fyk = parseFloat(p.fyk || 500);
    const fcd = res.fcd ? parseFloat(res.fcd) : (1.0 * fck / 1.5);
    const fyd = (fyk / 1.15);
    const classeBeton = getClasseBeton(fck);

    return `
        <div class="pdf-page" id="pdf-page-1">
            <div class="pdf-content">
                ${getPDFHeader(moduleTitle, 1)}
                
                <div class="pdf-section-title">1. Informations Générales</div>
                <table class="pdf-table">
                    <tr><th>Paramètre</th><th>Valeur</th><th>Description / Contexte</th></tr>
                    <tr><td>Logiciel d'analyse</td><td>EC2 Assistant v2.0</td><td>Outil de conception et d'apprentissage du Béton Armé</td></tr>
                    <tr><td>Auteur de l'étude</td><td>Raphaël ELIARD</td><td>Concepteur & Auteur pédagogique</td></tr>
                    <tr><td>Règlement de calcul</td><td>NF EN 1992-1-1 / NA</td><td>Eurocode 2 : Calcul des structures en béton</td></tr>
                    <tr><td>Date du rapport</td><td>${new Date().toLocaleDateString('fr-FR')}</td><td>Date de génération de la présente note de calcul</td></tr>
                </table>
                
                <div class="pdf-section-title">2. Hypothèses Géométriques</div>
                <table class="pdf-table">
                    <thead>
                        <tr><th>Désignation</th><th>Symbole</th><th>Valeur</th><th>Description réglementaire</th></tr>
                    </thead>
                    <tbody>
                        ${geomRows}
                    </tbody>
                </table>
                
                <div class="pdf-section-title">3. Propriétés des Matériaux</div>
                <table class="pdf-table">
                    <thead>
                        <tr><th>Matériau</th><th>Caractéristique</th><th>Symbole</th><th>Valeur</th><th>Formule / Clause EC2</th></tr>
                    </thead>
                    <tbody>
                        <tr><td rowspan="4" style="vertical-align:middle; font-weight:bold;">BÉTON</td><td>Résistance à la compression</td><td>f<sub>ck</sub></td><td>${fck.toFixed(0)} MPa</td><td>Classe béton ${classeBeton} (EC2 Table 3.1)</td></tr>
                        <tr><td>Résistance de calcul</td><td>f<sub>cd</sub></td><td>${fcd.toFixed(2)} MPa</td><td>f<sub>cd</sub> = &alpha;<sub>cc</sub> &times; f<sub>ck</sub> / &gamma;<sub>c</sub> (EC2 §3.1.6)</td></tr>
                        <tr><td>Coeff. partiel béton</td><td>&gamma;<sub>c</sub></td><td>1.50</td><td>Situation durable et transitoire (EC2 Table 2.1N)</td></tr>
                        <tr><td>Facteur d'échelle temporel</td><td>&alpha;<sub>cc</sub></td><td>1.00</td><td>Prise en compte des effets à long terme (EC2 §3.1.6)</td></tr>
                        
                        <tr><td rowspan="3" style="vertical-align:middle; font-weight:bold;">ACIER</td><td>Limite élastique nominale</td><td>f<sub>yk</sub></td><td>${fyk.toFixed(0)} MPa</td><td>Classe d'acier S${fyk} (EC2 §3.2)</td></tr>
                        <tr><td>Limite élastique de calcul</td><td>f<sub>yd</sub></td><td>${fyd.toFixed(2)} MPa</td><td>f<sub>yd</sub> = f<sub>yk</sub> / &gamma;<sub>s</sub> (EC2 §3.2.7)</td></tr>
                        <tr><td>Coeff. partiel acier</td><td>&gamma;<sub>s</sub></td><td>1.15</td><td>Situation durable et transitoire (EC2 Table 2.1N)</td></tr>
                    </tbody>
                </table>
                
                <div class="pdf-section-title">4. Actions & Sollicitations de Calcul</div>
                <table class="pdf-table">
                    <thead>
                        <tr><th>Actions / Effort</th><th>Symbole</th><th>Valeur de calcul</th><th>Description physique / Règlement</th></tr>
                    </thead>
                    <tbody>
                        ${loadRows}
                    </tbody>
                </table>
            </div>
            ${getPDFFooter(1)}
        </div>
    `;
}

function buildPage2(moduleType, moduleTitle, state) {
    const p = entreesPDF(state);
    const res = state.results;
    let calculationCards = '';
    
    if (moduleType === 'poutre') {
        calculationCards += '<div class="pdf-grid-2">';
        
        calculationCards += renderFormulaCard(
            "1. Charge linéaire ultime (ELU)",
            "EC2 §5.1 / Combinaisons",
            `p<sub>Ed</sub> = 1.35 &times; G<sub>tot</sub> + 1.5 &times; Q`,
            `p<sub>Ed</sub> = 1.35 &times; ${res.G_tot.toFixed(2)} + 1.5 &times; ${p.Q.toFixed(2)}`,
            `p<sub>Ed</sub> = ${res.p_elu.toFixed(2)} kN/ml`,
            `<li><strong>G<sub>tot</sub></strong> : charge permanente totale${p.poidsPropre ? ', poids propre compris' : ''} (${res.G_tot.toFixed(2)} kN/ml)</li>
             <li><strong>Q</strong> : charge d'exploitation linéarisée (${p.Q.toFixed(2)} kN/ml)</li>`
        );
        
        calculationCards += renderFormulaCard(
            "2. Sollicitations de calcul (Flexion & Cisaillement)",
            "Mécanique des Structures / RDM",
            `M<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">p<sub>Ed</sub> &times; L<sup>2</sup></span><span class="pdf-math-den">8</span></span> &nbsp;,&nbsp; V<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">p<sub>Ed</sub> &times; L</span><span class="pdf-math-den">2</span></span>`,
            `M<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.p_elu.toFixed(2)} &times; ${p.L.toFixed(2)}<sup>2</sup></span><span class="pdf-math-den">8</span></span> = ${res.Med.toFixed(2)} kN.m &nbsp;,&nbsp; V<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.p_elu.toFixed(2)} &times; ${p.L.toFixed(2)}</span><span class="pdf-math-den">2</span></span> = ${res.Ved.toFixed(2)} kN`,
            `M<sub>Ed</sub> = ${res.Med.toFixed(2)} kN.m &nbsp;|&nbsp; V<sub>Ed</sub> = ${res.Ved.toFixed(2)} kN`,
            `<li><strong>L</strong> : portée libre de la poutre (${p.L.toFixed(2)} m)</li>`
        );

        calculationCards += renderFormulaCard(
            "3. Hauteur utile de la section",
            "EC2 §5.1",
            `d = h - c<sub>nom</sub> - &phi;<sub>t</sub> - <span class="pdf-math-frac"><span class="pdf-math-num">&phi;<sub>l</sub></span><span class="pdf-math-den">2</span></span>`,
            `d = ${p.h.toFixed(2)} - ${(p.enrobage / 100).toFixed(3)} - 0.008 - <span class="pdf-math-frac"><span class="pdf-math-num">${(state.selectedDiameter/1000).toFixed(3)}</span><span class="pdf-math-den">2</span></span>`,
            `d = ${res.d.toFixed(3)} m`,
            `<li><strong>h</strong> : hauteur de la poutre (${p.h.toFixed(2)} m)</li>
             <li><strong>c<sub>nom</sub></strong> : enrobage nominal (${p.enrobage.toFixed(1)} cm)</li>
             <li><strong>&phi;<sub>t</sub></strong> : diamètre du cadre transversal (8 mm par défaut)</li>
             <li><strong>&phi;<sub>l</sub></strong> : diamètre des barres longitudinales choisies (${state.selectedDiameter} mm)</li>`
        );

        calculationCards += renderFormulaCard(
            "4. Moment fléchissant réduit & Position axe neutre",
            "EC2 §6.1 / §3.1.7",
            `&mu;<sub>cu</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">M<sub>Ed</sub></span><span class="pdf-math-den">b &times; d<sup>2</sup> &times; f<sub>cd</sub></span></span> &nbsp;,&nbsp; &alpha; = 1.25 &times; (1 - &radic;<span style="border-top:1px solid #2c3e50; padding-top:1px;">1 - 2&mu;<sub>cu</sub></span>)`,
            `&mu;<sub>cu</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.Med.toFixed(2)} &times; 10<sup>-3</sup></span><span class="pdf-math-den">${p.b.toFixed(2)} &times; ${res.d.toFixed(3)}<sup>2</sup> &times; ${res.fcd.toFixed(2)}</span></span> = ${res.mu_cu.toFixed(3)} &nbsp;,&nbsp; &alpha; = 1.25 &times; (1 - &radic;<span style="border-top:1px solid #2c3e50; padding-top:1px;">1 - 2 &times; ${res.mu_cu.toFixed(3)}</span>) = ${res.alpha.toFixed(3)}`,
            `&mu;<sub>cu</sub> = ${res.mu_cu.toFixed(3)} &nbsp;|&nbsp; &alpha; = ${res.alpha.toFixed(3)}`,
            `<li><strong>&mu;<sub>cu</sub></strong> : moment réduit de flexion (limité à &mu;<sub>lim</sub> = 0.372 pour éviter les aciers comprimés)</li>
             <li><strong>&alpha;</strong> : position relative de l'axe neutre (distance y = &alpha; &times; d)</li>`
        );

        calculationCards += renderFormulaCard(
            "5. Bras de levier & Section longitudinale requise",
            "EC2 §6.1",
            `z = d &times; (1 - 0.4 &times; &alpha;) &nbsp;,&nbsp; A<sub>s,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">M<sub>Ed</sub></span><span class="pdf-math-den">z &times; f<sub>yd</sub></span></span>`,
            `z = ${res.d.toFixed(3)} &times; (1 - 0.4 &times; ${res.alpha.toFixed(3)}) = ${res.z.toFixed(3)} m &nbsp;,&nbsp; A<sub>s,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.Med.toFixed(2)} &times; 10</span><span class="pdf-math-den">${res.z.toFixed(3)} &times; ${res.fyd_cm2.toFixed(3)}</span></span>`,
            `z = ${res.z.toFixed(3)} m &nbsp;|&nbsp; A<sub>s,req</sub> = ${res.As_req.toFixed(2)} cm²`,
            `<li><strong>z</strong> : bras de levier des forces internes de flexion</li>
             <li><strong>f<sub>yd</sub></strong> : limite élastique de calcul des aciers (${res.fyd_cm2.toFixed(3)} kN/cm²)</li>`
        );

        calculationCards += renderFormulaCard(
            "6. Effort tranchant ultime & Armatures transversales",
            "EC2 §6.2.3",
            `V<sub>Rd,max</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">b<sub>w</sub> &times; z &times; &nu;<sub>1</sub> &times; f<sub>cd</sub></span><span class="pdf-math-den">cot&theta; + tan&theta;</span></span> &nbsp;,&nbsp; <span class="pdf-math-frac"><span class="pdf-math-num">A<sub>sw</sub></span><span class="pdf-math-den">s</span></span> = <span class="pdf-math-frac"><span class="pdf-math-num">V<sub>Ed</sub></span><span class="pdf-math-den">z &times; f<sub>yd</sub> &times; cot&theta;</span></span>`,
            `V<sub>Rd,max</sub> = ${res.Vrd_max_45.toFixed(1)} kN &nbsp;,&nbsp; <span class="pdf-math-frac"><span class="pdf-math-num">A<sub>sw</sub></span><span class="pdf-math-den">s</span></span> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.Ved.toFixed(2)}</span><span class="pdf-math-den">${res.z.toFixed(3)} &times; ${res.fyd_cm2.toFixed(3)} &times; ${res.cotTheta.toFixed(2)}</span></span>`,
            `V<sub>Rd,max</sub> = ${res.Vrd_max_45.toFixed(1)} kN &nbsp;|&nbsp; A<sub>sw</sub>/s = ${res.Asw_s.toFixed(2)} cm²/m`,
            `<li><strong>V<sub>Rd,max</sub></strong> : résistance maximale de la bielle de béton comprimée (&theta; = 45&deg;)</li>
             <li><strong>&nu;<sub>1</sub></strong> : coefficient d'efficacité du béton fissuré (&nu;<sub>1</sub> = 0.6 &times; [1 - f<sub>ck</sub>/250])</li>
             <li><strong>cot&theta;</strong> : inclinaison des bielles retenue (${res.cotTheta.toFixed(2)}, bornée entre 1 et 2.5)</li>
             <li><strong>V<sub>Rd,c</sub></strong> = ${res.V_Rdc.toFixed(1)} kN : ${res.cisaillementMinimal ? 'V<sub>Ed</sub> &le; V<sub>Rd,c</sub>, armatures minimales seules' : 'V<sub>Ed</sub> &gt; V<sub>Rd,c</sub>, cadres calculés'}</li>
             <li><strong>A<sub>sw</sub>/s</strong> : section de cadres d'acier transversaux requis par mètre linéaire</li>`
        );
        
        calculationCards += '</div>';
    } else if (moduleType === 'dalle') {
        calculationCards += renderFormulaCard(
            "1. Moments fléchissants et effort tranchant ultime",
            "EC2 §5.1 / Combinaisons",
            `M<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">p<sub>Ed</sub> &times; L<sup>2</sup></span><span class="pdf-math-den">8</span></span> &nbsp;,&nbsp; V<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">p<sub>Ed</sub> &times; L</span><span class="pdf-math-den">2</span></span>`,
            `M<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.p_elu.toFixed(2)} &times; ${p.L.toFixed(2)}<sup>2</sup></span><span class="pdf-math-den">8</span></span> = ${res.Med.toFixed(2)} kN.m/ml &nbsp;,&nbsp; V<sub>Ed</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.p_elu.toFixed(2)} &times; ${p.L.toFixed(2)}</span><span class="pdf-math-den">2</span></span> = ${res.Ved.toFixed(2)} kN/ml`,
            `M<sub>Ed</sub> = ${res.Med.toFixed(2)} kN.m/ml &nbsp;|&nbsp; V<sub>Ed</sub> = ${res.Ved.toFixed(2)} kN/ml`,
            `<li><strong>p<sub>Ed</sub></strong> : charge ultime linéaire par mètre de bande (${res.p_elu.toFixed(2)} kN/ml)</li>`
        );

        calculationCards += renderFormulaCard(
            "2. Hauteur utile & Armatures minimales de flexion",
            "EC2 §5.1 / §9.2.1.1",
            `d = h - c - <span class="pdf-math-frac"><span class="pdf-math-num">&phi;<sub>l</sub></span><span class="pdf-math-den">2</span></span> &nbsp;,&nbsp; A<sub>s,min</sub> = max(0.26 &times; <span class="pdf-math-frac"><span class="pdf-math-num">f<sub>ctm</sub></span><span class="pdf-math-den">f<sub>yk</sub></span></span> &times; b &times; d &nbsp;;&nbsp; 0.0013 &times; b &times; d)`,
            `d = ${p.h.toFixed(2)} - ${(p.enrobage/100).toFixed(3)} - ${(state.diamMain/2000).toFixed(3)} = ${res.d.toFixed(3)} m &nbsp;,&nbsp; A<sub>s,min</sub> = max(0.26 &times; <span class="pdf-math-frac"><span class="pdf-math-num">${res.fctm.toFixed(2)}</span><span class="pdf-math-den">500</span></span> &times; 100 &times; ${res.d.toFixed(3)} &times; 100 &nbsp;;&nbsp; 0.0013 &times; 100 &times; ${res.d.toFixed(3)} &times; 100)`,
            `d = ${res.d.toFixed(3)} m &nbsp;|&nbsp; A<sub>s,min</sub> = ${res.As_min.toFixed(2)} cm²/ml`,
            `<li><strong>f<sub>ctm</sub></strong> : résistance moyenne en traction du béton (${getClasseBeton(p.fck)} : ${res.fctm.toFixed(2)} MPa)</li>
             <li><strong>A<sub>s,min</sub></strong> : section minimale pour éviter la rupture fragile de la dalle</li>`
        );

        calculationCards += renderFormulaCard(
            "3. Moment réduit & Section d'aciers principaux requis",
            "EC2 §6.1",
            `&mu;<sub>cu</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">M<sub>Ed</sub></span><span class="pdf-math-den">b &times; d<sup>2</sup> &times; f<sub>cd</sub></span></span> &nbsp;,&nbsp; A<sub>s,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">M<sub>Ed</sub></span><span class="pdf-math-den">z &times; f<sub>yd</sub></span></span>`,
            `&mu;<sub>cu</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.Med.toFixed(2)} &times; 10<sup>-3</sup></span><span class="pdf-math-den">1.00 &times; ${res.d.toFixed(3)}<sup>2</sup> &times; ${res.fcd.toFixed(2)}</span></span> = ${res.mu_cu.toFixed(3)} &nbsp;,&nbsp; A<sub>s,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${res.Med.toFixed(2)} &times; 10</span><span class="pdf-math-den">${res.z.toFixed(3)} &times; ${res.fyd_cm2.toFixed(3)}</span></span>`,
            `A<sub>s,req</sub> = ${res.As_req.toFixed(2)} cm²/ml`,
            `<li><strong>z</strong> : bras de levier de la section béton (${res.z.toFixed(3)} m)</li>`
        );

        calculationCards += renderFormulaCard(
            "4. Résistance au cisaillement du béton sans armatures",
            "EC2 §6.2.2",
            `V<sub>Rd,c</sub> = [C<sub>Rd,c</sub> &times; k &times; (100 &times; &rho;<sub>l</sub> &times; f<sub>ck</sub>)<sup>1/3</sup>] &times; b &times; d &nbsp;&ge; &nu;<sub>min</sub> &times; b &times; d`,
            `V<sub>Rd,c</sub> = max[0.12 &times; ${res.k.toFixed(3)} &times; (100 &times; ${res.rho_l.toFixed(5)} &times; ${p.fck})<sup>1/3</sup> ; v<sub>min</sub> = ${res.v_min.toFixed(3)}] &times; 1000 &times; ${res.d.toFixed(3)}`,
            `V<sub>Rd,c</sub> = ${res.V_Rdc.toFixed(1)} kN/ml &nbsp;(Effort tranchant limite admissible par le béton seul)`,
            `<li><strong>k</strong> : facteur d'échelle hauteur 1 + &radic;<span style="border-top:1px solid #2c3e50; padding-top:1px;">200/(d&times;1000)</span> = ${res.k.toFixed(3)}</li>
             <li><strong>&rho;<sub>l</sub></strong> : ratio longitudinal d'armatures tendues (${(res.rho_l*100).toFixed(3)}%)</li>`
        );

        calculationCards += renderFormulaCard(
            "5. Armatures transversales de répartition",
            "EC2 §9.3.1.1",
            `A<sub>s,rep,req</sub> = 0.20 &times; A<sub>s,principal,fourni</sub>`,
            `A<sub>s,rep,req</sub> = 0.20 &times; ${res.As_prov.toFixed(2)}`,
            `A<sub>s,rep,req</sub> = ${res.As_rep_req.toFixed(2)} cm²/ml`,
            `<li><strong>A<sub>s,rep,req</sub></strong> : armature de répartition perpendiculaire</li>`
        );
    } else if (moduleType === 'poteau') {
        const v = res.verif;
        // Second ordre évalué avec la section d'acier réellement disposée (K_r en dépend)
        const so = v ? v.e : res;
        calculationCards += renderFormulaCard(
            "1. Élancement et élancement limite",
            "EC2 §5.8.3",
            `l<sub>0</sub> = &beta; &times; L &nbsp;,&nbsp; &lambda; = l<sub>0</sub> &times; &radic;12 / h &nbsp;,&nbsp; &lambda;<sub>lim</sub> = 20 &times; A &times; B &times; C / &radic;n`,
            `l<sub>0</sub> = ${p.beta} &times; ${p.L.toFixed(2)} = ${res.l0.toFixed(2)} m &nbsp;,&nbsp; &lambda; = ${res.lambda.toFixed(1)} &nbsp;,&nbsp; n = ${res.n_rel.toFixed(3)} &nbsp;,&nbsp; A = 1/(1 + 0.2 &times; ${res.phi_ef.toFixed(2)}) = ${res.A_lim.toFixed(3)}`,
            `&lambda; = ${res.lambda.toFixed(1)} ${res.secondOrdre ? '&gt;' : '&le;'} &lambda;<sub>lim</sub> = ${isFinite(res.lambda_lim) ? res.lambda_lim.toFixed(1) : '&infin;'} &nbsp;(${res.secondOrdre ? 'second ordre à prendre en compte' : 'second ordre négligeable'})`,
            `<li><strong>h</strong> : dimension dans le plan de flambement (axe faible) = ${res.h_dir.toFixed(2)} m</li>
             <li><strong>B = 1.1, C = 0.7</strong> : valeurs par défaut (&omega; et r<sub>m</sub> inconnus)</li>`
        );

        calculationCards += renderFormulaCard(
            "2. Moment du premier ordre (imperfections et excentricité minimale)",
            "EC2 §5.2(7) / §6.1(4)",
            `e<sub>i</sub> = &theta;<sub>0</sub> &times; &alpha;<sub>h</sub> &times; l<sub>0</sub> / 2 &nbsp;,&nbsp; M<sub>0Ed</sub> = max( M<sub>Ed</sub> + N<sub>Ed</sub> &times; e<sub>i</sub> ; N<sub>Ed</sub> &times; e<sub>0</sub> ), e<sub>0</sub> = max(h/30 ; 20 mm)`,
            `e<sub>i</sub> = (1/200) &times; ${res.alpha_h.toFixed(3)} &times; ${res.l0.toFixed(2)} / 2 = ${(res.e_i_geo * 1000).toFixed(1)} mm &nbsp;,&nbsp; e<sub>0</sub> = ${(res.e_0_min * 1000).toFixed(1)} mm`,
            `M<sub>0Ed</sub> = ${res.M_0Ed.toFixed(2)} kN.m`,
            `<li>L'excentricité minimale est un <strong>plancher</strong> du moment du premier ordre, elle ne s'y ajoute pas.</li>`
        );

        calculationCards += renderFormulaCard(
            "3. Second ordre : méthode de la courbure nominale",
            "EC2 §5.8.8",
            `M<sub>2</sub> = N<sub>Ed</sub> &times; e<sub>2</sub> &nbsp;,&nbsp; e<sub>2</sub> = K<sub>r</sub> &times; K<sub>&phi;</sub> &times; <span class="pdf-math-frac"><span class="pdf-math-num">f<sub>yd</sub> / E<sub>s</sub></span><span class="pdf-math-den">0.45 d</span></span> &times; <span class="pdf-math-frac"><span class="pdf-math-num">l<sub>0</sub><sup>2</sup></span><span class="pdf-math-den">10</span></span>`,
            `K<sub>r</sub> = ${so.K_r.toFixed(3)} (A<sub>s</sub> = ${(v ? v.As : res.As_req).toFixed(2)} cm²) &nbsp;,&nbsp; K<sub>&phi;</sub> = 1 + (${so.beta_phi.toFixed(3)}) &times; ${res.phi_ef.toFixed(2)} = ${so.K_phi.toFixed(3)} &nbsp;,&nbsp; d = ${res.d.toFixed(3)} m`,
            `e<sub>2</sub> = ${(so.e_2 * 1000).toFixed(1)} mm &nbsp;|&nbsp; M<sub>Ed,tot</sub> = M<sub>0Ed</sub> + M<sub>2</sub> = ${so.M_Ed_tot.toFixed(2)} kN.m`,
            `<li><strong>K<sub>&phi;</sub> &ge; 1</strong> traduit le fluage ; <strong>K<sub>r</sub> &le; 1</strong> la réduction de courbure sous fort effort normal</li>`
        );

        calculationCards += renderFormulaCard(
            "4. Flexion composée : diagramme d'interaction N-M",
            "EC2 §6.1 / §3.1.7 / §3.2.7",
            `(N<sub>Ed</sub> ; M<sub>Ed,tot</sub>) doit se trouver à l'intérieur du diagramme N-M de la section réellement armée`,
            v ? `${v.nbBarres} HA${state.selectedDiameter} (A<sub>s</sub> = ${v.As.toFixed(2)} cm²) : M<sub>Rd</sub>(N<sub>Ed</sub> = ${p.N_Ed.toFixed(0)} kN) = ${isFinite(v.MRd) ? v.MRd.toFixed(1) : '—'} kN.m &nbsp;,&nbsp; N<sub>Rd,max</sub> = ${v.NRd.toFixed(0)} kN` : '—',
            v ? `M<sub>Ed,tot</sub> = ${v.M_Ed_tot.toFixed(1)} kN.m ${v.M_Ed_tot <= v.MRd ? '&le;' : '&gt;'} M<sub>Rd</sub> = ${isFinite(v.MRd) ? v.MRd.toFixed(1) : '—'} kN.m` : '',
            `<li>Béton : loi parabole-rectangle (&epsilon;<sub>c2</sub> = 2 ‰, &epsilon;<sub>cu2</sub> = 3.5 ‰) ; acier à palier horizontal ; pivots A, B, C.</li>
             <li>Section théorique minimale (deux faces symétriques) : A<sub>s,req</sub> = ${isFinite(res.As_req) ? res.As_req.toFixed(2) : '—'} cm² (A<sub>s,min</sub> = ${res.As_min.toFixed(2)} cm², §9.5.2).</li>`
        );
    } else if (moduleType === 'voile') {
        calculationCards += renderFormulaCard(
            "1. Contrainte de compression moyenne sous effort axial",
            "EC2 §6.2.2(1)",
            `&sigma;<sub>cp</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">N<sub>Ed</sub></span><span class="pdf-math-den">A<sub>c</sub></span></span> &nbsp;&le; 0.20 &times; f<sub>cd</sub>`,
            `&sigma;<sub>cp</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.N_Ed.toFixed(2)} &times; 10<sup>-3</sup></span><span class="pdf-math-den">1.00 &times; ${p.h.toFixed(2)}</span></span> = ${res.sigma_cp_calc.toFixed(2)} MPa &nbsp;,&nbsp; Plafond pour V<sub>Rd,c</sub> = 0.20 &times; ${res.fcd.toFixed(2)} = ${(0.20*res.fcd).toFixed(2)} MPa`,
            `&sigma;<sub>cp</sub> = ${res.sigma_cp_calc.toFixed(2)} MPa &nbsp;|&nbsp; N<sub>Rd,0</sub> (centré) = ${res.N_Rd0.toFixed(0)} kN/ml`,
            `<li><strong>A<sub>c</sub></strong> : section brute de béton du voile (${res.Ac.toFixed(0)} cm²/ml)</li>`
        );

        calculationCards += renderFormulaCard(
            "2. Résistance au cisaillement béton (effort tranchant)",
            "EC2 §6.2.2",
            `V<sub>Rd,c</sub> = max( V<sub>Rd,c,calc</sub> , V<sub>Rd,c,min</sub> ) &nbsp;où&nbsp; V<sub>Rd,c,calc</sub> = [ C<sub>Rd,c</sub> &times; k &times; (100 &times; &rho;<sub>l</sub> &times; f<sub>ck</sub>)<sup>1/3</sup> + 0.15 &times; &sigma;<sub>cp</sub> ] &times; b &times; d`,
            `V<sub>Rd,c,calc</sub> = [ 0.12 &times; ${res.k.toFixed(3)} &times; (100 &times; ${res.rho_l.toFixed(5)} &times; ${p.fck})<sup>1/3</sup> + 0.15 &times; ${res.sigma_cp.toFixed(2)} ] &times; 1000 &times; ${res.d.toFixed(3)} = ${res.V_Rdc_calc.toFixed(1)} kN/ml<br>V<sub>Rd,c,min</sub> = ( ${res.v_min.toFixed(3)} + 0.15 &times; ${res.sigma_cp.toFixed(2)} ) &times; 1000 &times; ${res.d.toFixed(3)} = ${res.V_Rdc_min.toFixed(1)} kN/ml`,
            `V<sub>Rd,c</sub> = ${res.V_Rdc.toFixed(1)} kN/ml &nbsp;(Effort tranchant limite admissible par le béton seul)`,
            `<li><strong>k</strong> : facteur d'échelle hauteur 1 + &radic;<span style="border-top:1px solid #2c3e50; padding-top:1px;">200/(d&times;1000)</span> = ${res.k.toFixed(3)}</li>
             <li><strong>&rho;<sub>l</sub></strong> : ratio longitudinal d'armatures tendues (${(res.rho_l*100).toFixed(3)}%)</li>`
        );

        calculationCards += renderFormulaCard(
            "3. Armatures verticales et horizontales minimales",
            "EC2 §9.6.2 & §9.6.3",
            `A<sub>s,v,min</sub> = 0.002 &times; A<sub>c</sub> &nbsp;,&nbsp; A<sub>s,h,min</sub> = max( 0.25 &times; A<sub>s,v,min</sub> &nbsp;;&nbsp; 0.001 &times; A<sub>c</sub> )`,
            `A<sub>s,v,min</sub> = 0.002 &times; ${res.Ac.toFixed(0)} = ${res.As_vmin.toFixed(2)} cm²/ml &nbsp;,&nbsp; A<sub>s,h,min</sub> = max(0.25 &times; ${res.As_vmin.toFixed(2)}; 0.001 &times; ${res.Ac.toFixed(0)}) = ${res.As_hmin.toFixed(2)} cm²/ml`,
            `A<sub>s,v,min</sub> = ${res.As_vmin.toFixed(2)} cm²/ml &nbsp;|&nbsp; A<sub>s,h,min</sub> = ${res.As_hmin.toFixed(2)} cm²/ml`,
            `<li><strong>A<sub>s,v,min</sub></strong> : section minimale d'armatures verticales</li>
             <li><strong>A<sub>s,h,min</sub></strong> : section minimale d'armatures horizontales</li>`
        );

        calculationCards += renderFormulaCard(
            "4. Compression excentrée et flambement hors plan",
            "EC2 §5.2 / §5.8.8 / §6.1(4)",
            `e = max(e<sub>i</sub> ; e<sub>0</sub>) + e<sub>2</sub> &nbsp;,&nbsp; N<sub>Ed</sub> &times; e &le; M<sub>Rd</sub>(N<sub>Ed</sub>)`,
            `l<sub>0</sub> = ${res.l0.toFixed(2)} m, &lambda; = ${res.lambda.toFixed(1)} (&lambda;<sub>lim</sub> = ${isFinite(res.lambda_lim) ? res.lambda_lim.toFixed(1) : '&infin;'}) &nbsp;,&nbsp; e<sub>i</sub> = ${(res.e_i * 1000).toFixed(1)} mm, e<sub>0</sub> = ${(res.e_0_min * 1000).toFixed(0)} mm, e<sub>2</sub> = ${(res.e_2 * 1000).toFixed(1)} mm`,
            `e = ${(res.e_tot * 1000).toFixed(1)} mm &nbsp;|&nbsp; N<sub>Rd</sub>(e) = ${res.N_Rd.toFixed(0)} kN/ml ${p.N_Ed <= res.N_Rd ? '&ge;' : '&lt;'} N<sub>Ed</sub> = ${p.N_Ed.toFixed(0)} kN/ml`,
            `<li>Diagramme N-M de la bande de 1 m avec ses ${p.nappesCount} nappe(s) de treillis soudé.</li>`
        );
    } else if (moduleType === 'semelle_filante') {
        calculationCards += renderFormulaCard(
            "1. Contrainte de pression exercée sur le sol (ELS)",
            "Vérification de la portance (ELS)",
            `P<sub>poids</sub> = B &times; h &times; &gamma;<sub>béton</sub> &nbsp;,&nbsp; &sigma;<sub>sol</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">N<sub>Eq</sub> + P<sub>poids</sub></span><span class="pdf-math-den">B</span></span> &nbsp;&le; q<sub>adm</sub>`,
            `P<sub>poids</sub> = ${p.B.toFixed(2)} &times; ${p.h.toFixed(2)} &times; 25 = ${(p.B * p.h * 25).toFixed(1)} kN/ml &nbsp;,&nbsp; &sigma;<sub>sol</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.N_Eq.toFixed(2)} + ${(p.B * p.h * 25).toFixed(1)}</span><span class="pdf-math-den">${p.B.toFixed(2)} &times; 10<sup>3</sup></span></span>`,
            `&sigma;<sub>sol</sub> = ${res.sigma_sol.toFixed(3)} MPa &nbsp;(Capacité portante admissible q<sub>adm</sub> = ${p.q_adm.toFixed(3)} MPa)`,
            `<li><strong>&gamma;<sub>béton</sub></strong> : masse volumique du béton armé (25 kN/m³)</li>
             <li><strong>N<sub>Eq</sub></strong> : effort normal de service (ELS) transmis par le voile (${p.N_Eq.toFixed(2)} kN/ml)</li>`
        );

        calculationCards += renderFormulaCard(
            "2. Condition de rigidité (Diffusion des contraintes)",
            "Méthode des Bielles (Rapports géométriques)",
            `d<sub>req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">B - a</span><span class="pdf-math-den">4</span></span> &nbsp;,&nbsp; d = h - c - <span class="pdf-math-frac"><span class="pdf-math-num">&phi;<sub>long</sub></span><span class="pdf-math-den">2</span></span>`,
            `d<sub>req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.B.toFixed(2)} - ${p.a.toFixed(2)}</span><span class="pdf-math-den">4</span></span> = ${res.d_req.toFixed(3)} m &nbsp;,&nbsp; d = ${p.h.toFixed(2)} - ${(p.enrobage/100).toFixed(3)} - ${(state.diamMain/2000).toFixed(3)} = ${res.d.toFixed(3)} m`,
            `d<sub>req</sub> = ${res.d_req.toFixed(3)} m &nbsp;|&nbsp; d<sub>réel</sub> = ${res.d.toFixed(3)} m &nbsp;(${res.d >= res.d_req ? 'Semelle rigide : modèle de bielles applicable' : 'Semelle SOUPLE : modèle de bielles hors domaine'})`,
            `<li><strong>d<sub>req</sub></strong> : hauteur utile minimale requise</li>
             <li><strong>a</strong> : épaisseur du voile s'appuyant sur la fondation (${p.a.toFixed(2)} m)</li>`
        );

        calculationCards += renderFormulaCard(
            "3. Calcul du ferraillage transversal principal",
            "Méthode des Bielles (ELU)",
            `A<sub>s,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">N<sub>Ed</sub> &times; (B - a)</span><span class="pdf-math-den">8 &times; d &times; f<sub>yd</sub></span></span>`,
            `A<sub>s,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.N_Ed.toFixed(2)} &times; (${p.B.toFixed(2)} - ${p.a.toFixed(2)}) &times; 10</span><span class="pdf-math-den">8 &times; ${res.d.toFixed(3)} &times; ${res.fyd_cm2.toFixed(3)}</span></span>`,
            `A<sub>s,req</sub> = ${res.As_req.toFixed(2)} cm²/ml &nbsp;(Aciers inférieurs transversaux reprenant la traction)`,
            `<li><strong>N<sub>Ed</sub></strong> : effort normal ultime à l'ELU (${p.N_Ed.toFixed(2)} kN/ml)</li>
             <li><strong>f<sub>yd</sub></strong> : limite élastique de calcul de l'acier (${res.fyd_cm2.toFixed(3)} kN/cm²)</li>`
        );
    } else if (moduleType === 'semelle_isolee') {
        calculationCards += renderFormulaCard(
            "1. Contrainte de pression exercée sur le sol (ELS)",
            "Vérification de la portance (ELS)",
            `P<sub>poids</sub> = A &times; B &times; h &times; &gamma;<sub>béton</sub> &nbsp;,&nbsp; &sigma;<sub>sol</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">N<sub>Eq</sub> + P<sub>poids</sub></span><span class="pdf-math-den">A &times; B</span></span>`,
            `P<sub>poids</sub> = ${res.weight.toFixed(1)} kN &nbsp;,&nbsp; &sigma;<sub>sol</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.N_Eq.toFixed(2)} + ${res.weight.toFixed(1)}</span><span class="pdf-math-den">${p.A.toFixed(2)} &times; ${p.B.toFixed(2)} &times; 10<sup>3</sup></span></span>`,
            `&sigma;<sub>sol</sub> = ${res.sigma_sol.toFixed(3)} MPa &nbsp;(Contrainte limite admissible q<sub>adm</sub> = ${p.q_adm.toFixed(3)} MPa)`,
            `<li><strong>A &times; B</strong> : dimensions en plan de la semelle rectangulaire (${p.A.toFixed(2)} &times; ${p.B.toFixed(2)} m²)</li>`
        );

        calculationCards += renderFormulaCard(
            "2. Condition de rigidité bidirectionnelle",
            "Méthode des Bielles (Rapports géométriques)",
            `d<sub>req,A</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">A - a</span><span class="pdf-math-den">4</span></span> &nbsp;,&nbsp; d<sub>req,B</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">B - b</span><span class="pdf-math-den">4</span></span>`,
            `d<sub>req,A</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.A.toFixed(2)} - ${p.a.toFixed(2)}</span><span class="pdf-math-den">4</span></span> = ${res.d_req_A.toFixed(3)} m &nbsp;,&nbsp; d<sub>req,B</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.B.toFixed(2)} - ${p.b.toFixed(2)}</span><span class="pdf-math-den">4</span></span> = ${res.d_req_B.toFixed(3)} m`,
            `d<sub>A,réelle</sub> = ${res.d_A.toFixed(3)} m &nbsp;|&nbsp; d<sub>B,réelle</sub> = ${res.d_B.toFixed(3)} m`,
            `<li><strong>a &times; b</strong> : dimensions transversales de la colonne de béton</li>`
        );

        calculationCards += renderFormulaCard(
            "3. Calcul du ferraillage bidirectionnel (ELU)",
            "Méthode des Bielles",
            `A<sub>s,A,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">N<sub>Ed</sub> &times; (A - a)</span><span class="pdf-math-den">8 &times; d<sub>A</sub> &times; f<sub>yd</sub></span></span> &nbsp;,&nbsp; A<sub>s,B,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">N<sub>Ed</sub> &times; (B - b)</span><span class="pdf-math-den">8 &times; d<sub>B</sub> &times; f<sub>yd</sub></span></span>`,
            `A<sub>s,A,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.N_Ed.toFixed(2)} &times; (${p.A.toFixed(2)} - ${p.a.toFixed(2)}) &times; 10</span><span class="pdf-math-den">8 &times; ${res.d_A.toFixed(3)} &times; ${res.fyd_cm2.toFixed(3)}</span></span> = ${res.As_A_req.toFixed(2)} cm²<br>A<sub>s,B,req</sub> = <span class="pdf-math-frac"><span class="pdf-math-num">${p.N_Ed.toFixed(2)} &times; (${p.B.toFixed(2)} - ${p.b.toFixed(2)}) &times; 10</span><span class="pdf-math-den">8 &times; ${res.d_B.toFixed(3)} &times; ${res.fyd_cm2.toFixed(3)}</span></span> = ${res.As_B_req.toFixed(2)} cm²`,
            `A<sub>s,A,req</sub> = ${res.As_A_req.toFixed(2)} cm² (parallèle à A) &nbsp;|&nbsp; A<sub>s,B,req</sub> = ${res.As_B_req.toFixed(2)} cm² (parallèle à B)`,
            `<li><strong>d<sub>A</sub> , d<sub>B</sub></strong> : hauteurs utiles réelles des nappes de ferraillage</li>`
        );
    }
    
    return `
        <div class="pdf-page" id="pdf-page-2">
            <div class="pdf-content">
                ${getPDFHeader(moduleTitle, 2)}
                <div class="pdf-section-title">5. Détail des calculs réglementaires</div>
                <div style="flex: 1;">
                    ${calculationCards}
                </div>
            </div>
            ${getPDFFooter(2)}
        </div>
    `;
}

const PDF_DESCRIPTIONS = {
    poutre: `Coupe transversale de la poutre. Les armatures longitudinales tendues sont placées en partie
        inférieure pour reprendre le moment de flexion ; les cadres reprennent l'effort tranchant et
        maintiennent les aciers de montage supérieurs.`,
    dalle: `Coupe verticale d'une bande de dalle de 1.00 m. La nappe inférieure principale reprend le moment
        de flexion dans le sens de la portée ; les aciers de répartition perpendiculaires assurent la
        diffusion transversale des charges.`,
    poteau: `Section transversale du poteau. Les armatures longitudinales, réparties sur les faces, reprennent
        avec le béton le couple (N ; M) issu des imperfections et du second ordre ; les cadres
        empêchent leur flambement local.`,
    voile: `Coupe horizontale d'une bande de voile de 1.00 m. Une nappe de treillis soudé est disposée sur
        chaque face, conformément au §9.6.2(3) de l'EC2.`,
    semelle_filante: `Coupe transversale de la semelle filante sous voile. Les armatures transversales inférieures
        équilibrent l'effort d'écartement de la méthode des bielles ; les filants longitudinaux assurent
        la répartition.`,
    semelle_isolee: `Ferraillage bidirectionnel de la semelle isolée sous poteau : deux lits inférieurs croisés
        reprennent la traction induite par la diffusion des efforts vers le sol.`
};

const PDF_LIMITES = {
    poutre: 'Poutre isostatique sur deux appuis simples, charge uniformément répartie, section rectangulaire, un seul lit d\'aciers tendus, sans aciers comprimés.',
    dalle: 'Bande de dalle portant dans un seul sens, isostatique, charge uniformément répartie.',
    poteau: 'Flexion composée dans le plan de flambement (axe faible) ; la flexion déviée n\'est pas traitée. Méthode de la courbure nominale (§5.8.8).',
    voile: 'Bande de 1 m : compression excentrée et flambement hors plan. Le comportement dans le plan (contreventement) n\'est pas vérifié.',
    semelle_filante: 'Charge centrée, méthode des bielles. Portance en contrainte admissible à l\'ELS, pas selon l\'Eurocode 7.',
    semelle_isolee: 'Charge centrée sans moment, méthode des bielles, poinçonnement avec β = 1. Portance en contrainte admissible à l\'ELS, pas selon l\'Eurocode 7.'
};

function buildPage3(moduleType, moduleTitle, state) {
    const res = state.results;
    const checks = res.checks || [];
    const v = EC2.verdict(checks);

    const lignes = checks.map(c => {
        const couleur = c.ok ? '#27ae60' : (c.grave ? '#c0392b' : '#d68910');
        const etat = c.ok ? 'CONFORME' : (c.grave ? 'NON CONFORME' : 'À VÉRIFIER');
        return `<tr><td>${indicesHTML(c.label)}<br><span class="pdf-ref">EC2 ${echapperHTML(c.ref)}</span></td>
            <td>${indicesHTML(c.requis)}</td><td>${indicesHTML(c.obtenu)}</td>
            <td style="color:${couleur}; font-weight:bold;">${etat}</td></tr>`;
    }).join('');

    const echecs = checks.filter(c => !c.ok);
    const classe = v.niveau === 'error' ? 'danger' : (v.niveau === 'warn' ? 'warning' : 'success');
    const titre = v.niveau === 'ok'
        ? '✓ ÉLÉMENT CONFORME À L\'ENSEMBLE DES VÉRIFICATIONS MENÉES'
        : (v.niveau === 'warn'
            ? `⚠ RÉSISTANCE VÉRIFIÉE — ${v.nbAlertes} POINT(S) DE SERVICE À SURVEILLER`
            : `✗ ÉLÉMENT NON CONFORME — ${v.nbErreurs} CRITÈRE(S) NON SATISFAIT(S)`);
    const detail = echecs.length
        ? `<ul class="pdf-variables-list">${echecs.map(c => `<li>${indicesHTML(c.label)} : ${indicesHTML(c.obtenu)} pour ${indicesHTML(c.requis)}</li>`).join('')}</ul>`
        : '';

    const dispositions = (state.dispositions || []).map(([l, val]) =>
        `<tr><td>${indicesHTML(l)}</td><td>${indicesHTML(val)}</td></tr>`).join('');

    return `
        <div class="pdf-page" id="pdf-page-3">
            <div class="pdf-content">
                ${getPDFHeader(moduleTitle, 3)}

                <div class="pdf-section-title">6. Vérifications réglementaires</div>
                <table class="pdf-table pdf-table-compact">
                    <thead>
                        <tr><th>Vérification</th><th>Exigence</th><th>Valeur obtenue</th><th>Statut</th></tr>
                    </thead>
                    <tbody>${lignes}</tbody>
                </table>

                <div class="pdf-compliance-box ${classe}">
                    <div class="pdf-compliance-title">STATUT GÉNÉRAL DE CONFORMITÉ</div>
                    <div class="pdf-compliance-status ${classe}">${titre}</div>
                    ${detail}
                </div>

                ${dispositions ? `
                <div class="pdf-section-title">7. Dispositions constructives</div>
                <table class="pdf-table pdf-table-compact"><tbody>${dispositions}</tbody></table>` : ''}

                <p class="pdf-description"><strong>Domaine de validité :</strong> ${PDF_LIMITES[moduleType] || ''}
                    Outil pédagogique : cette note ne remplace pas une étude vérifiée par un ingénieur.</p>
            </div>
            ${getPDFFooter(3)}
        </div>
    `;
}

function buildPage4(moduleType, moduleTitle) {
    return `
        <div class="pdf-page" id="pdf-page-4">
            <div class="pdf-content">
                ${getPDFHeader(moduleTitle, 4)}
                <div class="pdf-section-title">8. Plan de ferraillage</div>
                <p class="pdf-description">${PDF_DESCRIPTIONS[moduleType] || ''}</p>
                <div class="pdf-diagram-container pdf-diagram-full" id="pdf-diagram-slot">
                    <!-- Cloned SVG goes here -->
                </div>
            </div>
            ${getPDFFooter(4)}
        </div>
    `;
}

async function generatePDFReport(moduleType, moduleTitle, state, svgContainerId, renderUIFn, setViewFn, defaultView, saveName) {
    if (!window.jspdf || typeof html2canvas === 'undefined') {
        alert("Les bibliothèques d'export PDF n'ont pas pu être chargées (connexion au CDN impossible).");
        return;
    }
    const originalView = state.currentView;
    const originalTheme = document.documentElement.getAttribute('data-theme');

    // Configurer l'UI en mode clair et vue par défaut
    document.documentElement.setAttribute('data-theme', 'light');
    if (setViewFn && defaultView) {
        setViewFn(defaultView);
    }
    if (renderUIFn) {
        renderUIFn();
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    const originalSvg = document.getElementById(svgContainerId);
    let clonedSvg = null;
    if (originalSvg) {
        clonedSvg = originalSvg.cloneNode(true);
        clonedSvg.removeAttribute('id');
        clonedSvg.style.width = '100%';
        clonedSvg.style.height = 'auto';
        clonedSvg.style.maxHeight = '200mm';
        const zoom = clonedSvg.querySelector('.plan-zoom-btn');
        if (zoom) zoom.remove();
    }

    const templateContainer = document.createElement('div');
    templateContainer.id = 'pdf-report-template';
    document.body.appendChild(templateContainer);

    templateContainer.innerHTML = buildPage1(moduleType, moduleTitle, state)
        + buildPage2(moduleType, moduleTitle, state)
        + buildPage3(moduleType, moduleTitle, state)
        + buildPage4(moduleType, moduleTitle);

    if (clonedSvg) {
        const slot = document.getElementById('pdf-diagram-slot');
        if (slot) {
            slot.appendChild(clonedSvg);
        }
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    try {
        for (let i = 1; i <= PDF_NB_PAGES; i++) {
            const pageEl = document.getElementById(`pdf-page-${i}`);
            if (!pageEl) continue;

            const canvas = await html2canvas(pageEl, {
                scale: 2.2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
                scrollX: 0,
                scrollY: 0,
                x: 0,
                y: 0,
                windowWidth: 794
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            if (i > 1) {
                doc.addPage();
            }
            doc.addImage(imgData, 'JPEG', 0, 0, 210, 297);
        }

        doc.save(saveName);
    } catch (err) {
        console.error("Erreur lors de la génération du PDF:", err);
        alert("Une erreur est survenue lors de la génération de la note de calcul PDF.");
    } finally {
        templateContainer.remove();
        document.documentElement.setAttribute('data-theme', originalTheme);
        if (setViewFn && originalView) {
            setViewFn(originalView);
        }
        if (renderUIFn) {
            renderUIFn();
        }
    }
}

// ==========================================
// DESIGN SPELLS & EFFET WOW
// ==========================================

/**
 * Anime un compteur numérique de la valeur précédente à la nouvelle.
 * @param {string} id ID de l'élément DOM
 * @param {number} start Valeur de départ
 * @param {number} end Valeur finale
 * @param {number} duration Durée en ms
 * @param {number} decimals Nombre de décimales
 */
function animateValue(id, start, end, duration = 800, decimals = 2) {
    const obj = document.getElementById(id);
    if (!obj) return;
    
    // Si la différence est trop faible, on ne fait pas d'animation
    if (Math.abs(start - end) < 0.001) {
        obj.textContent = end.toFixed(decimals);
        return;
    }
    
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        // Easing easeOutQuart
        const easeProgress = 1 - Math.pow(1 - progress, 4);
        const current = start + easeProgress * (end - start);
        obj.textContent = current.toFixed(decimals);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.textContent = end.toFixed(decimals);
        }
    };
    window.requestAnimationFrame(step);
}

/**
 * Applique un effet de "Tilt 3D" (inclinaison magnétique) sur les éléments.
 * Réservé aux cartes de modules de la page d'accueil (.module-card) : les
 * pages de calcul (.panel, .result-card) contiennent des champs de saisie
 * et des valeurs à lire, où l'inclinaison au survol gêne plus qu'elle n'aide.
 */
function init3DTilt() {
    const cards = document.querySelectorAll('.module-card');
    cards.forEach(card => {
        card.classList.add('tilt-card');
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            // Calcul de l'inclinaison max 5 degrés
            const tiltX = ((y - centerY) / centerY) * -5;
            const tiltY = ((x - centerX) / centerX) * 5;
            card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.02, 1.02, 1.02)`;
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        });
    });
}

// Initialiser le tilt au chargement
document.addEventListener('DOMContentLoaded', () => {
    // Petit délai pour laisser le temps au DOM de se construire
    setTimeout(init3DTilt, 500);
});

// ==========================================
// ACCESSIBILITÉ (CLAVIER ET LECTEURS D'ÉCRAN)
// ==========================================

/**
 * Rend utilisables au clavier les éléments cliquables qui ne sont pas des
 * boutons (cartes de résultats), annonce les changements de statut et
 * expose l'état enfoncé des boutons bascule (diamètres, vues).
 */
function initAccessibilite() {
    document.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select)').forEach(el => {
        if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
        });
    });

    const badge = document.getElementById('statusBadge');
    if (badge) { badge.setAttribute('role', 'status'); badge.setAttribute('aria-live', 'polite'); }

    const theme = document.getElementById('themeToggle');
    if (theme) theme.setAttribute('aria-label', 'Basculer entre le thème clair et le thème sombre');

    const bascules = () => document.querySelectorAll('.steel-btn, .view-btn');
    const synchroniser = () => bascules().forEach(btn => {
        btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
        if (!btn.hasAttribute('type')) btn.setAttribute('type', 'button');
    });
    synchroniser();
    if (typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(synchroniser);
        bascules().forEach(btn => obs.observe(btn, { attributes: true, attributeFilter: ['class'] }));
    }
}

document.addEventListener('DOMContentLoaded', initAccessibilite);
