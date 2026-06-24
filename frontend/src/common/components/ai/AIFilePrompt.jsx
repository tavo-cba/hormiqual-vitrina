import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { Button } from 'primereact/button';
import { config } from '../../../config/config';
import { useToast } from '../../../context/ToastContext';

const AIFilePrompt = ({
    prompt: defaultPrompt = '',
    onData,
    uploadLabel = 'Subir archivo',
    fileLabel = 'Obtener información',
    autoProcess = false,
}) => {
    const showToast = useToast();
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef(null);

    // Auto-procesar cuando se sube un archivo si autoProcess está activado
    useEffect(() => {
        if (file && autoProcess && !loading) {
            handleUpload();
        }
    }, [file, autoProcess]);

    const handleUpload = async () => {
        if (!file || !defaultPrompt) return;
        setLoading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('prompt', defaultPrompt);

            const { data } = await axios.post(
                `${config.backendUrl}/api/ai/file`,
                formData,
                { headers: { ...config.headers, 'Content-Type': 'multipart/form-data' } }
            );

            // El backend puede devolver un objeto JSON directamente o un texto
            // que contenga un JSON embebido. Se maneja ambos casos.
            const payload = data?.response ?? data ?? '';
            let parsed = null;
            try {
                if (typeof payload === 'string') {
                    const match = payload.match(/\{[\s\S]*\}/);
                    if (match) {
                        parsed = JSON.parse(match[0]);
                    }
                } else if (payload && typeof payload === 'object') {
                    parsed = payload;
                }
            } catch (err) {
                console.error('Error al parsear JSON', err);
                showToast('warn', 'No se pudo extraer datos estructurados del archivo');
            }
            if (onData) onData(parsed || payload);
        } catch (err) {
            console.error('Error procesando archivo', err);
            const errorMsg = err.response?.data?.message || err.message || 'Error al procesar el archivo con IA';
            showToast('error', errorMsg);
        } finally {
            setLoading(false);
            setFile(null);
        }
    };

    const handleClick = (e) => {
        e.preventDefault()
        if (!file) {
            fileInputRef.current?.click();
        } else {
            handleUpload();
        }
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files[0])}
            />
            <Button
                label={file ? fileLabel : uploadLabel}
                size="small"
                icon="fa-solid fa-wand-magic-sparkles"
                rounded
                onClick={(e) => handleClick(e)}
                loading={loading}
                disabled={loading}
            />
        </>
    );
};

AIFilePrompt.propTypes = {
    prompt: PropTypes.string,
    onData: PropTypes.func,
    uploadLabel: PropTypes.string,
    fileLabel: PropTypes.string,
    autoProcess: PropTypes.bool,
};

export default AIFilePrompt;