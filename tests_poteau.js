/**
 * Harnais de test TDD pour le calcul de poteaux Eurocode 2
 * Ces tests valident la logique mathématique métier (calculateEurocode2)
 */

document.addEventListener("DOMContentLoaded", () => {
    const resultsContainer = document.getElementById("test-results");
    const summaryContainer = document.getElementById("test-summary");
    
    let totalTests = 0;
    let passedTests = 0;

    function assertClose(actual, expected, tolerance = 0.01, testName) {
        totalTests++;
        const passed = Math.abs(actual - expected) <= tolerance;
        if (passed) passedTests++;
        
        const el = document.createElement("div");
        el.className = `test-case ${passed ? 'pass' : 'fail'}`;
        el.innerHTML = `
            <span><strong>${testName}</strong> <br> Attendu: ${expected.toFixed(3)} | Obtenu: ${actual.toFixed(3)}</span>
            <span class="test-badge ${passed ? 'badge-pass' : 'badge-fail'}">${passed ? 'PASS' : 'FAIL'}</span>
        `;
        resultsContainer.appendChild(el);
    }

    function runTestSuite() {
        resultsContainer.innerHTML = '';
        totalTests = 0;
        passedTests = 0;

        // Cas de test 1 : Poteau simple en compression
        // a=0.3m, b=0.3m, L=3m, fck=25, fyk=500, beta=1.0 (articulé)
        // Ac = 0.09 m2 = 900 cm2
        // fcd = 1.0 * 25 / 1.5 = 16.667 MPa
        // N_Rd_c = Ac * fcd / 10 = 900 * 16.667 / 10 = 1500 kN
        const test1_params = { L: 3.0, a: 0.30, b: 0.30, beta: 1.0, fck: 25, fyk: 500, N_Ed: 1000, M_Ed: 0, enrobage: 3.0, diameter: 12 };
        const res1 = calculateEurocode2(test1_params);

        assertClose(res1.l0, 3.0, 0.001, "[T1] Longueur de flambement l0 (beta=1.0 * L=3.0)");
        assertClose(res1.lambda, 34.64, 0.1, "[T1] Élancement lambda (l0 / (a/sqrt(12)))");
        assertClose(res1.N_Rd_c, 1500, 1.0, "[T1] Capacité portante du béton seul N_Rd,c (kN)");
        
        // As_min = max(0.10 * N_Ed / fyd, 0.002 * Ac)
        // fyd = 500 / 1.15 = 434.78 MPa = 43.478 kN/cm2
        // 0.10 * 1000 / 43.478 = 2.3 cm2
        // 0.002 * 900 = 1.8 cm2
        // max = 2.3 cm2
        assertClose(res1.As_min, 2.3, 0.01, "[T1] Section d'acier minimale As,min (cm²)");

        // Cas de test 2 : Poteau très élancé (second ordre)
        const test2_params = { L: 6.0, a: 0.20, b: 0.20, beta: 1.0, fck: 30, fyk: 500, N_Ed: 500, M_Ed: 0, enrobage: 3.0, diameter: 12 };
        const res2 = calculateEurocode2(test2_params);
        
        assertClose(res2.l0, 6.0, 0.001, "[T2] Longueur de flambement l0");
        assertClose(res2.lambda, 103.92, 0.1, "[T2] Élancement lambda (très élancé)");
        
        // fcd = 1.0 * 30 / 1.5 = 20 MPa. Ac = 400 cm2. N_Rd_c = 400 * 20 / 10 = 800 kN.
        assertClose(res2.N_Rd_c, 800, 1.0, "[T2] Capacité portante du béton seul N_Rd,c (kN)");
        
        // Imperfection e_i = l0 / 400 = 6000 / 400 = 15mm. (Max avec max_dim/30 ou 20mm si règle FR).
        // e_i in res2 should be checked based on the EC2 rule we implement.
        
        // Update summary
        summaryContainer.className = `summary ${passedTests === totalTests ? 'success' : 'error'}`;
        summaryContainer.innerText = `Résultats : ${passedTests} / ${totalTests} tests réussis.`;
    }

    // Retarder légèrement l'exécution pour s'assurer que poteau.js est bien chargé
    setTimeout(runTestSuite, 100);
});
