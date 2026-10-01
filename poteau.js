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
    inputs: {
        L: 3.0, a: 0.30, b: 0.30, beta: 0.7, fck: 25, fyk: 500, N_Ed: 500, M_Ed: 0,
        enrobage: 3.0, phi_ef: 2.0, exposition: 'XC1', duree100: 0, nb_a: 2, nb_b: 2
    },
    selectedDiameter: 12,
    currentView: 'coupe',
    results: null,
    recommandation: null,
    dispositions: []
};

const poteauInputs = Object.keys(AppState.inputs);

window.addEventListener('DOMContentLoaded', () => {
    lierChamps('poteau_', AppState.inputs, poteauInputs, runController);
    try {
        const savedDiam = parseInt(localStorage.getItem('poteau_diameter'), 10);
        if (STEEL_SPECS[savedDiam]) AppState.selectedDiameter = savedDiam;
    } catch (e) { /* stockage indisponible */ }

    bindEvents();
    updateSteelSelector();
    runController();
});

function bindEvents() {
    document.querySelectorAll('.steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.selectedDiameter = parseInt(e.currentTarget.dataset.diameter, 10);
            try { localStorage.setItem('poteau_diameter', AppState.selectedDiameter); } catch (err) { /* ignoré */ }
            updateSteelSelector();
            runController();
        });
    });
    const btnReco = document.getElementById('applyRecommendation');
    if (btnReco) btnReco.addEventListener('click', appliquerRecommandation);
    window.onThemeChange = () => renderUI();
}

function setView(view) {
    AppState.currentView = view;
    document.getElementById('btnViewCoupe').classList.toggle('active', view === 'coupe');
    document.getElementById('btnViewElev').classList.toggle('active', view === 'elevation');
    const btnNM = document.getElementById('btnViewNM');
    if (btnNM) btnNM.classList.toggle('active', view === 'nm');
    renderUI();
}

function updateSteelSelector() {
    document.querySelectorAll('.steel-btn').forEach(btn => {
        const diam = parseInt(btn.dataset.diameter, 10);
        btn.classList.toggle('active', diam === AppState.selectedDiameter);
    });
}

// =========================================================
// LOGIQUE DE CALCUL EUROCODE 2
// =========================================================

/**
 * Calcul réglementaire du poteau : élancement, second ordre (courbure
 * nominale), diagramme d'interaction N-M. Toute la logique est dans ec2-core.js.
 */
function calculateEurocode2(params) {
    return EC2.poteau(params);
}

/**
 * Plus petite répartition de barres (diamètre sélectionné) vérifiant le
 * diagramme N-M, les sections minimale/maximale et l'espacement libre.
 * Les barres sont ajoutées sur la face où elles sont le plus espacées.
 */
function calculerRecommandation(res) {
    let nbA = 2, nbB = 2;
    for (let i = 0; i < 60; i++) {
        const v = EC2.poteauVerif(res, nbA, nbB);
        if (v.ok) return { nb_a: nbA, nb_b: nbB, nbBarres: v.verif.nbBarres };
        if (!v.okEspacement) return null;
        if (res.inputs.a / nbA >= res.inputs.b / nbB) nbA++; else nbB++;
    }
    return null;
}

function appliquerRecommandation() {
    const reco = AppState.recommandation;
    if (!reco) return;
    AppState.inputs.nb_a = reco.nb_a;
    AppState.inputs.nb_b = reco.nb_b;
    ['nb_a', 'nb_b'].forEach(id => {
        document.getElementById(id).value = AppState.inputs[id];
        try { localStorage.setItem('poteau_' + id, AppState.inputs[id]); } catch (e) { /* ignoré */ }
    });
    runController();
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    const p = AppState.inputs;
    p.nb_a = Math.max(2, Math.round(p.nb_a) || 2);
    p.nb_b = Math.max(2, Math.round(p.nb_b) || 2);
    AppState.results = calculateEurocode2({ ...p, diameter: AppState.selectedDiameter });
    AppState.recommandation = calculerRecommandation(AppState.results);
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    const p = AppState.inputs;
    const q = res.inputs;
    const v = res.verif;
    const fmt = (x, n) => isFinite(x) ? x.toFixed(n) : '—';

    animateValue('res-N_Rd', parseFloat(document.getElementById('res-N_Rd').textContent) || 0, v.NRd, 800, 0);
    animateValue('res-l0', parseFloat(document.getElementById('res-l0').textContent) || 0, res.l0, 800, 2);
    animateValue('res-lambda', parseFloat(document.getElementById('res-lambda').textContent) || 0, res.lambda, 800, 1);
    animateValue('res-As_min', parseFloat(document.getElementById('res-As_min').textContent) || 0, res.As_min, 800, 2);
    document.getElementById('res-M_Rd').textContent = fmt(v.MRd, 1);
    document.getElementById('res-M_Ed_tot').textContent = fmt(v.M_Ed_tot, 1);
    document.getElementById('res-As_calc').textContent = fmt(res.As_req, 2);

    document.getElementById('steelReq').textContent = fmt(res.As_req, 2);
    document.getElementById('steelChosen').textContent = v.As.toFixed(2);
    document.getElementById('nbBarres').textContent = v.nbBarres;
    document.getElementById('diamShow').textContent = AppState.selectedDiameter;
    document.getElementById('spacing').textContent = isFinite(v.espLibre) ? (v.espLibre / 10).toFixed(1) : 'N/A';
    document.getElementById('coverageShow').textContent = q.enrobage.toFixed(1);

    // Recommandation vérifiée par le diagramme d'interaction
    const reco = AppState.recommandation;
    const recElement = document.getElementById('recommendation');
    const btnReco = document.getElementById('applyRecommendation');
    if (reco) {
        const dejaApplique = reco.nb_a === v.nb_a && reco.nb_b === v.nb_b;
        recElement.textContent = `${reco.nbBarres} HA${AppState.selectedDiameter} (${reco.nb_a} par face a × ${reco.nb_b} par face b)`;
        recElement.style.color = dejaApplique ? 'var(--success)' : 'var(--danger)';
        if (btnReco) {
            btnReco.hidden = dejaApplique;
            btnReco.textContent = `Appliquer : ${reco.nb_a} × ${reco.nb_b} HA${AppState.selectedDiameter}`;
        }
    } else {
        recElement.textContent = 'aucune répartition ne convient : augmenter Ø ou la section';
        recElement.style.color = 'var(--danger)';
        if (btnReco) btnReco.hidden = true;
    }

    appliquerVerdict('statusBadge', res.checks, 'Poteau conforme');
    const diagnostics = res.warnings.slice();
    diagnostics.push({
        level: 'info',
        text: "Sous N_Ed = " + q.N_Ed.toFixed(0) + " kN, la section disposée résiste à M_Rd = " +
              fmt(v.MRd, 1) + " kN.m pour M_Ed,tot = " + fmt(v.M_Ed_tot, 1) + " kN.m (taux " +
              fmt(v.tauxM * 100, 0) + " %). Voir la vue « Diagramme N-M »."
    });
    renderWarnings('ec2-warnings', diagnostics);
    renderChecks('checks', res.checks);

    const d = res.dispositions;
    const lignes = [
        ['Enrobage requis', `c_nom ≥ ${(res.enrobage.requis / 10).toFixed(1)} cm (classe ${q.exposition}, S${res.enrobage.cadre.classe})`],
        ['Cadres', `HA8, s ≤ ${Math.floor(d.s_cadres / 10)} cm en partie courante, ${Math.floor(d.s_cadres_reduit / 10)} cm aux abouts et recouvrements (§9.5.3)`],
        ['Recouvrement', `l_0 = ${d.recouvrement.l0.toFixed(0)} mm (barres comprimées, 100 % recouvertes)`],
        ['Second ordre', res.secondOrdre
            ? `e_2 = ${(v.e.e_2 * 1000).toFixed(0)} mm (K_r = ${v.e.K_r.toFixed(2)}, K_φ = ${v.e.K_phi.toFixed(2)})`
            : `négligé (λ = ${res.lambda.toFixed(1)} ≤ λ_lim = ${fmt(res.lambda_lim, 1)})`],
        ['Moment de calcul', `M_Ed,tot = max(M_Ed + N·e_i ; N·e_0) + N·e_2 = ${fmt(v.M_Ed_tot, 1)} kN.m`]
    ];
    AppState.dispositions = lignes;
    renderInfos('dispositions', lignes);

    signalerBornes([
        ['L', p.L, q.L, 'm'], ['a', p.a, q.a, 'm'], ['b', p.b, q.b, 'm'],
        ['N_Ed', p.N_Ed, q.N_Ed, 'kN'], ['M_Ed', p.M_Ed, q.M_Ed, 'kN.m'],
        ['enrobage', p.enrobage, q.enrobage, 'cm'], ['phi_ef', p.phi_ef, q.phi_ef, '']
    ]);

    if (AppState.currentView === 'nm') {
        drawDiagrammeNM();
    } else {
        // Dimensions bornées par ec2-core.js : une saisie nulle donnerait une échelle
        // infinie, un SVG rempli de NaN et une boucle de dessin sans fin.
        generateColumnSVG(q.a, q.b, v.nb_a, v.nb_b, AppState.selectedDiameter, q.enrobage, v.As);
    }
}

// =========================================================
// DIAGRAMME D'INTERACTION N-M
// =========================================================

/**
 * Trace le diagramme d'interaction de la section réellement armée et le
 * point de calcul (M_Ed,tot ; N_Ed). Compression positive vers le haut.
 */
function drawDiagrammeNM() {
    const container = document.getElementById('svgContainer');
    const res = AppState.results;
    const v = res.verif;
    const { textColor } = getThemeColors();
    const rebar = getRebarColors();
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const ok = v.tauxM <= 1 && v.tauxN <= 1;

    const W = 640, H = 520, mg = { g: 70, d: 30, h: 30, b: 50 };
    const pts = v.diagramme.filter(pt => isFinite(pt.N) && isFinite(pt.M));
    const Mmax = Math.max(1, ...pts.map(pt => Math.abs(pt.M)), Math.abs(v.M_Ed_tot)) * 1.15;
    const Nhaut = Math.max(...pts.map(pt => pt.N), res.inputs.N_Ed) * 1.08;
    const Nbas = Math.min(0, ...pts.map(pt => pt.N)) * 1.08;
    const X = (M) => mg.g + (M + Mmax) / (2 * Mmax) * (W - mg.g - mg.d);
    const Y = (N) => mg.h + (Nhaut - N) / (Nhaut - Nbas) * (H - mg.h - mg.b);

    const contour = pts.map(pt => `${X(pt.M).toFixed(1)},${Y(pt.N).toFixed(1)}`)
        .concat(pts.slice().reverse().map(pt => `${X(-pt.M).toFixed(1)},${Y(pt.N).toFixed(1)}`));

    // Graduations arrondies
    const pas = (etendue) => {
        const brut = etendue / 5, p10 = Math.pow(10, Math.floor(Math.log10(brut)));
        return [1, 2, 5, 10].map(k => k * p10).find(k => k >= brut);
    };
    const pasM = pas(Mmax), pasN = pas(Nhaut - Nbas);
    let grille = '';
    for (let m = -Math.floor(Mmax / pasM) * pasM; m <= Mmax; m += pasM) {
        grille += `<line x1="${X(m)}" y1="${mg.h}" x2="${X(m)}" y2="${H - mg.b}" stroke="${textColor}" stroke-opacity="0.12"/>
                   <text x="${X(m)}" y="${H - mg.b + 18}" text-anchor="middle" data-base-size="10" fill="${textColor}">${Math.round(m)}</text>`;
    }
    for (let n = Math.ceil(Nbas / pasN) * pasN; n <= Nhaut; n += pasN) {
        grille += `<line x1="${mg.g}" y1="${Y(n)}" x2="${W - mg.d}" y2="${Y(n)}" stroke="${textColor}" stroke-opacity="0.12"/>
                   <text x="${mg.g - 8}" y="${Y(n) + 4}" text-anchor="end" data-base-size="10" fill="${textColor}">${Math.round(n)}</text>`;
    }

    const couleurPoint = ok ? (dark ? '#4ade80' : '#1e8449') : rebar.main;
    const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">
        ${grille}
        <line x1="${X(0)}" y1="${mg.h}" x2="${X(0)}" y2="${H - mg.b}" stroke="${textColor}" stroke-opacity="0.6"/>
        <line x1="${mg.g}" y1="${Y(0)}" x2="${W - mg.d}" y2="${Y(0)}" stroke="${textColor}" stroke-opacity="0.6"/>
        <polygon points="${contour.join(' ')}" fill="${rebar.stirrup}" fill-opacity="0.15" stroke="${rebar.stirrup}" data-base-stroke="2"/>
        <line x1="${X(0)}" y1="${Y(res.inputs.N_Ed)}" x2="${X(v.M_Ed_tot)}" y2="${Y(res.inputs.N_Ed)}" stroke="${couleurPoint}" stroke-dasharray="4,3" data-base-stroke="1.2"/>
        <circle cx="${X(v.M_Ed_tot)}" cy="${Y(res.inputs.N_Ed)}" r="7" fill="${couleurPoint}"/>
        <text x="${X(v.M_Ed_tot) + 12}" y="${Y(res.inputs.N_Ed) - 10}" data-base-size="11" fill="${textColor}">(${v.M_Ed_tot.toFixed(1)} kN.m ; ${res.inputs.N_Ed.toFixed(0)} kN)</text>
        <text x="${W - mg.d}" y="${H - 8}" text-anchor="end" data-base-size="11" fill="${textColor}">M (kN.m)</text>
        <text x="${mg.g - 50}" y="${mg.h - 10}" data-base-size="11" fill="${textColor}">N (kN, compression +)</text>
    </svg>`;
    container.innerHTML = svg;
    finalizePlan('svgContainer', {
        legende: {
            entrees: [
                { forme: 'box', couleur: rebar.stirrup, texte: 'Domaine résistant N-M de la section' },
                { forme: 'dot', couleur: couleurPoint, texte: ok ? 'Point de calcul (intérieur : vérifié)' : 'Point de calcul (extérieur : non vérifié)' }
            ],
            infos: [`${v.nbBarres} HA${AppState.selectedDiameter}`, `M<sub>Rd</sub> = ${isFinite(v.MRd) ? v.MRd.toFixed(1) : "—"} kN.m`]
        },
        titre: `Diagramme d'interaction effort normal - moment du poteau, point de calcul ${ok ? 'à l\'intérieur' : 'à l\'extérieur'} du domaine résistant`,
        minRatio: 1.0, maxRatio: 1.6
    });
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
        legende: {
            entrees: [
        { forme: 'dot',  couleur: rebar.main,    texte: 'Aciers longitudinaux' },
        { forme: 'line', couleur: rebar.stirrup, texte: 'Cadres / épingles' },
        { forme: 'box',  couleur: concreteFill,  texte: 'Béton' }
    ],
            infos: [
        `${nb_a*2 + Math.max(0, nb_b-2)*2} HA${diameter}`,
        `A<sub>s</sub> = ${As_chosen.toFixed(2)} cm²`,
        `Enrobage ${enrobage.toFixed(1)} cm`
    ]
        },
        titre: AppState.currentView === 'coupe'
            ? `Coupe du poteau, ${(a*100).toFixed(0)} sur ${(b*100).toFixed(0)} centimètres, ${nb_a*2 + Math.max(0, nb_b-2)*2} barres HA${diameter}`
            : `Vue en élévation du poteau sur ${AppState.results.inputs.L.toFixed(2)} mètres de hauteur`,
        pxParMetre: pxParMetre,
        minRatio: AppState.currentView === 'coupe' ? 0.75 : 0.42,
        maxRatio: 2.2
    });
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
                  "Cette valeur ne couvre que la compression centrée ; la flexion composée est vérifiée " +
                  "sur le diagramme d'interaction N-M.";
            break;
        case 'l0': 
            msg = "Longueur efficace de flambement : l₀ = β * L\nDépend des conditions de liaison aux extrémités (articulation, encastrement) selon l'EC2 §5.8.3.2."; 
            break;
        case 'M_Rd':
            msg = "Moment résistant sous N_Ed, lu sur le diagramme d'interaction N-M de la section réellement armée (EC2 §6.1).\n\n" +
                  "Hypothèses : béton en loi parabole-rectangle (ε_c2 = 2 ‰, ε_cu2 = 3.5 ‰), acier élasto-plastique, " +
                  "diagramme des déformations passant par les pivots A, B ou C.\n\n" +
                  "La section est vérifiée si M_Ed,tot ≤ M_Rd(N_Ed), où M_Ed,tot = max(M_Ed + N_Ed·e_i ; N_Ed·e_0) + N_Ed·e_2.";
            break;
        case 'M_Ed_tot':
            msg = "Moment de calcul total (EC2 §5.8.8.2 et §6.1(4)) :\n" +
                  "M_Ed,tot = M_0Ed + M_2\n" +
                  "M_0Ed = max(M_Ed + N_Ed·e_i ; N_Ed·e_0) : imperfections géométriques e_i = θ_i·l₀/2, " +
                  "plancher e_0 = max(h/30 ; 20 mm).\n" +
                  "M_2 = N_Ed·e_2, e_2 = K_r·K_φ·(f_yd/E_s)/(0.45 d)·l₀²/10 (courbure nominale), " +
                  "K_φ = 1 + β·φ_ef ≥ 1 (fluage), K_r ≤ 1 (effort normal élevé).";
            break;
        case 'lambda':
            msg = "Élancement géométrique : λ = l₀ / i\n\n" +
                  "Les effets du second ordre peuvent être négligés tant que λ reste inférieur " +
                  "à l'élancement limite de l'EC2 §5.8.3.1 :\n" +
                  "λ_lim = 20 · A · B · C / √n  avec n = N_Ed / (A_c · f_cd)\n" +
                  "A = 1/(1 + 0.2·φ_ef) (fluage), B = 1.1 et C = 0.7 (valeurs par défaut lorsque le taux " +
                  "d'armatures et le rapport des moments d'extrémité ne sont pas connus).\n\n" +
                  (AppState.results
                      ? "Ici : λ = " + AppState.results.lambda.toFixed(1) +
                        " et λ_lim = " + (isFinite(AppState.results.lambda_lim) ? AppState.results.lambda_lim.toFixed(1) : '∞') + " → " +
                        (AppState.results.secondOrdre
                            ? "effets du second ordre pris en compte."
                            : "effets du second ordre négligeables.")
                      : "");
            break;
        case 'As_min': 
            msg = "Section d'acier minimale réglementaire : A_s,min = max(0.10 * N_Ed / f_yd, 0.002 * A_c)\nExigence minimale de ductilité (EC2 §9.5.2)."; 
            break;
        case 'As_calc': 
            msg = "Section d'acier théorique requise A_s,req : plus petite section, répartie symétriquement sur les deux faces " +
                  "perpendiculaires au plan de flambement, dont le diagramme d'interaction N-M contient le point (M_Ed,tot ; N_Ed), " +
                  "et au moins égale à A_s,min (EC2 §9.5.2).\n\nLa vérification finale porte sur la disposition réelle des barres : " +
                  "des barres intermédiaires sur les faces latérales sont moins efficaces en flexion qu'aux faces extrêmes."; 
            break;
    }
    showModal("Détails réglementaires Eurocode 2", msg);
}

async function exportAsPDF() {
    await generatePDFReport('poteau', 'Poteau en Béton Armé', AppState, 'svgContainer', renderUI, setView, 'coupe', 'note_calcul_poteau.pdf');
}
