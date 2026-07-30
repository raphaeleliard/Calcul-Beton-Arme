# Calcul-Beton-Arme

Outil pédagogique de dimensionnement en béton armé selon l'**Eurocode 2**
(NF EN 1992-1-1 et Annexe Nationale française). Six modules : poutre, dalle pleine,
poteau, voile, semelle isolée et semelle filante, avec tracé du plan de ferraillage
et note de calcul PDF.

Application statique : aucun serveur ni build n'est nécessaire, il suffit d'ouvrir
`index.html`.

## Organisation du code

| Fichier | Rôle |
|---------|------|
| `ec2-core.js` | **Noyau de calcul réglementaire.** Fonctions pures, sans DOM ni état global : c'est ici que vit toute la logique Eurocode 2. |
| `poutre.js`, `dalle.js`, `poteau.js`, `voile.js`, `semelle-isolee.js`, `semelle-filante.js` | Interface de chaque module : saisie, affichage, tracé SVG. Le calcul est délégué à `ec2-core.js`. |
| `script.js` | Données aciers, thème clair/sombre, exports PNG et note de calcul PDF. |
| `tests-ec2.js` | Suite de tests du noyau de calcul. |
| `tests-supply-chain.js` | Vérifie les dépendances tierces et la CSP des pages. |

## Tests

```bash
npm test                    # les deux harnais, sort en code 1 si un test échoue
node tests-ec2.js           # noyau Eurocode 2 seul
VERBOSE=1 node tests-ec2.js # avec le détail de chaque test
```

La même suite tourne dans le navigateur via `tests.html`. Chaque test compare le
résultat du code à une valeur recalculée à la main d'après le texte de la norme.

## Domaine de validité

Lire **[`AUDIT_EC2.md`](AUDIT_EC2.md)** avant d'exploiter un résultat : le document
recense les vérifications réellement effectuées et, surtout, celles qui ne le sont
pas (fissuration, ancrages, continuité, flambement des voiles, Eurocode 7…).

En résumé : éléments **isostatiques** sur deux appuis simples, chargement uniforme,
combinaison ELU `1.35 G + 1.5 Q`, bétons **≤ C50/60**, acier S500, charges centrées
sur les fondations. Le poids propre n'est pas ajouté automatiquement.

Cet outil est destiné à l'apprentissage : il ne remplace pas une note de calcul
vérifiée par un ingénieur.
