import { useEffect, useState } from "react";

// Hook con persistencia en localStorage del filtro "empleado de obra vs.
// administrativo". El valor es tri-estado: null = todos, true = obra,
// false = administrativo.
const readStored = (storageKey) => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(storageKey);
    if (raw === "true") return true;
    // "false" (= solo administrativos) ya no es seleccionable desde la UI;
    // si quedó guardado de una versión previa lo tratamos como null (Todos).
    return null;
};

export default function useObraFilter(storageKey) {
    const [value, setValue] = useState(() => readStored(storageKey));

    useEffect(() => {
        if (typeof window === "undefined" || !storageKey) return;
        if (value === null || value === undefined) {
            localStorage.removeItem(storageKey);
        } else {
            localStorage.setItem(storageKey, String(value));
        }
    }, [value, storageKey]);

    return [value, setValue];
}
