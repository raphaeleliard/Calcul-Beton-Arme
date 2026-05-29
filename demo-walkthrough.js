/**
 * =========================================================
 * Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
 * Auteur : Raphaël ELIARD
 * Description : Script de contrôle de la visite guidée (Mode Démo).
 * Gère le spotlight adaptatif (clip-path), la navigation temporelle,
 * la simulation dynamique d'actions (saisies, clics) et la 
 * restauration transparente de l'état initial de l'utilisateur.
 * =========================================================
 */

let originalAppState = null;
let currentStepIdx = 0;
let isPlaying = false;
let stepProgress = 0;
const STEP_DURATION = 12000; // 12 secondes par défaut
let timerInterval = null;
let trackingActive = false;

// Variables pour le lissage du projecteur (spotlight)
let lastX = 0, lastY = 0, lastW = 0, lastH = 0;

const steps = [
    {
        title: "Bienvenue sur EC2 Assistant ! 🏗️",
        desc: "Découvrez comment dimensionner une poutre en béton armé selon les règles de l'Eurocode 2.<br><br>Ce guide interactif va s'animer automatiquement. Vous pouvez le mettre en pause ou naviguer manuellement à tout moment. Vos calculs en cours seront restaurés à la fin du tutoriel.",
        target: null,
        duration: 12000,
        action: (callback) => {
            // Sauvegarder l'état actuel de l'utilisateur
            originalAppState = {
                inputs: JSON.parse(JSON.stringify(AppState.inputs)),
                selectedDiameter: AppState.selectedDiameter,
                nbBarres: AppState.nbBarres,
                currentView: AppState.currentView
            };
            
            // Appliquer les valeurs de démo par défaut
            applyAppState({
                inputs: { L: 5.0, b: 0.20, h: 0.50, G: 15, Q: 10, fck: 25 },
                selectedDiameter: 10,
                nbBarres: 3,
                currentView: "coupe"
            });
            if (callback) callback();
        }
    },
    {
        title: "1. Paramètres d'Entrée ✏️",
        desc: "Définissez la portée de la poutre, sa section en béton (base & hauteur), ainsi que les matériaux et charges appliquées.<br><br><em>Observation : Regardez la portée changer sous vos yeux...</em>",
        target: "aside.panel:first-of-type",
        duration: 14000,
        action: (callback) => {
            // Simulation d'une saisie de portée augmentée (de 5.0m à 6.5m)
            setTimeout(() => {
                simulateNumberInput("L", 6.5, 15, 1200, callback);
            }, 1000);
        }
    },
    {
        title: "2. Note de Calcul Interactive 📊",
        desc: "L'application calcule instantanément les sollicitations (Moment fléchissant Med, Effort tranchant Ved) et les sections requises d'acier.<br><br>Chaque carte affiche le paragraphe réglementaire de l'Eurocode 2 correspondant (ex: EC2 §6.1).",
        target: "main.panel",
        duration: 12000,
        action: (callback) => {
            if (callback) callback();
        }
    },
    {
        title: "3. Formules Réglementaires Détaillées 🔍",
        desc: "Besoin de comprendre la formule ? Cliquez sur une carte de résultat pour ouvrir une explication pédagogique détaillée.",
        target: ".result-card[onclick*='As']",
        duration: 14000,
        action: (callback) => {
            // Simulation du clic pour afficher la formule Eurocode de l'acier longitudinal
            setTimeout(() => {
                showFormula('As');
                if (callback) callback();
            }, 1500);
        }
    },
    {
        title: "4. Choix du Ferraillage Commercial 🔩",
        desc: "En fonction de la section d'acier théorique requise, l'ingénieur choisit le diamètre des barres (HA10, HA12...) et leur nombre.<br><br><em>Observation : Avec notre nouvelle portée de 6.5m, 3 HA10 sont insuffisants. Modifions le choix...</em>",
        target: "aside.panel:last-of-type",
        duration: 15000,
        action: (callback) => {
            // Fermer la modale précédente
            closeModal();
            
            // Sélectionner HA16 et augmenter à 4 barres
            setTimeout(() => {
                // Simuler le choix HA16
                const btn16 = document.querySelector('.steel-btn[data-diameter="16"]');
                if (btn16) btn16.click();
                
                setTimeout(() => {
                    // Simuler le passage à 4 barres
                    const nbInput = document.getElementById('nbBarresInput');
                    if (nbInput) {
                        nbInput.value = 4;
                        nbInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    if (callback) callback();
                }, 1500);
            }, 1000);
        }
    },
    {
        title: "5. Plan de Ferraillage Dynamique 🎨",
        desc: "Le plan de ferraillage se dessine en temps réel sous forme de SVG interactif, incluant les armatures longitudinales, les cadres transversaux, l'enrobage et les espacements de calcul.",
        target: "#svgContainer",
        duration: 14000,
        action: (callback) => {
            // Basculer sur la vue longitudinale pour montrer l'organisation
            setView('longitudinale');
            
            setTimeout(() => {
                setView('coupe');
                if (callback) callback();
            }, 6000);
        }
    },
    {
        title: "6. Validation de la Conformité 🛡️",
        desc: "Le badge de statut vérifie la conformité de l'élément vis-à-vis des clauses de l'Eurocode 2 (ferraillage minimal, espacement net pour coulage du béton, section d'acier maximale de 4%).",
        target: "#statusBadge",
        duration: 11000,
        action: (callback) => {
            if (callback) callback();
        }
    },
    {
        title: "7. Rapports & Exports 📥",
        desc: "Une fois le dimensionnement conforme, vous pouvez exporter le plan sous format PNG ou télécharger un rapport de calcul A4 réglementaire complet en PDF (3 pages).",
        target: ".export-buttons",
        duration: 11000,
        action: (callback) => {
            if (callback) callback();
        }
    },
    {
        title: "Prêt à dimensionner ! 🚀",
        desc: "La visite guidée est terminée. Vous pouvez maintenant modifier les paramètres et ferraillages pour vos propres projets.<br><br>Vos calculs précédents viennent d'être restaurés.",
        target: null,
        duration: 10000,
        action: (callback) => {
            quitterDemo();
            if (callback) callback();
        }
    }
];

// Fonction pour simuler la saisie progressive d'une valeur numérique
function simulateNumberInput(id, targetVal, stepsCount, duration, callback) {
    const el = document.getElementById(id);
    if (!el) return callback ? callback() : null;
    const startVal = parseFloat(el.value);
    const stepVal = (targetVal - startVal) / stepsCount;
    let currentStep = 0;
    
    const interval = setInterval(() => {
        currentStep++;
        const newVal = startVal + (stepVal * currentStep);
        el.value = newVal.toFixed(1);
        
        // Dispatch l'événement pour recalculer l'UI
        el.dispatchEvent(new Event('input', { bubbles: true }));
        
        if (currentStep >= stepsCount) {
            clearInterval(interval);
            el.value = targetVal.toFixed(1);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            if (callback) callback();
        }
    }, duration / stepsCount);
}

// Appliquer un état global à l'application
function applyAppState(state) {
    // Injecter dans AppState
    AppState.inputs = JSON.parse(JSON.stringify(state.inputs));
    AppState.selectedDiameter = state.selectedDiameter;
    AppState.nbBarres = state.nbBarres;
    AppState.currentView = state.currentView;
    
    // Mettre à jour les éléments du DOM
    for (let id in AppState.inputs) {
        const el = document.getElementById(id);
        if (el) el.value = AppState.inputs[id];
    }
    
    const nbInput = document.getElementById('nbBarresInput');
    if (nbInput) nbInput.value = AppState.nbBarres;
    
    // Mettre à jour le sélecteur graphique
    document.querySelectorAll('.steel-btn').forEach(btn => {
        const diam = parseInt(btn.dataset.diameter);
        btn.classList.toggle('active', diam === AppState.selectedDiameter);
    });
    
    // Recalculer
    runController();
    setView(AppState.currentView);
}

// Démarrer la démo
window.lancerDemoWalkthrough = function() {
    currentStepIdx = 0;
    isPlaying = true;
    stepProgress = 0;
    
    const backdrop = document.getElementById('demo-spotlight-backdrop');
    const highlight = document.getElementById('demo-spotlight-highlight');
    const blocker = document.getElementById('demo-click-blocker');
    const card = document.getElementById('demo-walkthrough-card');
    
    backdrop.classList.remove('demo-hidden');
    highlight.classList.remove('demo-hidden');
    blocker.classList.remove('demo-hidden');
    card.classList.remove('demo-hidden');
    
    // Réinitialiser les positions de lissage
    lastX = 0; lastY = 0; lastW = 0; lastH = 0;
    
    buildDotsIndicator();
    chargerEtape(currentStepIdx);
    startTracking();
};

function buildDotsIndicator() {
    const dotsContainer = document.getElementById('demo-dots');
    dotsContainer.innerHTML = '';
    steps.forEach((_, idx) => {
        const dot = document.createElement('div');
        dot.className = 'demo-dot' + (idx === currentStepIdx ? ' active' : '');
        dot.addEventListener('click', () => {
            pauseDemo();
            chargerEtape(idx);
        });
        dotsContainer.appendChild(dot);
    });
}

function updateDots() {
    const dots = document.querySelectorAll('.demo-dot');
    dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentStepIdx);
    });
}

function chargerEtape(idx) {
    if (idx < 0 || idx >= steps.length) return;
    currentStepIdx = idx;
    updateDots();
    
    const step = steps[idx];
    document.getElementById('demo-step-title').innerHTML = step.title;
    document.getElementById('demo-step-desc').innerHTML = step.desc;
    
    // Réinitialiser la barre de progression
    stepProgress = 0;
    updateProgressBar();
    
    // Ajuster l'interactivité : clics bloqués sauf si on est en pause sur une étape interactive
    const blocker = document.getElementById('demo-click-blocker');
    if (blocker) {
        blocker.classList.toggle('demo-hidden', !isPlaying);
    }
    
    // Gérer l'effet spotlight (mise en valeur)
    applySpotlight(step.target);
    
    // Déclencher l'action simulée de l'étape
    if (step.action) {
        step.action(() => {
            // L'action est complétée, relancer ou continuer le timer si nécessaire
            if (isPlaying && currentStepIdx === idx) {
                demarrerTimerEtape();
            }
        });
    } else {
        if (isPlaying) demarrerTimerEtape();
    }
}

function applySpotlight(selector) {
    const backdrop = document.getElementById('demo-spotlight-backdrop');
    const highlight = document.getElementById('demo-spotlight-highlight');
    
    if (!selector) {
        highlight.classList.add('demo-hidden');
        backdrop.style.clipPath = 'none';
        backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.65)';
        
        positionCard(null);
        return;
    }
    
    const el = document.querySelector(selector);
    if (!el) {
        // En cas de rendu différé, attendre un court instant
        setTimeout(() => applySpotlight(selector), 100);
        return;
    }
    
    highlight.classList.remove('demo-hidden');
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.55)';
    
    // Centrer l'élément ciblé dans l'écran de manière fluide
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Boucle de mise à jour synchronisée (60 FPS) pour éviter les décalages de scroll
function startTracking() {
    if (trackingActive) return;
    trackingActive = true;
    requestAnimationFrame(trackLoop);
}

function stopTracking() {
    trackingActive = false;
}

function trackLoop() {
    if (!trackingActive) return;
    
    const step = steps[currentStepIdx];
    if (step && step.target) {
        const el = document.querySelector(step.target);
        if (el) {
            updateSpotlightBounds(el);
        }
    } else {
        // Mode centré plein écran
        const highlight = document.getElementById('demo-spotlight-highlight');
        const backdrop = document.getElementById('demo-spotlight-backdrop');
        if (highlight && backdrop) {
            highlight.classList.add('demo-hidden');
            backdrop.style.clipPath = 'none';
            positionCard(null);
            lastX = 0; lastY = 0; lastW = 0; lastH = 0;
        }
    }
    requestAnimationFrame(trackLoop);
}

function updateSpotlightBounds(el) {
    const highlight = document.getElementById('demo-spotlight-highlight');
    const backdrop = document.getElementById('demo-spotlight-backdrop');
    if (!highlight || !backdrop || !el) return;
    
    const rect = el.getBoundingClientRect();
    const padding = 12;
    
    // Coordonnées cibles
    const targetX = rect.left - padding;
    const targetY = rect.top - padding;
    const targetW = rect.width + padding * 2;
    const targetH = rect.height + padding * 2;
    
    // Interpolation linéaire (lissage) pour un effet de mouvement premium (LERP)
    const lerpFactor = 0.15;
    lastX = lastX === 0 ? targetX : lastX + (targetX - lastX) * lerpFactor;
    lastY = lastY === 0 ? targetY : lastY + (targetY - lastY) * lerpFactor;
    lastW = lastW === 0 ? targetW : lastW + (targetW - lastW) * lerpFactor;
    lastH = lastH === 0 ? targetH : lastH + (targetH - lastH) * lerpFactor;
    
    // Appliquer le cadre de surbrillance
    highlight.style.left = `${lastX}px`;
    highlight.style.top = `${lastY}px`;
    highlight.style.width = `${lastW}px`;
    highlight.style.height = `${lastH}px`;
    
    // Découper le trou dans le backdrop
    const r = lastX + lastW;
    const b = lastY + lastH;
    backdrop.style.clipPath = `polygon(
        0% 0%,
        0% 100%,
        ${lastX}px 100%,
        ${lastX}px ${lastY}px,
        ${r}px ${lastY}px,
        ${r}px ${b}px,
        ${lastX}px ${b}px,
        ${lastX}px 100%,
        100% 100%,
        100% 0%
    )`;
    
    positionCard(el);
}

function positionCard(targetEl) {
    const card = document.getElementById('demo-walkthrough-card');
    if (!card) return;
    
    const isMobile = window.innerWidth < 768;
    
    // Réinitialisation des styles de positionnement
    card.style.top = '';
    card.style.bottom = '';
    card.style.left = '';
    card.style.right = '';
    card.style.transform = '';
    card.style.width = '';
    
    if (isMobile) {
        if (!targetEl) {
            // Mode centré sur mobile (welcome/conclusion)
            card.style.top = '25%';
            card.style.left = '50%';
            card.style.transform = 'translate(-50%, -25%)';
            card.style.width = '92vw';
        } else {
            // Ancrer en bas sur mobile (mode bottom sheet) pour libérer la zone de spotlight
            card.style.bottom = '16px';
            card.style.left = '50%';
            card.style.transform = 'translateX(-50%)';
            card.style.width = '92vw';
        }
        return;
    }
    
    // Sur PC (Desktop)
    if (!targetEl) {
        card.style.top = '50%';
        card.style.left = '50%';
        card.style.transform = 'translate(-50%, -50%)';
        card.style.width = '450px';
        return;
    }
    
    const rect = targetEl.getBoundingClientRect();
    const cardW = 450;
    const cardH = card.offsetHeight || 220;
    const margin = 20;
    
    // Placer en dessous de la zone si celle-ci est dans la partie supérieure
    if (rect.top + rect.height / 2 < window.innerHeight / 2) {
        card.style.top = `${rect.bottom + margin}px`;
    } else {
        card.style.top = `${rect.top - cardH - margin}px`;
    }
    
    // Centrer horizontalement par rapport à la cible
    let leftPos = rect.left + (rect.width - cardW) / 2;
    // Empêcher les débordements d'écran
    leftPos = Math.max(margin, Math.min(window.innerWidth - cardW - margin, leftPos));
    
    card.style.left = `${leftPos}px`;
    card.style.width = `${cardW}px`;
}

function demarrerTimerEtape() {
    clearInterval(timerInterval);
    const step = steps[currentStepIdx];
    const totalDuration = step.duration || STEP_DURATION;
    const updateRate = 100; // Rafraîchir toutes les 100ms
    
    timerInterval = setInterval(() => {
        if (!isPlaying) return;
        stepProgress += updateRate;
        updateProgressBar();
        
        if (stepProgress >= totalDuration) {
            clearInterval(timerInterval);
            nextDemoStep();
        }
    }, updateRate);
}

function updateProgressBar() {
    const bar = document.getElementById('demo-progress-bar');
    if (!bar) return;
    const step = steps[currentStepIdx];
    const totalDuration = step.duration || STEP_DURATION;
    const pct = Math.min(100, (stepProgress / totalDuration) * 100);
    bar.style.width = `${pct}%`;
}

window.togglePlayPause = function() {
    isPlaying = !isPlaying;
    const playBtn = document.getElementById('demo-btn-play');
    const blocker = document.getElementById('demo-click-blocker');
    
    if (isPlaying) {
        playBtn.innerText = '⏸️ Pause';
        if (blocker) blocker.classList.remove('demo-hidden');
        demarrerTimerEtape();
    } else {
        playBtn.innerText = '▶️ Lecture';
        if (blocker) blocker.classList.add('demo-hidden');
        clearInterval(timerInterval);
    }
};

window.pauseDemo = function() {
    if (isPlaying) {
        togglePlayPause();
    }
};

window.nextDemoStep = function() {
    clearInterval(timerInterval);
    if (currentStepIdx < steps.length - 1) {
        chargerEtape(currentStepIdx + 1);
    } else {
        quitterDemo();
    }
};

window.prevDemoStep = function() {
    clearInterval(timerInterval);
    if (currentStepIdx > 0) {
        chargerEtape(currentStepIdx - 1);
    }
};

window.quitterDemo = function() {
    clearInterval(timerInterval);
    stopTracking();
    
    const backdrop = document.getElementById('demo-spotlight-backdrop');
    const highlight = document.getElementById('demo-spotlight-highlight');
    const blocker = document.getElementById('demo-click-blocker');
    const card = document.getElementById('demo-walkthrough-card');
    
    if (backdrop) backdrop.classList.add('demo-hidden');
    if (highlight) highlight.classList.add('demo-hidden');
    if (blocker) blocker.classList.add('demo-hidden');
    if (card) card.classList.add('demo-hidden');
    
    // Fermer la modale au cas où elle est encore ouverte
    closeModal();
    
    // Restaurer l'état d'origine de l'utilisateur
    if (originalAppState) {
        applyAppState(originalAppState);
        originalAppState = null;
    }
};

// Fermer proprement si la page change
window.addEventListener('beforeunload', () => {
    quitterDemo();
});

// Lance le guide automatiquement si runDemo=true est dans l'URL
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('runDemo') === 'true') {
        // Petit délai pour laisser script.js et le contrôleur local s'initialiser
        setTimeout(() => {
            window.lancerDemoWalkthrough();
            
            // Nettoyer l'URL sans recharger la page
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }, 800);
    }
});

