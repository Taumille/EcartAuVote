# Analyse CVE / sécurité

**Projet :** Écart au vote national — Présidentielle 2022
**Date :** 2026‑11‑24
**Périmètre :** l'application livrée (`index.html`, `app.js`, `data/communes.js`,
`vendor/`) et ses dépendances de construction/test.

## Méthode

1. Inventaire des composants et de leurs versions exactes.
2. Interrogation de la base **OSV.dev** (requêtes par paquet + version) et recoupement
   avec les avis **GitHub Advisory / NVD**.
3. Vérification **empirique** du seul avis remonté, avec le PoC de l'avis, dans
   Firefox headless.

## Composants

| Composant | Version | Rôle | Présent à l'exécution ? |
|---|---|---|---|
| maplibre-gl (JS + CSS) | **5.6.0 → 5.24.1** | rendu cartographique | **oui** (navigateur) |
| `index.html`, `app.js` | — | code first‑party | oui |
| `data/communes.js` | — | données (gzip/base64) | oui |
| openpyxl | 3.1.5 | lecture du `.xlsx` | non (build) |
| shapely / topojson | 2.2.0 / 2.2 | géométrie | non (build) |
| selenium / geckodriver | 4.54.0 / 0.37.1 | tests | non |
| Python 3.14, Node 22, Firefox 160 | — | environnement | non |

## Synthèse

| Réf. | Sévérité | Composant | Statut |
|---|---|---|---|
| F‑1 | **Critique (CVSS 10.0)** | maplibre-gl ≤ 6.4.0 | **corrigé** (passage à 5.24.1) |
| F‑2 | Faible | code first‑party (`innerHTML`) | recommandation de durcissement |
| F‑3 | Information | autres dépendances | aucun avis connu |

---

## F‑1 — CVE‑2026‑85061 / GHSA‑jrc7‑96c5‑q579 (Critique)

- **Composant affecté :** `maplibre-gl` **≤ 6.4.0** (toutes les versions ; la nôtre était **5.6.0**).
- **CVSS 3.1 :** `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:N` → **10.0**, CWE‑79 (XSS).
- **Cause :** `DOM.sanitize()` itérait `elem.attributes` (une `NamedNodeMap` *live*) tout en
  appelant `removeAttribute()` ; la suppression décale les attributs suivants et en fait
  « sauter » un. Deux attributs dangereux consécutifs laissent donc survivre le second.
- **Impact :** contournement du sanitizer → **XSS DOM sans interaction** lors du rendu
  d'une chaîne d'attribution (ex. `<details open onload=… ontoggle=…>`), via le contrôle
  d'attribution.
- **Applicabilité à ce projet :** **non atteignable en l'état.** La vulnérabilité nécessite
  une attribution non fiable (source de tuiles tierce, ou `customAttribution` fourni par
  l'utilisateur). Ici l'attribution est une **constante codée en dur**, il n'y a **aucune
  source distante** (ni tuiles, ni GeoJSON externe) et **aucun popup/`setHTML`**. Le risque
  d'exploitation de la page livrée est donc nul — mais la dépendance reste vulnérable
  (défense en profondeur, et tout futur ajout d'une source tierce la rendrait exploitable).
- **Vérification empirique** (Firefox headless, payload de l'avis) :

  | Version | `innerHTML` de l'attribution | Exécution |
  |---|---|---|
  | 5.6.0 | `<details open="" ontoggle="window.__xss=2">x</details>` | **`window.__xss = 2` (exécuté)** |
  | 5.24.1 | *(vide — markup supprimé)* | `window.__xss = 0` |

- **Correctif :**
  - **≥ 6.4.1** (correctif officiel, mais **ESM uniquement** → incompatible avec
    l'ouverture directe en `file://`).
  - **5.24.1** : rétroportage du correctif sur la branche 5.x (PR #8993, fusionnée le
    2026‑11‑10, publiée le 2026‑11‑11). Conserve le *build* UMD → **compatible `file://`**.
- **Action appliquée :** bibliothèque vendorisée mise à jour **5.6.0 → 5.24.1**, page
  retestée (carte, modes, infobulles OK).

  | Fichier | Avant (5.6.0) | Après (5.24.1) |
  |---|---|---|
  | `vendor/maplibre-gl.js` | `07e6ca71…6564f9` | `a9c9e2aa…3bc7c9` |
  | `vendor/maplibre-gl.css` | `792ac997…c41b4` | `ab1e70d5…d7a732` |

## F‑2 — Injection HTML depuis les données (Faible)

`app.js` construit l'infobulle et le classement via `innerHTML` en y insérant des chaînes
issues du fichier de données (noms de communes, de départements). Ces données sont
embarquées et **de confiance**, le risque est donc faible ; mais si `data/communes.js`
était remplacé par un fichier altéré, une XSS stockée serait possible.
**Recommandation :** utiliser `textContent` (ou la construction de nœuds DOM) pour les
valeurs issues des données, et réserver `innerHTML` au balisage statique.

## F‑3 — Autres dépendances (Information)

- openpyxl 3.1.5, shapely 2.2.0, selenium 4.54.0, topojson 2.2, pandas 3.0.5,
  geopandas 1.1.4, numpy 2.4.0 : **aucun avis** remonté par OSV aux versions épinglées.
- Aucun appel réseau à l'exécution (pas de CDN, pas de tuiles, pas de police distante) :
  surface de chaîne d'approvisionnement minimale.
- L'analyse du `.xlsx` (openpyxl) a lieu **au build**, sur une source de confiance
  (data.gouv.fr).

## Risque résiduel

Les scanners (OSV, NVD, Snyk…) continueront de signaler **toute** version 5.x, car l'avis
n'enregistre que **6.4.1** comme version corrigée (les rétroportages 5.x n'y sont pas
représentables). **5.24.1 est fonctionnellement corrigé** mais produira un *faux positif*.
Si une conformité « zéro alerte scanner » est exigée, il faut passer à **6.4.1+** (ESM) et
donc regrouper le bundle pour préserver l'ouverture en `file://`.
