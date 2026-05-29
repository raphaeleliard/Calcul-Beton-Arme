/**
 * =========================================================
 * Projet : Outil Pédagogique Eurocode 2 (Calcul Béton Armé)
 * Auteur : Raphaël ELIARD
 * Description : Script de contrôle de la visite guidée (Mode Démo).
 * Supporte le parcours multi-pages (index.html <-> Poutre.html),
 * le verrouillage du scroll et les clics programmables en pause,
 * et la simulation d'actions de calcul en temps réel.
 * =========================================================
 */

let originalAppState = null;
let currentStepIdx = 0;
let isPlaying = false;
let stepProgress = 0;
const STEP_DURATION = 12000; 
let timerInterval = null;
let trackingActive = false;

// Variables pour le lissage du projecteur (spotlight)
let lastX = 0, lastY = 0, lastW = 0, lastH = 0;

// Système de blocage du scroll
const scrollKeys = {37: 1, 38: 1, 39: 1, 40: 1, 32: 1, 33: 1, 34: 1, 35: 1, 36: 1};

function preventDefault(e) {
    e.preventDefault();
}

function preventDefaultForScrollKeys(e) {
    if (scrollKeys[e.keyCode]) {
        preventDefault(e);
        return false;
    }
}

let supportsPassive = false;
try {
    window.addEventListener("test", null, Object.defineProperty({}, "passive", {
        get: function() { supportsPassive = true; }
    }));
} catch(e) {}

const wheelOpt = supportsPassive ? { passive: false } : false;
const wheelEvent = 'onwheel' in document.createElement('div') ? 'wheel' : 'mousewheel';

function disableScroll() {
    window.addEventListener('DOMMouseScroll', preventDefault, false);
    window.addEventListener(wheelEvent, preventDefault, wheelOpt);
    window.addEventListener('touchmove', preventDefault, wheelOpt);
    window.addEventListener('keydown', preventDefaultForScrollKeys, false);
    document.body.style.overflow = 'hidden'; // Force également en CSS
}

function enableScroll() {
    window.removeEventListener('DOMMouseScroll', preventDefault, false);
    window.removeEventListener(wheelEvent, preventDefault, wheelOpt);
    window.removeEventListener('touchmove', preventDefault, wheelOpt);
    window.removeEventListener('keydown', preventDefaultForScrollKeys, false);
    document.body.style.overflow = '';
}

const steps = [
    {
        page: "index.html",
        title: "Bienvenue sur EC2 Assistant ! 🏗️",
        desc: "Découvrez comment dimensionner des éléments en béton armé selon les règles de l'Eurocode 2.<br><br>Ce guide interactif va s'animer automatiquement. Vous pouvez le mettre en pause ou naviguer manuellement à tout moment.",
        target: null,
        duration: 10000,
        action: (callback) => { if (callback) callback(); }
    },
    {
        page: "index.html",
        title: "Plusieurs Modules de Dimensionnement ⚙️",
        desc: "L'application comprend 6 modules de dimensionnement complets (poutres, poteaux, voiles, dalles, semelles filantes et isolées).<br><br><em>Commençons par le module Poutre pour voir un cas pratique de calcul...</em>",
        target: ".modules-grid",
        duration: 12000,
        action: (callback) => { if (callback) callback(); }
    },
    {
        page: "Poutre.html",
        title: "1. Paramètres d'Entrée ✏️",
        desc: "Définissez la portée de la poutre, sa section en béton (base & hauteur), ainsi que les charges permanentes G et d'exploitation Q.<br><br><em>Observation : Regardez la portée changer sous vos yeux...</em>",
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
        page: "Poutre.html",
        title: "2. Note de Calcul Interactive 📊",
        desc: "L'application calcule instantanément les sollicitations (Moment fléchissant Med, Effort tranchant Ved) et les sections requises d'acier.<br><br>Chaque carte affiche le paragraphe réglementaire de l'Eurocode 2 correspondant (ex: EC2 §6.1).",
        target: "main.panel",
        duration: 12000,
        action: (callback) => {
            if (callback) callback();
        }
    },
    {
        page: "Poutre.html",
        title: "3. Formules Réglementaires Détaillées 🔍",
        desc: "Besoin de comprendre la formule ? Cliquez sur une carte de résultat pour ouvrir une explication pédagogique détaillée.",
        target: ".result-card[onclick*='As']",
        duration: 14000,
        action: (callback) => {
            // Simulation du clic pour afficher la formule Eurocode de l'acier longitudinal
            setTimeout(() => {
                if (typeof showFormula === 'function') {
                    showFormula('As');
                }
                if (callback) callback();
            }, 1500);
        }
    },
    {
        page: "Poutre.html",
        title: "4. Choix du Ferraillage Commercial 🔩",
        desc: "En fonction de la section d'acier théorique requise, l'ingénieur choisit le diamètre des barres (HA10, HA12...) et leur nombre.<br><br><em>Observation : Avec notre nouvelle portée de 6.5m, 3 HA10 sont insuffisants. Modifions le choix...</em>",
        target: "aside.panel:last-of-type",
        duration: 15000,
        action: (callback) => {
            if (typeof closeModal === 'function') {
                closeModal();
            }
            
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
        page: "Poutre.html",
        title: "5. Plan de Ferraillage Dynamique 🎨",
        desc: "Le plan de ferraillage se dessine en temps réel sous forme de SVG interactif, incluant les armatures longitudinales, les cadres transversaux, l'enrobage et les espacements de calcul.",
        target: "#svgContainer",
        duration: 14000,
        action: (callback) => {
            if (typeof setView === 'function') {
                setView('longitudinale');
            }
            
            setTimeout(() => {
                if (typeof setView === 'function') {
                    setView('coupe');
                }
                if (callback) callback();
            }, 6000);
        }
    },
    {
        page: "Poutre.html",
        title: "6. Validation de la Conformité 🛡️",
        desc: "Le badge de statut vérifie la conformité de l'élément vis-à-vis des clauses de l'Eurocode 2 (ferraillage minimal, espacement net pour coulage du béton, section d'acier maximale de 4%).",
        target: "#statusBadge",
        duration: 11000,
        action: (callback) => {
            if (callback) callback();
        }
    },
    {
        page: "Poutre.html",
        title: "7. Rapports & Exports 📥",
        desc: "Une fois le dimensionnement conforme, vous pouvez exporter le plan sous format PNG ou télécharger un rapport de calcul A4 réglementaire complet en PDF (3 pages).",
        target: ".export-buttons",
        duration: 11000,
        action: (callback) => {
            if (callback) callback();
        }
    },
    {
        page: "Poutre.html",
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
    if (typeof AppState === 'undefined') return;
    
    AppState.inputs = JSON.parse(JSON.stringify(state.inputs));
    AppState.selectedDiameter = state.selectedDiameter;
    AppState.nbBarres = state.nbBarres;
    AppState.currentView = state.currentView;
    
    for (let id in AppState.inputs) {
        const el = document.getElementById(id);
        if (el) el.value = AppState.inputs[id];
    }
    
    const nbInput = document.getElementById('nbBarresInput');
    if (nbInput) nbInput.value = AppState.nbBarres;
    
    document.querySelectorAll('.steel-btn').forEach(btn => {
        const diam = parseInt(btn.dataset.diameter);
        btn.classList.toggle('active', diam === AppState.selectedDiameter);
    });
    
    if (typeof runController === 'function') {
        runController();
    }
    if (typeof setView === 'function') {
        setView(AppState.currentView);
    }
}

// Démarrer la démo
window.lancerDemoWalkthrough = function(startStepIdx = 0) {
    currentStepIdx = startStepIdx;
    isPlaying = true;
    stepProgress = 0;
    
    // Si on démarre à une étape qui appartient à une autre page, on redirige
    const step = steps[currentStepIdx];
    if (step && step.page && !window.location.pathname.includes(step.page)) {
        window.location.href = `${step.page}?runDemo=true&step=${currentStepIdx}`;
        return;
    }
    
    // Gérer l'isolation des données utilisateur sur Poutre.html
    if (window.location.pathname.includes('Poutre.html')) {
        if (!originalAppState && typeof AppState !== 'undefined') {
            originalAppState = {
                inputs: JSON.parse(JSON.stringify(AppState.inputs)),
                selectedDiameter: AppState.selectedDiameter,
                nbBarres: AppState.nbBarres,
                currentView: AppState.currentView
            };
        }
        applyAppState({
            inputs: { L: 5.0, b: 0.20, h: 0.50, G: 15, Q: 10, fck: 25 },
            selectedDiameter: 10,
            nbBarres: 3,
            currentView: "coupe"
        });
    }
    
    const backdrop = document.getElementById('demo-spotlight-backdrop');
    const highlight = document.getElementById('demo-spotlight-highlight');
    const card = document.getElementById('demo-walkthrough-card');
    
    if (backdrop) backdrop.classList.remove('demo-hidden');
    if (highlight) highlight.classList.remove('demo-hidden');
    if (card) card.classList.remove('demo-hidden');
    
    lastX = 0; lastY = 0; lastW = 0; lastH = 0;
    
    buildDotsIndicator();
    chargerEtape(currentStepIdx);
    startTracking();
};

function buildDotsIndicator() {
    const dotsContainer = document.getElementById('demo-dots');
    if (!dotsContainer) return;
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
    
    const step = steps[idx];
    
    // Gérer la redirection inter-page
    if (step.page && !window.location.pathname.includes(step.page)) {
        clearInterval(timerInterval);
        stopTracking();
        enableScroll();
        window.location.href = `${step.page}?runDemo=true&step=${idx}`;
        return;
    }
    
    currentStepIdx = idx;
    updateDots();
    
    document.getElementById('demo-step-title').innerHTML = step.title;
    document.getElementById('demo-step-desc').innerHTML = step.desc;
    
    stepProgress = 0;
    updateProgressBar();
    
    // Gérer le verrouillage du scroll et du clic
    syncInteractionLock();
    
    // Appliquer le spotlight
    applySpotlight(step.target);
    
    // Lancer l'action simulée
    if (step.action) {
        step.action(() => {
            if (isPlaying && currentStepIdx === idx) {
                demarrerTimerEtape();
            }
        });
    } else {
        if (isPlaying) demarrerTimerEtape();
    }
}

function syncInteractionLock() {
    const blocker = document.getElementById('demo-click-blocker');
    
    if (isPlaying) {
        disableScroll();
        if (blocker) blocker.classList.remove('demo-hidden');
    } else {
        enableScroll();
        if (blocker) blocker.classList.add('demo-hidden');
    }
}

function applySpotlight(selector) {
    const backdrop = document.getElementById('demo-spotlight-backdrop');
    const highlight = document.getElementById('demo-spotlight-highlight');
    if (!backdrop || !highlight) return;
    
    if (!selector) {
        highlight.classList.add('demo-hidden');
        backdrop.style.clipPath = 'none';
        backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.65)';
        
        positionCard(null);
        return;
    }
    
    const el = document.querySelector(selector);
    if (!el) {
        setTimeout(() => applySpotlight(selector), 100);
        return;
    }
    
    highlight.classList.remove('demo-hidden');
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.55)';
    
    // Scroll fluide vers l'élément ciblé
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Boucle de tracking à 60 FPS
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
    
    const targetX = rect.left - padding;
    const targetY = rect.top - padding;
    const targetW = rect.width + padding * 2;
    const targetH = rect.height + padding * 2;
    
    const lerpFactor = 0.15;
    lastX = lastX === 0 ? targetX : lastX + (targetX - lastX) * lerpFactor;
    lastY = lastY === 0 ? targetY : lastY + (targetY - lastY) * lerpFactor;
    lastW = lastW === 0 ? targetW : lastW + (targetW - lastW) * lerpFactor;
    lastH = lastH === 0 ? targetH : lastH + (targetH - lastH) * lerpFactor;
    
    highlight.style.left = `${lastX}px`;
    highlight.style.top = `${lastY}px`;
    highlight.style.width = `${lastW}px`;
    highlight.style.height = `${lastH}px`;
    
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
    
    card.style.top = '';
    card.style.bottom = '';
    card.style.left = '';
    card.style.right = '';
    card.style.transform = '';
    card.style.width = '';
    
    if (isMobile) {
        if (!targetEl) {
            card.style.top = '25%';
            card.style.left = '50%';
            card.style.transform = 'translate(-50%, -25%)';
            card.style.width = '92vw';
        } else {
            card.style.bottom = '16px';
            card.style.left = '50%';
            card.style.transform = 'translateX(-50%)';
            card.style.width = '92vw';
        }
        return;
    }
    
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
    
    if (rect.top + rect.height / 2 < window.innerHeight / 2) {
        card.style.top = `${rect.bottom + margin}px`;
    } else {
        card.style.top = `${rect.top - cardH - margin}px`;
    }
    
    let leftPos = rect.left + (rect.width - cardW) / 2;
    leftPos = Math.max(margin, Math.min(window.innerWidth - cardW - margin, leftPos));
    
    card.style.left = `${leftPos}px`;
    card.style.width = `${cardW}px`;
}

function demarrerTimerEtape() {
    clearInterval(timerInterval);
    const step = steps[currentStepIdx];
    const totalDuration = step.duration || STEP_DURATION;
    const updateRate = 100;
    
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
    
    if (isPlaying) {
        playBtn.innerText = '⏸️ Pause';
        syncInteractionLock();
        demarrerTimerEtape();
    } else {
        playBtn.innerText = '▶️ Lecture';
        syncInteractionLock();
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
    enableScroll();
    
    const backdrop = document.getElementById('demo-spotlight-backdrop');
    const highlight = document.getElementById('demo-spotlight-highlight');
    const blocker = document.getElementById('demo-click-blocker');
    const card = document.getElementById('demo-walkthrough-card');
    
    if (backdrop) backdrop.classList.add('demo-hidden');
    if (highlight) highlight.classList.add('demo-hidden');
    if (blocker) blocker.classList.add('demo-hidden');
    if (card) card.classList.add('demo-hidden');
    
    if (typeof closeModal === 'function') {
        closeModal();
    }
    
    if (originalAppState && typeof AppState !== 'undefined') {
        applyAppState(originalAppState);
        originalAppState = null;
    }
};

window.addEventListener('beforeunload', () => {
    quitterDemo();
});

// Lance le guide automatiquement si runDemo=true est dans l'URL
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('runDemo') === 'true') {
        const stepParam = parseInt(urlParams.get('step')) || 0;
        setTimeout(() => {
            window.lancerDemoWalkthrough(stepParam);
            
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }, 800);
    }
});
