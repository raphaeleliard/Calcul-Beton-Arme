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
 * lambda = 0.8 et eta = 1.0 du diagramme rectangulaire, ainsi que la
 * relation fctm = 0.30*fck^(2/3), ne sont valables que dans ce domaine).
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
        alphaCw: 1.0,     // Coefficient d'état de contrainte des bielles (§6.2.3)
        fyk: 500,         // Acier S500 (§3.2)
        Es: 200000,       // Module d'élasticité de l'acier (MPa)
        epsC2: 0.002,     // Raccourcissement en compression pure (§3.1.7)
        gammaBeton: 25,   // Poids volumique du béton armé (kN/m³)
        fckMax: 50        // Limite du domaine de validité des formules employées
    };

    // Limite du moment réduit pour l'acier S500 sans armatures comprimées.
    // mu_AB = 0.8*alpha_AB*(1-0.4*alpha_AB) avec alpha_AB = eps_cu2/(eps_cu2+eps_yd)
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
    /** Module sécant du béton (Tab. 3.1) */
    const Ecm = (fck) => 22000 * Math.pow((fck + 8) / 10, 0.3);
    /** Facteur de réduction de résistance du béton fissuré à l'effort tranchant (§6.2.2(6)) */
    const nu1 = (fck) => 0.6 * (1 - fck / 250);
    /**
     * Contrainte maximale mobilisable dans un acier COMPRIMÉ.
     * En compression le raccourcissement du béton est plafonné à eps_c2 = 2 ‰,
     * l'acier ne peut donc pas dépasser Es * eps_c2 = 400 MPa pour du S500 (§6.1).
     */
    const sigmaSc = (fyk) => Math.min(fyd(fyk), MAT.Es * MAT.epsC2);

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

    // =====================================================================
    // 4. VÉRIFICATIONS RÉGLEMENTAIRES ÉLÉMENTAIRES
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
            return { mu: mu, alpha: 0, z: d * (1 - 0.4 * 0.45), As: 0, depasse: true };
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
     * Effort tranchant résistant sans armatures d'effort tranchant (§6.2.2(1)).
     * @param {number} b largeur (m), @param {number} d hauteur utile (m)
     * @param {number} rho_l ratio d'armatures tendues (sans dimension)
     * @param {number} sigma_cp contrainte moyenne de compression (MPa, >= 0)
     * @returns {{V_Rdc:number, v_Rdc:number, v_min:number, k:number, rho_l:number}}
     *          V_Rdc en kN
     */
    function VRdc(b, d, fck, rho_l, sigma_cp) {
        const scp = Math.max(0, sigma_cp || 0);
        if (!(b > 0) || !(d > 0)) {
            return { V_Rdc: 0, v_Rdc: 0, v_min: 0, k: 0, rho_l: 0, V_Rdc_calc: 0, V_Rdc_min: 0 };
        }
        const k = Math.min(1 + Math.sqrt(200 / (d * 1000)), 2.0);
        const rho = Math.min(Math.max(rho_l || 0, 0), 0.02);
        const C_Rdc = 0.18 / MAT.gammaC;
        const k1 = 0.15; // Annexe Nationale française
        const v_min = 0.035 * Math.pow(k, 1.5) * Math.sqrt(fck);
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
        // Correction de contrainte : 310/sigma_s = (500/fyk)*(As,prov/As,req), plafonnée à 1.5
        let corr = 1.0;
        if (AsReq > 0 && AsProv > 0) {
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
    // 5. MODULE POUTRE — flexion simple + effort tranchant (ELU)
    // =====================================================================

    /**
     * @param {object} raw {L, b, h, G, Q, fck, diameter, c_nom, phi_t, nbBarres}
     */
    function poutre(raw) {
        const w = [];
        const L = num(raw.L, 5, 0.5, 100);
        const b = num(raw.b, 0.2, 0.05, 10);
        const h = num(raw.h, 0.5, 0.05, 10);
        const G = num(raw.G, 0, 0, 1e6);
        const Q = num(raw.Q, 0, 0, 1e6);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const phi_l = num(raw.diameter, 10, 6, 40) / 1000;
        const phi_t = num(raw.phi_t, 0.008, 0.004, 0.02);
        const c_nom = num(raw.c_nom, 0.03, 0.01, 0.20);
        const nbBarres = Math.max(1, Math.round(num(raw.nbBarres, 1, 1, 60)));

        const fcdV = fcd(fck);
        const fydV = fyd(MAT.fyk);
        const fyd_cm2 = fydV / 10;

        // --- Sollicitations (poutre isostatique sur deux appuis simples) ---
        const p_elu = 1.35 * G + 1.5 * Q;
        const Med = (p_elu * L * L) / 8;
        const Ved = (p_elu * L) / 2;

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

        let status = 'OK';
        let As_req = 0;
        if (fx.depasse) {
            status = 'ERROR_MUCU';
            push(w, 'error', "μ_cu = " + (isFinite(fx.mu) ? fx.mu.toFixed(3) : '—') +
                " > " + MU_LIMIT + " : la section béton est insuffisante, il faudrait des " +
                "armatures comprimées (cas non traité par l'outil).");
        } else {
            As_req = Math.max(fx.As, As_min);
            if (fx.mu > MU_DUCTILE) {
                push(w, 'warn', "μ_cu = " + fx.mu.toFixed(3) + " > " + MU_DUCTILE +
                    " (x/d > 0.45) : la section reste calculable mais sa ductilité est faible. " +
                    "Augmenter h est préférable (EC2 §5.5).");
            }
            if (As_req > As_max) {
                push(w, 'error', "A_s requis (" + As_req.toFixed(2) + " cm²) supérieur au maximum " +
                    "réglementaire A_s,max = 4 % A_c = " + As_max.toFixed(2) + " cm² (EC2 §9.2.1.1(3)).");
            }
        }
        const z = fx.z;

        // --- Effort tranchant (§6.2) ---
        // Bielle d'about la plus sollicitée : theta = 45° maximise V_Rd,max.
        const nu = nu1(fck);
        const Vrd_max_45 = (MAT.alphaCw * b * z * nu * fcdV) / 2 * 1000; // kN

        // Armatures réellement mises en place (pour rho_l de V_Rd,c)
        const As_prov = num(raw.As_prov, 0, 0, 1e6);
        const rho_l = (b > 0 && d > 0) ? Math.min((As_prov / 10000) / (b * d), 0.02) : 0;
        const vrdc = VRdc(b, d, fck, rho_l, 0);

        // Effort tranchant à une distance d du nu d'appui (§6.2.1(8))
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
                // §6.2.1(5) : aucune armature d'effort tranchant calculée n'est nécessaire,
                // mais le ferraillage minimal de §9.2.2 reste dû pour une poutre.
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

        // Espacement longitudinal maximal des cadres (§9.2.2(6))
        const s_max_cadres = Math.min(0.75 * d, 0.6) * 100; // cm
        // Espacement pratique correspondant à un cadre HA8 à 2 brins (2 x 0.503 cm²)
        const s_cadre_prop = Asw_s > 0 ? Math.min((2 * 0.503 / Asw_s) * 100, s_max_cadres) : s_max_cadres;

        // --- Vérification de flèche (§7.4.2) : poutre isostatique => K = 1.0 ---
        const rho_fleche = (b > 0 && d > 0) ? (As_req / 10000) / (b * d) : 0;
        const fleche = elancementFleche(L, d, fck, rho_fleche, 1.0, As_req, As_prov, MAT.fyk);
        if (status === 'OK' && rho_fleche > 0 && !fleche.ok) {
            push(w, 'warn', "Élancement L/d = " + fleche.reel.toFixed(1) + " > limite " +
                fleche.limite.toFixed(1) + " : la flèche risque d'être excessive à l'ELS " +
                "(EC2 §7.4.2). Augmenter h ou la section d'acier.");
        }

        // --- Encombrement des barres sur un seul lit (§8.2) ---
        const dispo_mm = (b - 2 * c_nom - 2 * phi_t) * 1000;
        const espLibre = nbBarres > 1
            ? (dispo_mm - nbBarres * phi_l * 1000) / (nbBarres - 1)
            : dispo_mm - phi_l * 1000;
        const espLibreMin = espacementLibreMin(phi_l * 1000, 20);

        // --- Informations pédagogiques ---
        const poidsPropre = b * h * MAT.gammaBeton;
        push(w, 'info', "Le poids propre de la poutre (b×h×25 = " + poidsPropre.toFixed(2) +
            " kN/ml) n'est pas ajouté automatiquement : il doit être inclus dans G.");
        if (L > 7) {
            push(w, 'info', "Portée > 7 m : si la poutre supporte des cloisons fragiles, l'EC2 " +
                "§7.4.2(2) impose de réduire la limite L/d dans le rapport 7/L.");
        }

        return {
            // Champs historiques (utilisés par l'UI et la note de calcul PDF)
            Med: Med, Ved: Ved, mu_cu: fx.mu, alpha: fx.alpha, z: z,
            As_req: As_req, Asw_s: Asw_s, status: status, d: d, cotTheta: cotTheta,
            fcd: fcdV, fyd: fydV, fyd_cm2: fyd_cm2, fctm: fctm(fck), p_elu: p_elu,
            Vrd_max_45: Vrd_max_45, As_min: As_min,
            // Nouveaux champs
            As_max: As_max, V_Rdc: vrdc.V_Rdc, Ved_d: Ved_d, Asw_s_min: Asw_s_min,
            cisaillementMinimal: cisaillementMinimal, s_max_cadres: s_max_cadres,
            s_cadre_prop: s_cadre_prop, nu1: nu, rho_l: rho_l,
            fleche: fleche, espLibre: espLibre, espLibreMin: espLibreMin,
            poidsPropre: poidsPropre, warnings: w,
            inputs: { L: L, b: b, h: h, G: G, Q: Q, fck: fck, c_nom: c_nom, phi_t: phi_t }
        };
    }

    // =====================================================================
    // 6. MODULE DALLE PLEINE — bande de 1 m portant sur deux appuis
    // =====================================================================

    function dalle(raw) {
        const w = [];
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
        const secMain = (raw.sectionMain !== undefined)
            ? raw.sectionMain : Math.PI * Math.pow(diamMain / 10, 2) / 4;
        const secRep = (raw.sectionRep !== undefined)
            ? raw.sectionRep : Math.PI * Math.pow(diamRep / 10, 2) / 4;

        const b = 1.0;
        const c_nom = enrobage / 100;
        const fcdV = fcd(fck);
        const fydV = fyd(MAT.fyk);

        const d = h - c_nom - (diamMain / 1000) / 2;
        if (d <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage dépasse l'épaisseur de la dalle.");
        }

        const p_elu = 1.35 * G + 1.5 * Q;
        const Med = (p_elu * L * L) / 8;
        const Ved = (p_elu * L) / 2;

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
        // La condition de non-fragilité (§9.2.1.1) ne porte que sur la nappe principale.
        const As_rep_req = 0.20 * As_prov;

        // Effort tranchant : une dalle courante doit résister sans armatures d'âme (§6.2.2)
        const rho_l = (d > 0) ? Math.min((As_prov / 10000) / (b * d), 0.02) : 0;
        const vrdc = VRdc(b, d, fck, rho_l, 0);
        if (Ved > vrdc.V_Rdc && status !== 'ERROR_MUCU') {
            status = 'ERROR_SHEAR';
            push(w, 'error', "V_Ed = " + Ved.toFixed(1) + " kN/ml > V_Rd,c = " + vrdc.V_Rdc.toFixed(1) +
                " kN/ml : une dalle ne doit pas nécessiter d'armatures d'effort tranchant, " +
                "augmenter h (EC2 §6.2.2).");
        }

        // Espacements maximaux (§9.3.1.1(3)) : zone de moment maximal
        const s_max_main = Math.min(3 * (h * 100), 40);
        const s_max_rep = Math.min(3.5 * (h * 100), 45);
        const esp_net = espacement - diamMain / 10;

        if (As_prov > As_max) {
            push(w, 'error', "Section fournie supérieure à A_s,max = 4 % A_c (EC2 §9.2.1.1(3)).");
        }

        // Flèche (§7.4.2) : dalle isostatique sur deux appuis => K = 1.0
        const rho_fleche = (d > 0) ? (As_req / 10000) / (b * d) : 0;
        const fleche = elancementFleche(L, d, fck, rho_fleche, 1.0, As_req, As_prov, MAT.fyk);
        if (status === 'OK' && rho_fleche > 0 && !fleche.ok) {
            push(w, 'warn', "Élancement L/d = " + fleche.reel.toFixed(1) + " > limite " +
                fleche.limite.toFixed(1) + " : la flèche à l'ELS sera probablement excessive " +
                "(EC2 §7.4.2). C'est très souvent ce critère qui dimensionne l'épaisseur d'une dalle.");
        }

        const poidsPropre = h * MAT.gammaBeton;
        push(w, 'info', "Le poids propre de la dalle (h×25 = " + poidsPropre.toFixed(2) +
            " kN/m²) n'est pas ajouté automatiquement : il doit être inclus dans G.");

        return {
            Med: Med, Ved: Ved, As_req: As_req, As_min: As_min, As_prov: As_prov,
            As_prov_rep: As_prov_rep, As_rep_req: As_rep_req, V_Rdc: vrdc.V_Rdc,
            status: status, s_max_main: s_max_main, s_max_rep: s_max_rep, esp_net: esp_net,
            d: d, p_elu: p_elu, fctm: fctm(fck), fyd: fydV, fcd: fcdV,
            mu_cu: fx.mu, alpha: fx.alpha, z: fx.z, fyd_cm2: fydV / 10,
            k: vrdc.k, rho_l: vrdc.rho_l,
            As_max: As_max, fleche: fleche, poidsPropre: poidsPropre, warnings: w,
            inputs: { L: L, h: h, G: G, Q: Q, fck: fck, enrobage: enrobage,
                      espacementInput: espacement, espRepInput: esp_rep }
        };
    }

    // =====================================================================
    // 7. MODULE POTEAU — compression + flexion composée, effets 2nd ordre
    // =====================================================================

    function poteau(raw) {
        const w = [];
        const L = num(raw.L, 3, 0.3, 50);
        const a = num(raw.a, 0.3, 0.10, 5);
        const b = num(raw.b, 0.3, 0.10, 5);
        const beta = num(raw.beta, 0.7, 0.5, 4);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const fykVal = num(raw.fyk, 500, 400, 600);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const M_Ed = num(raw.M_Ed, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 3, 1, 15);
        const diameter = num(raw.diameter, 12, 6, 40);

        const Ac_m2 = a * b;
        const Ac = Ac_m2 * 10000;         // cm²
        const fcdV = fcd(fck);
        const fydV = fyd(fykVal);
        const fyd_cm2 = fydV / 10;
        const sigmaScV = sigmaSc(fykVal); // MPa, plafonné à 400 MPa pour du S500
        const sigmaSc_cm2 = sigmaScV / 10;

        // --- Flambement (§5.8) ---
        const l0 = beta * L;
        const min_dim = Math.min(a, b);
        const max_dim = Math.max(a, b);
        const I_min = (max_dim * Math.pow(min_dim, 3)) / 12;
        const i_gyr = min_dim / Math.sqrt(12);
        const lambda = l0 / i_gyr;
        const N_cr = (Math.PI * Math.PI * Ecm(fck) * 1000 * I_min) / (l0 * l0); // kN

        // Élancement limite (§5.8.3.1) : lambda_lim = 20*A*B*C/racine(n)
        // A = 0.7 (fluage inconnu), B = 1.1 (omega inconnu), C = 0.7 (rm inconnu)
        const n_rel = N_Ed / (Ac_m2 * fcdV * 1000);
        const lambda_lim = n_rel > 0
            ? (20 * 0.7 * 1.1 * 0.7) / Math.sqrt(n_rel)
            : Infinity;

        // --- Sections d'aciers limites (§9.5.2) ---
        const As_min = Math.max(0.10 * N_Ed / fyd_cm2, 0.002 * Ac);
        const As_max = 0.04 * Ac;

        // --- Hauteur utile dans le PLAN DE FLAMBEMENT ---
        // Le flambement se produit autour de l'axe faible : la hauteur de section
        // à considérer est donc min(a, b), et non max(a, b).
        const c_nom = enrobage / 100;
        const phi_l = diameter / 1000;
        const phi_t = 0.008;
        const h_dir = min_dim;
        const d = h_dir - c_nom - phi_t - phi_l / 2;
        if (d <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage dépasse la plus petite " +
                "dimension du poteau.");
        }

        // --- Excentricités ---
        // Imperfections géométriques (§5.2) : e_i = theta_i * l0 / 2, theta_i = theta_0 * alpha_h
        const alpha_h = Math.min(1, Math.max(2 / 3, 2 / Math.sqrt(Math.max(L, 0.01))));
        const e_i_geo = (1 / 200) * alpha_h * l0 / 2;
        // Excentricité minimale (§6.1(4)) : e_0 >= max(h/30 ; 20 mm)
        const e_0_min = Math.max(h_dir / 30, 0.02);
        const e_i = Math.max(e_i_geo, e_0_min);
        const e_M = N_Ed > 0 ? M_Ed / N_Ed : 0;

        // --- Effets du second ordre : méthode de la courbure nominale (§5.8.8) ---
        let e_2 = 0;
        const secondOrdre = lambda > lambda_lim;
        if (secondOrdre && d > 0) {
            // 1/r = K_r * K_phi * (f_yd / E_s) / (0.45 d) ; K_r = K_phi = 1 (hypothèse
            // sécuritaire : pas de prise en compte du fluage ni du taux d'acier réel)
            const courbure = (fydV / MAT.Es) / (0.45 * d);
            e_2 = courbure * l0 * l0 / 10;
            push(w, 'info', "λ = " + lambda.toFixed(1) + " > λ_lim = " + lambda_lim.toFixed(1) +
                " : les effets du second ordre sont pris en compte (e₂ = " +
                (e_2 * 1000).toFixed(0) + " mm, EC2 §5.8.8).");
        } else if (isFinite(lambda_lim)) {
            push(w, 'info', "λ = " + lambda.toFixed(1) + " ≤ λ_lim = " + lambda_lim.toFixed(1) +
                " : les effets du second ordre peuvent être négligés (EC2 §5.8.3.1).");
        }
        if (lambda > 150) {
            push(w, 'warn', "λ = " + lambda.toFixed(1) + " > 150 : poteau très élancé, hors du " +
                "domaine d'application courant de la méthode simplifiée.");
        }

        const e_tot = e_M + e_i + e_2;
        const M_Ed_tot = N_Ed * e_tot;

        // --- Sections d'acier requises (méthode simplifiée à bras de levier constant) ---
        const N_Rd_c = Ac * (fcdV / 10); // kN, béton seul
        const As_req_N = Math.max(0, (N_Ed - N_Rd_c) / sigmaSc_cm2);
        const z = d - (c_nom + phi_t + phi_l / 2);
        let As_req_M = 0;
        if (M_Ed_tot > 0 && z > 0.001) {
            As_req_M = M_Ed_tot / (z * fyd_cm2);
        }
        let As_req = Math.max(As_req_N + As_req_M, As_min);

        if (As_req > As_max) {
            push(w, 'error', "A_s requis (" + As_req.toFixed(2) + " cm²) > A_s,max = 4 % A_c = " +
                As_max.toFixed(2) + " cm² : la section de béton est insuffisante (EC2 §9.5.2).");
        }
        if (e_tot > h_dir / 4) {
            push(w, 'warn', "Excentricité totale e = " + (e_tot * 100).toFixed(1) + " cm > h/4 : " +
                "la méthode simplifiée à bras de levier constant devient imprécise, " +
                "un diagramme d'interaction N–M serait nécessaire.");
        }
        push(w, 'info', "La contrainte des aciers comprimés est plafonnée à " + sigmaScV.toFixed(0) +
            " MPa (ε_c2 = 2 ‰), et non à f_yd = " + fydV.toFixed(0) + " MPa (EC2 §6.1).");

        return {
            l0: l0, lambda: lambda, N_cr: N_cr, e_tot: e_tot, e_2: e_2, e_i: e_i, e_M: e_M,
            i_gyr: i_gyr, max_dim: max_dim, As_req: As_req, As_req_N: As_req_N,
            As_req_M: As_req_M, As_min: As_min, As_max: As_max, fcd: fcdV,
            fyd_cm2: fyd_cm2, Ac: Ac, N_Rd_c: N_Rd_c, d: d, z: z, M_Ed_tot: M_Ed_tot,
            // Nouveaux champs
            lambda_lim: lambda_lim, n_rel: n_rel, secondOrdre: secondOrdre,
            min_dim: min_dim, h_dir: h_dir, e_i_geo: e_i_geo, e_0_min: e_0_min,
            alpha_h: alpha_h, sigma_sc: sigmaScV, sigma_sc_cm2: sigmaSc_cm2,
            warnings: w,
            inputs: { L: L, a: a, b: b, beta: beta, fck: fck, fyk: fykVal,
                      N_Ed: N_Ed, M_Ed: M_Ed, enrobage: enrobage }
        };
    }

    /** Effort normal résistant du poteau avec les aciers réellement disposés (kN). */
    function poteauNRd(res, As_chosen_cm2) {
        return res.N_Rd_c + As_chosen_cm2 * res.sigma_sc_cm2;
    }

    // =====================================================================
    // 8. MODULE VOILE — bande de 1 m, compression + cisaillement hors-plan
    // =====================================================================

    function voile(raw) {
        const w = [];
        const h = num(raw.h, 0.20, 0.05, 2);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const V_Ed = num(raw.V_Ed, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 3, 1, 15);
        const nappesCount = num(raw.nappesCount, 2, 1, 2) >= 2 ? 2 : 1;
        const phi_ts = num(raw.tsDiam, 7, 3, 20) / 1000;
        const sec_ts_long = num(raw.tsSection, 2.57, 0.1, 100);      // cm²/m sens porteur
        const sec_ts_trans = num(raw.tsSectionT, sec_ts_long, 0.1, 100); // cm²/m sens transversal

        const b = 1.0;
        const c_nom = enrobage / 100;
        const Ac_m2 = b * h;
        const Ac = Ac_m2 * 10000; // cm²/ml (même unité que le module poteau)
        const fcdV = fcd(fck);
        const sigmaScV = sigmaSc(MAT.fyk);

        let d = h - c_nom - phi_ts / 2;
        if (nappesCount === 1) d = h / 2;
        if (d <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage dépasse l'épaisseur du voile.");
        }

        // --- Armatures minimales (§9.6.2 et §9.6.3) ---
        const As_vmin = 0.002 * Ac;                    // cm²/ml, toutes nappes confondues
        const As_v_prov = sec_ts_long * nappesCount;
        const As_h_prov = sec_ts_trans * nappesCount;
        const As_hmin = Math.max(0.25 * As_v_prov, 0.001 * Ac);
        const As_req = As_vmin;
        const As_prov = As_v_prov;

        // --- Compression : contrainte moyenne et résistance ---
        const sigma_cp_calc = N_Ed / (Ac_m2 * 1000); // MPa
        const sigma_cp = Math.min(sigma_cp_calc, 0.2 * fcdV); // plafond pour le calcul de V_Rd,c
        const N_Rd = (Ac_m2 * fcdV * 1000) + As_v_prov * (sigmaScV / 10); // kN/ml

        // --- Effort tranchant hors-plan sans armatures d'âme (§6.2.2) ---
        const rho_l = (d > 0) ? Math.min((As_v_prov / 10000) / (b * d), 0.02) : 0;
        const vrdc = VRdc(b, d, fck, rho_l, sigma_cp);

        let status = 'OK';
        if (N_Ed > N_Rd) {
            status = 'ERROR_AXIAL';
            push(w, 'error', "N_Ed = " + N_Ed.toFixed(0) + " kN/ml > N_Rd = " + N_Rd.toFixed(0) +
                " kN/ml : la section de béton comprimé est insuffisante (EC2 §6.1).");
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
        }

        if (sigma_cp_calc > 0.2 * fcdV) {
            push(w, 'warn', "σ_cp = " + sigma_cp_calc.toFixed(2) + " MPa > 0.2·f_cd = " +
                (0.2 * fcdV).toFixed(2) + " MPa : la contribution de la compression à V_Rd,c est " +
                "plafonnée par l'EC2 §6.2.2(1).");
        }
        if (nappesCount === 1) {
            push(w, 'warn', "Une seule nappe centrale : la hauteur utile est réduite à h/2 et " +
                "l'EC2 §9.6.2 demande deux nappes pour tout voile de plus de 20 cm.");
        }
        push(w, 'warn', "Ce module ne vérifie NI le flambement du voile (§5.8 / §12.6.5), " +
            "NI son comportement dans le plan (contreventement) : la hauteur libre du voile " +
            "n'est pas une donnée d'entrée.");

        return {
            sigma_cp: sigma_cp, d: d, V_Rdc: vrdc.V_Rdc, V_Rdc_calc: vrdc.V_Rdc_calc,
            V_Rdc_min: vrdc.V_Rdc_min, v_min: vrdc.v_min, As_vmin: As_vmin, As_hmin: As_hmin,
            As_req: As_req, As_prov: As_prov, rho_l: vrdc.rho_l, status: status,
            k: vrdc.k, fcd: fcdV, Ac: Ac,
            // Nouveaux champs
            Ac_m2: Ac_m2, sigma_cp_calc: sigma_cp_calc, N_Rd: N_Rd,
            As_v_prov: As_v_prov, As_h_prov: As_h_prov, sigma_sc: sigmaScV,
            warnings: w,
            inputs: { h: h, fck: fck, N_Ed: N_Ed, V_Ed: V_Ed, enrobage: enrobage,
                      nappesCount: nappesCount }
        };
    }

    // =====================================================================
    // 9. POINÇONNEMENT (§6.4) — utilisé par les semelles isolées
    // =====================================================================

    /**
     * Vérification du poinçonnement d'une semelle rectangulaire sous poteau centré.
     * Conformément au §6.4.4(2), la vérification est menée sur plusieurs
     * périmètres de contrôle situés à une distance a <= 2d du nu du poteau,
     * avec l'effort réduit de la réaction de sol comprise dans le périmètre.
     * @returns {{ratio_u1:number, ratio_u0:number, a_crit:number, v_Ed:number,
     *            v_Rd:number, v_Ed0:number, v_Rd_max:number, ok:boolean}}
     */
    function poinconnement(params) {
        const { a, b, A, B, d, fck, N_Ed, rho_l } = params;
        const fcdV = fcd(fck);
        const u0 = 2 * (a + b);
        const Aire = A * B;

        // a) Vérification au nu du poteau : v_Ed,0 <= v_Rd,max = 0.5 * nu * f_cd
        const v_Rd_max = 0.5 * nu1(fck) * fcdV;                    // MPa
        const v_Ed0 = (d > 0 && u0 > 0) ? (N_Ed / 1000) / (u0 * d) : Infinity; // MN/m² = MPa

        // b) Balayage des périmètres de contrôle jusqu'à 2d
        const k = Math.min(1 + Math.sqrt(200 / (d * 1000)), 2.0);
        const rho = Math.min(Math.max(rho_l || 0, 0), 0.02);
        const C_Rdc = 0.18 / MAT.gammaC;
        let worst = { ratio: 0, a_crit: 0, v_Ed: 0, v_Rd: 0 };

        for (let i = 1; i <= 8 && d > 0; i++) {
            const acr = (2 * d) * (i / 8);                    // distance au nu du poteau
            const u = 2 * (a + b) + 2 * Math.PI * acr;        // périmètre de contrôle
            // Réaction de sol située à l'intérieur du périmètre (aire approchée du contour)
            const Aint = (a + 2 * acr) * (b + 2 * acr) - (4 - Math.PI) * acr * acr;
            const N_red = N_Ed * Math.max(0, 1 - Math.min(1, Aint / Aire));
            const v_Ed = (N_red / 1000) / (u * d);            // MPa
            const v_Rd = Math.max(
                C_Rdc * k * Math.pow(100 * rho * fck, 1 / 3),
                0.035 * Math.pow(k, 1.5) * Math.sqrt(fck)
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
    // 10. MODULE SEMELLE ISOLÉE — méthode des bielles + poinçonnement
    // =====================================================================

    function semelleIsolee(raw) {
        const w = [];
        const a = num(raw.a, 0.3, 0.05, 5);
        const b = num(raw.b, 0.3, 0.05, 5);
        const A = num(raw.A, 1.5, 0.2, 20);
        const B = num(raw.B, 1.5, 0.2, 20);
        const h = num(raw.h, 0.4, 0.10, 5);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const q_adm = num(raw.q_adm, 0.25, 0.01, 10);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const N_Eq = num(raw.N_Eq, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 4, 1, 15);
        const diamA = num(raw.diamA, 12, 6, 40);
        const diamB = num(raw.diamB, 12, 6, 40);
        const secA = (raw.sectionA !== undefined) ? raw.sectionA : Math.PI * Math.pow(diamA / 10, 2) / 4;
        const secB = (raw.sectionB !== undefined) ? raw.sectionB : Math.PI * Math.pow(diamB / 10, 2) / 4;

        const c_m = enrobage / 100;
        const fydV = fyd(MAT.fyk);
        const fyd_cm2 = fydV / 10;

        let status = 'OK';

        if (A < a || B < b) {
            push(w, 'error', "Les dimensions de la semelle sont inférieures à celles du poteau.");
        }

        // --- A. Portance du sol (ELS) ---
        const poidsPropre = A * B * h * MAT.gammaBeton;
        const sigma_sol = (N_Eq + poidsPropre) / (A * B * 1000); // MPa
        if (sigma_sol > q_adm) {
            status = 'ERROR_BEARING';
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
        if ((d_A < d_req_A || d_B < d_req_B) && status === 'OK') {
            status = 'WARNING_FLEXIBLE';
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
        const largeurA = Math.max(0.01, B - 2 * c_m) * 100; // cm : les barres // A sont réparties sur B
        const largeurB = Math.max(0.01, A - 2 * c_m) * 100;
        // Le nombre de barres est plafonné à 200 par nappe : au-delà, la semelle
        // est de toute façon hors domaine et un tracé de 10 000 barres bloquerait
        // le navigateur.
        const NB_MAX = 200;
        const nb_A = Math.min(NB_MAX, Math.max(Math.ceil(As_A_req / secA), Math.ceil(largeurA / 30) + 1, 2));
        const nb_B = Math.min(NB_MAX, Math.max(Math.ceil(As_B_req / secB), Math.ceil(largeurB / 30) + 1, 2));
        const As_A_prov = nb_A * secA;
        const As_B_prov = nb_B * secB;
        const esp_A = largeurA / (nb_A - 1);
        const esp_B = largeurB / (nb_B - 1);

        if ((As_A_prov < As_A_req || As_B_prov < As_B_req) && status !== 'ERROR_BEARING') {
            status = 'ERROR_STEEL';
        }

        // --- E. Poinçonnement (§6.4) ---
        const d_moy = (d_A + d_B) / 2;
        const rho_A = (B > 0 && d_A > 0) ? (As_A_prov / 10000) / (B * d_A) : 0;
        const rho_B = (A > 0 && d_B > 0) ? (As_B_prov / 10000) / (A * d_B) : 0;
        const rho_moy = Math.sqrt(Math.max(0, rho_A * rho_B));
        const poinc = poinconnement({
            a: a, b: b, A: A, B: B, d: d_moy, fck: fck, N_Ed: N_Ed, rho_l: rho_moy
        });
        if (!poinc.ok && status !== 'ERROR_BEARING') {
            status = 'ERROR_PUNCHING';
            if (poinc.ratio_u0 > 1) {
                push(w, 'error', "Poinçonnement au nu du poteau : v_Ed = " + poinc.v_Ed0.toFixed(2) +
                    " MPa > v_Rd,max = " + poinc.v_Rd_max.toFixed(2) + " MPa (EC2 §6.4.5).");
            }
            if (poinc.ratio_u1 > 1) {
                push(w, 'error', "Poinçonnement : v_Ed = " + poinc.v_Ed.toFixed(2) + " MPa > v_Rd,c = " +
                    poinc.v_Rd.toFixed(2) + " MPa sur le périmètre situé à " +
                    (poinc.a_crit * 100).toFixed(0) + " cm du poteau. Augmenter h (EC2 §6.4.4).");
            }
        }

        push(w, 'info', "Poinçonnement vérifié avec β = 1.0 (charge centrée sans moment) : " +
            "taux de travail maximal " + (poinc.ratio_u1 * 100).toFixed(0) + " % à " +
            (poinc.a_crit * 100).toFixed(0) + " cm du poteau (EC2 §6.4.4).");
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
            // Alias conservé pour la note de calcul PDF
            weight: poidsPropre,
            fyd: fydV, fyd_cm2: fyd_cm2, fcd: fcd(fck), fctm: fctm(fck),
            d_moy: d_moy, poinconnement: poinc, rho_moy: rho_moy,
            warnings: w,
            inputs: { a: a, b: b, A: A, B: B, h: h, fck: fck, q_adm: q_adm,
                      N_Ed: N_Ed, N_Eq: N_Eq, enrobage: enrobage }
        };
    }

    // =====================================================================
    // 11. MODULE SEMELLE FILANTE — bande de 1 m sous voile
    // =====================================================================

    function semelleFilante(raw) {
        const w = [];
        const a = num(raw.a, 0.2, 0.05, 5);
        const B = num(raw.B, 1.0, 0.2, 20);
        const h = num(raw.h, 0.3, 0.10, 5);
        const fck = num(raw.fck, 25, 12, MAT.fckMax);
        const q_adm = num(raw.q_adm, 0.25, 0.01, 10);
        const N_Ed = num(raw.N_Ed, 0, 0, 1e7);
        const N_Eq = num(raw.N_Eq, 0, 0, 1e7);
        const enrobage = num(raw.enrobage, 4, 1, 15);
        const espMain = num(raw.espMain, 15, 4, 60);
        const espRep = num(raw.espRep, 20, 4, 60);
        const diamMain = num(raw.diamMain, 12, 6, 40);
        const diamRep = num(raw.diamRep, 8, 6, 40);
        const secMain = (raw.sectionMain !== undefined)
            ? raw.sectionMain : Math.PI * Math.pow(diamMain / 10, 2) / 4;
        const secRep = (raw.sectionRep !== undefined)
            ? raw.sectionRep : Math.PI * Math.pow(diamRep / 10, 2) / 4;

        const c_nom = enrobage / 100;
        const fydV = fyd(MAT.fyk);

        let status = 'OK';
        if (B < a) {
            push(w, 'error', "La largeur de semelle B est inférieure à l'épaisseur du voile a.");
        }

        // --- A. Portance du sol (ELS) ---
        const poidsPropre = B * 1.0 * h * MAT.gammaBeton;
        const sigma_sol = (N_Eq + poidsPropre) / (B * 1.0 * 1000);
        if (sigma_sol > q_adm) {
            status = 'ERROR_BEARING';
            push(w, 'error', "σ_sol = " + sigma_sol.toFixed(3) + " MPa > q_adm = " + q_adm.toFixed(3) +
                " MPa : élargir la semelle.");
        }

        // --- B. Rigidité (méthode des bielles) ---
        const d_req = (B - a) / 4;
        const d = h - c_nom - (diamMain / 1000) / 2;
        if (d <= 0) {
            push(w, 'error', "Hauteur utile négative : l'enrobage dépasse la hauteur de la semelle.");
        }
        if (d < d_req && status === 'OK') {
            status = 'WARNING_FLEXIBLE';
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

        if ((As_prov_main < As_req || As_prov_rep < As_rep_req) && status !== 'ERROR_BEARING') {
            status = 'ERROR_STEEL';
            push(w, 'error', "Section d'acier fournie insuffisante : " + As_prov_main.toFixed(2) +
                " cm²/ml disposés pour " + As_req.toFixed(2) + " cm²/ml requis.");
        }

        // --- D. Effort tranchant à la distance d du nu du voile (§6.2.2) ---
        const sigma_elu = B > 0 ? N_Ed / B : 0;               // kN/m² sur 1 ml
        const porte_a_faux = Math.max(0, (B - a) / 2 - d);    // m
        const V_Ed = sigma_elu * porte_a_faux;                // kN/ml
        const rho_l = d > 0 ? Math.min((As_prov_main / 10000) / (1.0 * d), 0.02) : 0;
        const vrdc = VRdc(1.0, d, fck, rho_l, 0);
        if (V_Ed > vrdc.V_Rdc && status === 'OK') {
            status = 'ERROR_SHEAR';
            push(w, 'error', "V_Ed = " + V_Ed.toFixed(1) + " kN/ml > V_Rd,c = " + vrdc.V_Rdc.toFixed(1) +
                " kN/ml à la distance d du nu du voile : augmenter h (EC2 §6.2.2).");
        }

        const esp_max = Math.min(3 * h * 100, 40);
        if (espMain > esp_max) {
            push(w, 'warn', "Espacement des aciers principaux (" + espMain.toFixed(0) + " cm) supérieur " +
                "à la limite constructive de " + esp_max.toFixed(0) + " cm.");
        }
        push(w, 'warn', "Charge supposée centrée sur la semelle : aucun moment ni effort " +
            "horizontal n'est pris en compte. La portance est vérifiée à l'ELS uniquement.");

        return {
            sigma_sol: sigma_sol, d_req: d_req, d: d, As_req_calc: As_req_calc,
            As_req: As_req, As_rep_req: As_rep_req, As_min: As_min,
            As_prov_main: As_prov_main, As_prov_rep: As_prov_rep, status: status,
            fyd: fydV, fyd_cm2: fydV / 10, fcd: fcd(fck), fctm: fctm(fck),
            // Nouveaux champs
            poidsPropre: poidsPropre, weight: poidsPropre, V_Ed: V_Ed, V_Rdc: vrdc.V_Rdc,
            sigma_elu: sigma_elu, k: vrdc.k, rho_l: vrdc.rho_l, esp_max: esp_max,
            warnings: w,
            inputs: { a: a, B: B, h: h, fck: fck, q_adm: q_adm, N_Ed: N_Ed,
                      N_Eq: N_Eq, enrobage: enrobage, espMain: espMain, espRep: espRep }
        };
    }

    // =====================================================================
    // 12. API PUBLIQUE
    // =====================================================================

    return {
        MAT: MAT, MU_LIMIT: MU_LIMIT, MU_DUCTILE: MU_DUCTILE,
        fcd: fcd, fyd: fyd, fctm: fctm, Ecm: Ecm, nu1: nu1, sigmaSc: sigmaSc,
        num: num,
        flexionSimple: flexionSimple, AsMinFlexion: AsMinFlexion, VRdc: VRdc,
        elancementFleche: elancementFleche, espacementLibreMin: espacementLibreMin,
        poinconnement: poinconnement,
        poutre: poutre, dalle: dalle, poteau: poteau, poteauNRd: poteauNRd,
        voile: voile, semelleIsolee: semelleIsolee, semelleFilante: semelleFilante
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EC2;
}
if (typeof window !== 'undefined') {
    window.EC2 = EC2;
}
