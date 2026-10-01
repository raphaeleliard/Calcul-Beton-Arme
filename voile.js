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
    inputs: {
        h: 0.20, L_w: 2.70, beta_w: 1.0, fck: 25, N_Ed: 300, V_Ed: 40, phi_ef: 2.0,
        enrobage: 3.0, nappesCount: 2, exposition: 'XC1', duree100: 0
    },
    selectedTS: 'ST25C',
    currentView: 'coupe',
    results: null,
    dispositions: []
};

const voileInputs = Object.keys(AppState.inputs);

window.addEventListener('DOMContentLoaded', () => {
    lierChamps('voile_', AppState.inputs, voileInputs, runController);
    try {
        const savedTS = localStorage.getItem('voile_ts');
        if (savedTS && TS_SPECS[savedTS]) AppState.selectedTS = savedTS;
    } catch (e) { /* stockage indisponible */ }

    bindEvents();
    updateTSSelector();
    runController();
});

function bindEvents() {
    document.querySelectorAll('.steel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            AppState.selectedTS = e.currentTarget.dataset.ts;
            try { localStorage.setItem('voile_ts', AppState.selectedTS); } catch (err) { /* ignoré */ }
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

// =========================================================
// LOGIQUE DE CALCUL EUROCODE 2
// =========================================================

/**
 * Vérification d'une bande de voile de 1 m : compression excentrée,
 * flambement hors plan, effort tranchant, armatures minimales.
 * La logique réglementaire est centralisée dans ec2-core.js.
 */
function calculateEurocode2(params) {
    const ts = TS_SPECS[params.selectedTS];
    return EC2.voile({
        ...params,
        tsDiam: ts.diam,
        tsSection: ts.section,     // cm²/ml dans le sens porteur (fils verticaux)
        tsSectionT: ts.section_t,  // cm²/ml dans le sens transversal (fils horizontaux)
        tsEsp: ts.esp
    });
}

// =========================================================
// CONTRÔLEUR DE L'INTERFACE UTILISATEUR (UI)
// =========================================================

function runController() {
    AppState.results = calculateEurocode2({ ...AppState.inputs, selectedTS: AppState.selectedTS });
    renderUI();
}

function renderUI() {
    const res = AppState.results;
    const p = AppState.inputs;
    const q = res.inputs;

    document.getElementById('res-sigma').innerText = res.sigma_cp_calc.toFixed(2);
    document.getElementById('res-NRd').innerText = res.N_Rd.toFixed(0);
    document.getElementById('res-Vrdc').innerText = res.V_Rdc.toFixed(1);
    document.getElementById('res-lambda').innerText = res.lambda.toFixed(1);
    document.getElementById('res-As_v').innerText = res.As_vmin.toFixed(2);
    document.getElementById('res-As_h').innerText = res.As_hmin.toFixed(2);

    document.getElementById('tsUnit').innerText = TS_SPECS[AppState.selectedTS].section.toFixed(2);
    document.getElementById('steelReq').innerText = res.As_req.toFixed(2);
    document.getElementById('steelChosen').innerText = res.As_prov.toFixed(2);

    appliquerVerdict('statusBadge', res.checks, 'Voile conforme');
    renderWarnings('ec2-warnings', res.warnings);
    renderChecks('checks', res.checks);

    const lignes = [
        ['Enrobage requis', `c_nom ≥ ${(res.enrobage.requis / 10).toFixed(1)} cm (classe ${q.exposition}, S${res.enrobage.detail.classe})`],
        ['Flambement', `l_0 = ${res.l0.toFixed(2)} m, λ = ${res.lambda.toFixed(1)} ` +
            (res.secondOrdre ? `> λ_lim = ${res.lambda_lim.toFixed(1)} (e_2 = ${(res.e_2 * 1000).toFixed(0)} mm)`
                             : `≤ λ_lim = ${isFinite(res.lambda_lim) ? res.lambda_lim.toFixed(1) : '∞'}`)],
        ['Excentricité de calcul', `e = max(e_i ; e_0) + e_2 = ${(res.e_tot * 1000).toFixed(0)} mm ` +
            `(e_i = ${(res.e_i * 1000).toFixed(1)} mm, e_0 = ${(res.e_0_min * 1000).toFixed(0)} mm)`],
        ['Résistance', `N_Rd = ${res.N_Rd.toFixed(0)} kN/ml sous e, ${res.N_Rd0.toFixed(0)} kN/ml en compression centrée`],
        ['Treillis', `${AppState.selectedTS} : ${res.As_v_prov.toFixed(2)} cm²/ml vertical, ${res.As_h_prov.toFixed(2)} cm²/ml horizontal`]
    ];
    AppState.dispositions = lignes;
    renderInfos('dispositions', lignes);

    signalerBornes([
        ['h', p.h, q.h, 'm'], ['L_w', p.L_w, q.L_w, 'm'], ['N_Ed', p.N_Ed, q.N_Ed, 'kN/ml'],
        ['V_Ed', p.V_Ed, q.V_Ed, 'kN/ml'], ['enrobage', p.enrobage, q.enrobage, 'cm'],
        ['phi_ef', p.phi_ef, q.phi_ef, '']
    ]);

    drawSVG();
}

// =========================================================
// DESSIN DU PLAN DE FERRAILLAGE (SVG)
// =========================================================

function drawSVG() {
    const container = document.getElementById('svgContainer');
    const { textColor, concreteFill, concreteStroke } = getThemeColors();
    const rebar = getRebarColors();
    
    // Entrées bornées par ec2-core.js : une saisie vide ou nulle donnerait une
    // échelle infinie, un SVG rempli de NaN et des boucles de dessin sans fin.
    const p = AppState.results.inputs;
    const res = AppState.results;
    const tsData = TS_SPECS[AppState.selectedTS];
    
    const h = p.h;
    const c_nom = p.enrobage / 100;
    
    const svgSize = 800;
    const margin = 120;
    const w_m = 1.0; 
    const maxDim = Math.max(w_m, h);
    const scale = (svgSize - 2 * margin) / maxDim;
    let pxParMetre = scale;   // échelle de la vue active, transmise à finalizePlan
    
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
        const nb_points = Math.min(Math.floor(w_px / esp_ts), 200);
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
            svgContent += `<line x1="${x0}" y1="${ny}" x2="${x0+w_px}" y2="${ny}" stroke="${rebar.main}" stroke-width="${strokeW}" stroke-linecap="round"/>`;
            for(let i=0; i<=nb_points; i++) {
                const nx = x0 + offset_x + (i * esp_ts);
                svgContent += `<circle cx="${nx}" cy="${ny}" r="${r_bar}" fill="${rebar.main}"/>`;
            }
        });

        // Épingles de maintien transversales (liaisons de nappe à nappe)
        if (p.nappesCount === 2) {
            const epingleW = Math.max(strokeW * 0.8, 2);
            for(let i=1; i<nb_points; i+=2) {
                const nx = x0 + offset_x + (i * esp_ts);
                svgContent += `<line x1="${nx}" y1="${nappesY[0]}" x2="${nx}" y2="${nappesY[1]}" stroke="${rebar.stirrup}" stroke-width="${epingleW}" stroke-linecap="round"/>`;
                svgContent += `<path d="M ${nx} ${nappesY[0]} C ${nx+15} ${nappesY[0]+15}, ${nx-15} ${nappesY[0]+15}, ${nx} ${nappesY[0]}" fill="none" stroke="${rebar.stirrup}" stroke-width="${epingleW}" stroke-linecap="round" stroke-linejoin="round"/>`;
                svgContent += `<path d="M ${nx} ${nappesY[1]} C ${nx-15} ${nappesY[1]-15}, ${nx+15} ${nappesY[1]-15}, ${nx} ${nappesY[1]}" fill="none" stroke="${rebar.stirrup}" stroke-width="${epingleW}" stroke-linecap="round" stroke-linejoin="round"/>`;
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
        pxParMetre = scaleF;
        const wF_px = maxDimF * scaleF;
        const hF_px = maxDimF * scaleF;
        const xF = (svgSize - wF_px) / 2 - 20;
        const yF = (svgSize - hF_px) / 2;

        svgContent += `<rect x="${xF}" y="${yF}" width="${wF_px}" height="${hF_px}" fill="${concreteFill}" stroke="${concreteStroke}" stroke-width="2"/>`;
        
        const esp_ts_F = (tsData.esp / 1000) * scaleF;
        const nb_lines = Math.min(Math.floor(wF_px / esp_ts_F), 200);
        
        // Fils verticaux et horizontaux du treillis
        for(let i=1; i<nb_lines; i++) {
            svgContent += `<line x1="${xF + i*esp_ts_F}" y1="${yF}" x2="${xF + i*esp_ts_F}" y2="${yF+hF_px}" stroke="${rebar.main}" stroke-width="${strokeW}" stroke-linecap="round"/>`;
            svgContent += `<line x1="${xF}" y1="${yF + i*esp_ts_F}" x2="${xF+wF_px}" y2="${yF + i*esp_ts_F}" stroke="${rebar.main}" stroke-width="${strokeW}" stroke-linecap="round"/>`;
        }

        // Cotations
        svgContent += drawDimensionLine(xF, yF, xF+wF_px, yF, "Bande = 1.00", "m", -30, textColor, textColor);
        if (nb_lines > 2) {
            svgContent += drawDimensionLine(xF+esp_ts_F, yF+hF_px, xF+2*esp_ts_F, yF+hF_px, `Maille ${tsData.esp}`, "mm", 30, textColor, textColor);
        }
    }


    svgContent += '</svg>';
    container.innerHTML = svgContent;

    finalizePlan('svgContainer', {
        legende: {
            entrees: [
        { forme: 'line', couleur: rebar.main,    texte: 'Treillis soudé' },
        { forme: 'line', couleur: rebar.stirrup, texte: 'Épingles de liaison' }
    ],
            infos: [
        `${AppState.selectedTS} en ${p.nappesCount} nappe(s)`,
        `A<sub>s</sub> vertical : ${res.As_v_prov.toFixed(2)} cm²/ml`,
        `A<sub>s</sub> horizontal : ${res.As_h_prov.toFixed(2)} cm²/ml`
    ]
        },
        titre: AppState.currentView === 'coupe'
            ? `Coupe d'une bande de voile d'un mètre, épaisseur ${(p.h*100).toFixed(0)} centimètres, ${p.nappesCount} nappe de treillis ${AppState.selectedTS}`
            : `Vue de face du treillis soudé ${AppState.selectedTS} sur un mètre carré de voile`,
        pxParMetre: pxParMetre,
        maxRatio: 2.8
    });
}

// =========================================================
// MODULES PÉDAGOGIQUES ET EXPORTATIONS
// =========================================================

function showFormula(type) {
    let msg = "";
    switch(type) {
        case 'sigma_cp': 
            msg = "Contrainte normale moyenne de compression : σ_cp = N_Ed / A_c\nSa contribution à V_Rd,c (terme k₁·σ_cp) est plafonnée à σ_cp ≤ 0.2·f_cd (EC2 §6.2.2(1)).";
            break;
        case 'N_Rd':
            msg = "Effort normal résistant sous l'excentricité de calcul e (EC2 §5.8 et §6.1) :\n" +
                  "e = max(e_i ; e_0) + e_2, avec e_i = θ_i·l₀/2 (imperfections), e_0 = max(h/30 ; 20 mm) " +
                  "(excentricité minimale) et e_2 l'excentricité du second ordre (courbure nominale).\n\n" +
                  "N_Rd est le plus grand effort normal tel que N·e reste dans le diagramme d'interaction N-M " +
                  "de la bande de 1 m armée de ses deux nappes de treillis.";
            break;
        case 'lambda':
            msg = "Élancement hors plan : λ = l₀·√12 / h, avec l₀ = β·l_w (hauteur libre du voile).\n" +
                  "Au-delà de λ_lim = 20·A·B·C/√n (EC2 §5.8.3.1), le second ordre est pris en compte.";
            break;
        case 'V_Rdc': 
            msg = "Effort tranchant résistant (béton seul, EC2 §6.2.2) :\nV_Rd,c = max[C_Rd,c·k·(100·ρ_l·f_ck)^(1/3) ; v_min] · b·d + k₁·σ_cp·b·d\nv_min = 0.35/γ_c·√f_ck pour un voile (AN française).";
            break;
        case 'vmin': 
            msg = "Résistance minimale au cisaillement d'un voile (Annexe Nationale française) : v_min = 0.35 / γ_c · f_ck^(1/2)";
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
