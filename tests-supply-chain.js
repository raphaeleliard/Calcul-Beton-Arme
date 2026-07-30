/**
 * =========================================================================
 * Garde-fou sur les dependances tierces et la politique de securite.
 *
 * Le noyau de calcul est couvert par `tests-ec2.js`. Ce second harnais couvre
 * ce qui entoure le calcul : d'ou vient le code execute dans la page, et ce
 * que le navigateur s'autorise a charger.
 *
 * Lance par `npm test`, en meme temps que le harnais Eurocode 2.
 * =========================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = __dirname;

/** Pages embarquant l'export PNG/PDF, donc les dependances cdnjs. */
const PAGES_CALCUL = [
    'Poutre.html', 'Dalle.html', 'Poteau.html',
    'Voile.html', 'SemelleIsolee.html', 'SemelleFilante.html'
];

/** Toutes les pages publiees. */
const PAGES = PAGES_CALCUL.concat(['index.html', 'Contact.html', '404.html', 'tests.html']);

const cas = [];

function check(nom, condition, detail) {
    cas.push({ nom: nom, passed: !!condition, detail: detail || '' });
}

function lire(page) {
    return fs.readFileSync(path.join(RACINE, page), 'utf8');
}

function scriptsExternes(html) {
    return html.match(/<script\b[^>]*\bsrc="https?:\/\/[^"]*"[^>]*>/g) || [];
}

// ---------------------------------------------------------------------------
// A. Integrite des dependances tierces
// ---------------------------------------------------------------------------
PAGES_CALCUL.forEach(function (page) {
    const html = lire(page);
    const externes = scriptsExternes(html).filter(function (b) {
        return b.indexOf('cdnjs.cloudflare.com') !== -1;
    });

    check(page + ' : les deux dependances cdnjs sont presentes',
        externes.length === 2, 'trouve ' + externes.length);

    externes.forEach(function (balise) {
        const url = (balise.match(/src="([^"]+)"/) || [])[1] || '';
        const nom = url.split('/').pop();

        // Une version flottante laisserait un tiers modifier le code execute
        // dans la page sans qu'aucun commit ne soit fait ici.
        check(page + ' : ' + nom + ' est fige a une version exacte',
            /\/\d+\.\d+\.\d+\//.test(url), url);

        // Le `\s` initial est indispensable : sans lui, un attribut mal nomme
        // comme `x-integrity="sha384-..."` satisferait le test alors qu'il
        // n'est pas interprete par le navigateur.
        check(page + ' : ' + nom + ' est verifie par empreinte',
            /\sintegrity="sha384-/.test(balise), 'integrity absent');

        // Sans crossorigin, le navigateur charge la ressource en mode opaque
        // et ne verifie tout simplement pas l'empreinte.
        check(page + ' : ' + nom + ' declare crossorigin',
            /\scrossorigin=/.test(balise), 'crossorigin absent');
    });
});

// ---------------------------------------------------------------------------
// B. Politique de securite du contenu
// ---------------------------------------------------------------------------
PAGES_CALCUL.forEach(function (page) {
    const html = lire(page);
    const csp = (html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([\s\S]*?)"/) || [])[1];

    check(page + ' : declare une CSP', !!csp);
    if (!csp) return;

    check(page + ' : CSP — default-src limite a self',
        /default-src\s+'self'/.test(csp));
    check(page + ' : CSP — object-src interdit',
        /object-src\s+'none'/.test(csp));
    check(page + ' : CSP — base-uri verrouille',
        /base-uri\s+'self'/.test(csp));

    // 'unsafe-eval' n'est necessaire a aucune des deux bibliotheques : son
    // apparition signalerait une regression de la politique.
    check(page + ' : CSP — pas d\'unsafe-eval',
        !/unsafe-eval/.test(csp));
});

// ---------------------------------------------------------------------------
// C. Coherence generale
// ---------------------------------------------------------------------------
PAGES.forEach(function (page) {
    const html = lire(page);
    const externes = scriptsExternes(html);
    const inconnus = externes.filter(function (b) {
        return b.indexOf('cdnjs.cloudflare.com') === -1
            && b.indexOf('cloud.umami.is') === -1;
    });

    // Empeche l'ajout silencieux d'une nouvelle origine tierce.
    check(page + ' : aucune origine tierce inattendue',
        inconnus.length === 0, inconnus.join(' | '));
});

// ---------------------------------------------------------------------------
// Restitution
// ---------------------------------------------------------------------------
let echecs = 0;
cas.forEach(function (t) {
    if (!t.passed) echecs++;
    if (!t.passed || process.env.VERBOSE) {
        console.log('[' + (t.passed ? 'PASS' : 'FAIL') + '] ' + t.nom
            + (t.passed || !t.detail ? '' : ' (' + t.detail + ')'));
    }
});

console.log('\n' + (cas.length - echecs) + ' / ' + cas.length
    + ' verifications de chaine d\'approvisionnement reussies.');

process.exit(echecs > 0 ? 1 : 0);
