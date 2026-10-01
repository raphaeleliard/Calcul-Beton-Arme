# Audit de conformité Eurocode 2 — bugs corrigés et limites subsistantes

Revue de la version précédente du projet au regard de la **NF EN 1992-1-1 et de son
Annexe Nationale française**, puis correction. Ce document sert de note d'honnêteté
technique : il liste ce qui a été réparé, et surtout ce que l'outil **ne vérifie
toujours pas**.

Référentiel de vérification : `tests-ec2.js` — 109 tests, exécutables en ligne de
commande (`node tests-ec2.js`) ou dans le navigateur (`tests.html`).

> **Version 2.0** : une seconde revue a mis en évidence des erreurs non sécuritaires
> qui avaient échappé au premier audit (poteau, voile, dalle, semelle filante) et des
> notes PDF qui concluaient « CONFORME » à tort. Elles sont décrites en **§0** ; les
> sections suivantes conservent l'historique de la première revue, mises à jour.

---

## 0. Revue v2 — erreurs corrigées et fonctionnalités ajoutées

### 0.1 Erreurs non sécuritaires corrigées

| # | Module | Erreur | Correction |
|---|--------|--------|------------|
| 1 | Poteau | La flexion composée était traitée par `A_s = A_s,N + M/(z·f_yd)`, total réparti sur deux faces. Dès que le béton est presque entièrement mobilisé par N, le moment exige un couple d'aciers tendus **et** comprimés : le ferraillage était sous-estimé (rapport M_Ed/M_Rd jusqu'à 1.4 à 1.7 sur un 30 × 30 sous N = 1400 à 1800 kN). | **Diagramme d'interaction N-M** par compatibilité des déformations (§6.1) : loi parabole-rectangle, acier élasto-plastique, pivots A, B, C. `A_s,req` est la plus petite section symétrique dont le diagramme contient (N_Ed ; M_Ed,tot), et la disposition réelle des barres (barres intermédiaires comprises) est vérifiée. |
| 2 | Poteau | `K_φ = 1` était présenté comme « sécuritaire ». C'est faux : `K_φ = 1 + β·φ_ef ≥ 1`, le prendre égal à 1 néglige le fluage et réduit e₂ (jusqu'à −40 %). L'élancement limite utilisait en même temps A = 0.7, qui suppose φ_ef ≈ 2 : les deux hypothèses se contredisaient. | `φ_ef` devient une donnée (défaut 2.0) ; `K_φ` (§5.8.8.3(4)), `K_r` (§5.8.8.3(3), recalculé avec la section réellement disposée) et `A = 1/(1 + 0.2 φ_ef)` en découlent. |
| 3 | Voile | `N_Rd = A_c·f_cd + A_s·σ_sc` supposait une compression parfaitement centrée. L'excentricité minimale du §6.1(4) (h/30 ≥ 20 mm, soit h/10 pour 20 cm) n'était pas prise en compte, ni le flambement : N = 2900 kN/ml était déclaré admissible alors que M_Rd(N) < N·e₀. | La hauteur libre `l_w` et les conditions d'appui deviennent des données. Imperfections (§5.2), excentricité minimale, second ordre par courbure nominale, puis vérification sur le diagramme N-M de la bande de 1 m. |
| 4 | Dalle | Espacements maximaux : le code appliquait 3h ≤ 40 cm / 3.5h ≤ 45 cm en les présentant comme ceux de la « zone de moment maximal ». Le §9.3.1.1(3) y impose **2h ≤ 25 cm** (principal) et **3h ≤ 40 cm** (répartition) — or la mi-portée d'une dalle isostatique est précisément cette zone. | Valeurs corrigées ; leur dépassement est désormais une non-conformité (et non un simple avertissement). |
| 5 | Semelle filante | L'effort tranchant n'était vérifié que si tous les autres critères étaient satisfaits : il était **masqué** dès que la semelle était souple, c'est-à-dire précisément quand il devient déterminant (cas reproduit : V_Ed = 304 > V_Rd,c = 215 kN/ml, seul un badge orange s'affichait). | Le tranchant est toujours vérifié ; le statut suit l'ordre de gravité. |
| 6 | Note PDF (tous modules) | La conclusion « STATUT GÉNÉRAL DE CONFORMITÉ » ne comparait que la section d'acier. Une poutre en rupture de bielles, une semelle poinçonnée ou dont le sol est surchargé, un poteau ou un voile écrasé sortaient « ✓ CONFORME ». La ligne « effort tranchant : CONFORME » de la poutre était même écrite en dur. | Chaque module renvoie la liste exhaustive `checks` de ses vérifications. **L'écran et la note PDF tirent leur verdict de cette seule liste** (`EC2.verdict`) : ils ne peuvent plus se contredire. La note détaille chaque critère sur une page dédiée. |
| 7 | Poteau (interface) | Les libellés du coefficient β étaient inversés : « 0.5 – articulé-articulé », « 1.0 – encastré-encastré », « 2.0 – libre-libre ». Choisir « articulé-articulé » divisait la longueur de flambement par deux. | 0.5 encastré/encastré, 0.7 encastré/articulé, 1.0 articulé/articulé, 2.0 encastré/libre. |

### 0.2 Écarts mineurs corrigés

- **v_min** selon l'Annexe Nationale française : 0.053/γc·k^1.5·√fck (poutres, dalles
  sans redistribution transversale, semelles) et 0.35/γc·√fck (voiles).
- **Poinçonnement** : v_Rd,max = 0.4·ν·f_cd au nu du poteau (valeur recommandée du
  §6.4.5(3) depuis le corrigendum AC:2010) au lieu de 0.5·ν·f_cd.
- **Excentricité minimale** du poteau : elle sert de plancher au moment du premier ordre,
  M_0Ed = max(M_Ed + N·e_i ; N·e₀), au lieu de s'ajouter à e_M (surdimensionnement).
- **Voile à nappe unique** : non conforme au §9.6.2(3) (la moitié de A_s,v,min sur chaque
  face) ; l'ancien message citait une règle « deux nappes au-delà de 20 cm » absente de l'EC2.
- **Flèche** : la correction A_s,prov/A_s,req n'est appliquée que si la section fournie
  couvre la section requise (elle produisait une « limite » de 6.5 sans signification).
- **Cadres de poutre** : s_l,max = 0.75 d sans plafond de 60 cm (ce plafond relève du
  §9.2.2(8), espacement transversal des brins, désormais vérifié séparément).
- Références et libellés : μ_lim = 0.372 (et non 0.371), §3.1.7 (et non §3.1.6),
  A_s,min des poteaux au §9.5.2, « second lit inférieur » (et non « nappe supérieure »)
  pour la semelle isolée, f_ctm et diamètre réels dans la note de la dalle.

### 0.3 Fonctionnalités ajoutées

1. **Diagramme d'interaction N-M** (`EC2.sectionNM`) : poteau et voile, avec une vue
   graphique du domaine résistant et du point de calcul dans le module poteau, et une
   recommandation de ferraillage vérifiée sur ce diagramme.
2. **Poids propre** ajouté automatiquement à G (case à cocher, poutre et dalle).
3. **Enrobage nominal** calculé (§4.4.1) : classe d'exposition, durée d'utilisation,
   modulation de la classe structurale (Tableau 4.3N), c_min,b, Δc_dev = 10 mm, et
   §4.4.1.3(4) pour les fondations (béton de propreté ou contact direct avec le sol).
4. **Ancrages et recouvrements** (§8.4, §8.7) : f_bd, l_b,rqd, l_bd, l₀. Ancrage sur appui
   d'extrémité des poutres et dalles avec l'effort F_E = V_Ed·a_l/z (§9.2.1.4) ; besoin de
   crochets signalé pour les semelles.
5. **États limites de service** (§7.2, §7.3) : contraintes de l'acier et du béton en section
   fissurée (α_e = 15), ouverture des fissures w_k sous combinaison quasi-permanente
   (ψ₂ selon la catégorie d'usage) comparée au Tableau 7.1N.

Côté interface : liste des vérifications affichée à l'écran, recommandation de ferraillage
applicable en un clic, signalement des saisies ramenées dans le domaine de calcul,
étiquettes de champ associées, cartes de résultats utilisables au clavier, annonce du
statut aux lecteurs d'écran, en-tête compact sur téléphone.

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
- Le poids propre est ajouté automatiquement à G pour la poutre et la dalle (case à
  cocher, activée par défaut).
- Une seule combinaison ELU (`1.35 G + 1.5 Q`) : pas de combinaisons accidentelles,
  sismiques, ni de coefficients ψ.

**États limites de service**
- La flèche n'est vérifiée que par le critère forfaitaire `L/d`. Aucun calcul de
  flèche réelle (section fissurée, fluage, retrait) n'est effectué.
- Fissuration et contraintes (§7.2, §7.3) : vérifiées pour la poutre et la dalle avec
  α_e = 15 forfaitaire et les valeurs w_max recommandées du Tableau 7.1N (l'Annexe
  Nationale peut les moduler). Ni A_s,min de maîtrise de la fissuration (§7.3.2), ni
  méthode simplifiée sans calcul direct (§7.3.3).

**Dispositions constructives**
- Enrobage : classe structurale S4 de référence, modulations du Tableau 4.3N
  recommandé ; le contrôle qualité spécifique (−1 classe, Δc_dev réduit) n'est pas proposé.
- Ancrages : α₃ = α₄ = α₅ = 1 (hypothèse conservative), barres droites.
- Pas d'épure d'arrêt des barres : toutes les barres tendues sont filantes.

**Par module**
- *Poutre* : section rectangulaire uniquement (pas de section en T) ; armatures
  comprimées non traitées (`μ > 0.372` = refus) ; aciers supposés sur un seul lit ;
  pas de vérification de bielle d'about ni d'appui direct.
- *Dalle* : portée sur un seul sens. Ni dalle sur quatre appuis, ni dalle continue,
  ni plancher-dalle (donc pas de poinçonnement sous poteau).
- *Poteau* : flexion composée dans le plan de flambement uniquement (le moment saisi est
  supposé agir autour de l'axe faible, hypothèse conservative s'il agit autour de l'axe
  fort). Flexion déviée non traitée. Méthode de la courbure nominale avec B = 1.1 et
  C = 0.7 par défaut (ω et r_m inconnus).
- *Voile* : compression excentrée et flambement **hors plan** vérifiés ; le comportement
  **dans le plan** (contreventement, effort tranchant dans le plan) ne l'est pas.
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
- Poinçonnement : v_Rd,max = 0.4·ν·f_cd (valeur recommandée du §6.4.5(3)).
- Pour l'effort tranchant, `θ` est optimisé (bielle la plus inclinée possible) dans
  les bornes réglementaires `1 ≤ cot θ ≤ 2.5`. Le dimensionnement des cadres reste
  fait avec `V_Ed` **au nu de l'appui**, sans profiter de la réduction du §6.2.1(8) :
  c'est un choix conservatif.
- Poinçonnement calculé avec `β = 1.0` (charge centrée). Toute excentricité rendrait
  cette valeur non conservative.
- `v_min` de la dalle : la valeur « dalle avec redistribution transversale » de l'AN
  (0.34/γc·√fck) n'est pas retenue ; sous charge répartie, une bande portant dans un seul
  sens n'en bénéficie pas.
- Flexion composée : loi parabole-rectangle pour le béton, palier horizontal pour l'acier,
  aire de béton occupée par les barres non déduite.
