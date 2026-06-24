import React, { useEffect, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import axios from 'axios';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { config } from '../../../config/config';
import FilePicker from './FilePicker';
import { isOnPhone } from '../../functions';

export default function DocumentDialog({
    visible = false,
    onHide,
    params = {},
    tipo = 0,
    title = 'Documentación'
}) {
    const [archivos, setArchivos] = useState([]);
    const [categorias, setCategorias] = useState([]);

    useEffect(() => {
        if (!visible) return;
        const load = async () => {
            try {
                const { data } = await axios.get(`${config.backendUrl}/api/archivos`, {
                    headers: config.headers,
                    params
                });
                setArchivos(
                    data.map(a => ({
                        ...a,
                        idCategoriaArchivo: a.idCategoriaArchivo !== undefined && a.idCategoriaArchivo !== null
                            ? Number(a.idCategoriaArchivo)
                            : a.categorias && a.categorias.length
                                ? Number(a.categorias[0].idCategoriaArchivo ?? a.categorias[0].ArchivoCategoria?.idCategoriaArchivo)
                                : null,
                    }))
                );

                const { data: cats } = await axios.get(`${config.backendUrl}/api/archivos/categorias`, {
                    headers: config.headers
                });
                setCategorias(
                    cats
                        .map(c => ({ ...c, idCategoriaArchivo: Number(c.idCategoriaArchivo) }))
                        .filter(c => c.tipo === tipo)
                );
            } catch (err) {
                console.error(err);
            }
        };
        load();
    }, [visible, JSON.stringify(params), tipo]);

    const handleDownload = async () => {
        try {
            const zip = new JSZip();

            await Promise.all(
                archivos.map(async (a) => {
                    const cat = categorias.find(c => c.idCategoriaArchivo === a.idCategoriaArchivo);
                    const folder = zip.folder(cat ? cat.categoria : 'Sin categoria');
                    const res = await axios.get(a.url, {
                        responseType: 'blob',
                    });
                    folder.file(a.nombreOriginal, res.data);
                })
            );

            const blob = await zip.generateAsync({ type: 'blob' });
            saveAs(blob, `${title}.rar`);
        } catch (err) {
            console.error(err);
        }
    };
    return (
        <Dialog visible={visible} onHide={onHide} className="w-11 xl:w-6">
            <div className="flex justify-content-between align-items-center mb-3">
                <h3 className="m-0"><i className='fa-solid fa-folder-open mr-2'></i>{title}</h3>
                <div className='flex gap-3 align-items-center '>
                    <Button
                        label={isOnPhone ? null : "Descargar .rar"}
                        icon="fa-solid fa-download"
                        size="small"
                        rounded
                        onClick={handleDownload}
                    />
                    <i className='fa-solid fa-xmark hover-red' onClick={onHide}></i>
                </div>

            </div>
            <FilePicker
                archivos={archivos}
                setArchivos={setArchivos}
                tipo={tipo}
                extraFields={params}
                categorias={categorias}
                setCategorias={setCategorias}
            />
        </Dialog>
    );
}