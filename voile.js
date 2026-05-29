/**
 * =========================================================
 * Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
 * Auteur : Raphaël ELIARD
 * Description : Logique de dimensionnement des voiles en béton.
 *               Calcul et vérification au cisaillement et dimensionnement
 *               des treillis soudés (TS) selon les exigences EC2.
 * =========================================================
 */

// =========================================================
// GESTION DE L'ÉTAT APPLICATIF
// =========================================================

const AppState = {
    inputs: { h: 0.20, fck: 25, N_Ed: 300, V_Ed: 40, enrobage: 3.0, nappesCount: 2 },
    selectedTS: 'ST25C',
    currentView: 'coupe',
    results: null
};

const voileInputs = Object.keys(AppState.inputs);

// Initialisation au chargement du DOM
window.addEventListener('DOMContentLoaded', () => {
    // Restauration de l'état sauvegardé localement
    voileInputs.forEach(id => {
        const savedVal = localStorage.getItem(`voile_${id}`);
        if (savedVal !== null) {
            AppState.inputs[id] = parseFloat(savedVal);
            const el = document.getElementById(id);
            if (el) el.value = savedVal;
        }
    });
    
    const savedTS = localStorage.getItem('voile_ts');
    if (savedTS) AppState.selectedTS = savedTS;

    bindEvents();
    updateTSSelector();
    runController();
});

function bindEvents() {
    // Écouteurs sur les champs de saisie
    voileInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                AppState.inputs[id] = parseFloat(e.target.value) || 0;
                localStorage.setItem(`voile_${id}`, e.target.value);
                runController();
            });
        }
    });

    // Choix des treillis soudés
    document.querySelectorAll('.steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.selectedTS = e.target.dataset.ts;
            localStorage.setItem('voile_ts', AppState.selectedTS);
            updateTSSelector();
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

function updateTSSelector() {
    document.querySelectorAll('.steel-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ts === AppState.selectedTS);
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
 * Vérification réglementaire d'une bande de voile sous charge axiale et transversale.
 * @param {object} params Paramètres du voile
 * @returns {object} Résultats de calcul
 */
function calculateEurocode2(params) {
    const { h, fck, N_Ed, V_Ed, enrobage, nappesCount, selectedTS } = params;
    const c_nom = enrobage / 100; // Enrobage nominal (m)
    
    const b = 1.0; // Analyse sur une bande unitaire de 1 mètre
    const Ac = b * h; // Section de béton (m²)
    const fcd = fck / 1.5; // Résistance de calcul du béton (MPa)

    // Calcul de la hauteur utile d
    const phi_ts = TS_SPECS[selectedTS].diam / 1000; // Diamètre des barres du treillis (m)
    let d = h - c_nom - (phi_ts / 2);
    if (nappesCount === 1) {
        d = h / 2; // Si 1 nappe centrale, par symétrie
    }

    // Sections minimales réglementaires des voiles (EC2 §9.6.2 & §9.6.3)
    const As_vmin = 0.002 * Ac * 10000; // Armatures verticales minimales (cm²/ml)
    // L'armature horizontale minimale doit représenter au moins 25% de la verticale
    const As_hmin = Math.max(0.25 * As_vmin, 0.001 * Ac * 10000); // cm²/ml
    
    // Le treillis soudé standard isométrique devant reprendre ces deux sollicitations :
    const As_req = Math.max(As_vmin, As_hmin);

    // Armatures fournies réelles (section unitaire du TS * nombre de nappes)
    const tsData = TS_SPECS[selectedTS];
    const As_prov = tsData.section * nappesCount;

    // Résistance à l'effort tranchant du béton non armé transversalement (EC2 §6.2.2)
    const sigma_cp_calc = N_Ed / (Ac * 1000); // Contrainte moyenne de compression (MPa)
    const sigma_cp = Math.min(sigma_cp_calc, 0.2 * fcd); // Limitée à 0.2 * fcd
    
    const k = Math.min(1 + Math.sqrt(200 / (d * 1000)), 2.0); // Facteur d'échelle (max 2.0)
    const v_min = 0.035 * Math.pow(k, 1.5) * Math.sqrt(fck); // MPa
    const k1 = 0.15; // Coefficient national français
    const rho_l = Math.min(As_prov / (b * d * 10000), 0.02);
    const C_Rdc = 0.18 / 1.5;
    
    // Calcul de la résistance théorique et minimale
    const V_Rdc_calc = (C_Rdc * k * Math.pow(100 * rho_l * fck, 1/3) + k1 * sigma_cp) * b * d * 1000;
    const V_Rdc_min = (v_min + k1 * sigma_cp) * b * d * 1000;
    const V_Rdc = Math.max(V_Rdc_calc, V_Rdc_min); // Résistance finale (kN/ml)

    let status = 'OK';
    if (V_Ed > V_Rdc) {
        status = 'ERROR_SHEAR';
    } else if (As_prov < As_req) {
        status = 'ERROR_STEEL';
    }

    return {
        sigma_cp, d, V_Rdc, V_Rdc_calc, V_Rdc_min, v_min, As_vmin, As_hmin, As_req, As_prov, rho_l,
        status, k, fcd, Ac
    };
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    const params = {
        ...AppState.inputs,
        selectedTS: AppState.selectedTS
    };
    AppState.results = calculateEurocode2(params);
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    
    // Rendu des valeurs calculées
    document.getElementById('res-sigma').innerText = res.sigma_cp.toFixed(2);
    document.getElementById('res-d').innerText = res.d.toFixed(3);
    document.getElementById('res-Vrdc').innerText = res.V_Rdc.toFixed(1);
    document.getElementById('res-vmin').innerText = res.v_min.toFixed(3);
    document.getElementById('res-As_v').innerText = res.As_vmin.toFixed(2);
    document.getElementById('res-As_h').innerText = res.As_hmin.toFixed(2);

    document.getElementById('tsUnit').innerText = TS_SPECS[AppState.selectedTS].section.toFixed(2);
    document.getElementById('steelReq').innerText = res.As_req.toFixed(2);
    document.getElementById('steelChosen').innerText = res.As_prov.toFixed(2);

    // Validation de conformité et badge de statut
    const badge = document.getElementById('statusBadge');
    if (res.status === 'ERROR_SHEAR') {
        badge.className = "status-badge status-red";
        badge.innerText = "Épaisseur insuffisante (Cisaillement > V_Rdc)";
    } else if (res.status === 'ERROR_STEEL') {
        badge.className = "status-badge status-red";
        badge.innerText = "Ferraillage Insuffisant";
    } else {
        badge.className = "status-badge status-green";
        badge.innerText = "Voile Conforme";
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
    const tsData = TS_SPECS[AppState.selectedTS];
    
    const h = p.h;
    const c_nom = p.enrobage / 100;
    
    const svgSize = 800;
    const margin = 120;
    const w_m = 1.0; 
    const maxDim = Math.max(w_m, h);
    const scale = (svgSize - 2 * margin) / maxDim;
    
    const w_px = w_m * scale;
    const h_px = h * scale;
    const x0 = (svgSize - w_px) / 2;
    const y0 = (svgSize - h_px) / 2;
    
    const c_px = c_nom * scale;
    const diam_px = (tsData.diam / 1000) * scale;
    const r_bar = Math.max(diam_px / 2, 3);
    const strokeW = Math.max(diam_px, 3);

    let svgContent = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" id="voilesvg" style="width: 100%; height: 100%;">`;
    
    if (AppState.currentView === 'coupe') {
        // Tracé de la section de voile tronquée
        svgContent += `<line x1="${x0}" y1="${y0-20}" x2="${x0}" y2="${y0+h_px+20}" stroke="${textColor}" stroke-width="2" stroke-dasharray="10,10"/>`;
        svgContent += `<line x1="${x0+w_px}" y1="${y0-20}" x2="${x0+w_px}" y2="${y0+h_px+20}" stroke="${textColor}" stroke-width="2" stroke-dasharray="10,10"/>`;

        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="none"/>`;
        svgContent += `<line x1="${x0}" y1="${y0}" x2="${x0+w_px}" y2="${y0}" stroke="${concreteStroke}" stroke-width="3"/>`;
        svgContent += `<line x1="${x0}" y1="${y0+h_px}" x2="${x0+w_px}" y2="${y0+h_px}" stroke="${concreteStroke}" stroke-width="3"/>`;

        const esp_ts = (tsData.esp / 1000) * scale;
        const nb_points = Math.floor(w_px / esp_ts);
        const offset_x = (w_px - (nb_points * esp_ts)) / 2;
        
        // Coordonnées des nappes de treillis soudés
        const nappesY = [];
        if (p.nappesCount === 1) {
            nappesY.push(y0 + h_px / 2);
        } else {
            nappesY.push(y0 + c_px);
            nappesY.push(y0 + h_px - c_px);
        }

        // Dessin des nappes et de leurs fils transversaux
        nappesY.forEach(ny => {
            svgContent += `<line x1="${x0}" y1="${ny}" x2="${x0+w_px}" y2="${ny}" stroke="#c0392b" stroke-width="${strokeW}" stroke-linecap="round"/>`;
            for(let i=0; i<=nb_points; i++) {
                const nx = x0 + offset_x + (i * esp_ts);
                svgContent += `<circle cx="${nx}" cy="${ny}" r="${r_bar}" fill="#c0392b"/>`;
            }
        });

        // Épingles de maintien transversales (liaisons de nappe à nappe)
        if (p.nappesCount === 2) {
            const epingleW = Math.max(strokeW * 0.8, 2);
            for(let i=1; i<nb_points; i+=2) {
                const nx = x0 + offset_x + (i * esp_ts);
                svgContent += `<line x1="${nx}" y1="${nappesY[0]}" x2="${nx}" y2="${nappesY[1]}" stroke="#2980b9" stroke-width="${epingleW}" stroke-linecap="round"/>`;
                svgContent += `<path d="M ${nx} ${nappesY[0]} C ${nx+15} ${nappesY[0]+15}, ${nx-15} ${nappesY[0]+15}, ${nx} ${nappesY[0]}" fill="none" stroke="#2980b9" stroke-width="${epingleW}" stroke-linecap="round" stroke-linejoin="round"/>`;
                svgContent += `<path d="M ${nx} ${nappesY[1]} C ${nx-15} ${nappesY[1]-15}, ${nx+15} ${nappesY[1]-15}, ${nx} ${nappesY[1]}" fill="none" stroke="#2980b9" stroke-width="${epingleW}" stroke-linecap="round" stroke-linejoin="round"/>`;
            }
        }

        // Cotations
        svgContent += drawDimensionLine(x0, y0, x0+w_px, y0, "Bande b = 1.00", "m", -30, textColor, textColor);
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+h_px, `h = ${(h*100).toFixed(0)}`, "cm", -20, textColor, textColor);

        if (p.nappesCount === 1) {
            svgContent += drawDimensionLine(x0, y0+h_px, x0+h_px/2, y0+h_px, "h/2", "", 15, textColor, textColor);
        } else {
            svgContent += drawDimensionLine(x0, y0+h_px, x0+c_px, y0+h_px, `c=${(p.enrobage).toFixed(1)}`, "", 15, textColor, textColor);
        }
    } else {
        // Vue de face (Élévation unitaire)
        const maxDimF = 1.0;
        const scaleF = (svgSize - 2 * margin) / maxDimF;
        const wF_px = maxDimF * scaleF;
        const hF_px = maxDimF * scaleF;
        const xF = (svgSize - wF_px) / 2 - 20;
        const yF = (svgSize - hF_px) / 2;

        svgContent += `<rect x="${xF}" y="${yF}" width="${wF_px}" height="${hF_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        const esp_ts_F = (tsData.esp / 1000) * scaleF;
        const nb_lines = Math.floor(wF_px / esp_ts_F);
        
        // Fils verticaux et horizontaux du treillis
        for(let i=1; i<nb_lines; i++) {
            svgContent += `<line x1="${xF + i*esp_ts_F}" y1="${yF}" x2="${xF + i*esp_ts_F}" y2="${yF+hF_px}" stroke="#c0392b" stroke-width="${strokeW}" stroke-linecap="round"/>`;
            svgContent += `<line x1="${xF}" y1="${yF + i*esp_ts_F}" x2="${xF+wF_px}" y2="${yF + i*esp_ts_F}" stroke="#c0392b" stroke-width="${strokeW}" stroke-linecap="round"/>`;
        }

        // Cotations
        svgContent += drawDimensionLine(xF, yF, xF+wF_px, yF, "Bande = 1.00", "m", -30, textColor, textColor);
        if (nb_lines > 2) {
            svgContent += drawDimensionLine(xF+esp_ts_F, yF+hF_px, xF+2*esp_ts_F, yF+hF_px, `Maille ${tsData.esp}`, "mm", 30, textColor, textColor);
        }
    }

    // Légende
    svgContent += `
    <g transform="translate(${svgSize - 180}, ${svgSize - 155})">
        <rect x="0" y="0" width="160" height="135" rx="6" ry="6" fill="${legendBg}" stroke="${concreteStroke}" stroke-width="1.5"/>
        <text x="15" y="25" font-weight="bold" font-size="16" fill="${textColor}">Légende</text>
        <line x1="15" y1="50" x2="35" y2="50" stroke="#c0392b" stroke-width="3"/>
        <circle cx="25" cy="50" r="4" fill="#c0392b"/>
        <text x="45" y="55" font-size="15" fill="${textColor}">Treillis Soudé</text>
        <text x="15" y="85" font-size="14" font-weight="bold" fill="${textColor}">Section: ${res.As_prov.toFixed(2)} cm²/ml</text>
        <text x="15" y="115" font-size="14" font-weight="bold" fill="${textColor}">Treillis: ${AppState.selectedTS}</text>
    </g>`;

    svgContent += '</svg>';
    container.innerHTML = svgContent;
}

// =========================================================
// MODULES PÉDAGOGIQUES ET EXPORTATIONS
// =========================================================

function showFormula(type) {
    let msg = "";
    switch(type) {
        case 'sigma_cp': 
            msg = "Contrainte normale moyenne de compression : σ_cp = N_Ed / A_c\nLimitée par l'EC2 à 20% de la résistance de calcul f_cd pour éviter l'écrasement du béton."; 
            break;
        case 'd': 
            msg = "Hauteur utile effective : d = h - enrobage - Ø_ts / 2\nImportant : l'utilisation d'une seule nappe d'aciers centrale réduit la hauteur utile à h/2, pénalisant fortement la flexion hors-plan."; 
            break;
        case 'V_Rdc': 
            msg = "Effort tranchant résistant ultime (béton seul) : V_Rd,c = (v_min + k₁ * σ_cp) * b * d\nRésistance mécanique au cisaillement sans aciers transversaux (EC2 §6.2.2)."; 
            break;
        case 'vmin': 
            msg = "Résistance minimale brute au cisaillement : v_min = 0.035 * k^(3/2) * f_ck^(1/2)\nCalculée avec le coefficient d'échelle de hauteur k (k = 1 + √(200/d) ≤ 2.0)."; 
            break;
        case 'As_vmin': 
            msg = "Section d'acier verticale minimale : A_s,v,min = 0.002 * A_c\nGarantit une ductilité minimale et la maîtrise de la fissuration verticale (EC2 §9.6.2)."; 
            break;
        case 'As_hmin': 
            msg = "Section d'acier horizontale minimale : A_s,h,min = max(0.25 * A_s,v,min, 0.001 * A_c)\nDisposée pour s'opposer aux effets du retrait thermique et hydrique (EC2 §9.6.3)."; 
            break;
    }
    showModal("Explications techniques Eurocode 2", msg);
}

function exportAsPNG() {
    exportPlanAsPNG('svgContainer', `ferraillage_voile_${AppState.currentView}_${new Date().toISOString().slice(0,10)}.png`, renderUI);
}

async function exportAsPDF() {
    await generatePDFReport('voile', 'Voile en Béton Armé', AppState, 'svgContainer', renderUI, setView, 'coupe', 'note_calcul_voile.pdf');
}
