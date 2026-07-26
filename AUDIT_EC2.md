# Audit de conformité Eurocode 2 — bugs corrigés et limites subsistantes

Revue de la version précédente du projet au regard de la **NF EN 1992-1-1 et de son
Annexe Nationale française**, puis correction. Ce document sert de note d'honnêteté
technique : il liste ce qui a été réparé, et surtout ce que l'outil **ne vérifie
toujours pas**.

Référentiel de vérification : `tests-ec2.js` — 83 tests, exécutables en ligne de
commande (`node tests-ec2.js`) ou dans le navigateur (`tests.html`).

---

## 1. Bugs francs (plantages, valeurs fausses)

| # | Fichier | Symptôme | Correction |
|---|---------|----------|------------|
| 1 | `poteau.js` (tracé de la coupe) | Variable `y` non définie dans le tracé des épingles intérieures : `ReferenceError` dès que `nb_b ≥ 3`, le plan de ferraillage ne s'affichait plus du tout. | Remplacée par `y_pos`. |
| 2 | `script.js` (note PDF, semelle isolée) | `res.weight` n'existait pas (le calcul renvoie `poidsPropre`) : `TypeError`, l'export PDF échouait entièrement pour ce module. | Alias `weight` ajouté au résultat. |
| 3 | `script.js` (note PDF) | Tableau de conformité de la semelle isolée : `p.nb_A`, `p.diamA`, `p.nb_B`, `p.diamB` lus sur `state.inputs` alors qu'ils sont dans `results` / `state` → « undefined HAundefined ». Idem `p.diamMain` / `p.diamRep` pour la semelle filante. | Références corrigées. |
| 4 | Tous les modules de tracé | Saisir `0` ou vider un champ de dimension donnait une échelle de dessin infinie : SVG rempli de `NaN`, et sur `Dalle`/`Poteau` un `RangeError: Invalid string length` (boucle de tracé de plusieurs millions d'éléments) qui **figeait l'onglet**. | Les tracés utilisent désormais les entrées **bornées** par le noyau de calcul ; toutes les boucles de dessin sont plafonnées. |
| 5 | `poutre.js` | L'espacement affiché dans le panneau (espacement **libre**, cadres déduits) différait de celui coté sur le schéma (entraxe brut) : deux valeurs contradictoires pour la même grandeur. | Une seule valeur, l'espacement libre au sens du §8.2, partagée par le panneau et le schéma. |
| 6 | `poutre.js` | En cas de section béton insuffisante (`μ > 0.372`), `A_sw/s` affichait « 0.00 cm²/m », c'est-à-dire *aucun cadre nécessaire*. | Affiche « — » : le calcul de cisaillement n'a pas de sens si la flexion n'est pas résolue. |
| 7 | `script.js` (note PDF) | Classe de béton écrite `C${fck}/${fck+5}` → C30/35, C35/40, C40/45, qui n'existent pas. | Table de correspondance du Tableau 3.1 (C30/37, C35/45, C40/50…). |
| 8 | `script.js` (note PDF, voile) | `σ_cp = N_Ed / A_c` affiché avec `A_c` en m² là où le module poteau le renvoie en cm² → fraction incohérente et division affichée par 0. | Unités homogénéisées (cm²/ml) et formule d'affichage corrigée. |
| 9 | `script.js` (note PDF, semelle filante) | `d = h − c − 0.006` écrit en dur (Ø12 supposé) alors que le calcul utilise le diamètre choisi ; mention « Footing Rigide : OK » affichée même quand la semelle est souple. | Valeurs et verdict calculés. |
| 10 | `script.js` (note PDF, poteau) | La formule imprimée annonçait `e_i = max(l₀/400 ; h/30 ; 0.02)` alors que le code ne calculait que `max(l₀/400 ; 0.02)`. | Code et note alignés (voir §2). |
| 11 | Tous les modules | Une valeur illisible en `localStorage` produisait un `NaN` persistant dans l'état applicatif. | Valeurs non finies ignorées à la restauration. |

---

## 2. Écarts à l'Eurocode 2 corrigés

### Poteau

- **Hauteur utile prise sur la mauvaise dimension.** `d` était calculé avec
  `max(a, b)` alors que le flambement — et donc le moment du second ordre — se
  développe autour de **l'axe faible** (le rayon de giration, lui, était bien pris
  sur `min(a, b)`). Sur un poteau 60 × 20, `d` était surestimé de 40 cm :
  `e₂` sous-estimé et bras de levier surévalué, donc **résultat non sécuritaire**.
  Corrigé : `d` est pris dans le plan de flambement.
- **Contrainte des aciers comprimés.** `N_Rd = A_c·f_cd + A_s·f_yd` utilisait
  `f_yd = 435 MPa`. En compression le raccourcissement est plafonné à `ε_c2 = 2 ‰`,
  l'acier S500 ne peut mobiliser que `E_s·ε_c2 = 400 MPa` (§6.1) : la résistance
  était surestimée d'environ 9 % sur la part acier.
- **Seuil de second ordre arbitraire.** Le test `λ > 31` est remplacé par
  l'élancement limite réel du §5.8.3.1 : `λ_lim = 20·A·B·C/√n`, avec `n = N_Ed/(A_c·f_cd)`
  et `A = 0.7`, `B = 1.1`, `C = 0.7` (valeurs par défaut). `λ_lim` est affiché.
- **Excentricités.** `e_i` suit maintenant le §5.2 (`e_i = θ_i·l₀/2` avec
  `θ_i = θ₀·α_h`, `α_h = 2/√L` borné à [2/3 ; 1]) et intègre l'excentricité
  minimale du §6.1(4) : `e₀ ≥ max(h/30 ; 20 mm)`.

### Poutre

- **`V_Rd,c` n'était jamais calculé.** Des cadres d'effort tranchant complets
  étaient dimensionnés même lorsque le béton seul suffit. Le §6.2.1(5) est
  maintenant appliqué : si `V_Ed ≤ V_Rd,c`, seules les armatures d'âme minimales du
  §9.2.2 sont exigées.
- **Espacement maximal des cadres** `s_l,max = 0.75·d` (§9.2.2(6)) ajouté ; le
  schéma en vue longitudinale le respecte.
- **Encombrement des barres** vérifié selon le §8.2 : espacement libre
  ≥ max(Ø ; d_g + 5 mm ; 20 mm), au lieu du seuil forfaitaire de 2.5 cm.
- **`A_s,max = 4 % A_c`** contrôlé sur la section *requise* et non seulement sur la
  section choisie.

### Dalle

- **Aciers de répartition.** `A_s,rep = max(0.2·A_s ; A_s,min)` imposait à tort la
  condition de non-fragilité du §9.2.1.1 aux armatures transversales. Le §9.3.1.1(2)
  ne demande que **20 % des armatures principales** ; la non-fragilité ne porte que
  sur la nappe principale.

### Voile

- **La résistance à la compression n'était pas vérifiée.** Le module calculait
  `σ_cp` mais ne comparait jamais `N_Ed` à une résistance : un voile pouvait être
  déclaré « conforme » sous une compression écrasant le béton. `N_Rd` est maintenant
  calculé et vérifié.
- **Treillis soudés : les deux directions étaient confondues.** `TS_SPECS` ne
  contenait que la section des fils porteurs. Or un ST25C, par exemple, offre
  2.57 cm²/ml dans un sens et 1.28 cm²/ml dans l'autre. Les armatures horizontales
  (§9.6.3) étaient donc vérifiées avec la mauvaise section — et la vérification
  était en réalité inopérante, `A_s,req = max(A_s,vmin ; A_s,hmin)` valant toujours
  `A_s,vmin`. Les sections transversales (valeurs des panneaux ADETS) sont ajoutées
  et les deux directions vérifiées séparément.

### Semelle isolée

- **Le poinçonnement n'était pas vérifié** — c'est pourtant très souvent le critère
  dimensionnant de la hauteur d'une semelle. Vérification du §6.4 ajoutée :
  balayage des périmètres de contrôle jusqu'à 2d avec effort réduit de la réaction
  de sol intérieure et majoration `2d/a` (§6.4.4(2)), plus contrôle au nu du poteau
  (`v_Ed ≤ 0.5·ν·f_cd`, §6.4.5). Le taux de travail est affiché et détaillé dans la
  note PDF.

### Semelle filante

- **L'effort tranchant n'était pas vérifié.** Contrôle ajouté à la distance `d` du
  nu du voile (§6.2.2).

### Flèche (poutre et dalle)

Aucune vérification d'ELS n'existait. Le critère portée/hauteur utile du **§7.4.2(2)**
(expressions 7.16a/7.16b, corrigées de la contrainte réelle de l'acier) est ajouté,
avec un badge orange quand `L/d` dépasse la limite. Pour une dalle, c'est très
souvent ce critère qui commande l'épaisseur, pas la résistance.

---

## 3. Réorganisation

Toute la logique réglementaire est extraite dans **`ec2-core.js`** : fonctions pures,
sans DOM ni état global, utilisables aussi bien dans le navigateur qu'avec Node.
Conséquences :

- les six modules ne peuvent plus diverger sur `f_cd`, `f_ctm`, `V_Rd,c`… ;
- toutes les entrées sont bornées à un domaine physique en un seul endroit ;
- la suite de tests couvre les six modules dans une seule page. Ce n'était pas
  possible auparavant : chaque module déclarant un `const AppState` global, deux
  modules ne peuvent pas coexister sur une même page — l'ancien `tests.html` devait
  donc simuler le DOM pour ne tester que le poteau.

Chaque module renvoie en plus une liste de **diagnostics** (`warnings`) affichée
sous le badge de statut, qui cite la clause EC2 concernée.

---

## 4. Limites subsistantes (à connaître avant d'utiliser les résultats)

Ces points ne sont **pas** des oublis : ils délimitent le domaine d'emploi de l'outil.
La plupart sont désormais rappelés à l'écran.

**Modèle structurel**
- Tous les éléments fléchis sont traités comme **isostatiques sur deux appuis simples**
  (`M = pL²/8`). Ni continuité, ni encastrement, ni charges ponctuelles, ni porte-à-faux.
- Le **poids propre n'est jamais ajouté automatiquement** aux charges permanentes.
- Une seule combinaison ELU (`1.35 G + 1.5 Q`) : pas de combinaisons accidentelles,
  sismiques, ni de coefficients ψ.

**États limites de service**
- La flèche n'est vérifiée que par le critère forfaitaire `L/d`. Aucun calcul de
  flèche réelle (section fissurée, fluage, retrait) n'est effectué.
- **Aucune vérification de la fissuration** (§7.3 : `w_k`, espacement et diamètre
  maximaux des barres).
- Aucune vérification des contraintes à l'ELS (§7.2).

**Dispositions constructives**
- L'**enrobage n'est pas calculé** : il est saisi. `c_nom = c_min + Δc_dev` selon la
  classe d'exposition (§4.4.1) reste à la charge de l'utilisateur.
- Ni **longueurs d'ancrage**, ni **longueurs de recouvrement** (§8.4 et §8.7).
- Pas d'épure d'arrêt des barres ni de décalage du diagramme des moments
  (règle du décalage `a_l`, §9.2.1.3).

**Par module**
- *Poutre* : section rectangulaire uniquement (pas de section en T) ; armatures
  comprimées non traitées (`μ > 0.372` = refus) ; aciers supposés sur un seul lit ;
  pas de vérification de bielle d'about ni d'appui direct.
- *Dalle* : portée sur un seul sens. Ni dalle sur quatre appuis, ni dalle continue,
  ni plancher-dalle (donc pas de poinçonnement sous poteau).
- *Poteau* : flexion composée traitée par une méthode simplifiée à bras de levier
  constant — un diagramme d'interaction N–M serait exact ; un avertissement apparaît
  au-delà de `e > h/4`. Flexion déviée non traitée. Le fluage (`K_φ`) et le taux
  d'acier réel (`K_r`) sont pris égaux à 1, hypothèse sécuritaire. `N_cr` est affiché
  à titre pédagogique mais n'intervient pas dans les vérifications.
- *Voile* : **ni flambement, ni comportement dans le plan** (contreventement) — la
  hauteur libre du voile n'est même pas une donnée d'entrée. Le module ne vérifie
  qu'une bande de 1 m sous compression et cisaillement hors-plan.
- *Semelles* : charge strictement **centrée**, sans moment ni effort horizontal, donc
  pas de diagramme trapézoïdal ni de vérification de décompression du sol. La portance
  est traitée en « contrainte admissible » à l'ELS, **pas selon l'Eurocode 7**
  (approches de calcul, coefficients partiels géotechniques). Pas de vérification au
  glissement, au renversement, ni du tassement.

**Matériaux**
- Bétons **≤ C50/60** uniquement : au-delà, les coefficients `λ = 0.8` et `η = 1.0` du
  diagramme rectangulaire et la relation `f_ctm = 0.30·f_ck^(2/3)` changent. Les listes
  déroulantes sont d'ailleurs limitées à C40/50.
- Acier S500 de classe B supposé ; les exigences de ductilité (classes A/B/C) ne sont
  pas différenciées.

---

## 5. Points de méthode assumés

- `α_cc = 1.0` (valeur de l'Annexe Nationale française) ; `k₁ = 0.15` pour `V_Rd,c`.
- `μ_lim = 0.372` correspond au pivot A/B pour du S500 : c'est la limite au-delà de
  laquelle des aciers comprimés deviennent nécessaires. Un avertissement apparaît dès
  `μ > 0.295` (soit `x/d > 0.45`), seuil usuel de ductilité.
- Pour l'effort tranchant, `θ` est optimisé (bielle la plus inclinée possible) dans
  les bornes réglementaires `1 ≤ cot θ ≤ 2.5`. Le dimensionnement des cadres reste
  fait avec `V_Ed` **au nu de l'appui**, sans profiter de la réduction du §6.2.1(8) :
  c'est un choix conservatif.
- Poinçonnement calculé avec `β = 1.0` (charge centrée). Toute excentricité rendrait
  cette valeur non conservative.
