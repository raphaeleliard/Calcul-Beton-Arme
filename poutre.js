/**
 * =========================================================
 * Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
 * Auteur : Raphaël ELIARD
 * Description : Logique de dimensionnement des poutres en béton armé.
 *               Calcul de la flexion simple à l'ELU, vérification du
 *               cisaillement et tracé dynamique du plan de ferraillage (SVG).
 * =========================================================
 */

// =========================================================
// GESTION DE L'ÉTAT APPLICATIF
// =========================================================

const AppState = {
    inputs: { L: 5.0, b: 0.20, h: 0.50, G: 15, Q: 10, fck: 25 },
    selectedDiameter: 10,
    nbBarres: 3,
    currentView: 'coupe',
    results: null,
    c_enrobage: 0.03 // Enrobage nominal en mètres (3 cm)
};

const inputs = ['L', 'b', 'h', 'G', 'Q', 'fck'];

// Initialisation au chargement du DOM
window.addEventListener('DOMContentLoaded', () => {
    // Restauration des paramètres sauvegardés localement
    inputs.forEach(id => {
        const savedVal = localStorage.getItem(`poutre_${id}`);
        if (savedVal) {
            AppState.inputs[id] = parseFloat(savedVal);
            document.getElementById(id).value = savedVal;
        }
    });

    const savedDiam = localStorage.getItem('poutre_diameter');
    if (savedDiam) AppState.selectedDiameter = parseInt(savedDiam);
    
    bindEvents();
    updateSteelSelector();
    runController();
});

function bindEvents() {
    // Saisie des paramètres géométriques et de charges
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            AppState.inputs[id] = parseFloat(e.target.value) || 0;
            localStorage.setItem(`poutre_${id}`, e.target.value);
            runController();
        });
    });

    // Saisie du nombre de barres longitudinales
    document.getElementById('nbBarresInput').addEventListener('input', (e) => {
        AppState.nbBarres = parseInt(e.target.value) || 1;
        runController();
    });

    // Choix des diamètres de barres longitudinales (HA)
    document.querySelectorAll('.steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.selectedDiameter = parseInt(e.target.dataset.diameter);
            localStorage.setItem('poutre_diameter', AppState.selectedDiameter);
            updateSteelSelector();
            runController();
        });
    });

    // Callback pour redessiner le schéma lors du changement de thème (clair/sombre)
    window.onThemeChange = () => renderUI();
}

function setView(view) {
    AppState.currentView = view;
    document.getElementById('btnViewCoupe').classList.toggle('active', view === 'coupe');
    document.getElementById('btnViewLong').classList.toggle('active', view === 'longitudinale');
    renderUI();
}

function updateSteelSelector() {
    document.querySelectorAll('.steel-btn').forEach(btn => {
        const diam = parseInt(btn.dataset.diameter);
        btn.classList.toggle('active', diam === AppState.selectedDiameter);
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
 * Calcul d'une poutre isostatique en flexion simple et cisaillement à l'ELU.
 * @param {object} params Paramètres géométriques et mécaniques
 * @returns {object} Résultats de calcul et statuts de conformité
 */
function calculateEC2(params) {
    const { L, b, h, fck, G, Q, diameter, c_nom } = params;
    
    // Coefficients partiels de sécurité (situations durables et transitoires)
    const gammaC = 1.5; 
    const gammaS = 1.15; 
    const fyk = 500; // Limite d'élasticité de l'acier (S500)
    const alphaCc = 1.0; // Coefficient pour effets à long terme sur béton
    
    // Combinaisons d'actions à l'ELU (pEd = 1.35 * G + 1.5 * Q)
    const p_elu = 1.35 * G + 1.5 * Q; 
    const Med = (p_elu * Math.pow(L, 2)) / 8; // Moment maximal à mi-portée (kN.m)
    const Ved = (p_elu * L) / 2; // Effort tranchant maximal sur appuis (kN)
    
    // Calcul de la hauteur utile réelle d
    const phi_l = (diameter || 10) / 1000; // Diamètre des aciers principaux (m)
    const phi_t = 0.008; // Diamètre estimé des cadres transversaux (m)
    const d = h - c_nom - phi_t - (phi_l / 2);
    
    // Résistances de calcul des matériaux
    const fcd = (alphaCc * fck) / gammaC; 
    const fyd = fyk / gammaS; 
    const fyd_cm2 = fyd / 10; // Limite élastique de calcul en kN/cm²
    
    // Condition de non-fragilité (section minimale d'armatures tendues EC2 §9.2.1.1)
    const fctm = 0.30 * Math.pow(fck, 2/3); // Résistance moyenne à la traction du béton (MPa)
    const As_min = Math.max(0.26 * (fctm / fyk) * b * d, 0.0013 * b * d) * 10000; // cm²

    // Moment fléchissant ultime réduit
    const Med_MN = Med / 1000; 
    const mu_cu = Med_MN / (b * Math.pow(d, 2) * fcd);
    
    let alpha = 0;
    let z = 0;
    let As_req = 0;
    let status = 'OK';
    
    // Limite théorique pour l'acier S500 à l'ELU (sans aciers comprimés)
    const MU_CU_LIMIT = 0.371; 
    
    if (mu_cu > MU_CU_LIMIT) { 
        status = 'ERROR_MUCU'; 
        z = d * (1 - 0.4 * 0.45);
    } else {
        // Position de l'axe neutre relatif (alpha)
        alpha = 1.25 * (1 - Math.sqrt(1 - 2 * mu_cu));
        // Bras de levier du couple interne (z)
        z = d * (1 - 0.4 * alpha);
        // Section théorique requise d'armatures longitudinales tendues
        As_req = (Med_MN / (z * fyd)) * 10000; 
        As_req = Math.max(As_req, As_min); 
    }
    
    // Résistance de l'effort tranchant (modèle des bielles d'inclinaison variable, EC2 §6.2.3)
    const v1 = 0.6 * (1 - fck / 250); // Facteur de réduction de la résistance du béton fissuré
    const Vrd_max_45 = (alphaCc * b * z * v1 * fcd) / 2 * 1000; // Résistance de la bielle pour theta = 45° (kN)

    let cotTheta = 2.5; 
    let Asw_s = 0;

    if (Ved > Vrd_max_45 && status !== 'ERROR_MUCU') {
        status = 'ERROR_SHEAR'; 
    } else if (status !== 'ERROR_MUCU') {
        // Recherche de la bielle la plus inclinée (cot theta minimal) pour optimiser les cadres
        const contrainte_max = alphaCc * b * z * v1 * fcd * 1000;
        const sin2theta = (2 * Ved) / contrainte_max;
        
        if (sin2theta < 1) {
            const thetaRad = 0.5 * Math.asin(sin2theta);
            const cotCalc = 1 / Math.tan(thetaRad);
            cotTheta = Math.max(1.0, Math.min(2.5, cotCalc)); // cot theta bridé réglementairement entre 1 et 2.5
        } else {
            cotTheta = 1.0; 
        }

        // Calcul de la section d'aciers transversaux requise (Asw/s en cm²/m)
        const Asw_s_calc = (Ved / (z * fyd_cm2 * cotTheta)); 
        // Pourcentage minimal d'armatures transversales (EC2 §9.2.2)
        const rho_w_min = (0.08 * Math.sqrt(fck)) / fyk; 
        const Asw_s_min = rho_w_min * b * 10000; 
        Asw_s = Math.max(Asw_s_calc, Asw_s_min);
    }

    return { 
        Med, Ved, mu_cu, alpha, z, As_req, Asw_s, status, d, cotTheta,
        fcd, fyd, fyd_cm2, fctm, p_elu, Vrd_max_45, As_min
    };
}

function calculateRealSteelArrangement(As_req, diameter) {
    const spec = STEEL_SPECS[diameter];
    const sectionPerBar = spec.section;
    const nbBarres = Math.ceil(As_req / sectionPerBar);
    const actualSection = nbBarres * sectionPerBar;
    return { nbBarres, actualSection, sectionPerBar };
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    const calcParams = {
        ...AppState.inputs,
        diameter: AppState.selectedDiameter,
        c_nom: AppState.c_enrobage
    };
    AppState.results = calculateEC2(calcParams);
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    const p = AppState.inputs;
    
    // Affichage des sollicitations et coefficients mécaniques
    document.getElementById('res-Med').innerText = res.Med.toFixed(2);
    document.getElementById('res-Mu').innerText = res.mu_cu.toFixed(3);
    document.getElementById('res-Alpha').innerText = res.alpha.toFixed(3);
    document.getElementById('res-Ved').innerText = res.Ved.toFixed(1);
    
    let As_to_draw = res.status === 'ERROR_MUCU' ? 0 : res.As_req;
    document.getElementById('res-As').innerText = res.status === 'ERROR_MUCU' ? "Erreur" : res.As_req.toFixed(2);

    const sectionPerBar = STEEL_SPECS[AppState.selectedDiameter].section;
    const min_bars = Math.ceil(As_to_draw / sectionPerBar);
    
    let nb_barres = AppState.nbBarres;
    if (nb_barres < 1) nb_barres = 1;
    
    // Affichage des recommandations et alertes de sous-dimensionnement
    const recElement = document.getElementById('recommendation');
    recElement.textContent = `${min_bars} HA${AppState.selectedDiameter} minimum`;
    if (nb_barres < min_bars) {
        recElement.style.color = "var(--danger)";
        recElement.textContent += " ⚠ Choix Insuffisant";
    } else {
        recElement.style.color = "var(--success)";
    }

    const steelArrangement = { nbBarres: nb_barres, actualSection: nb_barres * sectionPerBar };
    document.getElementById('steelReq').innerText = res.As_req.toFixed(2);
    document.getElementById('steelChosen').innerText = steelArrangement.actualSection.toFixed(2);
    document.getElementById('nbBarres').innerText = steelArrangement.nbBarres;
    document.getElementById('diamShow').innerText = AppState.selectedDiameter;

    // Calcul de l'espacement net des aciers tendus
    let spacing_cm = 0;
    const diam_cm = AppState.selectedDiameter / 10;
    const diam_cadre_cm = 0.8; 
    if (steelArrangement.nbBarres > 1) {
        const espace_dispo_cm = (p.b * 100) - (2 * AppState.c_enrobage * 100) - (2 * diam_cadre_cm);
        const encombrement_aciers = steelArrangement.nbBarres * diam_cm;
        spacing_cm = (espace_dispo_cm - encombrement_aciers) / (steelArrangement.nbBarres - 1);
        document.getElementById('spacing').innerText = spacing_cm.toFixed(1);
    } else {
        document.getElementById('spacing').innerText = 'N/A';
    }
    document.getElementById('coverageShow').innerText = (AppState.c_enrobage * 100).toFixed(1);
    
    // Section d'aciers maximale (4% de la section droite du béton, hors recouvrement)
    const As_max = 0.04 * p.b * p.h * 10000; 

    // Vérification des différents critères de conformité
    const badge = document.getElementById('statusBadge');
    if (res.status === 'ERROR_MUCU') {
        badge.className = "status-badge status-red";
        badge.innerText = "Section béton insuffisante !";
    } else if (res.status === 'ERROR_SHEAR') {
        badge.className = "status-badge status-red";
        badge.innerText = "Risque Rupture Bielles (Cisaillement)";
        document.getElementById('res-Asw').innerText = "Erreur";
    } else if (steelArrangement.actualSection < res.As_req) {
        badge.className = "status-badge status-red";
        badge.innerText = "Ferraillage Insuffisant";
    } else if (steelArrangement.actualSection > As_max) {
        badge.className = "status-badge status-red";
        badge.innerText = "Ferraillage Trop Important (As > 4%)";
    } else if (steelArrangement.nbBarres > 1 && spacing_cm < Math.max(2.5, diam_cm)) {
        badge.className = "status-badge status-red";
        badge.innerText = "Aciers trop serrés (Bétonnage difficile)";
    } else {
        badge.className = "status-badge status-green";
        badge.innerText = "Section Conforme";
    }
    
    if (res.status !== 'ERROR_SHEAR') {
        document.getElementById('res-Asw').innerText = res.Asw_s.toFixed(2);
    }

    drawPoutreSVG(p.b, p.h, As_to_draw, steelArrangement);
}

// =========================================================
// DESSIN DU PLAN DE FERRAILLAGE (SVG)
// =========================================================

function drawPoutreSVG(b, h, As, steelArrangement) {
    const container = document.getElementById('svgContainer');
    const { textColor, concreteFill, concreteStroke, legendBg } = getThemeColors();

    const svgSize = 800;
    const margin = 140;
    const maxDim = Math.max(b, h);
    const scale = (svgSize - 2*margin) / maxDim;
    
    const w_px = b * scale;
    const h_px = h * scale;
    const x0 = (svgSize - w_px) / 2 - 20; 
    const y0 = (svgSize - h_px) / 2;

    const c = AppState.c_enrobage * scale;
    const diam_px = (AppState.selectedDiameter / 1000) * scale;
    const radius_bar = Math.max(diam_px / 2, 6);

    let svgContent = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" id="poutresvg" style="width: 100%; height: 100%;">`;
    
    if (AppState.currentView === 'coupe') {
        // Section droite en béton
        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        if (As > 0) {
            // Dessin des armatures transversales (cadres)
            const stirrupStroke = 5;
            const rx = x0 + c - radius_bar;
            const ry = y0 + c - radius_bar;
            const rw = w_px - 2*c + 2*radius_bar;
            const rh = h_px - 2*c + 2*radius_bar;
            const r_corner = radius_bar * 1.5;

            svgContent += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${r_corner}" ry="${r_corner}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke}"/>`;

            // Crochets des cadres
            svgContent += `<line x1="${x0+c}" y1="${ry}" x2="${x0+c + 35}" y2="${ry + 35}" stroke="#2980b9" stroke-width="${stirrupStroke}" stroke-linecap="round"/>`;
            svgContent += `<line x1="${rx}" y1="${y0+c}" x2="${rx + 35}" y2="${y0+c + 35}" stroke="#2980b9" stroke-width="${stirrupStroke}" stroke-linecap="round"/>`;

            // Aciers de peau / de montage transversaux (épingles éventuelles)
            const nbEspaceurs = 5;
            for(let i = 1; i < nbEspaceurs; i++) {
                const y = y0 + c + ((h_px - 2*c) * i / nbEspaceurs);
                svgContent += `<line x1="${rx}" y1="${y}" x2="${rx + rw}" y2="${y}" stroke="#2980b9" stroke-width="${stirrupStroke - 1}"/>`;
                svgContent += `<path d="M ${rx} ${y} C ${rx-15} ${y-20}, ${rx+20} ${y-20}, ${rx+20} ${y}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
                svgContent += `<path d="M ${rx + rw} ${y} C ${rx+rw+15} ${y+20}, ${rx+rw-20} ${y+20}, ${rx+rw-20} ${y}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
            }
            
            // Aciers longitudinaux inférieurs tendus
            const nbBarres = steelArrangement.nbBarres;
            const espaceBarres = (w_px - 2*c) / (nbBarres - 1 || 1);
            
            for(let i=0; i<nbBarres; i++) {
                const bx = nbBarres === 1 ? x0 + w_px/2 : x0 + c + (i * espaceBarres);
                const by = y0 + h_px - c;
                svgContent += `<circle cx="${bx}" cy="${by}" r="${radius_bar}" fill="#c0392b"/>`;
            }
            
            // Aciers supérieurs de montage (ancrage des cadres)
            const appuiRadius = Math.max(radius_bar * 0.8, 4);
            svgContent += `<circle cx="${x0+c}" cy="${y0+c}" r="${appuiRadius}" fill="#7f8c8d"/>`;
            svgContent += `<circle cx="${x0+w_px-c}" cy="${y0+c}" r="${appuiRadius}" fill="#7f8c8d"/>`;
        }

        // Cotation de la hauteur utile d
        if (AppState.results) {
            svgContent += drawDimensionLine(x0, y0+c, x0, y0+h_px-c, `d ≈ ${AppState.results.d.toFixed(2)}`, "m", 30, textColor, textColor);
        }

        // Cotations de la section droite et enrobage
        svgContent += drawDimensionLine(x0, y0, x0+w_px, y0, `b = ${(b*100).toFixed(0)}`, "cm", -30, textColor, textColor);
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+h_px, `h = ${(h*100).toFixed(0)}`, "cm", -70, textColor, textColor);
        svgContent += drawDimensionLine(x0, y0+h_px, x0+c, y0+h_px, `c=${(AppState.c_enrobage*100).toFixed(1)}`, "", 15, textColor, textColor);

        // Cotations des espacements nets entre barres
        if (As > 0 && steelArrangement.nbBarres > 1) {
            const spacing_cm = (b*100 - 2*AppState.c_enrobage*100) / (steelArrangement.nbBarres - 1);
            const espaceBarres = (w_px - 2*c) / (steelArrangement.nbBarres - 1);
            for(let i=0; i<steelArrangement.nbBarres-1; i++) {
                const startX = x0 + c + i*espaceBarres;
                const endX = x0 + c + (i+1)*espaceBarres;
                svgContent += drawDimensionLine(startX, y0+h_px, endX, y0+h_px, spacing_cm.toFixed(1), "cm", 70, textColor, textColor);
            }
        }
    } else {
        // Vue longitudinale simplifiée
        const L_visu = 2.0; 
        const maxDimL = Math.max(L_visu, h);
        const scaleL = (svgSize - 2*margin) / maxDimL;
        const wL_px = L_visu * scaleL;
        const hL_px = h * scaleL;
        const x0L = (svgSize - wL_px) / 2 - 20;
        const y0L = (svgSize - hL_px) / 2;
        const c_pxL = AppState.c_enrobage * scaleL;

        svgContent += `<rect x="${x0L}" y="${y0L}" width="${wL_px}" height="${hL_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        svgContent += `<line x1="${x0L-20}" y1="${y0L}" x2="${x0L}" y2="${y0L}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="8,8"/>`;
        svgContent += `<line x1="${x0L-20}" y1="${y0L+hL_px}" x2="${x0L}" y2="${y0L+hL_px}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="8,8"/>`;
        svgContent += `<line x1="${x0L+wL_px}" y1="${y0L}" x2="${x0L+wL_px+20}" y2="${y0L}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="8,8"/>`;
        svgContent += `<line x1="${x0L+wL_px}" y1="${y0L+hL_px}" x2="${x0L+wL_px+20}" y2="${y0L+hL_px}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="8,8"/>`;

        const y_bas = y0L + hL_px - c_pxL;
        const y_haut = y0L + c_pxL;
        const hookL = 25;
        // Barre longitudinale tendue avec crochets normatifs aux extrémités
        svgContent += `<path d="M ${x0L+c_pxL} ${y_bas-hookL} L ${x0L+c_pxL} ${y_bas} L ${x0L+wL_px-c_pxL} ${y_bas} L ${x0L+wL_px-c_pxL} ${y_bas-hookL}" fill="none" stroke="#c0392b" stroke-width="${Math.max(radius_bar * 0.8, 4)}" stroke-linejoin="round"/>`;
        // Barre de montage supérieure
        svgContent += `<line x1="${x0L+c_pxL}" y1="${y_haut}" x2="${x0L+wL_px-c_pxL}" y2="${y_haut}" stroke="#7f8c8d" stroke-width="6" stroke-linecap="round"/>`;

        // Répartition des cadres transversaux
        let Asw_s = AppState.results ? AppState.results.Asw_s : 1.0;
        if (isNaN(Asw_s) || Asw_s <= 0) Asw_s = 1.0;
        let s_cadre_cm = Math.min(Math.max((1.00 / Asw_s) * 100, 5), 30);
        const sL_px = (s_cadre_cm / 100) * scaleL;
        const nb_cadres = Math.floor(wL_px / sL_px);

        for (let i = 1; i < nb_cadres; i++) {
            const x_pos = x0L + i * sL_px;
            svgContent += `<line x1="${x_pos}" y1="${y_haut}" x2="${x_pos}" y2="${y_bas}" stroke="#2980b9" stroke-width="3"/>`;
            svgContent += `<path d="M ${x_pos} ${y_haut} C ${x_pos+15} ${y_haut+15}, ${x_pos-15} ${y_haut+15}, ${x_pos} ${y_haut}" fill="none" stroke="#2980b9" stroke-width="3"/>`;
        }

        // Cotations de la vue longitudinale
        svgContent += drawDimensionLine(x0L, y0L, x0L, y0L+hL_px, `h = ${(h*100).toFixed(0)}`, "cm", 30, textColor, textColor);
        if (nb_cadres > 2) {
            svgContent += drawDimensionLine(x0L+sL_px, y0L+hL_px, x0L+2*sL_px, y0L+hL_px, `s = ${s_cadre_cm.toFixed(1)}`, "cm", 30, textColor, textColor);
        }

        svgContent += drawDimensionLine(x0L+wL_px, y0L+hL_px, x0L+wL_px, y0L+hL_px-c_pxL, "c", "", -20, textColor, textColor);
    }

    // Légende du schéma
    svgContent += `
    <g transform="translate(${svgSize - 180}, ${svgSize - 205})">
        <rect x="0" y="0" width="160" height="175" rx="6" ry="6" fill="${legendBg}" stroke="${concreteStroke}" stroke-width="1.5"/>
        <text x="15" y="25" font-weight="bold" font-size="16" fill="${textColor}">Légende</text>
        <circle cx="25" cy="50" r="7" fill="#c0392b"/>
        <text x="45" y="55" font-size="15" fill="${textColor}">Aciers long.</text>
        <line x1="15" y1="80" x2="35" y2="80" stroke="#2980b9" stroke-width="4"/>
        <text x="45" y="85" font-size="15" fill="${textColor}">Cadres / Épingles</text>
        <circle cx="25" cy="110" r="7" fill="#7f8c8d"/>
        <text x="45" y="115" font-size="15" fill="${textColor}">Aciers montage</text>
        <text x="15" y="140" font-size="14" font-weight="bold" fill="${textColor}">Section: ${steelArrangement.actualSection.toFixed(2)} cm²</text>
        <text x="15" y="160" font-size="14" font-weight="bold" fill="${textColor}">Aciers: HA${AppState.selectedDiameter}</text>
    </g>`;

    svgContent += `</svg>`;
    container.innerHTML = svgContent;
}

// =========================================================
// MODULES PÉDAGOGIQUES ET EXPORTATIONS
// =========================================================

function exportAsPNG() {
    exportPlanAsPNG('svgContainer', `ferraillage_poutre_${AppState.currentView}_${new Date().toISOString().slice(0,10)}.png`, renderUI);
}

function showFormula(type) {
    let msg = "";
    switch(type) {
        case 'Med': 
            msg = "Moment fléchissant ultime (ELU) : M_ed = (1.35 * G + 1.5 * Q) * L² / 8\nModèle isostatique d'une poutre sur deux appuis simples supportant des charges uniformément réparties."; 
            break;
        case 'Mu': 
            msg = "Moment ultime réduit : μ_cu = M_ed / (b * d² * f_cd)\nPermet d'évaluer la nécessité d'armatures comprimées (EC2 §3.1.6). Limite à 0.371 pour l'acier S500."; 
            break;
        case 'Alpha': 
            msg = "Position relative de l'axe neutre : α = 1.25 * (1 - √(1 - 2 * μ_cu))\nDistance y entre la fibre la plus comprimée et l'axe neutre (y = α * d)."; 
            break;
        case 'As': 
            msg = "Section d'acier longitudinal requise : A_s = M_ed / (z * f_yd)\nCalculée avec le bras de levier z des forces internes de flexion (z = d * (1 - 0.4 * α))."; 
            break;
        case 'Ved': 
            msg = "Effort tranchant ultime maximum : V_ed = (1.35 * G + 1.5 * Q) * L / 2\nCalculé aux appuis (sections critiques)."; 
            break;
        case 'Asw': 
            msg = "Aciers transversaux (cadres) requis : A_sw/s = V_ed / (z * f_ywd * cot(θ))\nCalculés selon la méthode des bielles inclinées d'inclinaison variable θ (comprise entre 21.8° et 45° selon l'EC2 §6.2.3)."; 
            break;
    }
    showModal("Détails réglementaires Eurocode 2", msg);
}

async function exportAsPDF() {
    await generatePDFReport('poutre', 'Poutre en Béton Armé', AppState, 'svgContainer', renderUI, setView, 'coupe', 'note_calcul_poutre.pdf');
}
