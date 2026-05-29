/**
 * =========================================================
 * Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
 * Auteur : Raphaël ELIARD
 * Description : Logique de dimensionnement des dalles pleines.
 *               Calcul de la flexion simple sur bande unitaire de 1m, 
 *               vérification du cisaillement résistant et tracé SVG.
 * =========================================================
 */

// =========================================================
// GESTION DE L'ÉTAT APPLICATIF
// =========================================================

const AppState = {
    inputs: { L: 4.0, h: 0.20, G: 6.0, Q: 2.5, fck: 25, enrobage: 3.0, espacementInput: 15, espRepInput: 20 },
    diamMain: 10,
    diamRep: 8,
    currentView: 'coupe',
    results: null
};

const dalleInputs = Object.keys(AppState.inputs);

// Initialisation au chargement du DOM
window.addEventListener('DOMContentLoaded', () => {
    // Restauration de l'état sauvegardé localement
    dalleInputs.forEach(id => {
        const savedVal = localStorage.getItem(`dalle_${id}`);
        if (savedVal !== null) {
            AppState.inputs[id] = parseFloat(savedVal);
            const el = document.getElementById(id);
            if (el) el.value = savedVal;
        }
    });
    
    const savedDiamMain = localStorage.getItem('dalle_diamMain');
    if (savedDiamMain) AppState.diamMain = parseInt(savedDiamMain);
    const savedDiamRep = localStorage.getItem('dalle_diamRep');
    if (savedDiamRep) AppState.diamRep = parseInt(savedDiamRep);
    
    bindEvents();
    updateSteelSelectors();
    runController();
});

function bindEvents() {
    // Écoute des modifications des paramètres de saisie
    dalleInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                AppState.inputs[id] = parseFloat(e.target.value) || 0;
                localStorage.setItem(`dalle_${id}`, e.target.value);
                runController();
            });
        }
    });

    // Choix des diamètres pour les armatures principales (longitudinales)
    document.querySelectorAll('#sel-Main .steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.diamMain = parseInt(e.target.dataset.diameter);
            localStorage.setItem('dalle_diamMain', AppState.diamMain);
            updateSteelSelectors();
            runController();
        });
    });
    
    // Choix des diamètres pour les armatures de répartition (transversales)
    document.querySelectorAll('#sel-Rep .steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.diamRep = parseInt(e.target.dataset.diameter);
            localStorage.setItem('dalle_diamRep', AppState.diamRep);
            updateSteelSelectors();
            runController();
        });
    });

    // Callback lors des changements de thèmes visuels
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
        btn.classList.toggle('active', parseInt(btn.dataset.diameter) === AppState.diamMain);
    });
    document.querySelectorAll('#sel-Rep .steel-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.diameter) === AppState.diamRep);
    });
}

function getSVGTextColor() {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' ? '#e0e0e0' : '#1e293b';
}

// =========================================================
// LOGIQUE DE CALCUL EUROCODE 2
// =========================================================

/**
 * Calcul réglementaire de la dalle pleine selon l'Eurocode 2.
 * @param {object} params Paramètres géométriques et de charges
 * @returns {object} Résultats détaillés
 */
function calculateEurocode2(params) {
    const { L, h, G, Q, fck, enrobage, espacementInput, espRepInput, diamMain, diamRep } = params;
    
    const b = 1.0; // Largeur de bande unitaire (1 mètre)
    const c_nom = enrobage / 100; // Enrobage nominal (m)
    const espacement = espacementInput; // Espacement de l'armature principale (cm)
    const esp_rep = espRepInput; // Espacement de l'armature de répartition (cm)

    // Propriétés de calcul des matériaux
    const gammaC = 1.5;
    const gammaS = 1.15;
    const fcd = fck / gammaC;
    const fyk = 500;
    const fyd = fyk / gammaS;
    const fctm = 0.30 * Math.pow(fck, 2/3); // Résistance moyenne à la traction du béton

    // Hauteur utile réelle d
    const d = h - c_nom - (diamMain / 1000 / 2);

    // Combinaison d'actions et calcul des sollicitations RDM (isostatique)
    const p_elu = 1.35 * G + 1.5 * Q; // kN/ml
    const Med = (p_elu * Math.pow(L, 2)) / 8; // Moment ultime à mi-portée (kN.m/ml)
    const Ved = (p_elu * L) / 2; // Effort tranchant ultime sur appuis (kN/ml)

    // Calcul en flexion simple
    const Med_MN = Med / 1000;
    const mu_cu = Med_MN / (b * Math.pow(d, 2) * fcd);
    
    let As_req = 0;
    let status = 'OK';
    let alpha = 0;
    let z = 0;

    // Condition de non-fragilité (section minimale de flexion, EC2 §9.2.1.1)
    const As_min = Math.max(0.26 * (fctm / fyk) * b * d, 0.0013 * b * d) * 10000; // cm²/ml

    if (mu_cu > 0.371) {
        status = 'ERROR_MUCU'; 
    } else {
        alpha = 1.25 * (1 - Math.sqrt(1 - 2 * mu_cu));
        z = d * (1 - 0.4 * alpha);
        As_req = (Med_MN / (z * fyd)) * 10000; // Section théorique requise (cm²/ml)
        As_req = Math.max(As_req, As_min);
    }

    // Section d'aciers principaux fournie
    const sectionPerBarMain = STEEL_SPECS[diamMain].section;
    const nbBarres_per_m = 100 / espacement;
    const As_prov = sectionPerBarMain * nbBarres_per_m;

    // Armatures de répartition transversales (EC2 §9.3.1.1)
    const As_rep_req = Math.max(0.20 * As_prov, As_min);
    const sectionPerBarRep = STEEL_SPECS[diamRep].section;
    const As_prov_rep = sectionPerBarRep * (100 / esp_rep);

    // Effort tranchant limite admissible par le béton seul (sans armatures de cisaillement, EC2 §6.2.2)
    const k = Math.min(1 + Math.sqrt(200 / (d * 1000)), 2.0); // Facteur d'échelle (max 2.0)
    const rho_l = Math.min(As_prov / (b * d * 10000), 0.02); // Taux d'armatures longitudinales (max 2%)
    const v_min = 0.035 * Math.pow(k, 1.5) * Math.sqrt(fck);
    const C_Rdc = 0.18 / gammaC;
    const v_Rdc = C_Rdc * k * Math.pow(100 * rho_l * fck, 1/3);
    const V_Rdc = Math.max(v_Rdc, v_min) * b * d * 1000; // Résistance en kN/ml

    if (Ved > V_Rdc && status !== 'ERROR_MUCU') {
        status = 'ERROR_SHEAR';
    }

    // Espacements maximaux admissibles (EC2 §9.3.1.1)
    const s_max_main = Math.min(3 * (h * 100), 40); 
    const s_max_rep = Math.min(3.5 * (h * 100), 45); 
    
    // Espacement net minimal pour le bétonnage
    const esp_net = espacement - (diamMain / 10);

    return {
        Med, Ved, As_req, As_min, As_prov, As_prov_rep, As_rep_req,
        V_Rdc, status, s_max_main, s_max_rep, esp_net, d, p_elu, fctm, fyd,
        fcd, mu_cu, alpha, z, fyd_cm2: fyd / 10, k, rho_l
    };
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

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
    
    // Rendu des valeurs numériques
    document.getElementById('res-Med').innerText = res.Med.toFixed(2);
    document.getElementById('res-Ved').innerText = res.Ved.toFixed(1);
    document.getElementById('res-As_req').innerText = res.status === 'ERROR_MUCU' ? "Erreur" : res.As_req.toFixed(2);
    document.getElementById('res-Vrdc').innerText = res.V_Rdc.toFixed(1);
    document.getElementById('res-As_rep').innerText = res.As_rep_req.toFixed(2);
    document.getElementById('res-As_min').innerText = res.As_min.toFixed(2);

    document.getElementById('info-diamMain').innerText = AppState.diamMain;
    document.getElementById('info-espMain').innerText = p.espacementInput;
    document.getElementById('info-secMain').innerText = res.As_prov.toFixed(2);
    document.getElementById('req-secMain').innerText = res.As_req.toFixed(2);

    document.getElementById('info-diamRep').innerText = AppState.diamRep;
    document.getElementById('info-espRep').innerText = p.espRepInput;
    document.getElementById('info-secRep').innerText = res.As_prov_rep.toFixed(2);
    document.getElementById('req-secRep').innerText = res.As_rep_req.toFixed(2);

    // Validation globale et mise à jour du badge de conformité
    const badge = document.getElementById('statusBadge');
    if (res.status === 'ERROR_MUCU') {
        badge.className = "status-badge status-red";
        badge.innerText = "Épaisseur h insuffisante (Compression)";
    } else if (res.status === 'ERROR_SHEAR') {
        badge.className = "status-badge status-red";
        badge.innerText = "Risque Cisaillement (V_Ed > V_Rdc)";
    } else if (res.As_prov < res.As_req) {
        badge.className = "status-badge status-red";
        badge.innerText = "Ferraillage Principal Insuffisant";
    } else if (res.As_prov_rep < res.As_rep_req) {
        badge.className = "status-badge status-red";
        badge.innerText = "Acier Répartition Insuffisant";
    } else if (res.esp_net < Math.max(2.5, AppState.diamMain / 10)) {
        badge.className = "status-badge status-red";
        badge.innerText = "Aciers trop rapprochés (Bétonnage)";
    } else if (p.espacementInput > res.s_max_main || p.espRepInput > res.s_max_rep) {
        badge.className = "status-badge status-orange";
        badge.innerText = `Espacement > Limite EC2`;
    } else {
        badge.className = "status-badge status-green";
        badge.innerText = "Dalle Conforme";
    }

    drawSVG();
}

// =========================================================
// DESSIN DU PLAN DE FERRAILLAGE (SVG)
// =========================================================

function drawSVG() {
    const container = document.getElementById('svgContainer');
    const { textColor, concreteFill, concreteStroke, legendBg } = getThemeColors();
    
    const p = AppState.inputs;
    const res = AppState.results;

    const h = p.h;
    const c_nom = p.enrobage / 100;
    const esp = p.espacementInput; 
    
    const svgSize = 800;
    const margin = 160;
    const w_m = 1.0; 
    const maxDim = Math.max(w_m, h);
    const scale = (svgSize - 2 * margin) / maxDim;
    
    const w_px = w_m * scale;
    const h_px = h * scale;
    const x0 = (svgSize - w_px) / 2;
    const y0 = (svgSize - h_px) / 2;
    
    const c_px = c_nom * scale;
    const diam_px = (AppState.diamMain / 1000) * scale;
    const diam_rep_px = (AppState.diamRep / 1000) * scale;
    
    const r_bar = Math.max(diam_px / 2, 6);
    const r_rep = Math.max(diam_rep_px / 2, 4);

    let svgContent = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" id="dallesvg" style="width: 100%; height: 100%;">`;
    
    if (AppState.currentView === 'coupe') {
        // Délimitation de la section de dalle (largeur 1m tronquée)
        svgContent += `<line x1="${x0}" y1="${y0-20}" x2="${x0}" y2="${y0+h_px+20}" stroke="${textColor}" stroke-width="2" stroke-dasharray="10,10"/>`;
        svgContent += `<line x1="${x0+w_px}" y1="${y0-20}" x2="${x0+w_px}" y2="${y0+h_px+20}" stroke="${textColor}" stroke-width="2" stroke-dasharray="10,10"/>`;

        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="none"/>`;
        svgContent += `<line x1="${x0}" y1="${y0}" x2="${x0+w_px}" y2="${y0}" stroke="${concreteStroke}" stroke-width="3"/>`;
        svgContent += `<line x1="${x0}" y1="${y0+h_px}" x2="${x0+w_px}" y2="${y0+h_px}" stroke="${concreteStroke}" stroke-width="3"/>`;

        // Barres principales longitudinales (vues de bout)
        const esp_px = (esp / 100) * scale;
        const nb_points = Math.floor(w_px / esp_px);
        const offset_x = (w_px - (nb_points * esp_px)) / 2;
        const y_main = y0 + h_px - c_px - r_bar;

        for(let i=0; i<=nb_points; i++) {
            const nx = x0 + offset_x + (i * esp_px);
            svgContent += `<circle cx="${nx}" cy="${y_main}" r="${r_bar}" fill="#c0392b"/>`;
        }

        // Armatures de répartition transversales
        const y_rep = y_main - r_bar - r_rep;
        const strokeRepCoupe = Math.max(diam_rep_px, 2);
        svgContent += `<line x1="${x0}" y1="${y_rep}" x2="${x0+w_px}" y2="${y_rep}" stroke="#2980b9" stroke-width="${strokeRepCoupe}" stroke-linecap="round"/>`;
        
        // Cotations
        svgContent += drawDimensionLine(x0, y0+h_px-c_px, x0, y0+h_px, `c=${(c_nom*100).toFixed(1)}`, "", 40, textColor, textColor);
        const d_px = res.d * scale;
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+d_px, "d", "", -60, textColor, textColor);
        svgContent += drawDimensionLine(x0, y0, x0+w_px, y0, "Bande b = 1.00", "m", -30, textColor, textColor);
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+h_px, `h = ${(h*100).toFixed(0)}`, "cm", -30, textColor, textColor);

        const startX = x0 + offset_x + esp_px;
        const endX = startX + esp_px;
        svgContent += drawDimensionLine(startX, y0+h_px, endX, y0+h_px, esp.toFixed(1), "cm", 40, textColor, textColor);
    } else {
        // Vue en plan unitaire (1m x 1m)
        const maxDimPlan = 1.0;
        const scaleP = (svgSize - 2 * margin) / maxDimPlan;
        const wP_px = maxDimPlan * scaleP;
        const hP_px = maxDimPlan * scaleP;
        const xP = (svgSize - wP_px) / 2;
        const yP = (svgSize - hP_px) / 2;

        svgContent += `<rect x="${xP}" y="${yP}" width="${wP_px}" height="${hP_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;

        const strokeMain = Math.max(diam_px, 3);
        const strokeRep = Math.max(diam_rep_px, 2);
        
        // Aciers principaux (Verticaux sur le dessin)
        const esp_pxP = (esp / 100) * scaleP;
        const nb_main = Math.floor(wP_px / esp_pxP);
        const offset_xP = (wP_px - (nb_main * esp_pxP)) / 2;
        
        for (let i = 0; i <= nb_main; i++) {
            const lx = xP + offset_xP + i*esp_pxP;
            svgContent += `<line x1="${lx}" y1="${yP + strokeMain/2}" x2="${lx}" y2="${yP+hP_px - strokeMain/2}" stroke="#c0392b" stroke-width="${strokeMain}" stroke-linecap="round"/>`;
        }

        // Aciers de répartition (Horizontaux sur le dessin)
        const esp_rep_px = (p.espRepInput / 100) * scaleP;
        const nb_rep = Math.floor(hP_px / esp_rep_px);
        const offset_yP = (hP_px - (nb_rep * esp_rep_px)) / 2;
        
        for (let j = 0; j <= nb_rep; j++) {
            const ly = yP + offset_yP + j*esp_rep_px;
            svgContent += `<line x1="${xP + strokeRep/2}" y1="${ly}" x2="${xP+wP_px - strokeRep/2}" y2="${ly}" stroke="#2980b9" stroke-width="${strokeRep}" stroke-linecap="round"/>`;
        }

        // Cotations
        svgContent += drawDimensionLine(xP, yP, xP+wP_px, yP, "Bande 1.00", "m", -30, textColor, textColor);
        
        if (nb_main >= 1) {
            const startX = xP + offset_xP;
            const endX = startX + esp_pxP;
            svgContent += drawDimensionLine(startX, yP+hP_px, endX, yP+hP_px, esp.toFixed(1), "cm", 40, textColor, textColor);
        }

        if (nb_rep >= 1) {
            const startY = yP + offset_yP;
            const endY = startY + esp_rep_px;
            svgContent += drawDimensionLine(xP, startY, xP, endY, p.espRepInput.toFixed(1), "cm", 40, textColor, textColor);
        }
    }

    // Légende
    svgContent += `
    <g transform="translate(${svgSize - 220}, ${svgSize - 165})">
        <rect x="0" y="0" width="200" height="145" rx="6" ry="6" fill="${legendBg}" stroke="${concreteStroke}" stroke-width="1.5"/>
        <text x="15" y="25" font-weight="bold" font-size="16" fill="${textColor}">Légende</text>
        <circle cx="25" cy="50" r="6" fill="#c0392b"/>
        <text x="45" y="55" font-size="14" fill="${textColor}">Acier Principal</text>
        <line x1="15" y1="80" x2="35" y2="80" stroke="#2980b9" stroke-width="4"/>
        <text x="45" y="85" font-size="14" fill="${textColor}">Acier Répartition</text>
        <text x="15" y="110" font-size="13" font-weight="bold" fill="${textColor}">As,req: ${res.As_prov.toFixed(2)} cm²/ml (HA${AppState.diamMain})</text>
        <text x="15" y="130" font-size="13" font-weight="bold" fill="${textColor}">As,rep: ${res.As_prov_rep.toFixed(2)} cm²/ml (HA${AppState.diamRep})</text>
    </g>`;

    svgContent += '</svg>';
    container.innerHTML = svgContent;
}

// =========================================================
// MODULES PÉDAGOGIQUES ET EXPORTATIONS
// =========================================================

function exportAsPNG() {
    exportPlanAsPNG('svgContainer', `ferraillage_dalle_${AppState.currentView}_${new Date().toISOString().slice(0,10)}.png`, renderUI);
}

function showFormula(type) {
    let msg = "";
    switch(type) {
        case 'Med': 
            msg = "Moment fléchissant ultime (ELU) : M_ed = (1.35 * G + 1.5 * Q) * L² / 8\nCalculé sur une bande de dalle d'une largeur b = 1.0m."; 
            break;
        case 'As_req': 
            msg = "Section requise d'armature principale : A_s = M_ed / (z * f_yd)\nCalculée avec le bras de levier z associé à la hauteur utile réelle d."; 
            break;
        case 'Ved': 
            msg = "Effort tranchant ultime maximum : V_ed = (1.35 * G + 1.5 * Q) * L / 2\nCisaillement calculé au nu des appuis."; 
            break;
        case 'Vrdc': 
            msg = "Résistance du béton au cisaillement (sans armatures transversales) : V_Rd,c = [C_Rdc * k * (100 * ρ_l * fck)^(1/3)] * b * d\nConformément à l'EC2 §6.2.2, les dalles courantes ne comportent pas d'épingles d'effort tranchant et le béton doit résister seul."; 
            break;
        case 'As_rep': 
            msg = "Section d'acier de répartition requise (transversale) : A_s,rep ≥ 20% * A_s,principal\nExigence normative (EC2 §9.3.1.1) pour assurer la diffusion transversale des charges."; 
            break;
        case 'As_min': 
            msg = "Ferraillage minimal de flexion (non-fragilité) : A_s,min = max(0.26 * (fctm / fyk) * b * d, 0.0013 * b * d)\nGarantit que l'élément ne subira pas de rupture fragile dès la première fissure (EC2 §9.2.1.1)."; 
            break;
    }
    showModal("Explications réglementaires Eurocode 2", msg);
}

async function exportAsPDF() {
    await generatePDFReport('dalle', 'Dalle Pleine en Béton Armé', AppState, 'svgContainer', renderUI, setView, 'coupe', 'note_calcul_dalle.pdf');
}
