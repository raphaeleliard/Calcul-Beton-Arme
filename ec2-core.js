/**
 * =========================================================================
 * Projet      : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
 * Auteur      : Raphaël ELIARD
 * Fichier     : ec2-core.js
 * Description : Noyau de calcul réglementaire (NF EN 1992-1-1 + Annexe
 *               Nationale française). Ce fichier ne contient QUE des
 *               fonctions pures : aucune dépendance au DOM, aucun état
 *               global. Il est utilisable dans le navigateur (global EC2)
 *               comme dans Node.js (module.exports) pour les tests.
 *
 * Domaine de validité : bétons de classe <= C50/60 (les coefficients
 * lambda = 0.8 et eta = 1.0 du diagramme rectangulaire, la loi
 * parabole-rectangle à eps_c2 = 2 ‰ / eps_cu2 = 3.5 ‰ et la relation
 * fctm = 0.30*fck^(2/3) ne sont valables que dans ce domaine).
 *
 * Chaque module renvoie, en plus de ses résultats numériques :
 *   - warnings : diagnostics textuels (info / warn / error) ;
 *   - checks   : la liste exhaustive des vérifications menées, chacune
 *                avec sa valeur requise, sa valeur obtenue et son verdict.
 *                L'écran ET la note de calcul PDF tirent leur conclusion de
 *                cette seule liste : ils ne peuvent plus se contredire.
 * =========================================================================
 */

const EC2 = (function () {
    'use strict';

    // =====================================================================
    // 1. CONSTANTES RÉGLEMENTAIRES
    // =====================================================================

    const MAT = {
        gammaC: 1.5,      // Coefficient partiel béton, situations durables (Tab. 2.1N)
        gammaS: 1.15,     // Coefficient partiel acier, situations durables (Tab. 2.1N)
        alphaCc: 1.0,     // Effets long terme sur la compression (§3.1.6, AN française)
        alphaCt: 1.0,     // Effets long terme sur la traction (§3.1.6(2))
        alphaCw: 1.0,     // Coefficient d'état de contrainte des bielles (§6.2.3)
        fyk: 500,         // Acier S500 (§3.2)
        Es: 200000,       // Module d'élasticité de l'acier (MPa)
        epsC2: 0.002,     // Raccourcissement au pic, loi parabole-rectangle (Tab. 3.1)
        epsCu2: 0.0035,   // Raccourcissement ultime du béton (Tab. 3.1, fck <= 50)
        epsUd: 0.045,     // Allongement limite de l'acier classe B : 0.9 x eps_uk (§3.2.7)
        gammaBeton: 25,   // Poids volumique du béton armé (kN/m³)
        fckMax: 50,       // Limite du domaine de validité des formules employées
        alphaE: 15        // Coefficient d'équivalence acier/béton à l'ELS (fluage inclus)
    };

    // Limite du moment réduit pour l'acier S500 sans armatures comprimées :
    // l'acier tendu atteint tout juste f_yd quand le béton atteint eps_cu = 3.5 ‰.
    // mu_lim = 0.8*alpha_lim*(1-0.4*alpha_lim), alpha_lim = 3.5/(3.5+2.17) = 0.617
    const MU_LIMIT = 0.372;
    // Moment réduit correspondant à x/d = 0.45 (limite usuelle de ductilité, §5.5)
    const MU_DUCTILE = 0.295;

    // =====================================================================
    // 2. PROPRIÉTÉS DES MATÉRIAUX
    // =====================================================================

    const fcd = (fck) => (MAT.alphaCc * fck) / MAT.gammaC;
    const fyd = (fyk) => (fyk || MAT.fyk) / MAT.gammaS;
    /** Résistance moyenne en traction directe (Tab. 3.1, valable <= C50/60) */
    const fctm = (fck) => 0.30 * Math.pow(fck, 2 / 3);
    /** Résistance caractéristique en traction, fractile 5 % (Tab. 3.1) */
    const fctk005 = (fck) => 0.7 * fctm(fck);
    /** Module sécant du béton (Tab. 3.1) */
    const Ecm = (fck) => 22000 * Math.pow((fck + 8) / 10, 0.3);
    /** Facteur de réduction de résistance du béton fissuré à l'effort tranchant (§6.2.2(6)) */
    const nu1 = (fck) => 0.6 * (1 - fck / 250);
    /**
     * Contrainte maximale mobilisable dans un acier COMPRIMÉ en compression
     * centrée : le raccourcissement est plafonné à eps_c2 = 2 ‰, l'acier ne
     * peut donc pas dépasser Es * eps_c2 = 400 MPa pour du S500 (§6.1).
     */
    const sigmaSc = (fyk) => Math.min(fyd(fyk), MAT.Es * MAT.epsC2);

    /** Section d'une barre de diamètre phi (mm), en cm². */
    const sectionBarre = (phi) => Math.PI * Math.pow(phi / 10, 2) / 4;

    // =====================================================================
    // 3. OUTILS DE VALIDATION DES DONNÉES D'ENTRÉE
    // =====================================================================

    /** Renvoie une valeur numérique finie bornée, ou la valeur de repli. */
    function num(value, fallback, min, max) {
        let v = parseFloat(value);
        if (!isFinite(v)) v = fallback;
        if (min !== undefined && v < min) v = min;
        if (max !== undefined && v > max) v = max;
        return v;
    }

    /** Ajoute un message de diagnostic à la liste des avertissements. */
    function push(list, level, text) {
        list.push({ level: level, text: text });
        return list;
    }

    /**
     * Ajoute une vérification à la liste des contrôles du module.
     * grave = true : critère de résistance ou exigence réglementaire (rouge) ;
     * grave = false : critère de service ou de bonne pratique (orange).
     */
    function addCheck(list, label, ref, requis, obtenu, ok, grave) {
        list.push({
            label: label, ref: ref, requis: requis, obtenu: obtenu,
            ok: !!ok, grave: grave !== false
        });
        return list;
    }

    /**
     * Verdict global d'une liste de vérifications.
     * @returns {{niveau:'ok'|'warn'|'error', echec:object|null, nbErreurs:number, nbAlertes:number}}
     */
    function verdict(checks) {
        const erreurs = (checks || []).filter(c => !c.ok && c.grave);
        const alertes = (checks || []).filter(c => !c.ok && !c.grave);
        return {
            niveau: erreurs.length ? 'error' : (alertes.length ? 'warn' : 'ok'),
            echec: erreurs[0] || alertes[0] || null,
            nbErreurs: erreurs.length,
            nbAlertes: alertes.length
        };
    }

    const f2 = (v, n) => (isFinite(v) ? v.toFixed(n === undefined ? 2 : n) : '—');

    // =====================================================================
    // 4. DURABILITÉ — ENROBAGE NOMINAL (§4.4.1)
    // =====================================================================

    // Tableau 4.4N : c_min,dur (mm) pour les armatures de béton armé.
    // Colonnes : X0 | XC1 | XC2-XC3 | XC4 | XD1-XS1 | XD2-XS2 | XD3-XS3
    const TAB_4_4N = {
        1: [10, 10, 10, 15, 20, 25, 30],
        2: [10, 10, 15, 20, 25, 30, 35],
        3: [10, 10, 20, 25, 30, 35, 40],
        4: [10, 15, 25, 30, 35, 40, 45],
        5: [15, 20, 30, 35, 40, 45, 50],
        6: [20, 25, 35, 40, 45, 50, 55]
    };
    // Colonne du tableau 4.4N et classe de résistance minimale ouvrant droit
    // à la minoration d'une classe structurale (Tableau 4.3N).
    const EXPOSITIONS = {
        X0:  { col: 0, fckMin: 30, texte: 'Aucun risque de corrosion' },
        XC1: { col: 1, fckMin: 30, texte: 'Sec ou humide en permanence (intérieur)' },
        XC2: { col: 2, fckMin: 35, texte: 'Humide, rarement sec (fondations)' },
        XC3: { col: 2, fckMin: 35, texte: 'Humidité modérée (extérieur abrité)' },
        XC4: { col: 3, fckMin: 40, texte: 'Alternance humidité/séchage (extérieur)' },
        XD1: { col: 4, fckMin: 40, texte: 'Chlorures, humidité modérée' },
        XD2: { col: 5, fckMin: 40, texte: 'Chlorures, humide (piscines)' },
        XD3: { col: 6, fckMin: 45, texte: 'Chlorures, alternance (parkings)' },
        XS1: { col: 4, fckMin: 40, texte: 'Air marin' },
        XS2: { col: 5, fckMin: 45, texte: 'Immergé en eau de mer' },
        XS3: { col: 6, fckMin: 45, texte: 'Marnage, embruns' }
    };

    /**
     * Enrobage nominal requis c_nom = c_min + Δc_dev (§4.4.1).
     * Classe structurale de référence S4 (50 ans), modulée selon le
     * Tableau 4.3N : +2 pour 100 ans, -1 si la classe de béton est
     * suffisante, -1 pour un élément de type dalle.
     * @param {object} o {exposition, fck, phi (mm), dalle, duree100, dcDev (mm), contactSol}
     *        contactSol : 'non' | 'proprete' (béton de propreté) | 'sol' (coulé contre le sol)
     * @returns {{classe:number, c_min_dur:number, c_min_b:number, c_min:number, c_nom:number}} mm
     */
    function enrobageNominal(o) {
        const expo = EXPOSITIONS[o.exposition] ? o.exposition : 'XC1';
        const e = EXPOSITIONS[expo];
        let classe = 4;
        if (o.duree100) classe += 2;
        if ((o.fck || 0) >= e.fckMin) classe -= 1;
        if (o.dalle) classe -= 1;
        classe = Math.min(6, Math.max(1, classe));
        const c_min_dur = TAB_4_4N[classe][e.col];
        const c_min_b = num(o.phi, 10, 0, 50);
        let c_min = Math.max(c_min_b, c_min_dur, 10);
        // §4.4.1.3(4) : béton coulé au contact d'un sol (valeurs recommandées k1, k2)
        if (o.contactSol === 'proprete') c_min = Math.max(c_min, 40);
        if (o.contactSol === 'sol') c_min = Math.max(c_min, 75);
        const dcDev = num(o.dcDev, 10, 0, 20);
        return {
            exposition: expo, classe: classe, c_min_dur: c_min_dur, c_min_b: c_min_b,
            c_min: c_min, dc_dev: dcDev, c_nom: c_min + dcDev
        };
    }

    // =====================================================================
    // 5. ANCRAGES ET RECOUVREMENTS (§8.4 et §8.7)
    // =====================================================================

    /**
     * Longueurs d'ancrage et de recouvrement d'une barre droite.
     * Hypothèses conservatives : alpha_3 = alpha_4 = alpha_5 = 1 (on néglige
     * l'effet favorable des armatures transversales et de la pression).
     * @param {object} o {phi (mm), fck, fyk, sigma_sd (MPa, défaut f_yd),
     *        bonneAdherence (défaut vrai), compression, cd (mm, enrobage ou
     *        demi-espacement libre), pctRecouvre (% de barres recouvertes, défaut 100)}
     * @returns {object} longueurs en mm, f_bd en MPa
     */
    function ancrage(o) {
        const phi = num(o.phi, 12, 4, 50);
        const fck = num(o.fck, 25, 12, MAT.fckMax);
        const fydV = fyd(o.fyk);
        const sigma = Math.max(0, Math.min(num(o.sigma_sd, fydV, 0, 1000), fydV));
        const eta1 = o.bonneAdherence === false ? 0.7 : 1.0;
        const eta2 = phi <= 32 ? 1.0 : (132 - phi) / 100;
        const fctd = MAT.alphaCt * fctk005(fck) / MAT.gammaC;
        const fbd = 2.25 * eta1 * eta2 * fctd;                  // §8.4.2(2)
        const lb_rqd = (phi / 4) * (sigma / fbd);               // §8.4.3(2)
        const comp = !!o.compression;
        // alpha_2 : effet de l'enrobage, barre droite tendue (Tab. 8.2)
        const cd = num(o.cd, phi, 0, 500);
        const alpha2 = comp ? 1.0 : Math.min(1.0, Math.max(0.7, 1 - 0.15 * (cd - phi) / phi));
        const lb_min = Math.max((comp ? 0.6 : 0.3) * lb_rqd, 10 * phi, 100);
        const lbd = Math.max(alpha2 * lb_rqd, lb_min);          // §8.4.4(1)
        // alpha_6 : proportion de barres recouvertes dans une même section (Tab. 8.3)
        const pct = num(o.pctRecouvre, 100, 0, 100);
        const alpha6 = Math.min(1.5, Math.max(1.0, Math.sqrt(pct / 25)));
        const l0_min = Math.max(0.3 * alpha6 * lb_rqd, 15 * phi, 200);
        const l0 = Math.max(alpha2 * alpha6 * lb_rqd, l0_min); // §8.7.3(1)
        return {
            phi: phi, sigma_sd: sigma, eta1: eta1, eta2: eta2, fctd: fctd, fbd: fbd,
            lb_rqd: lb_rqd, alpha2: alpha2, lb_min: lb_min, lbd: lbd,
            alpha6: alpha6, l0_min: l0_min, l0: l0
        };
    }

    // =====================================================================
    // 6. VÉRIFICATIONS RÉGLEMENTAIRES ÉLÉMENTAIRES
    // =====================================================================

    /**
     * Flexion simple à l'ELU, section rectangulaire, diagramme rectangulaire
     * simplifié (§3.1.7(3)) — valable pour fck <= 50 MPa.
     * @returns {{mu:number, alpha:number, z:number, As:number, depasse:boolean}}
     *          As en cm² (b et d en m, Med en kN.m)
     */
    function flexionSimple(Med, b, d, fck, fykVal) {
        const fcdV = fcd(fck);
        const fydV = fyd(fykVal);
        if (!(b > 0) || !(d > 0)) {
            return { mu: NaN, alpha: 0, z: 0, As: 0, depasse: true };
        }
        const mu = (Med / 1000) / (b * d * d * fcdV);
        if (!(mu >= 0)) {
            return { mu: mu, alpha: 0, z: 0, As: 0, depasse: true };
        }
        if (mu > MU_LIMIT) {
            // Aciers comprimés nécessaires : hors du domaine traité par l'outil.
            return { mu: mu, alpha: 0, z: d * (1 - 0.4 * 0.617), As: 0, depasse: true };
        }
        const alpha = 1.25 * (1 - Math.sqrt(1 - 2 * mu));
        const z = d * (1 - 0.4 * alpha);
        const As = ((Med / 1000) / (z * fydV)) * 10000; // cm²
        return { mu: mu, alpha: alpha, z: z, As: As, depasse: false };
    }

    /**
     * Section minimale de non-fragilité des zones tendues (§9.2.1.1(1)).
     * @param {number} bt largeur moyenne de la zone tendue (m)
     * @returns {number} cm²
     */
    function AsMinFlexion(bt, d, fck, fykVal) {
        if (!(bt > 0) || !(d > 0)) return 0;
        const f = fykVal || MAT.fyk;
        return Math.max(0.26 * (fctm(fck) / f) * bt * d, 0.0013 * bt * d) * 10000;
    }

    /**
     * Contrainte de cisaillement minimale v_min (§6.2.2(1), Annexe Nationale
     * française) :
     *   - poutres, dalles sans redistribution transversale, semelles :
     *     0.053/γc · k^1.5 · fck^0.5
     *   - voiles : 0.35/γc · fck^0.5
     * La valeur dalle « avec redistribution transversale » (0.34/γc·fck^0.5)
     * n'est volontairement pas retenue : sous charge répartie, une bande de
     * dalle portant dans un seul sens n'en bénéficie pas.
     */
    function vMin(k, fck, type) {
        if (type === 'voile') return (0.35 / MAT.gammaC) * Math.sqrt(fck);
        return (0.053 / MAT.gammaC) * Math.pow(k, 1.5) * Math.sqrt(fck);
    }

    /**
     * Effort tranchant résistant sans armatures d'effort tranchant (§6.2.2(1)).
     * @param {number} b largeur (m), @param {number} d hauteur utile (m)
     * @param {number} rho_l ratio d'armatures tendues (sans dimension)
     * @param {number} sigma_cp contrainte moyenne de compression (MPa, >= 0)
     * @param {string} type 'poutre' (défaut), 'dalle', 'semelle' ou 'voile' (choix de v_min)
     * @returns {{V_Rdc:number, v_Rdc:number, v_min:number, k:number, rho_l:number}}
     *          V_Rdc en kN
     */
    function VRdc(b, d, fck, rho_l, sigma_cp, type) {
        const scp = Math.max(0, sigma_cp || 0);
        if (!(b > 0) || !(d > 0)) {
            return { V_Rdc: 0, v_Rdc: 0, v_min: 0, k: 0, rho_l: 0, V_Rdc_calc: 0, V_Rdc_min: 0 };
        }
        const k = Math.min(1 + Math.sqrt(200 / (d * 1000)), 2.0);
        const rho = Math.min(Math.max(rho_l || 0, 0), 0.02);
        const C_Rdc = 0.18 / MAT.gammaC;
        const k1 = 0.15; // Annexe Nationale française
        const v_min = vMin(k, fck, type);
        const v_calc = C_Rdc * k * Math.pow(100 * rho * fck, 1 / 3) + k1 * scp;
        const v_floor = v_min + k1 * scp;
        const v = Math.max(v_calc, v_floor);
        return {
            k: k,
            rho_l: rho,
            v_min: v_min,
            v_Rdc: v,
            V_Rdc_calc: v_calc * b * d * 1000,
            V_Rdc_min: v_floor * b * d * 1000,
            V_Rdc: v * b * d * 1000 // kN
        };
    }

    /**
     * Élancement limite (rapport portée/hauteur utile) permettant de se
     * dispenser du calcul explicite de la flèche — §7.4.2(2), expressions
     * (7.16a) et (7.16b), corrigées de la contrainte réelle de l'acier.
     * La correction 310/σs = (500/fyk)·(As,prov/As,req) n'est appliquée que
     * si la section fournie couvre la section requise : sinon la section est
     * de toute façon refusée, et une « limite » abaissée n'aurait pas de sens.
     * @returns {{limite:number, reel:number, ok:boolean}}
     */
    function elancementFleche(L, d, fck, rho, K, AsReq, AsProv, fykVal) {
        const f = fykVal || MAT.fyk;
        if (!(d > 0) || !(rho > 0)) return { limite: 0, reel: Infinity, ok: false };
        const rho0 = Math.sqrt(fck) / 1000;
        let base;
        if (rho <= rho0) {
            base = 11 + 1.5 * Math.sqrt(fck) * (rho0 / rho)
                 + 3.2 * Math.sqrt(fck) * Math.pow(rho0 / rho - 1, 1.5);
        } else {
            // Pas d'armatures comprimées prises en compte (rho' = 0)
            base = 11 + 1.5 * Math.sqrt(fck) * (rho0 / rho);
        }
        let corr = 500 / f;
        if (AsReq > 0 && AsProv >= AsReq) {
            corr = Math.min(1.5, (500 / f) * (AsProv / AsReq));
        }
        const limite = (K || 1.0) * base * corr;
        const reel = L / d;
        return { limite: limite, reel: reel, ok: reel <= limite };
    }

    /**
     * Espacement libre minimal entre barres parallèles (§8.2(2)).
     * @param {number} phi diamètre des barres (mm)
     * @param {number} dg dimension du plus gros granulat (mm)
     * @returns {number} espacement libre minimal (mm)
     */
    function espacementLibreMin(phi, dg) {
        return Math.max(phi, (dg || 20) + 5, 20);
    }

    // =====================================================================
    // 7. ÉTATS LIMITES DE SERVICE — CONTRAINTES ET FISSURATION (§7.2, §7.3)
    // =====================================================================

    /**
     * Section rectangulaire fissurée, armatures tendues seules, béton tendu
     * négligé : position de l'axe neutre et inertie (unités : m, m⁴).
     */
    function sectionFissuree(b, d, As_m2, alphaE) {
        if (!(As_m2 > 0) || !(d > 0) || !(b > 0)) return { x: 0, I: 0 };
        const aE = alphaE || MAT.alphaE;
        const rho = As_m2 / (b * d);
        const x = d * aE * rho * (-1 + Math.sqrt(1 + 2 / (aE * rho)));
        const I = b * Math.pow(x, 3) / 3 + aE * As_m2 * Math.pow(d - x, 2);
        return { x: x, I: I };
    }

    /**
     * Vérifications ELS d'une section rectangulaire fléchie.
     * @param {object} o {b, h, d (m), As (cm²), phi (mm), c (mm, enrobage des barres
     *        tendues), s (mm, entraxe des barres), M_car, M_qp (kN.m), fck, fyk, exposition}
     */
    function verifELS(o) {
        const aE = MAT.alphaE;
        const As_m2 = (o.As || 0) / 10000;
        const sec = sectionFissuree(o.b, o.d, As_m2, aE);
        if (!(sec.I > 0)) return null;
        const fyk = o.fyk || MAT.fyk;
        const sig = (M) => ({
            s: aE * (Math.max(0, M) / 1000) * (o.d - sec.x) / sec.I,
            c: (Math.max(0, M) / 1000) * sec.x / sec.I
        });
        const car = sig(o.M_car);
        const qp = sig(o.M_qp);

        // Ouverture des fissures sous combinaison quasi-permanente (§7.3.4)
        const hcef = Math.max(1e-4, Math.min(2.5 * (o.h - o.d), (o.h - sec.x) / 3, o.h / 2));
        const rhoEff = As_m2 / (o.b * hcef);
        const fct = fctm(o.fck);
        const aEs = MAT.Es / Ecm(o.fck);
        const kt = 0.4; // chargement de longue durée
        const de = Math.max(
            (qp.s - kt * (fct / rhoEff) * (1 + aEs * rhoEff)) / MAT.Es,
            0.6 * qp.s / MAT.Es
        );
        const limiteEspacement = 5 * (o.c + o.phi / 2);
        const sr = (o.s > limiteEspacement)
            ? 1.3 * (o.h - sec.x) * 1000
            : 3.4 * o.c + 0.8 * 0.5 * 0.425 * o.phi / rhoEff;
        const wk = sr * de; // mm
        const expo = o.exposition || 'XC1';
        // Tableau 7.1N (valeurs recommandées, béton armé, combinaison quasi-permanente)
        const wmax = (expo === 'X0' || expo === 'XC1') ? 0.4 : 0.3;
        const chlorures = /^X[DS]/.test(expo);

        return {
            x: sec.x, I: sec.I,
            sigma_s_car: car.s, sigma_c_car: car.c,
            sigma_s_qp: qp.s, sigma_c_qp: qp.c,
            sigma_s_lim: 0.8 * fyk,                 // §7.2(5)
            sigma_c_car_lim: 0.6 * o.fck,           // §7.2(2), XD/XS/XF seulement
            sigma_c_qp_lim: 0.45 * o.fck,           // §7.2(3), fluage linéaire
            controleSigmaCcar: chlorures,
            hc_ef: hcef, rho_eff: rhoEff, sr_max: sr, deps: de, wk: wk, wmax: wmax
        };
    }

    /** Ajoute aux contrôles d'un élément fléchi les vérifications ELS. */
    function checksELS(checks, els) {
        if (!els) return;
        addCheck(checks, 'Contrainte de l\'acier à l\'ELS caractéristique', '§7.2(5)',
            'σs ≤ ' + f2(els.sigma_s_lim, 0) + ' MPa', f2(els.sigma_s_car, 0) + ' MPa',
            els.sigma_s_car <= els.sigma_s_lim, true);
        addCheck(checks, 'Compression du béton à l\'ELS quasi-permanent', '§7.2(3)',
            'σc ≤ ' + f2(els.sigma_c_qp_lim, 1) + ' MPa', f2(els.sigma_c_qp, 1) + ' MPa',
            els.sigma_c_qp <= els.sigma_c_qp_lim, false);
        if (els.controleSigmaCcar) {
            addCheck(checks, 'Compression du béton à l\'ELS caractéristique', '§7.2(2)',
                'σc ≤ ' + f2(els.sigma_c_car_lim, 1) + ' MPa', f2(els.sigma_c_car, 1) + ' MPa',
                els.sigma_c_car <= els.sigma_c_car_lim, false);
        }
        addCheck(checks, 'Ouverture des fissures (quasi-permanent)', '§7.3.4',
            'w_k ≤ ' + f2(els.wmax, 1) + ' mm', f2(els.wk, 2) + ' mm', els.wk <= els.wmax, false);
    }

    // =====================================================================
    // 8. FLEXION COMPOSÉE — DIAGRAMME D'INTERACTION N-M (§6.1)
    // =====================================================================

    /**
     * Analyse d'une section rectangulaire de béton armé en flexion composée,
     * par compatibilité des déformations (§6.1) :
     *   - béton : loi parabole-rectangle (§3.1.7(1)), eps_c2 = 2 ‰, eps_cu2 = 3.5 ‰ ;
     *   - acier : loi élasto-plastique à palier horizontal (§3.2.7(2) b) ;
     *   - diagramme des déformations limité par les pivots A (eps_ud), B
     *     (eps_cu2) et C (eps_c2 au point situé à 3/7 h de la fibre la plus
     *     comprimée, §6.1(5)).
     * Convention : compression positive, M > 0 comprime la fibre supérieure,
     * moments calculés au centre géométrique de la section.
     * @param {number} b largeur (m)  @param {number} h hauteur dans le plan de flexion (m)
     * @param {Array<{As:number, y:number}>} lits lits d'armatures : As en cm², y en m depuis la fibre supérieure
     */
    function sectionNM(b, h, lits, fck, fykVal) {
        const fcdV = fcd(fck);
        const fydV = fyd(fykVal);
        const Es = MAT.Es, ec2 = MAT.epsC2, ecu2 = MAT.epsCu2, eud = MAT.epsUd;
        const couches = (lits || []).filter(l => l.As > 0);
        const ds = couches.length ? Math.max.apply(null, couches.map(l => l.y)) : h;
        const yC = (1 - ec2 / ecu2) * h;
        const NS = 100; // tranches d'intégration du béton
        const dy = h / NS;

        const sigmaC = (e) => {
            if (e <= 0) return 0;
            if (e < ec2) return fcdV * (1 - Math.pow(1 - e / ec2, 2));
            return fcdV;
        };
        const sigmaS = (e) => Math.max(-fydV, Math.min(fydV, Es * e));

        // Paramètre s ∈ [0, 3] : 0 = traction pure (pivot A), 3 = compression centrée.
        function deformee(s) {
            if (s <= 1) {
                const et = -eud + s * (eud + ecu2);
                return (y) => et + (-eud - et) * (y / ds);
            }
            if (s <= 2) {
                const eh0 = ecu2 + (-eud - ecu2) * h / ds;
                const eh = eh0 * (2 - s);
                return (y) => ecu2 + (eh - ecu2) * (y / h);
            }
            const et = ecu2 - (s - 2) * (ecu2 - ec2);
            return (y) => ec2 + (et - ec2) * (yC - y) / yC;
        }

        function efforts(s) {
            const eps = deformee(s);
            let N = 0, M = 0;
            for (let i = 0; i < NS; i++) {
                const y = (i + 0.5) * dy;
                const F = sigmaC(eps(y)) * b * dy;
                N += F; M += F * (h / 2 - y);
            }
            for (const l of couches) {
                const F = sigmaS(eps(l.y)) * l.As / 10000;
                N += F; M += F * (h / 2 - l.y);
            }
            return { N: N * 1000, M: M * 1000 }; // kN, kN.m
        }

        const Nmax = efforts(3).N;
        const Nmin = efforts(0).N;

        /** Moment résistant sous l'effort normal N (kN) ; -Infinity hors domaine. */
        function MRd(N) {
            if (!(N <= Nmax) || !(N >= Nmin)) return -Infinity;
            let lo = 0, hi = 3;
            for (let i = 0; i < 60; i++) {
                const m = (lo + hi) / 2;
                if (efforts(m).N < N) lo = m; else hi = m;
            }
            return efforts((lo + hi) / 2).M;
        }

        /** Points (N, M) du diagramme d'interaction (branche M >= 0). */
        function diagramme(nb) {
            const n = nb || 60;
            const pts = [];
            for (let i = 0; i <= n; i++) pts.push(efforts(3 * i / n));
            return pts;
        }

        return { Nmax: Nmax, Nmin: Nmin, MRd: MRd, diagramme: diagramme, efforts: efforts };
    }

    /**
     * Excentricités et moment de calcul d'un élément comprimé élancé
     * (§5.2, §5.8.3.1, §5.8.8, §6.1(4)) — méthode de la courbure nominale.
     * @param {object} o {N_Ed (kN), M_Ed (kN.m, premier ordre), L (m, longueur de
     *        l'élément), l0 (m), h (m, dans le plan de flexion), d (m), Ac_m2, fck,
     *        fyk, phi_ef, As (cm², pour K_r), lambda}
     */
    function momentSecondOrdre(o) {
        const fcdV = fcd(o.fck);
        const fydV = fyd(o.fyk);
        const n = o.N_Ed / (o.Ac_m2 * fcdV * 1000);
        // §5.8.3.1 : A = 1/(1 + 0.2 φ_ef), B = 1.1 (ω inconnu), C = 0.7 (r_m inconnu)
        const A = 1 / (1 + 0.2 * o.phi_ef);
        const lambda_lim = n > 0 ? (20 * A * 1.1 * 0.7) / Math.sqrt(n) : Infinity;
        // Imperfections géométriques §5.2(7) : e_i = θ_i·l0/2, θ_i = θ0·α_h, θ0 = 1/200
        const alpha_h = Math.min(1, Math.max(2 / 3, 2 / Math.sqrt(Math.max(o.L, 0.01))));
        const e_i = (1 / 200) * alpha_h * o.l0 / 2;
        // Excentricité minimale §6.1(4) : plancher du moment du premier ordre
        const e_0_min = Math.max(o.h / 30, 0.02);
        const M_0Ed = Math.max(Math.abs(o.M_Ed) + o.N_Ed * e_i, o.N_Ed * e_0_min);

        let e_2 = 0, K_r = 1, K_phi = 1, beta_phi = 0;
        const secondOrdre = o.lambda > lambda_lim;
        if (secondOrdre && o.d > 0) {
            // §5.8.8.3 : K_r = (n_u - n)/(n_u - n_bal) <= 1, n_u = 1 + ω, n_bal = 0.4
            const omega = (o.As / 10000) * fydV / (o.Ac_m2 * fcdV);
            const n_u = 1 + omega;
            K_r = Math.min(1, Math.max(0, (n_u - n) / (n_u - 0.4)));
            // §5.8.8.3(4) : K_φ = 1 + β·φ_ef >= 1, β = 0.35 + fck/200 - λ/150
            beta_phi = 0.35 + o.fck / 200 - o.lambda / 150;
            K_phi = Math.max(1, 1 + beta_phi * o.phi_ef);
            const courbure = K_r * K_phi * (fydV / MAT.Es) / (0.45 * o.d);
            e_2 = courbure * o.l0 * o.l0 / 10; // c = 10 ≈ π² (section constante)
        }
        const M_2 = o.N_Ed * e_2;
        return {
            n_rel: n, A_lim: A, lambda_lim: lambda_lim, secondOrdre: secondOrdre,
            alpha_h: alpha_h, e_i: e_i, e_0_min: e_0_min,
            M_0Ed: M_0Ed, e_2: e_2, M_2: M_2, M_Ed_tot: M_0Ed + M_2,
            K_r: K_r, K_phi: K_phi, beta_phi: beta_phi
        };
    }

    // =====================================================================
    // 9. MODULE POUTRE — flexion simple + effort tranchant (ELU) + ELS
    // =====================================================================

    /**
     * @param {object} raw {L, b, h, G, Q, fck, diameter, c_nom (m) ou enrobage (cm),
     *        phi_t, nbBarres, As_prov, poidsPropre, psi2, exposition, duree100}
     */
    function poutre(raw) {
        const w = [];
        const checks = [];
        const L = num(raw.L, 5, 0.5, 100);
        const b = num(raw.b, 0.2, 0.05, 10);
        const h = num(raw.h, 0.5, 0.05, 10);
        const G = num(raw.G, 0, 0, 1e6);
        const Q = num(raw.Q, 0, 0, 1e6);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const diam = num(raw.diameter, 10, 6, 40);
        const phi_l = diam / 1000;
        const phi_t = num(raw.phi_t, 0.008, 0.004, 0.02);
        const c_nom = raw.enrobage !== undefined
            ? num(raw.enrobage, 3, 1, 20) / 100
            : num(raw.c_nom, 0.03, 0.01, 0.20);
        const nbBarres = Math.max(1, Math.round(num(raw.nbBarres, 1, 1, 60)));
        const psi2 = num(raw.psi2, 0.3, 0, 1);
        const exposition = EXPOSITIONS[raw.exposition] ? raw.exposition : 'XC1';
        const avecPoidsPropre = !!raw.poidsPropre;

        const fcdV = fcd(fck);
        const fydV = fyd(MAT.fyk);
        const fyd_cm2 = fydV / 10;

        // --- Charges (poutre isostatique sur deux appuis simples) ---
        const poidsPropre = b * h * MAT.gammaBeton;
        const G_tot = G + (avecPoidsPropre ? poidsPropre : 0);
        const p_elu = 1.35 * G_tot + 1.5 * Q;
        const Med = (p_elu * L * L) / 8;
        const Ved = (p_elu * L) / 2;
        const M_car = (G_tot + Q) * L * L / 8;
        const M_qp = (G_tot + psi2 * Q) * L * L / 8;

        // --- Hauteur utile ---
        const d = h - c_nom - phi_t - phi_l / 2;
        if (d <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage et les diamètres d'aciers " +
                "dépassent la hauteur h de la poutre.");
        }

        // --- Flexion simple ---
        const fx = flexionSimple(Med, b, d, fck, MAT.fyk);
        const As_min = AsMinFlexion(b, d, fck, MAT.fyk);
        const As_max = 0.04 * b * h * 10000; // §9.2.1.1(3)
        const As_prov = raw.As_prov !== undefined
            ? num(raw.As_prov, 0, 0, 1e6) : nbBarres * sectionBarre(diam);

        let status = 'OK';
        let As_req = 0;
        if (fx.depasse) {
            status = 'ERROR_MUCU';
            push(w, 'error', "μ_cu = " + f2(fx.mu, 3) + " > " + MU_LIMIT +
                " : la section béton est insuffisante, il faudrait des " +
                "armatures comprimées (cas non traité par l'outil).");
        } else {
            As_req = Math.max(fx.As, As_min);
            if (fx.mu > MU_DUCTILE) {
                push(w, 'warn', "μ_cu = " + fx.mu.toFixed(3) + " > " + MU_DUCTILE +
                    " (x/d > 0.45) : la section reste calculable mais sa ductilité est faible. " +
                    "Augmenter h est préférable (EC2 §5.5).");
            }
        }
        const z = fx.z;

        // --- Effort tranchant (§6.2) ---
        const nu = nu1(fck);
        const Vrd_max_45 = (MAT.alphaCw * b * z * nu * fcdV) / 2 * 1000; // kN
        const rho_l = (b > 0 && d > 0) ? Math.min((As_prov / 10000) / (b * d), 0.02) : 0;
        const vrdc = VRdc(b, d, fck, rho_l, 0, 'poutre');
        const Ved_d = Math.max(0, p_elu * (L / 2 - d));

        // Pourcentage minimal d'armatures d'âme (§9.2.2(5))
        const rho_w_min = (0.08 * Math.sqrt(fck)) / MAT.fyk;
        const Asw_s_min = rho_w_min * b * 10000; // cm²/m

        let cotTheta = 2.5;
        let Asw_s = Asw_s_min;
        let cisaillementMinimal = false;

        if (status !== 'ERROR_MUCU') {
            if (Ved > Vrd_max_45) {
                status = 'ERROR_SHEAR';
                push(w, 'error', "V_Ed = " + Ved.toFixed(1) + " kN > V_Rd,max = " +
                    Vrd_max_45.toFixed(1) + " kN : rupture des bielles de béton comprimé. " +
                    "Augmenter b ou h (EC2 §6.2.3(3)).");
            } else if (Ved <= vrdc.V_Rdc) {
                cisaillementMinimal = true;
                Asw_s = Asw_s_min;
                push(w, 'info', "V_Ed = " + Ved.toFixed(1) + " kN ≤ V_Rd,c = " + vrdc.V_Rdc.toFixed(1) +
                    " kN : seules les armatures d'âme minimales sont requises (EC2 §6.2.1(5) et §9.2.2).");
            } else {
                // Bielle la plus inclinée possible : minimise la section de cadres.
                const contrainte_max = MAT.alphaCw * b * z * nu * fcdV * 1000;
                const sin2theta = (2 * Ved) / contrainte_max;
                if (sin2theta < 1) {
                    const thetaRad = 0.5 * Math.asin(sin2theta);
                    cotTheta = Math.max(1.0, Math.min(2.5, 1 / Math.tan(thetaRad)));
                } else {
                    cotTheta = 1.0;
                }
                const Asw_s_calc = Ved / (z * fyd_cm2 * cotTheta);
                Asw_s = Math.max(Asw_s_calc, Asw_s_min);
            }
        }

        // Espacements maximaux des cadres : longitudinal §9.2.2(6), transversal §9.2.2(8)
        const s_max_cadres = 0.75 * d * 100;                     // cm (cadres verticaux)
        const s_t_max = Math.min(0.75 * d, 0.6) * 100;           // cm, entre brins
        const ecartBrins = (b - 2 * c_nom - phi_t) * 100;        // cm, cadre à 2 brins
        const Asw_cadre = 2 * sectionBarre(phi_t * 1000);        // cm², 2 brins
        const s_cadre_prop = Asw_s > 0
            ? Math.min((Asw_cadre / Asw_s) * 100, s_max_cadres) : s_max_cadres;

        // --- Flèche (§7.4.2) : poutre isostatique => K = 1.0 ---
        const rho_fleche = (b > 0 && d > 0) ? (As_req / 10000) / (b * d) : 0;
        const fleche = elancementFleche(L, d, fck, rho_fleche, 1.0, As_req, As_prov, MAT.fyk);

        // --- Encombrement des barres sur un seul lit (§8.2) ---
        const dispo_mm = (b - 2 * c_nom - 2 * phi_t) * 1000;
        const espLibre = nbBarres > 1
            ? (dispo_mm - nbBarres * diam) / (nbBarres - 1)
            : dispo_mm - diam;
        const espLibreMin = espacementLibreMin(diam, 20);
        const entraxe = nbBarres > 1 ? espLibre + diam : dispo_mm;

        // --- ELS : contraintes et fissuration (§7.2, §7.3) ---
        const els = (status === 'OK' && As_prov > 0) ? verifELS({
            b: b, h: h, d: d, As: As_prov, phi: diam, c: (c_nom + phi_t) * 1000,
            s: entraxe, M_car: M_car, M_qp: M_qp, fck: fck, fyk: MAT.fyk, exposition: exposition
        }) : null;

        // --- Enrobage (§4.4.1) : les cadres sont les armatures les plus proches du parement ---
        const enrCadre = enrobageNominal({ exposition: exposition, fck: fck, phi: phi_t * 1000,
                                           duree100: raw.duree100 });
        const enrBarre = enrobageNominal({ exposition: exposition, fck: fck, phi: diam,
                                           duree100: raw.duree100 });
        const c_nom_req = Math.max(enrCadre.c_nom, enrBarre.c_nom - phi_t * 1000); // mm

        // --- Ancrage sur appui d'extrémité (§9.2.1.4) ---
        // Effort à ancrer F_E = V_Ed·a_l/z, avec a_l = z·cotθ/2 (§9.2.1.3(2)) ou
        // a_l = d en l'absence d'armatures d'effort tranchant calculées.
        const a_l = cisaillementMinimal ? d : z * cotTheta / 2;
        const F_E = (z > 0) ? Ved * a_l / z : 0;                      // kN
        const sigma_appui = As_prov > 0 ? (F_E / As_prov) * 10 : fydV; // MPa
        const cdAnc = Math.min((c_nom + phi_t) * 1000, Math.max(espLibre, 0) / 2);
        const ancAppui = ancrage({ phi: diam, fck: fck, fyk: MAT.fyk, sigma_sd: sigma_appui,
                                   cd: cdAnc });
        const ancTotal = ancrage({ phi: diam, fck: fck, fyk: MAT.fyk, cd: cdAnc });

        // --- Vérifications ---
        addCheck(checks, 'Flexion ELU : section sans aciers comprimés', '§6.1',
            'μ ≤ ' + MU_LIMIT, f2(fx.mu, 3), !fx.depasse, true);
        if (!fx.depasse) {
            addCheck(checks, 'Section d\'acier longitudinal', '§6.1 / §9.2.1.1',
                'A_s ≥ ' + f2(As_req) + ' cm²', f2(As_prov) + ' cm²', As_prov >= As_req - 1e-9, true);
        }
        addCheck(checks, 'Section d\'acier maximale', '§9.2.1.1(3)',
            'A_s ≤ ' + f2(As_max) + ' cm²', f2(As_prov) + ' cm²',
            As_prov <= As_max && As_req <= As_max, true);
        if (nbBarres > 1) {
            addCheck(checks, 'Espacement libre entre barres', '§8.2(2)',
                '≥ ' + f2(espLibreMin / 10, 1) + ' cm', f2(espLibre / 10, 1) + ' cm',
                espLibre >= espLibreMin, true);
        }
        if (!fx.depasse) {
            addCheck(checks, 'Compression des bielles (effort tranchant)', '§6.2.3(3)',
                'V_Ed ≤ ' + f2(Vrd_max_45, 1) + ' kN', f2(Ved, 1) + ' kN', Ved <= Vrd_max_45, true);
        }
        addCheck(checks, 'Écartement transversal des brins de cadre', '§9.2.2(8)',
            '≤ ' + f2(s_t_max, 1) + ' cm', f2(ecartBrins, 1) + ' cm', ecartBrins <= s_t_max, true);
        addCheck(checks, 'Enrobage nominal (classe ' + exposition + ')', '§4.4.1',
            'c ≥ ' + f2(c_nom_req / 10, 1) + ' cm', f2(c_nom * 100, 1) + ' cm',
            c_nom * 1000 >= c_nom_req - 1e-6, true);
        if (status === 'OK') {
            addCheck(checks, 'Flèche : élancement L/d', '§7.4.2',
                'L/d ≤ ' + f2(fleche.limite, 1), f2(fleche.reel, 1), fleche.ok, false);
            addCheck(checks, 'Ductilité de la section', '§5.5',
                'μ ≤ ' + MU_DUCTILE, f2(fx.mu, 3), fx.mu <= MU_DUCTILE, false);
        }
        checksELS(checks, els);

        // --- Informations pédagogiques ---
        if (avecPoidsPropre) {
            push(w, 'info', "Poids propre b×h×25 = " + poidsPropre.toFixed(2) +
                " kN/ml ajouté à G : G_total = " + G_tot.toFixed(2) + " kN/ml.");
        } else {
            push(w, 'warn', "Poids propre (b×h×25 = " + poidsPropre.toFixed(2) +
                " kN/ml) NON inclus : il doit alors figurer dans la valeur de G saisie.");
        }
        if (L > 7) {
            push(w, 'info', "Portée > 7 m : si la poutre supporte des cloisons fragiles, l'EC2 " +
                "§7.4.2(2) impose de réduire la limite L/d dans le rapport 7/L.");
        }

        return {
            Med: Med, Ved: Ved, mu_cu: fx.mu, alpha: fx.alpha, z: z,
            As_req: As_req, Asw_s: Asw_s, status: status, d: d, cotTheta: cotTheta,
            fcd: fcdV, fyd: fydV, fyd_cm2: fyd_cm2, fctm: fctm(fck), p_elu: p_elu,
            Vrd_max_45: Vrd_max_45, As_min: As_min,
            As_max: As_max, As_prov: As_prov, V_Rdc: vrdc.V_Rdc, v_min: vrdc.v_min, Ved_d: Ved_d,
            Asw_s_min: Asw_s_min, cisaillementMinimal: cisaillementMinimal,
            s_max_cadres: s_max_cadres, s_t_max: s_t_max, ecartBrins: ecartBrins,
            s_cadre_prop: s_cadre_prop, Asw_cadre: Asw_cadre, nu1: nu, rho_l: rho_l,
            fleche: fleche, espLibre: espLibre, espLibreMin: espLibreMin,
            poidsPropre: poidsPropre, G_tot: G_tot, M_car: M_car, M_qp: M_qp, psi2: psi2,
            els: els, enrobage: { requis: c_nom_req, cadre: enrCadre, barre: enrBarre },
            ancrage: { appui: ancAppui, courant: ancTotal, F_E: F_E, a_l: a_l },
            warnings: w, checks: checks,
            inputs: { L: L, b: b, h: h, G: G, Q: Q, fck: fck, c_nom: c_nom,
                      enrobage: c_nom * 100, phi_t: phi_t, psi2: psi2, exposition: exposition,
                      poidsPropre: avecPoidsPropre }
        };
    }

    // =====================================================================
    // 10. MODULE DALLE PLEINE — bande de 1 m portant sur deux appuis
    // =====================================================================

    function dalle(raw) {
        const w = [];
        const checks = [];
        const L = num(raw.L, 4, 0.5, 100);
        const h = num(raw.h, 0.2, 0.04, 3);
        const G = num(raw.G, 0, 0, 1e6);
        const Q = num(raw.Q, 0, 0, 1e6);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const enrobage = num(raw.enrobage, 3, 1, 15);       // cm
        const espacement = num(raw.espacementInput, 15, 4, 60); // cm
        const esp_rep = num(raw.espRepInput, 20, 4, 60);        // cm
        const diamMain = num(raw.diamMain, 10, 6, 32);
        const diamRep = num(raw.diamRep, 8, 6, 32);
        const secMain = (raw.sectionMain !== undefined) ? raw.sectionMain : sectionBarre(diamMain);
        const secRep = (raw.sectionRep !== undefined) ? raw.sectionRep : sectionBarre(diamRep);
        const psi2 = num(raw.psi2, 0.3, 0, 1);
        const exposition = EXPOSITIONS[raw.exposition] ? raw.exposition : 'XC1';
        const avecPoidsPropre = !!raw.poidsPropre;

        const b = 1.0;
        const c_nom = enrobage / 100;
        const fcdV = fcd(fck);
        const fydV = fyd(MAT.fyk);

        const d = h - c_nom - (diamMain / 1000) / 2;
        if (d <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage dépasse l'épaisseur de la dalle.");
        }

        const poidsPropre = h * MAT.gammaBeton;
        const G_tot = G + (avecPoidsPropre ? poidsPropre : 0);
        const p_elu = 1.35 * G_tot + 1.5 * Q;
        const Med = (p_elu * L * L) / 8;
        const Ved = (p_elu * L) / 2;
        const M_car = (G_tot + Q) * L * L / 8;
        const M_qp = (G_tot + psi2 * Q) * L * L / 8;

        const fx = flexionSimple(Med, b, d, fck, MAT.fyk);
        const As_min = AsMinFlexion(b, d, fck, MAT.fyk);
        const As_max = 0.04 * b * h * 10000;

        let status = 'OK';
        let As_req = 0;
        if (fx.depasse) {
            status = 'ERROR_MUCU';
            push(w, 'error', "μ_cu > " + MU_LIMIT + " : épaisseur de dalle insuffisante " +
                "(des aciers comprimés seraient nécessaires).");
        } else {
            As_req = Math.max(fx.As, As_min);
            if (fx.mu > MU_DUCTILE) {
                push(w, 'warn', "μ_cu = " + fx.mu.toFixed(3) + " > " + MU_DUCTILE +
                    " (x/d > 0.45) : ductilité faible, augmenter l'épaisseur h est préférable.");
            }
        }

        // Armatures fournies
        const As_prov = secMain * (100 / espacement);
        const As_prov_rep = secRep * (100 / esp_rep);
        // §9.3.1.1(2) : armatures de répartition >= 20 % des armatures principales.
        const As_rep_req = 0.20 * As_prov;

        // Effort tranchant : une dalle courante doit résister sans armatures d'âme (§6.2.2)
        const rho_l = (d > 0) ? Math.min((As_prov / 10000) / (b * d), 0.02) : 0;
        const vrdc = VRdc(b, d, fck, rho_l, 0, 'dalle');
        if (Ved > vrdc.V_Rdc && status !== 'ERROR_MUCU') {
            status = 'ERROR_SHEAR';
            push(w, 'error', "V_Ed = " + Ved.toFixed(1) + " kN/ml > V_Rd,c = " + vrdc.V_Rdc.toFixed(1) +
                " kN/ml : une dalle ne doit pas nécessiter d'armatures d'effort tranchant, " +
                "augmenter h (EC2 §6.2.2).");
        }

        // Espacements maximaux (§9.3.1.1(3)) dans la zone de moment maximal, c'est-à-dire
        // à mi-portée d'une dalle isostatique : 2h <= 25 cm (principal), 3h <= 40 cm (répartition).
        const s_max_main = Math.min(2 * (h * 100), 25);
        const s_max_rep = Math.min(3 * (h * 100), 40);
        const esp_net = espacement - diamMain / 10;
        const espLibreMin_cm = espacementLibreMin(diamMain, 20) / 10;

        // Flèche (§7.4.2) : dalle isostatique sur deux appuis => K = 1.0
        const rho_fleche = (d > 0) ? (As_req / 10000) / (b * d) : 0;
        const fleche = elancementFleche(L, d, fck, rho_fleche, 1.0, As_req, As_prov, MAT.fyk);

        // ELS (§7.2, §7.3)
        const els = (status === 'OK') ? verifELS({
            b: b, h: h, d: d, As: As_prov, phi: diamMain, c: c_nom * 1000,
            s: espacement * 10, M_car: M_car, M_qp: M_qp, fck: fck, fyk: MAT.fyk,
            exposition: exposition
        }) : null;

        // Enrobage (§4.4.1) : élément de type dalle => classe structurale minorée d'une unité
        const enr = enrobageNominal({ exposition: exposition, fck: fck, phi: diamMain, dalle: true,
                                      duree100: raw.duree100 });

        // Ancrage sur appui (§9.3.1.2 renvoyant au §9.2.1.4) : a_l = d sans armatures d'âme
        const zA = fx.z > 0 ? fx.z : 0.9 * d;
        const F_E = zA > 0 ? Ved * d / zA : 0;
        const sigma_appui = As_prov > 0 ? (F_E / As_prov) * 10 : fydV;
        const cdAnc = Math.min(c_nom * 1000, Math.max(esp_net * 10, 0) / 2);
        const ancAppui = ancrage({ phi: diamMain, fck: fck, sigma_sd: sigma_appui, cd: cdAnc });
        const ancTotal = ancrage({ phi: diamMain, fck: fck, cd: cdAnc, pctRecouvre: 50 });

        // --- Vérifications ---
        addCheck(checks, 'Flexion ELU : épaisseur suffisante', '§6.1',
            'μ ≤ ' + MU_LIMIT, f2(fx.mu, 3), !fx.depasse, true);
        if (!fx.depasse) {
            addCheck(checks, 'Armatures principales', '§6.1 / §9.3.1.1(1)',
                'A_s ≥ ' + f2(As_req) + ' cm²/ml', f2(As_prov) + ' cm²/ml', As_prov >= As_req - 1e-9, true);
        }
        addCheck(checks, 'Armatures de répartition (20 %)', '§9.3.1.1(2)',
            '≥ ' + f2(As_rep_req) + ' cm²/ml', f2(As_prov_rep) + ' cm²/ml',
            As_prov_rep >= As_rep_req - 1e-9, true);
        addCheck(checks, 'Section d\'acier maximale', '§9.2.1.1(3)',
            'A_s ≤ ' + f2(As_max) + ' cm²/ml', f2(As_prov) + ' cm²/ml', As_prov <= As_max, true);
        if (!fx.depasse) {
            addCheck(checks, 'Effort tranchant sans armatures d\'âme', '§6.2.2',
                'V_Ed ≤ ' + f2(vrdc.V_Rdc, 1) + ' kN/ml', f2(Ved, 1) + ' kN/ml', Ved <= vrdc.V_Rdc, true);
        }
        addCheck(checks, 'Espacement libre des barres principales', '§8.2(2)',
            '≥ ' + f2(espLibreMin_cm, 1) + ' cm', f2(esp_net, 1) + ' cm', esp_net >= espLibreMin_cm, true);
        addCheck(checks, 'Espacement maximal des barres principales', '§9.3.1.1(3)',
            's ≤ ' + f2(s_max_main, 0) + ' cm', f2(espacement, 0) + ' cm', espacement <= s_max_main, true);
        addCheck(checks, 'Espacement maximal de la répartition', '§9.3.1.1(3)',
            's ≤ ' + f2(s_max_rep, 0) + ' cm', f2(esp_rep, 0) + ' cm', esp_rep <= s_max_rep, true);
        addCheck(checks, 'Enrobage nominal (classe ' + exposition + ')', '§4.4.1',
            'c ≥ ' + f2(enr.c_nom / 10, 1) + ' cm', f2(enrobage, 1) + ' cm',
            enrobage * 10 >= enr.c_nom - 1e-6, true);
        if (status === 'OK') {
            addCheck(checks, 'Flèche : élancement L/d', '§7.4.2',
                'L/d ≤ ' + f2(fleche.limite, 1), f2(fleche.reel, 1), fleche.ok, false);
        }
        checksELS(checks, els);

        if (avecPoidsPropre) {
            push(w, 'info', "Poids propre h×25 = " + poidsPropre.toFixed(2) +
                " kN/m² ajouté à G : G_total = " + G_tot.toFixed(2) + " kN/m².");
        } else {
            push(w, 'warn', "Poids propre (h×25 = " + poidsPropre.toFixed(2) +
                " kN/m²) NON inclus : il doit alors figurer dans la valeur de G saisie.");
        }

        return {
            Med: Med, Ved: Ved, As_req: As_req, As_min: As_min, As_prov: As_prov,
            As_prov_rep: As_prov_rep, As_rep_req: As_rep_req, V_Rdc: vrdc.V_Rdc, v_min: vrdc.v_min,
            status: status, s_max_main: s_max_main, s_max_rep: s_max_rep, esp_net: esp_net,
            espLibreMin: espLibreMin_cm,
            d: d, p_elu: p_elu, fctm: fctm(fck), fyd: fydV, fcd: fcdV,
            mu_cu: fx.mu, alpha: fx.alpha, z: fx.z, fyd_cm2: fydV / 10,
            k: vrdc.k, rho_l: vrdc.rho_l,
            As_max: As_max, fleche: fleche, poidsPropre: poidsPropre, G_tot: G_tot,
            M_car: M_car, M_qp: M_qp, psi2: psi2, els: els,
            enrobage: { requis: enr.c_nom, detail: enr },
            ancrage: { appui: ancAppui, courant: ancTotal, F_E: F_E },
            warnings: w, checks: checks,
            inputs: { L: L, h: h, G: G, Q: Q, fck: fck, enrobage: enrobage,
                      espacementInput: espacement, espRepInput: esp_rep, psi2: psi2,
                      exposition: exposition, poidsPropre: avecPoidsPropre }
        };
    }

    // =====================================================================
    // 11. MODULE POTEAU — flexion composée, effets du second ordre
    // =====================================================================

    /**
     * Lits d'armatures d'un poteau rectangulaire pour une flexion dans le plan
     * de la dimension `h` (profondeur). nbExt barres sur chacune des deux faces
     * perpendiculaires au plan de flexion, nbLat barres (coins compris) sur
     * chacune des deux faces latérales.
     */
    function litsPoteau(h, dprime, nbExt, nbLat, secBarre) {
        const lits = [
            { As: nbExt * secBarre, y: dprime },
            { As: nbExt * secBarre, y: h - dprime }
        ];
        const nInt = Math.max(0, nbLat - 2);
        for (let j = 1; j <= nInt; j++) {
            lits.push({ As: 2 * secBarre, y: dprime + (h - 2 * dprime) * j / (nInt + 1) });
        }
        return lits;
    }

    /**
     * @param {object} raw {L, a, b, beta, fck, fyk, N_Ed, M_Ed, enrobage (cm), diameter,
     *        phi_ef, nb_a, nb_b (barres par face, facultatif), exposition, duree100}
     */
    function poteau(raw) {
        const w = [];
        const checks = [];
        const L = num(raw.L, 3, 0.3, 50);
        const a = num(raw.a, 0.3, 0.10, 5);
        const b = num(raw.b, 0.3, 0.10, 5);
        const beta = num(raw.beta, 1.0, 0.5, 4);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const fykVal = num(raw.fyk, 500, 400, 600);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const M_Ed = num(raw.M_Ed, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 3, 1, 15);
        const diameter = num(raw.diameter, 12, 6, 40);
        const phi_ef = num(raw.phi_ef, 2.0, 0, 5);
        const exposition = EXPOSITIONS[raw.exposition] ? raw.exposition : 'XC1';

        const Ac_m2 = a * b;
        const Ac = Ac_m2 * 10000;         // cm²
        const fcdV = fcd(fck);
        const fydV = fyd(fykVal);
        const fyd_cm2 = fydV / 10;
        const sigmaScV = sigmaSc(fykVal);
        const sigmaSc_cm2 = sigmaScV / 10;
        const secBarre = sectionBarre(diameter);

        // --- Flambement (§5.8) autour de l'axe faible ---
        const l0 = beta * L;
        const min_dim = Math.min(a, b);
        const max_dim = Math.max(a, b);
        const I_min = (max_dim * Math.pow(min_dim, 3)) / 12;
        const i_gyr = min_dim / Math.sqrt(12);
        const lambda = l0 / i_gyr;
        // Charge critique d'Euler de la section brute non fissurée : valeur purement
        // indicative (elle surestime largement la rigidité réelle, cf. §5.8.7.2).
        const N_cr = (Math.PI * Math.PI * Ecm(fck) * 1000 * I_min) / (l0 * l0); // kN

        // --- Sections d'aciers limites (§9.5.2) ---
        const As_min = Math.max(0.10 * N_Ed / fyd_cm2, 0.002 * Ac);
        const As_max = 0.04 * Ac;

        // --- Hauteur utile dans le PLAN DE FLAMBEMENT (axe faible) ---
        const c_nom = enrobage / 100;
        const phi_l = diameter / 1000;
        const phi_t = 0.008;
        const h_dir = min_dim;
        const dprime = c_nom + phi_t + phi_l / 2;
        const d = h_dir - dprime;
        const z = d - dprime; // distance entre les deux lits extrêmes
        if (d <= dprime) {
            push(w, 'error', "Hauteur utile insuffisante : l'enrobage dépasse la moitié de la plus " +
                "petite dimension du poteau.");
        }

        // Moment de calcul pour une section d'acier donnée (K_r dépend de A_s)
        const effets = (As) => momentSecondOrdre({
            N_Ed: N_Ed, M_Ed: M_Ed, L: L, l0: l0, h: h_dir, d: d, Ac_m2: Ac_m2,
            fck: fck, fyk: fykVal, phi_ef: phi_ef, As: As, lambda: lambda
        });
        // Marge d'une section à armatures symétriques sur deux faces (A_s/2 par face)
        const marge = (As) => {
            const sec = sectionNM(max_dim, h_dir,
                [{ As: As / 2, y: dprime }, { As: As / 2, y: h_dir - dprime }], fck, fykVal);
            const e = effets(As);
            return { ok: sec.MRd(N_Ed) >= e.M_Ed_tot - 1e-9, MRd: sec.MRd(N_Ed), e: e, sec: sec };
        };

        // --- Dimensionnement : plus petite section symétrique vérifiant (N_Ed, M_Ed,tot) ---
        let As_calc = 0;
        let resistant = d > dprime;
        if (resistant && !marge(0).ok) {
            const As_haut = 3 * As_max;
            const PAS = 60;
            let precedent = 0, trouve = -1;
            for (let i = 1; i <= PAS; i++) {
                const As = As_haut * i / PAS;
                if (marge(As).ok) { trouve = As; break; }
                precedent = As;
            }
            if (trouve < 0) {
                resistant = false;
                As_calc = Infinity;
            } else {
                let lo = precedent, hi = trouve;
                for (let i = 0; i < 30; i++) {
                    const m = (lo + hi) / 2;
                    if (marge(m).ok) hi = m; else lo = m;
                }
                As_calc = hi;
            }
        }
        const As_req = isFinite(As_calc) ? Math.max(As_calc, As_min) : Infinity;
        const dim = marge(isFinite(As_req) ? As_req : As_max);
        const so = dim.e;

        if (!resistant) {
            push(w, 'error', "La section de béton est insuffisante : même avec 3 × A_s,max, le " +
                "couple (N_Ed ; M_Ed,tot) sort du diagramme d'interaction. Agrandir le poteau.");
        } else if (As_req > As_max) {
            push(w, 'error', "A_s requis (" + As_req.toFixed(2) + " cm²) > A_s,max = 4 % A_c = " +
                As_max.toFixed(2) + " cm² : la section de béton est insuffisante (EC2 §9.5.2).");
        }

        if (so.secondOrdre) {
            push(w, 'info', "λ = " + lambda.toFixed(1) + " > λ_lim = " + so.lambda_lim.toFixed(1) +
                " : effets du second ordre pris en compte par la courbure nominale (e₂ = " +
                (so.e_2 * 1000).toFixed(0) + " mm, K_r = " + so.K_r.toFixed(2) + ", K_φ = " +
                so.K_phi.toFixed(2) + ", EC2 §5.8.8).");
        } else if (isFinite(so.lambda_lim)) {
            push(w, 'info', "λ = " + lambda.toFixed(1) + " ≤ λ_lim = " + so.lambda_lim.toFixed(1) +
                " : les effets du second ordre peuvent être négligés (EC2 §5.8.3.1).");
        }
        if (lambda > 150) {
            push(w, 'warn', "λ = " + lambda.toFixed(1) + " > 150 : poteau très élancé, hors du " +
                "domaine d'application courant de la méthode de la courbure nominale.");
        }
        if (M_Ed > 0 && a !== b) {
            push(w, 'info', "Le moment M_Ed est supposé agir dans le plan de flambement (axe faible, " +
                "h = " + (h_dir * 100).toFixed(0) + " cm) : hypothèse conservative s'il agit autour " +
                "de l'axe fort. La flexion déviée n'est pas traitée.");
        }

        // --- Enrobage et dispositions constructives (§4.4.1, §9.5.3) ---
        const enrCadre = enrobageNominal({ exposition: exposition, fck: fck, phi: phi_t * 1000,
                                           duree100: raw.duree100 });
        const enrBarre = enrobageNominal({ exposition: exposition, fck: fck, phi: diameter,
                                           duree100: raw.duree100 });
        const c_nom_req = Math.max(enrCadre.c_nom, enrBarre.c_nom - phi_t * 1000);
        addCheck(checks, 'Enrobage nominal (classe ' + exposition + ')', '§4.4.1',
            'c ≥ ' + f2(c_nom_req / 10, 1) + ' cm', f2(enrobage, 1) + ' cm',
            enrobage * 10 >= c_nom_req - 1e-6, true);
        addCheck(checks, 'Diamètre des cadres', '§9.5.3(1)',
            'Ø_t ≥ ' + f2(Math.max(6, diameter / 4), 1) + ' mm', '8 mm', 8 >= Math.max(6, diameter / 4), true);
        // Espacement des cadres §9.5.3(3) et (4) : s_cl,tmax = min(20 Ø_l ; b ; 400 mm),
        // réduit par 0.6 au voisinage des poutres/dalles et dans les zones de recouvrement.
        const s_cadres = Math.min(20 * diameter, min_dim * 1000, 400);
        const recouvrement = ancrage({ phi: diameter, fck: fck, fyk: fykVal, compression: true });

        const res = {
            l0: l0, lambda: lambda, N_cr: N_cr, e_2: so.e_2, e_i: so.e_i,
            e_M: N_Ed > 0 ? M_Ed / N_Ed : 0,
            e_tot: N_Ed > 0 ? so.M_Ed_tot / N_Ed : 0,
            i_gyr: i_gyr, max_dim: max_dim, As_req: As_req, As_calc: As_calc,
            As_min: As_min, As_max: As_max, fcd: fcdV, fyd: fydV,
            fyd_cm2: fyd_cm2, Ac: Ac, N_Rd_c: Ac * (fcdV / 10), d: d, dprime: dprime, z: z,
            M_0Ed: so.M_0Ed, M_2: so.M_2, M_Ed_tot: so.M_Ed_tot, M_Rd_req: dim.MRd,
            lambda_lim: so.lambda_lim, n_rel: so.n_rel, secondOrdre: so.secondOrdre,
            K_r: so.K_r, K_phi: so.K_phi, beta_phi: so.beta_phi, A_lim: so.A_lim, phi_ef: phi_ef,
            min_dim: min_dim, h_dir: h_dir, e_i_geo: so.e_i, e_0_min: so.e_0_min,
            alpha_h: so.alpha_h, sigma_sc: sigmaScV, sigma_sc_cm2: sigmaSc_cm2,
            resistant: resistant, verif: null,
            enrobage: { requis: c_nom_req, cadre: enrCadre, barre: enrBarre },
            dispositions: { s_cadres: s_cadres, s_cadres_reduit: 0.6 * s_cadres,
                            recouvrement: recouvrement },
            warnings: w, checks: checks,
            inputs: { L: L, a: a, b: b, beta: beta, fck: fck, fyk: fykVal,
                      N_Ed: N_Ed, M_Ed: M_Ed, enrobage: enrobage, phi_ef: phi_ef,
                      exposition: exposition, diameter: diameter }
        };

        // --- Vérification du ferraillage réellement disposé ---
        if (raw.nb_a !== undefined && raw.nb_b !== undefined) {
            const v = poteauVerif(res, raw.nb_a, raw.nb_b);
            res.verif = v.verif;
            // Les contrôles de résistance passent en tête de liste
            res.checks = v.checks.concat(res.checks);
        }
        return res;
    }

    /**
     * Vérifie un ferraillage de poteau donné (nb_a barres sur chaque face de
     * longueur a, nb_b sur chaque face de longueur b, coins compris) à partir
     * du résultat de poteau() : diagramme d'interaction N-M de la section
     * réelle, avec K_r recalculé pour la section d'acier disposée.
     * @returns {{verif:object, checks:Array, ok:boolean}}
     */
    function poteauVerif(res, nbA, nbB) {
        const p = res.inputs;
        const nb_a = Math.max(2, Math.round(num(nbA, 2, 2, 40)));
        const nb_b = Math.max(2, Math.round(num(nbB, 2, 2, 40)));
        const secBarre = sectionBarre(p.diameter);
        const total = 2 * nb_a + 2 * Math.max(0, nb_b - 2);
        const As_ch = total * secBarre;
        const e = momentSecondOrdre({
            N_Ed: p.N_Ed, M_Ed: p.M_Ed, L: p.L, l0: res.l0, h: res.h_dir, d: res.d,
            Ac_m2: p.a * p.b, fck: p.fck, fyk: p.fyk, phi_ef: p.phi_ef, As: As_ch, lambda: res.lambda
        });
        // Flexion dans le plan de b (b <= a) : les faces de longueur a sont les faces
        // extrêmes. Poteau carré : on retient la moins favorable des deux orientations.
        const orientations = [];
        if (p.b <= p.a) orientations.push({ larg: p.a, nbExt: nb_a, nbLat: nb_b });
        if (p.a <= p.b) orientations.push({ larg: p.b, nbExt: nb_b, nbLat: nb_a });
        let pire = null;
        orientations.forEach(o => {
            const lits = litsPoteau(res.h_dir, res.dprime, o.nbExt, o.nbLat, secBarre);
            const sec = sectionNM(o.larg, res.h_dir, lits, p.fck, p.fyk);
            const M = sec.MRd(p.N_Ed);
            if (!pire || M < pire.MRd) pire = { MRd: M, sec: sec, lits: lits };
        });
        const NRd = pire.sec.Nmax;
        // Espacement libre minimal sur les deux familles de faces (cadres Ø8)
        const libre = (dim_m, n) => n > 1
            ? ((dim_m * 1000 - 2 * p.enrobage * 10 - 2 * 8) - n * p.diameter) / (n - 1)
            : Infinity;
        const espMin = Math.min(libre(p.a, nb_a), libre(p.b, nb_b));
        const espLibreMin = espacementLibreMin(p.diameter, 20);
        const okN = p.N_Ed <= NRd;
        const okM = isFinite(pire.MRd) && e.M_Ed_tot <= pire.MRd + 1e-9;
        const verif = {
            nb_a: nb_a, nb_b: nb_b, nbBarres: total, As: As_ch, NRd: NRd,
            MRd: pire.MRd, M_Ed_tot: e.M_Ed_tot, e: e,
            tauxN: NRd > 0 ? p.N_Ed / NRd : Infinity,
            tauxM: pire.MRd > 0 ? e.M_Ed_tot / pire.MRd : Infinity,
            espLibre: espMin, espLibreMin: espLibreMin, lits: pire.lits,
            diagramme: pire.sec.diagramme(48)
        };
        const checks = [];
        addCheck(checks, 'Compression centrée', '§6.1',
            'N_Ed ≤ ' + f2(NRd, 0) + ' kN', f2(p.N_Ed, 0) + ' kN', okN, true);
        addCheck(checks, 'Flexion composée (diagramme N-M)', '§6.1 / §5.8.8',
            'M_Ed,tot ≤ M_Rd = ' + f2(isFinite(pire.MRd) ? pire.MRd : NaN, 1) + ' kN.m',
            f2(e.M_Ed_tot, 1) + ' kN.m', okM, true);
        addCheck(checks, 'Section d\'acier minimale', '§9.5.2(2)',
            'A_s ≥ ' + f2(res.As_min) + ' cm²', f2(As_ch) + ' cm²', As_ch >= res.As_min - 1e-9, true);
        addCheck(checks, 'Section d\'acier maximale', '§9.5.2(3)',
            'A_s ≤ ' + f2(res.As_max) + ' cm²', f2(As_ch) + ' cm²', As_ch <= res.As_max, true);
        addCheck(checks, 'Espacement libre entre barres', '§8.2(2)',
            '≥ ' + f2(espLibreMin / 10, 1) + ' cm',
            isFinite(espMin) ? f2(espMin / 10, 1) + ' cm' : '—', espMin >= espLibreMin, true);
        return { verif: verif, checks: checks, ok: checks.every(c => c.ok),
                 okResistance: okN && okM, okEspacement: espMin >= espLibreMin };
    }

    /** Effort normal résistant en compression centrée (kN), aciers comprimés plafonnés. */
    function poteauNRd(res, As_chosen_cm2) {
        return res.N_Rd_c + As_chosen_cm2 * res.sigma_sc_cm2;
    }

    // =====================================================================
    // 12. MODULE VOILE — bande de 1 m : compression + flambement hors plan
    // =====================================================================

    function voile(raw) {
        const w = [];
        const checks = [];
        const h = num(raw.h, 0.20, 0.05, 2);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const V_Ed = num(raw.V_Ed, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 3, 1, 15);
        const nappesCount = num(raw.nappesCount, 2, 1, 2) >= 2 ? 2 : 1;
        const phi_ts_mm = num(raw.tsDiam, 7, 3, 20);
        const phi_ts = phi_ts_mm / 1000;
        const sec_ts_long = num(raw.tsSection, 2.57, 0.1, 100);      // cm²/m sens porteur
        const sec_ts_trans = num(raw.tsSectionT, sec_ts_long, 0.1, 100); // cm²/m sens transversal
        const ts_esp = num(raw.tsEsp, 150, 50, 500);                 // mm
        const L_w = num(raw.L_w, 2.7, 0.5, 30);
        const beta_w = num(raw.beta_w, 1.0, 0.5, 2.5);
        const phi_ef = num(raw.phi_ef, 2.0, 0, 5);
        const exposition = EXPOSITIONS[raw.exposition] ? raw.exposition : 'XC1';

        const b = 1.0;
        const c_nom = enrobage / 100;
        const Ac_m2 = b * h;
        const Ac = Ac_m2 * 10000; // cm²/ml
        const fcdV = fcd(fck);
        const sigmaScV = sigmaSc(MAT.fyk);

        const dprime = c_nom + phi_ts / 2;
        let d = h - dprime;
        if (nappesCount === 1) d = h / 2;
        if (d <= 0 || (nappesCount === 2 && d <= dprime)) {
            push(w, 'error', "Hauteur utile insuffisante : l'enrobage dépasse la demi-épaisseur du voile.");
        }

        // --- Armatures minimales (§9.6.2 et §9.6.3) ---
        const As_vmin = 0.002 * Ac;
        const As_vmax = 0.04 * Ac;
        const As_v_prov = sec_ts_long * nappesCount;
        const As_h_prov = sec_ts_trans * nappesCount;
        const As_hmin = Math.max(0.25 * As_v_prov, 0.001 * Ac);
        const As_req = As_vmin;
        const As_prov = As_v_prov;

        // --- Compression centrée et flambement hors plan (§5.8, §6.1) ---
        const lits = nappesCount === 2
            ? [{ As: As_v_prov / 2, y: dprime }, { As: As_v_prov / 2, y: h - dprime }]
            : [{ As: As_v_prov, y: h / 2 }];
        const sec = sectionNM(b, h, lits, fck, MAT.fyk);
        const N_Rd0 = sec.Nmax; // compression parfaitement centrée
        const l0 = beta_w * L_w;
        const lambda = l0 * Math.sqrt(12) / h;
        const so = momentSecondOrdre({
            N_Ed: N_Ed, M_Ed: 0, L: L_w, l0: l0, h: h, d: d, Ac_m2: Ac_m2,
            fck: fck, fyk: MAT.fyk, phi_ef: phi_ef, As: As_v_prov, lambda: lambda
        });
        const M_Rd = sec.MRd(N_Ed);
        const e_tot = N_Ed > 0 ? so.M_Ed_tot / N_Ed : so.e_0_min;
        // Effort normal résistant sous l'excentricité de calcul e_tot (bissection sur N)
        let N_Rd = 0;
        {
            let lo = 0, hi = N_Rd0;
            for (let i = 0; i < 50; i++) {
                const m = (lo + hi) / 2;
                if (sec.MRd(m) >= m * e_tot) lo = m; else hi = m;
            }
            N_Rd = lo;
        }

        // --- Effort tranchant hors plan sans armatures d'âme (§6.2.2) ---
        const sigma_cp_calc = N_Ed / (Ac_m2 * 1000); // MPa
        const sigma_cp = Math.min(sigma_cp_calc, 0.2 * fcdV);
        const rho_l = (d > 0) ? Math.min((As_v_prov / nappesCount / 10000) / (b * d), 0.02) : 0;
        const vrdc = VRdc(b, d, fck, rho_l, sigma_cp, 'voile');

        // --- Enrobage ---
        const enr = enrobageNominal({ exposition: exposition, fck: fck, phi: phi_ts_mm,
                                      duree100: raw.duree100 });
        const s_v_max = Math.min(3 * h * 1000, 400); // §9.6.2(3)
        const s_h_max = 400;                          // §9.6.3(1)

        let status = 'OK';
        const okFlexion = isFinite(M_Rd) && so.M_Ed_tot <= M_Rd + 1e-9;
        if (N_Ed > N_Rd0 || !okFlexion) {
            status = 'ERROR_AXIAL';
            push(w, 'error', "N_Ed = " + N_Ed.toFixed(0) + " kN/ml > N_Rd = " + N_Rd.toFixed(0) +
                " kN/ml sous l'excentricité de calcul e = " + (e_tot * 1000).toFixed(0) +
                " mm (imperfections, excentricité minimale et second ordre, EC2 §5.8 / §6.1).");
        } else if (V_Ed > vrdc.V_Rdc) {
            status = 'ERROR_SHEAR';
            push(w, 'error', "V_Ed = " + V_Ed.toFixed(1) + " kN/ml > V_Rd,c = " + vrdc.V_Rdc.toFixed(1) +
                " kN/ml : épaisseur insuffisante ou armatures d'effort tranchant nécessaires.");
        } else if (As_v_prov < As_vmin) {
            status = 'ERROR_STEEL';
            push(w, 'error', "Armatures verticales " + As_v_prov.toFixed(2) + " cm²/ml < A_s,v,min = " +
                As_vmin.toFixed(2) + " cm²/ml (EC2 §9.6.2).");
        } else if (As_h_prov < As_hmin) {
            status = 'ERROR_STEEL_H';
            push(w, 'error', "Armatures horizontales " + As_h_prov.toFixed(2) + " cm²/ml < A_s,h,min = " +
                As_hmin.toFixed(2) + " cm²/ml (EC2 §9.6.3).");
        } else if (nappesCount === 1) {
            status = 'ERROR_LAYERS';
        }

        if (nappesCount === 1) {
            push(w, 'error', "Une seule nappe : lorsque A_s,v,min gouverne, l'EC2 §9.6.2(3) impose " +
                "d'en placer la moitié sur chaque face. Un voile à nappe unique relève du béton " +
                "peu armé (EC2 §12, DTU 23.1), hors du champ de ce module.");
        }
        if (sigma_cp_calc > 0.2 * fcdV) {
            push(w, 'warn', "σ_cp = " + sigma_cp_calc.toFixed(2) + " MPa > 0.2·f_cd = " +
                (0.2 * fcdV).toFixed(2) + " MPa : la contribution de la compression à V_Rd,c est " +
                "plafonnée par l'EC2 §6.2.2(1).");
        }
        push(w, 'info', "Flambement hors plan : l₀ = " + l0.toFixed(2) + " m, λ = " + lambda.toFixed(1) +
            (so.secondOrdre ? " > λ_lim = " + so.lambda_lim.toFixed(1) + " (e₂ = " +
                (so.e_2 * 1000).toFixed(0) + " mm)" : " ≤ λ_lim = " + f2(so.lambda_lim, 1)) +
            ". Excentricité de calcul e = " + (e_tot * 1000).toFixed(0) + " mm.");
        push(w, 'warn', "Le comportement du voile dans son plan (contreventement, effort " +
            "tranchant dans le plan) n'est pas vérifié par ce module.");

        addCheck(checks, 'Compression centrée', '§6.1',
            'N_Ed ≤ ' + f2(N_Rd0, 0) + ' kN/ml', f2(N_Ed, 0) + ' kN/ml', N_Ed <= N_Rd0, true);
        addCheck(checks, 'Compression avec excentricité et flambement', '§5.8 / §6.1(4)',
            'N_Ed ≤ N_Rd = ' + f2(N_Rd, 0) + ' kN/ml', f2(N_Ed, 0) + ' kN/ml', okFlexion && N_Ed <= N_Rd0, true);
        addCheck(checks, 'Effort tranchant hors plan', '§6.2.2',
            'V_Ed ≤ ' + f2(vrdc.V_Rdc, 1) + ' kN/ml', f2(V_Ed, 1) + ' kN/ml', V_Ed <= vrdc.V_Rdc, true);
        addCheck(checks, 'Armatures verticales minimales', '§9.6.2(1)',
            '≥ ' + f2(As_vmin) + ' cm²/ml', f2(As_v_prov) + ' cm²/ml', As_v_prov >= As_vmin, true);
        addCheck(checks, 'Armatures verticales maximales', '§9.6.2(1)',
            '≤ ' + f2(As_vmax) + ' cm²/ml', f2(As_v_prov) + ' cm²/ml', As_v_prov <= As_vmax, true);
        addCheck(checks, 'Armatures horizontales minimales', '§9.6.3(1)',
            '≥ ' + f2(As_hmin) + ' cm²/ml', f2(As_h_prov) + ' cm²/ml', As_h_prov >= As_hmin, true);
        addCheck(checks, 'Une nappe sur chaque face', '§9.6.2(3)',
            '2 nappes', nappesCount + ' nappe(s)', nappesCount === 2, true);
        addCheck(checks, 'Espacement des fils verticaux', '§9.6.2(3)',
            '≤ ' + f2(s_v_max / 10, 0) + ' cm', f2(ts_esp / 10, 0) + ' cm', ts_esp <= s_v_max, true);
        addCheck(checks, 'Enrobage nominal (classe ' + exposition + ')', '§4.4.1',
            'c ≥ ' + f2(enr.c_nom / 10, 1) + ' cm', f2(enrobage, 1) + ' cm',
            enrobage * 10 >= enr.c_nom - 1e-6, true);

        return {
            sigma_cp: sigma_cp, d: d, V_Rdc: vrdc.V_Rdc, V_Rdc_calc: vrdc.V_Rdc_calc,
            V_Rdc_min: vrdc.V_Rdc_min, v_min: vrdc.v_min, As_vmin: As_vmin, As_hmin: As_hmin,
            As_req: As_req, As_prov: As_prov, rho_l: vrdc.rho_l, status: status,
            k: vrdc.k, fcd: fcdV, Ac: Ac,
            Ac_m2: Ac_m2, sigma_cp_calc: sigma_cp_calc, N_Rd: N_Rd, N_Rd0: N_Rd0, M_Rd: M_Rd,
            As_v_prov: As_v_prov, As_h_prov: As_h_prov, sigma_sc: sigmaScV,
            l0: l0, lambda: lambda, lambda_lim: so.lambda_lim, secondOrdre: so.secondOrdre,
            e_i: so.e_i, e_0_min: so.e_0_min, e_2: so.e_2, e_tot: e_tot,
            M_Ed_tot: so.M_Ed_tot, K_r: so.K_r, K_phi: so.K_phi,
            s_v_max: s_v_max, s_h_max: s_h_max,
            enrobage: { requis: enr.c_nom, detail: enr },
            warnings: w, checks: checks,
            inputs: { h: h, fck: fck, N_Ed: N_Ed, V_Ed: V_Ed, enrobage: enrobage,
                      nappesCount: nappesCount, L_w: L_w, beta_w: beta_w, phi_ef: phi_ef,
                      exposition: exposition }
        };
    }

    // =====================================================================
    // 13. POINÇONNEMENT (§6.4) — utilisé par les semelles isolées
    // =====================================================================

    /**
     * Vérification du poinçonnement d'une semelle rectangulaire sous poteau centré.
     * Conformément au §6.4.4(2), la vérification est menée sur plusieurs
     * périmètres de contrôle situés à une distance a <= 2d du nu du poteau,
     * avec l'effort réduit de la réaction de sol comprise dans le périmètre.
     * Au nu du poteau : v_Rd,max = 0.4·ν·f_cd (valeur recommandée du §6.4.5(3),
     * retenue par l'Annexe Nationale française).
     */
    function poinconnement(params) {
        const { a, b, A, B, d, fck, N_Ed, rho_l } = params;
        const fcdV = fcd(fck);
        const u0 = 2 * (a + b);
        const Aire = A * B;

        const v_Rd_max = 0.4 * nu1(fck) * fcdV;                    // MPa
        const v_Ed0 = (d > 0 && u0 > 0) ? (N_Ed / 1000) / (u0 * d) : Infinity;

        const k = d > 0 ? Math.min(1 + Math.sqrt(200 / (d * 1000)), 2.0) : 1;
        const rho = Math.min(Math.max(rho_l || 0, 0), 0.02);
        const C_Rdc = 0.18 / MAT.gammaC;
        let worst = { ratio: 0, a_crit: 0, v_Ed: 0, v_Rd: 0 };

        for (let i = 1; i <= 8 && d > 0; i++) {
            const acr = (2 * d) * (i / 8);
            const u = 2 * (a + b) + 2 * Math.PI * acr;
            const Aint = (a + 2 * acr) * (b + 2 * acr) - (4 - Math.PI) * acr * acr;
            const N_red = N_Ed * Math.max(0, 1 - Math.min(1, Aint / Aire));
            const v_Ed = (N_red / 1000) / (u * d);
            const v_Rd = Math.max(
                C_Rdc * k * Math.pow(100 * rho * fck, 1 / 3),
                vMin(k, fck, 'semelle')
            ) * (2 * d / acr);
            const ratio = v_Rd > 0 ? v_Ed / v_Rd : Infinity;
            if (ratio > worst.ratio) {
                worst = { ratio: ratio, a_crit: acr, v_Ed: v_Ed, v_Rd: v_Rd };
            }
        }

        return {
            u0: u0, v_Ed0: v_Ed0, v_Rd_max: v_Rd_max,
            ratio_u0: v_Rd_max > 0 ? v_Ed0 / v_Rd_max : Infinity,
            ratio_u1: worst.ratio, a_crit: worst.a_crit,
            v_Ed: worst.v_Ed, v_Rd: worst.v_Rd,
            ok: worst.ratio <= 1 && v_Ed0 <= v_Rd_max
        };
    }

    // =====================================================================
    // 14. MODULE SEMELLE ISOLÉE — méthode des bielles + poinçonnement
    // =====================================================================

    function semelleIsolee(raw) {
        const w = [];
        const checks = [];
        const a = num(raw.a, 0.3, 0.05, 5);
        const b = num(raw.b, 0.3, 0.05, 5);
        const A = num(raw.A, 1.5, 0.2, 20);
        const B = num(raw.B, 1.5, 0.2, 20);
        const h = num(raw.h, 0.4, 0.10, 5);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const q_adm = num(raw.q_adm, 0.25, 0.01, 10);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const N_Eq = num(raw.N_Eq, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 5, 1, 15);
        const diamA = num(raw.diamA, 12, 6, 40);
        const diamB = num(raw.diamB, 12, 6, 40);
        const secA = (raw.sectionA !== undefined) ? raw.sectionA : sectionBarre(diamA);
        const secB = (raw.sectionB !== undefined) ? raw.sectionB : sectionBarre(diamB);
        const exposition = EXPOSITIONS[raw.exposition] ? raw.exposition : 'XC2';
        const contactSol = raw.contactSol === 'sol' ? 'sol' : 'proprete';

        const c_m = enrobage / 100;
        const fydV = fyd(MAT.fyk);
        const fyd_cm2 = fydV / 10;

        if (A < a || B < b) {
            push(w, 'error', "Les dimensions de la semelle sont inférieures à celles du poteau.");
        }

        // --- A. Portance du sol (ELS) ---
        const poidsPropre = A * B * h * MAT.gammaBeton;
        const sigma_sol = (N_Eq + poidsPropre) / (A * B * 1000); // MPa
        const okPortance = sigma_sol <= q_adm;
        if (!okPortance) {
            push(w, 'error', "σ_sol = " + sigma_sol.toFixed(3) + " MPa > q_adm = " + q_adm.toFixed(3) +
                " MPa : agrandir la semelle.");
        }

        // --- B. Condition de rigidité (méthode des bielles) ---
        const d_req_A = (A - a) / 4;
        const d_req_B = (B - b) / 4;
        const d_req = Math.max(d_req_A, d_req_B);
        const phi_A = diamA / 1000;
        const phi_B = diamB / 1000;
        const d_A = h - c_m - phi_A / 2;
        const d_B = h - c_m - phi_A - phi_B / 2;
        if (d_B <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage dépasse la hauteur de la semelle.");
        }
        const rigide = d_A >= d_req_A && d_B >= d_req_B;
        if (!rigide) {
            push(w, 'warn', "d < (dimension − poteau)/4 : la semelle est souple, le modèle de " +
                "bielles n'est plus applicable. Il faudrait la calculer en flexion (console) " +
                "ou augmenter h.");
        }

        // --- C. Ferraillage par la méthode des bielles (ELU) ---
        const As_A_req_calc = d_A > 0 ? (N_Ed * (A - a)) / (8 * d_A * fydV) * 10 : 0;
        const As_B_req_calc = d_B > 0 ? (N_Ed * (B - b)) / (8 * d_B * fydV) * 10 : 0;
        const As_A_min = AsMinFlexion(B, d_A, fck, MAT.fyk);
        const As_B_min = AsMinFlexion(A, d_B, fck, MAT.fyk);
        const As_A_req = Math.max(As_A_req_calc, As_A_min);
        const As_B_req = Math.max(As_B_req_calc, As_B_min);

        // --- D. Choix des barres (espacement constructif <= 30 cm) ---
        const largeurA = Math.max(0.01, B - 2 * c_m) * 100;
        const largeurB = Math.max(0.01, A - 2 * c_m) * 100;
        const NB_MAX = 200;
        const nb_A = Math.min(NB_MAX, Math.max(Math.ceil(As_A_req / secA), Math.ceil(largeurA / 30) + 1, 2));
        const nb_B = Math.min(NB_MAX, Math.max(Math.ceil(As_B_req / secB), Math.ceil(largeurB / 30) + 1, 2));
        const As_A_prov = nb_A * secA;
        const As_B_prov = nb_B * secB;
        const esp_A = largeurA / (nb_A - 1);
        const esp_B = largeurB / (nb_B - 1);
        const okAcier = As_A_prov >= As_A_req && As_B_prov >= As_B_req;
        const espLibreMin_cm = espacementLibreMin(Math.max(diamA, diamB), 20) / 10;
        const espLibre_cm = Math.min(esp_A - diamA / 10, esp_B - diamB / 10);

        // --- E. Poinçonnement (§6.4) ---
        const d_moy = (d_A + d_B) / 2;
        const rho_A = (B > 0 && d_A > 0) ? (As_A_prov / 10000) / (B * d_A) : 0;
        const rho_B = (A > 0 && d_B > 0) ? (As_B_prov / 10000) / (A * d_B) : 0;
        const rho_moy = Math.sqrt(Math.max(0, rho_A * rho_B));
        const poinc = poinconnement({
            a: a, b: b, A: A, B: B, d: d_moy, fck: fck, N_Ed: N_Ed, rho_l: rho_moy
        });
        if (poinc.ratio_u0 > 1) {
            push(w, 'error', "Poinçonnement au nu du poteau : v_Ed = " + poinc.v_Ed0.toFixed(2) +
                " MPa > v_Rd,max = " + poinc.v_Rd_max.toFixed(2) + " MPa (EC2 §6.4.5).");
        }
        if (poinc.ratio_u1 > 1) {
            push(w, 'error', "Poinçonnement : v_Ed = " + poinc.v_Ed.toFixed(2) + " MPa > v_Rd,c = " +
                poinc.v_Rd.toFixed(2) + " MPa sur le périmètre situé à " +
                (poinc.a_crit * 100).toFixed(0) + " cm du poteau. Augmenter h (EC2 §6.4.4).");
        }

        // --- F. Enrobage et ancrages ---
        const enr = enrobageNominal({ exposition: exposition, fck: fck, phi: Math.max(diamA, diamB),
                                      duree100: raw.duree100, contactSol: contactSol });
        const ancA = ancrage({ phi: diamA, fck: fck, cd: c_m * 1000 });
        const ancB = ancrage({ phi: diamB, fck: fck, cd: c_m * 1000 });
        // Longueur disponible au-delà du nu du poteau (débord) : si l_bd la dépasse,
        // les barres doivent être ancrées par crochets (§9.8.2.2).
        const debordA = ((A - a) / 2 - c_m) * 1000;
        const debordB = ((B - b) / 2 - c_m) * 1000;

        // --- Statut (par ordre de gravité) ---
        let status = 'OK';
        if (!okPortance) status = 'ERROR_BEARING';
        else if (!poinc.ok) status = 'ERROR_PUNCHING';
        else if (!okAcier) status = 'ERROR_STEEL';
        else if (!rigide) status = 'WARNING_FLEXIBLE';

        addCheck(checks, 'Portance du sol (ELS)', 'EC7 (contrainte admissible)',
            'σ ≤ ' + f2(q_adm, 3) + ' MPa', f2(sigma_sol, 3) + ' MPa', okPortance, true);
        addCheck(checks, 'Poinçonnement au nu du poteau', '§6.4.5(3)',
            'v ≤ ' + f2(poinc.v_Rd_max) + ' MPa', f2(poinc.v_Ed0) + ' MPa', poinc.ratio_u0 <= 1, true);
        addCheck(checks, 'Poinçonnement (périmètres jusqu\'à 2d)', '§6.4.4(2)',
            'v ≤ ' + f2(poinc.v_Rd) + ' MPa', f2(poinc.v_Ed) + ' MPa', poinc.ratio_u1 <= 1, true);
        addCheck(checks, 'Nappe inférieure // A', 'Bielles / §9.2.1.1',
            '≥ ' + f2(As_A_req) + ' cm²', nb_A + ' HA' + diamA + ' = ' + f2(As_A_prov) + ' cm²',
            As_A_prov >= As_A_req, true);
        addCheck(checks, 'Second lit inférieur // B', 'Bielles / §9.2.1.1',
            '≥ ' + f2(As_B_req) + ' cm²', nb_B + ' HA' + diamB + ' = ' + f2(As_B_prov) + ' cm²',
            As_B_prov >= As_B_req, true);
        addCheck(checks, 'Espacement libre des barres', '§8.2(2)',
            '≥ ' + f2(espLibreMin_cm, 1) + ' cm', f2(espLibre_cm, 1) + ' cm',
            espLibre_cm >= espLibreMin_cm, true);
        addCheck(checks, 'Rigidité (domaine des bielles)', 'd ≥ (A−a)/4',
            'd ≥ ' + f2(d_req, 3) + ' m', f2(Math.min(d_A, d_B), 3) + ' m', rigide, false);
        addCheck(checks, 'Enrobage nominal (' + exposition +
            (contactSol === 'sol' ? ', contre le sol' : ', sur béton de propreté') + ')', '§4.4.1',
            'c ≥ ' + f2(enr.c_nom / 10, 1) + ' cm', f2(enrobage, 1) + ' cm',
            enrobage * 10 >= enr.c_nom - 1e-6, true);

        push(w, 'info', "Poinçonnement vérifié avec β = 1.0 (charge centrée sans moment) : " +
            "taux de travail maximal " + (poinc.ratio_u1 * 100).toFixed(0) + " % à " +
            (poinc.a_crit * 100).toFixed(0) + " cm du poteau (EC2 §6.4.4).");
        if (ancA.lbd > debordA || ancB.lbd > debordB) {
            push(w, 'info', "l_bd = " + Math.max(ancA.lbd, ancB.lbd).toFixed(0) + " mm dépasse le " +
                "débord disponible : prévoir des crochets d'extrémité (EC2 §9.8.2.2).");
        }
        push(w, 'warn', "Charge supposée strictement centrée : ni moment, ni effort horizontal, " +
            "ni soulèvement ne sont pris en compte. La portance est vérifiée à l'ELS " +
            "uniquement (approche « contrainte admissible »), pas selon l'EC7.");

        return {
            sigma_sol: sigma_sol, d_req: d_req, d_A: d_A, d_B: d_B,
            d_req_A: d_req_A, d_req_B: d_req_B,
            As_A_req_calc: As_A_req_calc, As_B_req_calc: As_B_req_calc,
            As_A_req: As_A_req, As_B_req: As_B_req, As_A_min: As_A_min, As_B_min: As_B_min,
            As_A_prov: As_A_prov, As_B_prov: As_B_prov, nb_A: nb_A, nb_B: nb_B,
            esp_A: esp_A, esp_B: esp_B, status: status, poidsPropre: poidsPropre,
            weight: poidsPropre,
            fyd: fydV, fyd_cm2: fyd_cm2, fcd: fcd(fck), fctm: fctm(fck),
            d_moy: d_moy, poinconnement: poinc, rho_moy: rho_moy,
            enrobage: { requis: enr.c_nom, detail: enr },
            ancrage: { A: ancA, B: ancB, debordA: debordA, debordB: debordB },
            warnings: w, checks: checks,
            inputs: { a: a, b: b, A: A, B: B, h: h, fck: fck, q_adm: q_adm,
                      N_Ed: N_Ed, N_Eq: N_Eq, enrobage: enrobage, exposition: exposition,
                      contactSol: contactSol }
        };
    }

    // =====================================================================
    // 15. MODULE SEMELLE FILANTE — bande de 1 m sous voile
    // =====================================================================

    function semelleFilante(raw) {
        const w = [];
        const checks = [];
        const a = num(raw.a, 0.2, 0.05, 5);
        const B = num(raw.B, 1.0, 0.2, 20);
        const h = num(raw.h, 0.3, 0.10, 5);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const q_adm = num(raw.q_adm, 0.25, 0.01, 10);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const N_Eq = num(raw.N_Eq, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 5, 1, 15);
        const espMain = num(raw.espMain, 15, 4, 60);
        const espRep = num(raw.espRep, 20, 4, 60);
        const diamMain = num(raw.diamMain, 12, 6, 40);
        const diamRep = num(raw.diamRep, 8, 6, 40);
        const secMain = (raw.sectionMain !== undefined) ? raw.sectionMain : sectionBarre(diamMain);
        const secRep = (raw.sectionRep !== undefined) ? raw.sectionRep : sectionBarre(diamRep);
        const exposition = EXPOSITIONS[raw.exposition] ? raw.exposition : 'XC2';
        const contactSol = raw.contactSol === 'sol' ? 'sol' : 'proprete';

        const c_nom = enrobage / 100;
        const fydV = fyd(MAT.fyk);

        if (B < a) {
            push(w, 'error', "La largeur de semelle B est inférieure à l'épaisseur du voile a.");
        }

        // --- A. Portance du sol (ELS) ---
        const poidsPropre = B * 1.0 * h * MAT.gammaBeton;
        const sigma_sol = (N_Eq + poidsPropre) / (B * 1.0 * 1000);
        const okPortance = sigma_sol <= q_adm;
        if (!okPortance) {
            push(w, 'error', "σ_sol = " + sigma_sol.toFixed(3) + " MPa > q_adm = " + q_adm.toFixed(3) +
                " MPa : élargir la semelle.");
        }

        // --- B. Rigidité (méthode des bielles) ---
        const d_req = (B - a) / 4;
        const d = h - c_nom - (diamMain / 1000) / 2;
        if (d <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage dépasse la hauteur de la semelle.");
        }
        const rigide = d >= d_req;
        if (!rigide) {
            push(w, 'warn', "d = " + d.toFixed(3) + " m < (B − a)/4 = " + d_req.toFixed(3) +
                " m : semelle souple, le modèle de bielles ne s'applique plus.");
        }

        // --- C. Ferraillage transversal (méthode des bielles) ---
        const As_req_calc = (B > a && d > 0) ? (N_Ed * (B - a)) / (8 * d * fydV) * 10 : 0;
        const As_min = AsMinFlexion(1.0, d, fck, MAT.fyk);
        const As_req = Math.max(As_req_calc, As_min);
        const As_rep_req = 0.20 * As_req;

        const As_prov_main = (100 / espMain) * secMain;
        const As_prov_rep = (100 / espRep) * secRep;
        const okAcier = As_prov_main >= As_req && As_prov_rep >= As_rep_req;
        if (!okAcier) {
            push(w, 'error', "Section d'acier fournie insuffisante : " + As_prov_main.toFixed(2) +
                " cm²/ml disposés pour " + As_req.toFixed(2) + " cm²/ml requis (répartition : " +
                As_prov_rep.toFixed(2) + " pour " + As_rep_req.toFixed(2) + " cm²/ml).");
        }

        // --- D. Effort tranchant à la distance d du nu du voile (§6.2.2) ---
        // Vérifié dans tous les cas : c'est précisément pour une semelle souple qu'il
        // devient déterminant, il ne doit donc jamais être masqué par un autre statut.
        const sigma_elu = B > 0 ? N_Ed / B : 0;               // kN/m² sur 1 ml
        const porte_a_faux = Math.max(0, (B - a) / 2 - d);    // m
        const V_Ed = sigma_elu * porte_a_faux;                // kN/ml
        const rho_l = d > 0 ? Math.min((As_prov_main / 10000) / (1.0 * d), 0.02) : 0;
        const vrdc = VRdc(1.0, d, fck, rho_l, 0, 'semelle');
        const okTranchant = V_Ed <= vrdc.V_Rdc;
        if (!okTranchant) {
            push(w, 'error', "V_Ed = " + V_Ed.toFixed(1) + " kN/ml > V_Rd,c = " + vrdc.V_Rdc.toFixed(1) +
                " kN/ml à la distance d du nu du voile : augmenter h (EC2 §6.2.2).");
        }

        const esp_max = Math.min(3 * h * 100, 40);
        const espLibreMin_cm = espacementLibreMin(diamMain, 20) / 10;
        const espLibre_cm = espMain - diamMain / 10;

        // --- E. Enrobage et ancrages ---
        const enr = enrobageNominal({ exposition: exposition, fck: fck, phi: diamMain,
                                      duree100: raw.duree100, contactSol: contactSol });
        const anc = ancrage({ phi: diamMain, fck: fck, cd: c_nom * 1000 });
        const debord = ((B - a) / 2 - c_nom) * 1000;

        // --- Statut (par ordre de gravité) ---
        let status = 'OK';
        if (!okPortance) status = 'ERROR_BEARING';
        else if (!okTranchant) status = 'ERROR_SHEAR';
        else if (!okAcier) status = 'ERROR_STEEL';
        else if (!rigide) status = 'WARNING_FLEXIBLE';

        addCheck(checks, 'Portance du sol (ELS)', 'EC7 (contrainte admissible)',
            'σ ≤ ' + f2(q_adm, 3) + ' MPa', f2(sigma_sol, 3) + ' MPa', okPortance, true);
        addCheck(checks, 'Effort tranchant à d du nu du voile', '§6.2.2',
            'V_Ed ≤ ' + f2(vrdc.V_Rdc, 1) + ' kN/ml', f2(V_Ed, 1) + ' kN/ml', okTranchant, true);
        addCheck(checks, 'Armatures transversales principales', 'Bielles / §9.2.1.1',
            '≥ ' + f2(As_req) + ' cm²/ml', f2(As_prov_main) + ' cm²/ml', As_prov_main >= As_req, true);
        addCheck(checks, 'Armatures longitudinales de répartition', '20 % du principal',
            '≥ ' + f2(As_rep_req) + ' cm²/ml', f2(As_prov_rep) + ' cm²/ml', As_prov_rep >= As_rep_req, true);
        addCheck(checks, 'Espacement libre des barres principales', '§8.2(2)',
            '≥ ' + f2(espLibreMin_cm, 1) + ' cm', f2(espLibre_cm, 1) + ' cm',
            espLibre_cm >= espLibreMin_cm, true);
        addCheck(checks, 'Espacement maximal des barres principales', 'Disposition constructive',
            '≤ ' + f2(esp_max, 0) + ' cm', f2(espMain, 0) + ' cm', espMain <= esp_max, false);
        addCheck(checks, 'Rigidité (domaine des bielles)', 'd ≥ (B−a)/4',
            'd ≥ ' + f2(d_req, 3) + ' m', f2(d, 3) + ' m', rigide, false);
        addCheck(checks, 'Enrobage nominal (' + exposition +
            (contactSol === 'sol' ? ', contre le sol' : ', sur béton de propreté') + ')', '§4.4.1',
            'c ≥ ' + f2(enr.c_nom / 10, 1) + ' cm', f2(enrobage, 1) + ' cm',
            enrobage * 10 >= enr.c_nom - 1e-6, true);

        if (anc.lbd > debord) {
            push(w, 'info', "l_bd = " + anc.lbd.toFixed(0) + " mm dépasse le débord disponible (" +
                Math.max(0, debord).toFixed(0) + " mm) : prévoir des crochets d'extrémité (EC2 §9.8.2.2).");
        }
        push(w, 'warn', "Charge supposée centrée sur la semelle : aucun moment ni effort " +
            "horizontal n'est pris en compte. La portance est vérifiée à l'ELS uniquement.");

        return {
            sigma_sol: sigma_sol, d_req: d_req, d: d, As_req_calc: As_req_calc,
            As_req: As_req, As_rep_req: As_rep_req, As_min: As_min,
            As_prov_main: As_prov_main, As_prov_rep: As_prov_rep, status: status,
            fyd: fydV, fyd_cm2: fydV / 10, fcd: fcd(fck), fctm: fctm(fck),
            poidsPropre: poidsPropre, weight: poidsPropre, V_Ed: V_Ed, V_Rdc: vrdc.V_Rdc,
            sigma_elu: sigma_elu, k: vrdc.k, rho_l: vrdc.rho_l, esp_max: esp_max,
            enrobage: { requis: enr.c_nom, detail: enr },
            ancrage: { principal: anc, debord: debord },
            warnings: w, checks: checks,
            inputs: { a: a, B: B, h: h, fck: fck, q_adm: q_adm, N_Ed: N_Ed,
                      N_Eq: N_Eq, enrobage: enrobage, espMain: espMain, espRep: espRep,
                      exposition: exposition, contactSol: contactSol }
        };
    }

    // =====================================================================
    // 16. API PUBLIQUE
    // =====================================================================

    return {
        MAT: MAT, MU_LIMIT: MU_LIMIT, MU_DUCTILE: MU_DUCTILE, EXPOSITIONS: EXPOSITIONS,
        fcd: fcd, fyd: fyd, fctm: fctm, fctk005: fctk005, Ecm: Ecm, nu1: nu1,
        sigmaSc: sigmaSc, sectionBarre: sectionBarre,
        num: num, verdict: verdict,
        flexionSimple: flexionSimple, AsMinFlexion: AsMinFlexion, vMin: vMin, VRdc: VRdc,
        elancementFleche: elancementFleche, espacementLibreMin: espacementLibreMin,
        enrobageNominal: enrobageNominal, ancrage: ancrage,
        sectionFissuree: sectionFissuree, verifELS: verifELS,
        sectionNM: sectionNM, momentSecondOrdre: momentSecondOrdre, litsPoteau: litsPoteau,
        poinconnement: poinconnement,
        poutre: poutre, dalle: dalle, poteau: poteau, poteauNRd: poteauNRd, poteauVerif: poteauVerif,
        voile: voile, semelleIsolee: semelleIsolee, semelleFilante: semelleFilante
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EC2;
}
if (typeof window !== 'undefined') {
    window.EC2 = EC2;
}
