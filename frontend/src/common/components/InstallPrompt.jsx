// src/components/InstallPrompt.jsx
import { useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { useConfig } from "../../context/ConfigContext";

const LS_KEY = "installPromptDismiss";

export default function InstallPrompt() {
    const deferredPrompt = useRef(null);
    const [visible, setVisible] = useState(false);
    const cfg = useConfig();

    const companyStr = cfg?.nombreEmpresa ? ` de ${cfg.nombreEmpresa}` : "";

    /* ───────────────────────── 1. Capturar beforeinstallprompt ───────────────────────── */
    useEffect(() => {
        // Si el usuario ya lo descartó, salimos
        if (localStorage.getItem(LS_KEY)) return;

        const handler = (e) => {
            e.preventDefault();                 // bloquea la mini-infobar de Chrome
            deferredPrompt.current = e;
            setVisible(true);
        };

        window.addEventListener("beforeinstallprompt", handler);

        // Ocultar si ya está instalada
        if (
            window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true
        ) {
            setVisible(false);
        }

        return () => window.removeEventListener("beforeinstallprompt", handler);
    }, []);

    /* ───────────────────────── 2. Click “Instalar” ───────────────────────── */
    const handleInstall = async () => {
        if (!deferredPrompt.current) return;

        const promptEvent = deferredPrompt.current;
        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;

        if (outcome === "dismissed") {
            localStorage.setItem(LS_KEY, "1"); 
        }
        deferredPrompt.current = null;
        setVisible(false);
    };

    /* ───────────────────────── 3. Click “Cerrar ×” ───────────────────────── */
    const handleClose = () => {
        localStorage.setItem(LS_KEY, "1");               // recuerda el descarte
        setVisible(false);
    };

    if (!visible) return null;

    /* ───────────────────────── 4. UI del banner ───────────────────────── */
    return (
        <div className="install-prompt flex align-items-center justify-content-between w-full">
            <img src={cfg?.thumbnail} alt="" style={{width: '2rem'}} className="mr-2" />
            <small className="font-medium ">
                Instalá la app{companyStr} en tu teléfono
            </small>
            <div className="flex  gap-2">
                <Button
                    onClick={handleInstall}
                    rounded
                    label="Instalar"
                    icon="fa-solid fa-download"
                    size="small"
                />

                <Button
                    onClick={handleClose}
                    rounded
                    icon="fa-solid fa-xmark"
                    size="small"
                    severity="secondary"

                />
            </div>

        </div>
    );
}
