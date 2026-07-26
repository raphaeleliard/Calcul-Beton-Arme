/**
 * =========================================================================
 * Harnais de tests du noyau de calcul Eurocode 2 (ec2-core.js).
 *
 * Le même fichier tourne :
 *   - dans le navigateur, via tests.html
 *   - en ligne de commande, via `node tests-ec2.js`
 *
 * Chaque test vérifie une valeur recalculée à la main à partir du texte
 * de la NF EN 1992-1-1, afin de détecter toute régression du noyau.
 * =========================================================================
 */

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory(require('./ec2-core.js'));
    } else {
        root.EC2Tests = factory(root.EC2);
    }
})(typeof self !== 'undefined' ? self : this, function (EC2) {
    'use strict';

    function buildSuite() {
        const cases = [];

        function check(name, actual, expected, tol) {
            const t = (tol === undefined) ? 0.01 : tol;
            const ok = isFinite(actual) && Math.abs(actual - expected) <= t;
            cases.push({ name: name, expected: expected, actual: actual, passed: ok, kind: 'num' });
        }

        function checkTrue(name, condition, detail) {
            cases.push({
                name: name, expected: 'vrai', actual: condition ? 'vrai' : 'faux',
                passed: !!condition, kind: 'bool', detail: detail || ''
            });
        }

        // =================================================================
        // A. Propriétés des matériaux (EC2 §3.1)
        // =================================================================
        check("f_cd pour C25/30 = 1.0 x 25 / 1.5", EC2.fcd(25), 16.667, 0.001);
        check("f_yd pour S500 = 500 / 1.15", EC2.fyd(500), 434.783, 0.001);
        check("f_ctm pour C25/30 = 0.30 x 25^(2/3)", EC2.fctm(25), 2.565, 0.001);
        check("E_cm pour C25/30 = 22000 x ((25+8)/10)^0.3", EC2.Ecm(25), 31476, 1);
        check("nu_1 pour C25/30 = 0.6 x (1 - 25/250)", EC2.nu1(25), 0.54, 0.0001);
        check("Contrainte acier comprimé S500 plafonnée à E_s x 2 ‰",
            EC2.sigmaSc(500), 400, 0.001);

        // =================================================================
        // B. Flexion simple (EC2 §3.1.7 - diagramme rectangulaire)
        // =================================================================
        // Med = 100 kN.m, b = 0.20 m, d = 0.45 m, C25/30
        // mu = 0.100 / (0.20 x 0.45^2 x 16.667) = 0.14815
        // alpha = 1.25 (1 - sqrt(1 - 2 x 0.148148)) = 0.201412
        // z = 0.45 (1 - 0.4 x 0.20117) = 0.41379 m
        // As = 0.100 / (0.41379 x 434.783) x 10^4 = 5.558 cm2
        const fx = EC2.flexionSimple(100, 0.20, 0.45, 25, 500);
        check("Flexion : moment réduit mu_cu", fx.mu, 0.14815, 0.0001);
        check("Flexion : position relative de l'axe neutre alpha", fx.alpha, 0.201412, 0.0001);
        check("Flexion : bras de levier z (m)", fx.z, 0.41379, 0.0001);
        check("Flexion : section d'acier tendu A_s (cm²)", fx.As, 5.558, 0.01);
        checkTrue("Flexion : mu > 0.372 déclenche le dépassement (aciers comprimés)",
            EC2.flexionSimple(600, 0.20, 0.45, 25, 500).depasse);

        // Non-fragilité §9.2.1.1 : b = 0.20, d = 0.45, C25/30
        // 0.26 x (2.565/500) x 0.20 x 0.45 = 1.2005e-4 m2 = 1.2005 cm2
        // 0.0013 x 0.20 x 0.45 = 1.17e-4 m2 = 1.17 cm2  -> max = 1.2005 cm2
        check("Non-fragilité A_s,min (cm²)", EC2.AsMinFlexion(0.20, 0.45, 25, 500), 1.2005, 0.001);

        // =================================================================
        // C. Effort tranchant sans armatures d'âme (EC2 §6.2.2)
        // =================================================================
        // b = 1.0 m, d = 0.17 m, C25/30, rho = 0.005
        // k = 1 + sqrt(200/170) = 2.0846 -> plafonné à 2.0
        // v_min = 0.035 x 2^1.5 x 5 = 0.4950 MPa
        // v_calc = 0.12 x 2 x (12.5)^(1/3) = 0.24 x 2.32079 = 0.55699 MPa (> v_min)
        // V_Rdc = 0.55699 x 1.0 x 0.17 x 1000 = 94.69 kN
        const v = EC2.VRdc(1.0, 0.17, 25, 0.005, 0);
        check("V_Rd,c : facteur d'échelle k plafonné à 2.0", v.k, 2.0, 0.0001);
        check("V_Rd,c : v_min (MPa)", v.v_min, 0.4950, 0.001);
        check("V_Rd,c : effort résistant (kN/ml)", v.V_Rdc, 94.688, 0.1);
        checkTrue("V_Rd,c : le ratio d'acier est plafonné à 2 %",
            Math.abs(EC2.VRdc(1.0, 0.17, 25, 0.10, 0).rho_l - 0.02) < 1e-9);

        // =================================================================
        // D. Module POUTRE
        // =================================================================
        // L = 5 m, b = 0.20, h = 0.50, G = 15, Q = 10, C25/30, HA10, c = 3 cm
        // p_Ed = 1.35x15 + 1.5x10 = 35.25 kN/ml
        // Med = 35.25 x 25 / 8 = 110.156 kN.m ; Ved = 35.25 x 5 / 2 = 88.125 kN
        // d = 0.50 - 0.03 - 0.008 - 0.005 = 0.457 m
        const pt = EC2.poutre({ L: 5, b: 0.20, h: 0.50, G: 15, Q: 10, fck: 25,
                                diameter: 10, c_nom: 0.03, nbBarres: 3, As_prov: 2.355 });
        check("Poutre : charge ultime p_Ed (kN/ml)", pt.p_elu, 35.25, 0.001);
        check("Poutre : moment M_Ed (kN.m)", pt.Med, 110.156, 0.01);
        check("Poutre : effort tranchant V_Ed (kN)", pt.Ved, 88.125, 0.01);
        check("Poutre : hauteur utile d (m)", pt.d, 0.457, 0.0001);
        checkTrue("Poutre : statut OK sur le cas de référence", pt.status === 'OK');
        checkTrue("Poutre : A_s,req >= A_s,min (non-fragilité respectée)",
            pt.As_req >= pt.As_min - 1e-9);
        checkTrue("Poutre : A_sw/s >= pourcentage minimal §9.2.2",
            pt.Asw_s >= pt.Asw_s_min - 1e-9);
        // rho_w,min = 0.08 x sqrt(25) / 500 = 8.0e-4 -> x 0.20 m x 10^4 = 1.6 cm2/m
        check("Poutre : A_sw/s minimal §9.2.2 (cm²/m)", pt.Asw_s_min, 1.6, 0.001);
        // V_Rd,max(theta=45°) = 1.0 x 0.20 x z x 0.54 x 16.667 / 2 x 1000
        check("Poutre : V_Rd,max à 45° (kN)",
            pt.Vrd_max_45, 0.20 * pt.z * 0.54 * EC2.fcd(25) / 2 * 1000, 0.1);
        checkTrue("Poutre : cot(theta) borné réglementairement entre 1 et 2.5",
            pt.cotTheta >= 1 - 1e-9 && pt.cotTheta <= 2.5 + 1e-9);

        // Section béton manifestement insuffisante -> statut d'erreur
        const ptKO = EC2.poutre({ L: 10, b: 0.15, h: 0.30, G: 40, Q: 30, fck: 20,
                                  diameter: 20, c_nom: 0.03, nbBarres: 3, As_prov: 9.42 });
        checkTrue("Poutre : section trop faible détectée (mu > 0.372)",
            ptKO.status === 'ERROR_MUCU');

        // Effort tranchant faible -> seules les armatures minimales sont exigées
        const ptMin = EC2.poutre({ L: 2, b: 0.30, h: 0.60, G: 5, Q: 2, fck: 25,
                                   diameter: 12, c_nom: 0.03, nbBarres: 3, As_prov: 3.39 });
        checkTrue("Poutre : V_Ed <= V_Rd,c => armatures d'âme minimales (§6.2.1(5))",
            ptMin.cisaillementMinimal === true &&
            Math.abs(ptMin.Asw_s - ptMin.Asw_s_min) < 1e-9);

        // Robustesse : données absurdes -> pas de NaN propagé
        const ptZero = EC2.poutre({ L: 0, b: 0, h: 0, G: -5, Q: NaN, fck: 0,
                                    diameter: 0, c_nom: 0, nbBarres: 0 });
        checkTrue("Poutre : entrées nulles/négatives ne produisent pas de NaN",
            isFinite(ptZero.Med) && isFinite(ptZero.Ved) && isFinite(ptZero.d));

        // =================================================================
        // E. Module DALLE
        // =================================================================
        // L = 4 m, h = 0.20, G = 6, Q = 2.5, C25/30, c = 3 cm, HA10 esp. 15
        // p_Ed = 1.35x6 + 1.5x2.5 = 11.85 kN/m2
        // Med = 11.85 x 16 / 8 = 23.70 kN.m/ml ; Ved = 11.85 x 4 / 2 = 23.70 kN/ml
        // d = 0.20 - 0.03 - 0.005 = 0.165 m
        const dl = EC2.dalle({ L: 4, h: 0.20, G: 6, Q: 2.5, fck: 25, enrobage: 3,
                               espacementInput: 15, espRepInput: 20,
                               diamMain: 10, diamRep: 8,
                               sectionMain: 0.785, sectionRep: 0.503 });
        check("Dalle : charge ultime p_Ed (kN/m²)", dl.p_elu, 11.85, 0.001);
        check("Dalle : moment M_Ed (kN.m/ml)", dl.Med, 23.70, 0.01);
        check("Dalle : hauteur utile d (m)", dl.d, 0.165, 0.0001);
        // As_prov = 0.785 x (100/15) = 5.233 cm2/ml
        check("Dalle : section principale fournie (cm²/ml)", dl.As_prov, 5.2333, 0.001);
        // §9.3.1.1(2) : As,rep = 20 % des aciers principaux fournis, SANS plancher de non-fragilité
        check("Dalle : aciers de répartition = 20 % des principaux (§9.3.1.1)",
            dl.As_rep_req, 0.20 * dl.As_prov, 0.0001);
        check("Dalle : espacement maximal principal min(3h ; 40 cm)", dl.s_max_main, 40, 0.001);
        check("Dalle : espacement maximal répartition min(3.5h ; 45 cm)", dl.s_max_rep, 45, 0.001);
        checkTrue("Dalle : statut OK sur le cas de référence", dl.status === 'OK');

        // Espacement nul saisi par l'utilisateur -> pas d'infini
        const dlZero = EC2.dalle({ L: 4, h: 0.20, G: 6, Q: 2.5, fck: 25, enrobage: 3,
                                   espacementInput: 0, espRepInput: 0,
                                   diamMain: 10, diamRep: 8 });
        checkTrue("Dalle : espacement nul borné (pas de division par zéro)",
            isFinite(dlZero.As_prov) && dlZero.As_prov > 0);

        // Dalle très élancée -> le critère de flèche doit se déclencher
        const dlFleche = EC2.dalle({ L: 8, h: 0.16, G: 5, Q: 1.5, fck: 25, enrobage: 3,
                                     espacementInput: 10, espRepInput: 20,
                                     diamMain: 12, diamRep: 8,
                                     sectionMain: 1.131, sectionRep: 0.503 });
        checkTrue("Dalle : élancement L/d excessif détecté (§7.4.2)",
            dlFleche.fleche.ok === false);

        // =================================================================
        // F. Module POTEAU
        // =================================================================
        // a = b = 0.30, L = 3, beta = 1.0, C25/30, S500
        // l0 = 3.0 ; i = 0.30/sqrt(12) = 0.086603 ; lambda = 34.641
        // Ac = 900 cm2 ; N_Rd,c = 900 x 16.667/10 = 1500 kN
        const po = EC2.poteau({ L: 3.0, a: 0.30, b: 0.30, beta: 1.0, fck: 25, fyk: 500,
                                N_Ed: 1000, M_Ed: 0, enrobage: 3.0, diameter: 12 });
        check("Poteau : longueur de flambement l0 (m)", po.l0, 3.0, 0.001);
        check("Poteau : rayon de giration i (m)", po.i_gyr, 0.086603, 0.00001);
        check("Poteau : élancement lambda", po.lambda, 34.641, 0.01);
        check("Poteau : résistance du béton seul N_Rd,c (kN)", po.N_Rd_c, 1500, 0.5);
        // As_min = max(0.10 x 1000 / 43.478 ; 0.002 x 900) = max(2.30 ; 1.80) = 2.30 cm2
        check("Poteau : A_s,min §9.5.2 (cm²)", po.As_min, 2.3, 0.01);
        check("Poteau : A_s,max = 4 % A_c (cm²)", po.As_max, 36, 0.001);
        // n = 1000 / (0.09 x 16.667 x 1000) = 0.6667 ; lambda_lim = 10.78 / sqrt(0.6667) = 13.20
        check("Poteau : effort normal réduit n", po.n_rel, 0.66667, 0.0001);
        check("Poteau : élancement limite §5.8.3.1", po.lambda_lim, 13.203, 0.01);
        checkTrue("Poteau : lambda > lambda_lim => second ordre pris en compte",
            po.secondOrdre === true && po.e_2 > 0);
        // La hauteur utile doit être prise dans le plan de flambement (axe faible)
        // d = 0.30 - 0.03 - 0.008 - 0.006 = 0.256 m
        check("Poteau : hauteur utile d dans le plan de flambement (m)", po.d, 0.256, 0.0001);
        // e_0,min = max(h/30 ; 20 mm) = max(10 mm ; 20 mm) = 20 mm
        check("Poteau : excentricité minimale e_0 (m)", po.e_0_min, 0.02, 0.0001);
        // N_Rd avec 4 HA12 = 4 x 1.131 = 4.524 cm2 ; N_Rd = 1500 + 4.524 x 40 = 1680.96 kN
        check("Poteau : N_Rd avec aciers comprimés plafonnés à 400 MPa (kN)",
            EC2.poteauNRd(po, 4.524), 1680.96, 0.1);

        // Poteau rectangulaire : le flambement doit se faire sur le petit côté
        const poRect = EC2.poteau({ L: 3.0, a: 0.60, b: 0.20, beta: 1.0, fck: 25, fyk: 500,
                                    N_Ed: 800, M_Ed: 0, enrobage: 3.0, diameter: 12 });
        check("Poteau rectangulaire : d calculé sur la plus petite dimension (m)",
            poRect.d, 0.20 - 0.03 - 0.008 - 0.006, 0.0001);
        check("Poteau rectangulaire : i calculé sur la plus petite dimension (m)",
            poRect.i_gyr, 0.20 / Math.sqrt(12), 0.00001);

        // =================================================================
        // G. Module VOILE
        // =================================================================
        // h = 0.20 m, C25/30, ST25C 2 nappes
        // Ac = 2000 cm2/ml ; As,v,min = 0.002 x 2000 = 4.0 cm2/ml
        const vo = EC2.voile({ h: 0.20, fck: 25, N_Ed: 300, V_Ed: 40, enrobage: 3,
                               nappesCount: 2, tsDiam: 7, tsSection: 2.57, tsSectionT: 1.28 });
        check("Voile : section de béton A_c (cm²/ml)", vo.Ac, 2000, 0.1);
        check("Voile : armatures verticales minimales §9.6.2 (cm²/ml)", vo.As_vmin, 4.0, 0.001);
        // sigma_cp = 300 / (0.20 x 1000) = 1.5 MPa (< 0.2 x 16.667 = 3.33 MPa)
        check("Voile : contrainte moyenne de compression (MPa)", vo.sigma_cp, 1.5, 0.001);
        // As,h,min = max(0.25 x 5.14 ; 0.001 x 2000) = max(1.285 ; 2.0) = 2.0 cm2/ml
        check("Voile : armatures horizontales minimales §9.6.3 (cm²/ml)", vo.As_hmin, 2.0, 0.001);
        checkTrue("Voile : la section horizontale du treillis est distinguée de la verticale",
            Math.abs(vo.As_h_prov - 2.56) < 1e-9 && Math.abs(vo.As_v_prov - 5.14) < 1e-9);
        // N_Rd = 0.20 x 16.667 x 1000 + 5.14 x 40 = 3333.3 + 205.6 = 3538.9 kN/ml
        check("Voile : effort normal résistant N_Rd (kN/ml)", vo.N_Rd, 3538.9, 0.5);
        checkTrue("Voile : effort normal excessif détecté",
            EC2.voile({ h: 0.20, fck: 25, N_Ed: 9000, V_Ed: 10, enrobage: 3, nappesCount: 2,
                        tsDiam: 7, tsSection: 2.57, tsSectionT: 1.28 }).status === 'ERROR_AXIAL');

        // =================================================================
        // H. Module SEMELLE ISOLÉE
        // =================================================================
        // A = B = 1.50 m, a = b = 0.30 m, h = 0.40 m, c = 4 cm, HA12
        // Poids = 1.5 x 1.5 x 0.4 x 25 = 22.5 kN
        // sigma_sol = (430 + 22.5) / (2.25 x 1000) = 0.20111 MPa
        const si = EC2.semelleIsolee({ a: 0.30, b: 0.30, A: 1.50, B: 1.50, h: 0.40, fck: 25,
                                       q_adm: 0.25, N_Ed: 600, N_Eq: 430, enrobage: 4,
                                       diamA: 12, diamB: 12, sectionA: 1.131, sectionB: 1.131 });
        check("Semelle isolée : poids propre (kN)", si.poidsPropre, 22.5, 0.001);
        check("Semelle isolée : contrainte sur le sol à l'ELS (MPa)", si.sigma_sol, 0.20111, 0.0001);
        check("Semelle isolée : hauteur utile nappe inférieure d_A (m)", si.d_A, 0.354, 0.0001);
        check("Semelle isolée : hauteur utile nappe supérieure d_B (m)", si.d_B, 0.342, 0.0001);
        check("Semelle isolée : hauteur utile requise (A-a)/4 (m)", si.d_req, 0.30, 0.0001);
        // As,A = 600 x (1.50-0.30) / (8 x 0.354 x 434.783) x 10 = 5.8476 cm2
        check("Semelle isolée : A_s // A par la méthode des bielles (cm²)",
            si.As_A_req_calc, 5.8476, 0.001);
        checkTrue("Semelle isolée : alias 'weight' présent pour la note de calcul PDF",
            typeof si.weight === 'number' && si.weight === si.poidsPropre);
        checkTrue("Semelle isolée : le poinçonnement est vérifié", !!si.poinconnement);
        checkTrue("Semelle isolée : cas de référence non poinçonné", si.poinconnement.ok === true);
        // Semelle trop mince sous forte charge -> poinçonnement mis en défaut
        const siKO = EC2.semelleIsolee({ a: 0.30, b: 0.30, A: 2.60, B: 2.60, h: 0.22, fck: 25,
                                         q_adm: 0.60, N_Ed: 2500, N_Eq: 1800, enrobage: 4,
                                         diamA: 12, diamB: 12, sectionA: 1.131, sectionB: 1.131 });
        checkTrue("Semelle isolée : poinçonnement détecté sur semelle mince",
            siKO.poinconnement.ok === false);

        // =================================================================
        // I. Module SEMELLE FILANTE
        // =================================================================
        // B = 1.00, a = 0.20, h = 0.30, c = 4 cm, HA12
        // Poids = 1.0 x 0.30 x 25 = 7.5 kN/ml
        // sigma_sol = (250 + 7.5) / 1000 = 0.2575 MPa
        const sf = EC2.semelleFilante({ a: 0.20, B: 1.00, h: 0.30, fck: 25, q_adm: 0.25,
                                        N_Ed: 350, N_Eq: 250, enrobage: 4,
                                        espMain: 15, espRep: 20, diamMain: 12, diamRep: 8,
                                        sectionMain: 1.131, sectionRep: 0.503 });
        check("Semelle filante : poids propre (kN/ml)", sf.poidsPropre, 7.5, 0.001);
        check("Semelle filante : contrainte sur le sol (MPa)", sf.sigma_sol, 0.2575, 0.0001);
        checkTrue("Semelle filante : dépassement de portance détecté",
            sf.status === 'ERROR_BEARING');
        check("Semelle filante : hauteur utile d (m)", sf.d, 0.254, 0.0001);
        // As = 350 x (1.00-0.20) / (8 x 0.254 x 434.783) x 10 = 3.1697 cm2/ml
        check("Semelle filante : A_s par la méthode des bielles (cm²/ml)",
            sf.As_req_calc, 3.1697, 0.001);
        check("Semelle filante : aciers de répartition = 20 % du principal",
            sf.As_rep_req, 0.20 * sf.As_req, 0.0001);
        checkTrue("Semelle filante : l'effort tranchant est vérifié",
            isFinite(sf.V_Ed) && isFinite(sf.V_Rdc));

        // =================================================================
        // J. Cohérence transverse : aucun module ne doit renvoyer de NaN
        // =================================================================
        const modules = {
            poutre: pt, dalle: dl, poteau: po, voile: vo,
            semelleIsolee: si, semelleFilante: sf
        };
        Object.keys(modules).forEach(function (name) {
            const res = modules[name];
            const bad = Object.keys(res).filter(function (key) {
                const val = res[key];
                return typeof val === 'number' && !isFinite(val);
            });
            checkTrue("Aucune valeur non finie renvoyée par le module « " + name + " »",
                bad.length === 0, bad.join(', '));
        });

        return cases;
    }

    return { run: buildSuite };
});

// Exécution directe en ligne de commande : `node tests-ec2.js`
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const suite = module.exports.run();
    let failed = 0;
    suite.forEach(function (t) {
        if (!t.passed) failed++;
        const state = t.passed ? 'PASS' : 'FAIL';
        const detail = t.kind === 'num'
            ? ' (attendu ' + t.expected + ', obtenu ' + t.actual + ')'
            : (t.passed ? '' : ' (' + (t.detail || '') + ')');
        if (!t.passed || process.env.VERBOSE) {
            console.log('[' + state + '] ' + t.name + detail);
        }
    });
    console.log('\n' + (suite.length - failed) + ' / ' + suite.length + ' tests réussis.');
    process.exit(failed > 0 ? 1 : 0);
}
