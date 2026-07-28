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
        // On ignore toute valeur stockée illisible : sinon un NaN se propagerait
        // dans l'état applicatif et jusque dans la note de calcul PDF.
        if (savedVal !== null && isFinite(parseFloat(savedVal))) {
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
 * La logique réglementaire est centralisée dans ec2-core.js (fonctions pures,
 * couvertes par le harnais de tests tests-ec2.js).
 * @param {object} params Paramètres géométriques et mécaniques
 * @returns {object} Résultats mécaniques et excentricités
 */
function calculateEurocode2(params) {
    return EC2.poteau(params);
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    // Le bornage des données d'entrée est assuré par ec2-core.js ; on ne conserve
    // ici que le nombre de barres, propre à l'interface.
    const p = AppState.inputs;
    p.nb_a = Math.max(2, Math.round(p.nb_a) || 2);
    p.nb_b = Math.max(2, Math.round(p.nb_b) || 2);

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

    // Résistance de calcul N_Rd avec les aciers réels.
    // La contrainte des aciers COMPRIMÉS est plafonnée à E_s x eps_c2 = 400 MPa
    // pour du S500 (EC2 §6.1), et non à f_yd = 435 MPa.
    const N_Rd = EC2.poteauNRd(res, As_chosen); // kN
    
    // Rendu des résultats animés (Effet Wow)
    animateValue('res-N_Rd', parseFloat(document.getElementById('res-N_Rd').textContent) || 0, N_Rd, 800, 0);
    animateValue('res-l0', parseFloat(document.getElementById('res-l0').textContent) || 0, res.l0, 800, 2);
    animateValue('res-N_cr', parseFloat(document.getElementById('res-N_cr').textContent) || 0, res.N_cr, 800, 0);
    animateValue('res-lambda', parseFloat(document.getElementById('res-lambda').textContent) || 0, res.lambda, 800, 1);
    animateValue('res-As_min', parseFloat(document.getElementById('res-As_min').textContent) || 0, res.As_min, 800, 2);
    animateValue('res-As_calc', parseFloat(document.getElementById('res-As_calc').textContent) || 0, res.As_req, 800, 2);

    animateValue('steelReq', parseFloat(document.getElementById('steelReq').textContent) || 0, res.As_req, 800, 2);
    animateValue('steelChosen', parseFloat(document.getElementById('steelChosen').textContent) || 0, As_chosen, 800, 2);
    document.getElementById('nbBarres').textContent = total_bars;
    document.getElementById('diamShow').textContent = AppState.selectedDiameter;

    // Calcul de la répartition recommandée
    const min_bars = Math.ceil(res.As_req / section_per_bar);
    let rec_a = 2, rec_b = 2;
    // Plafond à 40 barres par face : au-delà le poteau est hors domaine
    // (A_s > 4 % A_c est déjà signalé) et la boucle deviendrait très longue.
    while ((rec_a * 2 + Math.max(0, rec_b - 2) * 2) < min_bars && rec_a < 40 && rec_b < 40) {
        if (res.inputs.a / rec_a >= res.inputs.b / rec_b) rec_a++;
        else rec_b++;
    }
    const rec_total = rec_a * 2 + Math.max(0, rec_b - 2) * 2;
    const recElement = document.getElementById('recommendation');
    recElement.textContent = `${rec_total} HA${AppState.selectedDiameter} (${rec_a} face 'a' × ${rec_b} face 'b')`;
    recElement.style.color = (total_bars < rec_total) ? "var(--danger)" : "var(--success)";

    // Calcul de l'espacement net des barres longitudinales
    // (dimensions bornées par ec2-core.js pour rester numériquement stables)
    const a_mm = res.inputs.a * 1000;
    const b_mm = res.inputs.b * 1000;
    const c_mm = res.inputs.enrobage * 10;
    const diam_cadre_mm = 8;
    const espace_libre_a = a_mm - 2*c_mm - 2*diam_cadre_mm;
    const espace_libre_b = b_mm - 2*c_mm - 2*diam_cadre_mm;
    
    const spacing_a = nb_a > 1 ? (espace_libre_a - (nb_a * AppState.selectedDiameter)) / (nb_a - 1) : 1000;
    const spacing_b = nb_b > 1 ? (espace_libre_b - (nb_b * AppState.selectedDiameter)) / (nb_b - 1) : 1000;
    let min_spacing_mm = Math.min(spacing_a, spacing_b);
    if (nb_a === 1 && nb_b === 1) min_spacing_mm = 1000;
    
    document.getElementById('spacing').textContent = min_spacing_mm === 1000 ? "N/A" : (min_spacing_mm / 10).toFixed(1);
    document.getElementById('coverageShow').textContent = res.inputs.enrobage.toFixed(1);

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

    // Diagnostics réglementaires détaillés
    const diagnostics = res.warnings.slice();
    diagnostics.push({
        level: 'info',
        text: "N_Rd = A_c·f_cd + A_s·σ_sc = " + N_Rd.toFixed(0) + " kN pour N_Ed = " +
              p.N_Ed.toFixed(0) + " kN (taux de travail " + (ratio * 100).toFixed(0) + " %). " +
              "Cette résistance est celle de la compression centrée : le moment M_Ed,tot = " +
              res.M_Ed_tot.toFixed(1) + " kN.m est repris séparément par les aciers."
    });
    if (min_spacing_mm !== 1000 && min_spacing_mm < Math.max(20, AppState.selectedDiameter)) {
        diagnostics.unshift({
            level: 'error',
            text: "Espacement libre de " + (min_spacing_mm / 10).toFixed(1) + " cm insuffisant : " +
                  "l'EC2 §8.2 impose au moins max(Ø ; 20 mm ; d_g + 5 mm)."
        });
    }
    renderWarnings('ec2-warnings', diagnostics);

    // Dimensions bornées par ec2-core.js : une saisie nulle donnerait une échelle
    // infinie, un SVG rempli de NaN et une boucle de dessin sans fin.
    generateColumnSVG(res.inputs.a, res.inputs.b, nb_a, nb_b, AppState.selectedDiameter,
                      res.inputs.enrobage, As_chosen);
}

// =========================================================
// DESSIN DU PLAN DE FERRAILLAGE (SVG)
// =========================================================

function generateColumnSVG(a, b, nb_a, nb_b, diameter, enrobage, As_chosen) {
    const svgContainer = document.getElementById('svgContainer');
    const { textColor, concreteFill, concreteStroke } = getThemeColors();
    const rebar = getRebarColors();
    const theme = document.documentElement.getAttribute('data-theme');

    const svgSize = 800;
    const margin = 140;
    const maxDim = Math.max(a, b);
    const scale = 400 / maxDim;
    let pxParMetre = scale;   // échelle de la vue active, transmise à finalizePlan
    
    const w_px = a * scale;
    const h_px = b * scale;
    const x0 = 120 + (400 - w_px) / 2; 
    const y0 = 120 + (400 - h_px) / 2;

    const c_px = (enrobage / 100) * scale;
    const radius_bar = Math.max((diameter / 1000) * scale / 2, 6);

    let svgContent = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;" class="svg-animate">
    <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}" stroke-width="1"/>
        </pattern>
    </defs>
    <rect data-plan-bg="1" fill="url(#grid)" />`;

    if (AppState.currentView === 'coupe') {
        // Section transversale du béton
        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="${concreteStroke}" data-base-stroke="1.6"/>`;

        // Cotations extérieures
        svgContent += drawDimensionLine(x0, y0, x0+w_px, y0, `a = ${(a*100).toFixed(0)}`, "cm", -35, textColor, textColor);
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+h_px, `b = ${(b*100).toFixed(0)}`, "cm", -100, textColor, textColor);

        // Dessin du cadre transversal principal
        const rx = x0 + c_px - radius_bar;
        const ry = y0 + c_px - radius_bar;
        const rw = w_px - 2*c_px + 2*radius_bar;
        const rh = h_px - 2*c_px + 2*radius_bar;
        const r_corner = radius_bar * 1.5;

        svgContent += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${r_corner}" ry="${r_corner}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.6"/>`;
        
        svgContent += `<line x1="${x0+c_px}" y1="${ry}" x2="${x0+c_px + 35}" y2="${ry + 35}" stroke="${rebar.stirrup}" data-base-stroke="2.6" stroke-linecap="round"/>`;
        svgContent += `<line x1="${rx}" y1="${y0+c_px}" x2="${rx + 35}" y2="${y0+c_px + 35}" stroke="${rebar.stirrup}" data-base-stroke="2.6" stroke-linecap="round"/>`;

        svgContent += drawDimensionLine(x0, y0+h_px, x0+c_px, y0+h_px, `c=${enrobage.toFixed(1)}`, "", 15, textColor, textColor);

        const esp_x = nb_a > 1 ? (w_px - 2*c_px) / (nb_a - 1) : 0;
        const esp_y = nb_b > 1 ? (h_px - 2*c_px) / (nb_b - 1) : 0;
        
        // Cadres / Épingles intérieures
        for (let j = 1; j < nb_b - 1; j++) {
            const y_pos = y0 + c_px + j * esp_y;
            svgContent += `<line x1="${rx}" y1="${y_pos}" x2="${rx + rw}" y2="${y_pos}" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${rx} ${y_pos} C ${rx-15} ${y_pos-20}, ${rx+20} ${y_pos-20}, ${rx+20} ${y_pos}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${rx + rw} ${y_pos} C ${rx+rw+15} ${y_pos+20}, ${rx+rw-20} ${y_pos+20}, ${rx+rw-20} ${y_pos}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
        }
        for (let i = 1; i < nb_a - 1; i++) {
            const x_pos = x0 + c_px + i * esp_x;
            svgContent += `<line x1="${x_pos}" y1="${ry}" x2="${x_pos}" y2="${ry + rh}" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${x_pos} ${ry} C ${x_pos+20} ${ry-15}, ${x_pos+20} ${ry+20}, ${x_pos} ${ry+20}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${x_pos} ${ry + rh} C ${x_pos-20} ${ry+rh+15}, ${x_pos-20} ${ry+rh-20}, ${x_pos} ${ry+rh-20}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
        }

        // Armatures longitudinales
        for (let i = 0; i < nb_a; i++) {
            for (let j = 0; j < nb_b; j++) {
                if (i === 0 || i === nb_a - 1 || j === 0 || j === nb_b - 1) {
                    const x_pos = x0 + c_px + i * esp_x;
                    const y_pos = y0 + c_px + j * esp_y;
                    svgContent += `<circle cx="${x_pos}" cy="${y_pos}" r="${radius_bar}" fill="${rebar.main}"/>`;
                }
            }
        }

        // Cotations fines des espacements nets
        if (nb_a > 1) {
            const distance_a = (a*100 - 2*enrobage) / (nb_a - 1);
            svgContent += drawDimensionLine(x0 + c_px, y0+h_px, x0 + c_px + esp_x, y0+h_px,
                distance_a.toFixed(1), "cm", 70, textColor, textColor);
        }
        
        if (nb_b > 1) {
            const distance_b = (b*100 - 2*enrobage) / (nb_b - 1);
            svgContent += drawDimensionLine(x0+w_px, y0 + c_px, x0+w_px, y0 + c_px + esp_y,
                distance_b.toFixed(1), "cm", -60, textColor, textColor);
        }
    } else {
        // Vue en élévation à la hauteur RÉELLEMENT saisie : la vue était
        // auparavant tronquée à 1.50 m quelle que soit la hauteur du poteau.
        const L_reel = AppState.results.inputs.L;
        const w_m = a;
        const scaleElev = 460 / L_reel;
        pxParMetre = scaleElev;
        const wElev_px = w_m * scaleElev;
        const hElev_px = L_reel * scaleElev;
        const xE = 120 + (400 - wElev_px) / 2;
        const yE = 120;

        svgContent += `<rect x="${xE}" y="${yE}" width="${wElev_px}" height="${hElev_px}" fill="${concreteFill}" stroke="${concreteStroke}" data-base-stroke="1.6"/>`;
        // Traits d'axe des noeuds (plancher bas et plancher haut)
        svgContent += `<line x1="${xE-15}" y1="${yE}" x2="${xE+wElev_px+15}" y2="${yE}" stroke="${concreteStroke}" data-base-stroke="1.6" stroke-dasharray="10,5"/>`;
        svgContent += `<line x1="${xE-15}" y1="${yE+hElev_px}" x2="${xE+wElev_px+15}" y2="${yE+hElev_px}" stroke="${concreteStroke}" data-base-stroke="1.6" stroke-dasharray="10,5"/>`;

        const cElev_px = (enrobage / 100) * scaleElev;
        const esp_x_elev = nb_a > 1 ? (wElev_px - 2*cElev_px) / (nb_a - 1) : 0;
        const bar_w = Math.max(radius_bar * 0.8, 4);
        
        // Dessin des barres verticales et de leurs attentes (liaison de recouvrement)
        for (let i = 0; i < nb_a; i++) {
            const x_pos = xE + cElev_px + i * esp_x_elev;
            const dir = (i < nb_a / 2) ? 1 : (i === (nb_a - 1) / 2 ? 0 : -1);
            const crank = 8 * dir;
            const retour = Math.min(hElev_px * 0.08, 35);
            svgContent += `<path d="M ${x_pos} ${yE+hElev_px+15} L ${x_pos} ${yE + retour} L ${x_pos + crank} ${yE + retour*0.45} L ${x_pos + crank} ${yE - 15}" fill="none" stroke="${rebar.main}" stroke-width="${bar_w}" stroke-linejoin="round" stroke-linecap="round"/>`;
        }

        // Espacement réglementaire des cadres de confinement (EC2 §9.5.3)
        const s_cadre_cm = Math.min(20 * diameter / 10, Math.min(a, b) * 100, 40);
        const sElev_px = (s_cadre_cm / 100) * scaleElev;
        const nb_cadres = Math.min(Math.floor(hElev_px / sElev_px), 200);
        const y_offset = (hElev_px - (nb_cadres-1) * sElev_px) / 2;

        for (let j = 0; j < nb_cadres; j++) {
            const y_pos = yE + y_offset + j * sElev_px;
            svgContent += `<line x1="${xE+cElev_px-4}" y1="${y_pos}" x2="${xE+wElev_px-cElev_px+4}" y2="${y_pos}" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
            svgContent += `<path d="M ${xE+cElev_px} ${y_pos} C ${xE+cElev_px+15} ${y_pos-15}, ${xE+cElev_px+15} ${y_pos+15}, ${xE+cElev_px} ${y_pos}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="1.6" stroke-linecap="round"/>`;
        }

        svgContent += drawDimensionLine(xE, yE, xE, yE+hElev_px, `L = ${L_reel.toFixed(2)}`, "m", 34, textColor, textColor);
        if (nb_cadres > 1) {
            svgContent += drawDimensionLine(xE+wElev_px, yE+y_offset, xE+wElev_px, yE+y_offset+sElev_px, `s = ${s_cadre_cm.toFixed(1)}`, "cm", -30, textColor, textColor);
        }

        svgContent += drawDimensionLine(xE+wElev_px-cElev_px, yE+hElev_px, xE+wElev_px, yE+hElev_px, "c", "", -20, textColor, textColor);
    }


    svgContent += '</svg>';
    svgContainer.innerHTML = svgContent;

    finalizePlan('svgContainer', {
        titre: AppState.currentView === 'coupe'
            ? `Coupe du poteau, ${(a*100).toFixed(0)} sur ${(b*100).toFixed(0)} centimètres, ${nb_a*2 + Math.max(0, nb_b-2)*2} barres HA${diameter}`
            : `Vue en élévation du poteau sur ${AppState.results.inputs.L.toFixed(2)} mètres de hauteur`,
        pxParMetre: pxParMetre,
        minRatio: AppState.currentView === 'coupe' ? 0.75 : 0.42,
        maxRatio: 2.2
    });

    renderPlanLegend([
        { forme: 'dot',  couleur: rebar.main,    texte: 'Aciers longitudinaux' },
        { forme: 'line', couleur: rebar.stirrup, texte: 'Cadres / épingles' },
        { forme: 'box',  couleur: concreteFill,  texte: 'Béton' }
    ], [
        `${nb_a*2 + Math.max(0, nb_b-2)*2} HA${diameter}`,
        `A<sub>s</sub> = ${As_chosen.toFixed(2)} cm²`,
        `Enrobage ${enrobage.toFixed(1)} cm`
    ]);
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
            msg = "Effort normal résistant ultime : N_Rd = A_c * f_cd + A_s * σ_sc\n" +
                  "Capacité de compression centrée de la section de béton armé.\n\n" +
                  "Attention : en compression pure le raccourcissement du béton est plafonné à " +
                  "ε_c2 = 2 ‰. L'acier ne peut donc mobiliser que σ_sc = E_s × ε_c2 = 400 MPa " +
                  "pour du S500, et non f_yd = 435 MPa (EC2 §6.1).\n\n" +
                  "Cette valeur ne couvre que l'effort normal : le moment total M_Ed,tot " +
                  "(1er ordre + imperfections + 2nd ordre) est équilibré séparément par les aciers.";
            break;
        case 'l0': 
            msg = "Longueur efficace de flambement : l₀ = β * L\nDépend des conditions de liaison aux extrémités (articulation, encastrement) selon l'EC2 §5.8.3.2."; 
            break;
        case 'N_cr': 
            msg = "Charge critique de flambement élastique (Euler) : N_cr = π² * E_cm * I / l₀²\nSeuil mécanique théorique d'instabilité."; 
            break;
        case 'lambda':
            msg = "Élancement géométrique : λ = l₀ / i\n\n" +
                  "Les effets du second ordre peuvent être négligés tant que λ reste inférieur " +
                  "à l'élancement limite de l'EC2 §5.8.3.1 :\n" +
                  "λ_lim = 20 · A · B · C / √n  avec n = N_Ed / (A_c · f_cd)\n" +
                  "A = 0.7, B = 1.1 et C = 0.7 (valeurs par défaut lorsque le fluage, le taux " +
                  "d'armatures et le rapport des moments d'extrémité ne sont pas connus).\n\n" +
                  (AppState.results
                      ? "Ici : λ = " + AppState.results.lambda.toFixed(1) +
                        " et λ_lim = " + AppState.results.lambda_lim.toFixed(1) + " → " +
                        (AppState.results.secondOrdre
                            ? "effets du second ordre pris en compte."
                            : "effets du second ordre négligeables.")
                      : "");
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
