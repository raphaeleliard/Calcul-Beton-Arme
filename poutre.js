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
    inputs: {
        L: 5.0, b: 0.25, h: 0.50, G: 15, Q: 10, fck: 25,
        enrobage: 3.0,        // enrobage nominal des cadres (cm)
        poidsPropre: true,    // ajoute b x h x 25 à G
        psi2: 0.3,            // coefficient quasi-permanent de Q (ELS)
        exposition: 'XC1',
        duree100: 0
    },
    selectedDiameter: 20,
    nbBarres: 3,
    currentView: 'coupe',
    results: null,
    recommandation: null,
    dispositions: []
};

const DIAMETRES_POUTRE = [10, 12, 16, 20, 25, 32];
const DIAM_CADRE_MM = 8;

window.addEventListener('DOMContentLoaded', () => {
    lierChamps('poutre_', AppState.inputs, Object.keys(AppState.inputs), runController);

    let premiereVisite = true;
    try {
        const savedDiam = parseInt(localStorage.getItem('poutre_diameter'), 10);
        if (STEEL_SPECS[savedDiam]) AppState.selectedDiameter = savedDiam;
        const savedNb = parseInt(localStorage.getItem('poutre_nbBarres'), 10);
        if (savedNb >= 1) { AppState.nbBarres = savedNb; premiereVisite = false; }
    } catch (e) { /* stockage indisponible */ }
    document.getElementById('nbBarresInput').value = AppState.nbBarres;

    bindEvents();
    updateSteelSelector();
    runController();
    // Première visite : on part d'un ferraillage conforme plutôt que d'un écran rouge
    if (premiereVisite) appliquerRecommandation();
});

function bindEvents() {
    document.getElementById('nbBarresInput').addEventListener('input', (e) => {
        AppState.nbBarres = Math.max(1, parseInt(e.target.value, 10) || 1);
        try { localStorage.setItem('poutre_nbBarres', AppState.nbBarres); } catch (err) { /* ignoré */ }
        runController();
    });

    document.querySelectorAll('.steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.selectedDiameter = parseInt(e.currentTarget.dataset.diameter, 10);
            try { localStorage.setItem('poutre_diameter', AppState.selectedDiameter); } catch (err) { /* ignoré */ }
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
    document.getElementById('btnViewLong').classList.toggle('active', view === 'longitudinale');
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

/** Paramètres transmis au noyau ec2-core.js pour un ferraillage donné. */
function parametresCalcul(diametre, nbBarres) {
    return {
        ...AppState.inputs,
        diameter: diametre,
        phi_t: DIAM_CADRE_MM / 1000,
        nbBarres: nbBarres,
        As_prov: nbBarres * STEEL_SPECS[diametre].section
    };
}

/**
 * Calcul d'une poutre isostatique (ELU, ELS, dispositions constructives).
 * Toute la logique réglementaire est dans ec2-core.js.
 */
function calculateEC2(params) {
    return EC2.poutre(params);
}

/**
 * Plus petit ferraillage sur un lit vérifiant à la fois la section requise
 * et l'espacement libre du §8.2, en partant du diamètre sélectionné puis en
 * augmentant le diamètre si les barres ne tiennent pas sur un lit.
 */
function calculerRecommandation() {
    const res = AppState.results;
    if (!res || res.status === 'ERROR_MUCU') return null;
    const depart = DIAMETRES_POUTRE.indexOf(AppState.selectedDiameter);
    const candidats = DIAMETRES_POUTRE.slice(Math.max(0, depart));
    for (const diam of candidats) {
        const n0 = Math.max(2, Math.ceil(res.As_req / STEEL_SPECS[diam].section));
        for (let n = n0; n <= n0 + 2; n++) {
            const r = calculateEC2(parametresCalcul(diam, n));
            if (r.status === 'ERROR_MUCU') break;
            const okSection = r.As_prov >= r.As_req - 1e-9;
            const okEspace = n === 1 || r.espLibre >= r.espLibreMin;
            if (okSection && okEspace) return { diametre: diam, nbBarres: n };
            if (!okEspace) break;
        }
    }
    return null;
}

function appliquerRecommandation() {
    const reco = AppState.recommandation || calculerRecommandation();
    if (!reco) return;
    AppState.selectedDiameter = reco.diametre;
    AppState.nbBarres = reco.nbBarres;
    document.getElementById('nbBarresInput').value = reco.nbBarres;
    try {
        localStorage.setItem('poutre_diameter', reco.diametre);
        localStorage.setItem('poutre_nbBarres', reco.nbBarres);
    } catch (e) { /* ignoré */ }
    updateSteelSelector();
    runController();
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    AppState.nbBarres = Math.max(1, AppState.nbBarres || 1);
    AppState.results = calculateEC2(parametresCalcul(AppState.selectedDiameter, AppState.nbBarres));
    AppState.recommandation = calculerRecommandation();
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    const p = AppState.inputs;
    const nb = AppState.nbBarres;
    const diam = AppState.selectedDiameter;
    const flexionOK = res.status !== 'ERROR_MUCU';

    // Sollicitations et coefficients mécaniques
    document.getElementById('res-Med').innerText = res.Med.toFixed(2);
    document.getElementById('res-Mu').innerText = isFinite(res.mu_cu) ? res.mu_cu.toFixed(3) : '—';
    document.getElementById('res-Alpha').innerText = flexionOK ? res.alpha.toFixed(3) : '—';
    document.getElementById('res-Ved').innerText = res.Ved.toFixed(1);
    document.getElementById('res-As').innerText = flexionOK ? res.As_req.toFixed(2) : '—';
    document.getElementById('res-Asw').innerText =
        (flexionOK && res.status !== 'ERROR_SHEAR') ? res.Asw_s.toFixed(2) : '—';

    // Recommandation de ferraillage
    const reco = AppState.recommandation;
    const recElement = document.getElementById('recommendation');
    const btnReco = document.getElementById('applyRecommendation');
    if (reco) {
        const dejaApplique = reco.diametre === diam && reco.nbBarres === nb;
        recElement.textContent = `${reco.nbBarres} HA${reco.diametre} sur un lit`;
        recElement.style.color = dejaApplique ? 'var(--success)' : 'var(--danger)';
        if (btnReco) {
            btnReco.hidden = dejaApplique;
            btnReco.textContent = `Appliquer : ${reco.nbBarres} HA${reco.diametre}`;
        }
    } else {
        recElement.textContent = flexionOK
            ? 'aucun ferraillage sur un lit ne convient : élargir la poutre'
            : 'section béton insuffisante';
        recElement.style.color = 'var(--danger)';
        if (btnReco) btnReco.hidden = true;
    }

    document.getElementById('steelReq').innerText = flexionOK ? res.As_req.toFixed(2) : '—';
    document.getElementById('steelChosen').innerText = res.As_prov.toFixed(2);
    document.getElementById('nbBarres').innerText = nb;
    document.getElementById('diamShow').innerText = diam;
    document.getElementById('spacing').innerText = nb > 1 ? (res.espLibre / 10).toFixed(1) : 'N/A';
    document.getElementById('coverageShow').innerText = res.inputs.enrobage.toFixed(1);

    // Verdict unique, partagé avec la note de calcul PDF
    appliquerVerdict('statusBadge', res.checks, 'Poutre conforme');
    renderWarnings('ec2-warnings', res.warnings);
    renderChecks('checks', res.checks);

    // Dispositions constructives et ELS
    const enr = res.enrobage;
    const anc = res.ancrage;
    const lignes = [
        ['Enrobage requis', `c_nom ≥ ${(enr.requis / 10).toFixed(1)} cm (classe ${res.inputs.exposition}, S${enr.cadre.classe})`],
        ['Cadres', res.status === 'ERROR_SHEAR' || !flexionOK ? '—'
            : `HA${DIAM_CADRE_MM} à 2 brins, s ≤ ${Math.floor(res.s_cadre_prop)} cm ` +
              `(A_sw/s = ${res.Asw_s.toFixed(2)} cm²/m, s_l,max = ${res.s_max_cadres.toFixed(0)} cm)`],
        ['Ancrage sur appui', res.status !== 'OK' ? '— (section à redimensionner)'
            : `l_bd = ${anc.appui.lbd.toFixed(0)} mm au-delà du nu d'appui ` +
              `(F_E = ${anc.F_E.toFixed(1)} kN, σ_sd = ${anc.appui.sigma_sd.toFixed(0)} MPa)`],
        ['Recouvrement', `l_0 = ${anc.courant.l0.toFixed(0)} mm (100 % des barres recouvertes, σ_sd = f_yd)`]
    ];
    if (res.els) {
        lignes.push(['ELS quasi-permanent', `σ_s = ${res.els.sigma_s_qp.toFixed(0)} MPa, σ_c = ` +
            `${res.els.sigma_c_qp.toFixed(1)} MPa, w_k = ${res.els.wk.toFixed(2)} mm (ψ_2 = ${res.psi2})`]);
    }
    lignes.push(['Charge permanente de calcul', `G_tot = ${res.G_tot.toFixed(2)} kN/ml` +
        (res.inputs.poidsPropre ? ` (dont poids propre ${res.poidsPropre.toFixed(2)})` : '')]);
    AppState.dispositions = lignes;
    renderInfos('dispositions', lignes);

    // Saisies ramenées dans le domaine de calcul
    signalerBornes([
        ['L', p.L, res.inputs.L, 'm'], ['b', p.b, res.inputs.b, 'm'], ['h', p.h, res.inputs.h, 'm'],
        ['G', p.G, res.inputs.G, 'kN/ml'], ['Q', p.Q, res.inputs.Q, 'kN/ml'],
        ['enrobage', p.enrobage, res.inputs.enrobage, 'cm']
    ]);

    // On dessine avec les dimensions BORNÉES par ec2-core.js : une saisie vide ou
    // nulle produirait sinon une échelle infinie et un SVG rempli de NaN.
    const steelArrangement = { nbBarres: nb, actualSection: res.As_prov };
    drawPoutreSVG(res.inputs.b, res.inputs.h, flexionOK ? res.As_req : 0, steelArrangement, res.espLibre / 10);
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

    const c = AppState.results.inputs.c_nom * scale;
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
        svgContent += drawDimensionLine(x0, y0+h_px, x0+c, y0+h_px, `c=${(AppState.results.inputs.c_nom*100).toFixed(1)}`, "", 15, textColor, textColor);

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
        const c_pxL = AppState.results.inputs.c_nom * scaleL;
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
        legende: {
            entrees: [
        { forme: 'dot',  couleur: rebar.main,    texte: 'Aciers longitudinaux' },
        { forme: 'line', couleur: rebar.stirrup, texte: 'Cadres / épingles' },
        { forme: 'dot',  couleur: rebar.montage, texte: 'Aciers de montage' }
    ],
            infos: [
        `${steelArrangement.nbBarres} HA${AppState.selectedDiameter}`,
        `A<sub>s</sub> = ${steelArrangement.actualSection.toFixed(2)} cm²`,
        `Enrobage ${(AppState.results.inputs.c_nom*100).toFixed(1)} cm`
    ]
        },
        titre: AppState.currentView === 'coupe'
            ? `Coupe transversale de la poutre, ${b*100} sur ${h*100} centimètres, ${steelArrangement.nbBarres} barres HA${AppState.selectedDiameter} en partie tendue`
            : `Vue longitudinale de la poutre sur ${AppState.results.inputs.L.toFixed(2)} mètres de portée`,
        pxParMetre: pxParMetre,
        maxRatio: maxRatioVue
    });
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
            msg = "Moment fléchissant ultime (ELU) : M_ed = (1.35 * G_tot + 1.5 * Q) * L² / 8\nG_tot = G + poids propre b × h × 25 si la case est cochée.\nModèle isostatique d'une poutre sur deux appuis simples supportant des charges uniformément réparties."; 
            break;
        case 'Mu': 
            msg = "Moment ultime réduit : μ_cu = M_ed / (b * d² * f_cd)\nPermet d'évaluer la nécessité d'armatures comprimées (EC2 §3.1.7 et §6.1). Limite μ_lim = 0.372 pour l'acier S500 (au-delà, aciers comprimés nécessaires)."; 
            break;
        case 'Alpha': 
            msg = "Position relative de l'axe neutre : α = 1.25 * (1 - √(1 - 2 * μ_cu))\nDistance y entre la fibre la plus comprimée et l'axe neutre (y = α * d)."; 
            break;
        case 'As': 
            msg = "Section d'acier longitudinal requise : A_s = M_ed / (z * f_yd)\nCalculée avec le bras de levier z des forces internes de flexion (z = d * (1 - 0.4 * α))."; 
            break;
        case 'Ved': 
            msg = "Effort tranchant ultime maximum : V_ed = (1.35 * G_tot + 1.5 * Q) * L / 2\nCalculé à l'axe des appuis (choix conservatif, sans la réduction du §6.2.1(8))."; 
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
