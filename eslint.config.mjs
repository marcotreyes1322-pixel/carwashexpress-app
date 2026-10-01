// Revisión automática del código (npm run lint). Busca errores que rompen la
// app sin avisar: una variable mal escrita, una función que no existe, una
// constante que se reasigna. No revisa el estilo.
//
// El JS de la app vive dentro de index.html; `npm run construir` lo saca a
// .construccion/app-fuente.js para poder revisarlo aquí.
const errores = {
    'no-undef': 'error',
    'no-redeclare': 'error',
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    'no-const-assign': 'error',
    'no-dupe-else-if': 'error',
    'no-self-assign': 'error',
    'no-unsafe-finally': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error'
};

const navegador = Object.fromEntries([
    'window', 'document', 'navigator', 'location', 'console', 'history', 'screen', 'matchMedia',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'localStorage', 'sessionStorage', 'fetch', 'Image', 'performance', 'getComputedStyle',
    'Promise', 'Map', 'Set', 'URL', 'URLSearchParams', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'AbortController', 'Event', 'CustomEvent',
    'HTMLElement', 'Blob', 'FileReader', 'alert', 'confirm', 'innerWidth', 'innerHeight', 'caches',
    // Librerías que se cargan desde su CDN
    'firebase', 'mapboxgl'
].map(n => [n, 'readonly']));

export default [
    {
        files: ['.construccion/app-fuente.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: navegador },
        rules: errores
    },
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'script',
            globals: Object.fromEntries(['self', 'caches', 'fetch', 'Response', 'Request', 'URL', 'console', 'Promise']
                .map(n => [n, 'readonly']))
        },
        rules: errores
    },
    {
        // El sincronizador con Google Calendar corre en Google Apps Script (no en la app).
        files: ['integraciones/google-calendar/*.gs'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'script',
            globals: Object.fromEntries(['CalendarApp', 'ScriptApp', 'UrlFetchApp', 'PropertiesService', 'LockService',
                'Logger', 'Utilities', 'console'].map(n => [n, 'readonly']))
        },
        rules: errores
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'module',
            globals: Object.fromEntries(['process', 'console', 'URL', 'Buffer', 'setTimeout', 'clearTimeout',
                // dentro de page.evaluate() el código corre en el navegador
                'document', 'window', 'navigator', 'location', 'innerWidth', 'innerHeight', 'getComputedStyle', 'caches', 'fetch']
                .map(n => [n, 'readonly']))
        },
        rules: errores
    }
];
