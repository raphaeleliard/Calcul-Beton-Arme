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
        // On ignore toute valeur stockée illisible : sinon un NaN se propagerait
        // dans l'état applicatif et jusque dans la note de calcul PDF.
        if (savedVal !== null && isFinite(parseFloat(savedVal))) {
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
 * La logique réglementaire est centralisée dans ec2-core.js (fonctions pures,
 * couvertes par le harnais de tests tests-ec2.js).
 * @param {object} params Paramètres géométriques et mécaniques
 * @returns {object} Résultats de calcul et statuts de conformité
 */
function calculateEC2(params) {
    return EC2.poutre(params);
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    const nbBarres = Math.max(1, AppState.nbBarres || 1);
    const calcParams = {
        ...AppState.inputs,
        diameter: AppState.selectedDiameter,
        c_nom: AppState.c_enrobage,
        nbBarres: nbBarres,
        // Section réellement mise en oeuvre : nécessaire pour rho_l (V_Rd,c) et la flèche
        As_prov: nbBarres * STEEL_SPECS[AppState.selectedDiameter].section
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

    // Espacement libre entre aciers tendus (EC2 §8.2) : recalculé pour le nombre
    // de barres réellement choisi par l'utilisateur, en mm puis affiché en cm.
    const diam_cm = AppState.selectedDiameter / 10;
    const espLibre_mm = calculerEspacementLibre(res.inputs.b, steelArrangement.nbBarres);
    const espLibreMin_mm = res.espLibreMin;
    if (steelArrangement.nbBarres > 1) {
        document.getElementById('spacing').innerText = (espLibre_mm / 10).toFixed(1);
    } else {
        document.getElementById('spacing').innerText = 'N/A';
    }
    document.getElementById('coverageShow').innerText = (AppState.c_enrobage * 100).toFixed(1);

    // Vérification des différents critères de conformité
    const badge = document.getElementById('statusBadge');
    if (res.status === 'ERROR_MUCU') {
        badge.className = "status-badge status-red";
        badge.innerText = "Section béton insuffisante !";
        document.getElementById('res-Asw').innerText = "—";
    } else if (res.status === 'ERROR_SHEAR') {
        badge.className = "status-badge status-red";
        badge.innerText = "Risque Rupture Bielles (Cisaillement)";
        document.getElementById('res-Asw').innerText = "Erreur";
    } else if (steelArrangement.actualSection < res.As_req) {
        badge.className = "status-badge status-red";
        badge.innerText = "Ferraillage Insuffisant";
    } else if (steelArrangement.actualSection > res.As_max) {
        badge.className = "status-badge status-red";
        badge.innerText = "Ferraillage Trop Important (As > 4%)";
    } else if (steelArrangement.nbBarres > 1 && espLibre_mm < espLibreMin_mm) {
        badge.className = "status-badge status-red";
        badge.innerText = "Aciers trop serrés (EC2 §8.2)";
    } else if (!res.fleche.ok) {
        badge.className = "status-badge status-orange";
        badge.innerText = "Flèche à vérifier (L/d > limite EC2 §7.4.2)";
    } else {
        badge.className = "status-badge status-green";
        badge.innerText = "Section Conforme";
    }

    if (res.status !== 'ERROR_SHEAR' && res.status !== 'ERROR_MUCU') {
        document.getElementById('res-Asw').innerText = res.Asw_s.toFixed(2);
    }

    // Diagnostics réglementaires détaillés
    const diagnostics = res.warnings.slice();
    if (steelArrangement.nbBarres > 1 && espLibre_mm < espLibreMin_mm) {
        diagnostics.unshift({
            level: 'error',
            text: "Espacement libre entre barres de " + (espLibre_mm / 10).toFixed(1) +
                  " cm < minimum EC2 §8.2 de " + (espLibreMin_mm / 10).toFixed(1) +
                  " cm : disposer les aciers sur deux lits ou élargir la poutre."
        });
    }
    if (res.cisaillementMinimal) {
        diagnostics.push({
            level: 'info',
            text: "Cadres HA8 à 2 brins : espacement pratique ≈ " + res.s_cadre_prop.toFixed(0) +
                  " cm (maximum réglementaire 0.75·d = " + res.s_max_cadres.toFixed(0) + " cm)."
        });
    }
    renderWarnings('ec2-warnings', diagnostics);

    // On dessine avec les dimensions BORNÉES par ec2-core.js : une saisie vide ou
    // nulle produirait sinon une échelle infinie et un SVG rempli de NaN.
    drawPoutreSVG(res.inputs.b, res.inputs.h, As_to_draw, steelArrangement, espLibre_mm / 10);
}

/**
 * Espacement libre (net) entre barres d'un même lit, en mm.
 * Prend en compte l'enrobage et l'encombrement des cadres transversaux.
 */
function calculerEspacementLibre(b, nbBarres) {
    const phi_l_mm = AppState.selectedDiameter;
    const dispo_mm = (b - 2 * AppState.c_enrobage - 2 * 0.008) * 1000;
    if (nbBarres > 1) {
        return (dispo_mm - nbBarres * phi_l_mm) / (nbBarres - 1);
    }
    return dispo_mm - phi_l_mm;
}

// =========================================================
// DESSIN DU PLAN DE FERRAILLAGE (SVG)
// =========================================================

function drawPoutreSVG(b, h, As, steelArrangement, espLibre_cm) {
    const container = document.getElementById('svgContainer');
    const { textColor, concreteFill, concreteStroke } = getThemeColors();
    const rebar = getRebarColors();

    const svgSize = 800;
    const margin = 140;
    const maxDim = Math.max(b, h);
    const scale = (svgSize - 2*margin) / maxDim;
    // Renseignés par la vue active, puis transmis à finalizePlan
    let pxParMetre = scale;
    let maxRatioVue = 2.2;
    
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
        svgContent += `<rect x="${x0}" y="${y0}" width="${w_px}" height="${h_px}" fill="${concreteFill}" stroke="${concreteStroke}" data-base-stroke="1.6"/>`;
        
        if (As > 0) {
            // Dessin des armatures transversales (cadres)
            const rx = x0 + c - radius_bar;
            const ry = y0 + c - radius_bar;
            const rw = w_px - 2*c + 2*radius_bar;
            const rh = h_px - 2*c + 2*radius_bar;
            const r_corner = radius_bar * 1.5;

            svgContent += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${r_corner}" ry="${r_corner}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.6"/>`;

            // Crochets des cadres
            svgContent += `<line x1="${x0+c}" y1="${ry}" x2="${x0+c + 35}" y2="${ry + 35}" stroke="${rebar.stirrup}" data-base-stroke="2.6" stroke-linecap="round"/>`;
            svgContent += `<line x1="${rx}" y1="${y0+c}" x2="${rx + 35}" y2="${y0+c + 35}" stroke="${rebar.stirrup}" data-base-stroke="2.6" stroke-linecap="round"/>`;

            // Aciers de peau / de montage transversaux (épingles éventuelles)
            const nbEspaceurs = 5;
            for(let i = 1; i < nbEspaceurs; i++) {
                const y = y0 + c + ((h_px - 2*c) * i / nbEspaceurs);
                svgContent += `<line x1="${rx}" y1="${y}" x2="${rx + rw}" y2="${y}" stroke="${rebar.stirrup}" data-base-stroke="2.0"/>`;
                svgContent += `<path d="M ${rx} ${y} C ${rx-15} ${y-20}, ${rx+20} ${y-20}, ${rx+20} ${y}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
                svgContent += `<path d="M ${rx + rw} ${y} C ${rx+rw+15} ${y+20}, ${rx+rw-20} ${y+20}, ${rx+rw-20} ${y}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="2.0" stroke-linecap="round"/>`;
            }
            
            // Aciers longitudinaux inférieurs tendus
            const nbBarres = steelArrangement.nbBarres;
            const espaceBarres = (w_px - 2*c) / (nbBarres - 1 || 1);
            
            for(let i=0; i<nbBarres; i++) {
                const bx = nbBarres === 1 ? x0 + w_px/2 : x0 + c + (i * espaceBarres);
                const by = y0 + h_px - c;
                svgContent += `<circle cx="${bx}" cy="${by}" r="${radius_bar}" fill="${rebar.main}"/>`;
            }
            
            // Aciers supérieurs de montage (ancrage des cadres)
            const appuiRadius = Math.max(radius_bar * 0.8, 4);
            svgContent += `<circle cx="${x0+c}" cy="${y0+c}" r="${appuiRadius}" fill="${rebar.montage}"/>`;
            svgContent += `<circle cx="${x0+w_px-c}" cy="${y0+c}" r="${appuiRadius}" fill="${rebar.montage}"/>`;
        }

        // Cotation de la hauteur utile d
        if (AppState.results) {
            svgContent += drawDimensionLine(x0, y0+c, x0, y0+h_px-c, `d ≈ ${AppState.results.d.toFixed(2)}`, "m", 30, textColor, textColor);
        }

        // Cotations de la section droite et enrobage
        svgContent += drawDimensionLine(x0, y0, x0+w_px, y0, `b = ${(b*100).toFixed(0)}`, "cm", -30, textColor, textColor);
        svgContent += drawDimensionLine(x0+w_px, y0, x0+w_px, y0+h_px, `h = ${(h*100).toFixed(0)}`, "cm", -70, textColor, textColor);
        svgContent += drawDimensionLine(x0, y0+h_px, x0+c, y0+h_px, `c=${(AppState.c_enrobage*100).toFixed(1)}`, "", 15, textColor, textColor);

        // Espacement libre entre barres : coté une seule fois, les barres étant
        // équidistantes (auparavant la même valeur était répétée n-1 fois).
        if (As > 0 && steelArrangement.nbBarres > 1) {
            const espaceBarres = (w_px - 2*c) / (steelArrangement.nbBarres - 1);
            svgContent += drawDimensionLine(x0 + c, y0+h_px, x0 + c + espaceBarres, y0+h_px,
                espLibre_cm.toFixed(1), "cm", 70, textColor, textColor);
        }
    } else {
        // Vue longitudinale à la portée RÉELLEMENT saisie : la longueur était
        // auparavant figée à 2.00 m, si bien qu'une poutre de 5 m et une de 10 m
        // donnaient exactement le même dessin.
        const L_reel = AppState.results.inputs.L;
        const scaleL = (svgSize - 2*margin) / L_reel;
        const wL_px = L_reel * scaleL;
        const hL_px = h * scaleL;
        const x0L = margin;
        const y0L = (svgSize - hL_px) / 2;
        const c_pxL = AppState.c_enrobage * scaleL;
        const barW = Math.max((AppState.selectedDiameter / 1000) * scaleL, 2.5);

        svgContent += `<rect x="${x0L}" y="${y0L}" width="${wL_px}" height="${hL_px}" fill="${concreteFill}" stroke="${concreteStroke}" data-base-stroke="1.6"/>`;

        // Symboles d'appui simple aux deux extrémités
        const appui = (cx) => {
            const t = hL_px * 0.22;
            return `<path d="M ${cx} ${y0L+hL_px} L ${cx-t} ${y0L+hL_px+t*1.4} L ${cx+t} ${y0L+hL_px+t*1.4} Z"
                     fill="none" stroke="${concreteStroke}" data-base-stroke="1.6" stroke-linejoin="round"/>`;
        };
        svgContent += appui(x0L) + appui(x0L + wL_px);

        const y_bas = y0L + hL_px - c_pxL;
        const y_haut = y0L + c_pxL;
        const hookL = Math.min(hL_px * 0.35, c_pxL + hL_px * 0.3);

        // Aciers tendus avec crochets d'ancrage aux appuis
        svgContent += `<path d="M ${x0L+c_pxL} ${y_bas-hookL} L ${x0L+c_pxL} ${y_bas} L ${x0L+wL_px-c_pxL} ${y_bas} L ${x0L+wL_px-c_pxL} ${y_bas-hookL}" fill="none" stroke="${rebar.main}" stroke-width="${barW}" stroke-linejoin="round" stroke-linecap="round"/>`;
        // Aciers de montage en partie supérieure
        svgContent += `<line x1="${x0L+c_pxL}" y1="${y_haut}" x2="${x0L+wL_px-c_pxL}" y2="${y_haut}" stroke="${rebar.montage}" stroke-width="${barW*0.8}" stroke-linecap="round"/>`;

        // Répartition des cadres (cadre HA8 à 2 brins ≈ 1.006 cm²), bornée par
        // l'espacement maximal réglementaire s_l,max = 0.75 d (EC2 §9.2.2(6))
        const resPoutre = AppState.results;
        let Asw_s = resPoutre ? resPoutre.Asw_s : 1.0;
        if (isNaN(Asw_s) || Asw_s <= 0) Asw_s = 1.0;
        const s_max_cm = resPoutre && isFinite(resPoutre.s_max_cadres) ? resPoutre.s_max_cadres : 30;
        const s_cadre_cm = Math.min(Math.max((1.006 / Asw_s) * 100, 5), s_max_cm);
        const sL_px = (s_cadre_cm / 100) * scaleL;
        const nb_cadres = Math.min(Math.floor(wL_px / sL_px), 200);
        const crochet = Math.min(hL_px * 0.12, 10);

        for (let i = 0; i <= nb_cadres; i++) {
            const x_pos = x0L + c_pxL + i * sL_px;
            if (x_pos > x0L + wL_px - c_pxL) break;
            svgContent += `<line x1="${x_pos}" y1="${y_haut}" x2="${x_pos}" y2="${y_bas}" stroke="${rebar.stirrup}" data-base-stroke="1.4"/>`;
            svgContent += `<path d="M ${x_pos} ${y_haut} C ${x_pos+crochet} ${y_haut+crochet}, ${x_pos-crochet} ${y_haut+crochet}, ${x_pos} ${y_haut}" fill="none" stroke="${rebar.stirrup}" data-base-stroke="1.4"/>`;
        }

        // Cotations : portée réelle, hauteur, espacement des cadres
        svgContent += drawDimensionLine(x0L, y0L, x0L+wL_px, y0L, `L = ${L_reel.toFixed(2)}`, "m", -46, textColor, textColor);
        svgContent += drawDimensionLine(x0L, y0L, x0L, y0L+hL_px, `h = ${(h*100).toFixed(0)}`, "cm", 34, textColor, textColor);
        if (nb_cadres > 2) {
            svgContent += drawDimensionLine(x0L+c_pxL, y0L+hL_px, x0L+c_pxL+sL_px, y0L+hL_px,
                `s = ${s_cadre_cm.toFixed(0)}`, "cm", 42, textColor, textColor);
        }
        pxParMetre = scaleL;
        maxRatioVue = 3.4;
    }

    svgContent += `</svg>`;
    container.innerHTML = svgContent;

    finalizePlan('svgContainer', {
        titre: AppState.currentView === 'coupe'
            ? `Coupe transversale de la poutre, ${b*100} sur ${h*100} centimètres, ${steelArrangement.nbBarres} barres HA${AppState.selectedDiameter} en partie tendue`
            : `Vue longitudinale de la poutre sur ${AppState.results.inputs.L.toFixed(2)} mètres de portée`,
        pxParMetre: pxParMetre,
        maxRatio: maxRatioVue
    });

    renderPlanLegend([
        { forme: 'dot',  couleur: rebar.main,    texte: 'Aciers longitudinaux' },
        { forme: 'line', couleur: rebar.stirrup, texte: 'Cadres / épingles' },
        { forme: 'dot',  couleur: rebar.montage, texte: 'Aciers de montage' }
    ], [
        `${steelArrangement.nbBarres} HA${AppState.selectedDiameter}`,
        `A<sub>s</sub> = ${steelArrangement.actualSection.toFixed(2)} cm²`,
        `Enrobage ${(AppState.c_enrobage*100).toFixed(1)} cm`
    ]);
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
