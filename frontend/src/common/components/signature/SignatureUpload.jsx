import React, { useEffect, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import ImageUpload from '../upload/ImageUpload';
import { Button } from 'primereact/button';
import axios from 'axios';
import { useToast } from '../../../context/ToastContext';
import { config } from '../../../config/config';
import './signature.css';

export default function SignatureUpload({
    link,           // string ('' cuando no hay imagen)
    setLink,
    fileKey, setFileKey,
    setS3Key,
    uploadUrl = `${config.backendUrl}/api/archivos`,
    extraFields = {},
    className = '',
}) {
    const sigRef = useRef(null);
    const fileInputRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const showToast = useToast();
    const [render, setRender] = useState(false);

    const [hasImage, setHasImage] = useState(Boolean(link));   // ← única “fuente de verdad”

    /* ---------- subir firma dibujada ---------- */
    const uploadSignature = async () => {
        const canvas = sigRef.current;
        if (!canvas || canvas.isEmpty()) {
            showToast('error', '', 'Debe ingresar una firma');
            return;
        }

        setLoading(true);
        canvas.off();

        try {
            const blob = await new Promise(res => canvas.getCanvas().toBlob(res));
            const fd = new FormData();
            fd.append('files', blob, 'firma.png');
            Object.entries(extraFields).forEach(([k, v]) => fd.append(k, v));

            const { data } = await axios.post(uploadUrl, fd, { headers: config.headers });
            const saved = Array.isArray(data) ? data[0] : data;

            setLink(saved.firma ?? saved.fileLink); 
            setS3Key(saved.key);
            setFileKey(k => k + 1);
            showToast('success', 'Firma subida correctamente');
            setTimeout(() => setRender(!render), 500);
            canvas.clear();
        } catch (err) {
            console.error(err);
            showToast('error', '', 'Error al subir firma');
        } finally {
            setLoading(false);
            canvas.on();
        }
    };

    const uploadFileSignature = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);

        try {
            const fd = new FormData();
            fd.append('files', file);
            Object.entries(extraFields).forEach(([k, v]) => fd.append(k, v));

            const { data } = await axios.post(uploadUrl, fd, { headers: config.headers });
            const saved = Array.isArray(data) ? data[0] : data
            setLink(saved.firma ?? saved.fileLink);
            setS3Key(saved.key);
            setFileKey(k => k + 1);
            showToast('success', 'Firma subida correctamente');
        } catch (err) {
            console.error(err);
            showToast('error', '', 'Error al subir firma');
        } finally {
            setLoading(false);
            e.target.value = '';
        }
    };

    useEffect(() => {
      if(link) {
        setHasImage(true)
      } else {
        setHasImage(false);
      }
    }, [link])

    /* ---------- vista condicional ---------- */
    return (
        /* la `key` obliga a React a desmontar un bloque y montar el otro */
        <div className={`signature-upload ${className}`}
            key={hasImage ? 'uploaded' : 'draw'}>
            {hasImage ? (
                /* ===== imagen ya subida ===== */
                <div className="flex flex-column align-items-center gap-2">
                    <ImageUpload
                        link={link}
                        setLink={setLink}
                        fileKey={fileKey}
                        setFileKey={setFileKey}
                        setS3Key={setS3Key}
                        uploadUrl={uploadUrl}
                        extraFields={extraFields}
                        overlayText="Cambiar firma"
                        tipo="documento"
                    />
                    <Button size="small" rounded type="button" severity="secondary"
                        onClick={() => setLink('')}>
                        Firmar manualmente
                    </Button>
                </div>
            ) : (
                /* ===== canvas para firmar ===== */
                <div className="flex flex-column align-items-center gap-2">
                    <SignatureCanvas
                        ref={sigRef}
                        penColor="black"
                        minWidth={1.5}
                        maxWidth={4}
                        canvasProps={{ className: 'signature-canvas', width: 300, height: 150 }}
                    />
                    <div className="flex gap-2">
                        <Button size="small" rounded type="button"
                            onClick={() => sigRef.current.clear()}>
                            Limpiar
                        </Button>
                        <Button size="small" rounded type="button" loading={loading}
                            onClick={uploadSignature}>
                            Guardar
                        </Button>
                        <input
                            type="file"
                            accept="image/*"
                            ref={fileInputRef}
                            onChange={uploadFileSignature}
                            style={{ display: 'none' }}
                        />
                        <Button size="small" rounded type="button" severity="secondary"
                            onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                            Subir archivo
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
