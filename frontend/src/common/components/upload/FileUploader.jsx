import React, { useState } from "react";
import { FileUpload } from "primereact/fileupload";
import axios from "axios";
import { useToast } from "../../../context/ToastContext";
import { config } from "../../../config/config";
import './fileuploader.css'
import { ProgressSpinner } from "primereact/progressspinner";

/**
 * FileUploader
 * ------------
 *  - Sube uno o varios archivos a /api/upload
 *  - Acepta campos extra para asociar el archivo (idProbeta, etc.)
 *
 * Props
 *  - extraFields (object) → { idProbeta: 33, tipo: 'foto' }
 *  - …todos los props anteriores (multiple, accept, maxFileSize, …)
 */
export default function FileUploader({
    extraFields = {},
    multiple = true,
    accept = "application/pdf,image/*",
    maxFileSize = 18 * 1024 * 1024,
    onUploaded,
    chooseLabel = "Seleccionar",
    uploadLabel = "Subir",
    cancelLabel = "Cancelar",
    localOnly = false,
}) {
    const showToast = useToast();
    const [uploading, setUploading] = useState(false);

    /* 1⃣  Handler de subida manual */
    const customUpload = async (event) => {
        if (localOnly) {
            onUploaded?.(event.files);
            event.options.clear();
            return;
        }
        try {
            setUploading(true);
            const formData = new FormData();
            /* archivos */
            event.files.forEach((f) => formData.append("files", f));
            /* campos adicionales */
            Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));

            /* POST a tu backend */
            const { data } = await axios.post(`${config.backendUrl}/api/archivos`, formData, {
                headers: { ...config.headers, "Content-Type": "multipart/form-data" },
            });

            showToast("success", "Archivo(s) subido(s) correctamente");
            event.options.clear();
            onUploaded?.(data);
        } catch (err) {
            console.error(err);
            showToast("error", "Ocurrió un error al subir el archivo");
        } finally {
            setUploading(false);
        }
    };


    const itemTemplate = (file, opts) => {
        const {
            previewElement,
            fileNameElement,
            sizeElement,
            removeElement,
            formatSize,
        } = opts;

        return (
            <div className="flex items-center align-items-center gap-3 w-full py-2 px-3 border-b surface-border file-card my-1">
                {/* miniatura */}
                <div className="overflow-hidden border-round-lg shadow-1 flex-shrink-0">
                    {previewElement ? <i className="fa-solid fa-image" style={{ fontSize: '2rem' }}></i> : <i className="fa-solid fa-file" style={{ fontSize: '2rem' }}></i>}
                </div>

                {/* nombre + tamaño */}
                <div className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{fileNameElement}</span>
                    <small className="opacity-70">{formatSize}</small>
                </div>

                {/* botón quitar */}
                {removeElement}
            </div>
        );
    };
    return (
        <FileUpload
            name="files"
            customUpload
            uploadHandler={customUpload}   /* 👈 */
            multiple={multiple}
            accept={accept}
            maxFileSize={maxFileSize}
            chooseLabel={chooseLabel}
            uploadLabel={uploadLabel}
            cancelLabel={cancelLabel}
            itemTemplate={itemTemplate}
            uploadOptions={{
                label: uploading ? "" : "Subiendo",
                icon: uploading ?
                    <ProgressSpinner
                        strokeWidth="6"
                        style={{ width: "1.2rem", height: "1.2rem", marginRight: '0.3rem' }}
                        
                    /> : "",   // spinner PrimeIcons
                className: uploading ? "p-disabled" : "",
                disabled: uploading,
            }}
            emptyTemplate={
                <div className="flex align-items-center justify-content-center flex-column gap-2 text-center">
                    <i className="fa-solid fa-file-upload" style={{ fontSize: '2rem' }}></i>
                    <small className="m-0">Arrastrá y soltá archivos acá o hacé clic para elegir.</small>

                </div>
            }
            cancelOptions={{ style: { display: "none" } }}  /* sin botón Cancelar */
        />
    );
}
