import { useSearchParams, useLocation } from "react-router-dom";
import { useCallback, useEffect, useRef } from "react";

/**
 * Hook global para sincronizar búsqueda, paginación y scroll con URL search params.
 * Al navegar a otra página y volver (botón atrás), se restauran búsqueda, página y scroll.
 *
 * Uso:
 *   const { searchTerm, setSearchTerm, first, setFirst } = useListParams();
 *
 * Reemplaza:
 *   const [searchTerm, setSearchTerm] = useState('');
 *   const [first, setFirst] = useState(0);
 */
const useListParams = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();
    const scrollKeyRef = useRef(`listScroll_${location.pathname}`);

    const searchTerm = searchParams.get("q") || "";
    const first = parseInt(searchParams.get("first") || "0", 10) || 0;

    const setSearchTerm = useCallback(
        (value) => {
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    if (value) {
                        next.set("q", value);
                    } else {
                        next.delete("q");
                    }
                    // Resetear paginación al cambiar búsqueda
                    next.delete("first");
                    return next;
                },
                { replace: true }
            );
            // Limpiar scroll guardado al cambiar búsqueda
            sessionStorage.removeItem(scrollKeyRef.current);
        },
        [setSearchParams]
    );

    const setFirst = useCallback(
        (value) => {
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    if (value > 0) {
                        next.set("first", String(value));
                    } else {
                        next.delete("first");
                    }
                    return next;
                },
                { replace: true }
            );
            // Limpiar scroll guardado al cambiar página
            sessionStorage.removeItem(scrollKeyRef.current);
        },
        [setSearchParams]
    );

    // Persistir y restaurar scroll
    useEffect(() => {
        const key = scrollKeyRef.current;

        // Restaurar scroll guardado (con reintentos esperando que cargue el contenido)
        const savedScroll = parseInt(sessionStorage.getItem(key) || "0", 10);
        let retryTimer;
        if (savedScroll > 0) {
            const restore = (attempts) => {
                if (attempts > 50) return; // ~5s máximo
                const docHeight = document.documentElement.scrollHeight;
                // Solo intentar si el documento es suficientemente alto
                if (docHeight > savedScroll) {
                    window.scrollTo(0, savedScroll);
                    if (Math.abs(window.scrollY - savedScroll) < 10) return; // éxito
                }
                retryTimer = setTimeout(() => restore(attempts + 1), 100);
            };
            // Empezar después de un breve delay para que arranque el render
            retryTimer = setTimeout(() => restore(0), 50);
        }

        // Guardar scroll en cada cambio (debounced)
        let saveTimer;
        const handleScroll = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                sessionStorage.setItem(key, String(window.scrollY));
            }, 150);
        };
        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            clearTimeout(retryTimer);
            clearTimeout(saveTimer);
            window.removeEventListener("scroll", handleScroll);
            // Guardar posición final al desmontar
            sessionStorage.setItem(key, String(window.scrollY));
        };
    }, [location.pathname]);

    return { searchTerm, setSearchTerm, first, setFirst };
};

export default useListParams;
