/**
 * =========================================================================
 * Projet      : Assistant de Calcul Eurocode 2 (Calcul Béton Armé)
 * Auteur      : Raphaël ELIARD
 * Description : Dimensionnement structurel et géotechnique des semelles
 *               isolées sous poteau centré. Calcul bidirectionnel du ferraillage
 *               par la méthode des bielles de compression.
 * =========================================================================
 */

// =========================================================================
// 1. ÉTAT APPLICATIF (MODEL & CONFIGURATION)
// =========================================================================

const AppState = {
    inputs: {
        a: 0.30,         // Dimension du poteau parallèle à l'axe A (m)
        b: 0.30,         // Dimension du poteau parallèle à l'axe B (m)
        A: 1.50,         // Largeur de la semelle (m)
        B: 1.50,         // Longueur de la semelle (m)
        h: 0.40,         // Hauteur totale de la semelle (m)
        fck: 25,         // Résistance caractéristique à la compression du béton (MPa)
        q_adm: 0.25,     // Contrainte admissible de calcul sur le sol (MPa)
        N_Ed: 600,       // Effort normal ultime de calcul à l'ELU (kN)
        N_Eq: 430,       // Effort normal de service à l'ELS (kN)
        enrobage: 4.0    // Enrobage nominal des aciers (cm)
    },
    diamA: 12,           // Diamètre HA de la nappe inférieure // A (mm)
    diamB: 12,           // Diamètre HA de la nappe supérieure // B (mm)
    currentView: 'coupe',// Vue active dans l'interface ('coupe' | 'plan')
    results: null        // Résultats du dernier calcul
};

const semelleInputs = Object.keys(AppState.inputs);

// Initialisation au chargement de la page
window.addEventListener('DOMContentLoaded', () => {
    // Restauration des paramètres saisis par l'utilisateur
    semelleInputs.forEach(id => {
        const savedVal = localStorage.getItem(`semelle_${id}`);
        // On ignore toute valeur stockée illisible : sinon un NaN se propagerait
        // dans l'état applicatif et jusque dans la note de calcul PDF.
        if (savedVal !== null && isFinite(parseFloat(savedVal))) {
            AppState.inputs[id] = parseFloat(savedVal);
            const el = document.getElementById(id);
            if (el) el.value = savedVal;
        }
    });
    
    const savedDiamA = localStorage.getItem('semelle_diamA');
    if (savedDiamA) AppState.diamA = parseInt(savedDiamA, 10);
    
    const savedDiamB = localStorage.getItem('semelle_diamB');
    if (savedDiamB) AppState.diamB = parseInt(savedDiamB, 10);

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
                localStorage.setItem(`semelle_${id}`, e.target.value);
                runController();
            });
        }
    });

    // Choix des diamètres d'acier
    document.querySelectorAll('#sel-A .steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.diamA = parseInt(e.target.dataset.diam, 10);
            localStorage.setItem('semelle_diamA', AppState.diamA);
            updateSteelSelectors();
            runController();
        });
    });
    
    document.querySelectorAll('#sel-B .steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.diamB = parseInt(e.target.dataset.diam, 10);
            localStorage.setItem('semelle_diamB', AppState.diamB);
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
    document.querySelectorAll('#sel-A .steel-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.diam, 10) === AppState.diamA);
    });
    document.querySelectorAll('#sel-B .steel-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.diam, 10) === AppState.diamB);
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
 * Calcul et vérification de la semelle isolée sous poteau centré.
 * La logique réglementaire est centralisée dans ec2-core.js (fonctions pures,
 * couvertes par le harnais de tests tests-ec2.js).
 * @param {object} params Paramètres géométriques et charges de calcul
 * @returns {object} Résultats géotechniques, structurels et sections d'armatures
 */
function calculateEurocode2(params) {
    return EC2.semelleIsolee({
        ...params,
        sectionA: STEEL_SPECS[params.diamA].section,
        sectionB: STEEL_SPECS[params.diamB].section
    });
}

// =========================================================================
// 3. CONTRÔLEUR DE L'INTERFACE UTILISATEUR
// =========================================================================

function runController() {
    const params = {
        ...AppState.inputs,
        diamA: AppState.diamA,
        diamB: AppState.diamB
    };
    AppState.results = calculateEurocode2(params);
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    
    // Renseignement de la note de calcul interactive
    document.getElementById('res-sigma').innerText = res.sigma_sol.toFixed(3);
    document.getElementById('res-dmin').innerText = res.d_req.toFixed(2);
    document.getElementById('res-AsA').innerText = res.As_A_req.toFixed(2);
    document.getElementById('res-AsB').innerText = res.As_B_req.toFixed(2);

    const poincEl = document.getElementById('res-poinc');
    if (poincEl) {
        const taux = Math.max(res.poinconnement.ratio_u1, res.poinconnement.ratio_u0);
        poincEl.innerText = (taux * 100).toFixed(0);
        poincEl.style.color = taux > 1 ? 'var(--danger)' : 'var(--success)';
    }

    // Nappe inférieure
    document.getElementById('info-nbA').innerText = res.nb_A;
    document.getElementById('info-diamA').innerText = AppState.diamA;
    document.getElementById('info-secA').innerText = res.As_A_prov.toFixed(2);
    document.getElementById('req-secA').innerText = res.As_A_req.toFixed(2);

    // Nappe supérieure
    document.getElementById('info-nbB').innerText = res.nb_B;
    document.getElementById('info-diamB').innerText = AppState.diamB;
    document.getElementById('info-secB').innerText = res.As_B_prov.toFixed(2);
    document.getElementById('req-secB').innerText = res.As_B_req.toFixed(2);

    // Affichage du statut de conformité
    const badge = document.getElementById('statusBadge');
    if (res.status === 'ERROR_BEARING') {
        badge.className = 'status-badge status-red';
        badge.innerText = 'Surface insuffisante (σ_sol > q_adm)';
    } else if (res.status === 'ERROR_PUNCHING') {
        badge.className = 'status-badge status-red';
        badge.innerText = 'Poinçonnement (EC2 §6.4) : augmenter h';
    } else if (res.status === 'WARNING_FLEXIBLE') {
        badge.className = 'status-badge status-orange';
        badge.innerText = 'Semelle Flexible (d < d_req, bielles hors limites)';
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
    const { textColor, concreteFill, concreteStroke } = getThemeColors();
    const rebar = getRebarColors();
    const theme = document.documentElement.getAttribute('data-theme');
    
    // Entrées bornées par ec2-core.js : une saisie vide ou nulle donnerait une
    // échelle infinie, un SVG rempli de NaN et des boucles de dessin sans fin.
    const p = AppState.results.inputs;
    const res = AppState.results;
    
    const svgSize = 800;
    const margin = 140;
    
    let pxParMetre = 0;   // échelle de la vue active, transmise à finalizePlan

    let svgContent = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" id="semellesvg" style="width: 100%; height: 100%;">`;

    if (AppState.currentView === 'coupe') {
        // Rendu de la coupe transversale (parallèle au côté A)
        const maxDim = Math.max(p.A, p.h + 0.5);
        const scale = (svgSize - 2 * margin) / maxDim;
        pxParMetre = scale;
        
        const w_px = p.A * scale;
        const h_px = p.h * scale;
        const a_px = p.a * scale;
        const col_h_px = 0.6 * scale; // Hauteur symbolique du poteau
        const c_px = (p.enrobage / 100) * scale;

        const x0 = (svgSize - w_px) / 2;
        const y0 = svgSize - margin - h_px;

        // Trace du contour béton de la semelle et du poteau
        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        const col_x0 = x0 + (w_px - a_px) / 2;
        svgContent += `<rect x="${col_x0}" y="${y0 - col_h_px}" width="${a_px}" height="${col_h_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        svgContent += `<line x1="${col_x0-10}" y1="${y0 - col_h_px}" x2="${col_x0+a_px+10}" y2="${y0 - col_h_px}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="8,8"/>`;

        // Cotation poteau
        svgContent += `<line x1="${col_x0}" y1="${y0 - col_h_px - 20}" x2="${col_x0+a_px}" y2="${y0 - col_h_px - 20}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<line x1="${col_x0}" y1="${y0 - col_h_px - 25}" x2="${col_x0}" y2="${y0 - col_h_px - 15}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<line x1="${col_x0+a_px}" y1="${y0 - col_h_px - 25}" x2="${col_x0+a_px}" y2="${y0 - col_h_px - 15}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<text x="${col_x0+a_px/2}" y="${y0 - col_h_px - 30}" text-anchor="middle" font-size="14" data-base-size="12" fill="${textColor}">a = ${(p.a*100).toFixed(0)} cm</text>`;

        // Aciers nappe A (liaison longitudinale basse dans cette vue, avec ancrages relevés aux extrémités)
        const yA = y0 + h_px - c_px;
        const diamA_px = (AppState.diamA / 1000) * scale;
        const strokeWA = Math.max(diamA_px, 4);
        const hook = Math.max(15 * (AppState.diamA / 1000) * scale, 25);
        svgContent += `<path d="M ${x0+c_px} ${yA-hook} L ${x0+c_px} ${yA} L ${x0+w_px-c_px} ${yA} L ${x0+w_px-c_px} ${yA-hook}" fill="none" stroke="${rebar.main}" stroke-width="${strokeWA}" stroke-linejoin="round" stroke-linecap="round"/>`;

        // Aciers nappe B (disposés au-dessus de la nappe A, vus de profil comme des cercles)
        const diamB_px = (AppState.diamB / 1000) * scale;
        const radiusB = Math.max(diamB_px / 2, 4);
        const yB = yA - (diamA_px / 2) - radiusB; 
        
        const espB_px = res.nb_B > 1 ? (w_px - 2 * c_px) / (res.nb_B - 1) : 0;
        const offset_xB = (w_px - ((res.nb_B - 1) * espB_px)) / 2;
        
        for (let i = 0; i < res.nb_B; i++) {
            const bx = x0 + offset_xB + i * espB_px;
            svgContent += `<circle cx="${bx}" cy="${yB}" r="${radiusB}" fill="${rebar.stirrup}"/>`;
        }

        // Cotations semelle
        svgContent += `<line x1="${x0}" y1="${y0+h_px+60}" x2="${x0+w_px}" y2="${y0+h_px+60}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<line x1="${x0}" y1="${y0+h_px+55}" x2="${x0}" y2="${y0+h_px+65}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<line x1="${x0+w_px}" y1="${y0+h_px+55}" x2="${x0+w_px}" y2="${y0+h_px+65}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<text x="${x0+w_px/2}" y="${y0+h_px+80}" text-anchor="middle" font-size="16" data-base-size="12.5" fill="${textColor}">A = ${(p.A).toFixed(2)} m</text>`;

        svgContent += `<line x1="${x0-30}" y1="${y0}" x2="${x0-30}" y2="${y0+h_px}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<line x1="${x0-35}" y1="${y0}" x2="${x0-25}" y2="${y0}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<line x1="${x0-35}" y1="${y0+h_px}" x2="${x0-25}" y2="${y0+h_px}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<text x="${x0-45}" y="${y0+h_px/2}" text-anchor="middle" font-size="16" data-base-size="12.5" fill="${textColor}" transform="rotate(-90 ${x0-45} ${y0+h_px/2})">h = ${(p.h*100).toFixed(0)} cm</text>`;

        svgContent += `<line x1="${x0}" y1="${y0+h_px+15}" x2="${x0+c_px}" y2="${y0+h_px+15}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<line x1="${x0}" y1="${y0+h_px+10}" x2="${x0}" y2="${y0+h_px+20}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<line x1="${x0+c_px}" y1="${y0+h_px+10}" x2="${x0+c_px}" y2="${y0+h_px+20}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<text x="${x0+c_px/2}" y="${y0+h_px+30}" text-anchor="middle" font-size="12" data-base-size="11" fill="${textColor}">c=${(p.enrobage).toFixed(1)}</text>`;
    } 
    else {
        // Rendu de la vue en plan de ferraillage
        const maxDim = Math.max(p.A, p.B);
        const scale = (svgSize - 2 * margin) / maxDim;
        pxParMetre = scale;
        
        const wA_px = p.A * scale;
        const wB_px = p.B * scale;
        const a_px = p.a * scale;
        const b_px = p.b * scale;
        const c_px = (p.enrobage / 100) * scale;

        const x0 = (svgSize - wA_px) / 2;
        const y0 = (svgSize - wB_px) / 2;

        // Semelle
        svgContent += `<rect x="${x0}" y="${y0}" width="${wA_px}" height="${wB_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        // Poteau centré
        const col_x0 = x0 + (wA_px - a_px) / 2;
        const col_y0 = y0 + (wB_px - b_px) / 2;
        svgContent += `<rect x="${col_x0}" y="${col_y0}" width="${a_px}" height="${b_px}" fill="${theme==='dark'?'#3d3d3d':'#dcdde1'}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        svgContent += `<line x1="${col_x0}" y1="${col_y0-15}" x2="${col_x0+a_px}" y2="${col_y0-15}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<text x="${col_x0+a_px/2}" y="${col_y0-25}" text-anchor="middle" font-size="12" data-base-size="11" fill="${textColor}">a</text>`;
        svgContent += `<line x1="${col_x0+a_px+15}" y1="${col_y0}" x2="${col_x0+a_px+15}" y2="${col_y0+b_px}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<text x="${col_x0+a_px+25}" y="${col_y0+b_px/2}" text-anchor="middle" font-size="12" data-base-size="11" fill="${textColor}" alignment-baseline="middle">b</text>`;

        // Aciers nappe A (lignes rouges horizontales disposées le long de la hauteur B)
        const diamA_px = (AppState.diamA / 1000) * scale;
        const strokeWPlanA = Math.max(diamA_px, 3);
        const espA_px = res.nb_A > 1 ? (wB_px - 2 * c_px) / (res.nb_A - 1) : 0;
        for (let i = 0; i < res.nb_A; i++) {
            const yL = y0 + c_px + i * espA_px;
            svgContent += `<line x1="${x0+c_px}" y1="${yL}" x2="${x0+wA_px-c_px}" y2="${yL}" stroke="${rebar.main}" stroke-width="${strokeWPlanA}" stroke-linecap="round"/>`;
        }

        // Aciers nappe B (lignes bleues verticales disposées le long de la largeur A)
        const diamB_px = (AppState.diamB / 1000) * scale;
        const strokeWPlanB = Math.max(diamB_px, 3);
        const espB_px = res.nb_B > 1 ? (wA_px - 2 * c_px) / (res.nb_B - 1) : 0;
        for (let i = 0; i < res.nb_B; i++) {
            const xL = x0 + c_px + i * espB_px;
            svgContent += `<line x1="${xL}" y1="${y0+c_px}" x2="${xL}" y2="${y0+wB_px-c_px}" stroke="${rebar.stirrup}" stroke-width="${strokeWPlanB}" stroke-linecap="round"/>`;
        }

        // Cotations planétaires
        svgContent += `<line x1="${x0}" y1="${y0-60}" x2="${x0+wA_px}" y2="${y0-60}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<line x1="${x0}" y1="${y0-65}" x2="${x0}" y2="${y0-55}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<line x1="${x0+wA_px}" y1="${y0-65}" x2="${x0+wA_px}" y2="${y0-55}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<text x="${x0+wA_px/2}" y="${y0-75}" text-anchor="middle" font-size="16" data-base-size="12.5" fill="${textColor}">A = ${(p.A).toFixed(2)} m</text>`;

        svgContent += `<line x1="${x0+wA_px+60}" y1="${y0}" x2="${x0+wA_px+60}" y2="${y0+wB_px}" stroke="${textColor}" stroke-width="1.5"/>`;
        svgContent += `<line x1="${x0+wA_px+55}" y1="${y0}" x2="${x0+wA_px+65}" y2="${y0}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<line x1="${x0+wA_px+55}" y1="${y0+wB_px}" x2="${x0+wA_px+65}" y2="${y0+wB_px}" stroke="${textColor}" stroke-width="2"/>`;
        svgContent += `<text x="${x0+wA_px+75}" y="${y0+wB_px/2}" text-anchor="middle" font-size="16" data-base-size="12.5" fill="${textColor}" transform="rotate(90 ${x0+wA_px+75} ${y0+wB_px/2})">B = ${(p.B).toFixed(2)} m</text>`;

        // Cotation espacements réels
        if (res.nb_A > 1) {
            const startY = y0 + c_px;
            const endY = startY + espA_px;
            const coteX = x0 - 40;
            svgContent += `<line x1="${coteX}" y1="${startY}" x2="${coteX}" y2="${endY}" stroke="${textColor}" stroke-width="1.5"/>`;
            svgContent += `<line x1="${coteX-5}" y1="${startY}" x2="${coteX+5}" y2="${startY}" stroke="${textColor}" stroke-width="2"/>`;
            svgContent += `<line x1="${coteX-5}" y1="${endY}" x2="${coteX+5}" y2="${endY}" stroke="${textColor}" stroke-width="2"/>`;
            svgContent += `<text x="${coteX-10}" y="${(startY+endY)/2}" alignment-baseline="middle" text-anchor="end" font-size="14" data-base-size="12" fill="${textColor}">${res.esp_A.toFixed(1)} cm</text>`;
        }

        if (res.nb_B > 1) {
            const startX = x0 + c_px;
            const endX = startX + espB_px;
            const coteY = y0 + wB_px + 40;
            svgContent += `<line x1="${startX}" y1="${coteY}" x2="${endX}" y2="${coteY}" stroke="${textColor}" stroke-width="1.5"/>`;
            svgContent += `<line x1="${startX}" y1="${coteY-5}" x2="${startX}" y2="${coteY+5}" stroke="${textColor}" stroke-width="2"/>`;
            svgContent += `<line x1="${endX}" y1="${coteY-5}" x2="${endX}" y2="${coteY+5}" stroke="${textColor}" stroke-width="2"/>`;
            svgContent += `<text x="${(startX+endX)/2}" y="${coteY-10}" text-anchor="middle" font-size="14" data-base-size="12" fill="${textColor}">${res.esp_B.toFixed(1)} cm</text>`;
        }
    }


    svgContent += '</svg>';
    container.innerHTML = svgContent;

    finalizePlan('svgContainer', {
        legende: {
            entrees: [
        { forme: 'line', couleur: rebar.main,    texte: 'Nappe inférieure (// A)' },
        { forme: 'line', couleur: rebar.stirrup, texte: 'Nappe supérieure (// B)' }
    ],
            infos: [
        `${res.nb_A} HA${AppState.diamA} → ${res.As_A_prov.toFixed(2)} cm²`,
        `${res.nb_B} HA${AppState.diamB} → ${res.As_B_prov.toFixed(2)} cm²`
    ]
        },
        titre: AppState.currentView === 'coupe'
            ? `Coupe de la semelle isolée, ${p.A.toFixed(2)} mètres de large sur ${(p.h*100).toFixed(0)} centimètres de haut`
            : `Vue en plan du ferraillage de la semelle, ${p.A.toFixed(2)} sur ${p.B.toFixed(2)} mètres`,
        pxParMetre: pxParMetre,
        maxRatio: 2.4
    });
}

// =========================================================================
// 5. BOUTES DE DIALOGUE INTERACTIFS & EXPORTS
// =========================================================================

function showFormula(type) {
    let msg = "";
    switch (type) {
        case 'sigma_sol': 
            msg = "Vérification géotechnique à la base :\n" +
                  "σ_sol = (N_Eq + Poids_Semelle) / (A × B)\n\n" +
                  "On vérifie à l'état limite de service (ELS) que la contrainte moyenne exercée par la fondation rectangulaire reste inférieure à la contrainte admissible de calcul q_adm. On intègre le poids volumique de la semelle en béton armé."; 
            break;
        case 'd_req': 
            msg = "Critère de rigidité géométrique pour modèle de bielles :\n" +
                  "d ≥ max( (A-a)/4 , (B-b)/4 )\n\n" +
                  "Garantit la rigidité de la semelle dans les deux directions principales X et Y, condition indispensable pour modéliser le transfert d'efforts par bielles obliques rectilignes entre le poteau et le lit d'armatures."; 
            break;
        case 'As_A': 
            msg = "Calcul des armatures de la nappe inférieure (// A) :\n" +
                  "As = N_Ed × (A - a) / (8 × d_A × fyd)\n\n" +
                  "Calcule la section nécessaire sous l'effort normal ultime pour équilibrer la traction à la base de la bielle de compression s'étendant parallèlement à la dimension A. Cette section est comparée aux exigences minimales de non-fragilité de l'Eurocode 2."; 
            break;
        case 'As_B':
            msg = "Calcul des armatures de la nappe supérieure (// B) :\n" +
                  "As = N_Ed × (B - b) / (8 × d_B × fyd)\n\n" +
                  "Détermine la section pour l'axe parallèle à B. On prend en compte la réduction de la hauteur utile (d_B = d_A - Ø_A) liée à la superposition des barres de la nappe A.";
            break;
        case 'poinconnement': {
            const poinc = AppState.results ? AppState.results.poinconnement : null;
            msg = "Vérification du poinçonnement (EC2 §6.4.4) :\n" +
                  "v_Ed = β × V_Ed,réduit / (u × d)  ≤  v_Rd,c × 2d/a\n\n" +
                  "Pour une semelle, la vérification est menée sur les périmètres de contrôle " +
                  "situés à une distance a ≤ 2d du nu du poteau, en déduisant la réaction du sol " +
                  "comprise à l'intérieur du périmètre. La résistance est majorée du facteur 2d/a.\n" +
                  "On vérifie en outre au nu du poteau que v_Ed ≤ v_Rd,max = 0.5 × ν × f_cd.\n\n" +
                  (poinc
                      ? "Ici : périmètre critique à " + (poinc.a_crit * 100).toFixed(0) + " cm du poteau, " +
                        "v_Ed = " + poinc.v_Ed.toFixed(2) + " MPa pour v_Rd = " + poinc.v_Rd.toFixed(2) +
                        " MPa (taux " + (poinc.ratio_u1 * 100).toFixed(0) + " %).\n" +
                        "Au nu du poteau : v_Ed = " + poinc.v_Ed0.toFixed(2) + " MPa pour v_Rd,max = " +
                        poinc.v_Rd_max.toFixed(2) + " MPa."
                      : "");
            break;
        }
    }
    showModal("Explications Techniques Eurocode 2", msg);
}

function exportAsPNG() {
    exportPlanAsPNG('svgContainer', `ferraillage_semelle_${AppState.currentView}_${new Date().toISOString().slice(0,10)}.png`, renderUI);
}

async function exportAsPDF() {
    await generatePDFReport('semelle_isolee', 'Semelle Isolée en Béton Armé', AppState, 'svgContainer', renderUI, setView, 'plan', 'note_calcul_semelle_isolee.pdf');
}
