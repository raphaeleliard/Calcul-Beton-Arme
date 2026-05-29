/**
 * =========================================================
 * Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
 * Auteur : Raphaël ELIARD
 * Description : Logique de dimensionnement des poteaux en béton armé.
 *               Calcul en compression centrée à l'ELU, prise en compte du flambement
 *               et des effets du second ordre, tracé SVG du ferraillage.
 * =========================================================
 */

// =========================================================
// GESTION DE L'ÉTAT APPLICATIF
// =========================================================

const AppState = {
    inputs: { L: 3.0, a: 0.30, b: 0.30, beta: 0.7, fck: 25, fyk: 500, N_Ed: 500, M_Ed: 0, enrobage: 3.0, nb_a: 2, nb_b: 2 },
    selectedDiameter: 12,
    currentView: 'coupe',
    results: null
};

const poteauInputs = Object.keys(AppState.inputs);

// Initialisation au chargement du DOM
window.addEventListener('DOMContentLoaded', () => {
    // Restauration des données locales
    poteauInputs.forEach(id => {
        const savedVal = localStorage.getItem(`poteau_${id}`);
        if (savedVal !== null) {
            AppState.inputs[id] = parseFloat(savedVal);
            const el = document.getElementById(id);
            if (el) el.value = savedVal;
        }
    });

    const savedDiam = localStorage.getItem('poteau_diameter');
    if (savedDiam) AppState.selectedDiameter = parseInt(savedDiam);
    
    bindEvents();
    updateSteelSelector();
    runController();
});

function bindEvents() {
    // Écoute des champs de saisie géométriques et mécaniques
    poteauInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                AppState.inputs[id] = parseFloat(e.target.value) || 0;
                localStorage.setItem(`poteau_${id}`, e.target.value);
                runController();
            });
        }
    });

    // Écouteurs sur les boutons HA
    document.querySelectorAll('.steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.selectedDiameter = parseInt(e.target.dataset.diameter);
            localStorage.setItem('poteau_diameter', AppState.selectedDiameter);
            updateSteelSelector();
            runController();
        });
    });

    window.onThemeChange = () => renderUI();
}

function setView(view) {
    AppState.currentView = view;
    document.getElementById('btnViewCoupe').classList.toggle('active', view === 'coupe');
    document.getElementById('btnViewElev').classList.toggle('active', view === 'elevation');
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
    return theme === 'dark' ? '#e0e0e0' : '#000';
}

// =========================================================
// LOGIQUE DE CALCUL EUROCODE 2
// =========================================================

/**
 * Calcul réglementaire de la stabilité et résistance d'un poteau comprimé (EC2 §5.8 & §6.1).
 * @param {object} params Paramètres géométriques et mécaniques
 * @returns {object} Résultats mécaniques et excentricités
 */
function calculateEurocode2(params) {
    const { L, a, b, beta, fck, fyk, N_Ed, M_Ed, enrobage, diameter } = params;
    
    // Coefficients de sécurité réglementaires
    const gammaC = 1.5; 
    const gammaS = 1.15; 
    
    const Ac = a * b * 10000; // Section droite de béton (cm²)
    const fcd = fck / gammaC; // Résistance de calcul du béton (MPa)
    const fyd = fyk / gammaS; // Résistance de calcul de l'acier (MPa)
    const fyd_cm2 = fyd / 10; // Résistance en kN/cm²

    // Stabilité au flambement
    const l0 = beta * L; // Longueur efficace de flambement (m)
    const I_min = (Math.max(a, b) * Math.pow(Math.min(a, b), 3)) / 12; // Moment d'inertie minimal (m⁴)
    const max_dim = Math.max(a, b);
    const i_gyr = Math.min(a, b) / Math.sqrt(12); // Rayon de giration minimal (m)
    const lambda = l0 / i_gyr; // Élancement du poteau

    const E_cm = 22000 * Math.pow((fck + 8)/10, 0.3); // Module de déformation du béton (MPa)
    const N_cr = (Math.PI * Math.PI * E_cm * 1000 * I_min) / (l0 * l0); // Charge critique d'Euler (kN)

    // Sections d'aciers limites réglementaires (EC2 §9.5.2)
    const As_min = Math.max(0.10 * N_Ed / fyd_cm2, 0.002 * Ac); // Section minimale (cm²)
    const As_max = 0.04 * Ac; // Section maximale hors recouvrements (cm²)

    // Hauteur utile d
    const c_nom = enrobage / 100; // m
    const phi_l = diameter / 1000; // m
    const phi_t = 0.008; // Diamètre indicatif des cadres (m)
    const d = max_dim - c_nom - phi_t - (phi_l / 2); // m

    // Imperfection géométrique initiale (EC2 §5.2)
    const e_i = Math.max(l0 / 400, max_dim / 30, 0.02); // Excentricité minimale
    const e_M = M_Ed > 0 ? (M_Ed / N_Ed) : 0; // Excentricité du premier ordre
    
    // Calcul des effets du second ordre (méthode de la courbure nominale, EC2 §5.8.8)
    let e_2 = 0;
    if (lambda > 31) {
        // Courbure nominale simplifiée
        const courbure = (fyd / 200000) / (0.45 * d); 
        e_2 = courbure * Math.pow(l0, 2) / 10;
    }

    const e_tot = e_M + e_i + e_2; // Excentricité totale de calcul
    const M_Ed_tot = N_Ed * e_tot; // Moment fléchissant total incluant second ordre (kN.m)
    
    // Estimation simplifiée de la section requise (flexion composée simplifiée)
    const N_Rd_c = Ac * (fcd / 10); // Résistance plastique du béton seul (kN)
    
    let As_req = 0;
    const As_req_N = Math.max(0, (N_Ed - N_Rd_c) / fyd_cm2);
    
    const z = d - (c_nom + phi_t + phi_l/2); // Bras de levier
    let As_req_M = 0;
    if (M_Ed_tot > 0 && z > 0.001) {
         As_req_M = M_Ed_tot / (z * fyd_cm2); 
    }
    
    As_req = As_req_N + As_req_M;
    As_req = Math.max(As_req, As_min);

    return { 
        l0, lambda, N_cr, e_tot, e_2, e_i, e_M, i_gyr, max_dim,
        As_req, As_req_N, As_req_M, As_min, As_max, 
        fcd, fyd_cm2, Ac, N_Rd_c, d, z, M_Ed_tot 
    };
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    const p = AppState.inputs;
    const calcParams = {
        ...p,
        diameter: AppState.selectedDiameter
    };
    AppState.results = calculateEurocode2(calcParams);
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    const p = AppState.inputs;
    
    // Ferraillage réel choisi
    let nb_a = Math.max(2, p.nb_a);
    let nb_b = Math.max(2, p.nb_b);
    const total_bars = nb_a * 2 + Math.max(0, nb_b - 2) * 2;
    const section_per_bar = STEEL_SPECS[AppState.selectedDiameter].section;
    const As_chosen = total_bars * section_per_bar;

    // Résistance de calcul N_Rd avec les aciers réels
    const N_Rd = res.N_Rd_c + (As_chosen * res.fyd_cm2); // kN
    
    // Rendu des résultats
    document.getElementById('res-N_Rd').textContent = N_Rd.toFixed(0);
    document.getElementById('res-l0').textContent = res.l0.toFixed(2);
    document.getElementById('res-N_cr').textContent = res.N_cr.toFixed(0);
    document.getElementById('res-lambda').textContent = res.lambda.toFixed(1);
    document.getElementById('res-As_min').textContent = res.As_min.toFixed(2);
    document.getElementById('res-As_calc').textContent = res.As_req.toFixed(2);

    document.getElementById('steelReq').textContent = res.As_req.toFixed(2);
    document.getElementById('steelChosen').textContent = As_chosen.toFixed(2);
    document.getElementById('nbBarres').textContent = total_bars;
    document.getElementById('diamShow').textContent = AppState.selectedDiameter;

    // Calcul de la répartition recommandée
    const min_bars = Math.ceil(res.As_req / section_per_bar);
    let rec_a = 2, rec_b = 2;
    while ((rec_a * 2 + Math.max(0, rec_b - 2) * 2) < min_bars) {
        if (p.a / rec_a >= p.b / rec_b) rec_a++;
        else rec_b++;
    }
    const rec_total = rec_a * 2 + Math.max(0, rec_b - 2) * 2;
    const recElement = document.getElementById('recommendation');
    recElement.textContent = `${rec_total} HA${AppState.selectedDiameter} (${rec_a} face 'a' × ${rec_b} face 'b')`;
    recElement.style.color = (total_bars < rec_total) ? "var(--danger)" : "var(--success)";

    // Calcul de l'espacement net des barres longitudinales
    const a_mm = p.a * 1000;
    const b_mm = p.b * 1000;
    const c_mm = p.enrobage * 10;
    const diam_cadre_mm = 8;
    const espace_libre_a = a_mm - 2*c_mm - 2*diam_cadre_mm;
    const espace_libre_b = b_mm - 2*c_mm - 2*diam_cadre_mm;
    
    const spacing_a = nb_a > 1 ? (espace_libre_a - (nb_a * AppState.selectedDiameter)) / (nb_a - 1) : 1000;
    const spacing_b = nb_b > 1 ? (espace_libre_b - (nb_b * AppState.selectedDiameter)) / (nb_b - 1) : 1000;
    let min_spacing_mm = Math.min(spacing_a, spacing_b);
    if (nb_a === 1 && nb_b === 1) min_spacing_mm = 1000;
    
    document.getElementById('spacing').textContent = min_spacing_mm === 1000 ? "N/A" : (min_spacing_mm / 10).toFixed(1);
    document.getElementById('coverageShow').textContent = p.enrobage.toFixed(1);

    // Vérifications de conformité et badge de statut
    const statusBadge = document.getElementById('statusBadge');
    const ratio = p.N_Ed / N_Rd;
    if (ratio > 1.0) {
        statusBadge.className = 'status-badge status-red';
        statusBadge.textContent = 'Section Béton Insuffisante';
    } else if (As_chosen < res.As_req) {
        statusBadge.className = 'status-badge status-red';
        statusBadge.textContent = 'Ferraillage Insuffisant';
    } else if (As_chosen > res.As_max) {
        statusBadge.className = 'status-badge status-red';
        statusBadge.textContent = 'Ferraillage Trop Important (As > 4%)';
    } else if (min_spacing_mm < Math.max(20, AppState.selectedDiameter)) {
        statusBadge.className = 'status-badge status-red';
        statusBadge.textContent = 'Aciers trop serrés (EC2 §8.2)';
    } else if (ratio > 0.9) {
        statusBadge.className = 'status-badge status-orange';
        statusBadge.textContent = 'Section Limite (N_Ed proche N_Rd)';
    } else {
        statusBadge.className = 'status-badge status-green';
        statusBadge.textContent = 'Section Conforme';
    }

    generateColumnSVG(p.a, p.b, nb_a, nb_b, AppState.selectedDiameter, p.enrobage, As_chosen);
}

// =========================================================
// DESSIN DU PLAN DE FERRAILLAGE (SVG)
// =========================================================

function generateColumnSVG(a, b, nb_a, nb_b, diameter, enrobage, As_chosen) {
    const svgContainer = document.getElementById('svgContainer');
    const { textColor, concreteFill, concreteStroke, legendBg } = getThemeColors();

    const svgSize = 800;
    const margin = 140;
    const maxDim = Math.max(a, b);
    const scale = 400 / maxDim; 
    
    const w_px = a * scale;
    const h_px = b * scale;
    const x0 = 120 + (400 - w_px) / 2; 
    const y0 = 120 + (400 - h_px) / 2;

    const c_px = (enrobage / 100) * scale;
    const radius_bar = Math.max((diameter / 1000) * scale / 2, 6);

    let svgContent = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">`;

    if (AppState.currentView === 'coupe') {
        // Section transversale du béton
        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;

        // Cotations extérieures
        svgContent += drawDimensionLine(x0, y0, x0+w_px, y0, `a = ${(a*100).toFixed(0)}`, "cm", -35, textColor, textColor);
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+h_px, `b = ${(b*100).toFixed(0)}`, "cm", -100, textColor, textColor);

        // Dessin du cadre transversal principal
        const stirrupStroke = 5;
        const rx = x0 + c_px - radius_bar;
        const ry = y0 + c_px - radius_bar;
        const rw = w_px - 2*c_px + 2*radius_bar;
        const rh = h_px - 2*c_px + 2*radius_bar;
        const r_corner = radius_bar * 1.5;

        svgContent += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${r_corner}" ry="${r_corner}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke}"/>`;
        
        svgContent += `<line x1="${x0+c_px}" y1="${ry}" x2="${x0+c_px + 35}" y2="${ry + 35}" stroke="#2980b9" stroke-width="${stirrupStroke}" stroke-linecap="round"/>`;
        svgContent += `<line x1="${rx}" y1="${y0+c_px}" x2="${rx + 35}" y2="${y0+c_px + 35}" stroke="#2980b9" stroke-width="${stirrupStroke}" stroke-linecap="round"/>`;

        svgContent += drawDimensionLine(x0, y0+h_px, x0+c_px, y0+h_px, `c=${enrobage.toFixed(1)}`, "", 15, textColor, textColor);

        const esp_x = nb_a > 1 ? (w_px - 2*c_px) / (nb_a - 1) : 0;
        const esp_y = nb_b > 1 ? (h_px - 2*c_px) / (nb_b - 1) : 0;
        
        // Cadres / Épingles intérieures
        for (let j = 1; j < nb_b - 1; j++) {
            const y_pos = y0 + c_px + j * esp_y;
            svgContent += `<line x1="${rx}" y1="${y_pos}" x2="${rx + rw}" y2="${y_pos}" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${rx} ${y_pos} C ${rx-15} ${y_pos-20}, ${rx+20} ${y_pos-20}, ${rx+20} ${y_pos}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${rx + rw} ${y_pos} C ${rx+rw+15} ${y_pos+20}, ${rx+rw-20} ${y_pos+20}, ${rx+rw-20} ${y}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
        }
        for (let i = 1; i < nb_a - 1; i++) {
            const x_pos = x0 + c_px + i * esp_x;
            svgContent += `<line x1="${x_pos}" y1="${ry}" x2="${x_pos}" y2="${ry + rh}" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${x_pos} ${ry} C ${x_pos+20} ${ry-15}, ${x_pos+20} ${ry+20}, ${x_pos} ${ry+20}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${x_pos} ${ry + rh} C ${x_pos-20} ${ry+rh+15}, ${x_pos-20} ${ry+rh-20}, ${x_pos} ${ry+rh-20}" fill="none" stroke="#2980b9" stroke-width="${stirrupStroke - 1}" stroke-linecap="round"/>`;
        }

        // Armatures longitudinales
        for (let i = 0; i < nb_a; i++) {
            for (let j = 0; j < nb_b; j++) {
                if (i === 0 || i === nb_a - 1 || j === 0 || j === nb_b - 1) {
                    const x_pos = x0 + c_px + i * esp_x;
                    const y_pos = y0 + c_px + j * esp_y;
                    svgContent += `<circle cx="${x_pos}" cy="${y_pos}" r="${radius_bar}" fill="#c0392b"/>`;
                }
            }
        }

        // Cotations fines des espacements nets
        if (nb_a > 1) {
            const distance_a = (a*100 - 2*enrobage) / (nb_a - 1);
            for(let i = 0; i < nb_a - 1; i++) {
                const startX = x0 + c_px + i*esp_x;
                const endX = x0 + c_px + (i+1)*esp_x;
                svgContent += drawDimensionLine(startX, y0+h_px, endX, y0+h_px, distance_a.toFixed(1), "cm", 70, textColor, textColor);
            }
        }
        
        if (nb_b > 1) {
            const distance_b = (b*100 - 2*enrobage) / (nb_b - 1);
            for(let j = 0; j < nb_b - 1; j++) {
                const startY = y0 + c_px + j*esp_y;
                const endY = y0 + c_px + (j+1)*esp_y;
                svgContent += drawDimensionLine(x0+w_px, startY, x0+w_px, endY, distance_b.toFixed(1), "cm", -60, textColor, textColor);
            }
        }
    } else {
        // Vue en élévation tronquée (1.5m)
        const L_visu = 1.5; 
        const w_m = a; 
        const maxDimElev = Math.max(w_m, L_visu);
        const scaleElev = 400 / maxDimElev;
        const wElev_px = w_m * scaleElev;
        const hElev_px = L_visu * scaleElev;
        const xE = 120 + (400 - wElev_px) / 2;
        const yE = 120 + (400 - hElev_px) / 2;

        svgContent += `<rect x="${xE}" y="${yE}" width="${wElev_px}" height="${hElev_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        svgContent += `<line x1="${xE-15}" y1="${yE}" x2="${xE+wElev_px+15}" y2="${yE}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="10,5"/>`;
        svgContent += `<line x1="${xE-15}" y1="${yE+hElev_px}" x2="${xE+wElev_px+15}" y2="${yE+hElev_px}" stroke="${concreteStroke}" stroke-width="2" stroke-dasharray="10,5"/>`;

        const cElev_px = (enrobage / 100) * scaleElev;
        const esp_x_elev = nb_a > 1 ? (wElev_px - 2*cElev_px) / (nb_a - 1) : 0;
        const bar_w = Math.max(radius_bar * 0.8, 4);
        
        // Dessin des barres verticales et de leurs attentes (liaison de recouvrement)
        for (let i = 0; i < nb_a; i++) {
            const x_pos = xE + cElev_px + i * esp_x_elev;
            const dir = (i < nb_a / 2) ? 1 : (i === (nb_a - 1) / 2 ? 0 : -1);
            const crank = 8 * dir;
            svgContent += `<path d="M ${x_pos} ${yE+hElev_px+15} L ${x_pos} ${yE + 35} L ${x_pos + crank} ${yE + 15} L ${x_pos + crank} ${yE - 15}" fill="none" stroke="#c0392b" stroke-width="${bar_w}" stroke-linejoin="round" stroke-linecap="round"/>`;
        }

        // Espacement réglementaire des cadres de confinement (EC2 §9.5.3)
        const s_cadre_cm = Math.min(20 * diameter / 10, Math.min(a, b) * 100, 40);
        const sElev_px = (s_cadre_cm / 100) * scaleElev;
        const nb_cadres = Math.floor(hElev_px / sElev_px);
        const y_offset = (hElev_px - (nb_cadres-1) * sElev_px) / 2;

        for (let j = 0; j < nb_cadres; j++) {
            const y_pos = yE + y_offset + j * sElev_px;
            svgContent += `<line x1="${xE+cElev_px-4}" y1="${y_pos}" x2="${xE+wElev_px-cElev_px+4}" y2="${y_pos}" stroke="#2980b9" stroke-width="4" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${xE+cElev_px} ${y_pos} C ${xE+cElev_px+15} ${y_pos-15}, ${xE+cElev_px+15} ${y_pos+15}, ${xE+cElev_px} ${y_pos}" fill="none" stroke="#2980b9" stroke-width="3" stroke-linecap="round"/>`;
        }

        svgContent += drawDimensionLine(xE, yE, xE, yE+hElev_px, "L (tronqué)", "", 30, textColor, textColor);
        if (nb_cadres > 1) {
            svgContent += drawDimensionLine(xE+wElev_px, yE+y_offset, xE+wElev_px, yE+y_offset+sElev_px, `s = ${s_cadre_cm.toFixed(1)}`, "cm", -30, textColor, textColor);
        }

        svgContent += drawDimensionLine(xE+wElev_px-cElev_px, yE+hElev_px, xE+wElev_px, yE+hElev_px, "c", "", -20, textColor, textColor);
    }

    // Légende
    svgContent += `
    <g transform="translate(${svgSize - 180}, ${svgSize - 195})">
        <rect x="0" y="0" width="160" height="165" rx="6" ry="6" fill="${legendBg}" stroke="${concreteStroke}" stroke-width="1.5"/>
        <text x="15" y="25" font-weight="bold" font-size="16" fill="${textColor}">Légende</text>
        <circle cx="25" cy="50" r="7" fill="#c0392b"/>
        <text x="45" y="55" font-size="15" fill="${textColor}">Aciers long.</text>
        <line x1="15" y1="75" x2="35" y2="75" stroke="#2980b9" stroke-width="4"/>
        <text x="45" y="80" font-size="15" fill="${textColor}">Cadres / Épingles</text>
        <rect x="18" y="94" width="14" height="14" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>
        <text x="45" y="106" font-size="15" fill="${textColor}">Béton</text>
        <text x="15" y="126" font-size="14" font-weight="bold" fill="${textColor}">Section: ${As_chosen.toFixed(2)} cm²</text>
        <text x="15" y="146" font-size="14" font-weight="bold" fill="${textColor}">Aciers: HA${AppState.selectedDiameter}</text>
    </g>`;

    svgContent += '</svg>';
    svgContainer.innerHTML = svgContent;
}

// =========================================================
// MODULES PÉDAGOGIQUES ET EXPORTATIONS
// =========================================================

function exportAsPNG() {
    exportPlanAsPNG('svgContainer', `ferraillage_poteau_${AppState.currentView}_${new Date().toISOString().slice(0,10)}.png`, renderUI);
}

function showFormula(type) {
    let msg = "";
    switch(type) {
        case 'N_Rd': 
            msg = "Effort normal résistant ultime : N_Rd = A_c * f_cd + A_s * f_yd\nCapacité de compression ultime combinée de la section de béton armé."; 
            break;
        case 'l0': 
            msg = "Longueur efficace de flambement : l₀ = β * L\nDépend des conditions de liaison aux extrémités (articulation, encastrement) selon l'EC2 §5.8.3.2."; 
            break;
        case 'N_cr': 
            msg = "Charge critique de flambement élastique (Euler) : N_cr = π² * E_cm * I / l₀²\nSeuil mécanique théorique d'instabilité."; 
            break;
        case 'lambda': 
            msg = "Élancement géométrique : λ = l₀ / i\nDétermine si la structure est élancée (si λ > 31), imposant le calcul des effets de second ordre (EC2 §5.8.3.1)."; 
            break;
        case 'As_min': 
            msg = "Section d'acier minimale réglementaire : A_s,min = max(0.10 * N_Ed / f_yd, 0.002 * A_c)\nExigence minimale de ductilité (EC2 §9.5.2)."; 
            break;
        case 'As_calc': 
            msg = "Section d'acier théorique requise : A_s,req\nDéterminée pour équilibrer la compression ultime N_Ed combinée au moment ultime total M_Ed,tot (1er ordre + excentricité géométrique e_i + 2nd ordre e_2)."; 
            break;
    }
    showModal("Détails réglementaires Eurocode 2", msg);
}

async function exportAsPDF() {
    await generatePDFReport('poteau', 'Poteau en Béton Armé', AppState, 'svgContainer', renderUI, setView, 'coupe', 'note_calcul_poteau.pdf');
}
