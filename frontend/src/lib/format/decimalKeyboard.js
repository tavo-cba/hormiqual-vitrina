/**
 * Soporte universal de tecla decimal (.) en `<InputNumber>` con locale es-AR.
 *
 * Quinto intento (sesión 2026-06-13). Los intentos previos no funcionaron:
 *   1. `execCommand('insertText')`: deprecated, comportamiento inconsistente.
 *   2. `setRangeText` + dispatch `InputEvent`: PrimeReact tiene su propio
 *      handler que sobrescribe nuestros cambios.
 *   3. Listener delegado en `document` con `stopImmediatePropagation`: el
 *      handler de React vive en un árbol sintético aparte que no se detiene.
 *   4. MutationObserver + listener directo en input con `preventDefault` +
 *      `setRangeText`: el cuarto intento BORRABA un dígito porque
 *      PrimeReact, tras nuestro preventDefault, procesaba el `keydown` como
 *      "tecla no válida" y limpiaba el último carácter del input.
 *
 * Approach actual (más simple): **mutar `e.key` y `e.code`** del evento
 * nativo sin tocar `preventDefault`. PrimeReact lee `e.key` cuando decide
 * si aceptar la tecla; si llega "," en lugar de ".", lo procesa normalmente
 * como tecleo válido para locale es-AR. No interferimos con el flujo del
 * evento — simplemente le mentimos sobre qué tecla se apretó.
 *
 * Usamos MutationObserver para adjuntar el listener directamente al input
 * antes que cualquier listener de React (fase capture en el target).
 */

const _attachedSentinel = Symbol('decimalKeyboardAttached');

function _attachToInput(input) {
    if (!input || input[_attachedSentinel]) return;
    input[_attachedSentinel] = true;

    input.addEventListener('keydown', (e) => {
        if (e.key !== '.' && e.code !== 'NumpadDecimal') return;

        // Mutar TODOS los campos que un handler podría leer para identificar
        // la tecla. `key` es el moderno; `code` es la tecla física; `keyCode`
        // y `which` son legacy pero PrimeReact los chequea en algunas
        // versiones. Después de esto, el evento PARECE haber sido tecleado
        // con una coma — y eso es lo que ve el handler de React.
        try {
            Object.defineProperty(e, 'key', { value: ',', configurable: true });
            Object.defineProperty(e, 'code', { value: 'Comma', configurable: true });
            Object.defineProperty(e, 'keyCode', { value: 188, configurable: true });
            Object.defineProperty(e, 'which', { value: 188, configurable: true });
            Object.defineProperty(e, 'charCode', { value: 0, configurable: true });
        } catch { /* algunos browsers no permiten redefinir; fallback abajo */ }

        // NO usar preventDefault. NO usar stopPropagation. Dejamos que el
        // evento siga su curso natural con la "tecla" cambiada a coma.
    }, true);
}

/**
 * Handler `onKeyDown` para uso manual (back-compat). Comparte la misma
 * estrategia: mutar e.key.
 */
export function handleDecimalKey(e) {
    if (e.key !== '.' && e.code !== 'NumpadDecimal') return;
    const target = e.target;
    if (!target || !target.classList || !target.classList.contains('p-inputnumber-input')) return;
    try {
        // Para eventos sintéticos de React, mutar el nativeEvent.
        const native = e.nativeEvent || e;
        Object.defineProperty(native, 'key', { value: ',', configurable: true });
        Object.defineProperty(native, 'code', { value: 'Comma', configurable: true });
        Object.defineProperty(native, 'keyCode', { value: 188, configurable: true });
        Object.defineProperty(native, 'which', { value: 188, configurable: true });
    } catch { /* ignore */ }
}

let _observer = null;

/**
 * Instala un MutationObserver que adjunta el handler de decimal a cada
 * `.p-inputnumber-input` que aparece en el DOM. Idempotente.
 */
export function installDecimalKeyboardFix() {
    if (typeof document === 'undefined') return () => {};
    if (_observer) return () => {};

    document.querySelectorAll('.p-inputnumber-input').forEach(_attachToInput);

    _observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
            mut.addedNodes.forEach((node) => {
                if (node.nodeType !== 1) return;
                if (node.classList?.contains('p-inputnumber-input')) {
                    _attachToInput(node);
                }
                node.querySelectorAll?.('.p-inputnumber-input').forEach(_attachToInput);
            });
        }
    });
    _observer.observe(document.body, { childList: true, subtree: true });

    return () => {
        if (_observer) {
            _observer.disconnect();
            _observer = null;
        }
    };
}
