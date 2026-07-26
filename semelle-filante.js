/**
 * =========================================================================
 * Projet      : Assistant de Calcul Eurocode 2 (Calcul Béton Armé)
 * Auteur      : Raphaël ELIARD
 * Description : Vérification géotechnique et dimensionnement du ferraillage
 *               de semelles filantes sous mur de contreventement ou voile.
 *               Méthode des bielles de compression (semelles rigides).
 * =========================================================================
 */

// =========================================================================
// 1. ÉTAT APPLICATIF (MODEL & CONFIGURATION)
// =========================================================================

const AppState = {
    inputs: {
        a: 0.20,         // Épaisseur du voile supporté (m)
        B: 1.00,         // Largeur totale de la semelle (m)
        h: 0.30,         // Hauteur totale de la semelle (m)
        fck: 25,         // Résistance caractéristique à la compression du béton (MPa)
        q_adm: 0.25,     // Contrainte de calcul admissible sur le sol (MPa)
        N_Ed: 350,       // Effort normal de calcul à l'ELU (kN/ml)
        N_Eq: 250,       // Effort normal de service à l'ELS (kN/ml)
        enrobage: 4.0,   // Enrobage nominal des armatures (cm)
        espMain: 15,     // Espacement des aciers transversaux (cm)
        espRep: 20       // Espacement des aciers de répartition (cm)
    },
    diamMain: 12,        // Diamètre nominal HA de l'acier principal transversal (mm)
    diamRep: 8,          // Diamètre nominal HA de l'acier longitudinal de répartition (mm)
    currentView: 'coupe',// Vue active dans l'interface ('coupe' | 'plan')
    results: null        // Résultats du dernier calcul
};

const semelleInputs = Object.keys(AppState.inputs);

// Initialisation au chargement de la page
window.addEventListener('DOMContentLoaded', () => {
    // Restauration des paramètres saisis par l'utilisateur
    semelleInputs.forEach(id => {
        const savedVal = localStorage.getItem(`sfilante_${id}`);
        // On ignore toute valeur stockée illisible : sinon un NaN se propagerait
        // dans l'état applicatif et jusque dans la note de calcul PDF.
        if (savedVal !== null && isFinite(parseFloat(savedVal))) {
            AppState.inputs[id] = parseFloat(savedVal);
            const el = document.getElementById(id);
            if (el) el.value = savedVal;
        }
    });
    
    const savedDiamMain = localStorage.getItem('sfilante_diamMain');
    if (savedDiamMain) AppState.diamMain = parseInt(savedDiamMain, 10);
    
    const savedDiamRep = localStorage.getItem('sfilante_diamRep');
    if (savedDiamRep) AppState.diamRep = parseInt(savedDiamRep, 10);

    bindEvents();
    updateSteelSelectors();
    runController();
});

// Liaison des événements de l'interface
function bindEvents() {
    semelleInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                AppState.inputs[id] = parseFloat(e.target.value) || 0;
                localStorage.setItem(`sfilante_${id}`, e.target.value);
                runController();
            });
        }
    });

    // Choix des diamètres d'acier
    document.querySelectorAll('#sel-Main .steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.diamMain = parseInt(e.target.dataset.diam, 10);
            localStorage.setItem('sfilante_diamMain', AppState.diamMain);
            updateSteelSelectors();
            runController();
        });
    });
    
    document.querySelectorAll('#sel-Rep .steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.diamRep = parseInt(e.target.dataset.diam, 10);
            localStorage.setItem('sfilante_diamRep', AppState.diamRep);
            updateSteelSelectors();
            runController();
        });
    });

    window.onThemeChange = () => renderUI();
}

function setView(view) {
    AppState.currentView = view;
    document.getElementById('btnViewCoupe').classList.toggle('active', view === 'coupe');
    document.getElementById('btnViewPlan').classList.toggle('active', view === 'plan');
    renderUI();
}

function updateSteelSelectors() {
    document.querySelectorAll('#sel-Main .steel-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.diam, 10) === AppState.diamMain);
    });
    document.querySelectorAll('#sel-Rep .steel-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.diam, 10) === AppState.diamRep);
    });
}

function getSVGTextColor() {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' ? '#e0e0e0' : '#1e293b';
}

// =========================================================================
// 2. LOGIQUE DE CALCUL RÈGLEMENTAIRE (EUROCODE 2 & GÉOTECHNIQUE)
// =========================================================================

/**
 * Calcul et vérification de la semelle filante sur une bande unitaire de 1.0m.
 * La logique réglementaire est centralisée dans ec2-core.js (fonctions pures,
 * couvertes par le harnais de tests tests-ec2.js).
 * @param {object} params Paramètres géométriques et mécaniques
 * @returns {object} Variables d'état calculées et états de conformité
 */
function calculateEurocode2(params) {
    return EC2.semelleFilante({
        ...params,
        sectionMain: STEEL_SPECS[params.diamMain].section,
        sectionRep: STEEL_SPECS[params.diamRep].section
    });
}

// =========================================================================
// 3. CONTRÔLEUR DE L'INTERFACE UTILISATEUR
// =========================================================================

function runController() {
    const params = {
        ...AppState.inputs,
        diamMain: AppState.diamMain,
        diamRep: AppState.diamRep
    };
    AppState.results = calculateEurocode2(params);
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    const p = AppState.inputs;

    // Mise à jour de la note de calcul interactive
    document.getElementById('res-sigma').innerText = res.sigma_sol.toFixed(3);
    document.getElementById('res-dmin').innerText = res.d_req.toFixed(2);
    document.getElementById('res-AsReq').innerText = res.As_req.toFixed(2);
    document.getElementById('res-AsRep').innerText = res.As_rep_req.toFixed(2);

    // Rendu des infos des armatures principales (transversales)
    document.getElementById('info-diamMain').innerText = AppState.diamMain;
    document.getElementById('info-espMain').innerText = p.espMain;
    document.getElementById('info-secMain').innerText = res.As_prov_main.toFixed(2);
    document.getElementById('req-secMain').innerText = res.As_req.toFixed(2);

    // Rendu des infos des armatures de répartition (longitudinales)
    document.getElementById('info-diamRep').innerText = AppState.diamRep;
    document.getElementById('info-espRep').innerText = p.espRep;
    document.getElementById('info-secRep').innerText = res.As_prov_rep.toFixed(2);
    document.getElementById('req-secRep').innerText = res.As_rep_req.toFixed(2);

    // Affichage de l'état de conformité
    const badge = document.getElementById('statusBadge');
    if (res.status === 'ERROR_BEARING') {
        badge.className = 'status-badge status-red';
        badge.innerText = 'Surface insuffisante (σ_sol > q_adm)';
    } else if (res.status === 'WARNING_FLEXIBLE') {
        badge.className = 'status-badge status-orange';
        badge.innerText = 'Semelle Flexible (d < d_req, bielles hors limites)';
    } else if (res.status === 'ERROR_SHEAR') {
        badge.className = 'status-badge status-red';
        badge.innerText = 'Effort tranchant excessif (V_Ed > V_Rd,c)';
    } else if (res.status === 'ERROR_STEEL') {
        badge.className = 'status-badge status-red';
        badge.innerText = 'Ferraillage Insuffisant';
    } else {
        badge.className = 'status-badge status-green';
        badge.innerText = 'Semelle Conforme';
    }

    renderWarnings('ec2-warnings', res.warnings);

    drawSVG();
}

// =========================================================================
// 4. GÉNÉRATION DES SCHÉMAS DE FERRAILLAGE (SVG)
// =========================================================================

function drawSVG() {
    const container = document.getElementById('svgContainer');
    const { textColor, concreteFill, concreteStroke, legendBg } = getThemeColors();
    const theme = document.documentElement.getAttribute('data-theme');
    
    // Entrées bornées par ec2-core.js : une saisie vide ou nulle donnerait une
    // échelle infinie, un SVG rempli de NaN et des boucles de dessin sans fin.
    const p = AppState.results.inputs;
    const res = AppState.results;
    
    const svgSize = 800;
    const margin = 140;
    
    let svgContent = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" id="semellesvg" style="width: 100%; height: 100%;">`;

    if (AppState.currentView === 'coupe') {
        const maxDim = Math.max(p.B, p.h + 0.5);
        const scale = (svgSize - 2 * margin) / maxDim;
        
        const w_px = p.B * scale;
        const h_px = p.h * scale;
        const a_px = p.a * scale;
        const col_h_px = 0.6 * scale; // Hauteur symbolique du mur/voile
        const c_px = (p.enrobage / 100) * scale;

        const x0 = (svgSize - w_px) / 2;
        const y0 = svgSize - margin - h_px;

        // Tracé du béton de la semelle et du voile
        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        const col_x0 = x0 + (w_px - a_px) / 2;
        svgContent += `<rect x="${col_x0}" y="${y0 - col_h_px}" width="${a_px}" height="${col_h_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        svgContent += `<line x1="${col_x0-10}" y1="${y0 - col_h_px}" x2="${col_x0+a_px+10}" y2="${y0 - col_h_px}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="8,8"/>`;

        // Cotation voile
        svgContent += drawDimensionLine(col_x0, y0 - col_h_px, col_x0+a_px, y0 - col_h_px, `a = ${(p.a*100).toFixed(0)}`, "cm", -20, textColor, textColor);

        // Aciers transversaux principaux (avec retours d'ancrage aux extrémités)
        const yMain = y0 + h_px - c_px;
        const diamMain_px = (AppState.diamMain / 1000) * scale;
        const strokeWMain = Math.max(diamMain_px, 4);
        const hook = Math.max(15 * (AppState.diamMain / 1000) * scale, 25);
        svgContent += `<path d="M ${x0+c_px} ${yMain-hook} L ${x0+c_px} ${yMain} L ${x0+w_px-c_px} ${yMain} L ${x0+w_px-c_px} ${yMain-hook}" fill="none" stroke="#c0392b" stroke-width="${strokeWMain}" stroke-linejoin="round" stroke-linecap="round"/>`;

        // Aciers longitudinaux de répartition (cercles)
        const diamRep_px = (AppState.diamRep / 1000) * scale;
        const radiusRep = Math.max(diamRep_px / 2, 4);
        const yRep = yMain - radiusRep - 2;
        
        const espRep_px = (p.espRep / 100) * scale;
        const nb_rep_circles = Math.floor((w_px - 2 * c_px) / espRep_px);
        const offset_x = (w_px - (nb_rep_circles * espRep_px)) / 2;
        
        for (let i = 0; i <= nb_rep_circles; i++) {
            const bx = x0 + offset_x + i * espRep_px;
            svgContent += `<circle cx="${bx}" cy="${yRep}" r="${radiusRep}" fill="#2980b9"/>`;
        }

        // Cotations semelle
        svgContent += drawDimensionLine(x0, y0+h_px, x0+w_px, y0+h_px, `B = ${(p.B).toFixed(2)}`, "m", 60, textColor, textColor);
        svgContent += drawDimensionLine(x0, y0, x0, y0+h_px, `h = ${(p.h*100).toFixed(0)}`, "cm", 30, textColor, textColor);
        svgContent += drawDimensionLine(x0, y0+h_px, x0+c_px, y0+h_px, `c=${(p.enrobage).toFixed(1)}`, "", 15, textColor, textColor);
    } 
    else {
        // Vue en Plan (Bande unitaire de 1.0m)
        const maxDim = Math.max(p.B, 1.0);
        const scale = (svgSize - 2 * margin) / maxDim;
        
        const w_px = p.B * scale; 
        const h_px = 1.0 * scale; 
        const a_px = p.a * scale;
        const c_px = (p.enrobage / 100) * scale;

        const x0 = (svgSize - w_px) / 2;
        const y0 = (svgSize - h_px) / 2;

        // Tracé du contour béton et lignes de coupure
        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        svgContent += `<line x1="${x0-20}" y1="${y0}" x2="${x0+w_px+20}" y2="${y0}" stroke="${textColor}" stroke-width="2" stroke-dasharray="10,10"/>`;
        svgContent += `<line x1="${x0-20}" y1="${y0+h_px}" x2="${x0+w_px+20}" y2="${y0+h_px}" stroke="${textColor}" stroke-width="2" stroke-dasharray="10,10"/>`;

        // Emplacement théorique du voile
        const col_x0 = x0 + (w_px - a_px) / 2;
        svgContent += `<rect x="${col_x0}" y="${y0}" width="${a_px}" height="${h_px}" fill="${theme==='dark'?'#3d3d3d':'#dcdde1'}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        // Barres d'armatures transversales (lignes rouges horizontales)
        const diamMain_px = (AppState.diamMain / 1000) * scale;
        const strokeWMain = Math.max(diamMain_px, 3);
        const espMain_px = (p.espMain / 100) * scale;
        const nb_main = Math.floor(h_px / espMain_px);
        const offset_y = (h_px - (nb_main * espMain_px)) / 2;
        for (let i = 0; i <= nb_main; i++) {
            const yL = y0 + offset_y + i * espMain_px;
            svgContent += `<line x1="${x0+c_px}" y1="${yL}" x2="${x0+w_px-c_px}" y2="${yL}" stroke="#c0392b" stroke-width="${strokeWMain}" stroke-linecap="round"/>`;
        }

        // Barres d'armatures longitudinales (lignes bleues verticales)
        const diamRep_px = (AppState.diamRep / 1000) * scale;
        const strokeWRep = Math.max(diamRep_px, 2);
        const espRep_px = (p.espRep / 100) * scale;
        const nb_rep = Math.floor((w_px - 2 * c_px) / espRep_px);
        const offset_x = (w_px - (nb_rep * espRep_px)) / 2;
        for (let i = 0; i <= nb_rep; i++) {
            const xL = x0 + offset_x + i * espRep_px;
            svgContent += `<line x1="${xL}" y1="${y0 + strokeWRep/2}" x2="${xL}" y2="${y0+h_px - strokeWRep/2}" stroke="#2980b9" stroke-width="${strokeWRep}" stroke-linecap="round"/>`;
        }

        // Cotations
        svgContent += drawDimensionLine(x0, y0, x0+w_px, y0, `B = ${(p.B).toFixed(2)}`, "m", -60, textColor, textColor);
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+h_px, "Bande 1.00", "m", -30, textColor, textColor);

        if (nb_rep >= 1) {
            const startX = x0 + offset_x;
            const endX = startX + espRep_px;
            svgContent += drawDimensionLine(startX, y0+h_px, endX, y0+h_px, p.espRep.toFixed(1), "cm", 40, textColor, textColor);
        }

        if (nb_main >= 1) {
            const startY = y0 + offset_y;
            const endY = startY + espMain_px;
            svgContent += drawDimensionLine(x0, startY, x0, endY, p.espMain.toFixed(1), "cm", 40, textColor, textColor);
        }
    }

    // Bloc Légende
    svgContent += `
    <g transform="translate(${svgSize - 220}, ${svgSize - 165})">
        <rect x="0" y="0" width="200" height="145" rx="6" ry="6" fill="${legendBg}" stroke="${concreteStroke}" stroke-width="1.5"/>
        <text x="15" y="25" font-weight="bold" font-size="16" fill="${textColor}">Légende</text>
        <line x1="15" y1="50" x2="35" y2="50" stroke="#c0392b" stroke-width="4"/>
        <text x="45" y="55" font-size="14" fill="${textColor}">Acier Principal</text>
        <line x1="15" y1="80" x2="35" y2="80" stroke="#2980b9" stroke-width="4"/>
        <text x="45" y="85" font-size="14" fill="${textColor}">Acier Répartition</text>
        <text x="15" y="110" font-size="13" font-weight="bold" fill="${textColor}">As,req: ${res.As_prov_main.toFixed(2)} cm²/ml (HA${AppState.diamMain})</text>
        <text x="15" y="130" font-size="13" font-weight="bold" fill="${textColor}">As,rep: ${res.As_prov_rep.toFixed(2)} cm²/ml (HA${AppState.diamRep})</text>
    </g>`;

    svgContent += '</svg>';
    container.innerHTML = svgContent;
}

// =========================================================================
// 5. BOUTES DE DIALOGUE INTERACTIFS & EXPORTS
// =========================================================================

function showFormula(type) {
    let msg = "";
    switch (type) {
        case 'sigma_sol': 
            msg = "Vérification géotechnique de la pression sur le sol :\n" +
                  "σ_sol = (N_Eq + Poids_Semelle) / (B × 1.0m)\n\n" +
                  "On vérifie à l'état limite de service (ELS) que la contrainte de pression moyenne exercée sous la base de la fondation ne dépasse pas la contrainte admissible de calcul q_adm de la couche géologique porteuse."; 
            break;
        case 'd_req': 
            msg = "Critère de rigidité géométrique pour modèle de bielles :\n" +
                  "d ≥ (B - a) / 4\n\n" +
                  "Cette condition géométrique assure que la semelle est suffisamment rigide pour mobiliser un fonctionnement par bielles obliques de béton comprimé reliant directement le pied du voile aux aciers transversaux inférieurs. Si d < d_req, la semelle est qualifiée de flexible et doit faire l'objet d'un calcul de flexion standard avec vérification des armatures transversales à l'effort tranchant."; 
            break;
        case 'As_req': 
            msg = "Section d'acier principale transversale (Méthode des bielles) :\n" +
                  "As = N_Ed × (B - a) / (8 × d × fyd)\n\n" +
                  "Cette formule équilibre la force de traction horizontale développée à la base de la semelle par le système hyperstatique de bielles obliques en béton comprimé. La section calculée est ensuite soumise aux exigences de la section minimale de non-fragilité (Eurocode 2 §9.2.1.1)."; 
            break;
        case 'As_rep': 
            msg = "Section minimale d'armature longitudinale de répartition :\n" +
                  "As,rep ≥ max(0.20 × As,req , Aciers minimaux de peau)\n\n" +
                  "Disposée perpendiculairement aux armatures principales pour s'opposer au retrait thermique, aux effets du retrait plastique et aux variations de température journalières (recommandations Eurocode 2)."; 
            break;
    }
    showModal("Détails Théoriques Eurocode 2", msg);
}

function exportAsPNG() {
    exportPlanAsPNG('svgContainer', `ferraillage_semelle_filante_${AppState.currentView}_${new Date().toISOString().slice(0,10)}.png`, renderUI);
}

async function exportAsPDF() {
    await generatePDFReport('semelle_filante', 'Semelle Filante en Béton Armé', AppState, 'svgContainer', renderUI, setView, 'coupe', 'note_calcul_semelle_filante.pdf');
}
